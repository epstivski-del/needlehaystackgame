// Authoritative game engine for NEEDLE IN A HAYSTACK.
// Pure ES module: it runs in Node behind the WebSocket server AND in the browser for offline Practice Mode.
// Clients never decide scores, pickups or round results; they send intents and the engine validates them.

import { generateWorld, mulberry32, pileAt, pickHiddenSpot, isReachable, MAPS, SPRINT_SPEED } from './world.js';

export const MODES = {
  classic:  { label: 'Classic Hunt',    min: 2, desc: 'One needle. First to claim it wins.' },
  team:     { label: 'Team Hunt',       min: 2, desc: 'Two teams, one needle each. First team to find theirs wins.' },
  golden:   { label: 'Golden Needle',   min: 2, desc: 'Huge arena, weak hints, one golden needle worth 250.' },
  endless:  { label: 'Endless Search',  min: 2, desc: 'A new needle after every find. Highest score when time runs out.' },
  hideseek: { label: 'Hide and Seek',   min: 2, desc: 'One player hides the needle. Everyone else hunts it.' },
};
export const DIFFICULTY = { easy: 1.6, normal: 2.4, hard: 3.4 }; // seconds per search
export const DET_RANGE = { off: 0, weak: 12, normal: 20, strong: 30 };
export const DECOYS = {
  nail:  { metal: true,  pts: 5 },  twig: { metal: false, pts: 5 },  wire: { metal: true, pts: 8 },
  bolt:  { metal: true,  pts: 8 },  scrap: { metal: true, pts: 10 }, tool: { metal: true, pts: 12 },
  coin:  { metal: true,  pts: 15 },
};
export const COSMETICS = {
  hat:     [['none', 0], ['straw', 0], ['cap', 0], ['cowboy', 1], ['tophat', 3]],
  jacket:  [['none', 0], ['overalls', 0], ['plaid', 0], ['vest', 2]],
  gloves:  [['none', 0], ['work', 0], ['leather', 2]],
  boots:   [['plain', 0], ['rubber', 0], ['cowboy', 3]],
  skin:    [['brass', 0], ['chrome', 2], ['neon', 4]],
  victory: [['wave', 0], ['spin', 2], ['dance', 5]],
  color:   ['#c0392b', '#d68910', '#27ae60', '#2980b9', '#8e44ad', '#16a085', '#e67e22', '#7f8c8d', '#e84393', '#2d3436', '#f1c40f', '#00b894'],
};
export const LIMITS = { maxPlayers: 12, nameMin: 2, nameMax: 16, chatMax: 160, roomGraceMs: 120000, playerGraceMs: 45000, countdownMs: 3000, setupMs: 20000 };

const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'nigg', 'fagg', 'retard', 'nazi'];
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = v => typeof v === 'number' && Number.isFinite(v);

function randInt(n) { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] % n; }
function randToken() { const a = new Uint8Array(16); globalThis.crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
function mask(text) { let t = text; for (const w of BAD) t = t.replace(new RegExp(w, 'gi'), m => '*'.repeat(m.length)); return t; }
function hasBad(text) { const l = text.toLowerCase().replace(/[^a-z]/g, ''); return BAD.some(w => l.includes(w)); }
function cleanText(s, max) { return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }

export function unlocked(kind, id, needles) {
  const list = COSMETICS[kind];
  if (kind === 'color') return list.includes(id);
  const e = list.find(x => x[0] === id);
  return !!e && needles >= e[1];
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
      room.settings = { ...room.settings, maxPlayers: 1, soloAllowed: true, mode: 'classic', difficulty: ['easy', 'normal', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'normal', detector: 'normal', duration: 900 };
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
    this.settings = { mode: 'classic', map: 'hayfield', duration: 300, difficulty: 'normal', detector: 'normal', maxPlayers: LIMITS.maxPlayers, soloAllowed: false, locked: false };
    this.phase = 'lobby'; this.round = null; this.banned = new Set(); this.bannedIps = new Set(); this.roundCount = 0; this.hiderCursor = 0;
    this.lastSnap = 0; this.lastTimer = 0; this.lastDet = 0; this.expireAt = 0; this.dead = false; this.snapSeq = 0; this.dirty = false;
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
      cosm: { hat: 'straw', jacket: 'overalls', gloves: 'work', boots: 'plain', skin: 'brass', victory: 'wave', color: COSMETICS.color[(id - 1) % COSMETICS.color.length] },
      stats: { score: 0, roundScore: 0, needles: 0, searches: 0, okSearches: 0, searchMs: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, decoys: 0 },
      pos: null, flags: 0, search: null, lastSearchAt: 0, det: { on: false, battery: 100, last: -1, lastSent: 0 }, exposed: new Set(),
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
    if (this.round) this._sendRound(p);
    this.broadcastRoom();
    this.expireAt = 0;
  }

  disconnect(p) {
    p.connected = false; p.lastSeen = this.now(); p.conn = null; p.search = null; p.det.on = false;
    this.broadcast({ t: 'ev', k: 'search_stop', id: p.id });
    this.notice('leave', `${p.name} disconnected`, p.id);
    if (p.id === this.hostId) this._pickHost();
    this.broadcastRoom();
    if (![...this.players.values()].some(x => x.connected)) this.expireAt = this.now() + LIMITS.roomGraceMs;
  }

  removePlayer(p, why) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this.broadcast({ t: 'ev', k: 'search_stop', id: p.id });
    this.broadcast({ t: 'ev', k: 'gone', id: p.id });
    if (why !== 'quiet') this.notice('leave', `${p.name} ${why === 'kicked' ? 'was removed' : 'left'}`, p.id);
    if (p.conn) { p.conn.room = null; p.conn.player = null; }
    if (p.id === this.hostId) this._pickHost();
    if (this.round && this.round.hiderId === p.id && this.phase === 'setup') this._autoPlaceNeedle();
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
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready, team: p.team, connected: p.connected, cosm: p.cosm, host: p.id === this.hostId, score: p.stats.score, roundScore: p.stats.roundScore, needles: p.stats.needles, wins: p.stats.wins })),
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
        if (this.phase === 'playing' || this.phase === 'setup' || this.phase === 'countdown') return this.err(p, 'BUSY', 'You can only rename between rounds.');
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
      case 'search_start': return this._searchStart(p);
      case 'search_cancel': return this._searchCancel(p);
      case 'search_finish': return this._searchFinish(p);
      case 'pickup': return this._pickup(p, m);
      case 'detector': return this._detector(p, m);
      case 'place_needle': return this._placeNeedle(p);
    }
  }

  _cosmetic(p, m) {
    if (this.phase === 'playing' || this.phase === 'setup' || this.phase === 'countdown') return this.err(p, 'BUSY', 'Change your look between rounds.');
    for (const k of Object.keys(COSMETICS)) {
      if (m[k] === undefined) continue;
      if (!unlocked(k, String(m[k]), p.stats.needles)) { this.err(p, 'LOCKED_ITEM', 'That item is not unlocked yet. Find more needles this session.'); continue; }
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
    if (this.phase === 'playing' || this.phase === 'setup' || this.phase === 'countdown') return this.err(p, 'BUSY', 'Settings can change between rounds.');
    const s = this.settings;
    if (m.mode !== undefined && MODES[m.mode]) s.mode = m.mode;
    if (m.map !== undefined && MAPS[m.map] && !MAPS[m.map].goldenOnly) s.map = m.map;
    if (num(m.duration)) s.duration = clamp(Math.round(m.duration), this.hub.minDuration, 900);
    if (DIFFICULTY[m.difficulty]) s.difficulty = m.difficulty;
    if (m.detector !== undefined && m.detector in DET_RANGE) s.detector = m.detector;
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
    for (const p of this.players.values()) { p.ready = false; p.pos = null; p.exposed.clear(); p.search = null; p.det.on = false; p.stats.roundScore = 0; }
    this.broadcast({ t: 'lobby' }); this.broadcastRoom();
  }

  // ----- round lifecycle -----
  startRound(hostId, force) {
    const host = this.players.get(hostId);
    if (!host) return;
    if (this.phase !== 'lobby' && this.phase !== 'results') return this.err(host, 'BUSY', 'A round is already running.');
    const s = this.settings, mode = MODES[s.mode];
    const live = [...this.players.values()].filter(p => p.connected);
    const min = s.mode === 'hideseek' ? 2 : (s.soloAllowed || force ? 1 : mode.min);
    if (live.length < min) return this.err(host, 'TOO_FEW', s.mode === 'hideseek' ? 'Hide and Seek needs at least 2 players.' : `Need at least ${mode.min} players, or enable solo rounds in the lobby settings.`);
    if (this.phase === 'lobby' && !force) {
      const waiting = live.filter(p => p.id !== this.hostId && !p.ready);
      if (waiting.length) return this.err(host, 'NOT_READY', `Waiting for ${waiting.map(p => p.name).join(', ')} to ready up.`);
    }
    const seed = (randInt(0xffffffff) + 1) >>> 0;
    const mapId = s.mode === 'golden' ? 'goldenfield' : s.map;
    const world = generateWorld(seed, mapId);
    const rng = mulberry32(seed ^ 0x9e3779b9);
    this.roundCount++;
    const r = this.round = {
      id: this.roundCount, seed, mapId, mode: s.mode, world, rng, duration: s.duration, searchSecs: DIFFICULTY[s.difficulty] * (s.mode === 'golden' ? 1.35 : 1),
      items: [], needles: [], nextItem: 1, hiderId: null, phaseEnd: 0, endsAt: 0, over: false, participants: new Set(), placed: false, found: 0,
    };
    for (const p of this.players.values()) { p.stats.roundScore = 0; p.exposed.clear(); p.search = null; p.det = { on: false, battery: 100, last: -1, lastSent: 0 }; p.pos = null; p.inRound = false; p.team = null; }
    // Teams / roles / spawns
    const order = live.slice().sort(() => rng() - 0.5);
    if (s.mode === 'team') order.forEach((p, i) => { p.team = i % 2; });
    if (s.mode === 'hideseek') { const cands = live.slice().sort((a, b) => a.id - b.id); r.hiderId = cands[this.hiderCursor++ % cands.length].id; }
    const spawnOrder = world.spawns.map((_, i) => i).sort(() => rng() - 0.5);
    let si = 0;
    for (const p of order) { this._assign(p, world.spawns[spawnOrder[si++ % spawnOrder.length]]); r.participants.add(p.id); }
    this._placeItems();
    this.phase = 'countdown'; r.phaseEnd = this.now() + LIMITS.countdownMs;
    for (const p of this.players.values()) this._sendRound(p);
    this.broadcastRoom();
  }

  _assign(p, sp) { p.spawn = { x: sp.x, z: sp.z, yaw: sp.yaw }; p.pos = { x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, pitch: 0, t: this.now() }; p.flags = 0; p.inRound = true; }

  _lateJoin(p) {
    const r = this.round; if (r.over) return;
    if (this.settings.mode === 'team') { const c = [0, 0]; for (const q of this.players.values()) if (q !== p && q.team != null && q.connected) c[q.team]++; p.team = c[0] <= c[1] ? 0 : 1; }
    const sp = r.world.spawns[randInt(r.world.spawns.length)];
    this._assign(p, sp); r.participants.add(p.id);
    this._sendRound(p);
  }

  _sendRound(p) {
    const r = this.round; if (!r) return;
    const teams = {}; for (const q of this.players.values()) if (q.team != null) teams[q.id] = q.team;
    this.sendTo(p, {
      t: 'round', id: r.id, seed: r.seed, map: r.mapId, mode: r.mode, phase: this.phase, duration: r.duration, searchMs: Math.round(r.searchSecs * 1000),
      remainingMs: this._remaining(), phaseMs: Math.max(0, r.phaseEnd - this.now()), hiderId: r.hiderId, teams, you: { team: p.team, spawn: p.pos ? { x: p.pos.x, z: p.pos.z, yaw: p.pos.yaw } : p.spawn, hider: r.hiderId === p.id },
      detector: this.settings.detector !== 'off' && r.hiderId !== p.id, battery: Math.round(p.det.battery),
    });
    for (const n of r.needles) if (p.exposed.has(n.id) && !n.taken) this.sendTo(p, { t: 'reveal', kind: 'needle', id: n.id, x: n.x, z: n.z, golden: n.golden });
  }

  _remaining() { const r = this.round; if (!r) return 0; if (this.phase === 'playing') return Math.max(0, r.endsAt - this.now()); return r.duration * 1000; }

  _placeItems() {
    const r = this.round, w = r.world, taken = [];
    for (const pile of w.piles) {
      const n = (x => x < 0.3 ? 0 : x < 0.7 ? 1 : 2)(r.rng());
      for (let i = 0; i < n; i++) {
        const spot = pickHiddenSpot(w, r.rng, taken, p => p.id === pile.id); if (!spot) continue;
        const types = Object.keys(DECOYS), type = types[Math.floor(r.rng() * types.length)];
        const it = { id: r.nextItem++, type, metal: DECOYS[type].metal, points: DECOYS[type].pts, x: spot.x, z: spot.z, pile: spot.pile, taken: false };
        r.items.push(it); taken.push(it);
      }
    }
    if (r.mode === 'hideseek') return; // the hider places the needle
    const far = (list, d) => p => list.every(s => Math.hypot(s.x - p.x, s.z - p.z) >= d);
    if (r.mode === 'team') {
      const a = pickHiddenSpot(w, r.rng, taken); r.needles.push({ id: 1, team: 0, x: a.x, z: a.z, pile: a.pile, golden: false, taken: false });
      const b = pickHiddenSpot(w, r.rng, [...taken, a], far([a], w.half * 0.6)) || pickHiddenSpot(w, r.rng, [...taken, a]);
      r.needles.push({ id: 2, team: 1, x: b.x, z: b.z, pile: b.pile, golden: false, taken: false });
    } else {
      const golden = r.mode === 'golden';
      const filt = golden ? far(w.spawns, w.half * 0.5) : null;
      const a = pickHiddenSpot(w, r.rng, taken, filt) || pickHiddenSpot(w, r.rng, taken);
      r.needles.push({ id: 1, team: null, x: a.x, z: a.z, pile: a.pile, golden, taken: false });
    }
    r.nextNeedle = r.needles.length + 1;
  }

  _beginPlaying() {
    const r = this.round; this.phase = 'playing'; r.endsAt = this.now() + r.duration * 1000; r.phaseEnd = r.endsAt;
    for (const p of this.players.values()) if (p.pos) p.pos.t = this.now(); // movement timing restarts when play begins
    this.broadcast({ t: 'phase', phase: 'playing', remainingMs: r.duration * 1000 });
    this.broadcastRoom();
  }

  _autoPlaceNeedle() {
    const r = this.round; if (!r || r.placed) return;
    const spot = pickHiddenSpot(r.world, r.rng, r.items);
    r.needles = [{ id: 1, team: null, x: spot.x, z: spot.z, pile: spot.pile, golden: false, taken: false }]; r.nextNeedle = 2; r.placed = true;
  }

  tick(t) {
    for (const p of this.players.values()) if (!p.connected && t - p.lastSeen > LIMITS.playerGraceMs) this.removePlayer(p, 'quiet');
    if (this.dead) return;
    if (this.expireAt && t > this.expireAt) { this.dead = true; return; }
    const r = this.round;
    if (r && !r.over) {
      if (this.phase === 'countdown' && t >= r.phaseEnd) {
        if (r.mode === 'hideseek') { this.phase = 'setup'; r.phaseEnd = t + LIMITS.setupMs; this.broadcast({ t: 'phase', phase: 'setup', remainingMs: LIMITS.setupMs, phaseMs: LIMITS.setupMs }); }
        else this._beginPlaying();
      } else if (this.phase === 'setup' && t >= r.phaseEnd) { this._autoPlaceNeedle(); this._beginPlaying(); }
      else if (this.phase === 'playing' && t >= r.endsAt) this._endByTimeout();
      if (this.phase === 'playing' || this.phase === 'setup') this._updateDetectors(t);
      if (t - this.lastTimer >= 1000) { this.lastTimer = t; this.broadcast({ t: 'timer', phase: this.phase, remainingMs: this.phase === 'playing' ? Math.max(0, r.endsAt - t) : Math.max(0, r.phaseEnd - t) }); }
    }
    if (this.dirty && t - this.lastSnap >= 60) this._snapshot(t);
  }

  _snapshot(t) {
    this.lastSnap = t; this.dirty = false;
    const list = [];
    for (const p of this.players.values()) if (p.connected && p.pos && p.inRound) {
      const q = p.pos; list.push([p.id, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +q.yaw.toFixed(2), +q.pitch.toFixed(2), p.flags | (p.search ? 4 : 0) | (p.det.on ? 8 : 0)]);
    }
    if (list.length) this.broadcast({ t: 'snap', k: ++this.snapSeq, p: list });
  }

  // ----- movement -----
  _pos(p, m) {
    const r = this.round;
    if (!r || r.over || !p.pos || !p.inRound) return;
    if (this.phase === 'results') return;
    if (this.phase === 'countdown' || (this.phase === 'setup' && p.id !== r.hiderId)) return; // frozen
    if (![m.x, m.y, m.z, m.yaw, m.pitch].every(num)) return;
    const t = this.now(), dt = clamp((t - p.pos.t) / 1000, 0.02, 1);
    let x = m.x, z = m.z;
    const lim = r.world.half - 0.8; x = clamp(x, -lim, lim); z = clamp(z, -lim, lim);
    const dx = x - p.pos.x, dz = z - p.pos.z, dist = Math.hypot(dx, dz), maxD = SPRINT_SPEED * 1.5 * dt + 0.6;
    if (dist > maxD) {
      const k = maxD / dist; x = p.pos.x + dx * k; z = p.pos.z + dz * k;
      if (t - p.lastTp > 300) { p.lastTp = t; this.sendTo(p, { t: 'tp', x, z, y: p.pos.y }); }
    }
    p.pos = { x, y: clamp(m.y, 0, 6), z, yaw: m.yaw, pitch: clamp(m.pitch, -1.6, 1.6), t };
    p.flags = (m.f | 0) & 3 | ((m.f | 0) & 16);
    p.lastSeen = t; this.dirty = true;
    if (p.search && Math.hypot(x - p.search.x, z - p.search.z) > 2.2) this._searchCancel(p);
  }

  _respawn(p) {
    const r = this.round; if (!r || r.over || !p.inRound) return;
    const sp = r.world.spawns[randInt(r.world.spawns.length)];
    p.pos = { x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, pitch: 0, t: this.now() }; p.search = null;
    this.sendTo(p, { t: 'tp', x: sp.x, z: sp.z, y: 0, yaw: sp.yaw, hard: true }); this.dirty = true;
  }

  // ----- searching -----
  _canAct(p) { const r = this.round; return r && !r.over && this.phase === 'playing' && p.inRound && p.pos && r.hiderId !== p.id; }

  _searchStart(p) {
    if (!this._canAct(p)) return;
    const t = this.now(), r = this.round;
    if (p.search) return;
    if (t - p.lastSearchAt < 350) return this.sendTo(p, { t: 'search_denied', why: 'rate' });
    const pile = pileAt(r.world, p.pos.x, p.pos.z, 1.5);
    if (!pile) return this.sendTo(p, { t: 'search_denied', why: 'nopile' });
    p.lastSearchAt = t; p.search = { startedAt: t, x: p.pos.x, z: p.pos.z, pile: pile.id }; p.stats.searches++;
    this.sendTo(p, { t: 'search_started', ms: Math.round(r.searchSecs * 1000) });
    this.broadcast({ t: 'ev', k: 'search_start', id: p.id }, p.id);
  }

  _searchCancel(p) {
    if (!p.search) return;
    p.stats.searchMs += this.now() - p.search.startedAt; p.search = null; p.lastSearchAt = this.now();
    this.sendTo(p, { t: 'search_result', result: 'cancelled' });
    this.broadcast({ t: 'ev', k: 'search_stop', id: p.id });
  }

  _searchFinish(p) {
    const r = this.round, s = p.search;
    if (!s || !this._canAct(p)) return;
    const t = this.now(), need = r.searchSecs * 1000 * 0.9;
    if (t - s.startedAt < need) return this.sendTo(p, { t: 'search_denied', why: 'early' });
    if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > 2.2) return this._searchCancel(p);
    p.stats.searchMs += t - s.startedAt; p.search = null; p.lastSearchAt = t;
    this.broadcast({ t: 'ev', k: 'search_stop', id: p.id });
    // What is within reach of where the player is digging?
    const REACH = 2.8;
    const cands = [];
    for (const it of r.items) if (!it.taken) { const d = Math.hypot(it.x - p.pos.x, it.z - p.pos.z); if (d <= REACH) cands.push({ d, it }); }
    for (const n of r.needles) if (!n.taken && (n.team == null || n.team === p.team)) { const d = Math.hypot(n.x - p.pos.x, n.z - p.pos.z); if (d <= REACH) cands.push({ d, n }); }
    cands.sort((a, b) => a.d - b.d);
    const hit = cands[0];
    if (!hit) return this.sendTo(p, { t: 'search_result', result: 'nothing' });
    p.stats.okSearches++;
    if (hit.n) {
      const n = hit.n;
      for (const q of this.players.values()) if (q.inRound && (n.team == null ? q.id === p.id : q.team === n.team) && q.id !== r.hiderId) { q.exposed.add(n.id); this.sendTo(q, { t: 'reveal', kind: 'needle', id: n.id, x: n.x, z: n.z, golden: n.golden }); }
      return this.sendTo(p, { t: 'search_result', result: 'needle', id: n.id, golden: n.golden });
    }
    const it = hit.it; it.taken = true;
    const pts = r.mode === 'hideseek' ? 0 : it.points;
    this._award(p, pts);
    p.stats.decoys++;
    this.sendTo(p, { t: 'search_result', result: 'decoy', type: it.type, points: pts, x: it.x, z: it.z });
    this.broadcast({ t: 'ev', k: 'decoy', id: p.id, name: p.name, type: it.type, points: pts }, p.id);
    this.broadcastRoomScores();
  }

  _award(p, pts) { if (!pts) return; p.stats.score += pts; p.stats.roundScore += pts; }
  broadcastRoomScores() { this.broadcast({ t: 'scores', s: [...this.players.values()].map(p => [p.id, p.stats.roundScore, p.stats.score, p.stats.needles]) }); }

  // ----- pickup & round resolution -----
  _pickup(p, m) {
    if (this.round?.over) return this.sendTo(p, { t: 'pickup_fail', why: 'late' }); // lost the race: the round already ended
    if (!this._canAct(p)) return;
    const r = this.round, n = r.needles.find(x => x.id === m.id);
    if (!n) return this.sendTo(p, { t: 'pickup_fail', why: 'none' });
    if (n.taken) return this.sendTo(p, { t: 'pickup_fail', why: 'late' });
    if (n.team != null && n.team !== p.team) return this.sendTo(p, { t: 'pickup_fail', why: 'team' });
    if (!p.exposed.has(n.id)) return this.sendTo(p, { t: 'pickup_fail', why: 'hidden' });
    if (Math.hypot(n.x - p.pos.x, n.z - p.pos.z) > 2.6) return this.sendTo(p, { t: 'pickup_fail', why: 'range' });
    n.taken = true; r.found++;
    p.stats.needles++;
    this._resolveFound(p, n);
  }

  _resolveFound(finder, n) {
    const r = this.round, mode = r.mode, pts = {};
    const give = (p, v) => { this._award(p, v); pts[p.id] = (pts[p.id] || 0) + v; };
    const inRound = [...this.players.values()].filter(p => r.participants.has(p.id));
    let winners = [], over = true, winnerTeam = null;
    if (mode === 'classic' || mode === 'golden') {
      const base = n.golden ? 250 : 100, bonus = Math.min(50, 10 * finder.stats.streak);
      give(finder, base + bonus); winners = [finder.id];
    } else if (mode === 'team') {
      winnerTeam = finder.team;
      for (const q of inRound) if (q.team === finder.team && q.connected) { give(q, 75); winners.push(q.id); }
      if (!winners.includes(finder.id)) winners.push(finder.id);
    } else if (mode === 'hideseek') {
      give(finder, 100); winners = [finder.id];
    } else if (mode === 'endless') {
      give(finder, 100); over = false;
    }
    this.broadcast({ t: 'ev', k: 'needle_found', id: finder.id, name: finder.name, golden: !!n.golden, team: finder.team, points: pts[finder.id] || 0, needleId: n.id });
    this.broadcastRoomScores();
    if (over) return this._finishRound({ reason: 'found', winners, winnerTeam, finderId: finder.id, pts });
    // Endless: place a fresh needle somewhere valid and invalidate everyone's exposure.
    const spot = pickHiddenSpot(r.world, r.rng, r.items.filter(i => !i.taken), p => p.id !== n.pile) || pickHiddenSpot(r.world, r.rng, r.items);
    n.x = spot.x; n.z = spot.z; n.pile = spot.pile; n.taken = false; n.id = r.nextNeedle++;
    for (const q of this.players.values()) q.exposed.clear();
    this.broadcast({ t: 'ev', k: 'needle_moved' });
  }

  _endByTimeout() {
    const r = this.round;
    if (r.mode === 'endless') {
      const inRound = [...this.players.values()].filter(p => r.participants.has(p.id));
      const top = Math.max(0, ...inRound.map(p => p.stats.roundScore));
      const winners = top > 0 ? inRound.filter(p => p.stats.roundScore === top).map(p => p.id) : [];
      return this._finishRound({ reason: 'timeout', winners, winnerTeam: null, finderId: null, pts: {} });
    }
    const pts = {}, winners = [];
    if (r.mode === 'hideseek') { const h = this.players.get(r.hiderId); if (h) { this._award(h, 100); pts[h.id] = 100; winners.push(h.id); } }
    this._finishRound({ reason: 'timeout', winners, winnerTeam: null, finderId: null, pts });
  }

  _finishRound({ reason, winners, winnerTeam, finderId, pts }) {
    const r = this.round; r.over = true; this.phase = 'results';
    const parts = [...this.players.values()].filter(p => r.participants.has(p.id));
    for (const p of parts) {
      p.search = null; p.det.on = false;
      if (winners.includes(p.id)) { p.stats.wins++; p.stats.streak++; p.stats.bestStreak = Math.max(p.stats.bestStreak, p.stats.streak); }
      else { p.stats.losses++; p.stats.streak = 0; }
    }
    if (!winners.length) for (const p of parts) p.stats.streak = 0;
    const standings = parts.map(p => ({ id: p.id, name: p.name, team: p.team, roundScore: p.stats.roundScore, score: p.stats.score, needles: p.stats.needles, searches: p.stats.searches, okSearches: p.stats.okSearches, searchSecs: Math.round(p.stats.searchMs / 1000), wins: p.stats.wins, losses: p.stats.losses, bestStreak: p.stats.bestStreak, decoys: p.stats.decoys, win: winners.includes(p.id) }))
      .sort((a, b) => b.roundScore - a.roundScore || b.score - a.score);
    const msg = {
      t: 'results', reason, mode: r.mode, winners, winnerTeam, finderId, finderName: this.players.get(finderId)?.name || null, hiderId: r.hiderId, hiderName: this.players.get(r.hiderId)?.name || null,
      standings, needles: r.needles.map(n => ({ x: n.x, z: n.z, team: n.team, golden: n.golden })), roundId: r.id,
    };
    this.broadcast(msg); this.broadcastRoom();
  }

  // ----- detector -----
  _detector(p, m) {
    const r = this.round;
    if (!r || r.over || (this.phase !== 'playing') || !p.inRound || r.hiderId === p.id) return;
    if (this.settings.detector === 'off') return this.err(p, 'DET_OFF', 'The host disabled the metal detector.');
    const on = !!m.on;
    if (on && p.det.battery < 15) return this.sendTo(p, { t: 'det', s: 0, b: Math.round(p.det.battery), on: false, low: true });
    p.det.on = on; p.det.last = -1;
    this.sendTo(p, { t: 'det', s: 0, b: Math.round(p.det.battery), on });
  }

  _updateDetectors(t) {
    if (t - this.lastDet < 250) return;
    const dt = Math.min(1, (t - this.lastDet) / 1000); this.lastDet = t;
    const r = this.round;
    for (const p of this.players.values()) {
      if (!p.connected || !p.inRound) continue;
      const d = p.det;
      if (!d.on) { if (d.battery < 100) { d.battery = Math.min(100, d.battery + 2 * dt); } continue; }
      d.battery -= 3.3 * dt;
      if (d.battery <= 0) { d.battery = 0; d.on = false; this.sendTo(p, { t: 'det', s: 0, b: 0, on: false, low: true }); continue; }
      let best = Infinity;
      for (const n of r.needles) if (!n.taken && (n.team == null || n.team === p.team)) best = Math.min(best, Math.hypot(n.x - p.pos.x, n.z - p.pos.z));
      for (const it of r.items) if (!it.taken && it.metal) best = Math.min(best, Math.hypot(it.x - p.pos.x, it.z - p.pos.z));
      let range = DET_RANGE[this.settings.detector]; if (r.mode === 'golden') range *= 0.5;
      let s = best >= range ? 0 : Math.pow(1 - best / range, 1.2);
      s = Math.round(s * 20) / 20; // quantised so exact distances cannot be recovered cheaply
      if (s !== d.last || t - d.lastSent > 1000) { d.last = s; d.lastSent = t; this.sendTo(p, { t: 'det', s, b: Math.round(d.battery), on: true }); }
    }
  }

  // ----- hide & seek -----
  _placeNeedle(p) {
    const r = this.round;
    if (!r || r.mode !== 'hideseek' || this.phase !== 'setup' || r.hiderId !== p.id) return this.err(p, 'BAD_ACTION', 'You cannot place the needle right now.');
    const { x, z } = p.pos;
    const pile = pileAt(r.world, x, z, 0);
    const clear = !r.world.solids.some(s => x > s.minX - 0.5 && x < s.maxX + 0.5 && z > s.minZ - 0.5 && z < s.maxZ + 0.5);
    const farSpawn = !r.world.spawns.some(s => Math.hypot(s.x - x, s.z - z) < 6);
    if (!pile || !clear || !farSpawn || !isReachable(r.world, x, z)) return this.sendTo(p, { t: 'placed', ok: false, msg: 'Stand inside a hay pile (away from walls and spawn points) to hide the needle.' });
    r.needles = [{ id: 1, team: null, x, z, pile: pile.id, golden: false, taken: false }]; r.nextNeedle = 2; r.placed = true;
    this.sendTo(p, { t: 'placed', ok: true });
  }
}
