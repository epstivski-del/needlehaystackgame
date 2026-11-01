// NIGHT SHIFT: THE LAST BELL — authoritative game simulation (rooms, lobby, enemy AI, objectives, boss, modes).
// Pure ES module with no Node-only imports: the Node server runs it for online rooms and the browser runs the very
// same code in-process for the offline loopback mode.
import { getWorld, resolve, inWall, los, findPath, zoneAt, inRect, RECT, SPOTS, SEAL_SPOT, PITS, B, closedGates, depthAt, rng, groundY, inOval } from './world.js';

export const KIND = { stalker: 1, handshake: 2, loaf: 3, wraith: 4, audience: 5, boss: 6, rush: 7, decoy: 8 };
export const HATS = ['none', 'cap', 'cone', 'beanie', 'crown', 'bread', 'duck', 'halo'];
export const SHOP = { battery: { cost: 6 }, shoes: { cost: 5 }, shield: { cost: 4 }, rabbit: { cost: 4 }, hat: { cost: 2 } };
export const MODES = ['coop', 'monster', 'chaos'];
export const DIFFS = ['easy', 'normal', 'hard'];
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const FL = { crouch: 1, sprint: 2, flash: 4, down: 8, dead: 16, hidden: 32, swim: 64, scooter: 128, monster: 256, frozen: 512, board: 1024, dive: 2048, limp: 4096, gas: 8192, rev: 16384 };
const THROWABLES = ['can', 'duck', 'stress', 'butter', 'knife', 'jam'];
const MUTATORS = ['breadrain', 'laugh', 'scooters', 'blackout', 'fog', 'flood'];
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);

const DEFAULTS = { mode: 'coop', difficulty: 'normal', sunrise: 20, scare: 1, maxPlayers: 12, locked: false, lateJoin: true, ngplus: false, bots: 0, monsterId: 0 };
function cleanSettings(s, cur) {
  const o = { ...cur };
  if (MODES.includes(s.mode)) o.mode = s.mode;
  if (DIFFS.includes(s.difficulty)) o.difficulty = s.difficulty;
  if (Number.isFinite(s.sunrise)) o.sunrise = clamp(Math.round(s.sunrise), 8, 45);
  if (Number.isFinite(s.scare)) o.scare = clamp(Math.round(s.scare), 0, 2);
  if (Number.isFinite(s.maxPlayers)) o.maxPlayers = clamp(Math.round(s.maxPlayers), 1, 12);
  for (const k of ['locked', 'lateJoin', 'ngplus']) if (typeof s[k] === 'boolean') o[k] = s[k];
  if (Number.isFinite(s.bots)) o.bots = clamp(Math.round(s.bots), 0, 4);
  if (Number.isFinite(s.monsterId)) o.monsterId = s.monsterId | 0;
  return o;
}

// ------------------------------------------------------------------ enemy definitions
// sight = metres, fov = half-angle (rad), hear = multiplier on noise radius, reach = attack distance.
const ED = {
  stalker:   { k: 1, r: 0.6, patrol: 1.7, hunt: 3.9, sight: 20, fov: 1.2, hear: 1.2, reach: 1.15, zone: 'canteen', margin: 6 },
  rush:      { k: 7, r: 0.6, patrol: 5.2, hunt: 6.3, sight: 40, fov: 3.1, hear: 2.0, reach: 1.2, zone: 'canteen', margin: 10 },
  handshake: { k: 2, r: 0.5, patrol: 1.4, hunt: 4.6, sight: 60, fov: 3.1, hear: 1.0, reach: 1.5, zone: 'scooter', margin: 12 },
  decoy:     { k: 8, r: 0.5, patrol: 2.0, hunt: 4.8, sight: 60, fov: 3.1, hear: 1.0, reach: 1.5, zone: null, margin: 0 },
  loaf:      { k: 3, r: 0.7, patrol: 1.7, hunt: 3.4, sight: 4, fov: 3.1, hear: 1.7, reach: 2.7, zone: 'bakery', margin: 4 },
  wraith:    { k: 4, r: 0.6, patrol: 1.2, hunt: 4.4, sight: 14, fov: 2.6, hear: 1.5, reach: 1.9, zone: 'abyss', margin: 6 },
  audience:  { k: 5, r: 0.5, patrol: 0, hunt: 5.2, sight: 0, fov: 0, hear: 0, reach: 1.2, zone: 'aud', margin: 0 },
  boss:      { k: 6, r: 1.4, patrol: 0, hunt: 3.0, sight: 90, fov: 3.1, hear: 0, reach: 3, zone: 'aud', margin: 0 },
};

class Player {
  constructor(id, conn, name, hat) {
    this.id = id; this.conn = conn; this.name = name; this.hat = hat; this.bot = false; this.ready = false; this.connected = true;
    this.token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); this.dcAt = 0;
    this.chatT = 0; this.pingT = 0;
    this.reset(SPOTS.spawn.x, SPOTS.spawn.z);
  }
  reset(x, z) {
    this.x = x; this.z = z; this.yaw = Math.PI; this.pitch = 0; this.flags = 0; this.crouch = false; this.sprint = false; this.flash = false; this.breath = false; this.dive = false;
    this.hp = 2; this.down = false; this.dead = false; this.downT = 0; this.reviveP = 0; this.reviving = 0; this.hidden = null; this.shield = false;
    this.inv = {}; this.up = {}; this.hatsOwned = 0;
    this.scooterUntil = 0; this.boardUntil = 0; this.protect = 0; this.invuln = 0; this.frozen = 0; this.lastPosT = 0; this.v = 0; this.strikes = 0; this.fixT = 0; this.noiseR = 1;
    this.role = 'survivor'; this.zone = 'atrium'; this.inGas = false; this.lastScare = 0; this.throwT = 0; this.crumbs = []; this.cool = {}; this.rideSafe = false;
    this.stats = { hits: 0, downs: 0, revives: 0, throws: 0, thrownHits: 0, picks: 0, logs: 0, s67: 0, rides: 0, crashes: 0, bossDmg: 0, perfect: 0, loafHits: 0, seals: 0, trophies: 0, coinsSpent: 0, hideT: 0, handshakes: 0 };
  }
}

// ------------------------------------------------------------------ Room
export class Room {
  constructor(hub, code, practice) {
    this.hub = hub; this.code = code; this.practice = !!practice; this.W = getWorld();
    this.players = new Map(); this.hostId = 0; this.phase = 'lobby'; this.settings = { ...DEFAULTS };
    this.isPublic = false; this.dead = false; this.emptySince = 0; this.created = hub.now(); this.countdown = 0; this.g = null; this.lastT = hub.now();
    this.nextBot = 1;
  }

  // ---------------- lobby / membership
  humans() { return [...this.players.values()].filter(p => !p.bot); }
  connectedHumans() { return this.humans().filter(p => p.connected); }
  send(p, obj) { if (p.conn && p.connected) { try { p.conn.send(obj); } catch { /* socket gone */ } } }
  bcast(obj, except) { for (const p of this.players.values()) if (!p.bot && p.id !== except) this.send(p, obj); }

  addPlayer(conn, msg) {
    const s = this.settings, name = cleanText(msg.name, 16) || 'Student' + (100 + Math.floor(Math.random() * 900));
    if (msg.token) {
      for (const p of this.players.values()) if (!p.bot && p.token === msg.token && !p.connected) { return this.rebind(p, conn); }
    }
    const connected = this.players.size;
    if (connected >= s.maxPlayers) return { ok: false, code: 'FULL', msg: 'That room is full.' };
    if (s.locked && this.humans().length) return { ok: false, code: 'LOCKED', msg: 'The host locked this room.' };
    if (this.phase !== 'lobby' && !(s.lateJoin && this.phase === 'playing')) return { ok: false, code: 'STARTED', msg: 'That run is already underway.' };
    const p = new Player(conn.id, conn, name, HATS.includes(msg.hat) ? msg.hat : 'none');
    if (this.phase === 'playing') this.placeAtSpawn(p, this.players.size);
    this.players.set(p.id, p);
    if (!this.hostId || !this.players.get(this.hostId)) this.hostId = p.id;
    conn.room = this; conn.player = p;
    this.send(p, { t: 'joined', you: p.id, token: p.token, code: this.code, practice: this.practice });
    this.broadcastRoom();
    if (this.phase === 'playing') this.send(p, this.startMsg(p));
    return { ok: true };
  }
  rebind(p, conn) {
    if (p.conn && p.conn !== conn) { p.conn.room = null; p.conn.player = null; }
    p.conn = conn; p.connected = true; p.dcAt = 0; conn.room = this; conn.player = p;
    this.send(p, { t: 'joined', you: p.id, token: p.token, code: this.code, practice: this.practice, rejoin: true });
    this.broadcastRoom();
    if (this.phase === 'playing') this.send(p, this.startMsg(p));
    return { ok: true };
  }
  placeAtSpawn(p, i) { const a = i * 2.4, x = SPOTS.spawn.x + Math.cos(a) * 2.6, z = SPOTS.spawn.z + 2 + Math.sin(a) * 1.6; p.reset(x, z); }
  disconnect(p) {
    if (this.phase === 'playing' && !p.bot) { p.connected = false; p.dcAt = this.hub.now(); p.protect = Math.max(p.protect, this.g.t + 30); this.migrateHost(); this.broadcastRoom(); return; }
    this.removePlayer(p, 'left');
  }
  removePlayer(p, why) {
    this.players.delete(p.id);
    if (p.conn && p.conn.player === p) { p.conn.room = null; p.conn.player = null; }
    if (why === 'kicked') this.send(p, { t: 'kicked' });
    this.migrateHost();
    if (this.g && this.phase === 'playing') this.bcastEv({ k: 'left', id: p.id });
    this.broadcastRoom();
    if (!this.connectedHumans().length) { this.emptySince = this.emptySince || this.hub.now(); }
  }
  migrateHost() {
    const h = this.players.get(this.hostId);
    if (h && !h.bot && h.connected) return;
    const next = this.connectedHumans()[0];
    if (next) { this.hostId = next.id; this.bcast({ t: 'host', id: next.id }); }
  }
  roomMsg() {
    return {
      t: 'room', code: this.code, phase: this.phase, host: this.hostId, practice: this.practice, settings: this.settings,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, hat: p.hat, ready: p.ready || p.bot, bot: p.bot, connected: p.connected, role: p.role })),
    };
  }
  broadcastRoom() { this.bcast(this.roomMsg()); }
  bcastEv(ev) { (this.g ? this.g.ev : []).push(ev); }

  // ---------------- message handling
  handle(p, m) {
    const g = this.g, playing = this.phase === 'playing' && g;
    switch (m.t) {
      case 'cfg': if (p.id === this.hostId && this.phase === 'lobby') { this.settings = cleanSettings(m.settings || {}, this.settings); this.syncBots(); this.broadcastRoom(); } return;
      case 'ready': p.ready = !!m.v; this.broadcastRoom(); return;
      case 'prof': p.name = cleanText(m.name, 16) || p.name; if (HATS.includes(m.hat)) p.hat = m.hat; this.broadcastRoom(); return;
      case 'start': if (p.id === this.hostId && this.phase === 'lobby') this.beginCountdown(p); return;
      case 'kick': if (p.id === this.hostId) { const v = this.players.get(m.id | 0); if (v && v !== p) this.removePlayer(v, 'kicked'); } return;
      case 'lobby': if (p.id === this.hostId && this.phase !== 'lobby') this.backToLobby(); return;
      case 'retry': if (p.id === this.hostId && this.phase === 'ended' && this.g && this.g.cp) this.retry(); return;
      case 'chat': return this.chat(p, m);
      case 'pong': return;
    }
    if (!playing) return;
    switch (m.t) {
      case 'pos': return this.onPos(p, m);
      case 'use': return this.onUse(p, m);
      case 'throw': return this.onThrow(p, m);
      case 'rev': p.reviving = m.on ? (m.id | 0) : 0; return;
      case 'hide': return this.onHide(p, m);
      case 'ping': if (this.hub.now() - p.pingT > 1500) { p.pingT = this.hub.now(); this.bcastEv({ k: 'ping', id: p.id, x: r2(+m.x || p.x), z: r2(+m.z || p.z), kind: cleanText(m.kind, 10) || 'here' }); } return;
      case 'shop': return this.onShop(p, m);
      case 'beat': return this.onBeat(p, m);
      case 'mon': return this.onMonster(p, m);
      case 'crash': if (p.scooterUntil > g.t && !p.rideSafe) { p.scooterUntil = 0; p.stats.crashes++; this.hit(p, 'crash'); } return;
      case 'blur': p.protect = Math.max(p.protect, g.t + 10); return;
      case 'dbg': return this.onDebug(p, m);
    }
  }

  chat(p, m) {
    const t = this.hub.now(); if (t - p.chatT < 600) return; p.chatT = t;
    const text = cleanText(m.text, 140); if (!text) return;
    const ev = { t: 'chat', id: p.id, name: p.name, text, g: !!m.g, x: this.g ? r2(p.x) : 0, z: this.g ? r2(p.z) : 0 };
    this.bcast(ev);
    if (this.g && m.g) this.g.radioT = this.g.t; // global radio chatter is audible to enemies for a moment
  }

  syncBots() {
    if (this.phase !== 'lobby') return;
    const want = this.settings.bots, have = [...this.players.values()].filter(p => p.bot && !p.tut);
    while (have.length > want) { const b = have.pop(); this.players.delete(b.id); }
    while (have.length < want && this.players.size < this.settings.maxPlayers) { const b = this.makeBot(); have.push(b); }
  }
  makeBot(tut) {
    const names = ['Pip', 'Moxie', 'Biscuit', 'Wafer', 'Sprout', 'Crumpet'];
    const id = 9000 + this.nextBot++;
    const b = new Player(id, null, (tut ? 'Buddy' : 'Bot ' + names[(this.nextBot) % names.length]), HATS[1 + (id % 7)]);
    b.bot = true; b.tut = !!tut; b.ready = true; b.botT = 0; b.path = null; b.pathT = 0; b.goal = null;
    this.players.set(id, b); return b;
  }

  // ---------------- round flow
  beginCountdown(p) {
    const s = this.settings;
    const humans = this.connectedHumans();
    this.syncBots();
    if (s.mode === 'monster' && this.players.size < 2) return this.send(p, { t: 'err', code: 'NEED_PLAYERS', msg: 'The Last Bell needs at least 2 players. Add a bot or invite a friend.' });
    if (!humans.length) return;
    this.phase = 'countdown'; this.countdown = 3.2; this.broadcastRoom(); this.bcast({ t: 'countdown', s: 3 });
  }
  startRound() {
    const s = this.settings, seed = (Math.random() * 2 ** 31) | 0, rnd = rng(seed);
    this.phase = 'playing';
    const em = ({ easy: 0.9, normal: 1, hard: 1.18 }[s.difficulty] || 1) * (s.ngplus ? 1.15 : 1);
    this.g = {
      seed, rnd, t: 0, sunrise: s.sunrise * 60, em, ev: [], tick: 0, nextId: 1, nextEnt: 1, pk: new Map(), enemies: [], proj: [], haz: [], noises: [], open: {}, seals: [false, false, false, false, false],
      coins: 2, crumb: 0, key: 0, trophy: 0, toasterKey: false, toasted: false, toastP: 0, toastT: 0, logs: new Set(), s67: new Set(), zoneSeen: {}, ai: s.mode !== 'monster',
      laugh: { phase: 'quiet', t: 0, level: 0 }, clouds: this.W.clouds.map(c => ({ x: c.x, z: c.z, r: c.r, vx: 0, vz: 0, t: 0 })), tideT: 0, surge: 0, nextSurge: 70, surgeWarn: 0,
      mut: null, nextMut: 55, mutT: 0, boss: null, bossDead: false, rushDone: false, cp: null, plate: { a: false, b: false }, frontOpen: false, tutBot: null, flood: null, crateCd: {},
      result: null, endT: 0, radioT: -99, cameoT: 70, monCd: {}, monsterId: 0, lastSnap: 0, doneAt: 0, stats: { start: this.hub.now() }, chaosFlood: false,
    };
    const g = this.g;
    // roles + spawn
    let i = 0;
    const mon = s.mode === 'monster' ? (this.players.get(s.monsterId) && !this.players.get(s.monsterId).bot ? this.players.get(s.monsterId) : [...this.players.values()].filter(p => !p.bot)[Math.floor(rnd() * this.humans().length)] || this.players.get(this.hostId)) : null;
    for (const p of this.players.values()) {
      this.placeAtSpawn(p, i++);
      p.role = mon && p === mon ? 'monster' : 'survivor';
      if (p.role === 'monster') { p.x = 0; p.z = -12; g.monsterId = p.id; p.frozen = 15; }
      p.ready = false;
    }
    // solo tutorial buddy: stands on plate B until the door is open
    if (this.connectedHumans().length + [...this.players.values()].filter(p => p.bot).length < 2 && s.mode !== 'monster') {
      const b = this.makeBot(true); b.x = SPOTS.plateB.x; b.z = SPOTS.plateB.z; g.tutBot = b.id;
    }
    if (s.mode === 'monster') { g.frontOpen = true; g.open.front = true; }
    this.planPickups();
    if (g.ai) this.spawnEnemies();
    g.lastZoneNar = 0;
    g.cp = this.makeCheckpoint();
    this.bcast({ t: 'room', ...this.roomMsg() });
    for (const p of this.players.values()) this.send(p, this.startMsg(p));
  }
  startMsg(p) {
    const g = this.g;
    return {
      t: 'start', seed: g.seed, settings: this.settings, you: p.id, mode: this.settings.mode, monsterId: g.monsterId, sunrise: g.sunrise, ai: g.ai,
      open: g.open, pickups: [...g.pk.values()].filter(k => !k.taken && k.on).map(k => this.pkMsg(k)),
      seals: g.seals, team: this.teamMsg(), crates: this.W.crates, roster: this.roomMsg().players, tt: g.t,
    };
  }
  pkMsg(k) { return { id: k.id, ty: k.type, x: r2(k.x), z: r2(k.z), n: k.n, i: k.i, dv: k.needDive ? 1 : 0 }; }

  backToLobby() {
    this.phase = 'lobby'; this.g = null;
    for (const p of [...this.players.values()]) { p.ready = false; p.role = 'survivor'; if (p.bot) this.players.delete(p.id); }
    this.syncBots(); this.broadcastRoom(); this.bcast({ t: 'lobby' });
  }

  // ---------------- pickups
  addPk(type, x, z, extra = {}) { const g = this.g, k = { id: g.nextId++, type, x, z, taken: false, on: true, ...extra }; g.pk.set(k.id, k); return k; }
  planPickups() {
    const g = this.g, W = this.W, rnd = g.rnd, ng = this.settings.ngplus;
    const used = [];
    const pick = (list, n, sep = 3) => {
      const out = [], pool = list.slice();
      for (let tries = 0; out.length < n && pool.length && tries < 400; tries++) {
        const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        if (used.some(u => dist(u.x, u.z, c.x, c.z) < sep) || out.some(u => dist(u.x, u.z, c.x, c.z) < sep)) { continue; }
        out.push(c);
      }
      used.push(...out); return out;
    };
    const spread = (list, n, sep) => pick(list, n, sep);
    // objective items
    spread(W.cand.canteen, 6, 12).forEach(c => this.addPk('crumb', c.x, c.z));
    spread(W.cand.scooter, 5, 16).forEach(c => this.addPk('key', c.x, c.z));
    const bk = spread(W.cand.bakery, 3, 18);
    ['toasterkey', 'knife', 'jam'].forEach((t, i) => bk[i] && this.addPk(t, bk[i].x, bk[i].z));
    spread(W.cand.bakery, 6, 8).forEach(c => this.addPk('butter', c.x, c.z));
    PITS.forEach(p => this.addPk('trophy', p.x, p.z, { needDive: true }));
    pick(W.cand.abyssShore, 3, 10).forEach(c => this.addPk('board', c.x, c.z));
    // helpers
    const sprinkle = (zone, bat, snack, coin) => {
      const list = W.cand[zone] || [];
      pick(list, bat, 10).forEach(c => this.addPk('battery', c.x, c.z));
      pick(list, snack, 8).forEach(c => this.addPk('snack', c.x, c.z));
      pick(list, coin, 5).forEach(c => this.addPk('coin', c.x, c.z, { n: 1 + (rnd() < 0.25 ? 1 : 0) }));
    };
    const scale = ng ? 0.6 : 1;
    sprinkle('canteen', Math.round(3 * scale), 2, 3); sprinkle('scooter', Math.round(3 * scale), 2, 4); sprinkle('bakery', Math.round(3 * scale), 2, 3);
    sprinkle('aud', Math.round(2 * scale), 2, 3); sprinkle('deck', Math.round(2 * scale), 2, 3); sprinkle('quad', 1, 1, 3); sprinkle('campus', Math.round(3 * scale), 3, 6);
    sprinkle('wingW', 1, 1, 2); sprinkle('wingE', 1, 1, 2);
    pick(W.cand.abyssShore, 2, 6).forEach(c => this.addPk('battery', c.x, c.z));
    pick(W.cand.abyssShore, 2, 6).forEach(c => this.addPk('coin', c.x, c.z, { n: 2 }));
    this.addPk('battery', 4, 84); this.addPk('snack', 13, 80);
    for (const z of ['deck', 'quad', 'campus', 'wingW', 'wingE', 'scooter', 'canteen']) pick(W.cand[z], 2, 8).forEach(c => this.addPk(THROWABLES[Math.floor(rnd() * 3)], c.x, c.z));
    // 15 incident logs (3 per level) + 15 hidden 67s
    ['canteen', 'scooter', 'bakery', 'abyssShore', 'aud'].forEach((z, zi) => pick(W.cand[z], 3, 14).forEach((c, k) => this.addPk('log', c.x, c.z, { i: zi * 3 + k })));
    const s67 = [['deck', 2], ['wingW', 2], ['wingE', 2], ['quad', 1], ['campus', 1], ['canteen', 2], ['scooter', 1], ['bakery', 2], ['abyssShore', 1], ['aud', 1]];
    let n = 0; for (const [z, c] of s67) pick(W.cand[z], c, 14).forEach(p2 => this.addPk('s67', p2.x, p2.z, { i: n++ }));
    // seals (inactive until their objective is complete)
    SEAL_SPOT.forEach((p, i) => this.addPk('seal', p.x, p.z, { i, on: false }));
    this.addPk('bike', SPOTS.bike.x, SPOTS.bike.z, { on: false });
    for (const pit of PITS) { used.push(pit); }
    // monster mode keeps the puzzle chain shorter: no loaf fight, no boss.
  }

  makeCheckpoint() {
    const g = this.g;
    return { t: g.t, seals: g.seals.slice(), coins: g.coins, crumb: g.crumb, key: g.key, trophy: g.trophy, toasterKey: g.toasterKey, taken: [...g.pk.values()].filter(k => k.taken).map(k => k.id), logs: [...g.logs], s67: [...g.s67], open: { ...g.open }, frontOpen: g.frontOpen, rushDone: g.rushDone };
  }
  retry() {
    const g = this.g, cp = g.cp;
    g.result = null; g.endT = 0; g.t = cp.t; g.seals = cp.seals.slice(); g.coins = cp.coins; g.crumb = cp.crumb; g.key = cp.key; g.trophy = cp.trophy; g.toasterKey = cp.toasterKey;
    g.logs = new Set(cp.logs); g.s67 = new Set(cp.s67); g.open = { ...cp.open }; g.frontOpen = cp.frontOpen; g.rushDone = cp.rushDone; g.toasted = !!cp.seals[2]; g.loafDone = !!cp.seals[2]; g.loafDead = g.loafDone; g.bossDead = false; g.toastP = 0;
    for (const k of g.pk.values()) { k.taken = cp.taken.includes(k.id); }
    g.enemies = []; g.proj = []; g.haz = []; g.noises = []; g.boss = null; g.mut = null; g.flood = null; g.laugh = { phase: 'quiet', t: 0, level: 0 };
    if (g.ai) { this.spawnEnemies(); if (g.loafDone) g.enemies = g.enemies.filter(e => e.kind !== KIND.loaf); }
    let i = 0;
    for (const p of this.players.values()) { const keepUp = p.up, keepHat = p.hatsOwned, role = p.role; this.placeAtSpawn(p, i++); p.up = keepUp; p.hatsOwned = keepHat; p.role = role; p.shield = !!(p.up.shield); }
    this.refreshSeals();
    this.phase = 'playing';
    for (const p of this.players.values()) this.send(p, this.startMsg(p));
  }
  sealDone(i) {
    const g = this.g;
    return [g.crumb >= 6, g.key >= 5, !!g.loafDone, g.trophy >= 4, g.ai ? !!g.bossDead : !!g.open.aud][i];
  }
  refreshSeals() { for (const k of this.g.pk.values()) if (k.type === 'seal') k.on = this.sealDone(k.i) && !k.taken; }
  sealOn(i) {
    const g = this.g;
    for (const k of g.pk.values()) if (k.type === 'seal' && k.i === i && !k.taken && !k.on) { k.on = true; g.ev.push({ k: 'add', pk: this.pkMsg(k) }); }
  }

  // ---------------- enemies
  newEnemy(kind, x, z, extra = {}) {
    const g = this.g, d = ED[kind];
    const e = { id: g.nextEnt++, kind, d, x, z, yaw: 0, state: 0, tgt: 0, hp: 1, lx: x, lz: z, seenT: -99, path: null, pi: 0, repath: 0, wx: x, wz: z, wt: 0, cd: 0, stuck: 0, aux: 0, home: d.zone, sx: x, sz: z, born: g.t, ...extra };
    g.enemies.push(e); return e;
  }
  spawnEnemies() {
    const g = this.g, W = this.W, rnd = g.rnd, n = this.players.size;
    const far = (list, from) => list.slice().sort((a, b) => dist(b.x, b.z, from.x, from.z) - dist(a.x, a.z, from.x, from.z));
    const cells = far(W.cand.canteen, { x: -63, z: 5.5 });
    for (let i = 0; i < (n >= 6 ? 2 : 1); i++) this.newEnemy('stalker', cells[i].x, cells[i].z);
    const hs = W.cand.scooter.slice().sort(() => rnd() - 0.5);
    for (let i = 0; i < Math.min(4, Math.ceil(n / 3) + 1); i++) this.newEnemy('handshake', hs[i].x, hs[i].z);
    const bc = far(W.cand.bakery, { x: -63, z: -71.5 }); this.newEnemy('loaf', bc[0].x, bc[0].z, { hp: 3 });
    for (let i = 0; i < (n >= 7 ? 2 : 1); i++) this.newEnemy('wraith', PITS[i % PITS.length].x, PITS[i % PITS.length].z);
    W.seats.filter((_, i) => i % 3 === 0).forEach(s => this.newEnemy('audience', s.x, s.z, { hp: 1, sx: s.x, sz: s.z }));
  }

  // ---------------- player actions
  alive(p) { return !p.down && !p.dead && p.role !== 'spectator'; }
  onPos(p, m) {
    const g = this.g, now = this.hub.now() / 1000;
    if (p.dead || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    const dt = clamp(now - p.lastPosT, 0.02, 0.5); p.lastPosT = now;
    let x = +m.x, z = +m.z;
    const f = m.f | 0;
    if (p.hidden) { return; }
    // speed validation
    let cap = p.down ? 1.4 : (f & 2) ? 7.9 : (f & 1) ? 3.0 : 5.4;
    if (p.scooterUntil > g.t) cap = 12.5;
    else if (p.boardUntil > g.t) cap = 9.5;
    if (g.mut && g.mut.id === 'scooters') cap *= 1.6;
    if (p.role === 'monster') cap = 7.0;
    const allowed = cap * dt * 1.35 + 0.6, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    const gates = closedGates(this.W, g.open);
    if (p.frozen > g.t) { x = p.x; z = p.z; }
    else if (d > allowed) { const k = allowed / d; x = p.x + dx * k; z = p.z + dz * k; p.strikes++; }
    else p.strikes = Math.max(0, p.strikes - 0.2);
    const rr = resolve(this.W, x, z, 0.38, gates);
    if (Math.hypot(rr.x - x, rr.z - z) > 0.9) { p.strikes += 2; x = p.x; z = p.z; } else { x = rr.x; z = rr.z; }
    p.v = p.v * 0.6 + (Math.hypot(x - p.x, z - p.z) / dt) * 0.4;
    p.x = x; p.z = z; p.yaw = +m.yaw || 0; p.pitch = clamp(+m.pitch || 0, -1.5, 1.5);
    p.crouch = !!(f & 1); p.sprint = !!(f & 2) && !p.down; p.flash = !!(f & 4); p.breath = !!(f & 8); p.dive = !!(f & 16);
    if (Math.hypot(x - (+m.x), z - (+m.z)) > 1.6 && g.t - p.fixT > 0.5) { p.fixT = g.t; this.send(p, { t: 'fix', x: r2(x), z: r2(z) }); }
  }
  nearPk(p, id, range = 2.9) {
    const k = this.g.pk.get(id);
    if (!k || k.taken || !k.on) return null;
    if (dist(p.x, p.z, k.x, k.z) > range) return null;
    return k;
  }
  onUse(p, m) {
    const g = this.g;
    if (!this.alive(p) || p.hidden) return;
    const id = m.id;
    if (typeof id === 'number') return this.takePk(p, id);
    if (id === 'toaster') return this.useToaster(p);
    if (id === 'bed') { if (dist(p.x, p.z, SPOTS.beanbag.x, SPOTS.beanbag.z) < 3.5 && g.t - (p.cool.bed || -99) > 8) { p.cool.bed = g.t; g.cp = this.makeCheckpoint(); this.send(p, { t: 'ev', ev: [{ k: 'rest' }] }); this.bcastEv({ k: 'cp', id: p.id }); } return; }
    if (typeof id === 'string' && id.startsWith('cr')) {
      const c = this.W.crates.find(c => c.id === id);
      if (c && dist(p.x, p.z, c.x, c.z) < 3 && g.t - (g.crateCd[id] || -99) > 8) {
        g.crateCd[id] = g.t; p.inv.stress = Math.min(6, (p.inv.stress || 0) + 2); p.inv.can = Math.min(6, (p.inv.can || 0) + 1);
        this.send(p, { t: 'inv', inv: p.inv }); this.bcastEv({ k: 'crate', id });
      }
    }
  }
  takePk(p, id) {
    const g = this.g, kk = g.pk.get(id);
    if (!kk || kk.taken || !kk.on || dist(p.x, p.z, kk.x, kk.z) > 3 || p.role === 'monster') return;
    if (kk.needDive && !(p.dive || depthAt(kk.x, kk.z, g.tideT, this.tideOff()) < 1.6)) return;
    const t = kk.type;
    kk.taken = true; p.stats.picks++;
    const ev = { k: 'take', id, by: p.id, ty: t };
    switch (t) {
      case 'crumb': g.crumb++; ev.n = g.crumb; if (g.crumb === 4 && g.ai && !g.rushDone) this.spawnRush(p); if (g.crumb >= 6) { this.sealOn(0); ev.done = 1; } break;
      case 'key': g.key++; ev.n = g.key; if (g.key >= 5) { g.open.chain = true; this.sealOn(1); ev.done = 1; g.ev.push({ k: 'gate', id: 'chain' }); } break;
      case 'trophy': g.trophy++; p.stats.trophies++; ev.n = g.trophy; if (g.trophy >= 4) { this.sealOn(3); ev.done = 1; } break;
      case 'toasterkey': g.toasterKey = true; break;
      case 'knife': case 'jam': p.inv[t] = 1; this.send(p, { t: 'inv', inv: p.inv }); break;
      case 'butter': case 'can': case 'duck': case 'stress': p.inv[t] = Math.min(6, (p.inv[t] || 0) + 1); this.send(p, { t: 'inv', inv: p.inv }); break;
      case 'coin': g.coins += (kk.n || 1) + (p.up.rabbit ? 1 : 0); break;
      case 'log': g.logs.add(kk.i); p.stats.logs++; ev.i = kk.i; break;
      case 's67': g.s67.add(kk.i); p.stats.s67++; ev.i = kk.i; if (g.s67.size >= 15) { g.open.secret = true; g.ev.push({ k: 'gate', id: 'secret' }); this.bonusBike(); } break;
      case 'board': p.boardUntil = g.t + 14; break;
      case 'seal': this.takeSeal(p, kk); ev.i = kk.i; break;
      case 'bike': this.finish('secret'); break;
    }
    g.ev.push(ev);
    this.dirtyTeam = true;
  }
  bonusBike() { for (const k of this.g.pk.values()) if (k.type === 'bike') { k.on = true; this.g.ev.push({ k: 'add', pk: this.pkMsg(k) }); } }
  takeSeal(p, k) {
    const g = this.g; g.seals[k.i] = true; p.stats.seals++;
    g.cp = this.makeCheckpoint();
    const n = g.seals.filter(Boolean).length;
    if (n >= 4 && !g.open.aud && !g.seals[4]) { g.open.aud = true; g.ev.push({ k: 'gate', id: 'aud' }); if (!g.ai) this.sealOn(4); }
    if (k.i === 4) { g.bossDead = true; this.finish('win'); }
  }
  useToaster(p) {
    const g = this.g;
    if (dist(p.x, p.z, SPOTS.toaster.x, SPOTS.toaster.z) > 4.5) return;
    if (!g.toasterKey) { if (g.t - (p.cool.tk || -99) > 3) { p.cool.tk = g.t; this.send(p, { t: 'ev', ev: [{ k: 'nar', id: 'toaster_key' }] }); } return; }
    if (g.toasted) return;
    const gap = g.t - g.toastT; g.toastT = g.t;
    g.toastP += gap > 0.9 ? 0.2 : Math.min(gap, 0.4) * (this.nearCount(SPOTS.toaster, 5) > 1 ? 1.6 : 1);
    if (g.toastP >= 4) {
      g.toastP = 0;
      const loaf = g.enemies.find(e => e.kind === KIND.loaf);
      if (!g.ai || (loaf && dist(loaf.x, loaf.z, SPOTS.toaster.x, SPOTS.toaster.z) < 12)) {
        g.toasted = true; g.ev.push({ k: 'toasted' });
        if (loaf) { loaf.hp = 2; loaf.toasted = true; loaf.state = 5; loaf.cd = 2.5; }
        else { g.loafDone = true; this.sealOn(2); }
        this.dirtyTeam = true;
      } else g.ev.push({ k: 'toastFail' });
    }
  }
  nearCount(pt, r) { let n = 0; for (const p of this.players.values()) if (this.alive(p) && dist(p.x, p.z, pt.x, pt.z) < r) n++; return n; }

  onHide(p, m) {
    const g = this.g;
    if (!this.alive(p)) return;
    if (p.hidden) { p.hidden = null; return; }
    const h = this.W.hides.find(h => h.id === m.id);
    if (!h || dist(p.x, p.z, h.x, h.z) > h.r + 1) return;
    p.hidden = h.id; p.x = h.x; p.z = h.z;
    void g;
  }
  onShop(p, m) {
    const g = this.g, it = SHOP[m.item];
    if (!it || !this.alive(p) || dist(p.x, p.z, SPOTS.vend.x, SPOTS.vend.z) > 5) return;
    if (m.item === 'shield' && p.up.shield) return;
    if ((m.item === 'battery' || m.item === 'shoes' || m.item === 'rabbit') && p.up[m.item]) return;
    if (g.coins < it.cost) return this.send(p, { t: 'ev', ev: [{ k: 'shopFail' }] });
    g.coins -= it.cost; p.stats.coinsSpent += it.cost;
    if (m.item === 'shield') { p.up.shield = true; p.shield = true; }
    else if (m.item === 'hat') p.hatsOwned++;
    else p.up[m.item] = true;
    this.send(p, { t: 'up', up: p.up, hats: p.hatsOwned, shield: p.shield });
    this.bcastEv({ k: 'buy', id: p.id, item: m.item }); this.dirtyTeam = true;
  }
  onThrow(p, m) {
    const g = this.g;
    if (!this.alive(p) || p.hidden || p.role === 'monster' || g.t - p.throwT < 0.55) return;
    const item = m.item;
    if (!THROWABLES.includes(item) || !(p.inv[item] > 0)) return;
    p.inv[item]--; if (!p.inv[item]) delete p.inv[item]; p.throwT = g.t; p.stats.throws++;
    const yaw = +m.yaw || p.yaw, pitch = clamp(+m.pitch || 0, -1.2, 1.2), sp = 13;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fz = -Math.cos(yaw) * Math.cos(pitch), fy = Math.sin(pitch);
    g.proj.push({ id: g.nextId++, item, owner: p.id, x: p.x + fx * 0.6, y: 1.5, z: p.z + fz * 0.6, vx: fx * sp, vy: fy * sp + 2.2, vz: fz * sp, born: g.t });
    this.send(p, { t: 'inv', inv: p.inv });
  }
  onBeat(p, m) {
    const g = this.g, b = g.boss;
    if (!b || b.state !== 'roast' || !this.alive(p)) return;
    const ts = Number.isFinite(m.ts) ? m.ts : g.t;
    if (Math.abs(ts - g.t) > 0.8) return;
    const n = Math.round((ts - b.beat0) / b.beatDt);
    if (n < 0 || p.cool['b' + n]) return;
    p.cool['b' + n] = 1; delete p.cool['b' + (n - 6)];
    const err = Math.abs(ts - (b.beat0 + n * b.beatDt));
    let q = 'miss', gain = -1.2;
    if (err < 0.16) { q = 'perfect'; gain = 4.2; p.stats.perfect++; } else if (err < 0.3) { q = 'good'; gain = 2.2; }
    b.roast = clamp(b.roast + gain, 0, 100);
    this.send(p, { t: 'ev', ev: [{ k: 'beatq', q, n }] });
    this.bcastEv({ k: 'roast', v: r2(b.roast) });
  }
  onMonster(p, m) {
    const g = this.g;
    if (p.role !== 'monster' || p.down) return;
    const a = m.a, cd = g.monCd, t = g.t;
    if (a === 'tele' && t >= (cd.tele || 0)) {
      const c = p.crumbs.length > 1 ? p.crumbs[Math.max(0, p.crumbs.length - 6)] : null;
      if (c) { p.x = c.x; p.z = c.z; cd.tele = t + 12; this.bcastEv({ k: 'mon', a: 'tele', x: r2(p.x), z: r2(p.z) }); }
    } else if (a === 'decoy' && t >= (cd.decoy || 0)) {
      cd.decoy = t + 25; const e = this.newEnemy('decoy', p.x - Math.sin(p.yaw) * -2, p.z - Math.cos(p.yaw) * -2, { life: g.t + 22 }); void e;
      this.bcastEv({ k: 'mon', a: 'decoy' });
    } else if (a === 'bell' && t >= (cd.bell || 0)) {
      cd.bell = t + 30;
      for (const q of this.players.values()) if (q !== p && this.alive(q) && dist(q.x, q.z, p.x, p.z) < 28) q.frozen = t + 2;
      this.bcastEv({ k: 'mon', a: 'bell', x: r2(p.x), z: r2(p.z) });
    } else if (a === 'flood' && t >= (cd.flood || 0)) {
      cd.flood = t + 30; g.flood = { x: p.x, z: p.z, r: 9, until: t + 10 }; this.bcastEv({ k: 'mon', a: 'flood', x: r2(p.x), z: r2(p.z) });
    }
  }
  onDebug(p, m) {
    if (p.id !== this.hostId) return;
    const g = this.g, c = m.cmd; g.cheated = true;
    if (c === 'seal') { const i = clamp(m.n | 0, 0, 4); g.seals[i] = true; if (i < 4 && g.seals.filter(Boolean).length >= 4) { g.open.aud = true; g.ev.push({ k: 'gate', id: 'aud' }); } this.dirtyTeam = true; }
    else if (c === 'coins') { g.coins += 20; this.dirtyTeam = true; }
    else if (c === 'reveal') { g.ev.push({ k: 'reveal', list: [...g.pk.values()].filter(k => k.type === 's67' && !k.taken).map(k => ({ x: k.x, z: k.z })) }); }
    else if (c === 'tp') { const z = { atrium: SPOTS.spawn, canteen: SPOTS.display, scooter: SPOTS.shedSeal, bakery: SPOTS.toaster, abyss: SPOTS.podium, aud: { x: 92, z: -50 } }[m.zone]; if (z) { p.x = z.x; p.z = z.z + 3; this.send(p, { t: 'fix', x: p.x, z: p.z }); } }
    else if (c === 'bots') { for (let i = 0; i < 4 && this.players.size < 12; i++) { const b = this.makeBot(); this.placeAtSpawn(b, this.players.size); } this.broadcastRoom(); }
    else if (c === 'skip') { const i = g.seals.findIndex(s => !s); if (i >= 0 && i < 4) { g.seals[i] = true; if (g.seals.filter(Boolean).length >= 4) { g.open.aud = true; g.ev.push({ k: 'gate', id: 'aud' }); } this.dirtyTeam = true; } }
    else if (c === 'boss') { g.open.aud = true; g.ev.push({ k: 'gate', id: 'aud' }); }
    else if (c === 'time') { g.sunrise = Math.max(5, g.sunrise - 120); }
  }

  // ---------------- damage
  hit(p, src) {
    const g = this.g;
    if (!this.alive(p) || p.invuln > g.t || p.protect > g.t) return false;
    p.hidden = null;
    if (p.shield) { p.shield = false; p.up.shield = false; p.invuln = g.t + 1.5; this.bcastEv({ k: 'shield', id: p.id }); this.send(p, { t: 'up', up: p.up, hats: p.hatsOwned, shield: false }); return true; }
    p.hp--; p.invuln = g.t + 1.6; p.stats.hits++;
    if (p.hp <= 0) { p.down = true; p.hp = 0; p.downT = 0; p.reviveP = 0; p.stats.downs++; p.scooterUntil = 0; }
    this.bcastEv({ k: 'hit', id: p.id, hp: p.hp, down: p.down ? 1 : 0, src });
    return true;
  }

  // ---------------- main step
  tick() {
    const now = this.hub.now(), dt = clamp((now - this.lastT) / 1000, 0.02, 0.1); this.lastT = now;
    if (this.phase === 'countdown') { this.countdown -= dt; if (this.countdown <= 0) this.startRound(); return; }
    if (this.phase === 'playing' && this.g) this.step(dt);
    else if (this.phase === 'ended' && this.g) { this.g.endT += dt; this.flush(false); }
    // drop long-disconnected players
    for (const p of [...this.players.values()]) if (!p.bot && !p.connected && now - p.dcAt > 30000) this.removePlayer(p, 'timeout');
  }

  step(dt) {
    const g = this.g, W = this.W; g.t += dt; g.tick++;
    g.sunrise -= dt;
    const list = [...this.players.values()];
    const survivors = list.filter(p => p.role === 'survivor');
    // zones, narration, noise
    for (const p of list) {
      p.flags = (p.crouch ? FL.crouch : 0) | (p.sprint ? FL.sprint : 0) | (p.flash ? FL.flash : 0) | (p.down ? FL.down : 0) | (p.dead ? FL.dead : 0) | (p.hidden ? FL.hidden : 0) | (p.role === 'monster' ? FL.monster : 0) | (p.frozen > g.t ? FL.frozen : 0) | (p.scooterUntil > g.t ? FL.scooter : 0) | (p.boardUntil > g.t ? FL.board : 0) | (p.dive ? FL.dive : 0) | (p.hp === 1 && !p.down ? FL.limp : 0) | (p.reviving ? FL.rev : 0);
      if (!this.alive(p) && p.role !== 'monster') { p.noiseR = 0; }
      const z = zoneAt(p.x, p.z);
      if (z !== p.zone) { p.zone = z; if (!p.bot && z !== 'campus') { p.seen = p.seen || {}; if (!p.seen[z]) { p.seen[z] = 1; g.ev.push({ k: 'nar', id: 'zone_' + z, to: p.id }); } } }
      const depth = depthAt(p.x, p.z, g.tideT, this.tideOff());
      if (depth > 0.9) p.flags |= FL.swim;
      p.depth = depth;
      p.inGas = false;
      if (z === 'aud') for (const c of g.clouds) if (dist(p.x, p.z, c.x, c.z) < c.r) { p.inGas = true; p.flags |= FL.gas; break; }
      // noise radius
      const v = p.v; let n;
      if (p.hidden) n = 0.8; else if (v < 0.35) n = p.breath ? 0.6 : 1.8; else if (p.crouch) n = 3.5; else if (p.sprint) n = 20; else n = 9;
      if (p.scooterUntil > g.t) n = 28;
      if (depth > 0.35 && !p.dive && p.boardUntil < g.t && v > 0.5) n = Math.max(n, depth > 0.9 ? 15 : 12);
      if (p.dive) n = Math.min(n, 3.5);
      if (z === 'canteen' && v > 0.5 && p.sprint) n += 4;
      if (z === 'deck' && p.sprint) n += 3;
      if (p.up.shoes) n *= 0.62;
      if (g.mut) { if (g.mut.id === 'laugh') n *= 2; if (g.mut.id === 'scooters') n *= 1.4; }
      p.noiseR = n;
      if (p.role === 'monster') { const last = p.crumbs[p.crumbs.length - 1]; if (!last || dist(last.x, last.z, p.x, p.z) > 8) { p.crumbs.push({ x: p.x, z: p.z }); if (p.crumbs.length > 30) p.crumbs.shift(); } }
      if (p.hidden) p.stats.hideT += dt;
    }
    // bleed-out + revive
    for (const p of list) {
      if (p.down && !p.dead) {
        p.downT += dt;
        const rv = list.find(r => r.reviving === p.id && this.alive(r) && dist(r.x, r.z, p.x, p.z) < 2.6);
        if (rv) { p.reviveP += dt / 4; if (p.reviveP >= 1) { p.down = false; p.hp = 1; p.reviveP = 0; p.invuln = g.t + 2.5; rv.stats.revives++; this.bcastEv({ k: 'revive', id: p.id, by: rv.id }); } }
        else p.reviveP = Math.max(0, p.reviveP - dt * 0.4);
        if (p.downT > 60) { p.dead = true; p.down = false; this.bcastEv({ k: 'dead', id: p.id }); }
      }
    }
    this.tutorial(dt);
    this.bots(dt, list);
    this.world(dt);
    this.enemies(dt, survivors);
    this.monsterStep(dt, list);
    this.projectiles(dt);
    this.hazards(dt);
    this.boss(dt, survivors);
    this.mutators(dt, survivors);
    this.cameo(dt, survivors);
    // win / lose
    if (!g.result) {
      const live = survivors.filter(p => !p.dead && (p.connected || p.bot) && !p.down);
      if (g.sunrise <= 0) this.finish('sunrise');
      else if (survivors.length && !live.length && !survivors.some(p => !p.dead && !p.connected && !p.bot && g.t < p.dcAt)) this.finish('wiped');
    }
    this.flush(true);
  }

  tutorial(dt) {
    const g = this.g;
    if (g.frontOpen) {
      if (g.tutBot && g.t - g.frontOpenT > 10) { this.players.delete(g.tutBot); g.tutBot = null; this.broadcastRoom(); this.bcastEv({ k: 'nar', id: 'buddy_leaves' }); }
      return;
    }
    const a = SPOTS.plateA, b = SPOTS.plateB;
    let pa = false, pb = false;
    for (const p of this.players.values()) { if (!this.alive(p) || p.role === 'monster') continue; if (dist(p.x, p.z, a.x, a.z) < 1.5) pa = true; if (dist(p.x, p.z, b.x, b.z) < 1.5) pb = true; }
    g.plate.a = pa; g.plate.b = pb;
    if (pa && pb) { g.frontOpen = true; g.open.front = true; g.frontOpenT = g.t; g.ev.push({ k: 'gate', id: 'front' }); g.cp = this.makeCheckpoint(); }
  }

  bots(dt, list) {
    const g = this.g, W = this.W;
    const humans = list.filter(p => !p.bot && this.alive(p));
    for (const b of list) {
      if (!b.bot) continue;
      if (b.tut && !g.frontOpen) { b.x = SPOTS.plateB.x; b.z = SPOTS.plateB.z; continue; }
      if (!this.alive(b)) continue;
      b.botT -= dt;
      const lead = humans.slice().sort((p, q) => dist(p.x, p.z, b.x, b.z) - dist(q.x, q.z, b.x, b.z))[0];
      if (!lead) continue;
      // flee from nearby threats, revive downed humans, otherwise follow the nearest human
      let tx = lead.x, tz = lead.z, speed = 4.4, flee = null;
      for (const e of g.enemies) if (e.kind !== KIND.audience && dist(e.x, e.z, b.x, b.z) < 9) flee = e;
      const downed = list.find(p => p.down && !p.dead && dist(p.x, p.z, b.x, b.z) < 30);
      if (flee) { const dx = b.x - flee.x, dz = b.z - flee.z, d = Math.hypot(dx, dz) || 1; tx = b.x + dx / d * 8; tz = b.z + dz / d * 8; speed = 6.4; b.sprint = true; }
      else if (downed) { tx = downed.x; tz = downed.z; b.reviving = dist(downed.x, downed.z, b.x, b.z) < 2.2 ? downed.id : 0; speed = 5.2; }
      else { b.reviving = 0; b.sprint = false; }
      const d = dist(tx, tz, b.x, b.z);
      if (!flee && !downed && d < 4.5) { b.v = 0; continue; }
      if (b.botT <= 0 || !b.path) { b.botT = 0.7; b.path = findPath(W, b.x, b.z, tx, tz, 9000); b.pi = 0; }
      const wp = b.path && b.path[Math.min(b.pi, b.path.length - 1)];
      if (!wp) continue;
      if (dist(wp.x, wp.z, b.x, b.z) < 0.7 && b.pi < b.path.length - 1) b.pi++;
      const dx = wp.x - b.x, dz = wp.z - b.z, dd = Math.hypot(dx, dz) || 1, step = Math.min(dd, speed * dt);
      const rr = resolve(W, b.x + dx / dd * step, b.z + dz / dd * step, 0.38, closedGates(W, g.open));
      b.v = Math.hypot(rr.x - b.x, rr.z - b.z) / dt; b.x = rr.x; b.z = rr.z; b.yaw = Math.atan2(-dx, -dz);
      // opportunistic pickups so the bot looks alive
      if (g.tick % 10 === 0) for (const k of g.pk.values()) if (!k.taken && k.on && ['coin', 'battery', 'snack', 'can', 'duck', 'stress', 'butter'].includes(k.type) && dist(k.x, k.z, b.x, b.z) < 2.2) { this.takePk(b, k.id); break; }
    }
  }

  tideOff() { const g = this.g; return (g.surge || 0) + (g.chaosFlood ? 0.9 : 0); }
  world(dt) {
    const g = this.g;
    g.tideT += dt;
    // surges: warn, then spike the water level and decay
    g.nextSurge -= dt;
    if (g.nextSurge <= 0) { g.surgeWarn = 3; g.nextSurge = 80 + g.rnd() * 30; g.ev.push({ k: 'surgeWarn' }); }
    if (g.surgeWarn > 0) { g.surgeWarn -= dt; if (g.surgeWarn <= 0) { g.surge = 1.0; g.ev.push({ k: 'surge' }); } }
    if (g.surge > 0) g.surge = Math.max(0, g.surge - dt * 0.12);
    // laugh track cycle
    const L = g.laugh; L.t += dt;
    const dur = { quiet: 6, rise: 5, loud: 4, fall: 5 }[L.phase];
    if (L.t >= dur) { L.t = 0; L.phase = { quiet: 'rise', rise: 'loud', loud: 'fall', fall: 'quiet' }[L.phase]; g.ev.push({ k: 'laugh', ph: L.phase }); }
    L.level = { quiet: 0.05, rise: 0.2 + 0.6 * (L.t / 5), loud: 1, fall: 0.8 * (1 - L.t / 5) }[L.phase];
    // drifting stink clouds
    for (const c of g.clouds) { c.t -= dt; if (c.t <= 0) { c.t = 4 + g.rnd() * 4; const a = g.rnd() * 6.28; c.vx = Math.cos(a) * 0.8; c.vz = Math.sin(a) * 0.8; } c.x = clamp(c.x + c.vx * dt, RECT.aud.x0 + 6, RECT.aud.x1 - 6); c.z = clamp(c.z + c.vz * dt, -92, -30); }
    if (g.flood && g.t > g.flood.until) g.flood = null;
    // Broke Mode: coins slowly vanish while anyone is in the canteen
    g.brokeT = (g.brokeT || 0) + dt;
    if (g.brokeT > 22) { g.brokeT = 0; if (g.coins > 0 && [...this.players.values()].some(p => p.zone === 'canteen' && this.alive(p))) { g.coins--; this.dirtyTeam = true; g.ev.push({ k: 'broke' }); } }
    // noise events decay
    for (let i = g.noises.length - 1; i >= 0; i--) if (g.t - g.noises[i].t > 1.6) g.noises.splice(i, 1);
  }

  // ---------------- enemy AI
  noiseFor(e, d) {
    // strongest audible noise source for this enemy: players' footsteps + landed throwables
    const g = this.g, W = this.W; let best = null, bs = 0;
    const hear = d.hear; if (!hear) return null;
    for (const p of this.players.values()) {
      if (!this.alive(p) || p.role === 'monster' || p.protect > g.t) continue;
      if (p.inGas) { if (dist(p.x, p.z, e.x, e.z) > 2.5) continue; }
      const dd = dist(p.x, p.z, e.x, e.z); let r = p.noiseR * hear * (g.mut && g.mut.id === 'blackout' ? 1.15 : 1);
      if (g.t - g.radioT < 1.5) r += 6;
      if (dd < r) { const direct = dd < 6 || los(W, e.x, e.z, p.x, p.z, 0.2); if (direct || dd < r * 0.55) { const s = r - dd; if (s > bs) { bs = s; best = { x: p.x, z: p.z, p, kind: 'step' }; } } }
    }
    for (const n of g.noises) { const dd = dist(n.x, n.z, e.x, e.z); if (dd < n.r * (hear > 1 ? 1.1 : 1) + (n.kind === 'butter' && e.kind === KIND.loaf ? 20 : 0)) { const s = (n.kind === 'butter' && e.kind === KIND.loaf ? 90 : 1) + n.r - dd; if (s > bs) { bs = s; best = { x: n.x, z: n.z, kind: n.kind }; } } }
    return best;
  }
  sees(e, p, d) {
    const g = this.g;
    if (!d.sight || !this.alive(p) || p.hidden || p.role === 'monster' || p.protect > g.t) return false;
    const dx = p.x - e.x, dz = p.z - e.z, dd = Math.hypot(dx, dz);
    if (p.inGas && dd > 2.5) return false;
    let range = d.sight * (p.crouch ? 0.6 : 1) * (p.flash ? 1.3 : 1) * (g.mut ? (g.mut.id === 'fog' ? 0.6 : g.mut.id === 'blackout' ? 1.2 : 1) : 1);
    if (dd > range) return false;
    if (dd > 2.5) { const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw); if ((fx * dx + fz * dz) / dd < Math.cos(d.fov)) return false; }
    return los(this.W, e.x, e.z, p.x, p.z, 0.1);
  }
  inHome(e, p, d) {
    if (!d.zone) return true; const r = RECT[d.zone], m = d.margin;
    return p.x > r.x0 - m && p.x < r.x1 + m && p.z > r.z0 - m && p.z < r.z1 + m;
  }
  moveTo(e, tx, tz, speed, dt, noPath) {
    const W = this.W, g = this.g;
    let wp = { x: tx, z: tz };
    if (!noPath) {
      e.repath -= dt;
      if (e.repath <= 0 || !e.path || dist(e.ptx || 0, e.ptz || 0, tx, tz) > 5) { e.path = findPath(W, e.x, e.z, tx, tz, 6000); e.pi = 0; e.repath = 0.6 + Math.random() * 0.3; e.ptx = tx; e.ptz = tz; }
      if (e.path && e.path.length) { wp = e.path[Math.min(e.pi, e.path.length - 1)]; if (dist(wp.x, wp.z, e.x, e.z) < 0.9 && e.pi < e.path.length - 1) { e.pi++; wp = e.path[e.pi]; } }
    }
    const dx = wp.x - e.x, dz = wp.z - e.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    const rr = resolve(W, e.x + dx / d * step, e.z + dz / d * step, Math.min(e.d.r, 0.7), closedGates(W, g.open));
    const moved = Math.hypot(rr.x - e.x, rr.z - e.z);
    e.x = rr.x; e.z = rr.z; e.yaw = Math.atan2(-dx, -dz);
    e.stuck = moved < step * 0.2 ? e.stuck + dt : 0;
    if (e.stuck > 0.8) { e.stuck = 0; e.repath = 0; e.path = null; }
    return moved;
  }
  wander(e, dt, speed) {
    const W = this.W, g = this.g;
    e.wt -= dt;
    if (e.wt <= 0 || dist(e.wx, e.wz, e.x, e.z) < 1.5) {
      const list = e.home === 'canteen' ? W.cand.canteen : e.home === 'bakery' ? W.cand.bakery : e.home === 'scooter' ? W.cand.scooter : e.home === 'abyss' ? W.cand.abyssShore : [{ x: e.x, z: e.z }];
      const c = list[Math.floor(g.rnd() * list.length)]; e.wx = c.x; e.wz = c.z; e.wt = 8 + g.rnd() * 6;
    }
    this.moveTo(e, e.wx, e.wz, speed, dt);
  }
  scare(p, kind) {
    const g = this.g; if (p.bot || g.t - p.lastScare < (this.settings.scare === 2 ? 9 : this.settings.scare === 0 ? 40 : 18)) return;
    p.lastScare = g.t; this.send(p, { t: 'ev', ev: [{ k: 'scare', kind }] });
  }
  enemies(dt, survivors) {
    const g = this.g, em = g.em;
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i], d = e.d;
      if (e.life && g.t > e.life) { g.enemies.splice(i, 1); continue; }
      if (e.cd > 0) e.cd -= dt;
      switch (e.kind) {
        case KIND.handshake: case KIND.decoy: this.updHandshake(e, dt, survivors, i); break;
        case KIND.audience: this.updAudience(e, dt, survivors); break;
        case KIND.wraith: this.updWraith(e, dt, survivors); break;
        case KIND.boss: break;
        default: this.updHunter(e, dt, survivors, em);
      }
    }
    if (g.respawnHs && g.t > g.respawnHs.t) { const c = this.W.cand.scooter[Math.floor(g.rnd() * this.W.cand.scooter.length)]; this.newEnemy('handshake', c.x, c.z); g.respawnHs = null; }
  }
  updHunter(e, dt, survivors, em) {
    const g = this.g, d = e.d, W = this.W;
    if (e.kind === KIND.rush && g.t - e.born > 30) { e.life = g.t - 1; this.bcastEv({ k: 'rushEnd' }); return; }
    const vis = survivors.filter(p => this.inHome(e, p, d));
    let target = null, td = 1e9;
    for (const p of vis) { if (this.sees(e, p, d)) { const dd = dist(p.x, p.z, e.x, e.z); if (dd < td) { td = dd; target = p; } } }
    const heard = target ? null : this.noiseFor(e, d);
    if (e.kind === KIND.stalker && !target) { // smells sprint footprints in the sprinkles
      for (const p of vis) if (p.zone === 'canteen' && p.sprint && dist(p.x, p.z, e.x, e.z) < 16) { target = p; break; }
    }
    if (e.kind === KIND.rush && !target) { let bd = 1e9; for (const p of vis) { const dd = dist(p.x, p.z, e.x, e.z); if (this.alive(p) && dd < bd) { bd = dd; target = p; } } }
    const sp = (e.state === 2 ? d.hunt : e.state === 1 ? d.patrol * 1.5 : d.patrol) * em * (e.toasted ? 1.18 : 1);
    // butter: loaf stops to eat
    if (e.kind === KIND.loaf && e.state === 4) { e.cd -= 0; e.aux -= dt; if (e.aux <= 0) { e.state = 3; e.seenT = g.t; } return; }
    if (e.kind === KIND.loaf && e.state === 5) { if (e.cd <= 0) e.state = 1; return; } // stunned by a hit / toasting
    if (target) {
      if (e.state !== 2) { this.scare(target, e.kind === KIND.loaf ? 'loaf' : 'chase'); this.bcastEv({ k: 'alert', e: e.id }); }
      e.state = 2; e.tgt = target.id; e.lx = target.x; e.lz = target.z; e.seenT = g.t;
    } else if (heard) {
      if (heard.kind === 'butter' && e.kind === KIND.loaf) {
        e.state = 1; e.lx = heard.x; e.lz = heard.z; e.seenT = g.t;
        if (dist(e.x, e.z, heard.x, heard.z) < 2.6) { e.state = 4; e.aux = 6; for (let j = g.noises.length - 1; j >= 0; j--) if (g.noises[j].kind === 'butter') g.noises.splice(j, 1); this.bcastEv({ k: 'loafEat', e: e.id }); return; }
      } else if (e.state < 2) { e.state = 1; e.lx = heard.x; e.lz = heard.z; e.seenT = g.t; }
      else { e.lx = heard.x; e.lz = heard.z; e.seenT = g.t; }
    }
    if (e.state === 2) {
      const tp = this.players.get(e.tgt);
      if (!tp || !this.alive(tp) || !this.inHome(e, tp, d)) { e.state = 3; e.seenT = g.t; }
      else {
        if (g.t - e.seenT > 4.5) { e.state = 3; e.seenT = g.t; }
        this.moveTo(e, e.lx, e.lz, sp, dt, target && dist(target.x, target.z, e.x, e.z) < 6 && los(W, e.x, e.z, target.x, target.z, 0.4, null, true));
        if (tp && this.alive(tp) && dist(tp.x, tp.z, e.x, e.z) < d.reach + 0.3 && e.cd <= 0) { e.cd = e.kind === KIND.loaf ? 2.2 : 1.5; this.hit(tp, e.kind); if (e.kind === KIND.loaf) { e.aux = 0; } }
        // pull a hiding player out of a locker if we stand right next to it
        for (const p of survivors) if (p.hidden && dist(p.x, p.z, e.x, e.z) < 1.7) { this.hit(p, e.kind); }
      }
    } else if (e.state === 1) {
      this.moveTo(e, e.lx, e.lz, sp, dt);
      if (dist(e.lx, e.lz, e.x, e.z) < 1.5 || g.t - e.seenT > 8) { e.state = 3; e.seenT = g.t; }
    } else if (e.state === 3) {
      if (e.kind === KIND.loaf && e.aux > 0) e.aux = 0;
      this.wander(e, dt, d.patrol * em * 1.2);
      if (g.t - e.seenT > 9) e.state = 0;
      for (const p of survivors) if (p.hidden && dist(p.x, p.z, e.x, e.z) < 1.7) this.hit(p, e.kind);
    } else {
      this.wander(e, dt, d.patrol * em);
    }
    if (e.kind === KIND.loaf && e.state === 2 && e.cd > 0) { /* heavy recovery after a swing */ }
    // squash hides: a rumbling loaf ruins the player's lunch
  }
  updHandshake(e, dt, survivors, idx) {
    const g = this.g, d = e.d;
    let seen = false;
    for (const p of survivors) {
      if (!this.alive(p) || p.hidden) continue;
      const dx = e.x - p.x, dz = e.z - p.z, dd = Math.hypot(dx, dz);
      if (dd > 48) continue;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      if ((fx * dx + fz * dz) / (dd || 1) > 0.5 && los(this.W, p.x, p.z, e.x, e.z, 0.1)) { seen = true; break; }
    }
    e.frozen = seen; e.state = seen ? 1 : 2;
    let target = null, td = 1e9;
    for (const p of survivors) if (this.alive(p) && p.scooterUntil < g.t && (e.kind === KIND.decoy || this.inHome(e, p, d))) { const dd = dist(p.x, p.z, e.x, e.z); if (dd < td) { td = dd; target = p; } }
    if (seen) return;
    if (!target) { this.wander(e, dt, d.patrol); return; }
    this.moveTo(e, target.x, target.z, d.hunt * g.em, dt, td < 8);
    if (td < d.reach) {
      if (e.kind === KIND.decoy) { this.hit(target, 'decoy'); e.life = g.t - 1; return; }
      target.scooterUntil = g.t + 7; target.rideSafe = false; target.stats.handshakes++;
      target.hidden = null;
      this.bcastEv({ k: 'handshake', id: target.id }); this.scare(target, 'hand');
      g.enemies.splice(idx, 1); g.respawnHs = { t: g.t + 24 };
      // reward for surviving the ride is paid when it expires
      target.rideEnd = g.t + 7;
    }
  }
  updAudience(e, dt, survivors) {
    const g = this.g, L = g.laugh, W = this.W;
    if (g.boss && g.boss.state !== 'dormant') { // while the Last Bell performs they just watch
      if (e.state !== 0) { e.state = 0; e.x = e.sx; e.z = e.sz; } return;
    }
    if (e.state === 0) {
      if (L.phase === 'loud' || (L.phase === 'rise' && L.t > 3)) {
        let best = null, bd = 18;
        for (const p of survivors) if (this.alive(p) && p.zone === 'aud' && p.v > 0.9 && !p.inGas) { const dd = dist(p.x, p.z, e.x, e.z); if (dd < bd) { bd = dd; best = p; } }
        if (best) { e.state = 1; e.tgt = best.id; this.scare(best, 'laugh'); }
      }
    } else if (e.state === 1) {
      const p = this.players.get(e.tgt);
      if (!p || !this.alive(p) || L.phase === 'quiet' || L.phase === 'fall' && L.t > 2.5) { e.state = 2; return; }
      this.moveTo(e, p.x, p.z, e.d.hunt * g.em, dt, true);
      if (dist(p.x, p.z, e.x, e.z) < e.d.reach + 0.3 && e.cd <= 0) { e.cd = 2; this.hit(p, 'audience'); e.state = 2; }
    } else if (e.state === 2) {
      this.moveTo(e, e.sx, e.sz, 4, dt, true);
      if (dist(e.sx, e.sz, e.x, e.z) < 0.6) { e.state = 0; e.x = e.sx; e.z = e.sz; }
    }
    void W;
  }
  updWraith(e, dt, survivors) {
    const g = this.g, W = this.W, d = e.d, off = this.tideOff();
    const depth = depthAt(e.x, e.z, g.tideT, off);
    e.aux = depth > 0.6 ? 1 : 0;
    let target = null, bs = 0;
    for (const p of survivors) {
      if (!this.alive(p) || p.protect > g.t || p.hidden) continue;
      const pd = depthAt(p.x, p.z, g.tideT, off); if (pd < 0.3) continue;
      const dd = dist(p.x, p.z, e.x, e.z), r = p.noiseR * d.hear;
      if (p.boardUntil > g.t) continue;
      if (dd < r && (r - dd) > bs) { bs = r - dd; target = p; }
      else if (dd < 6 && !p.dive) { target = p; }
    }
    if (target) {
      if (e.state !== 2) this.scare(target, 'wraith');
      e.state = 2; e.tgt = target.id;
      const slow = depth < 0.3 ? 0.35 : 1;
      this.moveTo(e, target.x, target.z, d.hunt * g.em * slow, dt, true);
      if (dist(target.x, target.z, e.x, e.z) < d.reach && e.cd <= 0) { e.cd = 2.2; if (this.hit(target, 'wraith')) this.bcastEv({ k: 'drag', id: target.id }); }
    } else {
      e.state = 0;
      // lurk: drift toward the nearest pit when the tide is low
      let bp = PITS[0], bd = 1e9; for (const p of PITS) { const dd = dist(p.x, p.z, e.x, e.z); if (dd < bd) { bd = dd; bp = p; } }
      if (bd > 2.5) this.moveTo(e, bp.x, bp.z, d.patrol, dt, true);
    }
  }
  spawnRush(trigger) {
    const g = this.g, W = this.W; g.rushDone = true;
    const far = W.cand.canteen.slice().sort((a, b) => dist(b.x, b.z, trigger.x, trigger.z) - dist(a.x, a.z, trigger.x, trigger.z))[0];
    this.newEnemy('rush', far.x, far.z); this.bcastEv({ k: 'rush' });
  }

  // ---------------- monster mode
  monsterStep(dt, list) {
    const g = this.g;
    const m = list.find(p => p.role === 'monster'); if (!m) return;
    for (const p of list) {
      if (p === m || !this.alive(p)) continue;
      if (dist(p.x, p.z, m.x, m.z) < 1.9 && !p.hidden) { if (g.t - (m.cool['h' + p.id] || -9) > 1.2) { m.cool['h' + p.id] = g.t; this.hit(p, 'monster'); } }
      else if (p.hidden && dist(p.x, p.z, m.x, m.z) < 1.6) { this.hit(p, 'monster'); }
      if (g.flood && dist(p.x, p.z, g.flood.x, g.flood.z) < g.flood.r) p.flags |= FL.swim;
    }
  }

  // ---------------- projectiles / hazards
  projectiles(dt) {
    const g = this.g, W = this.W;
    for (let i = g.proj.length - 1; i >= 0; i--) {
      const q = g.proj[i];
      if (q.hostile) { this.hostileProj(q, dt, i); continue; }
      let dead = false;
      for (let s = 0; s < 2 && !dead; s++) {
        const h = dt / 2; q.vy -= 14 * h; q.x += q.vx * h; q.y += q.vy * h; q.z += q.vz * h;
        if (q.y < 0.1) { q.y = 0.1; dead = true; }
        else if (q.y < 3.2 && inWall(W, q.x, q.z, 0.12, closedGates(W, g.open))) { q.x -= q.vx * h; q.z -= q.vz * h; dead = true; }
        if (!dead) {
          for (const e of g.enemies) {
            if (e.kind === KIND.audience) continue;
            const hr = e.kind === KIND.boss ? 2.3 : e.kind === KIND.loaf ? 1.8 : 0.9, hh = e.kind === KIND.boss ? 4 : e.kind === KIND.loaf ? 2.8 : 2.2;
            if (q.y < hh && dist(q.x, q.z, e.x, e.z) < hr) { this.projectileHit(q, e); dead = true; break; }
          }
        }
      }
      if (dead || g.t - q.born > 5) { if (dead && q.y <= 0.2 + 0.001 || dead) this.land(q); g.proj.splice(i, 1); }
    }
  }
  land(q) {
    const g = this.g, r = { can: 24, duck: 16, stress: 10, butter: 8, knife: 14, jam: 16 }[q.item] || 10;
    g.noises.push({ x: q.x, z: q.z, r, t: g.t, kind: q.item });
    this.bcastEv({ k: 'land', x: r2(q.x), z: r2(q.z), item: q.item });
  }
  projectileHit(q, e) {
    const g = this.g, owner = this.players.get(q.owner); if (owner) owner.stats.thrownHits++;
    this.bcastEv({ k: 'impact', x: r2(q.x), z: r2(q.z), item: q.item, e: e.id });
    if (e.kind === KIND.loaf) {
      if (owner) owner.stats.loafHits++;
      if (e.toasted && (q.item === 'jam' || q.item === 'knife')) {
        e.hp--; e.state = 5; e.cd = 2; this.bcastEv({ k: 'loafHurt', hp: e.hp });
        if (e.hp <= 0) { e.life = g.t - 1; g.loafDone = true; g.loafDead = true; this.sealOn(2); this.bcastEv({ k: 'loafDead', by: q.owner }); this.dirtyTeam = true; }
      } else if (q.item === 'butter') { e.state = 1; e.lx = q.x; e.lz = q.z; }
      else { e.state = 5; e.cd = 1.2; }
    } else if (e.kind === KIND.boss) this.bossHit(q, owner);
    else if (e.kind === KIND.stalker || e.kind === KIND.rush) { e.state = 5; e.cd = 0.8; e.state = 2; }
  }
  hostileProj(q, dt, i) {
    const g = this.g, W = this.W;
    q.x += q.vx * dt; q.z += q.vz * dt; q.y = 1.2;
    if (g.t - q.born > 4 || inWall(W, q.x, q.z, 0.2)) { g.proj.splice(i, 1); return; }
    for (const p of this.players.values()) if (this.alive(p) && p.role === 'survivor' && dist(p.x, p.z, q.x, q.z) < 0.85) { this.hit(p, 'doughnut'); g.proj.splice(i, 1); return; }
  }
  hazards(dt) {
    const g = this.g;
    for (let i = g.haz.length - 1; i >= 0; i--) {
      const h = g.haz[i];
      if (g.t >= h.at) { for (const p of this.players.values()) if (this.alive(p) && p.role === 'survivor' && dist(p.x, p.z, h.x, h.z) < h.r) this.hit(p, 'bread'); g.haz.splice(i, 1); }
    }
  }
  rain(x, z, delay = 1.2) { const g = this.g; if (g.haz.length < 20) g.haz.push({ x, z, r: 2.3, at: g.t + delay, t0: g.t }); }

  // ---------------- boss: The Last Bell
  boss(dt, survivors) {
    const g = this.g, W = this.W;
    if (!g.ai || g.bossDead) return;
    let b = g.boss;
    if (!b) {
      if (!g.open.aud) return;
      const near = survivors.find(p => this.alive(p) && dist(p.x, p.z, SPOTS.stage.x, SPOTS.stage.z) < 24 && p.zone === 'aud');
      if (!near) return;
      const e = this.newEnemy('boss', SPOTS.stage.x, SPOTS.stage.z - 2, { hp: 100 });
      b = g.boss = { e, hp: 100, phase: 1, state: 'intro', t: 0, tDough: 2.5, tCharge: 9, tRain: 1, charge: null, stun: 0, roast: 0, beat0: 0, beatDt: 0.625, flood: false, tVolley: 3, beatN: -1, invuln: 0 };
      this.bcastEv({ k: 'bossStart' }); return;
    }
    const e = b.e; b.t += dt;
    if (b.invuln > 0) b.invuln -= dt;
    const alive = survivors.filter(p => this.alive(p) && p.zone === 'aud');
    const tgt = alive.slice().sort((p, q) => dist(p.x, p.z, e.x, e.z) - dist(q.x, q.z, e.x, e.z))[0];
    e.aux = b.phase; e.state = b.state === 'intro' ? 0 : b.state === 'roast' ? 4 : b.stun > 0 ? 5 : b.charge ? 3 : 2;
    if (b.state === 'intro') { if (b.t > 4) { b.state = 'fight'; b.t = 0; this.bcastEv({ k: 'phase', n: 1 }); } return; }
    if (b.state === 'dead') return;
    const em = g.em;
    const throwAt = (p, spread) => {
      const lead = 0.25, tx = p.x - Math.sin(p.yaw) * 0 + (p.v > 1 ? 0 : 0), tz = p.z;
      let dx = tx - e.x, dz = tz - e.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const a = Math.atan2(dz, dx) + spread; void lead;
      g.proj.push({ id: g.nextId++, item: 'doughnut', hostile: true, owner: 0, x: e.x, y: 1.5, z: e.z, vx: Math.cos(a) * 11 * em, vz: Math.sin(a) * 11 * em, born: g.t });
    };
    if (b.state === 'fight') {
      if (b.stun > 0) b.stun -= dt;
      // drift along the stage front toward the nearest player
      if (tgt && !b.charge && b.stun <= 0) { const tx = clamp(tgt.x, RECT.aud.x0 + 8, RECT.aud.x1 - 8), tz = clamp(e.z, -92, -80); const dx = tx - e.x; e.x += clamp(dx, -1, 1) * Math.min(Math.abs(dx), 3.2 * dt * em); e.z = tz; e.yaw = tgt ? Math.atan2(-(tgt.x - e.x), -(tgt.z - e.z)) : e.yaw; }
      if (tgt && b.stun <= 0 && !b.charge) {
        b.tDough -= dt; if (b.tDough <= 0) { b.tDough = (b.phase === 1 ? 3.6 : 2.4) / em; throwAt(tgt, 0); if (b.phase === 2) { throwAt(tgt, 0.3); throwAt(tgt, -0.3); } }
        b.tCharge -= dt;
        if (b.tCharge <= 0) { b.tCharge = (b.phase === 1 ? 12 : 9) / em; const dx = tgt.x - e.x, dz = tgt.z - e.z, d = Math.hypot(dx, dz) || 1; b.charge = { dx: dx / d, dz: dz / d, t: 0, tele: 1.4, x0: e.x, z0: e.z }; this.bcastEv({ k: 'charge', x: r2(e.x), z: r2(e.z), dx: r2(dx / d), dz: r2(dz / d) }); }
      }
      if (b.charge) {
        const c = b.charge; c.t += dt;
        if (c.t > c.tele) {
          e.x += c.dx * 15 * dt; e.z += c.dz * 15 * dt; e.yaw = Math.atan2(-c.dx, -c.dz);
          for (const p of alive) if (dist(p.x, p.z, e.x, e.z) < 2.2) this.hit(p, 'boss');
          if (c.t > c.tele + 1.4 || e.z > -34 || e.x < RECT.aud.x0 + 4 || e.x > RECT.aud.x1 - 4) { b.charge = null; b.stun = 3.2; e.z = clamp(e.z, -92, -34); this.bcastEv({ k: 'bossStun' }); }
        }
      }
      if (b.phase === 2 && !b.charge) {
        b.tRain -= dt;
        if (b.tRain <= 0) { b.tRain = 1.3 / em; for (const p of alive.slice(0, 3)) this.rain(p.x + (Math.random() - 0.5) * 5, p.z + (Math.random() - 0.5) * 5); this.rain(RECT.aud.x0 + 6 + Math.random() * 52, -40 - Math.random() * 40); }
      }
    }
    if (b.state === 'roast') {
      e.x += (SPOTS.stage.x - e.x) * Math.min(1, dt); e.z += ((SPOTS.stage.z - 2) - e.z) * Math.min(1, dt);
      const n = Math.floor((g.t - b.beat0) / b.beatDt);
      if (n > b.beatN) { b.beatN = n; g.ev.push({ k: 'beat', n, at: r2(b.beat0 + n * b.beatDt) }); }
      b.roast = Math.max(0, b.roast - dt * 0.35);
      b.tVolley -= dt;
      if (b.tVolley <= 0 && alive.length) { b.tVolley = 4.5 / em; const p = alive[Math.floor(Math.random() * alive.length)]; throwAt(p, 0); throwAt(p, 0.35); throwAt(p, -0.35); }
      if (b.roast >= 100) {
        b.state = 'dead'; g.bossDead = true; e.life = g.t + 0.1; this.bcastEv({ k: 'bossDead' }); this.sealOn(4); this.dirtyTeam = true;
        const sp = SPOTS.stage; this.bcastEv({ k: 'nar', id: 'boss_dead' }); void sp;
      }
    }
    // phase transitions
    if (b.state === 'fight') {
      if (b.phase === 1 && b.hp <= 66) { b.phase = 2; b.invuln = 2; b.tDough = 2; b.charge = null; b.flood = true; this.bcastEv({ k: 'phase', n: 2 }); }
      else if (b.phase === 2 && b.hp <= 33) { b.phase = 3; b.state = 'roast'; b.charge = null; b.roast = 8; b.beat0 = g.t + 3; b.beatN = -1; b.tVolley = 6; g.haz.length = 0; b.flood = true; this.bcastEv({ k: 'phase', n: 3, beat0: r2(b.beat0), dt: b.beatDt }); }
    }
  }
  bossHit(q, owner) {
    const g = this.g, b = g.boss;
    if (!b || b.state !== 'fight' || b.invuln > 0) return;
    const base = { can: 4, duck: 3, stress: 3, butter: 5, knife: 6, jam: 8 }[q.item] || 3;
    const dmg = base * (b.stun > 0 ? 2.5 : 1);
    const floor = b.phase === 1 ? 66 : 33;
    b.hp = Math.max(floor, b.hp - dmg);
    if (owner) owner.stats.bossDmg += dmg;
    this.bcastEv({ k: 'bossHit', hp: r2(b.hp) });
  }

  // ---------------- chaos mutators + cameos
  mutators(dt, survivors) {
    const g = this.g;
    if (this.settings.mode !== 'chaos') return;
    if (g.mut) {
      if (g.t > g.mut.until) { g.ev.push({ k: 'mutEnd', id: g.mut.id }); g.chaosFlood = false; g.mut = null; g.nextMut = g.t + 40; }
      else if (g.mut.id === 'breadrain') { g.mutT -= dt; if (g.mutT <= 0) { g.mutT = 1.8; for (const p of survivors) if (this.alive(p)) this.rain(p.x + (Math.random() - 0.5) * 8, p.z + (Math.random() - 0.5) * 8, 1.4); } }
    } else if (g.t > g.nextMut && g.frontOpen) {
      const id = MUTATORS[Math.floor(g.rnd() * MUTATORS.length)];
      g.mut = { id, until: g.t + 25 }; g.mutT = 0; if (id === 'flood') g.chaosFlood = true;
      g.ev.push({ k: 'mut', id, until: r2(g.mut.until - g.t) });
    }
  }
  cameo(dt, survivors) {
    const g = this.g; g.cameoT -= dt;
    if (g.cameoT > 0 || this.settings.scare === 0) return;
    g.cameoT = 150 + g.rnd() * 90;
    const p = survivors.filter(p => this.alive(p) && !p.bot && p.zone !== 'atrium' && p.zone !== 'aud')[0];
    if (!p) return;
    const a = p.yaw + (g.rnd() - 0.5) * 0.8, dx = -Math.sin(a), dz = -Math.cos(a);
    for (let d = 22; d >= 10; d -= 4) { const x = p.x + dx * d, z = p.z + dz * d; if (!inWall(this.W, x, z, 1) && los(this.W, p.x, p.z, x, z, 0.3)) { this.send(p, { t: 'ev', ev: [{ k: 'cameo', x: r2(x), z: r2(z) }] }); return; } }
  }

  // ---------------- end of run
  finish(result) {
    const g = this.g; if (g.result) return;
    g.result = result; g.endT = 0; g.doneAt = g.t;
    const win = result === 'win' || result === 'secret';
    this.phase = 'ended';
    const players = [...this.players.values()].filter(p => !p.bot).map(p => ({ id: p.id, name: p.name, role: p.role, stats: p.stats }));
    this.bcast({
      t: 'end', result, win, cheated: !!g.cheated, time: r2(g.t), seals: g.seals.filter(Boolean).length, logs: g.logs.size, s67: g.s67.size, coins: g.coins, canRetry: !win && !!g.cp, players,
      monsterWon: this.settings.mode === 'monster' && !win,
    });
    this.broadcastRoom();
  }

  // ---------------- snapshots
  teamMsg() {
    const g = this.g, boss = g.boss;
    return {
      sl: g.seals, co: g.coins, cr: g.crumb, ky: g.key, tr: g.trophy, tk: g.toasterKey ? 1 : 0, tt: g.toasted ? 1 : 0, lg: [...g.logs], s6: [...g.s67], ao: g.open.aud ? 1 : 0, fo: g.frontOpen ? 1 : 0,
      lh: (g.enemies.find(e => e.kind === KIND.loaf) || {}).hp || 0, bd: g.bossDead ? 1 : 0, bh: boss ? r2(boss.hp) : 100, bp: boss ? boss.phase : 0, br: boss ? r2(boss.roast) : 0, bs: boss ? boss.state : '',
      pa: g.plate.a ? 1 : 0, pb: g.plate.b ? 1 : 0, tp: r2(g.toastP / 4),
    };
  }
  flush(live) {
    const g = this.g;
    const ev = g.ev; g.ev = [];
    const personal = ev.filter(e => e.to), shared = ev.filter(e => !e.to);
    const doTeam = this.dirtyTeam || g.tick % 6 === 0; this.dirtyTeam = false;
    const team = doTeam ? this.teamMsg() : null;
    const pl = [...this.players.values()].map(p => [p.id, r2(p.x), r2(p.z), r2(p.yaw), r2(p.pitch), p.flags, p.hp, p.reviveP > 0 ? r2(p.reviveP) : 0, p.hat === 'none' ? 0 : HATS.indexOf(p.hat), p.bot ? 1 : 0]);
    const pr = g.proj.map(q => [q.id, r2(q.x), r2(q.y), r2(q.z), q.item]);
    const ha = g.haz.map(h => [r2(h.x), r2(h.z), r2(h.r), r2(h.at - g.t)]);
    for (const p of this.players.values()) {
      if (p.bot || !p.connected) continue;
      const en = [];
      for (const e of g.enemies) { if (e.kind !== KIND.boss && dist(e.x, e.z, p.x, p.z) > 120) continue; en.push([e.id, e.d.k, r2(e.x), r2(e.z), r2(e.yaw), e.state | (e.frozen ? 8 : 0) | (e.toasted ? 16 : 0), e.kind === KIND.boss ? (g.boss ? g.boss.phase : 0) : e.kind === KIND.loaf ? e.hp : e.aux | 0]); }
      const mine = personal.filter(e => e.to === p.id);
      const msg = { t: 's', k: g.tick, st: r2(g.t), sr: Math.round(g.sunrise * 10) / 10, p: pl, e: en, pr, ha, lv: r2(g.laugh.level), lp: g.laugh.phase, tl: r2(g.tideT), to: r2(this.tideOff()), cl: g.clouds.map(c => [r2(c.x), r2(c.z), c.r]), fl: g.flood ? [r2(g.flood.x), r2(g.flood.z), g.flood.r] : 0 };
      if (g.boss) msg.b = { hp: r2(g.boss.hp), ph: g.boss.phase, st: g.boss.state, ro: r2(g.boss.roast), x: r2(g.boss.e.x), z: r2(g.boss.e.z), fl: g.boss.flood ? 1 : 0 };
      if (team) msg.tm = team;
      if (shared.length || mine.length) msg.ev = [...shared, ...mine];
      if (g.mut) msg.mu = g.mut.id;
      if (g.cdMon) msg.cd = g.cdMon;
      p.conn.send(msg);
    }
    void live;
    // ride reward
    for (const p of this.players.values()) if (p.rideEnd && g.t >= p.rideEnd) { p.rideEnd = 0; if (p.scooterUntil > 0 && p.scooterUntil <= g.t + 0.1 && !p.down) { p.stats.rides++; g.coins += 2; this.dirtyTeam = true; this.send(p, { t: 'ev', ev: [{ k: 'rideOK' }] }); } }
  }
}

// ------------------------------------------------------------------ Hub (rooms registry, rate limiting)
export class Hub {
  constructor(opts = {}) {
    this.rooms = new Map(); this.now = opts.now || (() => Date.now()); this.maxRooms = opts.maxRooms ?? 500; this.createLog = new Map(); this.nextConn = 1;
    this.stats = { roomsCreated: 0, started: Date.now() }; this.debug = !!opts.debug;
  }
  attach(conn) { conn.id = conn.id || this.nextConn++; conn.room = null; conn.player = null; conn.tokens = 120; conn.refill = this.now(); conn.strikes = 0; }
  _bucket(conn) {
    const t = this.now();
    conn.tokens = Math.min(120, conn.tokens + ((t - conn.refill) / 1000) * 90); conn.refill = t;
    if (conn.tokens < 1) { if (++conn.strikes > 500) conn.close?.(); return false; }
    conn.tokens -= 1; return true;
  }
  handle(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (!this._bucket(conn)) return;
    switch (msg.t) {
      case 'ping': if (msg.kind !== undefined && conn.room && conn.player) { conn.room.handle(conn.player, msg); return; } conn.send({ t: 'pong', c: msg.c, st: conn.room && conn.room.g ? Math.round(conn.room.g.t * 1000) / 1000 : 0 }); return;
      case 'create': return this._create(conn, msg);
      case 'join': return this._join(conn, msg);
      case 'quick': return this._quick(conn, msg);
      case 'leave': return this._leave(conn);
    }
    if (!conn.room || !conn.player) return conn.send({ t: 'err', code: 'NOT_IN_ROOM', msg: 'You are not in a room.' });
    conn.room.handle(conn.player, msg);
  }
  close(conn) { const room = conn.room, p = conn.player; conn.room = null; conn.player = null; if (room && p && p.conn === conn) { if (room.practice) room.dead = true; room.disconnect(p); } }
  _leave(conn) { if (conn.room && conn.player) conn.room.removePlayer(conn.player, 'left'); conn.room = null; conn.player = null; }
  _create(conn, msg) {
    this._leave(conn);
    const t = this.now(), ip = conn.ip || 'local';
    const log = (this.createLog.get(ip) || []).filter(x => t - x < 60000);
    if (log.length >= 8 && !msg.practice) return conn.send({ t: 'err', code: 'RATE_LIMIT', msg: 'Too many rooms created. Try again in a minute.' });
    if (this.rooms.size >= this.maxRooms) return conn.send({ t: 'err', code: 'SERVER_BUSY', msg: 'The server is full right now. Try again soon.' });
    let code; do { code = Array.from({ length: 5 }, () => CODE_ALPHA[Math.floor(Math.random() * CODE_ALPHA.length)]).join(''); } while (this.rooms.has(code));
    const room = new Room(this, code, !!msg.practice); room.isPublic = !!msg.public && !msg.practice;
    const r = room.addPlayer(conn, msg);
    if (!r.ok) return conn.send({ t: 'err', code: r.code, msg: r.msg });
    log.push(t); this.createLog.set(ip, log);
    this.rooms.set(code, room); this.stats.roomsCreated++;
    if (msg.settings) room.settings = cleanSettings(msg.settings, room.settings);
    if (msg.practice) { room.settings = { ...room.settings, mode: 'coop', maxPlayers: 4 }; room.syncBots(); room.broadcastRoom(); room.beginCountdown(room.players.get(room.hostId)); room.countdown = 0.2; }
  }
  _quick(conn, msg) {
    this._leave(conn);
    const open = [...this.rooms.values()].filter(r => r.isPublic && !r.practice && r.phase === 'lobby' && !r.settings.locked && !r.dead && r.players.size < r.settings.maxPlayers && r.connectedHumans().length >= 1).sort((a, b) => b.players.size - a.players.size)[0];
    if (open) return this._join(conn, { ...msg, code: open.code });
    this._create(conn, { ...msg, public: true });
  }
  _join(conn, msg) {
    this._leave(conn);
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
      try { room.tick(); } catch (e) { console.error('room tick failed', code, e); }
      if (room.dead || (!room.connectedHumans().length && room.emptySince && t - room.emptySince > 60000)) this.rooms.delete(code);
      else if (room.connectedHumans().length) room.emptySince = 0;
    }
  }
  health() { let players = 0; for (const r of this.rooms.values()) players += r.connectedHumans().length; return { ok: true, rooms: this.rooms.size, players, uptime: Math.round((Date.now() - this.stats.started) / 1000), game: 'night-shift' }; }
}
