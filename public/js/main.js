// NIGHT SHIFT: The Last Bell — game client.
// Online play talks to the authoritative server over WSS. Solo practice (and the offline fallback) runs the SAME Hub in this tab.
// The client owns your movement (the server validates it), your stamina/battery/sanity/oxygen, your camera and all feedback.
import { UI } from '/js/ui.js';
import { Sound } from '/js/audio.js';
import { createView } from '/js/view.js';
import { Hub, FL, HATS, KIND } from '/shared/sim.js';
import { getWorld, ZONES, SPOTS, RECT, zoneAt, resolve, closedGates, depthAt, inWall, groundY, waterLevel } from '/shared/world.js';
import { LOGS, LOG_ZONES, NAR, SCARE, PK_LABEL, HAT_NAMES, HINTS, ACHIEVEMENTS } from '/js/content.js';

const W = getWorld();
const canvas = document.getElementById('game');
const view = createView(canvas);
const settings = UI.settings;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const ITEMS = ['can', 'duck', 'stress', 'butter', 'knife', 'jam'];
const MON_KEYS = ['tele', 'decoy', 'bell', 'flood'], MON_CD = { tele: 12, decoy: 25, bell: 30, flood: 30 };
const SESSION_KEY = 'nightshift.session.v1', META_KEY = 'nightshift.meta.v1';

// ------------------------------------------------------------------ session / game / player state
const S = { screen: 'loading', connected: false, local: null, you: 0, room: null, token: '', code: '', practice: false, ending: false, paused: false, name: '', hat: 'none', countT: 0, rtt: 0, lastSave: 0, pendingRejoin: null };
const G = { active: false, mode: 'coop', settings: {}, ai: true, sunMax: 1200, sunrise: 1200, serverT: 0, serverAt: 0, open: {}, pk: new Map(), team: {}, pl: new Map(), names: new Map(), enemies: [], boss: null, tide: 0, tideOff: 0, laugh: { level: 0, phase: 'quiet' }, mut: null, t: 0, beat0: 0, beatDt: 0.625, beatQ: '', beatQAt: 0, result: null, cleared: false, pingT: 0, roastAt: 0 };
const ME = {
  x: SPOTS.spawn.x, z: SPOTS.spawn.z, y: 1.62, yaw: Math.PI, pitch: 0, roll: 0, vx: 0, vz: 0, speed: 0, hp: 2, flags: 0, down: false, dead: false, hiding: false, scooter: false, frozen: false, monster: false, board: false, needSync: true,
  stamina: 1, battery: 1, sanity: 1, oxygen: 1, flash: false, inv: {}, up: {}, hats: 0, shield: false, sel: 'can', crouch: false, sprint: false, dive: false, breath: false, noise: 0,
  hit: 0, shake: 0, kick: 0, bob: 0, stride: 0, lastSprintAt: 0, reviveP: 0, reviveTarget: 0, specI: 0, monCd: { tele: 0, decoy: 0, bell: 0, flood: 0 }, infBat: false, crashLock: false, gasT: 0, depth: 0, inWater: false,
  halluT: 8, halluLeft: 0, halluX: 0, halluZ: 0, radioOn: true, lit: true, litT: 0, zone: 'atrium', hunted: 0, flicker: 0,
};
const input = { keys: new Set(), mx: 0, my: 0, tMove: { x: 0, y: 0 }, tSprint: false, tCrouch: false, eDown: false, eSend: 0, wheelOpen: false, wx: 0, wy: 0 };
let view_t = 0, lastPosSent = 0, lastHud = 0, frames = 0, fpsAcc = 0, fps = 60, menuT = 0, menuInit = false;

// ------------------------------------------------------------------ persistence (localStorage may be unavailable)
function loadMeta() { try { const j = JSON.parse(localStorage.getItem(META_KEY) || 'null'); if (j && typeof j === 'object') return { ach: j.ach || {}, best: Array.isArray(j.best) ? j.best : [], speedrun: !!j.speedrun, wins: j.wins | 0, runs: j.runs | 0 }; } catch { /* unavailable */ } return { ach: {}, best: [], speedrun: false, wins: 0, runs: 0 }; }
const META = loadMeta();
function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(META)); } catch { /* unavailable */ } }
function saveSession() { try { if (S.code && S.token && !S.practice) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: S.code, token: S.token, name: S.name, hat: S.hat, at: Date.now() })); } catch { /* unavailable */ } }
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* unavailable */ } }
function loadSession() { try { const j = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); if (j && Date.now() - j.at < 28000) return j; } catch { /* unavailable */ } return null; }

// ------------------------------------------------------------------ networking
let ws = null, wsTimer = 0, wsTries = 0;
function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  UI.setConn('connecting');
  try { ws = new WebSocket(wsUrl()); } catch { UI.setConn('offline'); return scheduleReconnect(); }
  ws.onopen = () => {
    S.connected = true; wsTries = 0; UI.setConn('online');
    const ses = loadSession();
    if (ses && !S.local && (S.screen === 'menu' || S.screen === 'loading' || S.pendingRejoin)) { S.name = ses.name; S.hat = ses.hat; send({ t: 'join', code: ses.code, token: ses.token, name: ses.name, hat: ses.hat }); }
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => { S.connected = false; if (!S.local) UI.setConn('offline'); scheduleReconnect(); };
  ws.onerror = () => { /* onclose follows */ };
}
function scheduleReconnect() { clearTimeout(wsTimer); wsTries++; wsTimer = setTimeout(connect, Math.min(8000, 800 * wsTries)); }
function send(obj) {
  if (S.local) { try { S.local.hub.handle(S.local.conn, obj); } catch (e) { console.error(e); } return true; }
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}
function startLocal(name, hat) {
  stopLocal(); try { if (ws && ws.readyState <= 1 && S.room) send({ t: 'leave' }); } catch { /* */ }
  const hub = new Hub(), conn = { id: 1, ip: 'local', send: obj => { const c = JSON.parse(JSON.stringify(obj)); queueMicrotask(() => onMsg(c)); }, close() { } };
  hub.attach(conn);
  S.local = { hub, conn, timer: setInterval(() => { if (!S.paused && !document.hidden) { try { hub.tick(); } catch (e) { console.error(e); } } }, 50) };
  S.practice = true; S.name = name; S.hat = hat; UI.setConn('offline');
  hub.handle(conn, { t: 'create', practice: true, name, hat, settings: { scare: settings.scare } });
}
function stopLocal() { if (S.local) { clearInterval(S.local.timer); S.local = null; } if (S.connected) UI.setConn('online'); }
function needOnline() {
  if (S.connected) return true;
  UI.error('Cannot reach the game server. Starting a solo practice run instead.');
  const n = S.name || settings.name || 'Student'; startLocal(n, settings.hat); return false;
}

// ------------------------------------------------------------------ message handling
function onMsg(m) {
  switch (m.t) {
    case 'joined': S.you = m.you; S.token = m.token; S.code = m.code; S.practice = !!m.practice; saveSession(); G.names = new Map(); break;
    case 'room': S.room = m; UI.setRoom(m, S.you); for (const p of m.players) G.names.set(p.id, p.name); UI.setHats(HATS); if (S.screen !== 'game' && S.screen !== 'end') UI.screen('lobby'); break;
    case 'host': break;
    case 'countdown': runCountdown(m.s || 3); break;
    case 'start': startGame(m); break;
    case 's': onSnap(m); break;
    case 'ev': handleEvents(m.ev || []); break;
    case 'inv': ME.inv = m.inv || {}; if (!ME.inv[ME.sel]) ME.sel = ITEMS.find(k => ME.inv[k]) || ME.sel; break;
    case 'up': ME.up = m.up || {}; ME.hats = m.hats | 0; ME.shield = !!m.shield; if (UI.shopOpen) UI.shop(true, shopData()); break;
    case 'fix': ME.x = m.x; ME.z = m.z; break;
    case 'chat': onChat(m); break;
    case 'end': onEnd(m); break;
    case 'lobby': backToLobby(); break;
    case 'kicked': UI.error('The host removed you from the room.'); leaveRoom(true); break;
    case 'err': onErr(m); break;
    case 'pong': if (m.c) S.rtt = Math.round(performance.now() - m.c); break;
    default: break;
  }
}
function onErr(m) {
  UI.error(m.msg || 'Something went wrong.');
  if (m.code === 'NOT_FOUND' || m.code === 'STARTED' || m.code === 'FULL') clearSession();
}
function runCountdown(n) {
  clearTimeout(S.countT); let k = n;
  const tick = () => { if (k <= 0) { UI.countdown(0); return; } UI.countdown(k); Sound.init(); Sound.resume(); Sound.sfx('countdown', { rate: k === 1 ? 1.5 : 1 }); k--; S.countT = setTimeout(tick, 1000); };
  tick();
}
function backToLobby() { endGame(); S.ending = false; UI.screen('lobby'); }
function leaveRoom(silent) {
  if (!silent) send({ t: 'leave' });
  stopLocal(); S.room = null; S.code = ''; S.token = ''; S.practice = false; clearSession(); endGame(); S.ending = false; UI.countdown(0); UI.pause(false); UI.screen('menu');
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* */ } }
}

// ------------------------------------------------------------------ run lifecycle
function clearGame() {
  G.pk.clear(); G.pl.clear(); G.enemies = []; G.boss = null; G.team = {}; G.result = null; G.mut = null; G.beat0 = 0; G.beatQ = '';
  view.clearDynamic(); G.cleared = true;
}
function endGame() { G.active = false; Sound.setBoss(false); Sound.laughTrack(0); Sound.radio(false); view.clearDynamic(); }
function startGame(m) {
  clearGame(); S.ending = false; clearTimeout(S.countT); UI.countdown(0);
  G.active = true; G.mode = m.mode; G.settings = m.settings || {}; G.ai = m.ai; G.sunMax = m.sunrise; G.sunrise = m.sunrise; G.open = { ...(m.open || {}) }; G.team = m.team || {}; G.t = m.tt || 0; G.serverT = m.tt || 0; G.serverAt = performance.now();
  G.names = new Map((m.roster || []).map(p => [p.id, p.name]));
  for (const p of m.pickups || []) { G.pk.set(p.id, { ...p }); view.addPickup(p); }
  view.setGates(G.open); view.snapGates();
  const keepUp = (m.tt || 0) > 0 ? ME.up : {}, keepHats = (m.tt || 0) > 0 ? ME.hats : 0;
  Object.assign(ME, { x: SPOTS.spawn.x, z: SPOTS.spawn.z, y: 1.62, yaw: Math.PI, pitch: 0, hp: 2, flags: 0, down: false, dead: false, hiding: false, scooter: false, frozen: false, monster: false, board: false, needSync: true, stamina: 1, battery: 1, sanity: 1, oxygen: 1, flash: false, inv: {}, up: keepUp, hats: keepHats, shield: !!keepUp.shield, hit: 0, shake: 0, reviveP: 0, reviveTarget: 0, crashLock: false, halluT: 10, halluLeft: 0, radioOn: true });
  ME.monster = m.mode === 'monster' && m.monsterId === m.you; ME.monCd = { tele: 0, decoy: 0, bell: 0, flood: 0 };
  META.runs++; saveMeta();
  UI.screen('game'); Sound.init(); Sound.resume(); applySettings();
  view.applyZone('atrium', true); view.setPlates(false, false, !!G.open.front);
  UI.subtitle(NAR.zone_atrium[pickFlavour()], 6000);
  S.paused = false; lockPointer();
}
function onEnd(m) {
  if (S.ending) return; S.ending = true; G.result = m.result; G.active = G.active && true;
  Sound.setBoss(false); Sound.laughTrack(0);
  const win = !!m.win; Sound.stinger(m.result === 'secret' || win ? 'win' : 'lose'); if (win) setTimeout(() => Sound.stinger('sunrise'), 2500);
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* */ } }
  input.keys.clear(); input.eDown = false;
  evaluateAchievements(m);
  setTimeout(() => { if (S.ending) UI.showEnd(m); }, win ? 3200 : 2200);
}

// ------------------------------------------------------------------ achievements, best times, speedrun
function unlock(id) { if (META.ach[id]) return; META.ach[id] = Date.now(); saveMeta(); const a = ACHIEVEMENTS.find(x => x[0] === id); if (a) { UI.toast('Achievement: ' + a[1], 'good'); Sound.sfx('toast'); } }
function evaluateAchievements(end) {
  const me = (end.players || []).find(p => p.id === S.you), st = (me && me.stats) || {}, win = !!end.win;
  unlock('cooked'); if (win) { unlock('respect'); META.wins++; } if (end.result === 'secret') unlock('sixtyseven');
  if (win && (st.hits | 0) === 0) unlock('declined'); if ((st.loafHits | 0) >= 3) unlock('loaf'); if ((st.trophies | 0) >= 2) unlock('last');
  if ((st.revives | 0) >= 1) unlock('samaritan'); if ((st.revives | 0) >= 3) unlock('paramedic'); if ((end.logs | 0) >= 15) unlock('archivist'); if ((end.s67 | 0) >= 15) unlock('numerologist');
  if ((st.picks | 0) >= 40) unlock('sweet'); if ((st.perfect | 0) >= 10) unlock('roaster'); if ((st.handshakes | 0) >= 1) unlock('handshake'); if ((st.throws | 0) >= 20) unlock('arms'); if ((st.hideT | 0) >= 60) unlock('hide');
  if (win && !end.cheated) { META.best.push(Math.round(end.time)); META.best.sort((a, b) => a - b); META.best = META.best.slice(0, 5); if (META.best[0] === Math.round(end.time)) UI.toast('New best time!', 'good'); }
  saveMeta();
}
function fmtT(s) { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return String(m).padStart(2, '0') + ':' + r.toFixed(2).padStart(5, '0'); }
let achEl = null, srEl = null;
function ensureOverlays() {
  const root = document.getElementById('ui'); if (achEl) return;
  achEl = document.createElement('div'); achEl.id = 'ach'; achEl.hidden = true;
  achEl.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(4,6,10,.92);color:#e8ecf4;overflow:auto;padding:24px;font:14px/1.4 system-ui,sans-serif';
  root.append(achEl);
  srEl = document.createElement('div'); srEl.id = 'speedrun'; srEl.hidden = true;
  srEl.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:30;padding:2px 10px;background:rgba(0,0,0,.55);color:#9aff7a;font:700 16px ui-monospace,monospace;border-radius:6px;pointer-events:none;margin-top:46px';
  root.append(srEl);
  const pw = document.createElement('div'); pw.id = 'pingwheel'; pw.hidden = true;
  pw.style.cssText = 'position:fixed;left:50%;top:50%;width:210px;height:210px;margin:-105px 0 0 -105px;z-index:40;pointer-events:none;color:#fff;font:700 13px system-ui,sans-serif';
  pw.innerHTML = '<div data-k="enemy" style="position:absolute;left:50%;top:0;transform:translateX(-50%)">ENEMY</div><div data-k="here" style="position:absolute;right:0;top:50%;transform:translateY(-50%)">GO HERE</div><div data-k="battery" style="position:absolute;left:50%;bottom:0;transform:translateX(-50%)">BATTERY</div><div data-k="67" style="position:absolute;left:0;top:50%;transform:translateY(-50%)">67!</div><div style="position:absolute;inset:60px;border:2px solid rgba(255,255,255,.4);border-radius:50%"></div>';
  root.append(pw); input.wheelEl = pw;
  const lh = document.createElement('div'); lh.id = 'lockhint'; lh.hidden = true;
  lh.style.cssText = 'position:fixed;inset:0;z-index:25;display:flex;align-items:center;justify-content:center;color:#fff;font:700 22px system-ui,sans-serif;text-shadow:0 2px 8px #000;background:rgba(0,0,0,.25);cursor:pointer';
  lh.textContent = 'Click to play'; lh.addEventListener('click', () => lockPointer()); root.append(lh); input.lockEl = lh;
}
function openAch() {
  ensureOverlays(); achEl.hidden = false; achEl.replaceChildren();
  const h = (t, s) => { const e = document.createElement('div'); e.textContent = t; if (s) e.style.cssText = s; return e; };
  achEl.append(h('Achievements', 'font:800 26px system-ui;margin-bottom:10px'));
  for (const [id, nm, ds] of ACHIEVEMENTS) { const on = !!META.ach[id]; achEl.append(h((on ? '✅ ' : '⬜ ') + nm + ' — ' + ds, 'padding:5px 0;opacity:' + (on ? '1' : '0.55'))); }
  achEl.append(h('Best winning times', 'font:800 18px system-ui;margin:16px 0 6px'));
  achEl.append(h(META.best.length ? META.best.map((t, i) => (i + 1) + '. ' + fmtT(t)).join('   ') : 'No wins yet.', 'opacity:.8'));
  const sr = document.createElement('label'); sr.style.cssText = 'display:block;margin:16px 0;opacity:' + (META.wins > 0 ? 1 : 0.45);
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = META.speedrun; cb.disabled = META.wins < 1; cb.onchange = () => { META.speedrun = cb.checked; saveMeta(); };
  sr.append(cb, document.createTextNode(' Speedrun mode: show a live run timer' + (META.wins < 1 ? ' (win once to unlock)' : ''))); achEl.append(sr);
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Close'; b.style.cssText = 'padding:10px 18px;font:700 15px system-ui;border-radius:8px;border:0;cursor:pointer'; b.onclick = () => { achEl.hidden = true; }; achEl.append(b);
}

// ------------------------------------------------------------------ snapshots
function serverNow() { return G.serverT + (performance.now() - G.serverAt) / 1000; }
function onSnap(m) {
  if (!G.active) return;
  G.serverT = m.st; G.serverAt = performance.now(); G.sunrise = m.sr; G.tide = m.tl; G.tideOff = m.to; G.laugh = { level: m.lv, phase: m.lp }; G.mut = m.mu || null; G.boss = m.b || null; G.t = m.st;
  if (m.tm) { G.team = m.tm; if (UI.shopOpen) UI.shop(true, shopData()); }
  G.enemies = m.e || [];
  const seen = new Set();
  for (const a of m.p) {
    const id = a[0]; seen.add(id);
    if (id === S.you) {
      ME.flags = a[5]; ME.hp = a[6]; ME.reviveP = a[7]; ME.down = !!(a[5] & FL.down); ME.dead = !!(a[5] & FL.dead); const wasHide = ME.hiding; ME.hiding = !!(a[5] & FL.hidden);
      ME.scooter = !!(a[5] & FL.scooter); ME.frozen = !!(a[5] & FL.frozen); ME.monster = !!(a[5] & FL.monster); ME.board = !!(a[5] & FL.board);
      if (ME.needSync) { ME.x = a[1]; ME.z = a[2]; ME.yaw = a[3]; ME.needSync = false; }
      if (ME.hiding) { ME.x = a[1]; ME.z = a[2]; } else if (wasHide) { /* left hiding spot */ }
      if (!ME.scooter) ME.crashLock = false;
    } else {
      const o = G.pl.get(id) || { px: a[1], pz: a[2], stride: 0 }; o.x = a[1]; o.z = a[2]; o.yaw = a[3]; o.flags = a[5]; o.hp = a[6]; o.bot = !!a[9]; G.pl.set(id, o);
    }
  }
  for (const id of [...G.pl.keys()]) if (!seen.has(id)) G.pl.delete(id);
  view.syncPlayers(m.p, G.names, S.you); view.syncEnemies(G.enemies); view.syncProjectiles(m.pr || []); view.syncHazards(m.ha || []); view.syncClouds(m.cl || []); view.setFlood(m.fl || 0);
  view.setPlates(!!G.team.pa, !!G.team.pb, !!G.open.front);
  if (m.ev && m.ev.length) handleEvents(m.ev);
}

// ------------------------------------------------------------------ events
function pickFlavour() { const c = settings.comedy; return c >= 65 ? 'c' : c <= 35 ? 'h' : (Math.random() < 0.5 ? 'c' : 'h'); }
function narrate(id) { const n = NAR[id]; if (!n) return; const t = n[pickFlavour()] || n.h; UI.subtitle(t, 6500); Sound.voice(t, { pitch: id === 'boss_dead' ? 0.7 : 1 }); }
function pkPos(id) { const p = G.pk.get(id); return p ? { x: p.x, z: p.z } : null; }
function nameOf(id) { return G.names.get(id) || 'Someone'; }
function posOfPlayer(id) { if (id === S.you) return { x: ME.x, z: ME.z }; const p = G.pl.get(id); return p ? { x: p.x, z: p.z } : null; }
function scareFx(kind) {
  const lvl = settings.scare; if (lvl === 0) return;
  ME.shake = Math.max(ME.shake, lvl === 2 ? 1.2 : 0.6); ME.kick = lvl === 2 ? 10 : 5; Sound.stinger('scare');
  const s = SCARE[kind]; if (s) UI.subtitle(s[pickFlavour()], 4200);
  ME.sanity = Math.max(0, ME.sanity - 0.05);
}
function handleEvents(list) {
  for (const e of list) {
    try { onEvent(e); } catch (err) { console.error('event failed', e, err); }
  }
}
function onEvent(e) {
  switch (e.k) {
    case 'take': {
      const pos = pkPos(e.id), mine = e.by === S.you; G.pk.delete(e.id); view.removePickup(e.id);
      const o = mine ? {} : (pos || {});
      const sfx = { coin: 'coin', battery: 'battery', snack: 'snack', log: 'log', s67: 's67', seal: 'seal', crumb: 'pickup', key: 'chain', trophy: 'pickup' }[e.ty] || 'pickup';
      Sound.sfx(sfx, mine ? {} : { ...o, vol: 0.7 });
      if (mine) { if (e.ty === 'battery') ME.battery = Math.min(1, ME.battery + 0.6); if (e.ty === 'snack') { ME.sanity = Math.min(1, ME.sanity + 0.35); UI.toast('Snack! Sanity restored', 'good'); } if (e.ty === 'board') { UI.toast('Bodyboard! Surf the flood for 14 seconds', 'good'); } if (e.ty === 'toasterkey') UI.toast('Got the Toaster key', 'good'); if (e.ty === 'knife') UI.toast('Bread knife: great against toasted loaves', 'info'); if (e.ty === 'jam') UI.toast('Jam jar: the finishing move for a toasted Loaf', 'info'); }
      if (e.ty === 'log' && LOGS[e.i]) UI.logEntry({ n: e.i + 1, title: LOGS[e.i].title, text: LOGS[e.i].text, total: 15 });
      if (e.ty === 's67') UI.toast('67 found! (' + (((G.team.s6 || []).length + 1)) + '/15)', 'good');
      if (e.ty === 'seal') { UI.toast('Seal of Cooked collected!', 'good'); ME.shake = Math.max(ME.shake, 0.3); }
      if (e.done) UI.toast(({ crumb: 'Golden Doughnut complete! Claim the Seal at the display case.', key: 'All scooter keys found! The bike shed chain gate is open.', trophy: 'All trophy fragments! Claim the Seal on the podium.' })[e.ty] || 'Objective complete', 'good');
      break;
    }
    case 'add': { const p = e.pk; G.pk.set(p.id, { ...p }); view.addPickup(p); if (p.ty === 'seal') { UI.toast('A Seal has appeared!', 'good'); Sound.sfx('gate'); } break; }
    case 'gate': G.open[e.id] = true; view.setGates(G.open); Sound.sfx(e.id === 'chain' ? 'chain' : 'gate'); UI.subtitle(({ front: 'The front doors slide open.', secret: 'A hidden door grinds open: the 67 Room.', chain: 'The chain gate to the bike shed falls away.', aud: 'The auditorium doors swing open. The laugh track gets louder.' })[e.id] || '', 4000); break;
    case 'hit': {
      if (e.id === S.you) { ME.hit = 1; ME.shake = Math.max(ME.shake, 1); ME.kick = 7; Sound.sfx(e.down ? 'down' : 'hit'); if (e.down) UI.toast('You are down! Crawl to a teammate', 'bad'); }
      else { const p = posOfPlayer(e.id); Sound.sfx(e.down ? 'down' : 'hit', { ...(p || {}), vol: 0.7 }); if (e.down) UI.toast(nameOf(e.id) + ' is down! Revive them (hold E)', 'bad'); }
      break;
    }
    case 'revive': { const p = posOfPlayer(e.id); Sound.sfx('revive', e.id === S.you ? {} : (p || {})); UI.toast(nameOf(e.id) + ' was revived by ' + nameOf(e.by), 'good'); if (e.id === S.you) { ME.hit = 0.3; } break; }
    case 'dead': UI.toast(nameOf(e.id) + ' bled out', 'bad'); break;
    case 'shield': { const p = posOfPlayer(e.id); Sound.sfx('shield', e.id === S.you ? {} : (p || {})); if (e.id === S.you) { ME.shield = false; ME.up.shield = false; UI.toast('The bread shield absorbed the hit!', 'good'); } break; }
    case 'buy': if (e.id === S.you) { Sound.sfx('buy'); UI.toast('Bought: ' + e.item, 'good'); } else UI.toast(nameOf(e.id) + ' bought ' + e.item, 'info'); break;
    case 'shopFail': Sound.sfx('fail'); UI.toast('Not enough Cooked Coins', 'bad'); break;
    case 'broke': UI.toast('Broke Mode: a Cooked Coin vanished from the canteen budget', 'bad'); Sound.sfx('fail', { vol: 0.5 }); break;
    case 'cp': UI.toast(nameOf(e.id) + ' saved a checkpoint', 'info'); break;
    case 'rest': ME.sanity = 1; ME.battery = Math.min(1, ME.battery + 0.5); ME.stamina = 1; UI.toast('Rested on the Beanbag of Rest: sanity restored, checkpoint saved', 'good'); Sound.sfx('revive'); break;
    case 'crate': Sound.sfx('pickup', { vol: 0.5 }); break;
    case 'nar': narrate(e.id); break;
    case 'scare': scareFx(e.kind); break;
    case 'alert': { const en = G.enemies.find(a => a[0] === e.e); if (en) { const k = en[1]; Sound.sfx(k === KIND.loaf ? 'loafStep' : 'buzz', { x: en[2], z: en[3] }); } break; }
    case 'handshake': { if (e.id === S.you) { ME.shake = 1; Sound.sfx('handshake'); Sound.sfx('engine', { delay: 0.4 }); UI.toast('You shook its hand. HOLD ON.', 'bad'); } else { const p = posOfPlayer(e.id); Sound.sfx('handshake', p || {}); } break; }
    case 'rideOK': UI.toast('Ride survived! +2 Cooked Coins', 'good'); Sound.sfx('coin'); break;
    case 'drag': { const p = posOfPlayer(e.id); Sound.sfx('drag', e.id === S.you ? {} : (p || {})); if (e.id === S.you) ME.shake = 1; break; }
    case 'land': Sound.sfx(e.item === 'duck' ? 'pickup' : e.item === 'butter' ? 'splash' : 'land', { x: e.x, z: e.z }); break;
    case 'impact': Sound.sfx('impact', { x: e.x, z: e.z }); break;
    case 'loafEat': { const en = G.enemies.find(a => a[0] === e.e); Sound.sfx('loafSigh', en ? { x: en[2], z: en[3] } : {}); UI.subtitle('The Loaf found the butter. It is, briefly, content.', 3500); break; }
    case 'loafHurt': Sound.sfx('impact'); UI.toast('The Loaf is hurt! (' + e.hp + ' left)', 'good'); break;
    case 'loafDead': Sound.sfx('loafSigh'); UI.toast('The Loaf has been defeated! Claim the Seal at the toaster.', 'good'); UI.subtitle('The Loaf sighs one last time and becomes, simply, a very large loaf.', 6000); break;
    case 'toasted': UI.toast('The Loaf is toasted! Hit it with the jam jar or knife.', 'good'); Sound.sfx('buzz'); ME.shake = Math.max(ME.shake, 0.4); break;
    case 'toastFail': UI.toast('Toasting failed: the Loaf must be near the toaster. Lure it with butter.', 'bad'); Sound.sfx('fail'); break;
    case 'rush': UI.toast('THE SUGAR RUSH! Run!', 'bad'); Sound.stinger('chase'); ME.shake = Math.max(ME.shake, 0.6); break;
    case 'rushEnd': UI.toast('The Sugar Rush burned out', 'good'); break;
    case 'laugh': Sound.sfx('laugh', { vol: e.ph === 'loud' ? 0.8 : 0.3 }); break;
    case 'mut': UI.toast('CHAOS: ' + ({ breadrain: 'bread rain', laugh: 'a global laugh track', scooters: 'scooters everywhere', blackout: 'blackout', fog: 'thick fog', flood: 'the courtyard floods' })[e.id] + '!', 'bad'); Sound.stinger('phase'); break;
    case 'mutEnd': UI.toast('The chaos subsides', 'good'); break;
    case 'surgeWarn': UI.toast('The water is rising! Surge incoming', 'bad'); Sound.sfx('splash', { vol: 0.4 }); break;
    case 'surge': Sound.sfx('splash'); ME.shake = Math.max(ME.shake, 0.5); break;
    case 'cameo': { if (settings.scare > 0) { view.setHallu({ x: e.x, z: e.z, yaw: Math.atan2(-(ME.x - e.x), -(ME.z - e.z)) }); ME.halluLeft = 2.2; ME.halluReal = true; } break; }
    case 'ping': { const who = nameOf(e.id); view.addPing(e.x, e.z, e.kind, who); Sound.sfx('ping', { x: e.x, z: e.z }); break; }
    case 'reveal': view.reveal(e.list || []); UI.toast('Every hidden 67 is glowing (host cheat)', 'info'); break;
    case 'mon': {
      if (ME.monster) ME.monCd[e.a] = MON_CD[e.a];
      if (e.a === 'bell') { Sound.sfx('bell', { x: e.x, z: e.z }); if (!ME.monster && dist(ME.x, ME.z, e.x, e.z) < 28) UI.toast('The Last Bell rings: you are frozen!', 'bad'); }
      else if (e.a === 'tele') Sound.sfx('whoosh', { x: e.x, z: e.z });
      else if (e.a === 'flood') Sound.sfx('splash', { x: e.x, z: e.z });
      else if (e.a === 'decoy' && !ME.monster) UI.toast('Something that looks a lot like a Handshake Entity just appeared...', 'bad');
      break;
    }
    case 'bossStart': UI.toast('THE LAST BELL', 'bad'); Sound.stinger('boss'); UI.subtitle('"ts rizz..." the bell murmurs, which is somehow worse.', 5000); break;
    case 'phase': {
      Sound.stinger('phase');
      if (e.n === 2) { UI.toast('Phase 2: bread rain! Keep throwing at it', 'bad'); UI.subtitle('The ceiling begins raining warm bread. This is not an improvement.', 5000); }
      if (e.n === 3) { G.beat0 = e.beat0; G.beatDt = e.dt || 0.625; UI.toast('Phase 3: ROAST BATTLE! Press E / click on the beat', 'bad'); UI.subtitle('It is time for the roast. Hit E on every bell.', 5000); }
      break;
    }
    case 'charge': view.telegraph(e.x, e.z, e.dx, e.dz, 1.4); Sound.sfx('whoosh', { x: e.x, z: e.z }); break;
    case 'bossStun': Sound.sfx('impact'); UI.toast('Stunned! Hit it for double damage', 'good'); break;
    case 'bossHit': Sound.sfx('impact'); break;
    case 'bossDead': Sound.stinger('win'); ME.shake = 1; break;
    case 'beat': { if (G.beat0 === 0 || true) G.beat0 = e.at - e.n * G.beatDt; Sound.beat(); break; }
    case 'beatq': G.beatQ = e.q; G.beatQAt = performance.now(); Sound.sfx(e.q === 'perfect' ? 'perfect' : e.q === 'good' ? 'good' : 'miss'); break;
    case 'roast': break;
    case 'left': G.pl.delete(e.id); break;
    default: break;
  }
}
function onChat(m) {
  const mine = m.id === S.you;
  UI.chat({ name: m.name, text: m.text, global: m.g });
  if (!mine) Sound.sfx('chat', m.g ? {} : { x: m.x, z: m.z });
}

// ------------------------------------------------------------------ input
function typing() { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }
function inGame() { return S.screen === 'game' && G.active && !S.ending; }
function lockPointer() {
  if (UI.touchEnabled || !inGame() || UI.overlayOpen) return;
  try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch { /* */ }
}
addEventListener('keydown', e => {
  if (typing() || e.metaKey) return;
  const code = e.code;
  if (code === 'KeyK' && !e.repeat && (S.screen === 'menu' || UI.isPaused())) { openAch(); return; }
  if (!inGame()) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(code)) e.preventDefault();
  if (UI.overlayOpen) return;
  if (e.repeat) return;
  input.keys.add(code);
  switch (code) {
    case 'KeyF': ME.flash = !ME.flash; Sound.sfx('click'); break;
    case 'KeyE': case 'Space': onE(true); break;
    case 'KeyR': beginRevive(); break;
    case 'KeyQ': if (ME.dead) cycleSpectate(1); else throwItem(); break;
    case 'KeyH': toggleHide(); break;
    case 'KeyB': openShop(); break;
    case 'KeyT': cycleHat(); break;
    case 'KeyV': input.wheelOpen = true; input.wx = 0; input.wy = 0; if (input.wheelEl) input.wheelEl.hidden = false; break;
    case 'F2': hostDebug({ cmd: 'skip' }); break; case 'F3': ME.infBat = !ME.infBat; UI.toast('Infinite battery ' + (ME.infBat ? 'ON' : 'OFF'), 'info'); break; case 'F4': hostDebug({ cmd: 'reveal' }); break;
    default:
      if (code.startsWith('Digit')) { const n = +code.slice(5); if (ME.monster) { const a = MON_KEYS[n - 1]; if (a && ME.monCd[a] <= 0) send({ t: 'mon', a }); } else if (n >= 1 && n <= 6) { ME.sel = ITEMS[n - 1]; Sound.sfx('click', { vol: 0.5 }); } }
  }
});
addEventListener('keyup', e => {
  input.keys.delete(e.code);
  if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'KeyR') onE(false);
  if (e.code === 'KeyV' && input.wheelOpen) { input.wheelOpen = false; if (input.wheelEl) input.wheelEl.hidden = true; const ax = Math.abs(input.wx), ay = Math.abs(input.wy); let kind = 'here'; if (ax + ay > 25) kind = ax > ay ? (input.wx > 0 ? 'here' : '67') : (input.wy < 0 ? 'enemy' : 'battery'); doPing(kind); }
});
addEventListener('mousemove', e => {
  if (!inGame() || UI.overlayOpen) return;
  if (document.pointerLockElement === canvas) {
    if (input.wheelOpen) { input.wx = clamp(input.wx + e.movementX, -60, 60); input.wy = clamp(input.wy + e.movementY, -60, 60); if (input.wheelEl) for (const d of input.wheelEl.querySelectorAll('[data-k]')) d.style.color = '#fff'; return; }
    look(e.movementX, e.movementY);
  }
});
canvas.addEventListener('mousedown', e => {
  if (!inGame()) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (e.button === 0) { if (G.boss && G.boss.st === 'roast') sendBeat(); else if (ME.dead) cycleSpectate(1); else throwItem(); }
  else if (e.button === 2) { ME.flash = !ME.flash; }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { if (!inGame() || UI.overlayOpen) return; const have = ITEMS.filter(k => ME.inv[k]); if (!have.length) return; let i = have.indexOf(ME.sel); i = (i + (e.deltaY > 0 ? 1 : -1) + have.length) % have.length; ME.sel = have[i]; }, { passive: true });
function look(dx, dy) { const k = 0.0022 * settings.sens; ME.yaw -= dx * k; ME.pitch = clamp(ME.pitch - dy * k * (settings.invertY ? -1 : 1), -1.45, 1.45); }
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && inGame() && !UI.overlayOpen && !UI.touchEnabled) UI.pause(true);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G.active) send({ t: 'blur' }); });
addEventListener('blur', () => { input.keys.clear(); if (G.active && !S.ending) send({ t: 'blur' }); });
function resumeGame() { S.paused = false; lockPointer(); }
// touch controls (UI sends joystick / look / button events)
function touchInput(o) {
  if (o.type === 'move') { input.tMove.x = o.x; input.tMove.y = o.y; }
  else if (o.type === 'look') { look(o.dx * 1.6, o.dy * 1.6); }
  else if (o.type === 'btn') {
    if (o.id === 'sprint') input.tSprint = o.down; else if (o.id === 'crouch') input.tCrouch = o.down;
    else if (o.down) {
      if (o.id === 'use') onE(true); else if (o.id === 'throw') throwItem(); else if (o.id === 'flash') ME.flash = !ME.flash; else if (o.id === 'hide') toggleHide();
      else if (o.id === 'next') { const have = ITEMS.filter(k => ME.inv[k]); if (have.length) ME.sel = have[(have.indexOf(ME.sel) + 1) % have.length]; }
      else if (o.id === 'pause') { UI.pause(true); }
    } else if (o.id === 'use') onE(false);
  }
}

// ------------------------------------------------------------------ actions
function throwItem() {
  if (ME.down || ME.dead || ME.hiding || ME.monster || ME.scooter) return;
  let item = ME.sel; if (!ME.inv[item]) item = ITEMS.find(k => ME.inv[k]); if (!item) { UI.toast('Nothing to throw. Look for cans, ducks and butter', 'info'); return; }
  send({ t: 'throw', item, yaw: ME.yaw, pitch: ME.pitch }); Sound.sfx('throw');
}
function sendBeat() { send({ t: 'beat', ts: serverNow() }); }
function toggleHide() {
  if (ME.down || ME.dead || ME.monster) return;
  if (ME.hiding) { send({ t: 'hide' }); return; }
  let best = null, bd = 1e9; for (const h of W.hides) { const d = dist(ME.x, ME.z, h.x, h.z); if (d < h.r + 1 && d < bd) { bd = d; best = h; } }
  if (best) { send({ t: 'hide', id: best.id }); Sound.sfx('door', { vol: 0.5 }); } else UI.toast('Nothing to hide in nearby. Look for lockers, cupboards, bins and benches', 'info');
}
function openShop() { if (ME.down || ME.dead || ME.monster) return; if (dist(ME.x, ME.z, SPOTS.vend.x, SPOTS.vend.z) > 5.5) { UI.toast('The Meme Shop vending machine is in the Front Atrium', 'info'); return; } UI.shop(true, shopData()); if (document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* */ } } }
function shopData() { return { coins: G.team.co | 0, up: ME.up, hats: ME.hats }; }
function cycleHat() { if (ME.hats < 1) { UI.toast('Buy a Silly Hat from the Meme Shop first', 'info'); return; } const cur = HATS.indexOf(S.hat), next = HATS[(cur + 1) % HATS.length]; S.hat = next; settings.hat = next; send({ t: 'prof', name: S.name, hat: next }); UI.toast('Hat: ' + (HAT_NAMES[next] || next), 'info'); }
function doPing(kind) { if (!inGame()) return; let x = ME.x, z = ME.z; const fx = -Math.sin(ME.yaw), fz = -Math.cos(ME.yaw); let d = 2; for (; d < 40; d += 1) { x = ME.x + fx * d; z = ME.z + fz * d; if (inWall(W, x, z, 0.1)) { x -= fx * 1; z -= fz * 1; break; } } send({ t: 'ping', kind, x, z }); }
function hostDebug(o) { if (S.room && S.room.host === S.you) send({ t: 'dbg', ...o }); }
function beginRevive() { if (ME.down || ME.dead || ME.monster) return; const t = reviveCandidate(); if (t) { ME.reviveTarget = t.id; send({ t: 'rev', on: true, id: t.id }); } }
function reviveCandidate() { let best = null, bd = 2.6; for (const [id, p] of G.pl) { if (!(p.flags & FL.down) || (p.flags & FL.dead)) continue; const d = dist(ME.x, ME.z, p.x, p.z); if (d < bd) { bd = d; best = { id, p }; } } return best; }
function cycleSpectate(dir) { const list = [...G.pl.entries()].filter(([, p]) => !(p.flags & FL.dead)).map(([id]) => id); if (!list.length) return; ME.specI = (ME.specI + dir + list.length * 4) % list.length; ME.specId = list[ME.specI]; }

function onE(down) {
  if (!inGame()) return;
  if (!down) { input.eDown = false; if (ME.reviveTarget) { send({ t: 'rev', on: false }); ME.reviveTarget = 0; } return; }
  if (G.boss && G.boss.st === 'roast' && !ME.dead) { sendBeat(); return; }
  input.eDown = true;
  if (ME.dead) { cycleSpectate(1); return; }
  const it = findInteract(); if (!it) return;
  switch (it.kind) {
    case 'pk': send({ t: 'use', id: it.id }); break;
    case 'toaster': send({ t: 'use', id: 'toaster' }); input.eSend = 0; break;
    case 'bed': send({ t: 'use', id: 'bed' }); break;
    case 'crate': send({ t: 'use', id: it.id }); break;
    case 'vend': openShop(); break;
    case 'radio': ME.radioOn = !ME.radioOn; Sound.radio(ME.radioOn, SPOTS.radio.x, SPOTS.radio.z); Sound.sfx('radioSwitch'); break;
    case 'revive': ME.reviveTarget = it.id; send({ t: 'rev', on: true, id: it.id }); break;
    default: break;
  }
}
function findInteract() {
  if (ME.down || ME.dead || ME.hiding || ME.monster || ME.scooter) return null;
  const dv = reviveCandidate(); if (dv) return { kind: 'revive', id: dv.id, label: 'Hold E: revive ' + nameOf(dv.id), hold: true };
  let best = null, bd = 2.8; const swim = ME.depth > 0.9;
  for (const p of G.pk.values()) { if (!p.on && p.on !== undefined && p.on === false) continue; const d = dist(ME.x, ME.z, p.x, p.z); if (d < bd) { bd = d; best = { kind: 'pk', id: p.id, label: PK_LABEL[p.ty] || 'Pick up', dive: !!p.dv }; } }
  if (best && best.dive && !ME.dive && ME.depth > 1.6) best.label = 'Dive (hold C) to grab the ' + best.label;
  if (best && !(swim && best.dive && !ME.dive && ME.depth > 1.6)) { best.label = 'E: ' + best.label; return best; }
  if (best && best.dive) { best.label = 'Hold C to dive down'; return null; }
  const tc = dist(ME.x, ME.z, SPOTS.toaster.x, SPOTS.toaster.z); if (tc < 4.5) return { kind: 'toaster', label: G.team.tk ? (G.team.tt ? 'The Loaf is toasted. Throw jam!' : 'Hold E: toast the Loaf (it must be nearby)') : 'E: the Toaster needs a key', hold: true };
  if (dist(ME.x, ME.z, SPOTS.beanbag.x, SPOTS.beanbag.z) < 3.2) return { kind: 'bed', label: 'E: rest on the Beanbag (restore + checkpoint)' };
  if (dist(ME.x, ME.z, SPOTS.vend.x, SPOTS.vend.z) < 4.2) return { kind: 'vend', label: 'E / B: Meme Shop' };
  if (dist(ME.x, ME.z, SPOTS.radio.x, SPOTS.radio.z) < 3) return { kind: 'radio', label: 'E: toggle the cursed radio' };
  for (const c of W.crates) if (dist(ME.x, ME.z, c.x, c.z) < 2.8) return { kind: 'crate', id: c.id, label: 'E: grab supplies from the prop crate' };
  return null;
}

// ------------------------------------------------------------------ per-frame update
function surfaceAt(x, z) { if (ME.depth > 0.35) return 'water'; return (ZONES[zoneAt(x, z)] || ZONES.campus).surf; }
function update(dt) {
  G.t += dt; view_t += dt;
  const zone = zoneAt(ME.x, ME.z); if (zone !== ME.zone) { ME.zone = zone; Sound.setZone((ZONES[zone] || ZONES.campus).music); }
  const live = !S.ending && !UI.overlayOpen && !(UI.isPaused());
  const alive = !ME.dead, canAct = live && alive;
  const k = input.keys;
  // ---- movement intent
  let fwd = 0, str = 0;
  if (canAct) {
    fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - input.tMove.y; str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + input.tMove.x;
    const l = Math.hypot(fwd, str); if (l > 1) { fwd /= l; str /= l; }
  }
  if (k.has('ArrowLeft') && !k.has('KeyA')) { /* arrows move; mouse looks */ }
  const crouchHeld = canAct && (k.has('KeyC') || k.has('ControlLeft') || input.tCrouch);
  const shiftHeld = canAct && (k.has('ShiftLeft') || k.has('ShiftRight') || input.tSprint);
  const frozen = ME.frozen && !ME.monster ? true : ME.frozen;
  const depth = (ZONES[zone] && zone === 'abyss') || zone === 'campus' || zone === 'quad' ? depthAt(ME.x, ME.z, G.tide, G.tideOff) : 0; ME.depth = depth;
  const swimming = depth > 0.9, wading = depth > 0.35;
  ME.crouch = crouchHeld && !swimming && !ME.scooter; ME.dive = swimming && crouchHeld && ME.oxygen > 0.04 && !ME.board;
  const moving = Math.abs(fwd) + Math.abs(str) > 0.05;
  ME.breath = crouchHeld && shiftHeld && !moving && !swimming && ME.oxygen > 0.04;
  ME.sprint = shiftHeld && moving && !ME.crouch && !ME.down && ME.stamina > (ME.lastSprint ? 0.02 : 0.12) && !swimming && !ME.scooter && !ME.breath; ME.lastSprint = ME.sprint;
  let speed = 4.6;
  if (ME.monster) speed = 6.4; else if (ME.down) speed = 1.2; else if (ME.sprint) speed = 7.1; else if (ME.crouch) speed = 2.4;
  if (ME.hp <= 1 && !ME.down && !ME.monster) speed *= 0.84;
  if (swimming) speed *= ME.board ? 1.7 : ME.dive ? 0.5 : 0.6; else if (wading) speed *= ME.board ? 1.5 : 0.82;
  if (ME.board && depth > 0.1) speed = Math.max(speed, 8.4);
  if (ME.hiding || frozen || S.ending) speed = 0;
  const sy = Math.sin(ME.yaw), cy = Math.cos(ME.yaw);
  let vx = (-sy * fwd + cy * str) * speed, vz = (-cy * fwd - sy * str) * speed;
  if (ME.scooter && !ME.down) { // forced ride: steer with look / A-D, W/S ignored
    ME.yaw += -str * 1.5 * dt; vx = -sy * 10.4; vz = -cy * 10.4;
  }
  const gates = closedGates(W, G.open);
  let nx = ME.x + vx * dt, nz = ME.z + vz * dt;
  if (!ME.hiding && (vx || vz)) {
    const r = resolve(W, nx, nz, 0.38, gates);
    const bump = Math.hypot(r.x - nx, r.z - nz);
    if (ME.scooter && bump > 0.06 && !ME.crashLock) { ME.crashLock = true; send({ t: 'crash' }); Sound.sfx('crash'); ME.shake = 1.4; ME.kick = 9; }
    nx = r.x; nz = r.z;
    ME.speed = Math.hypot(nx - ME.x, nz - ME.z) / Math.max(dt, 1e-4); ME.x = nx; ME.z = nz;
  } else ME.speed = 0;
  ME.speed = Math.min(ME.speed, 14);
  // ---- vitals
  if (ME.sprint) ME.stamina = Math.max(0, ME.stamina - dt * 0.2), ME.lastSprintAt = view_t; else if (view_t - ME.lastSprintAt > 0.7) ME.stamina = Math.min(1, ME.stamina + dt * 0.22);
  if (ME.flash) { if (!ME.infBat) ME.battery = Math.max(0, ME.battery - dt / (ME.up.battery ? 390 : 260)); if (ME.battery <= 0) { ME.flash = false; UI.toast('Flashlight battery is dead. Find a battery!', 'bad'); } }
  if (swimming && ME.dive) ME.oxygen = Math.max(0, ME.oxygen - dt / 13); else if (ME.breath) ME.oxygen = Math.max(0, ME.oxygen - dt / 9); else ME.oxygen = Math.min(1, ME.oxygen + dt / (swimming ? 4 : 3));
  if (ME.oxygen <= 0.01 && (ME.dive || ME.breath)) { Sound.sfx('splash', { vol: 0.4 }); }
  ME.inGas = !!(ME.flags & FL.gas);
  ME.litT -= dt; if (ME.litT <= 0) { ME.litT = 0.4; let lit = zone === 'atrium' || zone === 'secret' || (ME.flash && ME.battery > 0); if (!lit) for (const L of W.lights) { if (Math.abs(L.x - ME.x) < 9 && Math.abs(L.z - ME.z) < 9 && dist(L.x, L.z, ME.x, ME.z) < 8.5) { lit = true; break; } } ME.lit = lit; }
  let ds = 0;
  if (zone === 'atrium' || zone === 'secret') ds += 0.06; else if (ME.lit) ds += 0.012; else ds -= 0.014;
  if (ME.inGas) ds -= 0.04;
  let teammates = 0, stare = 0;
  for (const [, p] of G.pl) if (!(p.flags & (FL.dead | FL.down)) && dist(ME.x, ME.z, p.x, p.z) < 6) teammates++;
  if (teammates) ds += 0.015;
  ME.hunted = 0; ME.flicker = 0; let nearest = 99;
  for (const e of G.enemies) {
    const kd = e[1], d = dist(ME.x, ME.z, e[2], e[3]), st = e[5] & 7;
    if (kd === KIND.audience && !(st === 1)) continue;
    if (d < nearest) nearest = d;
    if (kd !== KIND.audience && d < 16) { const ang = Math.atan2(-(e[2] - ME.x), -(e[3] - ME.z)); let da = Math.abs(ang - ME.yaw); da = da > Math.PI ? 2 * Math.PI - da : da; if (da < 0.6) stare = Math.max(stare, 1 - d / 16); }
    if (kd !== KIND.handshake && kd !== KIND.decoy && st === 2 && d < 42) ME.hunted = Math.max(ME.hunted, clamp(1.1 - d / 42, 0.25, 1));
    if (d < 20) ME.flicker = Math.max(ME.flicker, 1 - d / 20);
  }
  if (G.boss && G.boss.st !== 'dead' && zone === 'aud') ME.hunted = Math.max(ME.hunted, 0.7);
  if (G.mode === 'monster' && ME.monster) { let n = 99; for (const [, p] of G.pl) if (!(p.flags & (FL.dead | FL.monster))) n = Math.min(n, dist(ME.x, ME.z, p.x, p.z)); ME.hunted = n < 25 ? 0.4 : 0; }
  else if (G.mode === 'monster') { for (const [, p] of G.pl) if (p.flags & FL.monster) { const d = dist(ME.x, ME.z, p.x, p.z); if (d < 28) ME.hunted = Math.max(ME.hunted, clamp(1.1 - d / 28, 0.3, 1)); } }
  ds -= stare * 0.05;
  ME.sanity = clamp(ME.sanity + ds * dt, 0, 1);
  // ---- hallucinations at low sanity (fake figures + fake footsteps; they cannot hurt you)
  if (live && alive && ME.sanity < 0.5 && settings.scare > 0 && !ME.halluReal) {
    ME.halluT -= dt * (1 + (0.5 - ME.sanity) * 3);
    if (ME.halluT <= 0 && ME.halluLeft <= 0) {
      ME.halluT = 9 + Math.random() * 12; const a = ME.yaw + (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.6), d = 9 + Math.random() * 8;
      const hx = ME.x - Math.sin(a) * d, hz = ME.z - Math.cos(a) * d;
      if (!inWall(W, hx, hz, 0.8)) { ME.halluX = hx; ME.halluZ = hz; ME.halluLeft = 3; view.setHallu({ x: hx, z: hz, yaw: Math.atan2(-(ME.x - hx), -(ME.z - hz)) }); Sound.footstep('tile', { x: hx, z: hz, vol: 1.3 }); }
      else if (Math.random() < 0.6) { Sound.footstep(surfaceAt(ME.x, ME.z), { x: ME.x - Math.sin(a) * 3, z: ME.z - Math.cos(a) * 3, vol: 1.1 }); }
    }
  }
  if (ME.halluLeft > 0) {
    ME.halluLeft -= dt; const hx = ME.halluReal ? null : ME.halluX;
    if (!ME.halluReal) { const ang = Math.atan2(-(ME.halluX - ME.x), -(ME.halluZ - ME.z)); let da = Math.abs(ang - ME.yaw); da = da > Math.PI ? 2 * Math.PI - da : da; if (da < 0.3) { ME.halluLeft = 0; ME.sanity = Math.max(0, ME.sanity - 0.03); Sound.stinger('scare'); ME.shake = Math.max(ME.shake, 0.4); } }
    void hx; if (ME.halluLeft <= 0) { view.setHallu(null); ME.halluReal = false; }
  }
  // ---- monster cooldowns
  for (const a of MON_KEYS) if (ME.monCd[a] > 0) ME.monCd[a] = Math.max(0, ME.monCd[a] - dt);
  // ---- interactions held
  if (input.eDown && !ME.dead) {
    input.eSend += dt; const it = findInteract();
    if (it && it.kind === 'toaster' && input.eSend > 0.25) { input.eSend = 0; send({ t: 'use', id: 'toaster' }); }
    if (ME.reviveTarget && (!it || it.kind !== 'revive')) { send({ t: 'rev', on: false }); ME.reviveTarget = 0; }
  }
  // ---- footsteps + bob
  if (ME.speed > 0.4 && !ME.hiding && alive) {
    ME.stride += ME.speed * dt; const step = ME.sprint ? 2.1 : ME.crouch ? 1.2 : 1.55;
    if (ME.stride > step) { ME.stride = 0; if (!ME.scooter) Sound.footstep(surfaceAt(ME.x, ME.z), { sprint: ME.sprint, crouch: ME.crouch, vol: ME.up.shoes ? 0.55 : 1 }); }
    ME.bob += ME.speed * dt * 2.1;
  }
  // ---- sync + position send (20 Hz)
  const nowMs = performance.now();
  if (nowMs - lastPosSent > 50 && !S.ending) {
    lastPosSent = nowMs;
    if (!ME.dead && !ME.hiding) send({ t: 'pos', x: +ME.x.toFixed(2), z: +ME.z.toFixed(2), yaw: +ME.yaw.toFixed(3), pitch: +ME.pitch.toFixed(3), f: (ME.crouch ? 1 : 0) | (ME.sprint ? 2 : 0) | (ME.flash ? 4 : 0) | (ME.breath ? 8 : 0) | (ME.dive ? 16 : 0) });
    else if (ME.hiding) send({ t: 'pos', x: ME.x, z: ME.z, yaw: +ME.yaw.toFixed(3), pitch: +ME.pitch.toFixed(3), f: ME.flash ? 4 : 0 });
  }
  if (nowMs - G.pingT > 3000) { G.pingT = nowMs; if (!S.local) send({ t: 'ping', c: nowMs }); }
  if (nowMs - S.lastSave > 5000) { S.lastSave = nowMs; saveSession(); }
  // ---- noise (for the HUD)
  { let n; if (ME.hiding) n = 0.8; else if (ME.speed < 0.35) n = ME.breath ? 0.6 : 1.8; else if (ME.crouch) n = 3.5; else if (ME.sprint) n = 20; else n = 9; if (ME.scooter) n = 28; if (ME.up.shoes) n *= 0.62; ME.noise = clamp(n / 22, 0, 1); }
  // ---- camera targets
  ME.hit = Math.max(ME.down ? 0.5 : ME.hp <= 1 ? 0.18 : 0, ME.hit - dt * 1.6); ME.shake = Math.max(0, ME.shake - dt * 1.6); ME.kick = Math.max(0, ME.kick - dt * 22);
  const wl = waterLevel(G.tide, G.tideOff), gy = groundY(ME.x, ME.z);
  let eye = ME.down ? 0.5 : ME.crouch ? 1.05 : 1.62; let ty = gy + eye;
  if (depth > 0.9) ty = ME.dive ? Math.max(gy + 0.7, wl - 1.25) : wl + 0.32;
  if (ME.hiding) ty = gy + 1.35;
  ME.y += (ty - ME.y) * Math.min(1, dt * 9);
  const bobY = ME.speed > 0.4 && !ME.hiding ? Math.sin(ME.bob) * (ME.sprint ? 0.07 : 0.035) : 0, sway = Math.sin(view_t * 1.1) * 0.006;
  const rollT = (ME.hp <= 1 && !ME.down ? Math.sin(ME.bob * 0.5) * 0.04 + 0.035 : 0) + (ME.down ? 0.5 : 0) + (ME.scooter ? -str * 0.05 : 0) + (ME.speed > 0.4 ? Math.sin(ME.bob * 0.5) * 0.004 : 0);
  ME.roll = lerp(ME.roll, rollT, Math.min(1, dt * 6));
  // spectate: follow a living teammate
  let cx = ME.x, cz = ME.z, cyy = ME.y + bobY + sway, cyaw = ME.yaw, cpitch = ME.pitch + ME.kick * 0.003;
  let spectating = '';
  if (ME.dead) {
    let list = [...G.pl.entries()].filter(([, p]) => !(p.flags & FL.dead)); if (!list.length) list = [];
    const pick = list.find(([id]) => id === ME.specId) || list[0];
    if (pick) { const [id, p] = pick; ME.specId = id; const pp = view.playerPos(id) || p; cx = pp.x; cz = pp.z; cyy = groundY(cx, cz) + 1.6; spectating = nameOf(id); }
  }
  const dawn = S.ending && G.result && (G.result === 'win' || G.result === 'secret') ? 1 : clamp(1 - G.sunrise / Math.max(1, G.sunMax), 0, 1);
  view.render(dt, {
    x: cx, y: cyy, z: cz, yaw: cyaw, pitch: cpitch, roll: ME.roll, fov: settings.fov + (ME.sprint ? 4 : 0) + (ME.scooter ? 12 : 0), fovKick: ME.kick * 0.6, shake: ME.shake, zone: ME.dead ? zoneAt(cx, cz) : zone,
    underwater: cyy < wl - 0.05 && depth > 0.5, tide: G.tide, tideOff: G.tideOff, dawn, scooter: ME.scooter && !ME.down, blackout: G.mut === 'blackout', fogMul: G.mut === 'fog' ? 2.2 : 1, nightvision: ME.monster,
    flash: { on: ME.flash && ME.battery > 0 && !ME.dead, level: ME.infBat ? 1 : ME.battery, flicker: ME.flicker },
  });
  // ---- audio
  Sound.setListener(cx, cz, cyaw);
  Sound.tick(dt, { hunted: ME.hunted, sanity: ME.sanity, hp: ME.hp, underwater: cyy < wl - 0.05 && depth > 0.5, scooter: ME.scooter, moving: ME.speed > 0.5 });
  Sound.laughTrack(zone === 'aud' || G.mut === 'laugh' ? G.laugh.level : 0);
  Sound.setBoss(!!(G.boss && G.boss.st !== 'dead' && zone === 'aud'));
  if (zone === 'atrium' && ME.radioOn && !ME.radioOnPlaying) { ME.radioOnPlaying = true; Sound.radio(true, SPOTS.radio.x, SPOTS.radio.z); } else if (zone !== 'atrium' && ME.radioOnPlaying) { ME.radioOnPlaying = false; Sound.radio(false); }
  remoteAudio(dt);
  // ---- HUD (15 Hz)
  if (nowMs - lastHud > 66) { lastHud = nowMs; UI.hud(hudState(zone, spectating, dt)); }
  if (srEl) { srEl.hidden = !(META.speedrun && inGame()); if (!srEl.hidden) srEl.textContent = fmtT(G.t); }
  if (input.lockEl) input.lockEl.hidden = !(inGame() && !UI.touchEnabled && document.pointerLockElement !== canvas && !UI.overlayOpen && !UI.isPaused());
}

// distant footsteps / enemy sounds
const stepClock = new Map();
function remoteAudio(dt) {
  for (const [id, p] of G.pl) {
    if (p.px === undefined) { p.px = p.x; p.pz = p.z; }
    const mv = Math.hypot(p.x - p.px, p.z - p.pz); p.px = p.x; p.pz = p.z; const c = (stepClock.get(id) || 0) + mv;
    if (c > 1.9 && mv > 0.02 && !(p.flags & (FL.hidden | FL.dead | FL.down)) && dist(p.x, p.z, ME.x, ME.z) < 40) { stepClock.set(id, 0); Sound.footstep((ZONES[zoneAt(p.x, p.z)] || ZONES.campus).surf, { x: p.x, z: p.z, vol: (p.flags & FL.crouch) ? 0.3 : 0.7, sprint: !!(p.flags & FL.sprint) }); } else stepClock.set(id, c);
  }
  for (const e of G.enemies) {
    const kd = e[1], d = dist(ME.x, ME.z, e[2], e[3]); if (d > 45) continue;
    const key = 'e' + e[0], c = (stepClock.get(key) || 0) + dt;
    const st = e[5] & 7;
    if (kd === KIND.loaf && c > (st === 2 ? 0.7 : 1.1)) { stepClock.set(key, 0); Sound.sfx('loafStep', { x: e[2], z: e[3] }); if (Math.random() < 0.05) Sound.sfx('loafSigh', { x: e[2], z: e[3] }); }
    else if ((kd === KIND.stalker || kd === KIND.rush) && c > (st === 2 ? 0.45 : 0.9)) { stepClock.set(key, 0); Sound.footstep('sprinkle', { x: e[2], z: e[3], vol: 1.2 }); }
    else if ((kd === KIND.handshake || kd === KIND.decoy) && st === 2 && c > 0.5) { stepClock.set(key, 0); Sound.sfx('buzz', { x: e[2], z: e[3], vol: 0.6 }); }
    else if (kd === KIND.wraith && c > 1.0 && d < 28) { stepClock.set(key, 0); Sound.footstep('water', { x: e[2], z: e[3], vol: 1.0 }); }
    else if (kd === KIND.audience && st === 1 && c > 0.6) { stepClock.set(key, 0); Sound.sfx('laugh', { x: e[2], z: e[3], vol: 0.5 }); }
    else stepClock.set(key, c);
  }
}

function objective() {
  const tm = G.team, sl = tm.sl || [];
  if (ME.monster) return 'You are The Last Bell. Catch every survivor before sunrise. Keys 1-4 use your abilities.';
  if (!G.open.front) return 'Open the front doors: both players stand on the glowing plates.';
  if (G.mode === 'monster') { const n = sl.filter(Boolean).length; return n >= 4 ? 'Reach the auditorium stage and claim the final Seal.' : `Collect the Five Seals before sunrise (${n}/5).`; }
  if (!sl[0]) return (tm.cr | 0) >= 6 ? 'Claim the Golden Doughnut Seal at the canteen display case.' : `Doughnut Dungeon: find Golden Doughnut pieces (${tm.cr | 0}/6).`;
  if (!sl[1]) return (tm.ky | 0) >= 5 ? 'Claim the Seal inside the bike shed.' : `Scooter Catastrophe: find scooter keys (${tm.ky | 0}/5).`;
  if (!sl[2]) return !tm.tk ? 'Bakery: find the Toaster key, then lure the Loaf with butter.' : !tm.tt ? 'Toast the Loaf at the toaster (hold E), butter keeps it busy.' : 'Hit the toasted Loaf with the jam jar or the knife!';
  if (!sl[3]) return (tm.tr | 0) >= 4 ? 'Claim the Seal on the oval podium.' : `Bodyboard Abyss: dive for trophy fragments (${tm.tr | 0}/4).`;
  if (!sl[4]) return tm.ao ? 'The Fart Joke Foghorn: defeat The Last Bell on the stage.' : 'Collect four Seals to open the auditorium.';
  return 'Everything is done. Sunrise is coming.';
}
function progress() { const tm = G.team, sl = tm.sl || []; return [{ label: 'Doughnut pieces', n: sl[0] ? 6 : tm.cr | 0, of: 6 }, { label: 'Scooter keys', n: sl[1] ? 5 : tm.ky | 0, of: 5 }, { label: 'The Loaf', n: sl[2] ? 1 : 0, of: 1 }, { label: 'Trophy pieces', n: sl[3] ? 4 : tm.tr | 0, of: 4 }, { label: 'The Last Bell', n: sl[4] ? 1 : 0, of: 1 }]; }
function hudState(zone, spectating, dt) {
  const tm = G.team, b = G.boss, roast = b && b.st === 'roast';
  const swim = ME.depth > 0.9;
  let beat = null;
  if (roast) { const dtb = G.beatDt || 0.625, n = Math.ceil((serverNow() - G.beat0) / dtb), next = G.beat0 + n * dtb - serverNow(); beat = { active: true, next, dt: dtb, quality: performance.now() - G.beatQAt < 700 ? G.beatQ : '' }; }
  const hint = !G.open.front ? HINTS.plates : (G.t < 150 && zone === 'atrium' ? HINTS.explore : '');
  const it = ME.dead || ME.down || ME.hiding ? null : findInteract();
  const mon = {}; for (const a of MON_KEYS) mon[a] = ME.monCd[a];
  return {
    sunrise: G.sunrise, sunriseMax: G.sunMax, seals: tm.sl || [], coins: tm.co | 0, zoneName: (ZONES[zone] || ZONES.campus).name, objective: objective(), prog: progress(), logs: (tm.lg || []).length, s67: (tm.s6 || []).length, fpsShow: settings.debugHud, fps, ping: S.local ? 0 : S.rtt,
    hp: ME.hp, shield: ME.shield, hiding: ME.hiding, inGas: ME.inGas, limp: ME.hp <= 1 && !ME.down, flash: ME.flash, stamina: ME.stamina, battery: ME.infBat ? 1 : ME.battery, sanity: ME.sanity, oxygen: swim || ME.breath || ME.oxygen < 0.99 ? ME.oxygen : null, noise: ME.noise, hit: ME.hit,
    prompt: it ? it.label : (ME.hiding ? 'H: leave hiding spot' : ''), hint, compass: ME.yaw, role: ME.monster ? 'monster' : 'survivor', inv: ME.inv, selected: ME.sel, mon,
    boss: b && b.st !== 'dead' && zone === 'aud' ? { hp: b.hp, phase: b.ph, state: b.st === 'roast' ? 'roast' : b.st === 'intro' ? 'arriving' : '', roast: b.ro } : null,
    laugh: zone === 'aud' ? { phase: G.laugh.phase, level: G.laugh.level } : null, spectating, downed: ME.down, reviveP: ME.reviveP, beat, debug: !!(S.room && S.room.host === S.you && G.active),
  };
}

// ------------------------------------------------------------------ settings
function applySettings() {
  Sound.setVolume({ master: settings.master, music: settings.music, sfx: settings.sfx });
  view.setQuality(settings.quality, settings.scale); UI.applyFilter(canvas);
}

// ------------------------------------------------------------------ menu backdrop + main loop
function menuCamera(dt) {
  menuT += dt; const a = menuT * 0.05;
  view.render(dt, { x: Math.sin(a) * 44, y: 7 + Math.sin(menuT * 0.2) * 1.5, z: 36 + Math.cos(a) * 26, yaw: Math.PI + Math.sin(a) * 0.9, pitch: -0.12, roll: 0, fov: 70, zone: 'deck', dawn: 0, tide: menuT, tideOff: 0, flash: { on: false, level: 0, flicker: 0 } });
}
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
  frames++; fpsAcc += dt; if (fpsAcc >= 0.5) { fps = Math.round(frames / fpsAcc); frames = 0; fpsAcc = 0; }
  if (S.screen === 'game' && G.active) { try { update(dt); } catch (e) { console.error(e); } }
  else if (S.screen === 'end' && G.active === false) { menuCamera(dt); }
  else menuCamera(dt);
}

// ------------------------------------------------------------------ boot
function boot() {
  ensureOverlays();
  UI.init({
    quick: (name, hat) => { rememberProfile(name, hat); if (needOnline()) send({ t: 'quick', name, hat, settings: { scare: settings.scare } }); },
    create: o => { rememberProfile(o.name, o.hat); if (needOnline()) send({ t: 'create', name: o.name, hat: o.hat, public: !!o.public, settings: { scare: settings.scare } }); },
    join: (code, name, hat) => { rememberProfile(name, hat); if (needOnline()) send({ t: 'join', code, name, hat }); },
    practice: (name, hat) => { rememberProfile(name, hat); startLocal(name, hat); },
    prof: (name, hat) => { rememberProfile(name, hat); send({ t: 'prof', name, hat }); },
    cfg: patch => send({ t: 'cfg', settings: patch }), ready: v => send({ t: 'ready', v }), start: () => send({ t: 'start' }), kick: id => send({ t: 'kick', id }),
    leave: () => leaveRoom(), lobby: () => send({ t: 'lobby' }), retry: () => send({ t: 'retry' }),
    chatSend: (text, g) => send({ t: 'chat', text, g: !!g }), buy: item => send({ t: 'shop', item }),
    debug: o => { if (o.cmd === 'infbat') { ME.infBat = !!o.on; } else hostDebug(o); },
    resume: () => resumeGame(), shopClosed: () => lockPointer(), touch: touchInput, ping: kind => doPing(kind || 'here'), settingsChanged: () => applySettings(),
  });
  UI.setHats(HATS);
  S.screen = 'menu'; UI.screen('menu'); applySettings();
  // keep S.screen in sync with UI screen changes
  const origScreen = UI.screen.bind(UI); UI.screen = name => { S.screen = name; origScreen(name); };
  const w = document.getElementById('loading'); if (w) w.classList.add('gone');
  connect();
  requestAnimationFrame(frame);
  // first user gesture unlocks audio
  const unlock = () => { Sound.init(); Sound.resume(); };
  addEventListener('pointerdown', unlock, { once: false, passive: true }); addEventListener('keydown', unlock, { passive: true });
  view.buildWorld(W);
  globalThis.__nightshift = { S, G, ME, view, send, onMsg };
}
function rememberProfile(name, hat) { if (name) { S.name = name; settings.name = name; } if (hat) { S.hat = hat; settings.hat = hat; } }
boot();
