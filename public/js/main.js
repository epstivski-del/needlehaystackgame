// NEEDLE IN A HAYSTACK — game client: UI, networking, first-person controller, HUD.
// Online play talks to the authoritative server over WSS. Practice mode runs the SAME engine locally (no network).
import * as W from '/shared/world.js';
import { Hub, MODES, COSMETICS, DECOYS, unlocked } from '/shared/engine.js';
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
const fmtTime = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const store = { get(k, d) { try { const v = localStorage.getItem('needle.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('needle.' + k, JSON.stringify(v)); } catch {} } };
const sess = { get() { try { return JSON.parse(sessionStorage.getItem('needle.session') || 'null'); } catch { return null; } }, set(v) { try { sessionStorage.setItem('needle.session', JSON.stringify(v)); } catch {} }, clear() { try { sessionStorage.removeItem('needle.session'); } catch {} } };

// ------------------------------------------------------------------ settings
const DEFAULTS = { sens: 1, master: 0.8, music: 0.5, sfx: 0.9, bob: true, reduceMotion: false, reduceFlash: false, uiScale: 1, quality: 'medium', musicInGame: true, name: '', cosm: {} };
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
  net: null, practice: false, you: null, code: null, token: null, room: null, round: null, world: null, phase: 'menu', inGame: false,
  remaining: 0, phaseMs: 0, lastTimerAt: 0, scores: new Map(), teams: {}, hider: null, results: null,
  search: null, revealed: new Map(), det: { on: false, level: 0, battery: 100, nextBeep: 0, avail: false }, lastLevel: 0, flash: 0,
  notes: [], chat: [], connected: false, reconnecting: false, tabDown: false,
};
let view = null, canvas = null, rafId = 0, lastFrame = 0, ui = null, hud = null;
const L = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, onGround: true, stamina: 100, staminaHold: 0, bob: 0, bobT: 0, stepD: 0, fov: 75, roll: 0, eye: W.EYE_HEIGHT, sprinting: false, moving: false, wasAir: false };
const keys = new Set();
let lockWanted = false, sendT = 0, lastClick = 0, lastDigSound = 0;
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
    S.reconnecting = true; note('Connection lost. Reconnecting…', 'bad'); showBanner('Connection lost — reconnecting…');
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

// ------------------------------------------------------------------ toasts / notifications
function toast(text, kind = '') { const box = $('#toasts'); const t = h('div', { class: 'toast ' + kind }, text); box.append(t); setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700); while (box.children.length > 5) box.firstChild.remove(); }
function note(text, kind = '') { toast(text, kind); }

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
    case 'room': S.room = m; for (const p of m.players) S.scores.set(p.id, { round: p.roundScore, total: p.score, needles: p.needles }); if (!m.practice && S.phase !== 'playing' && S.phase !== 'countdown' && S.phase !== 'setup' && S.phase !== 'results') { S.phase = m.phase; } return onRoom();
    case 'notice': if (m.kind === 'join') audio.join(); else if (m.kind === 'leave') audio.leave(); if (!S.practice || m.kind === 'info') note(m.text, m.kind === 'leave' ? 'bad' : ''); if (m.kind === 'leave' && m.who) { remotes.delete(m.who); view?.removeRemote(m.who); } return;
    case 'chat': S.chat.push(m); if (S.chat.length > 60) S.chat.shift(); return renderChat();
    case 'err': unbusy(); audio.error(); toast(m.msg, 'bad'); if (['NOT_FOUND', 'BAD_CODE', 'FULL', 'LOCKED', 'BANNED', 'NAME_BAD', 'RATE_LIMIT', 'SERVER_BUSY'].includes(m.code) && !S.room) { sess.clear(); S.net?.close(); S.net = null; goMenu(); } if (m.code === 'NOT_FOUND') sess.clear(); if (m.code === 'REPLACED') { S.net?.close(); S.net = null; goMenu(); } return;
    case 'kicked': toast(m.msg, 'bad'); sess.clear(); S.code = null; S.token = null; S.net?.close(); S.net = null; return goMenu();
    case 'round': return startRound(m);
    case 'phase': S.phase = m.phase; S.remaining = m.remainingMs; S.phaseMs = m.phaseMs || 0; S.lastTimerAt = performance.now(); if (m.phase === 'playing') { audio.go(); banner('GO!', 'Find the needle'); L.stamina = 100; } if (m.phase === 'setup') banner(S.hider === S.you ? 'Hide the needle' : 'The hider is hiding the needle…', S.hider === S.you ? 'Stand in a hay pile and press E' : 'Hold tight'); return updateObjective();
    case 'timer': S.phase = m.phase; S.remaining = m.remainingMs; S.lastTimerAt = performance.now(); if (m.phase === 'playing' && m.remainingMs <= 10000 && m.remainingMs > 0) audio.tick(m.remainingMs <= 3000); return;
    case 'snap': return onSnap(m);
    case 'tp': { L.x = m.x; L.z = m.z; if (m.y != null) L.y = m.y; if (m.yaw != null) L.yaw = m.yaw; if (m.hard) { L.vx = L.vz = L.vy = 0; } return; }
    case 'ev': return onEvent(m);
    case 'scores': for (const [id, r, t, n] of m.s) S.scores.set(id, { round: r, total: t, needles: n }); return updateScoreboard();
    case 'search_started': S.search = { start: performance.now(), ms: m.ms, sent: false }; audio.searchStart(); view?.setDigging(true); toast('Searching…'); return;
    case 'search_denied': S.search = null; view?.setDigging(false); if (m.why === 'nopile') toast('Nothing to dig through here. Walk into hay first.', 'bad'); return;
    case 'search_result': return onSearchResult(m);
    case 'reveal': S.revealed.set(m.id, { x: m.x, z: m.z, golden: m.golden }); view?.showNeedle(m.id, m.x, m.z, m.golden); audio.needleReveal(); toast(m.golden ? 'The GOLDEN needle! Press E to grab it!' : 'You uncovered the needle! Press E to grab it!', 'good'); return;
    case 'pickup_fail': if (m.why === 'late') toast('Too late. Someone got there first.', 'bad'); else if (m.why === 'range') toast('Get closer to the needle.', 'bad'); return;
    case 'det': S.det.level = m.s; S.det.battery = m.b; S.det.on = m.on; if (m.low) { toast('Detector battery low.', 'bad'); audio.detLow(); } view?.setDetector(S.det.on, S.det.level); return updateDetHud();
    case 'placed': if (m.ok) { toast('Needle hidden! Waiting for the hunt to begin…', 'good'); audio.needleReveal(); } else toast(m.msg, 'bad'); return;
    case 'lobby': S.phase = 'lobby'; return showLobby();
    case 'results': return onResults(m);
  }
}

function onRoom() {
  if (S.screen === 'lobby') renderLobby();
  if (S.inGame) { updateScoreboard(); updateHudStatic(); }
  const me = S.room?.players.find(p => p.id === S.you);
  if (me && S.screen === 'results') renderResultsButtons();
}

// ------------------------------------------------------------------ round start
function startRound(m) {
  S.round = m; S.phase = m.phase; S.hider = m.hiderId; S.teams = m.teams || {}; S.remaining = m.remainingMs; S.phaseMs = m.phaseMs; S.lastTimerAt = performance.now();
  S.revealed.clear(); S.search = null; S.results = null; S.det = { on: false, level: 0, battery: m.battery ?? 100, nextBeep: 0, avail: !!m.detector };
  S.world = W.generateWorld(m.seed, m.map);
  if (!view) initView();
  view.setQuality(settings.quality); view.loadWorld(S.world); view.clearRemotes(); remotes.clear();
  view.setDetector(false, 0); view.setDigging(false); view.setLoadout({ skin: myCosm().skin, gloves: myCosm().gloves });
  const sp = m.you.spawn || S.world.spawns[0]; Object.assign(L, { x: sp.x, y: 0, z: sp.z, vx: 0, vz: 0, vy: 0, yaw: sp.yaw ?? 0, pitch: 0, onGround: true, stamina: 100, staminaHold: 0, bob: 0, stepD: 0 });
  enterGame();
  banner('Get ready', MODES[m.mode]?.label || '');
}

function myCosm() { return S.room?.players.find(p => p.id === S.you)?.cosm || {}; }

function onResults(m) {
  S.results = m; S.phase = 'results'; S.search = null; view?.setDigging(false); view?.setDetector(false, 0); S.det.on = false;
  for (const n of m.needles) view?.showNeedle('end' + n.x, n.x, n.z, n.golden);
  const mine = m.winners.includes(S.you), solo = S.practice;
  if (m.reason === 'found' || mine) { mine ? audio.victory() : audio.roundEndOther(); } else audio.defeat();
  releaseLock(); setTimeout(() => { if (S.phase === 'results') showResults(); }, S.practice ? 400 : 1600);
}

function onEvent(m) {
  switch (m.k) {
    case 'needle_found': {
      const me = m.id === S.you; S.revealed.delete(m.needleId); view?.hideNeedle(m.needleId);
      toast(me ? `You found the ${m.golden ? 'golden ' : ''}needle! +${m.points}` : `${m.name} found the ${m.golden ? 'golden ' : ''}needle!`, me ? 'good' : 'bad');
      if (me) { audio.needlePickup(m.golden); flash('#ffd24a'); } else audio.notify();
      banner(me ? 'YOU FOUND IT!' : `${m.name} found the needle`, '');
      return;
    }
    case 'needle_moved': S.revealed.clear(); view?.hideNeedles(); toast('A new needle has been hidden!', ''); return;
    case 'decoy': toast(`${m.name} dug up a ${m.type}${m.points ? ` (+${m.points})` : ''}`); return;
    case 'search_start': return; // remote avatars animate from snapshot flags
    case 'search_stop': return;
    case 'gone': remotes.delete(m.id); view?.removeRemote(m.id); return;
  }
}

function onSearchResult(m) {
  S.search = null; view?.setDigging(false);
  if (m.result === 'cancelled') { audio.searchCancel(); return toast('Search interrupted', 'bad'); }
  if (m.result === 'nothing') { audio.nothing(); return toast('Nothing but hay…'); }
  if (m.result === 'decoy') { audio.decoy(m.type); view?.spawnDecoy(m.type, m.x, m.z); toast(m.points ? `Found a ${m.type}! +${m.points}` : `Found a ${m.type}.`, 'good'); return; }
  if (m.result === 'needle') { flash('#fff2b0'); }
}

// ------------------------------------------------------------------ snapshots and interpolation
function onSnap(m) {
  const now = performance.now();
  for (const [id, x, y, z, yaw, pitch, f] of m.p) {
    if (id === S.you) continue;
    let r = remotes.get(id); if (!r) { r = { buf: [], stepD: 0, last: null }; remotes.set(id, r); }
    r.buf.push({ t: now, x, y, z, yaw, pitch, f }); if (r.buf.length > 12) r.buf.shift();
  }
}
const lerpAng = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
function updateRemotes(dt) {
  const rt = performance.now() - 130;
  for (const [id, r] of remotes) {
    const b = r.buf; if (!b.length) continue;
    let a = b[0], c = b[b.length - 1];
    if (rt >= c.t) { a = c; }
    else { for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= rt) { a = b[i - 1]; c = b[i]; break; } }
    const k = a === c || c.t === a.t ? 1 : clamp((rt - a.t) / (c.t - a.t), 0, 1);
    const d = { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: lerpAng(a.yaw, c.yaw, k), pitch: a.pitch + (c.pitch - a.pitch) * k, flags: c.f };
    const info = S.room?.players.find(p => p.id === id); if (!info || !info.connected) { view.removeRemote(id); continue; }
    view.setRemote(id, { ...d, name: info.name, team: S.teams[id] ?? info.team, cosm: info.cosm });
    if (r.last && (c.f & 1)) { r.stepD += Math.hypot(d.x - r.last.x, d.z - r.last.z); if (r.stepD > ((c.f & 2) ? 2.1 : 1.6)) { r.stepD = 0; audio.footstep(W.surfaceAt(S.world, d.x, d.z), !!(c.f & 2), { id, dx: d.x - L.x, dz: d.z - L.z, yaw: L.yaw }); } }
    if (c.f & 4 && Math.random() < dt * 5) audio.rustle({ id, dx: d.x - L.x, dz: d.z - L.z, yaw: L.yaw });
    r.last = d;
  }
  for (const id of [...remotes.keys()]) if (!S.room?.players.some(p => p.id === id)) { remotes.delete(id); view.removeRemote(id); }
}

// ------------------------------------------------------------------ first-person controller
function canMove() { return S.inGame && document.pointerLockElement === canvas && (S.phase === 'playing' || (S.phase === 'setup' && S.hider === S.you)); }
function frozen() { return S.phase === 'countdown' || (S.phase === 'setup' && S.hider !== S.you); }

function stepPlayer(dt) {
  const active = canMove();
  let ix = 0, iz = 0;
  if (active) { if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1; if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1; }
  const len = Math.hypot(ix, iz); if (len) { ix /= len; iz /= len; }
  const wantSprint = active && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && len > 0 && iz <= 0.01 + (ix ? 1 : 0) && L.stamina > 4;
  L.sprinting = wantSprint && L.stamina > 0;
  const pile = S.world ? W.pileAt(S.world, L.x, L.z) : null;
  const slow = pile ? (pile.deep ? 0.62 : 0.84) : 1;
  const target = (L.sprinting ? W.SPRINT_SPEED : W.WALK_SPEED) * slow * (S.search ? 0.15 : 1);
  const sin = Math.sin(L.yaw), cos = Math.cos(L.yaw);
  const tx = (ix * cos + iz * sin) * target, tz = (iz * cos - ix * sin) * target;
  const acc = (L.onGround ? (len ? 11 : 9) : 2.5) * dt;
  L.vx += (tx - L.vx) * Math.min(1, acc); L.vz += (tz - L.vz) * Math.min(1, acc);
  L.moving = Math.hypot(L.vx, L.vz) > 0.6;
  if (frozen() || !S.inGame || S.phase === 'results') { L.vx = L.vz = 0; L.moving = false; }
  if (S.world && !frozen() && S.phase !== 'results') {
    const nx = L.x + L.vx * dt, nz = L.z + L.vz * dt; const r = W.resolveCollision(S.world, nx, nz); L.x = r.x; L.z = r.z;
  }
  // jump / gravity
  if (active && L.onGround && keys.has('Space') && !S.search) { L.vy = W.JUMP_VELOCITY * (pile && pile.deep ? 0.8 : 1); L.onGround = false; audio.jump(); }
  if (!L.onGround) { L.vy -= W.GRAVITY * dt; L.y += L.vy * dt; if (L.y <= 0) { L.y = 0; if (L.wasAir && L.vy < -3) audio.land(L.vy < -8); L.vy = 0; L.onGround = true; } }
  L.wasAir = !L.onGround;
  if (L.y < -4 || !Number.isFinite(L.x + L.z + L.y)) { S.net?.send({ t: 'respawn' }); L.y = 0; L.vy = 0; }
  // stamina
  if (L.sprinting && L.moving) { L.stamina = Math.max(0, L.stamina - 24 * dt); L.staminaHold = 0.9; } else { L.staminaHold -= dt; if (L.staminaHold <= 0) L.stamina = Math.min(100, L.stamina + 16 * dt); }
  // head bob / steps
  const spd = Math.hypot(L.vx, L.vz);
  if (L.onGround && spd > 0.8) {
    L.bobT += dt * (L.sprinting ? 12 : 8.5) * (spd / W.WALK_SPEED > 1 ? 1 : 1);
    const amp = settings.bob && !settings.reduceMotion ? (L.sprinting ? 0.075 : 0.045) : 0; L.bob = Math.sin(L.bobT) * amp;
    L.stepD += spd * dt; if (L.stepD > (L.sprinting ? 2.6 : 1.95)) { L.stepD = 0; audio.footstep(W.surfaceAt(S.world, L.x, L.z), L.sprinting); }
  } else { L.bob *= 0.85; }
  const fovT = (settings.reduceMotion ? 75 : 75 + (L.sprinting && L.moving ? 7 : 0)); L.fov = fovT;
  L.roll = settings.reduceMotion ? 0 : -ix * 0.012;
  // search is cancelled by walking away
  if (S.search && spd > 1.4) cancelSearch();
  if (S.search && !S.search.sent && performance.now() - S.search.start >= S.search.ms) { S.search.sent = true; S.net?.send({ t: 'search_finish' }); }
  // network position
  sendT += dt; if (sendT >= 0.05 && S.inGame && (S.phase === 'playing' || (S.phase === 'setup' && S.hider === S.you))) { sendT = 0; S.net?.send({ t: 'pos', x: L.x, y: L.y, z: L.z, yaw: L.yaw, pitch: L.pitch, f: (L.moving ? 1 : 0) | (L.sprinting ? 2 : 0) | (L.onGround ? 0 : 16) }); }
}

function cancelSearch() { if (!S.search) return; S.search = null; view?.setDigging(false); S.net?.send({ t: 'search_cancel' }); }

function interactTarget() {
  for (const [id, n] of S.revealed) { const d = Math.hypot(n.x - L.x, n.z - L.z); if (d < 2.4) return { kind: 'needle', id, d }; }
  if (S.phase === 'setup' && S.hider === S.you) return { kind: 'place' };
  if (S.phase === 'playing' && S.hider !== S.you && S.world && W.pileAt(S.world, L.x, L.z, 1.3)) return { kind: 'search' };
  return null;
}

function interact() {
  if (!canMove()) return;
  const t = interactTarget(); if (!t) return;
  if (t.kind === 'needle') S.net?.send({ t: 'pickup', id: t.id });
  else if (t.kind === 'place') S.net?.send({ t: 'place_needle' });
  else if (t.kind === 'search' && !S.search) S.net?.send({ t: 'search_start' });
}

function disturbHay() {
  const now = performance.now(); if (now - lastClick < 280 || !canMove() || S.search) return; lastClick = now;
  const px = L.x - Math.sin(L.yaw) * 1.5, pz = L.z - Math.cos(L.yaw) * 1.5, inPile = W.pileAt(S.world, px, pz, 0.4);
  if (inPile) { view.strawBurst(px, 0.5, pz, 12, 3.6); audio.rustle(); } else audio.rustle();
}

// ------------------------------------------------------------------ input
function releaseLock() { lockWanted = false; if (document.pointerLockElement) document.exitPointerLock(); }
function requestLock() { lockWanted = true; try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p?.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch {} }); } catch { try { canvas.requestPointerLock(); } catch {} } }

function bindInput() {
  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input,textarea,select')) { if (e.key === 'Enter' && e.target.id === 'chatIn') sendChat(); return; }
    if (e.code === 'Tab') { e.preventDefault(); if (S.inGame) { S.tabDown = true; $('#scoreboard').classList.add('show'); updateScoreboard(); } return; }
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && S.inGame) e.preventDefault();
    if (e.repeat) return; keys.add(e.code);
    if (!S.inGame) return;
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyQ' || e.code === 'KeyF') toggleDetector();
  });
  document.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') { S.tabDown = false; $('#scoreboard')?.classList.remove('show'); } });
  window.addEventListener('blur', () => { keys.clear(); S.tabDown = false; $('#scoreboard')?.classList.remove('show'); });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement !== canvas || !S.inGame) return;
    const k = 0.0022 * settings.sens; L.yaw -= clamp(e.movementX, -250, 250) * k; L.pitch = clamp(L.pitch - clamp(e.movementY, -250, 250) * k, -1.5, 1.5);
  });
  document.addEventListener('mousedown', e => { if (e.button === 0 && document.pointerLockElement === canvas) disturbHay(); });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && lockWanted && S.inGame && S.phase !== 'results' && S.screen === 'game') { lockWanted = false; showPause(); if (S.search) cancelSearch(); }
    if (locked) { hidePause(); audio.unlock(); }
  });
  document.addEventListener('pointerlockerror', () => toast('Could not capture the mouse. Click the game and try again.', 'bad'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) { audio.suspend(); } else audio.resume(); });
  document.addEventListener('contextmenu', e => { if (S.inGame) e.preventDefault(); });
  document.addEventListener('click', e => { if (e.target.closest?.('button')) audio.click(); }, true);
  document.addEventListener('mouseover', e => { if (e.target.closest?.('button:not(:disabled)')) audio.hover(); });
}

function toggleDetector() {
  if (!S.det.avail || S.phase !== 'playing' || S.hider === S.you) return;
  const on = !S.det.on; if (on && S.det.battery < 15) { audio.detLow(); return toast('Battery too low. Let it recharge.', 'bad'); }
  S.net?.send({ t: 'detector', on }); S.det.on = on; on ? audio.detOn() : audio.detOff(); S.det.level = 0; view?.setDetector(on, 0); updateDetHud();
}

// ------------------------------------------------------------------ frame loop
function frame(ts) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0.016); lastFrame = ts;
  if (!S.inGame || !view) return;
  stepPlayer(dt); updateRemotes(dt); detectorBeeps(dt); updateHud(dt);
  view.render(dt, { x: L.x, y: L.y, z: L.z, yaw: L.yaw, pitch: L.pitch, eye: L.eye, bob: L.bob, roll: L.roll, fov: L.fov });
}

function detectorBeeps(dt) {
  if (!S.det.on || S.phase !== 'playing') return;
  const s = S.det.level; if (s <= 0.02) return;
  S.det.nextBeep -= dt; if (S.det.nextBeep <= 0) { audio.beep(s); S.det.nextBeep = 1.4 - 1.28 * Math.pow(s, 0.8); }
  view.setDetector(true, s);
}

// ------------------------------------------------------------------ HUD
function buildHud() {
  hud = h('div', { id: 'hud' },
    h('div', { id: 'hudTL', class: 'panel' }, h('div', { id: 'hudName' }), h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'ROUND'), h('b', { id: 'hudRound' }, '0')), h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'TOTAL'), h('b', { id: 'hudTotal' }, '0')), h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'PLAYERS'), h('b', { id: 'hudPlayers' }, '1'))),
    h('div', { id: 'hudTop' }, h('div', { id: 'hudTimer', class: 'panel' }, '0:00'), h('div', { id: 'hudObj' }), h('div', { id: 'hudTeams' })),
    h('div', { id: 'cross' }), h('div', { id: 'prompt' }),
    h('div', { id: 'searchBar' }, h('div', { id: 'searchFill' }), h('span', { id: 'searchTxt' }, 'Searching…')),
    h('div', { id: 'stam' }, h('div', { id: 'stamFill' })),
    h('div', { id: 'det', class: 'panel' }, h('div', { class: 'lbl' }, 'METAL DETECTOR  [Q]'), h('div', { id: 'detMeter' }, h('div', { id: 'detFill' })), h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'BATTERY'), h('div', { id: 'batt' }, h('div', { id: 'battFill' })))),
    h('div', { id: 'bigBanner' }, h('div', { id: 'bbTitle' }), h('div', { id: 'bbSub' })),
    h('div', { id: 'flash' }),
    h('div', { id: 'ping' }, ''),
    h('div', { id: 'scoreboard', class: 'panel' }),
  );
  return hud;
}
let bannerT = 0;
function banner(title, sub) { const b = $('#bigBanner'); if (!b) return; $('#bbTitle').textContent = title; $('#bbSub').textContent = sub || ''; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), 2400); }
function flash(color) { if (settings.reduceFlash) return; const f = $('#flash'); if (!f) return; f.style.background = color; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
function updatePing() { const p = $('#ping'); if (p && S.net?.rtt) p.textContent = Math.round(S.net.rtt) + ' ms'; }
function updateObjective() {
  const o = $('#hudObj'); if (!o || !S.round) return; const m = S.round.mode;
  let t = { classic: 'Find the needle before anyone else', team: 'Find YOUR team\'s needle first', golden: 'Find the GOLDEN needle', endless: 'Find as many needles as you can', hideseek: S.hider === S.you ? 'Hide the needle in a hay pile' : 'Find the hidden needle' }[m] || '';
  if (S.phase === 'countdown') t = 'Get ready…'; o.textContent = t;
  const teams = $('#hudTeams'); if (teams) { const me = S.room?.players.find(p => p.id === S.you); teams.textContent = m === 'team' && me?.team != null ? (me.team === 0 ? '● RED TEAM' : '● BLUE TEAM') : ''; teams.className = me?.team === 0 ? 'red' : 'blue'; }
}
function updateHudStatic() {
  const me = S.room?.players.find(p => p.id === S.you); if (!me || !$('#hudName')) return;
  $('#hudName').textContent = me.name; $('#hudPlayers').textContent = S.room.players.filter(p => p.connected).length;
  const sc = S.scores.get(S.you); if (sc) { $('#hudRound').textContent = sc.round; $('#hudTotal').textContent = sc.total; }
  updateObjective();
}
function updateDetHud() { const d = $('#det'); if (!d) return; d.style.display = S.det.avail && S.hider !== S.you ? 'block' : 'none'; d.classList.toggle('on', S.det.on); $('#detFill').style.width = (S.det.on ? S.det.level * 100 : 0) + '%'; $('#battFill').style.width = S.det.battery + '%'; $('#battFill').style.background = S.det.battery < 20 ? '#e0533d' : '#e6b94a'; }
function updateScoreboard() {
  const sb = $('#scoreboard'); if (!sb || !S.room) return;
  const rows = [...S.room.players].map(p => ({ p, s: S.scores.get(p.id) || { round: 0, total: 0, needles: 0 } })).sort((a, b) => b.s.round - a.s.round || b.s.total - a.s.total);
  const showTeam = S.round?.mode === 'team';
  sb.replaceChildren(h('div', { class: 'sbTitle' }, 'SCOREBOARD'), h('table', null, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Player'), showTeam && h('th', null, 'Team'), h('th', null, 'Round'), h('th', null, 'Total'), h('th', null, 'Needles'), h('th', null, ''))),
    h('tbody', null, rows.map((r, i) => h('tr', { class: r.p.id === S.you ? 'me' : '' }, h('td', null, i + 1), h('td', null, h('span', { class: 'dot', style: `background:${r.p.cosm.color}` }), r.p.name, r.p.host ? ' 👑' : ''), showTeam && h('td', null, r.p.team === 0 ? 'Red' : r.p.team === 1 ? 'Blue' : '-'), h('td', null, r.s.round), h('td', null, r.s.total), h('td', null, r.s.needles), h('td', { class: r.p.connected ? 'okc' : 'badc' }, r.p.connected ? '●' : 'offline'))))));
}
function updateHud(dt) {
  const t = S.phase === 'playing' || S.phase === 'setup' || S.phase === 'countdown' ? Math.max(0, S.remaining - (performance.now() - S.lastTimerAt)) : 0;
  const tm = $('#hudTimer'); if (tm) { tm.textContent = S.phase === 'countdown' ? 'GET READY' : S.phase === 'setup' ? 'HIDE ' + fmtTime(t) : fmtTime(t); tm.classList.toggle('low', S.phase === 'playing' && t < 15000); }
  if (S.phase === 'countdown') { const cd = Math.ceil(S.phaseMs - (performance.now() - S.lastTimerAt)) / 1000; const n = Math.ceil(cd); if (n > 0 && n <= 3 && S.lastCd !== n) { S.lastCd = n; audio.tick(false); $('#bbTitle').textContent = n; $('#bbSub').textContent = ''; const b = $('#bigBanner'); b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); } } else S.lastCd = 0;
  const tgt = interactTarget(), p = $('#prompt');
  let txt = '';
  if (canMove() && !S.search && tgt) txt = tgt.kind === 'needle' ? '[E]  Pick up the needle' : tgt.kind === 'place' ? '[E]  Hide the needle here' : '[E]  Search the hay   •   [Click] Scatter';
  if (!canMove() && S.inGame && S.phase !== 'results' && !$('#pause')) txt = '';
  p.textContent = txt; p.style.opacity = txt ? 1 : 0; p.classList.toggle('needle', tgt?.kind === 'needle');
  const sb = $('#searchBar'); if (S.search) { sb.style.display = 'block'; $('#searchFill').style.width = clamp((performance.now() - S.search.start) / S.search.ms, 0, 1) * 100 + '%'; } else sb.style.display = 'none';
  $('#stamFill').style.width = L.stamina + '%'; $('#stam').style.opacity = L.stamina < 99 ? 0.9 : 0;
  if (S.det.avail) { if (S.det.on) { /* local drain estimate between server updates */ } updateDetHud(); }
  if (dt) { const fl = S.search ? 1 : 0; document.body.classList.toggle('searching', !!fl); }
}

// ------------------------------------------------------------------ screens
function initView() { canvas = $('#game'); view = createView(canvas); view.setQuality(settings.quality); }
function clearUI() { ui.replaceChildren(); }
function setScreen(name) { S.screen = name; document.body.dataset.screen = name; }

function logo(small) {
  return h('div', { class: 'logo' + (small ? ' small' : ''), html: `
  <svg viewBox="0 0 420 150" role="img" aria-label="Needle in a Haystack logo">
    <defs><linearGradient id="gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d27a"/><stop offset="1" stop-color="#c8963a"/></linearGradient></defs>
    <g stroke="#7a5420" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".95">
      <path d="M70 128 C40 118 28 96 44 80 C46 56 74 44 96 52 C108 30 150 24 170 44 C196 28 240 30 256 52 C284 46 318 58 322 84 C346 92 350 120 322 128 Z" fill="url(#gh)"/>
      ${Array.from({ length: 46 }, (_, i) => { const x = 50 + i * 6; const y = 70 + ((i * 37) % 40); const a = ((i * 53) % 50) - 25; return `<path d="M${x} ${y + 40} q${a / 3} -22 ${a} -${28 + (i % 4) * 5}"/>`; }).join('')}
    </g>
    <g transform="translate(236 78) rotate(-24)"><rect x="-34" y="-1.6" width="68" height="3.2" rx="1.6" fill="#e9eef3" stroke="#59616a" stroke-width=".6"/><ellipse cx="-30" cy="0" rx="2.4" ry="1.1" fill="#59616a"/><path d="M34 0 L44 0" stroke="#e9eef3" stroke-width="1.2"/></g>
    <g class="twinkle" transform="translate(262 62)"><path d="M0 -9 L1.6 -1.6 L9 0 L1.6 1.6 L0 9 L-1.6 1.6 L-9 0 L-1.6 -1.6 Z" fill="#fff8d0"/></g>
  </svg><div class="logoTxt"><span>NEEDLE</span><small>in a</small><span>HAYSTACK</span></div>` });
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
    logo(),
    h('div', { class: 'menuCard panel' },
      nameIn,
      h('div', { class: 'btnCol' },
        h('button', { class: 'btn primary', onclick: () => startOnline('quick') }, 'Play Online'),
        h('button', { class: 'btn', onclick: () => startOnline('create') }, 'Create Private Room'),
        h('div', { class: 'joinRow' }, codeIn, h('button', { class: 'btn', onclick: () => { const n = name(); if (!n) return; const c = codeIn.value.trim().toUpperCase(); if (c.length !== 5) return toast('Enter the 5-character room code.', 'bad'); go({ t: 'join', code: c, name: n }); } }, 'Join Room')),
        h('div', { class: 'divider' }),
        h('button', { class: 'btn', onclick: practiceMenu }, 'Practice Mode'),
        h('div', { class: 'btnRow' }, h('button', { class: 'btn ghost', onclick: settingsScreen }, 'Settings'), h('button', { class: 'btn ghost', onclick: howTo }, 'How to Play')))),
    h('div', { class: 'foot' }, 'Practice works offline. Online rooms hold 2–12 players.')));
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
  let diff = 'normal';
  const m = h('div', { class: 'modal' }, h('div', { class: 'panel modalBody' }, h('h2', null, 'Practice Mode'), h('p', null, 'A solo hunt in the full arena — no connection needed. Try the detector and learn the controls.'),
    h('div', { class: 'seg', id: 'diffSeg' }, ['easy', 'normal', 'hard'].map(d => h('button', { class: 'segBtn' + (d === diff ? ' on' : ''), onclick: e => { diff = d; for (const b of $('#diffSeg').children) b.classList.remove('on'); e.target.classList.add('on'); } }, d[0].toUpperCase() + d.slice(1)))),
    h('div', { class: 'btnRow' }, h('button', { class: 'btn primary', onclick: () => { m.remove(); startPractice(diff); } }, 'Start'), h('button', { class: 'btn', onclick: () => m.remove() }, 'Cancel'))));
  document.body.append(m);
}

function startPractice(diff) {
  const typed = $('#nameIn')?.value.trim(); if (typed && typed.length >= 2) { settings.name = typed; saveSettings(); }
  audio.unlock(); S.net?.close(); S.net = new LocalNet(); S.practice = true;
  S.net.open({ t: 'create', name: settings.name || 'Farmer', practice: true, difficulty: diff });
  S.practiceDiff = diff;
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
  const canStart = host;
  const live = R.players.filter(p => p.connected).length;
  root.replaceChildren(
    h('div', { class: 'lobbyTop' }, logo(true),
      h('div', { class: 'invite panel' }, h('div', null, h('small', null, 'ROOM CODE'), h('div', { class: 'code' }, R.code)), h('div', { class: 'inviteLink' }, h('input', { readOnly: true, value: inviteUrl(), onfocus: e => e.target.select() }), h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(inviteUrl()); toast('Invite link copied!', 'good'); } catch { $('.inviteLink input').select(); document.execCommand?.('copy'); toast('Invite link selected — press Ctrl+C.'); } } }, 'Copy Invite Link'))),
      h('button', { class: 'btn ghost', onclick: leaveRoom }, 'Leave')),
    h('div', { class: 'lobbyGrid' },
      h('div', { class: 'panel col' }, h('h3', null, `Players  ${live}/${set.maxPlayers}`),
        h('div', { class: 'plist' }, R.players.map(p => h('div', { class: 'prow' + (p.id === S.you ? ' me' : '') + (p.connected ? '' : ' off') }, h('span', { class: 'dot big', style: `background:${p.cosm.color}` }), h('span', { class: 'pname' }, p.name, p.host ? ' 👑' : ''), h('span', { class: 'pstat ' + (p.connected ? (p.ready || p.host ? 'ready' : 'wait') : 'offl') }, p.connected ? (p.host ? 'Host' : p.ready ? 'Ready' : 'Not ready') : 'Reconnecting…'), host && p.id !== S.you && h('button', { class: 'btn tiny danger', onclick: () => S.net.send({ t: 'kick', id: p.id }) }, 'Kick')))),
        h('h3', null, 'Your look'), cosmeticPicker(me),
        h('div', { class: 'renameRow' }, h('input', { id: 'renameIn', maxLength: 16, value: me?.name || '' }), h('button', { class: 'btn tiny', onclick: () => { const v = $('#renameIn').value.trim(); if (v && v !== me?.name) { S.net.send({ t: 'name', name: v }); settings.name = v; saveSettings(); } } }, 'Rename'))),
      h('div', { class: 'panel col' }, h('h3', null, 'Game Mode' + (host ? '' : '  (host chooses)')), h('div', { class: 'modes' }, modeCards),
        h('div', { class: 'setGrid' },
          h('label', null, 'Map', sel('setMap', [['hayfield', 'Hayfield (large)'], ['barnyard', 'Barnyard (barns & bales)']], set.map, 'map', set.mode === 'golden')),
          h('label', null, 'Round time', sel('setDur', [[60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [480, '8 min'], [600, '10 min'], [900, '15 min']], set.duration, 'duration')),
          h('label', null, 'Search difficulty', sel('setDiff', [['easy', 'Easy (1.6s)'], ['normal', 'Normal (2.4s)'], ['hard', 'Hard (3.4s)']], set.difficulty, 'difficulty')),
          h('label', null, 'Metal detector', sel('setDet', [['off', 'Off'], ['weak', 'Weak'], ['normal', 'Normal'], ['strong', 'Strong']], set.detector, 'detector')),
          h('label', null, 'Max players', sel('setMax', [2, 4, 6, 8, 10, 12].map(n => [n, n]), set.maxPlayers, 'maxPlayers')),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: set.soloAllowed, disabled: !host, onchange: e => S.net.send({ t: 'settings', soloAllowed: e.target.checked }) }), 'Allow solo rounds'),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: set.locked, disabled: !host, onchange: e => S.net.send({ t: 'lock', v: e.target.checked }) }), 'Lock room')),
        h('div', { class: 'lobbyBtns' }, host ? h('button', { class: 'btn primary big', disabled: !canStart, onclick: () => S.net.send({ t: 'start' }) }, 'Start Match') : h('button', { class: 'btn primary big' + (me?.ready ? ' on' : ''), onclick: () => S.net.send({ t: 'ready', v: !me?.ready }) }, me?.ready ? '✓ Ready (click to cancel)' : 'Ready'), !host && h('small', null, 'Waiting for the host to start…')),
        h('div', { class: 'chatBox' }, chatLog, chatIn))));
  chatIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') sendChat(); });
  renderChat(); if (prevChat != null) $('#chatLog').scrollTop = prevChat;
}
function cosmeticPicker(me) {
  if (!me) return h('div');
  const needles = me.needles || 0, row = (kind, label) => h('label', { class: 'cosRow' }, label, h('select', { onchange: e => S.net.send({ t: 'cosmetic', [kind]: e.target.value }) }, COSMETICS[kind].map(([id, need]) => h('option', { value: id, selected: me.cosm[kind] === id, disabled: need > needles }, id + (need > needles ? ` 🔒 ${need} needle${need > 1 ? 's' : ''}` : '')))));
  return h('div', { class: 'cos' }, h('div', { class: 'swatches' }, COSMETICS.color.map(c => h('button', { class: 'sw' + (me.cosm.color === c ? ' on' : ''), style: `background:${c}`, title: c, onclick: () => S.net.send({ t: 'cosmetic', color: c }) }))), row('hat', 'Hat'), row('jacket', 'Jacket'), row('gloves', 'Gloves'), row('boots', 'Boots'), row('skin', 'Detector'), row('victory', 'Victory'), h('small', null, 'Cosmetics unlock by finding needles during this room session. They never change gameplay.'));
}
function renderChat() { const l = $('#chatLog'); if (!l) return; l.replaceChildren(...S.chat.map(c => h('div', { class: 'msg' }, h('b', null, c.name + ': '), c.text))); l.scrollTop = l.scrollHeight; }
function sendChat() { const i = $('#chatIn'); if (!i) return; const t = i.value.trim(); if (t) S.net.send({ t: 'chat', text: t }); i.value = ''; }
function leaveRoom() { S.net?.send({ t: 'leave' }); sess.clear(); S.net?.close(); S.net = null; goMenu(); }

// ----- game view
function enterGame() {
  setScreen('game'); S.inGame = true; clearUI(); ui.append(hud || buildHud()); $('#hud').style.display = 'block'; ui.append($('#hud'));
  updateHudStatic(); updateObjective(); updateDetHud(); updateScoreboard(); $('#game').style.display = 'block';
  audio.startAmbience(); audio.setMusic(settings.musicInGame ? 'game' : 'off'); S.lastCd = 0;
  showStartPrompt();
}
function showStartPrompt() {
  $('#pause')?.remove(); if (document.pointerLockElement === canvas) return;
  const p = h('div', { id: 'pause', class: 'modal dim' }, h('div', { class: 'panel modalBody' }, h('h2', null, S.phase === 'results' ? 'Round over' : 'Click to take control'), h('p', null, 'WASD move • Shift sprint • Space jump • E search/pick up • Q detector • Click scatter hay • Tab scoreboard • Esc pause'), h('button', { class: 'btn primary big', onclick: () => { p.remove(); requestLock(); } }, 'Enter the field'), h('div', { class: 'btnRow' }, h('button', { class: 'btn ghost', onclick: () => { p.remove(); leaveRoom(); } }, S.practice ? 'Quit to menu' : 'Leave room'))));
  ui.append(p);
}
function showPause() {
  if ($('#pause')) return;
  const p = h('div', { id: 'pause', class: 'modal dim' }, h('div', { class: 'panel modalBody' }, h('h2', null, 'Paused'), h('p', null, S.practice ? 'Practice round continues in the background.' : 'The round keeps running for everyone else.'),
    h('div', { class: 'btnCol' }, h('button', { class: 'btn primary', onclick: () => { p.remove(); requestLock(); } }, 'Resume'), h('button', { class: 'btn', onclick: () => settingsScreen(true) }, 'Settings'), S.practice && h('button', { class: 'btn', onclick: () => { p.remove(); const d = S.practiceDiff; S.net?.close(); startPractice(d); } }, 'Restart round'), h('button', { class: 'btn danger', onclick: () => { p.remove(); leaveRoom(); } }, S.practice ? 'Quit to menu' : 'Leave room'))));
  ui.append(p);
}
function hidePause() { $('#pause')?.remove(); $('#settingsModal')?.remove(); }
function leaveGameView() { S.inGame = false; releaseLock(); $('#game') && ($('#game').style.display = 'none'); view?.clearWorld(); view?.clearRemotes(); remotes.clear(); S.revealed.clear(); S.search = null; $('#pause')?.remove(); }

// ----- results
function showResults() {
  const r = S.results; if (!r) return; setScreen('results'); S.inGame = false; $('#hud') && ($('#hud').style.display = 'none');
  $('#pause')?.remove(); $('#settingsModal')?.remove();
  const mine = r.winners.includes(S.you); let title, sub;
  if (r.reason === 'found') { if (r.winnerTeam != null) { title = (r.winnerTeam === 0 ? 'RED' : 'BLUE') + ' TEAM WINS'; sub = `${r.finderName} found the needle`; } else { title = r.mode === 'endless' ? 'TIME!' : (mine ? 'YOU FOUND IT!' : `${r.finderName} WINS`); sub = `${r.finderName} claimed the ${r.needles[0]?.golden ? 'golden ' : ''}needle`; } }
  else if (r.mode === 'endless') { const w = r.standings.find(s => s.win); title = w ? `${w.name} WINS` : 'TIME!'; sub = w ? `${w.roundScore} points` : 'Nobody scored'; }
  else if (r.mode === 'hideseek') { title = `${r.hiderName} OUTSMARTED EVERYONE`; sub = 'The needle was never found'; }
  else { title = 'TIME\'S UP'; sub = 'Nobody found the needle'; }
  clearUI(); ui.append(h('div', { class: 'results' }, h('div', { class: 'panel resCard' }, h('div', { class: 'resBadge ' + (mine ? 'win' : '') }, mine ? '★' : '●'), h('h1', null, title), h('p', { class: 'sub' }, sub),
    h('table', { class: 'resTable' }, h('thead', null, h('tr', null, ['#', 'Player', 'Round', 'Total', 'Needles', 'Searches', 'Hit %', 'Dig time', 'W–L', 'Best streak'].map(x => h('th', null, x)))),
      h('tbody', null, r.standings.map((s, i) => h('tr', { class: (s.id === S.you ? 'me ' : '') + (s.win ? 'winr' : '') }, h('td', null, i + 1), h('td', null, S.room?.players.find(p => p.id === s.id)?.cosm && h('span', { class: 'dot', style: `background:${S.room.players.find(p => p.id === s.id).cosm.color}` }), s.name, s.win ? ' 🏆' : '', s.team != null ? (s.team === 0 ? ' (Red)' : ' (Blue)') : ''), h('td', null, s.roundScore), h('td', null, s.score), h('td', null, s.needles), h('td', null, s.searches), h('td', null, s.searches ? Math.round(s.okSearches / s.searches * 100) + '%' : '-'), h('td', null, s.searchSecs + 's'), h('td', null, `${s.wins}–${s.losses}`), h('td', null, s.bestStreak))))),
    h('div', { class: 'btnRow', id: 'resBtns' }), h('small', null, 'Stats and unlocks last for this room session only.'))));
  renderResultsButtons();
}
function renderResultsButtons() {
  const b = $('#resBtns'); if (!b || !S.room) return; const host = S.room.hostId === S.you;
  b.replaceChildren(host ? h('button', { class: 'btn primary big', onclick: () => S.net.send({ t: 'start' }) }, S.practice ? 'Play Again' : 'Play Again (new arena)') : h('button', { class: 'btn big', disabled: true }, 'Waiting for host to start…'), !S.practice && host && h('button', { class: 'btn', onclick: () => S.net.send({ t: 'toLobby' }) }, 'Back to Lobby'), h('button', { class: 'btn ghost', onclick: leaveRoom }, S.practice ? 'Quit' : 'Leave Room'));
}

// ----- settings & how-to
function settingsScreen(inGame) {
  $('#settingsModal')?.remove();
  const slider = (key, label, min, max, step, fmt) => { const out = h('output', null, fmt(settings[key])); return h('label', { class: 'srow' }, label, h('input', { type: 'range', min, max, step, value: settings[key], oninput: e => { settings[key] = +e.target.value; out.textContent = fmt(settings[key]); saveSettings(); applySettings(); } }), out); };
  const check = (key, label) => h('label', { class: 'srow chk' }, h('input', { type: 'checkbox', checked: settings[key], onchange: e => { settings[key] = e.target.checked; saveSettings(); applySettings(); } }), label);
  const m = h('div', { id: 'settingsModal', class: 'modal dim' }, h('div', { class: 'panel modalBody wide' }, h('h2', null, 'Settings'),
    h('div', { class: 'sgrid' },
      h('div', null, h('h4', null, 'Controls'), slider('sens', 'Mouse sensitivity', 0.2, 3, 0.05, v => v.toFixed(2) + '×'), check('bob', 'Head bob'), check('reduceMotion', 'Reduced camera movement'), check('reduceFlash', 'Reduced flashing')),
      h('div', null, h('h4', null, 'Audio'), slider('master', 'Master volume', 0, 1, 0.05, v => Math.round(v * 100) + '%'), slider('music', 'Music volume', 0, 1, 0.05, v => Math.round(v * 100) + '%'), slider('sfx', 'Effects volume', 0, 1, 0.05, v => Math.round(v * 100) + '%'), check('musicInGame', 'Music during matches')),
      h('div', null, h('h4', null, 'Display'), slider('uiScale', 'UI scale', 0.8, 1.5, 0.05, v => Math.round(v * 100) + '%'), h('label', { class: 'srow' }, 'Graphics quality', h('select', { onchange: e => { settings.quality = e.target.value; saveSettings(); applySettings(); } }, [['low', 'Low (best FPS)'], ['medium', 'Medium'], ['high', 'High (shadows)']].map(([v, l]) => h('option', { value: v, selected: settings.quality === v }, l))), h('span')))),
    h('div', { class: 'btnRow' }, h('button', { class: 'btn primary', onclick: () => { m.remove(); } }, 'Done'))));
  (inGame ? ui : document.body).append(m); if (!inGame) document.body.append(m);
}
function howTo() {
  const m = h('div', { class: 'modal dim' }, h('div', { class: 'panel modalBody wide' }, h('h2', null, 'How to Play'),
    h('p', null, 'A needle is hidden somewhere in a gigantic field of hay. Search the piles, dodge the decoys, and claim the needle before anyone else.'),
    h('div', { class: 'sgrid' }, h('div', null, h('h4', null, 'Controls'), h('ul', null, h('li', null, h('kbd', null, 'W A S D'), ' move'), h('li', null, h('kbd', null, 'Mouse'), ' look'), h('li', null, h('kbd', null, 'Shift'), ' sprint (uses stamina)'), h('li', null, h('kbd', null, 'Space'), ' jump'), h('li', null, h('kbd', null, 'E'), ' search hay / pick up the needle'), h('li', null, h('kbd', null, 'Click'), ' scatter hay'), h('li', null, h('kbd', null, 'Q'), ' metal detector'), h('li', null, h('kbd', null, 'Tab'), ' scoreboard'), h('li', null, h('kbd', null, 'Esc'), ' pause'))),
      h('div', null, h('h4', null, 'Searching'), h('p', null, 'Stand in hay and press E. Stay put until the bar fills; walking away cancels it. A search digs up whatever is within arm\'s reach: decoys (nails, coins, tools — small bonus points), or the needle. Then press E again to grab the needle.'), h('h4', null, 'Metal detector'), h('p', null, 'Beeps faster as you near metal — the needle or metal decoys. It never points the way. The battery drains while it\'s on.'))),
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
  window.__needle = { S, L, W, settings, remotes }; // handy for debugging in the console
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
