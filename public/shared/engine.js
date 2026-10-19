// Authoritative game engine for FLOCK RUSH.
// Pure ES module: it runs in Node behind the WebSocket server AND in the browser for offline Practice Mode.
// Clients never decide scores or round results. They report where their dog is and ask for actions (bark, dash, howl);
// the engine validates movement, runs the sheep simulation, and decides who is winning.
import { generateField, sheepCountFor, resolveCollision, mudAt, DOG_RADIUS, forward, mulberry32 } from './field.js';
import { FlockSim, TUNING } from './sim.js';

export const MODES = {
  ffa:       { label: 'Roundup',      min: 2, desc: 'Every dog has a pen. Herd the flock into yours, and steal from rivals. Most sheep wins.' },
  team:      { label: 'Team Roundup', min: 2, desc: 'Two teams, one pen each. Work together to fill your pen.' },
  stampede:  { label: 'Stampede',     min: 2, desc: 'A bigger, jumpier flock and constant thunderstorms. Pure chaos.' },
};
export const DIFFICULTY = ['easy', 'normal', 'hard'];
export const FLOCKS = { small: 0.7, normal: 1, large: 1.4 };
export const COSMETICS = {
  hat:     [['none', 0], ['cap', 0], ['straw', 0], ['cowboy', 5], ['tophat', 12], ['crown', 30]],
  bandana: [['none', 0], ['red', 0], ['blue', 0], ['green', 0], ['gold', 8]],
  victory: [['wag', 0], ['spin', 10], ['flip', 25]],
  color:   ['#c0392b', '#d68910', '#27ae60', '#2980b9', '#8e44ad', '#16a085', '#e67e22', '#7f8c8d', '#e84393', '#2d3436', '#f1c40f', '#00b894'],
};
export const LIMITS = { maxPlayers: 12, nameMin: 2, nameMax: 16, chatMax: 160, roomGraceMs: 120000, playerGraceMs: 45000, countdownMs: 3000, stunMs: 1100, domPct: 0.6, domSecs: 8 };
const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'nigg', 'fagg', 'retard', 'nazi'];
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = v => typeof v === 'number' && Number.isFinite(v);

function randInt(n) { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] % n; }
function randToken() { const a = new Uint8Array(16); globalThis.crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
function mask(text) { let t = text; for (const w of BAD) t = t.replace(new RegExp(w, 'gi'), m => '*'.repeat(m.length)); return t; }
function hasBad(text) { const l = text.toLowerCase().replace(/[^a-z]/g, ''); return BAD.some(w => l.includes(w)); }
function cleanText(s, max) { return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
export function unlocked(kind, id, herded) {
  const list = COSMETICS[kind];
  if (kind === 'color') return list.includes(id);
  const e = list.find(x => x[0] === id);
  return !!e && herded >= e[1];
}

// ---------------------------------------------------------------------------------------------
export class Hub {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.now = opts.now || (() => Date.now());
    this.minDuration = opts.minDuration ?? 30;
    this.maxRooms = opts.maxRooms ?? 500;
    this.createLog = new Map();
    this.nextConn = 1;
    this.stats = { roomsCreated: 0, started: Date.now() };
  }

  attach(conn) { conn.id = conn.id || this.nextConn++; conn.room = null; conn.player = null; conn.tokens = 90; conn.refill = this.now(); conn.strikes = 0; }

  _bucket(conn) {
    const t = this.now();
    conn.tokens = Math.min(90, conn.tokens + ((t - conn.refill) / 1000) * 70); conn.refill = t;
    if (conn.tokens < 1) { if (++conn.strikes > 400) conn.close?.(); return false; }
    conn.tokens -= 1; return true;
  }

  handle(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (!this._bucket(conn)) return;
    switch (msg.t) {
      case 'ping': conn.send({ t: 'pong', c: msg.c }); return;
      case 'create': return this._create(conn, msg);
      case 'join': return this._join(conn, msg);
      case 'quick': return this._quick(conn, msg);
    }
    if (!conn.room || !conn.player) return conn.send({ t: 'err', code: 'NOT_IN_ROOM', msg: 'You are not in a room.' });
    conn.room.handle(conn.player, msg);
  }

  close(conn) {
    const room = conn.room, p = conn.player;
    conn.room = null; conn.player = null;
    if (room && p && p.conn === conn) room.disconnect(p);
  }

  _leaveCurrent(conn) { if (conn.room && conn.player) conn.room.removePlayer(conn.player, 'left'); conn.room = null; conn.player = null; }

  _create(conn, msg) {
    this._leaveCurrent(conn);
    const t = this.now(), ip = conn.ip || 'local';
    const log = (this.createLog.get(ip) || []).filter(x => t - x < 60000);
    if (log.length >= 6 && !msg.practice) return conn.send({ t: 'err', code: 'RATE_LIMIT', msg: 'Too many rooms created. Try again in a minute.' });
    if (this.rooms.size >= this.maxRooms) return conn.send({ t: 'err', code: 'SERVER_BUSY', msg: 'The server is full right now. Try again soon.' });
    let code; do { code = Array.from({ length: 5 }, () => CODE_ALPHA[randInt(CODE_ALPHA.length)]).join(''); } while (this.rooms.has(code));
    const room = new Room(this, code, !!msg.practice); room.isPublic = !!msg.public && !msg.practice;
    const r = room.addPlayer(conn, msg);
    if (!r.ok) return conn.send({ t: 'err', code: r.code, msg: r.msg });
    log.push(t); this.createLog.set(ip, log);
    this.rooms.set(code, room); this.stats.roomsCreated++;
    if (msg.practice) {
      room.settings = { ...room.settings, maxPlayers: 1, soloAllowed: true, mode: 'ffa', difficulty: DIFFICULTY.includes(msg.difficulty) ? msg.difficulty : 'normal', flock: 'normal', storms: true, duration: 150 };
      room.broadcastRoom();
      room.startRound(room.hostId, true);
    }
  }

  // "Play Online": drop into an open public lobby, or open a new public room.
  _quick(conn, msg) {
    this._leaveCurrent(conn);
    const open = [...this.rooms.values()].filter(r => r.isPublic && !r.practice && r.phase === 'lobby' && !r.settings.locked && !r.dead &&
      [...r.players.values()].filter(p => p.connected).length >= 1 && r.players.size < r.settings.maxPlayers)
      .sort((a, b) => b.players.size - a.players.size)[0];
    if (open) return this._join(conn, { ...msg, code: open.code });
    this._create(conn, { ...msg, public: true });
  }

  _join(conn, msg) {
    this._leaveCurrent(conn);
    const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) return conn.send({ t: 'err', code: 'BAD_CODE', msg: 'Room codes are 5 characters.' });
    const room = this.rooms.get(code);
    if (!room) return conn.send({ t: 'err', code: 'NOT_FOUND', msg: 'That room does not exist or has closed.' });
    const r = room.addPlayer(conn, msg);
    if (!r.ok) conn.send({ t: 'err', code: r.code, msg: r.msg });
  }

  tick() {
    const t = this.now();
    for (const [code, room] of this.rooms) {
      room.tick(t);
      if (room.dead) this.rooms.delete(code);
    }
    for (const [ip, log] of this.createLog) if (!log.some(x => t - x < 60000)) this.createLog.delete(ip);
  }

  health() {
    let players = 0; for (const r of this.rooms.values()) for (const p of r.players.values()) if (p.connected) players++;
    return { ok: true, rooms: this.rooms.size, players, uptime: Math.round((Date.now() - this.stats.started) / 1000), roomsCreated: this.stats.roomsCreated };
  }
}
// ---------------------------------------------------------------------------------------------
class Room {
  constructor(hub, code, practice) {
    this.hub = hub; this.code = code; this.practice = practice;
    this.players = new Map(); this.nextId = 1; this.hostId = null;
    this.settings = { mode: 'ffa', duration: 180, difficulty: 'normal', flock: 'normal', storms: false, maxPlayers: LIMITS.maxPlayers, soloAllowed: false, locked: false };
    this.phase = 'lobby'; this.round = null; this.banned = new Set(); this.bannedIps = new Set(); this.roundCount = 0;
    this.lastSnap = 0; this.lastSheep = 0; this.lastTimer = 0; this.lastScores = 0; this.lastTick = 0; this.expireAt = 0; this.dead = false; this.snapSeq = 0; this.dirty = false; this.scoresDirty = false;
  }
  now() { return this.hub.now(); }

  // ----- membership -----
  addPlayer(conn, msg) {
    const token = typeof msg.token === 'string' && msg.token.length === 32 ? msg.token : null;
    const existing = token ? [...this.players.values()].find(p => p.token === token) : null;
    if (existing) { this._reattach(existing, conn); return { ok: true }; }
    if ((token && this.banned.has(token)) || (conn.ip && conn.ip !== 'local' && this.bannedIps.has(conn.ip))) return { ok: false, code: 'BANNED', msg: 'You were removed from this room by the host.' };
    if (this.settings.locked) return { ok: false, code: 'LOCKED', msg: 'This room is locked by the host.' };
    if ([...this.players.values()].length >= this.settings.maxPlayers) return { ok: false, code: 'FULL', msg: 'This room is full.' };
    const nm = this._uniqueName(msg.name);
    if (!nm.ok) return nm;
    const id = this.nextId++;
    const p = {
      id, token: randToken(), name: nm.name, conn, ip: conn.ip || null, connected: true, lastSeen: this.now(), joinedAt: this.now(), ready: false, team: null,
      cosm: { hat: 'none', bandana: 'red', victory: 'wag', color: COSMETICS.color[(id - 1) % COSMETICS.color.length] },
      stats: { score: 0, roundScore: 0, herded: 0, steals: 0, barks: 0, dashes: 0, bumps: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0 },
      slot: -1, pos: null, flags: 0, cd: { bark: 0, howl: 0, dash: 0 }, barkUntil: 0, howlUntil: 0, dashUntil: 0, dashDir: [0, 0], stunUntil: 0, stunAt: null,
      chat: { tokens: 4, t: this.now(), lastText: '', lastAt: 0 }, lastTp: 0, inRound: false, spawn: null,
    };
    this.players.set(id, p);
    conn.room = this; conn.player = p;
    if (this.hostId == null) this.hostId = id;
    conn.send({ t: 'joined', you: id, token: p.token, code: this.code, practice: this.practice });
    this.notice('join', `${p.name} joined`, p.id);
    if (this.round && this.phase !== 'results') this._lateJoin(p);
    this.broadcastRoom();
    this.expireAt = 0;
    return { ok: true };
  }
  _uniqueName(raw) {
    let name = cleanText(raw, LIMITS.nameMax);
    if (name.length < LIMITS.nameMin) name = 'Farmer' + (100 + randInt(900));
    if (hasBad(name)) return { ok: false, code: 'NAME_BAD', msg: 'That name is not allowed.' };
    const used = new Set([...this.players.values()].map(p => p.name.toLowerCase()));
    let out = name, n = 2;
    while (used.has(out.toLowerCase())) { const suf = ` (${n++})`; out = name.slice(0, LIMITS.nameMax - suf.length) + suf; }
    return { ok: true, name: out };
  }

  _reattach(p, conn) {
    if (p.conn && p.conn !== conn) { const old = p.conn; old.room = null; old.player = null; old.send?.({ t: 'err', code: 'REPLACED', msg: 'You connected from another tab.' }); old.close?.(); }
    p.conn = conn; p.connected = true; p.lastSeen = this.now(); conn.room = this; conn.player = p;
    conn.send({ t: 'joined', you: p.id, token: p.token, code: this.code, practice: this.practice, reconnected: true });
    this.notice('join', `${p.name} reconnected`, p.id);
    if (this.hostId == null || !this.players.get(this.hostId)?.connected) this._pickHost();
    if (this.round) this._sendRound(p, true);
    this.broadcastRoom();
    this.expireAt = 0;
  }

  disconnect(p) {
    p.connected = false; p.lastSeen = this.now(); p.conn = null;
    this.notice('leave', `${p.name} disconnected`, p.id);
    if (p.id === this.hostId) this._pickHost();
    this.broadcastRoom();
    if (![...this.players.values()].some(x => x.connected)) this.expireAt = this.now() + LIMITS.roomGraceMs;
  }

  removePlayer(p, why) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this.broadcast({ t: 'ev', k: 'gone', id: p.id });
    if (why !== 'quiet') this.notice('leave', `${p.name} ${why === 'kicked' ? 'was removed' : 'left'}`, p.id);
    if (p.conn) { p.conn.room = null; p.conn.player = null; }
    if (p.id === this.hostId) this._pickHost();
    if (!this.players.size) { this.dead = true; return; }
    if (![...this.players.values()].some(x => x.connected)) this.expireAt = this.now() + LIMITS.roomGraceMs;
    this.broadcastRoom();
  }

  _pickHost() {
    const next = [...this.players.values()].filter(p => p.connected).sort((a, b) => a.joinedAt - b.joinedAt || a.id - b.id)[0];
    if (next) { this.hostId = next.id; this.notice('info', `${next.name} is now the host`); }
    else this.hostId = [...this.players.values()][0]?.id ?? null;
  }

  // ----- messaging -----
  sendTo(p, msg) { if (p.connected && p.conn) p.conn.send(msg); }
  broadcast(msg, except = null) { for (const p of this.players.values()) if (p.id !== except) this.sendTo(p, msg); }
  notice(kind, text, who = null) { this.broadcast({ t: 'notice', kind, text, who }); }
  err(p, code, text) { this.sendTo(p, { t: 'err', code, msg: text }); }

  publicRoom() {
    return {
      t: 'room', code: this.code, hostId: this.hostId, phase: this.phase, practice: this.practice, isPublic: !!this.isPublic, settings: this.settings,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready, team: p.team, connected: p.connected, cosm: p.cosm, host: p.id === this.hostId, score: p.stats.score, roundScore: p.stats.roundScore, herded: p.stats.herded, wins: p.stats.wins })),
    };
  }
  broadcastRoom() { this.broadcast(this.publicRoom()); }

  // ----- command handling -----
  handle(p, m) {
    const host = p.id === this.hostId;
    switch (m.t) {
      case 'leave': return this.removePlayer(p, 'left');
      case 'ready': if (this.phase === 'lobby' || this.phase === 'results') { p.ready = !!m.v; this.broadcastRoom(); } return;
      case 'name': {
        if (this._busy()) return this.err(p, 'BUSY', 'You can only rename between rounds.');
        const old = p.name; p.name = '';
        const r = this._uniqueName(m.name); if (!r.ok) { p.name = old; return this.err(p, r.code, r.msg); }
        p.name = r.name; return this.broadcastRoom();
      }
      case 'cosmetic': return this._cosmetic(p, m);
      case 'chat': return this._chat(p, m);
      case 'settings': return host ? this._settings(p, m) : this.err(p, 'NOT_HOST', 'Only the host can change settings.');
      case 'lock': if (!host) return this.err(p, 'NOT_HOST', 'Only the host can lock the room.'); this.settings.locked = !!m.v; return this.broadcastRoom();
      case 'kick': return host ? this._kick(p, m) : this.err(p, 'NOT_HOST', 'Only the host can remove players.');
      case 'start': return host ? this.startRound(p.id, false) : this.err(p, 'NOT_HOST', 'Only the host can start the match.');
      case 'toLobby': if (!host) return this.err(p, 'NOT_HOST', 'Only the host can do that.'); return this.toLobby();
      case 'pos': return this._pos(p, m);
      case 'respawn': return this._respawn(p);
      case 'bark': return this._bark(p);
      case 'dash': return this._dash(p);
      case 'howl': return this._howl(p);
    }
  }
  _busy() { return this.phase === 'playing' || this.phase === 'countdown'; }

  _cosmetic(p, m) {
    if (this._busy()) return this.err(p, 'BUSY', 'Change your look between rounds.');
    for (const k of Object.keys(COSMETICS)) {
      if (m[k] === undefined) continue;
      if (!unlocked(k, String(m[k]), p.stats.herded)) { this.err(p, 'LOCKED_ITEM', 'That item is not unlocked yet. Herd more sheep this session.'); continue; }
      p.cosm[k] = String(m[k]);
    }
    this.broadcastRoom();
  }

  _chat(p, m) {
    const t = this.now(), c = p.chat;
    c.tokens = Math.min(4, c.tokens + ((t - c.t) / 1000) * 1.25); c.t = t;
    if (c.tokens < 1) return this.err(p, 'CHAT_RATE', 'Slow down!');
    const text = mask(cleanText(m.text, LIMITS.chatMax));
    if (!text) return;
    if (text === c.lastText && t - c.lastAt < 3000) return;
    c.tokens -= 1; c.lastText = text; c.lastAt = t;
    this.broadcast({ t: 'chat', id: p.id, name: p.name, text, ts: t });
  }

  _settings(p, m) {
    if (this._busy()) return this.err(p, 'BUSY', 'Settings can change between rounds.');
    const s = this.settings;
    if (m.mode !== undefined && MODES[m.mode]) s.mode = m.mode;
    if (num(m.duration)) s.duration = clamp(Math.round(m.duration), this.hub.minDuration, 600);
    if (DIFFICULTY.includes(m.difficulty)) s.difficulty = m.difficulty;
    if (m.flock !== undefined && m.flock in FLOCKS) s.flock = m.flock;
    if (m.storms !== undefined) s.storms = !!m.storms;
    if (num(m.maxPlayers) && !this.practice) s.maxPlayers = clamp(Math.round(m.maxPlayers), Math.max(2, this.players.size), LIMITS.maxPlayers);
    if (m.soloAllowed !== undefined) s.soloAllowed = !!m.soloAllowed;
    this.broadcastRoom();
  }

  _kick(host, m) {
    const t = this.players.get(m.id);
    if (!t || t.id === host.id) return this.err(host, 'BAD_TARGET', 'You cannot remove that player.');
    this.banned.add(t.token); if (t.ip && t.ip !== 'local') this.bannedIps.add(t.ip);
    this.sendTo(t, { t: 'kicked', msg: 'The host removed you from the room.' });
    const c = t.conn; this.removePlayer(t, 'kicked'); c?.close?.();
  }

  toLobby() {
    if (this.phase !== 'results') return;
    this.phase = 'lobby'; this.round = null;
    for (const p of this.players.values()) { p.ready = false; p.pos = null; p.slot = -1; p.inRound = false; p.stats.roundScore = 0; }
    this.broadcast({ t: 'lobby' }); this.broadcastRoom();
  }

  // ----- round lifecycle -----
  startRound(hostId, force) {
    const host = this.players.get(hostId);
    if (!host) return;
    if (this.phase !== 'lobby' && this.phase !== 'results') return this.err(host, 'BUSY', 'A round is already running.');
    const s = this.settings, mode = MODES[s.mode];
    const live = [...this.players.values()].filter(p => p.connected);
    const min = s.soloAllowed || force ? 1 : mode.min;
    if (live.length < min) return this.err(host, 'TOO_FEW', `Need at least ${mode.min} players, or enable solo rounds in the lobby settings.`);
    if (this.phase === 'lobby' && !force) {
      const waiting = live.filter(p => p.id !== this.hostId && !p.ready);
      if (waiting.length) return this.err(host, 'NOT_READY', `Waiting for ${waiting.map(p => p.name).join(', ')} to ready up.`);
    }
    const seed = (randInt(0xffffffff) + 1) >>> 0, team = s.mode === 'team';
    const flockMul = FLOCKS[s.flock] * (s.mode === 'stampede' ? 1.3 : 1);
    const nPens = team ? 2 : clamp(live.length, 1, 12);
    const fp = { mode: team ? 'team' : 'ffa', pens: team ? live.length : nPens, sheep: sheepCountFor(live.length, flockMul, 1) };
    const field = generateField(seed, fp);
    const sim = new FlockSim(field, { seed, difficulty: s.difficulty });
    this.roundCount++;
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const r = this.round = {
      id: this.roundCount, seed, mode: s.mode, fp, field, sim, rng, duration: s.duration, acc: 0, phaseEnd: 0, endsAt: 0, over: false, participants: new Set(),
      storms: s.mode === 'stampede' || s.storms, stormAt: 0, stormWarned: false, dom: null, solo: live.length === 1, startedAt: 0, lastDomCheck: 0,
    };
    for (const p of this.players.values()) { p.stats.roundScore = 0; p.pos = null; p.inRound = false; p.team = null; p.slot = -1; p.stunUntil = 0; p.dashUntil = 0; p.cd = { bark: 0, howl: 0, dash: 0 }; }
    const order = live.slice().sort(() => rng() - 0.5), seen = [0, 0];
    order.forEach((p, i) => {
      let sp;
      if (team) { p.team = i % 2; p.slot = p.team; const pen = field.pens[p.slot], k = seen[p.slot]++, off = (k - 2.5) * 2.4; sp = { x: pen.spawn.x + pen.u[0] * off, z: pen.spawn.z + pen.u[1] * off, yaw: pen.spawn.yaw }; }
      else { p.slot = i; sp = field.pens[i].spawn; }
      this._assign(p, sp); r.participants.add(p.id);
    });
    this.phase = 'countdown'; r.phaseEnd = this.now() + LIMITS.countdownMs; this.lastTick = this.now();
    for (const p of this.players.values()) this._sendRound(p);
    this.broadcastRoom();
  }

  _assign(p, sp) { p.spawn = { x: sp.x, z: sp.z, yaw: sp.yaw }; p.pos = { x: sp.x, z: sp.z, yaw: sp.yaw, t: this.now() }; p.flags = 0; p.inRound = true; }

  _lateJoin(p) {
    const r = this.round; if (r.over) return;
    if (r.mode === 'team') {
      const c = [0, 0]; for (const q of this.players.values()) if (q !== p && q.team != null && q.connected) c[q.team]++;
      p.team = c[0] <= c[1] ? 0 : 1; p.slot = p.team; const pen = r.field.pens[p.slot];
      this._assign(p, { x: pen.spawn.x + pen.u[0] * (c[p.team] * 2.4 - 6), z: pen.spawn.z + pen.u[1] * (c[p.team] * 2.4 - 6), yaw: pen.spawn.yaw }); r.participants.add(p.id);
    } else {
      const used = new Set([...this.players.values()].filter(q => q !== p && q.slot >= 0).map(q => q.slot));
      const free = r.field.pens.find(pen => !used.has(pen.slot));
      if (free) { p.slot = free.slot; this._assign(p, free.spawn); r.participants.add(p.id); } // else: watch this round, play the next
    }
    this._sendRound(p);
  }

  _sendRound(p, reconnect = false) {
    const r = this.round; if (!r) return;
    const teams = {}, slots = {};
    for (const q of this.players.values()) { if (q.team != null) teams[q.id] = q.team; if (q.slot >= 0) slots[q.id] = q.slot; }
    this.sendTo(p, {
      t: 'round', practice: this.practice, id: r.id, seed: r.seed, mode: r.mode, field: r.fp, phase: this.phase, duration: r.duration, remainingMs: this._remaining(), phaseMs: Math.max(0, r.phaseEnd - this.now()),
      slots, teams, storms: r.storms, solo: r.solo, difficulty: this.settings.difficulty, you: { slot: p.slot, team: p.team, spawn: p.pos ? { x: p.pos.x, z: p.pos.z, yaw: p.pos.yaw } : null, spectator: !p.inRound },
    });
    if (reconnect || this.phase !== 'countdown') { this.sendTo(p, { t: 'sheep', k: 0, s: r.sim.encode() }); this.sendTo(p, this._scores()); }
  }

  _remaining() { const r = this.round; if (!r) return 0; if (this.phase === 'playing') return Math.max(0, r.endsAt - this.now()); return r.duration * 1000; }

  _beginPlaying() {
    const r = this.round, t = this.now(); this.phase = 'playing'; r.endsAt = t + r.duration * 1000; r.phaseEnd = r.endsAt; r.startedAt = t; this.lastTick = t;
    r.stormAt = r.storms ? t + 16000 + r.rng() * 4000 : 0;
    for (const p of this.players.values()) if (p.pos) p.pos.t = t;
    this.broadcast({ t: 'phase', phase: 'playing', remainingMs: r.duration * 1000 });
    this.broadcastRoom();
  }

  tick(t) {
    for (const p of this.players.values()) if (!p.connected && t - p.lastSeen > LIMITS.playerGraceMs) this.removePlayer(p, 'quiet');
    if (this.dead) return;
    if (this.expireAt && t > this.expireAt) { this.dead = true; return; }
    const r = this.round;
    if (r && !r.over) {
      if (this.phase === 'countdown' && t >= r.phaseEnd) this._beginPlaying();
      else if (this.phase === 'playing') {
        if (t >= r.endsAt) this._end('timeout');
        else this._simulate(t);
      }
      if (!r.over && t - this.lastTimer >= 1000) { this.lastTimer = t; this.broadcast({ t: 'timer', phase: this.phase, remainingMs: this.phase === 'playing' ? Math.max(0, r.endsAt - t) : Math.max(0, r.phaseEnd - t) }); }
    }
    if (this.round && !this.round.over && this.dirty && t - this.lastSnap >= 60) this._snapshot(t);
  }

  _dogs(t) {
    const out = [];
    for (const p of this.players.values()) if (p.connected && p.inRound && p.pos) out.push({ id: p.id, x: p.pos.x, z: p.pos.z, yaw: p.pos.yaw, sprinting: !!(p.flags & 2), dashing: t < p.dashUntil, p });
    return out;
  }

  _simulate(t) {
    const r = this.round, sim = r.sim, T = TUNING;
    r.acc += Math.min(0.5, Math.max(0, (t - this.lastTick) / 1000)); this.lastTick = t;
    let n = 0;
    while (r.acc >= T.step && n < 6) {
      r.acc -= T.step; n++;
      const dogs = this._dogs(t);
      for (const d of dogs) {
        if (!d.dashing) continue;
        const dir = d.p.dashDir; sim.dashHit(d, dir[0], dir[1]);
        for (const o of dogs) if (o !== d && !o.dashing && t >= o.p.stunUntil && Math.hypot(o.x - d.x, o.z - d.z) < 1.5) this._stun(o.p, d.p, t);
      }
      this._pens(sim.step(T.step, dogs), t);
    }
    if (r.acc > T.step * 6) r.acc = 0;
    if (r.storms && r.stormAt) {
      if (!r.stormWarned && t >= r.stormAt - 3000) { r.stormWarned = true; this.broadcast({ t: 'ev', k: 'thunder_warn' }); }
      if (t >= r.stormAt) { sim.thunder(); this.broadcast({ t: 'ev', k: 'thunder' }); r.stormWarned = false; r.stormAt = t + 18000 + r.rng() * 8000; }
    }
    if (t - this.lastSheep >= 100) { this.lastSheep = t; this.broadcast({ t: 'sheep', k: ++this.snapSeq, s: sim.encode() }); }
    if (t - r.lastDomCheck >= 500) { r.lastDomCheck = t; this._checkDominance(t); }
    if (this.scoresDirty || t - this.lastScores >= 1000) { this.lastScores = t; this.scoresDirty = false; this.broadcast(this._scores()); }
  }

  _stun(victim, by, t) {
    victim.stunUntil = t + LIMITS.stunMs; victim.stunAt = { x: victim.pos.x, z: victim.pos.z }; by.stats.bumps++;
    this.sendTo(victim, { t: 'fx', k: 'stun', ms: LIMITS.stunMs });
    this.broadcast({ t: 'ev', k: 'bump', id: by.id, victim: victim.id, name: victim.name, byName: by.name });
  }

  _owners(slot) { return [...this.players.values()].filter(p => p.slot === slot && p.inRound); }

  _pens(events, t) {
    const r = this.round;
    for (const e of events) {
      if (e.to < 0) continue;
      const s = r.sim.sheep[e.sheep], by = this.players.get(e.by), stolen = e.from >= 0;
      if (by && by.slot === e.to) { if (stolen) by.stats.steals++; else by.stats.herded++; }
      this.broadcast({ t: 'ev', k: stolen ? 'stolen' : 'penned', sheep: e.sheep, slot: e.to, from: e.from, by: e.by, byName: by?.name || null, type: s.type, value: s.value });
      this.scoresDirty = true;
    }
  }

  _scores() {
    const r = this.round, sim = r.sim, pens = r.field.pens.map(p => [p.slot, sim.penValue(p.slot), sim.penCount(p.slot)]);
    const players = [];
    for (const p of this.players.values()) {
      if (p.slot >= 0) p.stats.roundScore = sim.penValue(p.slot);
      players.push([p.id, p.stats.roundScore, p.stats.herded, p.stats.steals]);
    }
    const d = r.dom && this.phase === 'playing' ? { slot: r.dom.slot, left: Math.max(0, Math.round((r.dom.need - (this.now() - r.dom.since)) / 100) / 10) } : null;
    return { t: 'scores', pens, players, total: sim.totalValue(), dom: d };
  }

  _checkDominance(t) {
    const r = this.round, sim = r.sim, total = sim.totalValue();
    let best = -1, bv = 0;
    for (const pen of r.field.pens) { const v = sim.penValue(pen.slot); if (v > bv) { bv = v; best = pen.slot; } }
    const thr = r.solo ? 1 : LIMITS.domPct, need = (r.solo ? 2 : LIMITS.domSecs) * 1000;
    if (best >= 0 && bv / total >= thr - 1e-9) {
      if (!r.dom || r.dom.slot !== best) { r.dom = { slot: best, since: t, need }; this.broadcast({ t: 'ev', k: 'dominating', slot: best, secs: need / 1000, owner: r.mode === 'team' ? ['Red team', 'Blue team'][best] : (this._owners(best)[0]?.name || 'A dog') }); }
      if (t - r.dom.since >= need) this._end('domination');
    } else if (r.dom) { r.dom = null; this.broadcast({ t: 'ev', k: 'dom_broken' }); }
  }

  _snapshot(t) {
    this.lastSnap = t; this.dirty = false;
    const list = [];
    for (const p of this.players.values()) if (p.connected && p.pos && p.inRound) {
      const q = p.pos;
      const fl = (p.flags & 3) | (t < p.barkUntil ? 4 : 0) | (t < p.dashUntil ? 8 : 0) | (t < p.stunUntil ? 16 : 0) | (mudAt(this.round.field, q.x, q.z) ? 32 : 0) | (t < p.howlUntil ? 64 : 0);
      list.push([p.id, +q.x.toFixed(2), +q.z.toFixed(2), +q.yaw.toFixed(2), fl]);
    }
    if (list.length) this.broadcast({ t: 'snap', p: list });
  }

  // ----- movement & abilities -----
  _pos(p, m) {
    const r = this.round;
    if (!r || r.over || !p.pos || !p.inRound || this.phase !== 'playing') return;
    if (![m.x, m.z, m.yaw].every(num)) return;
    const t = this.now(), dt = clamp((t - p.pos.t) / 1000, 0.02, 1);
    if (t < p.stunUntil) { p.pos.t = t; if (p.stunAt && t - p.lastTp > 250) { p.lastTp = t; this.sendTo(p, { t: 'tp', x: p.stunAt.x, z: p.stunAt.z }); } return; }
    let x = m.x, z = m.z;
    const dx = x - p.pos.x, dz = z - p.pos.z, dist = Math.hypot(dx, dz), maxD = (t < p.dashUntil + 150 ? TUNING.dashSpeed : TUNING.dogSprint) * 1.35 * dt + 0.5;
    let clipped = false;
    if (dist > maxD) { const k = maxD / dist; x = p.pos.x + dx * k; z = p.pos.z + dz * k; clipped = true; }
    const c = resolveCollision(r.field, x, z, DOG_RADIUS); x = c.x; z = c.z;
    p.pos = { x, z, yaw: m.yaw, t }; p.flags = (m.f | 0) & 3; p.lastSeen = t; this.dirty = true;
    if (clipped && t - p.lastTp > 300) { p.lastTp = t; this.sendTo(p, { t: 'tp', x, z }); }
  }

  _respawn(p) {
    const r = this.round; if (!r || r.over || !p.inRound || this.phase !== 'playing') return;
    const sp = p.spawn; p.pos = { x: sp.x, z: sp.z, yaw: sp.yaw, t: this.now() };
    this.sendTo(p, { t: 'tp', x: sp.x, z: sp.z, yaw: sp.yaw, hard: true }); this.dirty = true;
  }

  _canAct(p) { const r = this.round; return r && !r.over && this.phase === 'playing' && p.inRound && p.pos && this.now() >= p.stunUntil; }

  _bark(p) {
    if (!this._canAct(p)) return; const t = this.now();
    if (t < p.cd.bark) return;
    p.cd.bark = t + TUNING.barkCooldown * 950; p.barkUntil = t + 450; p.stats.barks++;
    const n = this.round.sim.bark({ id: p.id, x: p.pos.x, z: p.pos.z, yaw: p.pos.yaw });
    this.broadcast({ t: 'ev', k: 'bark', id: p.id, n }); this.dirty = true;
  }
  _howl(p) {
    if (!this._canAct(p)) return; const t = this.now();
    if (t < p.cd.howl) return;
    p.cd.howl = t + TUNING.howlCooldown * 950; p.howlUntil = t + 700;
    const n = this.round.sim.howl({ id: p.id, x: p.pos.x, z: p.pos.z });
    this.broadcast({ t: 'ev', k: 'howl', id: p.id, n }); this.dirty = true;
  }
  _dash(p) {
    if (!this._canAct(p)) return; const t = this.now();
    if (t < p.cd.dash) return;
    p.cd.dash = t + TUNING.dashCooldown * 950; p.dashUntil = t + TUNING.dashDuration * 1000; p.dashDir = forward(p.pos.yaw); p.stats.dashes++;
    this.broadcast({ t: 'ev', k: 'dash', id: p.id }); this.dirty = true;
  }

  // ----- results -----
  _end(reason) {
    const r = this.round; if (r.over) return;
    r.over = true; this.phase = 'results';
    const sim = r.sim, team = r.mode === 'team';
    for (const p of this.players.values()) if (p.slot >= 0) p.stats.roundScore = sim.penValue(p.slot);
    const parts = [...this.players.values()].filter(p => r.participants.has(p.id));
    let winners = [], winnerTeam = null;
    const teamScores = team ? [sim.penValue(0), sim.penValue(1)] : null;
    if (r.solo) { if (sim.penValue(0) >= sim.totalValue()) winners = parts.map(p => p.id); }
    else if (team) { if (teamScores[0] !== teamScores[1]) { winnerTeam = teamScores[0] > teamScores[1] ? 0 : 1; winners = parts.filter(p => p.team === winnerTeam).map(p => p.id); } }
    else { const top = Math.max(0, ...parts.map(p => p.stats.roundScore)); if (top > 0) winners = parts.filter(p => p.stats.roundScore === top).map(p => p.id); }
    for (const p of parts) {
      p.stats.score += p.stats.roundScore;
      if (winners.includes(p.id)) { p.stats.wins++; p.stats.streak++; p.stats.bestStreak = Math.max(p.stats.bestStreak, p.stats.streak); }
      else { p.stats.losses++; p.stats.streak = 0; }
    }
    const standings = parts.map(p => ({ id: p.id, name: p.name, team: p.team, slot: p.slot, roundScore: p.stats.roundScore, score: p.stats.score, herded: p.stats.herded, steals: p.stats.steals, barks: p.stats.barks, dashes: p.stats.dashes, bumps: p.stats.bumps, wins: p.stats.wins, losses: p.stats.losses, bestStreak: p.stats.bestStreak, win: winners.includes(p.id) }))
      .sort((a, b) => b.roundScore - a.roundScore || b.herded - a.herded);
    const penned = sim.sheep.filter(s => s.pen >= 0).length;
    this.broadcast({ t: 'results', reason, mode: r.mode, winners, winnerTeam, teamScores, teamScore: teamScores, pens: r.field.pens.map(p => [p.slot, sim.penValue(p.slot), sim.penCount(p.slot)]), secs: Math.round((this.now() - r.startedAt) / 1000), solo: r.solo, standings, penned, sheep: sim.sheep.length, total: sim.totalValue(), timeSecs: Math.round((this.now() - r.startedAt) / 1000), roundId: r.id });
    this.broadcastRoom();
  }
}
