// FLOCK RUSH — game client: UI, networking, third-person dog controller, HUD, minimap.
// Online play talks to the authoritative server over WSS. Practice mode runs the SAME engine locally (no network).
import { generateField, resolveCollision, mudAt, forward, DOG_RADIUS } from '/shared/field.js';
import { TUNING, SHEEP_TYPES } from '/shared/sim.js';
import { Hub, MODES, COSMETICS, FLOCKS } from '/shared/engine.js';
import { createView } from '/js/view.js';
import { audio } from '/js/audio.js';

const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;
const fmtTime = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const store = { get(k, d) { try { const v = localStorage.getItem('flock.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('flock.' + k, JSON.stringify(v)); } catch {} } };
const sess = { get() { try { return JSON.parse(sessionStorage.getItem('flock.session') || 'null'); } catch { return null; } }, set(v) { try { sessionStorage.setItem('flock.session', JSON.stringify(v)); } catch {} }, clear() { try { sessionStorage.removeItem('flock.session'); } catch {} } };
const TEAM_COLOR = ['#e4472f', '#3a78d8'], TEAM_NAME = ['Red team', 'Blue team'];
const angLerp = (a, b, t) => { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; };

// ------------------------------------------------------------------ settings
const DEFAULTS = { sens: 1, master: 0.8, music: 0.5, sfx: 0.9, reduceMotion: false, reduceFlash: false, uiScale: 1, quality: 'medium', musicInGame: true, name: '' };
const settings = { ...DEFAULTS, ...store.get('settings', {}) };
const saveSettings = () => store.set('settings', settings);
function applySettings() {
  audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
  document.documentElement.style.setProperty('--ui', settings.uiScale);
  document.body.classList.toggle('reduce-flash', settings.reduceFlash);
  document.body.classList.toggle('reduce-motion', settings.reduceMotion);
  view?.setQuality(settings.quality);
  if (S.inGame) audio.setMusic(settings.musicInGame ? 'game' : 'off');
}

// ------------------------------------------------------------------ state
const S = {
  net: null, practice: false, you: null, code: null, token: null, room: null, round: null, field: null, phase: 'menu', inGame: false, screen: 'menu',
  remaining: 0, phaseMs: 0, lastTimerAt: 0, slots: {}, teams: {}, results: null, spectator: false, spectateId: null,
  scores: { pens: [], players: new Map(), total: 1, dom: null }, sheep: [], chat: [], connected: false, reconnecting: false, tabDown: false, lastCd: 0, thunderAt: 0, warnAt: 0,
};
let view = null, canvas = null, rafId = 0, lastFrame = 0, ui = null, hud = null, mini = null, miniCtx = null;
const L = { x: 0, z: 0, vx: 0, vz: 0, camYaw: 0, camPitch: 0.52, dogYaw: 0, stamina: 100, staminaHold: 0, barkReady: 0, dashReady: 0, howlReady: 0, barkAnim: 0, howlAnim: 0, dashUntil: 0, dashDir: [0, 0], stunUntil: 0, moving: false, sprinting: false, inMud: false, shake: 0, stepD: 0 };
const keys = new Set();
let lockWanted = false, sendT = 0, miniT = 0, baaT = 0;
const remotes = new Map();

// ------------------------------------------------------------------ networking
class OnlineNet {
  constructor() { this.ws = null; this.intent = null; this.closedByUs = false; this.retry = 0; this.pingT = 0; this.rtt = 0; this.timer = null; }
  open(intent) {
    this.intent = intent; this.closedByUs = false;
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws; try { ws = new WebSocket(url); } catch (e) { return reject(e); }
      this.ws = ws; let opened = false;
      const to = setTimeout(() => { if (!opened) { try { ws.close(); } catch {} reject(new Error('timeout')); } }, 9000);
      ws.onopen = () => { opened = true; clearTimeout(to); this.retry = 0; S.connected = true; setConn(true); ws.send(JSON.stringify(intent)); this.startPing(); resolve(); };
      ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
      ws.onerror = () => {};
      ws.onclose = () => { clearTimeout(to); S.connected = false; this.stopPing(); setConn(false); if (!opened) return reject(new Error('closed')); if (!this.closedByUs) this.lost(); };
    });
  }
  startPing() { this.stopPing(); this.timer = setInterval(() => { this.pingT = performance.now(); this.send({ t: 'ping', c: 1 }); }, 4000); }
  stopPing() { clearInterval(this.timer); }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { this.closedByUs = true; this.stopPing(); try { this.ws?.close(); } catch {} }
  lost() {
    if (!S.code || !S.token) { toast('Disconnected from the server.', 'bad'); return goMenu(); }
    S.reconnecting = true; toast('Connection lost. Reconnecting…', 'bad'); showBanner('Connection lost — reconnecting…');
    const attempt = async () => {
      if (this.closedByUs) return;
      this.retry++; if (this.retry > 14) { hideBanner(); toast('Could not reconnect to the room.', 'bad'); S.reconnecting = false; return goMenu(); }
      try { await this.open({ t: 'join', code: S.code, token: S.token, name: S.room?.players?.find(p => p.id === S.you)?.name || settings.name }); }
      catch { setTimeout(attempt, Math.min(5000, 600 * this.retry)); }
    };
    setTimeout(attempt, 500);
  }
}

class LocalNet { // Practice mode: the very same engine, running in this tab, with one local player.
  constructor() {
    this.hub = new Hub({ minDuration: 30 }); this.conn = { ip: 'local', send: o => queueMicrotask(() => onMessage(JSON.parse(JSON.stringify(o)))), close() {} }; this.hub.attach(this.conn);
    this.timer = setInterval(() => this.hub.tick(), 50);
  }
  open(intent) { this.hub.handle(this.conn, intent); S.connected = true; setConn(true); return Promise.resolve(); }
  send(m) { this.hub.handle(this.conn, m); }
  close() { clearInterval(this.timer); this.hub.close(this.conn); }
}

function setConn(ok) { const el = $('#conn'); if (!el) return; el.className = ok ? 'ok' : 'bad'; el.title = ok ? 'Connected' : 'Disconnected'; if (ok) hideBanner(); }
function showBanner(t) { let b = $('#banner'); if (!b) { b = h('div', { id: 'banner' }); document.body.append(b); } b.textContent = t; b.style.display = 'block'; }
function hideBanner() { const b = $('#banner'); if (b) b.style.display = 'none'; }
function toast(text, kind = '') { const box = $('#toasts'); if (!box) return; const t = h('div', { class: 'toast ' + kind }, text); box.append(t); setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700); while (box.children.length > 5) box.firstChild.remove(); }

// ------------------------------------------------------------------ message handling
function onMessage(m) {
  switch (m.t) {
    case 'pong': S.net.rtt = performance.now() - S.net.pingT; return updatePing();
    case 'joined': {
      unbusy(); S.you = m.you; S.code = m.code; S.token = m.token; S.practice = !!m.practice;
      if (!m.practice) sess.set({ code: m.code, token: m.token });
      if (m.reconnected) { S.reconnecting = false; hideBanner(); toast('Reconnected!', 'good'); audio.join(); }
      if (S.screen !== 'game' && S.screen !== 'lobby' && !m.practice) showLobby();
      return;
    }
    case 'room': S.room = m; if (!m.practice && !['playing', 'countdown', 'results'].includes(S.phase)) S.phase = m.phase; return onRoom();
    case 'notice': if (m.kind === 'join') audio.join(); else if (m.kind === 'leave') audio.leave(); if (!S.practice || m.kind === 'info') toast(m.text, m.kind === 'leave' ? 'bad' : ''); return;
    case 'chat': S.chat.push(m); if (S.chat.length > 60) S.chat.shift(); return renderChat();
    case 'err': unbusy(); audio.error(); toast(m.msg, 'bad'); if (['NOT_FOUND', 'BAD_CODE', 'FULL', 'LOCKED', 'BANNED', 'NAME_BAD', 'RATE_LIMIT', 'SERVER_BUSY'].includes(m.code) && !S.room) { sess.clear(); S.net?.close(); S.net = null; goMenu(); } if (m.code === 'NOT_FOUND') sess.clear(); if (m.code === 'REPLACED') { S.net?.close(); S.net = null; goMenu(); } return;
    case 'kicked': toast(m.msg, 'bad'); sess.clear(); S.code = null; S.token = null; S.net?.close(); S.net = null; return goMenu();
    case 'round': return startRound(m);
    case 'phase': S.phase = m.phase; S.remaining = m.remainingMs; S.phaseMs = m.phaseMs || 0; S.lastTimerAt = performance.now(); if (m.phase === 'playing') { audio.go(); banner('GO!', S.round?.mode === 'team' ? 'Fill your team\'s pen' : 'Herd the flock into YOUR pen'); L.stamina = 100; } return updateObjective();
    case 'timer': S.phase = m.phase; S.remaining = m.remainingMs; S.lastTimerAt = performance.now(); if (m.phase === 'playing' && m.remainingMs <= 10000 && m.remainingMs > 0) audio.tick(m.remainingMs <= 3000); return;
    case 'snap': return onSnap(m);
    case 'sheep': S.sheep = m.s; view?.setSheep(m.s); return;
    case 'tp': { L.x = m.x; L.z = m.z; if (m.yaw != null) L.dogYaw = m.yaw; if (m.hard) { L.vx = L.vz = 0; } return; }
    case 'fx': if (m.k === 'stun') { L.stunUntil = performance.now() + m.ms; L.vx = L.vz = 0; L.shake = 0.5; audio.bump(); flash('#ffe27a'); } return;
    case 'ev': return onEvent(m);
    case 'scores': S.scores = { pens: m.pens, players: new Map(m.players.map(r => [r[0], { score: r[1], herded: r[2], steals: r[3] }])), total: Math.max(1, m.total), dom: m.dom }; return updateScoreboard();
    case 'lobby': S.phase = 'lobby'; return showLobby();
    case 'results': return onResults(m);
  }
}

function onRoom() {
  updatePenOwners();
  if (S.screen === 'lobby') renderLobby();
  if (S.inGame) { updateScoreboard(); updateHudStatic(); }
  if (S.screen === 'results') renderResultsButtons();
}

const myInfo = () => S.room?.players.find(p => p.id === S.you);
const infoOf = id => S.room?.players.find(p => p.id === id);
const teamMode = () => S.round?.mode === 'team';
function colorOf(id) { const p = infoOf(id); if (teamMode()) { const t = S.teams[id] ?? p?.team; if (t != null) return TEAM_COLOR[t]; } return p?.cosm?.color || '#ffffff'; }
function slotColor(slot) { if (teamMode()) return TEAM_COLOR[slot] || '#fff'; const id = Object.keys(S.slots).find(k => S.slots[k] === slot); return id ? colorOf(+id) : '#cfcfcf'; }
function slotName(slot) { if (teamMode()) return TEAM_NAME[slot]; const id = Object.keys(S.slots).find(k => S.slots[k] === slot); return id ? (infoOf(+id)?.name || 'Dog') : 'Empty pen'; }
function updatePenOwners() { if (!view || !S.field) return; for (const p of S.field.pens) view.setPenOwner(p.slot, slotName(p.slot) + (p.slot === S.round?.you?.slot ? '  (you)' : ''), slotColor(p.slot)); }

// ------------------------------------------------------------------ round start
function startRound(m) {
  S.round = m; S.phase = m.phase; S.teams = m.teams || {}; S.slots = m.slots || {}; S.remaining = m.remainingMs; S.phaseMs = m.phaseMs; S.lastTimerAt = performance.now(); S.results = null;
  S.spectator = !!m.you.spectator; S.spectateId = null; S.scores = { pens: [], players: new Map(), total: 1, dom: null }; S.sheep = [];
  S.field = generateField(m.seed, m.field);
  if (!view) initView();
  view.setQuality(settings.quality); view.loadField(S.field); view.clearDogs(); remotes.clear(); view.setStorm(!!m.storms); view.snapCamera();
  updatePenOwners();
  const sp = m.you.spawn || { x: 0, z: 0, yaw: 0 };
  Object.assign(L, { x: sp.x, z: sp.z, vx: 0, vz: 0, dogYaw: sp.yaw ?? 0, camYaw: sp.yaw ?? 0, camPitch: 0.52, stamina: 100, staminaHold: 0, barkReady: 0, dashReady: 0, howlReady: 0, dashUntil: 0, stunUntil: 0, shake: 0, barkAnim: 0, howlAnim: 0 });
  enterGame();
  banner(m.practice ? 'Practice' : (MODES[m.mode]?.label || ''), S.spectator ? 'Spectating until the next round' : 'Get ready');
}

function onResults(m) {
  S.results = m; S.phase = 'results'; L.vx = L.vz = 0;
  const mine = m.winners.includes(S.you);
  if (mine) audio.victory(); else if (m.winners.length) audio.roundEndOther(); else audio.defeat();
  releaseLock(); setTimeout(() => { if (S.phase === 'results') showResults(); }, S.practice ? 500 : 1700);
}

// ------------------------------------------------------------------ events
const relTo = id => { const r = remotes.get(id); const d = r?.last; return d ? { id, dx: d.x - L.x, dz: d.z - L.z, yaw: L.camYaw } : null; };
function onEvent(m) {
  switch (m.k) {
    case 'penned': case 'stolen': {
      const mine = m.by === S.you, stolen = m.k === 'stolen', name = SHEEP_TYPES[m.type]?.name?.toLowerCase() || 'sheep', who = infoOf(m.by)?.name || 'Someone';
      const myPen = m.slot === S.round?.you?.slot;
      view?.pennedFx(m.slot, m.type === 'g'); if (stolen) view?.stolenFx(m.from);
      if (mine) { audio.penned(m.value); toast(`${stolen ? 'Stolen! ' : ''}+${m.value} ${m.type === 'g' ? '★ golden sheep' : name}`, 'good'); if (m.type === 'g') flash('#ffd34a'); }
      else if (myPen && !stolen) { audio.penned(m.value); toast(`${m.by >= 0 ? who : 'The flock'} penned a ${name} for you`, 'good'); }
      else if (stolen && myPen) { audio.stolen(true); toast(`${who} stole a ${name}!`, 'good'); }
      else if (stolen && m.from === S.round?.you?.slot) { audio.stolen(false); toast(`${who} stole a ${name} from your pen!`, 'bad'); }
      else if (!S.practice && m.by >= 0) toast(`${who} ${stolen ? 'stole' : 'penned'} a ${name}`);
      return;
    }
    case 'bark': { if (m.id === S.you) return; const r = remotes.get(m.id)?.last; if (r) view?.bark(r.x, r.z, r.yaw); audio.bark(relTo(m.id)); return; }
    case 'howl': { if (m.id === S.you) return; const r = remotes.get(m.id)?.last; if (r) view?.howl(r.x, r.z); audio.howl(relTo(m.id)); return; }
    case 'dash': { if (m.id === S.you) return; const r = remotes.get(m.id)?.last; if (r) view?.dashFx(r.x, r.z); audio.dash(relTo(m.id)); return; }
    case 'bump': { const v = m.victim === S.you ? { x: L.x, z: L.z } : remotes.get(m.victim)?.last; if (v) view?.bumpFx(v.x, v.z); audio.bump(m.victim === S.you ? null : relTo(m.victim)); if (m.id === S.you) { toast('Bump! Rival stunned', 'good'); } return; }
    case 'thunder_warn': S.warnAt = performance.now(); audio.thunderWarn(); banner('⚡ Storm incoming', 'The flock is about to bolt'); return;
    case 'thunder': S.thunderAt = performance.now(); view?.lightning(); audio.thunder(); flash('#ffffff'); L.shake = settings.reduceMotion ? 0 : 0.7; return;
    case 'dominating': audio.dominating(); banner(m.owner + ' is dominating!', `Steal sheep back within ${m.secs} seconds`); return;
    case 'dom_broken': toast('Domination broken!', 'good'); return;
    case 'gone': remotes.delete(m.id); view?.removeDog(m.id); return;
  }
}

// ------------------------------------------------------------------ snapshots and interpolation
function onSnap(m) {
  const now = performance.now();
  for (const [id, x, z, yaw, f] of m.p) {
    if (id === S.you) continue;
    let r = remotes.get(id); if (!r) { r = { buf: [], stepD: 0, last: null }; remotes.set(id, r); }
    r.buf.push({ t: now, x, z, yaw, f }); if (r.buf.length > 12) r.buf.shift();
  }
}
function updateRemotes(dt) {
  const rt = performance.now() - 120;
  for (const [id, r] of remotes) {
    const b = r.buf; if (!b.length) continue;
    let a = b[0], c = b[b.length - 1];
    if (rt >= c.t) a = c; else { for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= rt) { a = b[i - 1]; c = b[i]; break; } }
    const k = a === c || c.t === a.t ? 1 : clamp((rt - a.t) / (c.t - a.t), 0, 1);
    const d = { x: a.x + (c.x - a.x) * k, z: a.z + (c.z - a.z) * k, yaw: angLerp(a.yaw, c.yaw, k), flags: c.f };
    const info = infoOf(id); if (!info || !info.connected) { view.removeDog(id); continue; }
    view.setDog(id, { ...d, dt, name: info.name, cosm: { ...info.cosm, color: colorOf(id) } });
    if (r.last && (c.f & 1)) { r.stepD += Math.hypot(d.x - r.last.x, d.z - r.last.z); if (r.stepD > ((c.f & 2) ? 2.3 : 1.8)) { r.stepD = 0; audio.footstep('grass', !!(c.f & 2), { id, dx: d.x - L.x, dz: d.z - L.z, yaw: L.camYaw }); } }
    r.last = d;
  }
  for (const id of [...remotes.keys()]) if (!S.room?.players.some(p => p.id === id)) { remotes.delete(id); view.removeDog(id); }
}

// ------------------------------------------------------------------ dog controller
const now = () => performance.now();
function canMove() { return S.inGame && !S.spectator && document.pointerLockElement === canvas && S.phase === 'playing' && now() >= L.stunUntil; }

function stepPlayer(dt) {
  if (S.spectator) return spectateStep(dt);
  const t = now(), active = canMove(), stunned = t < L.stunUntil;
  let ix = 0, iz = 0;
  if (active) { if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1; if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1; if (keys.has('KeyA')) ix -= 1; if (keys.has('KeyD')) ix += 1; }
  if (S.inGame && S.phase === 'playing') { if (keys.has('ArrowLeft')) L.camYaw += 2.2 * dt; if (keys.has('ArrowRight')) L.camYaw -= 2.2 * dt; }
  const len = Math.hypot(ix, iz); if (len) { ix /= len; iz /= len; }
  const fx = -Math.sin(L.camYaw), fz = -Math.cos(L.camYaw), rx = Math.cos(L.camYaw), rz = -Math.sin(L.camYaw);
  const dx = fx * -iz + rx * ix, dz = fz * -iz + rz * ix;
  const wantSprint = active && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && len > 0 && L.stamina > 3;
  L.sprinting = wantSprint;
  L.inMud = S.field ? !!mudAt(S.field, L.x, L.z) : false;
  const dashing = t < L.dashUntil;
  let tvx = 0, tvz = 0;
  if (dashing) { tvx = L.dashDir[0] * TUNING.dashSpeed; tvz = L.dashDir[1] * TUNING.dashSpeed; }
  else if (len) { const sp = (L.sprinting ? TUNING.dogSprint : TUNING.dogWalk) * (L.inMud ? TUNING.mudSlow : 1); tvx = dx * sp; tvz = dz * sp; }
  const acc = Math.min(1, (dashing ? 30 : len ? 13 : 12) * dt);
  L.vx += (tvx - L.vx) * acc; L.vz += (tvz - L.vz) * acc;
  if (stunned || S.phase !== 'playing') { L.vx = L.vz = 0; }
  L.moving = Math.hypot(L.vx, L.vz) > 0.7;
  if (S.field && S.phase === 'playing' && !stunned) { const r = resolveCollision(S.field, L.x + L.vx * dt, L.z + L.vz * dt, DOG_RADIUS); L.x = r.x; L.z = r.z; }
  if (L.moving && !stunned) { const ty = Math.atan2(-L.vx, -L.vz); L.dogYaw = angLerp(L.dogYaw, ty, Math.min(1, 16 * dt)); L.stepD += Math.hypot(L.vx, L.vz) * dt; if (L.stepD > (L.sprinting ? 2.4 : 1.8)) { L.stepD = 0; audio.footstep(L.inMud ? 'dirt' : 'grass', L.sprinting); } }
  if (L.sprinting && L.moving) { L.stamina = Math.max(0, L.stamina - 30 * dt); L.staminaHold = 0.7; } else { L.staminaHold -= dt; if (L.staminaHold <= 0) L.stamina = Math.min(100, L.stamina + 22 * dt); }
  L.barkAnim = Math.max(0, L.barkAnim - dt); L.howlAnim = Math.max(0, L.howlAnim - dt); L.shake = Math.max(0, L.shake - dt * 1.4);
  const flags = (L.moving ? 1 : 0) | (L.sprinting ? 2 : 0) | (L.barkAnim > 0 ? 4 : 0) | (dashing ? 8 : 0) | (stunned ? 16 : 0) | (L.inMud ? 32 : 0) | (L.howlAnim > 0 ? 64 : 0);
  const me = myInfo(); if (view && me) view.setDog(S.you, { x: L.x, z: L.z, yaw: L.dogYaw, flags, dt, you: true, name: me.name, cosm: { ...me.cosm, color: colorOf(S.you) } });
  sendT += dt; if (sendT >= 0.05 && S.inGame && S.phase === 'playing' && !stunned) { sendT = 0; sendPos(); }
}
function sendPos() { S.net?.send({ t: 'pos', x: L.x, z: L.z, yaw: L.dogYaw, f: (L.moving ? 1 : 0) | (L.sprinting ? 2 : 0) }); }

function doBark() {
  if (!canMove() || now() < L.barkReady) return;
  L.barkReady = now() + TUNING.barkCooldown * 1000; L.barkAnim = 0.45; sendPos(); S.net?.send({ t: 'bark' });
  view?.bark(L.x, L.z, L.dogYaw); audio.bark(); L.shake = settings.reduceMotion ? 0 : 0.12;
}
function doHowl() {
  if (!canMove() || now() < L.howlReady) return;
  L.howlReady = now() + TUNING.howlCooldown * 1000; L.howlAnim = 0.8; sendPos(); S.net?.send({ t: 'howl' });
  view?.howl(L.x, L.z); audio.howl();
}
function doDash() {
  if (!canMove() || now() < L.dashReady) return;
  L.dashReady = now() + TUNING.dashCooldown * 1000; L.dashUntil = now() + TUNING.dashDuration * 1000; L.dashDir = forward(L.dogYaw); sendPos(); S.net?.send({ t: 'dash' });
  view?.dashFx(L.x, L.z); audio.dash();
}

// Spectators watch another dog until the next round.
function spectateStep(dt) {
  const ids = [...remotes.keys()]; if (!ids.length) return;
  if (S.spectateId == null || !remotes.has(S.spectateId)) S.spectateId = ids[0];
  const r = remotes.get(S.spectateId)?.last; if (r) { L.x = r.x; L.z = r.z; }
}
function cycleSpectate() { const ids = [...remotes.keys()]; if (!ids.length) return; S.spectateId = ids[(ids.indexOf(S.spectateId) + 1) % ids.length]; toast('Watching ' + (infoOf(S.spectateId)?.name || 'a dog')); }

// ------------------------------------------------------------------ input
function releaseLock() { lockWanted = false; if (document.pointerLockElement) document.exitPointerLock(); }
function requestLock() { lockWanted = true; try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p?.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch {} }); } catch { try { canvas.requestPointerLock(); } catch {} } }

function bindInput() {
  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input,textarea,select')) { if (e.key === 'Enter' && e.target.id === 'chatIn') sendChat(); return; }
    if (e.code === 'Tab') { e.preventDefault(); if (S.inGame) { S.tabDown = true; $('#scoreboard').classList.add('show'); updateScoreboard(); } return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && S.inGame) e.preventDefault();
    if (e.repeat) return; keys.add(e.code);
    if (!S.inGame) return;
    if (e.code === 'Space') { S.spectator ? cycleSpectate() : doDash(); }
    if (e.code === 'KeyF') doBark();
    if (e.code === 'KeyE' || e.code === 'KeyQ') doHowl();
  });
  document.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') { S.tabDown = false; $('#scoreboard')?.classList.remove('show'); } });
  window.addEventListener('blur', () => { keys.clear(); S.tabDown = false; $('#scoreboard')?.classList.remove('show'); });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement !== canvas || !S.inGame) return;
    const k = 0.0022 * settings.sens; L.camYaw -= clamp(e.movementX, -250, 250) * k; L.camPitch = clamp(L.camPitch + clamp(e.movementY, -250, 250) * k * 0.7, 0.2, 1.0);
  });
  document.addEventListener('mousedown', e => { if (document.pointerLockElement !== canvas || !S.inGame) return; if (e.button === 0) { S.spectator ? cycleSpectate() : doBark(); } else if (e.button === 2) doHowl(); });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && lockWanted && S.inGame && S.phase !== 'results' && S.screen === 'game') { lockWanted = false; showPause(); }
    if (locked) { hidePause(); audio.unlock(); }
  });
  document.addEventListener('pointerlockerror', () => toast('Could not capture the mouse. Click the game and try again.', 'bad'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspend(); else audio.resume(); });
  document.addEventListener('contextmenu', e => { if (S.inGame) e.preventDefault(); });
  document.addEventListener('click', e => { if (e.target.closest?.('button')) audio.click(); }, true);
  document.addEventListener('mouseover', e => { if (e.target.closest?.('button:not(:disabled)')) audio.hover(); });
}

// ------------------------------------------------------------------ frame loop
function frame(ts) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0.016); lastFrame = ts;
  if (!S.inGame || !view) return;
  stepPlayer(dt); updateRemotes(dt); ambientSheep(dt); updateHud(dt);
  view.render(dt, { x: L.x, z: L.z, yaw: L.camYaw, pitch: L.camPitch, dist: 9.5, shake: settings.reduceMotion ? 0 : L.shake * 0.5, fov: L.dashUntil > now() && !settings.reduceMotion ? 70 : 62 });
}
function ambientSheep(dt) { // the odd "baa" from panicking sheep near you
  baaT -= dt; if (baaT > 0 || S.phase !== 'playing') return; baaT = 0.7 + Math.random() * 1.6; const a = S.sheep; if (!a?.length) return;
  for (let tries = 0; tries < 6; tries++) { const i = Math.floor(Math.random() * (a.length / 4)); if (!(a[i * 4 + 3] & 2)) continue; const dx = a[i * 4] / 10 - L.x, dz = a[i * 4 + 1] / 10 - L.z; audio.baa({ dx, dz, yaw: L.camYaw }); return; }
}

// ------------------------------------------------------------------ HUD
function buildHud() {
  mini = h('canvas', { id: 'mini', width: 220, height: 220 }); miniCtx = mini.getContext('2d');
  hud = h('div', { id: 'hud' },
    h('div', { id: 'hudTL', class: 'panel' }, h('div', { id: 'hudName' }), h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Your pen'), h('b', { id: 'hudPen' }, '0')), h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Penned by you'), h('b', { id: 'hudHerded' }, '0')), h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Steals'), h('b', { id: 'hudSteals' }, '0'))),
    h('div', { id: 'hudTop' }, h('div', { id: 'hudTimer', class: 'panel' }, '0:00'), h('div', { id: 'hudObj' }), h('div', { id: 'hudDom' })),
    h('div', { id: 'hudPens', class: 'panel' }),
    h('div', { id: 'penArrowBox' }, h('div', { id: 'penArrow' }, '➤'), h('div', { id: 'penDist' })),
    h('div', { id: 'abil' },
      h('div', { class: 'ab', id: 'abBark' }, h('i', { class: 'cd' }), h('kbd', null, 'Click'), h('span', null, 'Bark')),
      h('div', { class: 'ab', id: 'abDash' }, h('i', { class: 'cd' }), h('kbd', null, 'Space'), h('span', null, 'Dash')),
      h('div', { class: 'ab', id: 'abHowl' }, h('i', { class: 'cd' }), h('kbd', null, 'E'), h('span', null, 'Howl')),
      h('div', { class: 'stam' }, h('div', { id: 'stamFill' }), h('span', null, 'Shift: sprint'))),
    h('div', { id: 'stunMsg' }, 'STUNNED'),
    h('div', { id: 'spec' }, 'Spectating — click or Space to switch dog'),
    h('div', { id: 'miniWrap', class: 'panel' }, mini),
    h('div', { id: 'bigBanner' }, h('div', { id: 'bbTitle' }), h('div', { id: 'bbSub' })),
    h('div', { id: 'flash' }), h('div', { id: 'ping' }, ''),
    h('div', { id: 'scoreboard', class: 'panel' }));
  return hud;
}
let bannerT = 0;
function banner(title, sub) { const b = $('#bigBanner'); if (!b) return; $('#bbTitle').textContent = title; $('#bbSub').textContent = sub || ''; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), 2400); }
function flash(color) { if (settings.reduceFlash) return; const f = $('#flash'); if (!f) return; f.style.background = color; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
function updatePing() { const p = $('#ping'); if (p && S.net?.rtt) p.textContent = Math.round(S.net.rtt) + ' ms'; }
function updateObjective() {
  const o = $('#hudObj'); if (!o || !S.round) return; const m = S.round.mode;
  let t = m === 'team' ? 'Herd sheep into your team\'s pen' : S.practice ? 'Run at the sheep to scare them toward your pen' : 'Herd sheep into your pen. Steal from rivals.';
  if (m === 'stampede') t = 'Stampede: storms keep spooking the flock';
  if (S.spectator) t = 'Waiting for the next round…'; if (S.phase === 'countdown') t = 'Get ready…'; o.textContent = t;
}
function updateHudStatic() {
  const me = myInfo(); if (!me || !$('#hudName')) return; $('#hudName').textContent = me.name + (teamMode() && me.team != null ? ` · ${TEAM_NAME[me.team]}` : '');
  $('#hudName').style.color = colorOf(S.you); updateObjective();
}
function updateScoreboard() {
  const mySlot = S.round?.you?.slot, sc = S.scores, mine = sc.pens.find(p => p[0] === mySlot), pl = sc.players.get(S.you);
  if ($('#hudPen')) { $('#hudPen').textContent = mine ? `${mine[2]} sheep · ${mine[1]} pts` : '0'; $('#hudHerded').textContent = pl?.herded ?? 0; $('#hudSteals').textContent = pl?.steals ?? 0; }
  const box = $('#hudPens'); if (box && S.field) {
    const rows = sc.pens.slice().sort((a, b) => b[1] - a[1]).map(([slot, v, n]) => h('div', { class: 'pr' + (slot === mySlot ? ' me' : '') }, h('span', { class: 'dot', style: `background:${slotColor(slot)}` }), h('span', { class: 'pn' }, slotName(slot)), h('b', null, v), h('i', { class: 'bar' }, h('u', { style: `width:${Math.min(100, v / sc.total * 100)}%;background:${slotColor(slot)}` }))));
    box.replaceChildren(h('div', { class: 'lbl' }, 'Pens · ' + sc.total + ' pts of sheep'), ...rows); box.style.display = rows.length > 1 || !S.practice ? 'block' : 'none';
  }
  const sb = $('#scoreboard'); if (sb && S.room && S.tabDown) {
    const rows = [...S.room.players].filter(p => S.slots[p.id] != null).map(p => ({ p, s: sc.players.get(p.id) || { score: 0, herded: 0, steals: 0 } })).sort((a, b) => b.s.score - a.s.score);
    sb.replaceChildren(h('div', { class: 'sbTitle' }, 'Scoreboard'), h('table', null, h('thead', null, h('tr', null, ['#', 'Dog', 'Pen pts', 'Penned', 'Steals', ''].map(x => h('th', null, x)))),
      h('tbody', null, rows.map((r, i) => h('tr', { class: r.p.id === S.you ? 'me' : '' }, h('td', null, i + 1), h('td', null, h('span', { class: 'dot', style: `background:${colorOf(r.p.id)}` }), r.p.name, r.p.host ? ' 👑' : ''), h('td', null, r.s.score), h('td', null, r.s.herded), h('td', null, r.s.steals), h('td', { class: r.p.connected ? 'okc' : 'badc' }, r.p.connected ? '●' : 'offline'))))));
  }
}
function setCd(id, readyAt, total) { const el = $(id); if (!el) return; const left = Math.max(0, readyAt - now()); el.classList.toggle('rdy', left <= 0); $('.cd', el).style.height = Math.min(100, left / total * 100) + '%'; }
function updateHud(dt) {
  const t = S.phase === 'playing' || S.phase === 'countdown' ? Math.max(0, S.remaining - (now() - S.lastTimerAt)) : 0;
  const tm = $('#hudTimer'); if (tm) { tm.textContent = S.phase === 'countdown' ? 'GET READY' : fmtTime(t); tm.classList.toggle('low', S.phase === 'playing' && t < 15000); }
  if (S.phase === 'countdown') { const n = Math.ceil((S.phaseMs - (now() - S.lastTimerAt)) / 1000); if (n > 0 && n <= 3 && S.lastCd !== n) { S.lastCd = n; audio.tick(false); $('#bbTitle').textContent = n; $('#bbSub').textContent = ''; const b = $('#bigBanner'); b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); } } else S.lastCd = 0;
  setCd('#abBark', L.barkReady, TUNING.barkCooldown * 1000); setCd('#abDash', L.dashReady, TUNING.dashCooldown * 1000); setCd('#abHowl', L.howlReady, TUNING.howlCooldown * 1000);
  $('#stamFill').style.width = L.stamina + '%';
  $('#abil').style.display = S.spectator ? 'none' : 'flex'; $('#spec').style.display = S.spectator ? 'block' : 'none';
  $('#stunMsg').style.display = now() < L.stunUntil ? 'block' : 'none';
  const dom = S.scores.dom, de = $('#hudDom'); if (de) { de.textContent = dom ? `${slotName(dom.slot)} is dominating: ${dom.left}s` : ''; de.style.color = dom ? slotColor(dom.slot) : ''; de.style.display = dom ? 'block' : 'none'; }
  // arrow to your pen
  const pen = S.field?.pens[S.round?.you?.slot ?? -1], ar = $('#penArrowBox');
  if (pen && !S.spectator && S.phase === 'playing') {
    const dx = pen.cx - L.x, dz = pen.cz - L.z, d = Math.hypot(dx, dz);
    const fx = -Math.sin(L.camYaw), fz = -Math.cos(L.camYaw), rx = Math.cos(L.camYaw), rz = -Math.sin(L.camYaw);
    const sx = dx * rx + dz * rz, up = dx * fx + dz * fz, theta = Math.atan2(-up, sx) * 180 / Math.PI;
    ar.style.display = d > 8 ? 'flex' : 'none'; $('#penArrow').style.transform = `rotate(${theta}deg)`; $('#penArrow').style.color = slotColor(pen.slot); $('#penDist').textContent = Math.round(d) + ' m to your pen';
  }
  else if (ar) ar.style.display = 'none';
  miniT -= dt; if (miniT <= 0) { miniT = 0.05; drawMini(); }
}
function drawMini() {
  const f = S.field; if (!f || !miniCtx) return; const g = miniCtx, W = mini.width, H = f.half, k = W / (2 * H + 4), X = x => (x + H + 2) * k, Z = z => (z + H + 2) * k;
  g.clearRect(0, 0, W, W); g.fillStyle = '#5c9a43'; g.fillRect(X(-H), Z(-H), 2 * H * k, 2 * H * k);
  g.fillStyle = 'rgba(95,63,39,.85)'; for (const m of f.mud) { g.beginPath(); g.arc(X(m.x), Z(m.z), m.r * k, 0, TAU); g.fill(); }
  for (const p of f.pens) { g.fillStyle = slotColor(p.slot) + 'cc'; g.fillRect(X(p.rect.minX), Z(p.rect.minZ), (p.rect.maxX - p.rect.minX) * k, (p.rect.maxZ - p.rect.minZ) * k); }
  g.fillStyle = '#3e2a17'; for (const s of f.solids) g.fillRect(X(s.minX), Z(s.minZ), Math.max(1.5, s.w * k), Math.max(1.5, s.d * k));
  const a = S.sheep; for (let i = 0; i < a.length / 4; i++) { const t = f.sheep[i]?.type; g.fillStyle = t === 'g' ? '#ffd23f' : t === 'b' ? '#222' : '#fff'; g.beginPath(); g.arc(X(a[i * 4] / 10), Z(a[i * 4 + 1] / 10), t === 'g' ? 3.2 : 2.2, 0, TAU); g.fill(); if (t === 'b') { g.strokeStyle = '#fff'; g.lineWidth = 0.6; g.stroke(); } }
  for (const [id, r] of remotes) if (r.last) { g.fillStyle = colorOf(id); g.beginPath(); g.arc(X(r.last.x), Z(r.last.z), 3.8, 0, TAU); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke(); }
  if (!S.spectator) { g.save(); g.translate(X(L.x), Z(L.z)); g.rotate(-L.dogYaw); g.fillStyle = colorOf(S.you); g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke(); g.restore(); }
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.2; g.strokeRect(X(-H), Z(-H), 2 * H * k, 2 * H * k);
}

// ------------------------------------------------------------------ screens
function initView() { canvas = $('#game'); view = createView(canvas); view.setQuality(settings.quality); }
function clearUI() { ui.replaceChildren(); }
function setScreen(name) { S.screen = name; document.body.dataset.screen = name; }

function logo(small) {
  return h('div', { class: 'logo' + (small ? ' small' : ''), html: `
  <svg viewBox="0 0 460 170" role="img" aria-label="Flock Rush logo">
    <g class="logoSheep" fill="#f4f1ea" stroke="#1b3a22" stroke-width="3" stroke-linejoin="round">
      <g transform="translate(300 96)"><ellipse rx="34" ry="24"/><circle cx="-26" cy="-18" r="13"/><ellipse cx="-34" cy="-16" rx="9" ry="10" fill="#2b2622"/><g fill="#2b2622" stroke="none"><rect x="-18" y="18" width="6" height="18"/><rect x="12" y="18" width="6" height="18"/></g></g>
      <g transform="translate(372 108) scale(.8)"><ellipse rx="34" ry="24"/><ellipse cx="-34" cy="-6" rx="9" ry="10" fill="#2b2622"/><g fill="#2b2622" stroke="none"><rect x="-18" y="18" width="6" height="18"/><rect x="12" y="18" width="6" height="18"/></g></g>
      <g transform="translate(418 118) scale(.62)"><ellipse rx="34" ry="24" fill="#f3c63c"/><ellipse cx="-34" cy="-6" rx="9" ry="10" fill="#2b2622"/></g>
    </g>
    <g transform="translate(110 84)" stroke="#1b3a22" stroke-width="3" stroke-linejoin="round"><path d="M-70 14 q10 -30 50 -26 l40 -22 q10 -5 18 4 l8 18 q10 6 6 16 l-10 4 q-6 22 -26 24 l-62 0 q-18 -2 -24 -18z" fill="#e4472f"/><path d="M34 -18 l16 -22 l6 24z" fill="#8c2517"/><path d="M-70 14 q-18 -10 -20 -34" fill="none" stroke="#e4472f" stroke-width="9" stroke-linecap="round"/><circle cx="46" cy="-10" r="3" fill="#1b3a22" stroke="none"/><path d="M-30 40 l0 22 M10 40 l0 22 M34 36 l10 22" stroke="#8c2517" stroke-width="9" stroke-linecap="round" fill="none"/></g>
  </svg><div class="logoTxt"><span>FLOCK</span><span class="rush">RUSH</span></div>` });
}

function goMenu() {
  leaveGameView(); S.room = null; S.code = null; S.token = null; S.phase = 'menu'; S.you = null; S.chat = []; S.round = null;
  setScreen('menu'); clearUI(); audio.setMusic('menu'); audio.stopAmbience(); history.replaceState(null, '', '/');
  const nameIn = h('input', { id: 'nameIn', maxLength: 16, placeholder: 'Your name', value: settings.name || '', autocomplete: 'off', spellcheck: false });
  const codeIn = h('input', { id: 'codeIn', maxLength: 5, placeholder: 'ROOM CODE', autocomplete: 'off', spellcheck: false, style: 'text-transform:uppercase' });
  const name = () => { const n = nameIn.value.trim(); if (n.length < 2) { toast('Pick a name (2–16 characters).', 'bad'); nameIn.focus(); return null; } settings.name = n; saveSettings(); return n; };
  const go = async (intent) => { audio.unlock(); busy('Connecting…'); try { S.net?.close(); S.net = new OnlineNet(); await S.net.open(intent); } catch (e) { unbusy(); offlineNotice(); } };
  const startOnline = type => { const n = name(); if (!n) return; go({ t: type, name: n, token: undefined }); };
  ui.append(h('div', { class: 'menu' },
    logo(), h('p', { class: 'tag' }, 'Be the sheepdog. Scare the flock into your pen before the other dogs do.'),
    h('div', { class: 'menuCard panel' },
      nameIn,
      h('div', { class: 'btnCol' },
        h('button', { class: 'btn primary', onclick: () => startOnline('quick') }, 'Play Online'),
        h('button', { class: 'btn', onclick: () => startOnline('create') }, 'Create Private Room'),
        h('div', { class: 'joinRow' }, codeIn, h('button', { class: 'btn', onclick: () => { const n = name(); if (!n) return; const c = codeIn.value.trim().toUpperCase(); if (c.length !== 5) return toast('Enter the 5-character room code.', 'bad'); go({ t: 'join', code: c, name: n }); } }, 'Join Room')),
        h('div', { class: 'divider' }),
        h('button', { class: 'btn', onclick: practiceMenu }, 'Practice Mode'),
        h('div', { class: 'btnRow' }, h('button', { class: 'btn ghost', onclick: settingsScreen }, 'Settings'), h('button', { class: 'btn ghost', onclick: howTo }, 'How to Play')))),
    h('div', { class: 'foot' }, 'Practice works offline. Online rooms hold 2–12 dogs. Desktop browser with a mouse and keyboard.')));
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('.joinRow .btn').click(); });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('.btn.primary').click(); });
}

function busy(text) { unbusy(); document.body.append(h('div', { id: 'busy' }, h('div', { class: 'spin' }), text)); }
function unbusy() { $('#busy')?.remove(); }
function offlineNotice() {
  unbusy(); const m = h('div', { class: 'modal' }, h('div', { class: 'panel modalBody' }, h('h2', null, 'Can\'t reach the game server'), h('p', null, 'The multiplayer server isn\'t responding. Check your connection and try again — or play Practice Mode, which works without a server.'), h('div', { class: 'btnRow' }, h('button', { class: 'btn primary', onclick: () => { m.remove(); practiceMenu(); } }, 'Practice Mode'), h('button', { class: 'btn', onclick: () => m.remove() }, 'Back'))));
  document.body.append(m);
}

function practiceMenu() {
  const opt = { diff: 'normal', flock: 'normal', storms: false, mode: 'ffa' };
  const seg = (id, key, list) => h('div', { class: 'seg', id }, list.map(([v, l]) => h('button', { class: 'segBtn' + (opt[key] === v ? ' on' : ''), onclick: e => { opt[key] = v; for (const b of $('#' + id).children) b.classList.remove('on'); e.target.classList.add('on'); } }, l)));
  const m = h('div', { class: 'modal' }, h('div', { class: 'panel modalBody' }, h('h2', null, 'Practice Mode'), h('p', null, 'A solo round with no connection needed. Pen the whole flock before time runs out — or just learn how the sheep react.'),
    h('div', { class: 'lbl' }, 'Sheep nerves'), seg('dSeg', 'diff', [['easy', 'Calm'], ['normal', 'Normal'], ['hard', 'Jumpy']]),
    h('div', { class: 'lbl' }, 'Flock size'), seg('fSeg', 'flock', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']]),
    h('div', { class: 'lbl' }, 'Weather'), seg('wSeg', 'mode', [['ffa', 'Clear skies'], ['stampede', 'Thunderstorms']]),
    h('div', { class: 'btnRow' }, h('button', { class: 'btn primary', onclick: () => { m.remove(); startPractice(opt); } }, 'Start'), h('button', { class: 'btn', onclick: () => m.remove() }, 'Cancel'))));
  document.body.append(m);
}
function startPractice(opt) {
  const typed = $('#nameIn')?.value.trim(); if (typed && typed.length >= 2) { settings.name = typed; saveSettings(); }
  audio.unlock(); S.net?.close(); S.net = new LocalNet(); S.practice = true; S.practiceOpt = opt;
  S.net.open({ t: 'create', name: settings.name || 'Rover', practice: true, difficulty: opt.diff, flock: opt.flock, mode: opt.mode, storms: opt.mode === 'stampede' });
}

// ----- lobby
function showLobby() {
  leaveGameView(); S.inGame = false; setScreen('lobby'); S.phase = 'lobby'; audio.setMusic('menu'); audio.stopAmbience();
  if (S.code) history.replaceState(null, '', '/r/' + S.code);
  clearUI(); ui.append(h('div', { class: 'lobby', id: 'lobbyRoot' })); renderLobby();
}
function inviteUrl() { return `${location.origin}/r/${S.code}`; }
function renderLobby() {
  const root = $('#lobbyRoot'); if (!root || !S.room) return; const R = S.room, me = R.players.find(p => p.id === S.you), host = me?.id === R.hostId, set = R.settings;
  const sel = (id, opts, val, key, disabled) => h('select', { id, disabled: !host || disabled, onchange: e => { const v = e.target.value; S.net.send({ t: 'settings', [key]: isNaN(+v) ? v : +v }); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const chatLog = h('div', { id: 'chatLog' }), chatIn = h('input', { id: 'chatIn', maxLength: 160, placeholder: 'Say something…', autocomplete: 'off' });
  const prevChat = $('#chatLog')?.scrollTop;
  const modeCards = Object.entries(MODES).map(([k, v]) => h('button', { class: 'modeCard' + (set.mode === k ? ' on' : ''), disabled: !host, title: v.desc, onclick: () => S.net.send({ t: 'settings', mode: k }) }, h('b', null, v.label), h('small', null, v.desc)));
  const live = R.players.filter(p => p.connected).length;
  root.replaceChildren(
    h('div', { class: 'lobbyTop' }, logo(true),
      h('div', { class: 'invite panel' }, h('div', null, h('small', null, 'ROOM CODE'), h('div', { class: 'code' }, R.code)), h('div', { class: 'inviteLink' }, h('input', { readOnly: true, value: inviteUrl(), onfocus: e => e.target.select() }), h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(inviteUrl()); toast('Invite link copied!', 'good'); } catch { $('.inviteLink input').select(); document.execCommand?.('copy'); toast('Invite link selected — press Ctrl+C.'); } } }, 'Copy Invite Link'))),
      h('button', { class: 'btn ghost', onclick: leaveRoom }, 'Leave')),
    h('div', { class: 'lobbyGrid' },
      h('div', { class: 'panel col' }, h('h3', null, `Dogs  ${live}/${set.maxPlayers}`),
        h('div', { class: 'plist' }, R.players.map(p => h('div', { class: 'prow' + (p.id === S.you ? ' me' : '') + (p.connected ? '' : ' off') }, h('span', { class: 'dot big', style: `background:${p.cosm.color}` }), h('span', { class: 'pname' }, p.name, p.host ? ' 👑' : ''), h('span', { class: 'pstat ' + (p.connected ? (p.ready || p.host ? 'ready' : 'wait') : 'offl') }, p.connected ? (p.host ? 'Host' : p.ready ? 'Ready' : 'Not ready') : 'Reconnecting…'), host && p.id !== S.you && h('button', { class: 'btn tiny danger', onclick: () => S.net.send({ t: 'kick', id: p.id }) }, 'Kick')))),
        h('h3', null, 'Your look'), cosmeticPicker(me),
        h('div', { class: 'renameRow' }, h('input', { id: 'renameIn', maxLength: 16, value: me?.name || '' }), h('button', { class: 'btn tiny', onclick: () => { const v = $('#renameIn').value.trim(); if (v && v !== me?.name) { S.net.send({ t: 'name', name: v }); settings.name = v; saveSettings(); } } }, 'Rename'))),
      h('div', { class: 'panel col' }, h('h3', null, 'Game Mode' + (host ? '' : '  (host chooses)')), h('div', { class: 'modes' }, modeCards),
        h('div', { class: 'setGrid' },
          h('label', null, 'Round time', sel('setDur', [[60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [480, '8 min'], [600, '10 min']], set.duration, 'duration')),
          h('label', null, 'Sheep nerves', sel('setDiff', [['easy', 'Calm'], ['normal', 'Normal'], ['hard', 'Jumpy']], set.difficulty, 'difficulty')),
          h('label', null, 'Flock size', sel('setFlock', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']], set.flock, 'flock')),
          h('label', null, 'Max dogs', sel('setMax', [2, 4, 6, 8, 10, 12].map(n => [n, n]), set.maxPlayers, 'maxPlayers')),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: set.storms || set.mode === 'stampede', disabled: !host || set.mode === 'stampede', onchange: e => S.net.send({ t: 'settings', storms: e.target.checked }) }), 'Thunderstorms'),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: set.soloAllowed, disabled: !host, onchange: e => S.net.send({ t: 'settings', soloAllowed: e.target.checked }) }), 'Allow solo rounds'),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: set.locked, disabled: !host, onchange: e => S.net.send({ t: 'lock', v: e.target.checked }) }), 'Lock room')),
        h('div', { class: 'lobbyBtns' }, host ? h('button', { class: 'btn primary big', onclick: () => S.net.send({ t: 'start' }) }, 'Start Match') : h('button', { class: 'btn primary big' + (me?.ready ? ' on' : ''), onclick: () => S.net.send({ t: 'ready', v: !me?.ready }) }, me?.ready ? '✓ Ready (click to cancel)' : 'Ready'), !host && h('small', null, 'Waiting for the host to start…')),
        h('div', { class: 'chatBox' }, chatLog, chatIn))));
  chatIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') sendChat(); });
  renderChat(); if (prevChat != null) $('#chatLog').scrollTop = prevChat;
}
function cosmeticPicker(me) {
  if (!me) return h('div');
  const herded = me.herded || 0, row = (kind, label) => h('label', { class: 'cosRow' }, label, h('select', { onchange: e => S.net.send({ t: 'cosmetic', [kind]: e.target.value }) }, COSMETICS[kind].map(([id, need]) => h('option', { value: id, selected: me.cosm[kind] === id, disabled: need > herded }, id + (need > herded ? ` 🔒 ${need} sheep` : '')))));
  return h('div', { class: 'cos' }, h('div', { class: 'swatches' }, COSMETICS.color.map(c => h('button', { class: 'sw' + (me.cosm.color === c ? ' on' : ''), style: `background:${c}`, title: c, onclick: () => S.net.send({ t: 'cosmetic', color: c }) }))), row('hat', 'Hat'), row('bandana', 'Bandana'), h('small', null, 'Hats and bandanas unlock by herding sheep during this room session. They never change gameplay. (Team modes use team colors.)'));
}
function renderChat() { const l = $('#chatLog'); if (!l) return; l.replaceChildren(...S.chat.map(c => h('div', { class: 'msg' }, h('b', null, c.name + ': '), c.text))); l.scrollTop = l.scrollHeight; }
function sendChat() { const i = $('#chatIn'); if (!i) return; const t = i.value.trim(); if (t) S.net.send({ t: 'chat', text: t }); i.value = ''; }
function leaveRoom() { S.net?.send({ t: 'leave' }); sess.clear(); S.net?.close(); S.net = null; goMenu(); }

// ----- game view
function enterGame() {
  setScreen('game'); S.inGame = true; clearUI(); ui.append(hud || buildHud()); $('#hud').style.display = 'block'; ui.append($('#hud'));
  updateHudStatic(); updateObjective(); updateScoreboard(); $('#game').style.display = 'block';
  audio.startAmbience(); audio.setMusic(settings.musicInGame ? 'game' : 'off'); S.lastCd = 0;
  showStartPrompt();
}
function showStartPrompt() {
  $('#pause')?.remove(); if (document.pointerLockElement === canvas) return;
  const p = h('div', { id: 'pause', class: 'modal dim' }, h('div', { class: 'panel modalBody' }, h('h2', null, S.phase === 'results' ? 'Round over' : S.spectator ? 'Join the field' : 'Click to take control'),
    h('p', null, 'WASD move • Mouse look • Click bark • Space dash • E howl • Shift sprint • Tab scoreboard • Esc pause'), h('button', { class: 'btn primary big', onclick: () => { p.remove(); requestLock(); } }, 'Into the field'), h('div', { class: 'btnRow' }, h('button', { class: 'btn ghost', onclick: () => { p.remove(); leaveRoom(); } }, S.practice ? 'Quit to menu' : 'Leave room'))));
  ui.append(p);
}
function showPause() {
  if ($('#pause')) return;
  const p = h('div', { id: 'pause', class: 'modal dim' }, h('div', { class: 'panel modalBody' }, h('h2', null, 'Paused'), h('p', null, S.practice ? 'The round keeps running while you are paused.' : 'The round keeps running for everyone else.'),
    h('div', { class: 'btnCol' }, h('button', { class: 'btn primary', onclick: () => { p.remove(); requestLock(); } }, 'Resume'), h('button', { class: 'btn', onclick: () => settingsScreen(true) }, 'Settings'), S.practice && h('button', { class: 'btn', onclick: () => { p.remove(); const o = S.practiceOpt; S.net?.close(); startPractice(o); } }, 'Restart round'), h('button', { class: 'btn danger', onclick: () => { p.remove(); leaveRoom(); } }, S.practice ? 'Quit to menu' : 'Leave room'))));
  ui.append(p);
}
function hidePause() { $('#pause')?.remove(); $('#settingsModal')?.remove(); }
function leaveGameView() { S.inGame = false; releaseLock(); $('#game') && ($('#game').style.display = 'none'); view?.clearField(); remotes.clear(); S.field = null; $('#pause')?.remove(); }

// ----- results
function showResults() {
  const r = S.results; if (!r) return; setScreen('results'); S.inGame = false; $('#hud') && ($('#hud').style.display = 'none');
  $('#pause')?.remove(); $('#settingsModal')?.remove();
  const mine = r.winners.includes(S.you); let title, sub;
  if (r.solo) {
    const penned = r.pens.reduce((a, p) => a + p[2], 0), val = r.pens.reduce((a, p) => a + p[1], 0), share = Math.round(val / Math.max(1, r.total) * 100);
    title = mine ? 'FLOCK PENNED!' : share >= 60 ? 'NICE HERDING' : 'TIME\'S UP'; sub = mine ? `Every sheep in ${fmtTime(r.secs * 1000)}` : `${penned} sheep penned · ${share}% of the flock's value`;
  } else if (r.mode === 'team') { title = r.winnerTeam == null ? 'DRAW' : TEAM_NAME[r.winnerTeam].toUpperCase() + ' WINS'; sub = `${r.teamScore[0]} – ${r.teamScore[1]}` + (r.reason === 'domination' ? ' · domination' : ''); }
  else { const w = r.standings.find(s => s.win); title = w ? (mine ? 'YOU WIN!' : `${w.name.toUpperCase()} WINS`) : 'NOBODY PENNED A SHEEP'; sub = w ? `${w.roundScore} points in the pen` + (r.reason === 'domination' ? ' · dominated the field' : '') : 'Time ran out'; }
  clearUI(); ui.append(h('div', { class: 'results' }, h('div', { class: 'panel resCard' }, h('div', { class: 'resBadge ' + (mine ? 'win' : '') }, mine ? '★' : '●'), h('h1', null, title), h('p', { class: 'sub' }, sub),
    h('table', { class: 'resTable' }, h('thead', null, h('tr', null, ['#', 'Dog', 'Pen pts', 'Penned', 'Steals', 'Barks', 'Dashes', 'Bumps', 'Total', 'W–L'].map(x => h('th', null, x)))),
      h('tbody', null, r.standings.map((s, i) => h('tr', { class: (s.id === S.you ? 'me ' : '') + (s.win ? 'winr' : '') }, h('td', null, i + 1), h('td', null, h('span', { class: 'dot', style: `background:${s.team != null ? TEAM_COLOR[s.team] : (infoOf(s.id)?.cosm?.color || '#fff')}` }), s.name, s.win ? ' 🏆' : ''), h('td', null, s.roundScore), h('td', null, s.herded), h('td', null, s.steals), h('td', null, s.barks), h('td', null, s.dashes), h('td', null, s.bumps), h('td', null, s.score), h('td', null, `${s.wins}–${s.losses}`))))),
    h('div', { class: 'btnRow', id: 'resBtns' }), h('small', null, 'Stats and unlocks last for this room session only.'))));
  renderResultsButtons();
}
function renderResultsButtons() {
  const b = $('#resBtns'); if (!b || !S.room) return; const host = S.room.hostId === S.you;
  b.replaceChildren(host ? h('button', { class: 'btn primary big', onclick: () => S.practice ? (S.net.close(), startPractice(S.practiceOpt)) : S.net.send({ t: 'start' }) }, S.practice ? 'Play Again' : 'Play Again (new field)') : h('button', { class: 'btn big', disabled: true }, 'Waiting for host to start…'), !S.practice && host && h('button', { class: 'btn', onclick: () => S.net.send({ t: 'toLobby' }) }, 'Back to Lobby'), h('button', { class: 'btn ghost', onclick: leaveRoom }, S.practice ? 'Quit' : 'Leave Room'));
}

// ----- settings & how-to
function settingsScreen(inGame) {
  $('#settingsModal')?.remove();
  const slider = (key, label, min, max, step, fmt) => { const out = h('output', null, fmt(settings[key])); return h('label', { class: 'srow' }, label, h('input', { type: 'range', min, max, step, value: settings[key], oninput: e => { settings[key] = +e.target.value; out.textContent = fmt(settings[key]); saveSettings(); applySettings(); } }), out); };
  const check = (key, label) => h('label', { class: 'srow chk' }, h('input', { type: 'checkbox', checked: settings[key], onchange: e => { settings[key] = e.target.checked; saveSettings(); applySettings(); } }), label);
  const m = h('div', { id: 'settingsModal', class: 'modal dim' }, h('div', { class: 'panel modalBody wide' }, h('h2', null, 'Settings'),
    h('div', { class: 'sgrid' },
      h('div', null, h('h4', null, 'Controls'), slider('sens', 'Mouse sensitivity', 0.2, 3, 0.05, v => v.toFixed(2) + '×'), check('reduceMotion', 'Reduced camera shake'), check('reduceFlash', 'Reduced flashing (lightning, hits)')),
      h('div', null, h('h4', null, 'Audio'), slider('master', 'Master volume', 0, 1, 0.05, v => Math.round(v * 100) + '%'), slider('music', 'Music volume', 0, 1, 0.05, v => Math.round(v * 100) + '%'), slider('sfx', 'Effects volume', 0, 1, 0.05, v => Math.round(v * 100) + '%'), check('musicInGame', 'Music during matches')),
      h('div', null, h('h4', null, 'Display'), slider('uiScale', 'UI scale', 0.8, 1.5, 0.05, v => Math.round(v * 100) + '%'), h('label', { class: 'srow' }, 'Graphics quality', h('select', { onchange: e => { settings.quality = e.target.value; saveSettings(); applySettings(); } }, [['low', 'Low (best FPS)'], ['medium', 'Medium'], ['high', 'High (shadows)']].map(([v, l]) => h('option', { value: v, selected: settings.quality === v }, l))), h('span')))),
    h('div', { class: 'btnRow' }, h('button', { class: 'btn primary', onclick: () => { m.remove(); } }, 'Done'))));
  (inGame ? ui : document.body).append(m);
}
function howTo() {
  const m = h('div', { class: 'modal dim' }, h('div', { class: 'panel modalBody wide' }, h('h2', null, 'How to Play'),
    h('p', null, 'You are a sheepdog. A flock of sheep is loose in the field, and every dog has a pen. Sheep run away from dogs, so work your way around behind them and push them into YOUR pen. Whoever has the most sheep in their pen when time runs out wins — and rival dogs can steal sheep out of yours.'),
    h('div', { class: 'sgrid' }, h('div', null, h('h4', null, 'Controls'), h('ul', null, h('li', null, h('kbd', null, 'W A S D'), ' run (relative to the camera)'), h('li', null, h('kbd', null, 'Mouse'), ' turn the camera'), h('li', null, h('kbd', null, 'Click'), ' / ', h('kbd', null, 'F'), ' bark — startles sheep in front of you'), h('li', null, h('kbd', null, 'Space'), ' dash — barge through the flock and stun rival dogs'), h('li', null, h('kbd', null, 'E'), ' howl — a huge shout that scatters every sheep near you'), h('li', null, h('kbd', null, 'Shift'), ' sprint (uses stamina)'), h('li', null, h('kbd', null, 'Tab'), ' scoreboard'), h('li', null, h('kbd', null, 'Esc'), ' pause'))),
      h('div', null, h('h4', null, 'The flock'), h('p', null, 'White sheep are worth 1. Black sheep are worth 2 but sprint faster. The golden sheep in the middle is worth 5 and is skittish. Sheep avoid you from about 8 metres away; sprinting makes them spook earlier. Mud slows everything down.'), h('h4', null, 'Winning'), h('p', null, 'Hold 60% of the flock\'s value for 8 seconds and you win on the spot, so keep an eye on the leader. Thunderstorms make every loose sheep bolt, which resets the race.'))),
    h('h4', null, 'Modes'), h('ul', { class: 'modesList' }, Object.values(MODES).map(v => h('li', null, h('b', null, v.label + ': '), v.desc))),
    h('div', { class: 'btnRow' }, h('button', { class: 'btn primary', onclick: () => m.remove() }, 'Got it'))));
  document.body.append(m);
}

// ------------------------------------------------------------------ boot
async function boot() {
  ui = $('#ui'); canvas = $('#game'); bindInput(); applySettings();
  if (!navigator.userAgent || !window.WebGLRenderingContext) { return fatal('Your browser does not support WebGL, which this game needs. Please use a current desktop Chrome, Edge or Firefox.'); }
  try { initView(); } catch (e) { return fatal('Could not start the 3D renderer (' + (e.message || e) + '). Make sure hardware acceleration is enabled, or try another browser.'); }
  document.body.append(h('div', { id: 'toasts' }), h('div', { id: 'conn', class: 'bad', title: 'Offline' }));
  S.net = null; setScreen('menu'); $('#loading')?.remove();
  lastFrame = performance.now(); rafId = requestAnimationFrame(frame);
  // Invite link (/r/ABCDE) or a refresh while in a room: reconnect automatically.
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{5})\/?$/), saved = sess.get();
  if (m) inviteJoin(m[1].toUpperCase(), saved && saved.code === m[1].toUpperCase() ? saved.token : undefined);
  else if (saved) { busy('Rejoining your room…'); try { S.net = new OnlineNet(); await S.net.open({ t: 'join', code: saved.code, token: saved.token, name: settings.name }); unbusy(); } catch { unbusy(); sess.clear(); goMenu(); } }
  else goMenu();
  window.__flock = { S, L, settings, remotes, keys }; // handy for debugging in the console
}
function inviteJoin(code, token) {
  setScreen('menu'); clearUI(); audio.setMusic('menu');
  const join = async (name) => { audio.unlock(); busy('Joining room ' + code + '…'); try { S.net?.close(); S.net = new OnlineNet(); await S.net.open({ t: 'join', code, name, token }); } catch { unbusy(); offlineNotice(); } };
  if (token && settings.name) return join(settings.name);
  const nameIn = h('input', { id: 'nameIn', maxLength: 16, placeholder: 'Your name', value: settings.name || '', autocomplete: 'off' });
  const go = () => { const n = nameIn.value.trim(); if (n.length < 2) return toast('Pick a name (2–16 characters).', 'bad'); settings.name = n; saveSettings(); join(n); };
  ui.append(h('div', { class: 'menu' }, logo(), h('div', { class: 'menuCard panel' }, h('h3', null, "You've been invited!"), h('p', { class: 'sub' }, 'Room ', h('b', null, code)), nameIn, h('div', { class: 'btnCol' }, h('button', { class: 'btn primary', onclick: go }, 'Join Game'), h('button', { class: 'btn ghost', onclick: () => { history.replaceState(null, '', '/'); goMenu(); } }, 'Main Menu')))));
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); nameIn.focus();
}
function fatal(msg) { $('#loading')?.remove(); document.body.append(h('div', { class: 'modal' }, h('div', { class: 'panel modalBody' }, h('h2', null, 'Can\'t start the game'), h('p', null, msg)))); }

boot();
