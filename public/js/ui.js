// NIGHT SHIFT: The Last Bell — all DOM UI (menu, lobby, HUD, overlays, end screen, touch controls).
// Vanilla JS, no dependencies. Player-provided strings (names, chat) only ever go through textContent.
// main.js drives this through the `UI` object at the bottom of the file.

const SETTINGS_KEY = 'nightshift.settings.v1';
const VERSION = 'v1.0';
const DEFAULTS = { sens: 1, master: 0.8, music: 0.7, sfx: 0.9, scale: 1, scare: 1, subs: true, comedy: 50, filter: 'none', quality: 'med', fov: 75, invertY: false, name: '', hat: 'none', hints: true, touch: null, debugHud: false };
const HAT_EMOJI = { none: '∅', cap: '🧢', cone: '🚧', beanie: '🧶', crown: '👑', bread: '🍞', duck: '🦆', halo: '😇' };
const ITEMS = [['can', '🥫', 'Can'], ['duck', '🦆', 'Duck'], ['stress', '🎾', 'Stress ball'], ['butter', '🧈', 'Butter'], ['knife', '🔪', 'Knife'], ['jam', '🍓', 'Jam jar']];
const MON_ABS = [['tele', 'Teleport', '1', 12], ['decoy', 'Decoy', '2', 25], ['bell', 'Bell', '3', 30], ['flood', 'Flood', '4', 30]];
const MODES = [
  ['coop', 'Co-op Survival', 'Survive all five Incidents together. Teamwork required.'],
  ['monster', 'Play as The Last Bell', 'One player hunts. Everyone else races the sunrise for the Seals.'],
  ['chaos', 'Chaos Mode', 'Co-op, but a random mutator hits the whole campus every minute.'],
];
const TIPS = [
  'Loaves hunt by sound. Sprinting is basically a dinner bell.',
  'The Handshake Entity only moves when you look away. Blink responsibly.',
  'Throw a can first. Panic later.',
  'Butter is a distraction, not a personality.',
  'Stink clouds hurt you, but they also hide you. Mostly the second one.',
  'Crouch near an enemy and hold your breath. It cannot hear what is not there.',
  'Your flashlight flickers when something is close. So does your confidence.',
  'Teammates revive faster than you can apologise. Hold E on them.',
  'Sprinkles are loud. Cleaning is stealth.',
  'Sunrise waits for no one. Neither does the Loaf.',
  'Find all 15 hidden 67s. Do not ask why.',
  'Sanity drops in the dark. Snacks and friends bring it back.',
  'The shop vending machine takes Cooked Coins. It does not take excuses.',
  'Stay still when the laugh track rises. Move when it falls.',
];
const DEATH_TIPS = [
  'Tip: the Loaf cannot see you. It can hear everything else.',
  'Tip: butter is a valid emotional support item. And a valid distraction.',
  'Tip: if the Handshake Entity is closer, you looked away. Stop looking away.',
  'Tip: swimming is loud. Wraiths are not impressed by your front crawl.',
  'Tip: the flashlight battery is also your emotional battery. Ration it.',
  'Tip: revive your teammates. They are not just there for the vibes.',
  'Tip: a thrown rubber duck solves more problems than you would expect.',
  'Tip: the Audience laughs at everything. Do not give them material.',
];
const EPI = {
  win: 'The Last Bell is free. Dawn spills over the oval, the bread goes back to being bread, and somewhere a canteen budget quietly recovers. One last whisper from the stage, softer this time: “ts rizz…”. Respect was shown. Boundaries were kept. The doughnut was shared.',
  secret: 'Every 67 found. The legendary bike, wheeled out of the dark. One victory lap of the entire campus under a sky going gold, rated a flawless 67/10 by an unbiased panel of friendly ghosts.',
  lose: 'The sun comes up. Or The Last Bell does. Either way, a huge unhinged grin fills the doorway and the whole studio goes quiet. You are, definitively, cooked.',
  monsterWin: 'Not a single survivor left standing. The Last Bell rings once, very politely.',
};
const KEYS_HELP = '<div class="keys">'
  + '<kbd>W A S D</kbd><span>Move</span><kbd>Mouse</kbd><span>Look around</span><kbd>Shift</kbd><span>Sprint (loud! drains stamina)</span>'
  + '<kbd>C / Ctrl</kbd><span>Crouch (quiet, harder to spot)</span><kbd>F</kbd><span>Flashlight on/off (battery drains)</span>'
  + '<kbd>E</kbd><span>Interact: pick up, open, use machines</span><kbd>Q</kbd><span>Throw the selected item to distract enemies</span>'
  + '<kbd>1–6 / Wheel</kbd><span>Select inventory item</span><kbd>H</kbd><span>Hide in lockers, bins and cupboards (again to leave)</span>'
  + '<kbd>Shift (crouched)</kbd><span>Hold your breath when an enemy is near (oxygen bar)</span>'
  + '<kbd>R / hold E</kbd><span>Revive a downed teammate (4 seconds)</span><kbd>V</kbd><span>Ping wheel: enemy / go there / need battery / 67!</span>'
  + '<kbd>Enter</kbd><span>Chat (Tab = global radio, enemies can hear it)</span><kbd>B</kbd><span>Open the Meme Shop at the vending machine</span>'
  + '<kbd>Esc</kbd><span>Pause menu (online play keeps running!)</span></div>';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmtTime = s => { s = Math.max(0, Math.round(+s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

// ---------------------------------------------------------------- tiny DOM helpers
function h(tag, a, ...kids) {
  const e = document.createElement(tag);
  if (a) for (const k in a) {
    const v = a[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'list') { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const btn = (label, cls, on, extra) => h('button', { type: 'button', class: 'btn ' + (cls || ''), text: label, onclick: on, ...extra });
// cached writers (HUD runs ~15x/s, only touch the DOM when a value changed)
const T = (n, v) => { v = String(v); if (n._t !== v) { n._t = v; n.textContent = v; } };
const SW = (n, p, v) => { if (n._s === undefined) n._s = {}; if (n._s[p] !== v) { n._s[p] = v; n.style[p] = v; } };
const CL = (n, c, on) => { on = !!on; if (n._c === undefined) n._c = {}; if (n._c[c] !== on) { n._c[c] = on; n.classList.toggle(c, on); } };
const HD = (n, hid) => { hid = !!hid; if (n._h !== hid) { n._h = hid; n.hidden = hid; } };

function loadSettings() {
  let s = {};
  try { const j = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); if (j && typeof j === 'object') s = j; } catch { /* storage unavailable */ }
  const o = { ...DEFAULTS };
  for (const k in DEFAULTS) if (k in s && typeof s[k] === typeof DEFAULTS[k]) o[k] = s[k];
  if (s.touch === true || s.touch === false) o.touch = s.touch;
  o.sens = clamp(o.sens, 0.2, 3); o.scale = clamp(o.scale, 0.4, 1); o.fov = clamp(o.fov, 55, 110); o.comedy = clamp(o.comedy, 0, 100); o.scare = clamp(Math.round(o.scare), 0, 2);
  for (const k of ['master', 'music', 'sfx']) o[k] = clamp(o[k], 0, 1);
  if (!['none', 'vhs', 'sepia', 'pixel'].includes(o.filter)) o.filter = 'none';
  if (!['low', 'med', 'high'].includes(o.quality)) o.quality = 'med';
  o.name = String(o.name || '').slice(0, 16);
  return o;
}

// ---------------------------------------------------------------- state
const S = {
  cb: {}, settings: loadSettings(), hats: Object.keys(HAT_EMOJI), room: null, youId: 0, built: false, tipI: Math.floor(Math.random() * TIPS.length), tipTimer: 0,
  logs: [], stack: [], chatOpen: false, chatGlobal: false, shopOpen: false, paused: false, rateTimer: 0, countT: 0, touchOn: false, debugInf: false,
  lastShop: { coins: 0, up: {}, hats: 0 }, canvas: null, el: {}, hatBtns: [],
};

const cb = (name, ...a) => { try { const f = S.cb[name]; if (typeof f === 'function') f(...a); } catch (e) { console.error('UI callback', name, e); } };
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); } catch { /* ignore */ } };
const inviteCode = () => { const m = /^\/r\/([A-Za-z0-9]{5})/.exec(location.pathname); return m ? m[1].toUpperCase() : ''; };
const hatOf = id => HAT_EMOJI[id] || '🎩';

function validName() {
  const v = (S.el.name.value || '').replace(/[<>\u0000-\u001f]/g, '').trim();
  if (v.length < 2 || v.length > 16) { S.el.name.classList.add('bad'); S.el.name.focus(); UI.toast('Pick a name first (2–16 characters).', 'bad'); return null; }
  S.settings.name = v; saveSettings();
  return v;
}

// ---------------------------------------------------------------- overlays
function openOv(id) { const e = S.el[id]; if (!e) return; e.classList.add('on'); S.stack = S.stack.filter(x => x !== id); S.stack.push(id); const f = e.querySelector('button, input, select'); if (f && !S.settings.touch) try { f.focus({ preventScroll: true }); } catch { /* */ } }
function closeOv(id, user) {
  const e = S.el[id]; if (!e || !e.classList.contains('on')) return;
  e.classList.remove('on'); S.stack = S.stack.filter(x => x !== id);
  if (id === 'ov-shop') { S.shopOpen = false; if (user) cb('shopClosed'); }
  if (id === 'ov-pause') { S.paused = false; if (user) cb('resume'); }
}
function makeOv(id, wide, clickAway, ...kids) {
  const ov = h('div', { class: 'ov', id, role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'panel' + (wide ? ' wide' : '') }, ...kids));
  if (clickAway) ov.addEventListener('pointerdown', e => { if (e.target === ov) closeOv(id, true); });
  S.el[id] = ov; return ov;
}

// ---------------------------------------------------------------- menu
function buildHatPicker(onPick, current) {
  const box = h('div', { class: 'hats', role: 'radiogroup', 'aria-label': 'Hat' });
  const render = () => {
    box.replaceChildren(...S.hats.map(id => h('button', { type: 'button', class: 'chip' + (id === current() ? ' on' : ''), title: id, 'aria-label': 'Hat: ' + id, role: 'radio', 'aria-checked': id === current() ? 'true' : 'false', text: hatOf(id), onclick: () => { onPick(id); render(); } })));
  };
  render(); S.hatBtns.push(render); return box;
}

function buildMenu() {
  const nameIn = h('input', { type: 'text', id: 'f-name', maxLength: 16, placeholder: 'Your name', autocomplete: 'off', spellcheck: false, 'aria-label': 'Your name', value: S.settings.name,
    oninput: () => { nameIn.classList.remove('bad'); } });
  nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); if (v.length >= 2) { S.settings.name = v.slice(0, 16); saveSettings(); } });
  S.el.name = nameIn;
  const hat = () => S.settings.hat;
  const hatPick = buildHatPicker(id => { S.settings.hat = id; saveSettings(); }, hat);
  const codeIn = h('input', { type: 'text', class: 'code', id: 'f-code', maxLength: 5, placeholder: 'CODE', autocomplete: 'off', spellcheck: false, 'aria-label': 'Room code', inputMode: 'text' });
  S.el.code = codeIn;
  const joinBtn = btn('Join', '', () => doJoin(codeIn.value), { disabled: true });
  codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); joinBtn.disabled = codeIn.value.length !== 5; });
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter' && codeIn.value.length === 5) doJoin(codeIn.value); });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = validName(); if (v) cb('quick', v, S.settings.hat); } });
  const doJoin = code => { const n = validName(); if (n) cb('join', String(code).toUpperCase(), n, S.settings.hat); };
  const inviteBtn = btn('', 'pri big wide', () => doJoin(inviteCode()), { hidden: true });
  S.el.invite = inviteBtn;
  const tip = h('div', { class: 'tip', 'aria-live': 'off' });
  S.el.tip = tip;

  const title = h('div', { class: 'title' },
    h('h1', null, h('span', { text: 'NIGHT ' }), h('span', { class: 'l2', text: 'SHIFT' })),
    h('h2', { text: 'The Last Bell' }), h('div', { class: 'tube' }));
  const main = h('div', { class: 'panel org' },
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 'f-name', text: 'Name' }), nameIn),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Hat' }), hatPick)),
    h('div', { style: 'height:14px' }),
    h('div', { class: 'menu-btns' },
      inviteBtn,
      btn('Play online', 'pri big', () => { const n = validName(); if (n) cb('quick', n, S.settings.hat); }),
      btn('Create private room', 'big', () => { const n = validName(); if (n) cb('create', { name: n, hat: S.settings.hat, public: false }); }),
      h('div', { class: 'field wide' }, h('span', { class: 'lab', text: 'Join with code' }), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, codeIn, joinBtn)),
      btn('Practice (solo + Buddy)', '', () => { const n = validName(); if (n) cb('practice', n, S.settings.hat); }),
      btn('Settings', '', () => UI.openSettings(true)),
      btn('How to play', 'ghost', () => openOv('ov-help')),
      btn('Credits', 'ghost', () => openOv('ov-credits'))));
  return h('section', { class: 'scr dim', id: 'scr-menu' }, h('div', { class: 'wrap', style: 'max-width:680px' }, title, main, tip));
}

// ---------------------------------------------------------------- lobby
function stepper(label, value, min, max, step, onSet, can, fmt) {
  const val = h('span', { class: 'val', text: fmt ? fmt(value) : String(value), style: 'min-width:64px;text-align:center;font-size:15px' });
  return h('div', { class: 'field' }, h('span', { class: 'lab', text: label }),
    h('div', { class: 'row', style: 'flex-wrap:nowrap' },
      btn('−', 'sm', () => onSet(clamp(value - step, min, max)), { disabled: !can || value <= min, 'aria-label': 'Decrease ' + label }), val,
      btn('+', 'sm', () => onSet(clamp(value + step, min, max)), { disabled: !can || value >= max, 'aria-label': 'Increase ' + label })));
}
function segField(label, opts, cur, onSet, can) {
  return h('div', { class: 'field' }, h('span', { class: 'lab', text: label }),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, opts.map(([v, t]) => h('button', { type: 'button', class: 'chip txt' + (v === cur ? ' on' : ''), text: t, role: 'radio', 'aria-checked': v === cur ? 'true' : 'false', disabled: !can, onclick: () => onSet(v) }))));
}
function toggleField(label, on, onSet, can) {
  return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!on, disabled: !can, onchange: e => onSet(e.target.checked) }), h('span', { text: label }));
}

function buildLobby() {
  const L = S.el.lobby = {};
  L.code = h('div', { class: 'code-big', 'aria-label': 'Room code' });
  L.copy = btn('Copy invite link', 'sm', copyInvite);
  L.note = h('div', { class: 'small dim', style: 'text-align:center;min-height:1.3em' });
  L.players = h('div', { class: 'plist' });
  L.set = h('div', { class: 'stack' });
  L.actions = h('div', { class: 'row', style: 'justify-content:flex-end' });
  L.count = h('span', { class: 'lab' });
  const profName = h('input', { type: 'text', maxLength: 16, 'aria-label': 'Your name', placeholder: 'Your name', value: S.settings.name, onchange: () => { const v = profName.value.trim(); if (v.length >= 2) { S.settings.name = v.slice(0, 16); S.el.name.value = S.settings.name; saveSettings(); cb('prof', S.settings.name, S.settings.hat); } } });
  L.prof = profName;
  const hats = buildHatPicker(id => { S.settings.hat = id; saveSettings(); cb('prof', S.settings.name || profName.value.trim(), id); }, () => S.settings.hat);
  const head = h('div', { class: 'title', style: 'margin:0' }, h('h1', { style: 'font-size:clamp(28px,6vw,48px)', text: 'Night Shift' }), h('h2', { style: 'font-size:12px', text: 'Lobby' }));
  return h('section', { class: 'scr dim', id: 'scr-lobby' }, h('div', { class: 'wrap' }, head,
    h('div', { class: 'grid2' },
      h('div', { class: 'stack', style: 'display:flex;flex-direction:column;gap:14px;min-width:0' },
        h('div', { class: 'panel org' }, h('div', { class: 'lab', style: 'text-align:center;margin-bottom:6px', text: 'Room code' }), L.code, h('div', { class: 'row', style: 'justify-content:center;margin-top:10px' }, L.copy), L.note),
        h('div', { class: 'panel' }, h('h3', null, 'Players ', L.count), L.players,
          h('div', { style: 'height:12px' }), h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Your name' }), profName), h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Hat' }), hats)))),
      h('div', { class: 'panel' }, h('h3', { text: 'Run settings' }), L.set)),
    L.actions));
}

function copyInvite() {
  const code = S.room && S.room.code; if (!code) return;
  const link = location.origin + '/r/' + code;
  const done = ok => UI.toast(ok ? 'Invite link copied!' : 'Copy failed. Link: ' + link, ok ? 'good' : 'bad');
  const fallback = () => {
    const t = h('textarea', { value: link, style: 'position:fixed;left:-999px;top:0' }); document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } t.remove(); done(ok);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(() => done(true), fallback); else fallback();
}

function renderLobby() {
  const L = S.el.lobby, r = S.room; if (!L || !r) return;
  const me = r.players.find(p => p.id === S.youId), host = r.host === S.youId, st = r.settings || {};
  T(L.code, r.code || '-----');
  L.copy.hidden = !!r.practice;
  T(L.note, r.practice ? 'Practice run: solo with your Buddy bot. Starting…' : 'Share the link — friends jump straight into this room.');
  T(L.count, `${r.players.length}/${st.maxPlayers || 12}`);
  if (document.activeElement !== L.prof && !L.prof.value) L.prof.value = S.settings.name;
  // players
  L.players.replaceChildren(...r.players.map(p => {
    const isHost = p.id === r.host;
    const row = h('div', { class: 'pl' + (p.id === S.youId ? ' you' : '') });
    row.append(h('span', { class: 'hat', text: hatOf(p.hat) }), h('span', { class: 'nm', text: (isHost ? '👑 ' : '') + p.name }));
    if (p.id === S.youId) row.append(h('span', { class: 'tag', text: 'You' }));
    if (p.bot) row.append(h('span', { class: 'tag bot', text: 'Bot' }));
    else if (!p.connected) row.append(h('span', { class: 'tag dc', text: 'Offline' }));
    else row.append(h('span', { class: 'tag ' + (p.ready || isHost ? 'rdy' : 'not'), text: isHost ? 'Host' : p.ready ? 'Ready' : 'Not ready' }));
    if (st.mode === 'monster' && p.id === st.monsterId) row.append(h('span', { class: 'tag mon', text: 'Bell' }));
    if (host && p.id !== S.youId && !p.bot) row.append(h('button', { type: 'button', class: 'btn sm red', text: 'Kick', 'aria-label': 'Kick ' + p.name, onclick: () => cb('kick', p.id) }));
    return row;
  }));
  // settings
  const set = patch => cb('cfg', patch), can = host;
  const kids = [];
  kids.push(h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Mode' }), h('div', { class: 'modes' }, MODES.map(([id, nm, ds]) => h('button', { type: 'button', class: 'mode' + (st.mode === id ? ' on' : ''), disabled: !can, onclick: () => set({ mode: id }) }, h('b', { text: nm }), h('span', { text: ds }))))));
  if (st.mode === 'monster') {
    const sel = h('select', { disabled: !can, 'aria-label': 'Who is The Last Bell', onchange: e => set({ monsterId: +e.target.value }) }, h('option', { value: 0, text: 'Random player' }),
      r.players.filter(p => !p.bot).map(p => h('option', { value: p.id, text: p.name, selected: p.id === st.monsterId })));
    if (!st.monsterId) sel.value = '0';
    kids.push(h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Who is The Last Bell?' }), sel));
  }
  kids.push(h('div', { class: 'grid2' },
    segField('Difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], st.difficulty, v => set({ difficulty: v }), can),
    segField('Scare intensity', [[0, 'Off'], [1, 'Normal'], [2, 'Max']], st.scare, v => set({ scare: v }), can)));
  kids.push(h('div', { class: 'grid3' },
    stepper('Sunrise (min)', st.sunrise || 20, 8, 45, 1, v => set({ sunrise: v }), can),
    stepper('Bots', st.bots || 0, 0, 4, 1, v => set({ bots: v }), can),
    stepper('Max players', st.maxPlayers || 12, 1, 12, 1, v => set({ maxPlayers: v }), can)));
  kids.push(h('div', null, toggleField('Lock room (no new players)', st.locked, v => set({ locked: v }), can), toggleField('Allow late join', st.lateJoin, v => set({ lateJoin: v }), can), toggleField('New Game+ (faster enemies, fewer batteries)', st.ngplus, v => set({ ngplus: v }), can)));
  if (!host) kids.push(h('div', { class: 'small dim', text: 'Only the host can change settings.' }));
  L.set.replaceChildren(...kids);
  // actions
  const acts = [btn('Leave', 'ghost', () => cb('leave'))];
  if (!r.practice && me) acts.push(btn(me.ready ? 'Ready ✓' : 'Ready up', me.ready ? 'grn' : '', () => cb('ready', !me.ready)));
  if (host) acts.push(btn('Start night shift', 'pri big', () => cb('start'))); else acts.push(h('span', { class: 'dim', text: 'Waiting for host…', style: 'align-self:center' }));
  L.actions.replaceChildren(...acts);
}

// ---------------------------------------------------------------- settings / help / credits / pause / shop / debug / logs
function buildSettings() {
  const rows = [];
  const slider = (key, label, min, max, step, fmt) => {
    const out = h('span', { class: 'val', text: fmt(S.settings[key]) });
    const inp = h('input', { type: 'range', min, max, step, value: S.settings[key], 'aria-label': label, oninput: () => { out.textContent = fmt(+inp.value); change(key, +inp.value); } });
    return h('div', { class: 'set' }, h('span', { class: 'lab', text: label }), inp, out);
  };
  const sel = (key, label, opts) => h('div', { class: 'set' }, h('span', { class: 'lab', text: label }), h('select', { 'aria-label': label, onchange: e => change(key, e.target.value) }, opts.map(([v, t]) => h('option', { value: v, text: t, selected: S.settings[key] === v }))), h('span'));
  const chk = (key, label) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!S.settings[key], onchange: e => change(key, e.target.checked) }), h('span', { text: label }));
  const pct = v => Math.round(v * 100) + '%';
  rows.push(h('h3', { text: 'Gameplay' }),
    slider('comedy', 'Horror ↔ Comedy', 0, 100, 1, v => (v < 34 ? 'Horror' : v > 66 ? 'Comedy' : 'Mix')),
    slider('sens', 'Look sensitivity', 0.2, 3, 0.05, v => v.toFixed(2) + '×'),
    slider('fov', 'Field of view', 55, 110, 1, v => v + '°'),
    h('div', { class: 'set' }, h('span', { class: 'lab', text: 'Scare intensity' }), h('div', { class: 'seg' }, [[0, 'Off'], [1, 'Normal'], [2, 'Max']].map(([v, t]) => h('button', { type: 'button', class: 'chip txt' + (S.settings.scare === v ? ' on' : ''), text: t, onclick: e => { change('scare', v); e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === e.currentTarget)); } }))), h('span')),
    chk('subs', 'Narrator subtitles'), chk('hints', 'Tutorial hints'), chk('invertY', 'Invert Y axis'),
    h('h3', { style: 'margin-top:8px', text: 'Audio' }), slider('master', 'Master volume', 0, 1, 0.01, pct), slider('music', 'Music volume', 0, 1, 0.01, pct), slider('sfx', 'Effects volume', 0, 1, 0.01, pct),
    h('h3', { style: 'margin-top:8px', text: 'Video' }), slider('scale', 'Render scale', 0.4, 1, 0.05, pct),
    sel('quality', 'Quality', [['low', 'Low'], ['med', 'Medium'], ['high', 'High']]), sel('filter', 'Filter', [['none', 'None'], ['vhs', 'VHS'], ['sepia', 'Sepia'], ['pixel', 'Pixel Hell']]),
    sel('touch', 'Touch controls', [['auto', 'Auto'], ['on', 'Always on'], ['off', 'Off']]), chk('debugHud', 'Show FPS / ping'));
  const touchSel = rows.find(r => r.querySelector && r.querySelector('select[aria-label="Touch controls"]'));
  if (touchSel) { const s = touchSel.querySelector('select'); s.value = S.settings.touch === true ? 'on' : S.settings.touch === false ? 'off' : 'auto'; }
  return makeOv('ov-settings', false, true, h('h2', { text: 'Settings' }), h('div', { class: 'stack' }, rows), h('div', { style: 'height:14px' }), btn('Done', 'pri', () => UI.openSettings(false)));
}
function change(key, val) {
  if (key === 'touch') val = val === 'on' ? true : val === 'off' ? false : null;
  S.settings[key] = val; saveSettings();
  if (key === 'filter') UI.applyFilter(S.canvas);
  if (key === 'touch') refreshTouch();
  cb('settingsChanged', S.settings);
}

function buildHelp() {
  const wrap = h('div'); wrap.innerHTML = KEYS_HELP; // static trusted markup
  return makeOv('ov-help', true, true, h('h2', { text: 'How to play' }),
    h('ol', { class: 'prem' },
      h('li', { text: 'You are Dev, stuck overnight on a locked-down school campus after one cursed Friday-morning rumour.' }),
      h('li', { text: 'Five Incidents haunt the grounds: the Doughnut Dungeon, the Scooter Catastrophe, the Loaf of Bread bakery, the Bodyboard Abyss and the Fart Joke Foghorn auditorium. Each guards a Seal.' }),
      h('li', { text: 'Collect all Five Seals before sunrise. No guns: sneak, hide, and throw things to distract.' }),
      h('li', { text: 'Darkness and staring at monsters drain sanity. Light, snacks and teammates restore it.' }),
      h('li', { text: 'Downed teammates can be revived. 15 hidden Incident Logs and 15 hidden 67s unlock secrets.' })),
    h('div', { style: 'height:12px' }), wrap, h('div', { style: 'height:14px' }), btn('Got it', 'pri', () => closeOv('ov-help', true)));
}
function buildCredits() {
  return makeOv('ov-credits', false, true, h('h2', { text: 'Credits' }),
    h('p', { text: 'NIGHT SHIFT: The Last Bell is a made-up horror-comedy. All characters, places and events are fictional. “Midnight Regional College” does not exist, and any resemblance to real people, schools, loaves or doughnuts is coincidence.' }),
    h('p', { class: 'dim', text: 'Built with Three.js and the Web Audio API. Every texture and sound is generated in your browser.' }),
    h('p', { class: 'mono dim', text: VERSION }), btn('Close', 'pri', () => closeOv('ov-credits', true)));
}
function buildPause() {
  return makeOv('ov-pause', false, false, h('h2', { text: 'Paused' }),
    h('p', { class: 'small dim', text: 'Online runs do not stop. The Last Bell is still ringing, so find somewhere safe.' }),
    h('div', { class: 'stack' }, btn('Resume', 'pri', () => closeOv('ov-pause', true)), btn('Controls', '', () => openOv('ov-help')), btn('Settings', '', () => UI.openSettings(true)), btn('Incident logs', '', () => { renderLogs(); openOv('ov-logs'); }), btn('Leave room', 'red', () => { closeOv('ov-pause'); cb('leave'); })));
}
function buildLogs() {
  S.el.logList = h('div', { class: 'logs' });
  return makeOv('ov-logs', true, true, h('h2', { text: 'Incident logs' }), S.el.logList, h('div', { style: 'height:12px' }), btn('Close', 'pri', () => closeOv('ov-logs', true)));
}
function renderLogs() {
  const l = S.logs.slice().sort((a, b) => a.n - b.n);
  S.el.logList.replaceChildren(...(l.length ? l.map(e => h('div', { class: 'logc' }, h('b', { text: `LOG ${String(e.n).padStart(2, '0')} · ${e.title}` }), h('span', { text: e.text }))) : [h('div', { class: 'dim', text: 'Nothing found yet. Look in the dark corners.' })]));
}
function buildShop() {
  S.el.shopBody = h('div');
  return makeOv('ov-shop', false, true, h('h2', { text: 'Meme Shop' }), S.el.shopBody, h('div', { style: 'height:12px' }), btn('Close', 'ghost', () => closeOv('ov-shop', true)));
}
function renderShop() {
  const d = S.lastShop, up = d.up || {}, coins = d.coins | 0;
  const defs = [['battery', 'Bigger Battery', 'Flashlight lasts longer.', 6, true], ['shoes', 'Quiet Shoes', 'Footsteps make less noise.', 5, true], ['shield', 'Bread Shield', 'Absorbs one hit.', 4, true], ['rabbit', "Lucky Rabbit's Foot", '+1 coin from every coin pickup.', 4, true], ['hat', 'Silly Hat', 'Cosmetic. Very important.', 2, false]];
  S.el.shopBody.replaceChildren(
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('span', { class: 'lab', text: 'Team coins' }), h('span', { class: 'coinbar', text: '🪙 ' + coins })),
    h('div', { class: 'vm shop-items' }, defs.map(([key, nm, ds, cost, once]) => {
      const owned = once && !!up[key], poor = coins < cost && !owned;
      return h('button', { type: 'button', class: 'item' + (owned ? ' owned' : '') + (poor ? ' poor' : ''), disabled: owned || poor, onclick: () => cb('buy', key) },
        h('b', { text: nm }), h('span', { text: ds }), h('em', { text: owned ? 'OWNED' : '🪙 ' + cost + (key === 'hat' && d.hats ? '  (own ' + d.hats + ')' : '') }));
    })));
}
function buildDebug() {
  const c = o => () => cb('debug', o);
  const zones = ['atrium', 'canteen', 'scooter', 'bakery', 'abyss', 'aud'];
  return makeOv('ov-debug', true, true, h('h2', { text: 'Host cheats' }),
    h('p', { class: 'small dim', text: 'Host only. Using these marks the run as cheated.' }),
    h('div', { class: 'stack' },
      h('div', { class: 'row' }, btn('Skip seal', 'sm', c({ cmd: 'skip' })), btn('+20 coins', 'sm', c({ cmd: 'coins' })), btn('Reveal 67s', 'sm', c({ cmd: 'reveal' })), btn('+4 bots', 'sm', c({ cmd: 'bots' })), btn('Open auditorium / boss', 'sm', c({ cmd: 'boss' })), btn('−2 min sunrise', 'sm', c({ cmd: 'time' }))),
      h('div', null, h('div', { class: 'lab', text: 'Grant a specific Seal' }), h('div', { class: 'row', style: 'margin-top:6px' }, [0, 1, 2, 3, 4].map(n => btn('Seal ' + (n + 1), 'sm', c({ cmd: 'seal', n }))))),
      h('div', null, h('div', { class: 'lab', text: 'Teleport' }), h('div', { class: 'row', style: 'margin-top:6px' }, zones.map(z => btn(z, 'sm', c({ cmd: 'tp', zone: z }))))),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: e => { S.debugInf = e.target.checked; cb('debug', { cmd: 'infbat', on: e.target.checked }); } }), h('span', { text: 'Infinite battery (this client)' }))),
    h('div', { style: 'height:12px' }), btn('Close', 'pri', () => closeOv('ov-debug', true)));
}

// ---------------------------------------------------------------- end screen
function buildEnd() { return h('section', { class: 'scr dim', id: 'scr-end' }); }
function rateCard() {
  const card = h('div', { class: 'card' });
  const stars = h('div', { class: 'stars' });
  const x = h('button', { type: 'button', class: 'x', text: 'Not now', onclick: () => ov.remove() });
  const ov = h('div', { class: 'rate', role: 'dialog', 'aria-label': 'Rate your experience' }, card);
  for (let i = 1; i <= 5; i++) stars.append(h('button', { type: 'button', text: '★', 'aria-label': i + ' stars', onclick: () => { card.replaceChildren(h('h4', { text: 'Thanks.' }), h('p', { text: 'The Last Bell has also rated you.' }), h('button', { type: 'button', class: 'x', text: 'Close', onclick: () => ov.remove() })); } }));
  card.append(h('h4', { text: 'Please rate your experience' }), h('p', { style: 'margin:0 0 8px;font-size:14px;color:#555', text: 'Your feedback helps us get you cooked faster.' }), stars, x);
  return ov;
}

// ---------------------------------------------------------------- HUD
function buildHud() {
  const E = S.el.hud = {};
  const root = h('div', { id: 'hud' });
  E.vig = h('div', { class: 'vig' }); E.low = h('div', { class: 'lowsan' }); E.gas = h('div', { class: 'gas' }); E.black = h('div', { class: 'black' });
  E.time = h('div', { class: 't' }); E.sun = h('div', { class: 'sun' }); E.pips = [0, 1, 2, 3, 4].map(() => h('div', { class: 'pip' })); E.coins = h('div', { class: 'coins' });
  E.clock = h('div', { class: 'clock' }, E.time, h('div', { class: 'sky' }, E.sun), h('div', { class: 'pips' }, E.pips), E.coins);
  E.zone = h('div', { class: 'zone' }); E.obj = h('div', { class: 'obj' }); E.prog = h('div', { class: 'prog' }); E.meta = h('div', { class: 'meta' });
  E.tl = h('div', { class: 'hud-tl' }, E.zone, E.obj, E.prog, E.meta);
  // compass
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], strip = h('div', { class: 'strip' });
  for (let c = 0; c < 3; c++) for (const l of labels) strip.append(h('span', { class: l.length > 1 ? 'm' : l === 'N' ? 'n' : '', text: l }));
  E.strip = strip; E.compass = h('div', { class: 'compass' }, strip);
  E.bossName = h('div', { class: 'nm', text: 'The Last Bell' }); E.bossFill = h('div', { class: 'fl' }); E.bossPh = h('div', { class: 'ph' });
  E.boss = h('div', { class: 'bossbar' }, E.bossName, h('div', { class: 'tr' }, E.bossFill), E.bossPh);
  E.spec = h('div', { class: 'spec' });
  E.laughLbl = h('div'); E.laughFill = h('div', { class: 'fl' }); E.laugh = h('div', { class: 'laugh' }, E.laughLbl, h('div', { class: 'tr' }, E.laughFill));
  // bottom-left: hearts, badges, bars
  E.hearts = h('div', { class: 'hearts' }, [h('i', { text: '❤' }), h('i', { text: '❤' })]);
  const mkBadge = (c, t) => h('span', { class: 'badge ' + c, text: t });
  E.bShield = mkBadge('shield', 'Shield'); E.bHide = mkBadge('hide', 'Hiding'); E.bGas = mkBadge('gas', 'Gas'); E.bLimp = mkBadge('limp', 'Limping'); E.bFl = mkBadge('fl', 'Torch');
  E.badges = h('div', { class: 'row', style: 'gap:5px' }, E.bShield, E.bHide, E.bGas, E.bLimp, E.bFl);
  const mkBar = (cls, ico, title) => { const fl = h('div', { class: 'fl' }); return { row: h('div', { class: 'bar ' + cls, title }, h('span', { class: 'n', text: ico }), h('div', { class: 'tr' }, fl)), fl }; };
  E.bSt = mkBar('st', '⚡', 'Stamina'); E.bBa = mkBar('ba', '🔦', 'Battery'); E.bSa = mkBar('sa', '🧠', 'Sanity'); E.bOx = mkBar('ox', '🫧', 'Oxygen'); E.bNo = mkBar('no', '👂', 'Noise');
  E.bl = h('div', { class: 'hud-bl' }, E.hearts, E.badges, E.bNo.row, E.bOx.row, E.bSa.row, E.bBa.row, E.bSt.row);
  // inventory
  E.slots = ITEMS.map(([k, ico, nm], i) => { const c = h('span', { class: 'c' }); return { k, c, el: h('div', { class: 'slot empty', title: nm }, h('span', { class: 'k', text: String(i + 1) }), ico, c) }; });
  E.br = h('div', { class: 'hud-br' }, E.slots.map(s => s.el));
  E.cross = h('div', { class: 'cross' }); E.prompt = h('div', { class: 'prompt' }); E.hint = h('div', { class: 'hint' });
  // rhythm lane
  E.notes = [0, 1, 2, 3, 4].map(() => h('div', { class: 'note', text: '🔔' }));
  E.laneQ = h('div', { class: 'q' }); E.roastFill = h('i'); E.laneLbl = h('div', { class: 'lbl', text: 'ROAST BATTLE: tap USE / E / click on the beat' });
  E.lane = h('div', { class: 'lane' }, h('div', { class: 'hit' }), E.notes, E.laneQ, h('div', { class: 'roast' }, E.roastFill), E.laneLbl);
  // monster abilities
  E.mon = h('div', { class: 'mon' }, MON_ABS.map(([k, nm, key]) => { const cd = h('div', { class: 'cd' }), t = h('span', { class: 'cdt' }); return { k, cd, t, el: h('div', { class: 'ab' }, h('b', { text: key }), h('span', { text: nm }), cd, t) }; }).map(a => { (E.monA = E.monA || []).push(a); return a.el; }));
  // downed
  E.ring = h('div', { class: 'ring' }); E.dTxt = h('div', { class: 'small', text: 'Crawl to a teammate and hold E on them to revive' });
  E.downed = h('div', { class: 'downed' }, h('h2', { text: "You're down" }), E.ring, h('div', { class: 'dim', text: 'A teammate can revive you' }));
  root.append(E.vig, E.low, E.gas, E.black, h('div', { class: 'hud-top' }, E.clock), E.tl, E.compass, E.boss, E.spec, E.laugh, E.bl, E.br, E.cross, E.prompt, E.hint, E.lane, E.mon, E.downed);
  return root;
}

function updateHud(s) {
  const E = S.el.hud; if (!E || !s) return;
  const sunMax = s.sunriseMax || 1, left = clamp(s.sunrise || 0, 0, sunMax);
  T(E.time, fmtTime(left)); CL(E.clock, 'warn', left < 90 && left > 0);
  SW(E.sun, 'left', (clamp(1 - left / sunMax, 0, 1) * 100).toFixed(1) + '%');
  (s.seals || []).forEach((v, i) => E.pips[i] && CL(E.pips[i], 'on', v));
  T(E.coins, '🪙 ' + (s.coins | 0));
  T(E.zone, s.zoneName || ''); T(E.obj, s.objective || '');
  const sig = JSON.stringify(s.prog || []);
  if (E.prog._sig !== sig) { E.prog._sig = sig; E.prog.replaceChildren(...(s.prog || []).map(p => h('div', null, p.label + ' ', h('i', { text: `${p.n}/${p.of}` })))); }
  const meta = `Logs ${s.logs | 0}/15 · 67s ${s.s67 | 0}/15` + (s.fpsShow ? ` · ${s.fps | 0} fps · ${s.ping | 0} ms` : '');
  T(E.meta, meta);
  // hearts / badges / bars
  const hp = clamp(s.hp | 0, 0, 2); E.hearts.children.length && [...E.hearts.children].forEach((c, i) => CL(c, 'lost', i >= hp));
  HD(E.bShield, !s.shield); HD(E.bHide, !s.hiding); HD(E.bGas, !s.inGas); HD(E.bLimp, !s.limp); HD(E.bFl, !s.flash);
  const bar = (b, v, show, low) => { HD(b.row, !show); if (show) { SW(b.fl, 'transform', `scaleX(${clamp(v, 0, 1).toFixed(3)})`); CL(b.row, 'low', low && v < 0.2); } };
  bar(E.bSt, s.stamina, s.stamina < 0.99, true); bar(E.bBa, s.battery, true, true); bar(E.bSa, s.sanity, s.sanity < 0.995, true);
  bar(E.bOx, s.oxygen == null ? 0 : s.oxygen, s.oxygen != null, true); bar(E.bNo, s.noise || 0, (s.noise || 0) > 0.03, false);
  // overlays
  SW(E.vig, 'opacity', String(clamp(s.hit || 0, 0, 1).toFixed(2)));
  const lowS = s.sanity < 0.35; SW(E.low, 'opacity', String(clamp((0.5 - s.sanity) * 2, 0, 1).toFixed(2))); CL(S.root, 'lowsan', lowS);
  SW(E.gas, 'opacity', s.inGas ? '1' : '0'); SW(E.black, 'opacity', s.hiding ? '0.55' : '0');
  // inventory
  const mon = s.role === 'monster'; HD(E.br, mon); HD(E.mon, !mon);
  E.slots.forEach(sl => { const n = (s.inv && s.inv[sl.k]) | 0; CL(sl.el, 'empty', !n); CL(sl.el, 'sel', s.selected === sl.k); T(sl.c, n > 1 ? n : ''); });
  if (mon && E.monA) E.monA.forEach(a => { const cd = (s.mon && s.mon[a.k]) || 0, mx = MON_ABS.find(m => m[0] === a.k)[3]; SW(a.cd, 'height', (clamp(cd / mx, 0, 1) * 100).toFixed(0) + '%'); T(a.t, cd > 0 ? Math.ceil(cd) : ''); });
  // crosshair / prompt / hint
  CL(E.cross, 'use', !!s.prompt); CL(E.cross, 'hide', !!s.hiding);
  HD(E.prompt, !s.prompt); T(E.prompt, s.prompt || '');
  const hint = S.settings.hints && s.hint ? s.hint : ''; HD(E.hint, !hint); T(E.hint, hint);
  // compass
  const deg = (((-(s.compass || 0) * 180 / Math.PI) % 360) + 360) % 360;
  SW(E.strip, 'transform', `translateX(${-(480 + deg / 360 * 480 + 30).toFixed(1)}px)`);
  // boss / laugh / spectate / downed
  const b = s.boss; HD(E.boss, !b);
  if (b) { SW(E.bossFill, 'transform', `scaleX(${clamp(b.hp / 100, 0, 1).toFixed(3)})`); T(E.bossPh, `Phase ${b.phase || 1}${b.state ? ' · ' + b.state : ''}`); }
  const lg = s.laugh; HD(E.laugh, !lg);
  if (lg) { T(E.laughLbl, 'Laugh track: ' + (lg.phase || 'quiet')); SW(E.laughFill, 'transform', `scaleX(${clamp(lg.level || 0, 0, 1).toFixed(2)})`); }
  HD(E.spec, !s.spectating); T(E.spec, s.spectating ? 'Spectating: ' + s.spectating : '');
  CL(E.downed, 'on', !!s.downed); if (s.downed) E.ring.style.setProperty('--p', clamp(s.reviveP || 0, 0, 1).toFixed(2));
  // rhythm lane
  const bt = s.beat, on = !!(bt && bt.active); HD(E.lane, !on);
  if (on) {
    const win = 2.0, dt = bt.dt || 0.5, laneH = 190, rng = laneH - 46 - 4;
    E.notes.forEach((n, i) => { const tt = (bt.next || 0) + i * dt; if (tt > win || tt < -0.25) HD(n, true); else { HD(n, false); SW(n, 'bottom', (18 + 3 - 23 + clamp(tt, 0, win) / win * rng).toFixed(1) + 'px'); } });
    const q = bt.quality || '';
    if (q !== E.laneQ._q) { E.laneQ._q = q; E.laneQ._qt = performance.now(); }
    if (q && performance.now() - E.laneQ._qt > 700) { T(E.laneQ, ''); } else { T(E.laneQ, q ? q.toUpperCase() : ''); }
    E.laneQ.className = 'q ' + q;
    SW(E.roastFill, 'height', clamp(b ? b.roast : 0, 0, 100) + '%');
  }
  // debug button visibility
  HD(S.el.dbgBtn, !s.debug);
}

// ---------------------------------------------------------------- touch controls
function buildTouch() {
  const root = h('div', { id: 'touch' });
  const joy = h('div', { class: 'joy' }, h('div', { class: 'knob' })), knob = joy.firstChild;
  let jid = null, jc = null;
  const jmove = e => {
    if (e.pointerId !== jid) return;
    let dx = e.clientX - jc.x, dy = e.clientY - jc.y; const d = Math.hypot(dx, dy), m = 52;
    if (d > m) { dx *= m / d; dy *= m / d; }
    knob.style.transform = `translate(${dx}px,${dy}px)`; cb('touch', { type: 'move', x: +(dx / m).toFixed(2), y: +(dy / m).toFixed(2) });
  };
  joy.addEventListener('pointerdown', e => { e.preventDefault(); jid = e.pointerId; joy.setPointerCapture(jid); const r = joy.getBoundingClientRect(); jc = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; jmove(e); });
  joy.addEventListener('pointermove', jmove);
  const jend = e => { if (e.pointerId !== jid) return; jid = null; knob.style.transform = ''; cb('touch', { type: 'move', x: 0, y: 0 }); };
  joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);
  const look = h('div', { class: 'lookpad' });
  let lid = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', e => { e.preventDefault(); lid = e.pointerId; look.setPointerCapture(lid); lx = e.clientX; ly = e.clientY; });
  look.addEventListener('pointermove', e => { if (e.pointerId !== lid) return; cb('touch', { type: 'look', dx: e.clientX - lx, dy: e.clientY - ly }); lx = e.clientX; ly = e.clientY; });
  const lend = e => { if (e.pointerId === lid) lid = null; }; look.addEventListener('pointerup', lend); look.addEventListener('pointercancel', lend);
  root.append(look, joy);
  const defs = [['use', '✋', 'USE', 18, 84, 64, 0], ['throw', '🥫', 'THROW', 92, 70, 54, 0], ['flash', '🔦', 'LIGHT', 18, 166, 54, 0], ['hide', '🫥', 'HIDE', 92, 140, 54, 0], ['sprint', '🏃', 'RUN', 166, 70, 54, 1], ['crouch', '🧎', 'DUCK', 166, 140, 54, 1], ['ping', '📍', 'PING', 18, 236, 54, 0], ['next', '⏭', 'ITEM', 92, 210, 54, 0]];
  for (const [id, ico, lab, r, b, sz, tog] of defs) {
    const el = h('div', { class: 'tb', style: `right:calc(var(--sar) + ${r}px);bottom:calc(var(--sab) + ${b}px);width:${sz}px;height:${sz}px`, role: 'button', 'aria-label': lab }, ico, h('small', { text: lab }));
    let on = false;
    if (tog) el.addEventListener('pointerdown', e => { e.preventDefault(); on = !on; el.classList.toggle('on', on); cb('touch', { type: 'btn', id, down: on }); });
    else {
      el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on'); cb('touch', { type: 'btn', id, down: true }); if (id === 'ping') cb('ping', 'here'); });
      const up = () => { if (el.classList.contains('on')) { el.classList.remove('on'); cb('touch', { type: 'btn', id, down: false }); } };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    }
    root.append(el);
  }
  return root;
}
function refreshTouch() {
  const t = S.settings.touch; let on = t === true;
  if (t == null) { try { on = matchMedia('(pointer: coarse)').matches; } catch { on = false; } }
  S.touchOn = on; UI.touchEnabled = on; document.body.classList.toggle('has-touch', on);
}

// ---------------------------------------------------------------- chat
function openChat() {
  if (S.chatOpen) return; S.chatOpen = true; S.el.chat.classList.add('open'); S.el.chatIn.value = ''; S.el.chatIn.focus();
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* */ } }
}
function closeChat() { if (!S.chatOpen) return; S.chatOpen = false; S.el.chat.classList.remove('open'); S.el.chatIn.blur(); const c = document.getElementById('game'); if (c) try { c.focus({ preventScroll: true }); } catch { /* */ } }
function setGlobal(v) { S.chatGlobal = v; S.el.gtag.classList.toggle('on', v); S.el.gtag.textContent = v ? '📻 RADIO' : 'NEARBY'; }
function buildChat() {
  const log = h('div', { id: 'chatlog', 'aria-live': 'polite' });
  const inp = h('input', { type: 'text', maxLength: 140, placeholder: 'Say something… (Tab = radio, Enter sends, Esc cancels)', 'aria-label': 'Chat message', autocomplete: 'off' });
  const g = h('button', { type: 'button', class: 'gtag', onclick: () => { setGlobal(!S.chatGlobal); inp.focus(); } });
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      let t = inp.value.trim(), gl = S.chatGlobal;
      if (/^\/g\s/i.test(t)) { gl = true; t = t.slice(3).trim(); }
      if (t) cb('chatSend', t, gl); closeChat();
    } else if (e.key === 'Escape') closeChat();
    else if (e.key === 'Tab') { e.preventDefault(); setGlobal(!S.chatGlobal); }
  });
  inp.addEventListener('keyup', e => e.stopPropagation());
  const root = h('div', { id: 'chat' }, log, h('div', { id: 'chatin' }, g, inp));
  S.el.chat = root; S.el.chatLog = log; S.el.chatIn = inp; S.el.gtag = g; setGlobal(false);
  return root;
}

// ---------------------------------------------------------------- the public API
export const UI = {
  settings: S.settings, touchEnabled: false, keysHelp: KEYS_HELP,
  get chatOpen() { return S.chatOpen; },
  get shopOpen() { return S.shopOpen; },
  get overlayOpen() { return S.stack.length > 0 || S.chatOpen; },

  init(callbacks) {
    S.cb = callbacks || {};
    if (S.built) return; S.built = true;
    const root = S.root = document.getElementById('ui') || document.body.appendChild(h('div', { id: 'ui' }));
    S.el.vhs = h('div', { class: 'fx vhs' });
    root.append(h('div', { class: 'fx grain' }), h('div', { class: 'fx scan' }), S.el.vhs);
    root.append(buildMenu(), buildLobby(), buildEnd(), buildHud(), buildTouch(), buildChat());
    S.el.toasts = h('div', { id: 'toasts' }); S.el.sub = h('div', { id: 'sub', hidden: true }); S.el.count = h('div', { id: 'count', hidden: true }); S.el.err = h('div', { id: 'err', role: 'alert', hidden: true });
    S.el.logpop = h('div', { id: 'logpop', hidden: true });
    S.el.dbgBtn = btn('🛠', 'sm', () => UI.showDebug(true), { hidden: true, title: 'Host cheats', 'aria-label': 'Host cheats' });
    S.el.mini = h('div', { class: 'mini' }, S.el.dbgBtn, btn('⏸', 'sm', () => cb('touch', { type: 'btn', id: 'pause', down: true }), { title: 'Pause (Esc)', 'aria-label': 'Pause' }));
    S.el.connDot = h('span', { class: 'dot connecting' }); S.el.connTxt = h('span', { text: 'connecting' });
    S.el.conn = h('div', { class: 'corner', id: 'conn' }, S.el.connDot, S.el.connTxt, h('span', { text: VERSION }));
    root.append(S.el.toasts, S.el.sub, S.el.count, S.el.err, S.el.logpop, S.el.mini, S.el.conn,
      buildPause(), buildSettings(), buildHelp(), buildCredits(), buildLogs(), buildShop(), buildDebug());
    S.canvas = document.getElementById('game');
    refreshTouch(); UI.applyFilter(S.canvas); UI.menuTip(); S.tipTimer = 0;
    try { matchMedia('(pointer: coarse)').addEventListener('change', refreshTouch); } catch { /* old browsers */ }
    // global keys (capture phase so we can claim Enter / Esc before the game sees them)
    addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (S.chatOpen) { closeChat(); e.stopImmediatePropagation(); e.preventDefault(); return; }
        const top = S.stack[S.stack.length - 1];
        if (top && top !== 'ov-pause') { closeOv(top, true); e.stopImmediatePropagation(); e.preventDefault(); }
        return;
      }
      if (e.key === 'Enter' && !S.chatOpen && !e.repeat) {
        const scr = document.body.dataset.screen, tag = (e.target && e.target.tagName) || '';
        if ((scr === 'game' || scr === 'lobby') && !S.stack.length && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(tag)) { e.stopImmediatePropagation(); e.preventDefault(); openChat(); }
      }
    }, true);
    addEventListener('blur', () => { S.el.chatLog && 0; });
    setInterval(() => { if (document.body.dataset.screen === 'menu' && !document.hidden) UI.menuTip(); }, 6000);
    // chat lines fade after a while
    setInterval(() => { const now = performance.now(); for (const n of S.el.chatLog.children) if (now - n._at > 9000) n.classList.add('old'); }, 1000);
  },

  screen(name) {
    document.body.dataset.screen = name;
    const l = document.getElementById('loading'); if (l) l.classList.toggle('gone', name !== 'loading');
    if (name !== 'end') { clearTimeout(S.rateTimer); document.querySelectorAll('.rate').forEach(n => n.remove()); }
    if (name === 'menu') {
      const c = inviteCode(); S.el.invite.hidden = !c; if (c) { S.el.invite.textContent = 'Join room ' + c; if (!S.el.code.value) { S.el.code.value = c; S.el.code.dispatchEvent(new Event('input')); } }
      if (!S.el.name.value) S.el.name.value = S.settings.name;
    }
    if (name === 'lobby') renderLobby();
    if (name !== 'game') { S.el.sub.hidden = true; S.el.logpop.hidden = true; }
    if (name !== 'game' && name !== 'lobby') closeChat();
    if (name === 'game') { UI.countdown(0); }
    S.root && S.root.classList.toggle('in-game', name === 'game');
  },
  setConn(status) {
    if (!S.el.connDot) return;
    S.el.connDot.className = 'dot ' + (status === 'online' ? 'online' : status === 'offline' ? 'offline' : 'connecting');
    S.el.connTxt.textContent = status === 'online' ? 'online' : status === 'offline' ? 'offline' : 'connecting…';
  },
  error(msg) {
    const e = S.el.err; e.replaceChildren(h('span', { text: String(msg || 'Something went wrong.') }), h('button', { type: 'button', text: '×', 'aria-label': 'Dismiss', onclick: () => { e.hidden = true; } }));
    e.hidden = false; clearTimeout(S.errT); S.errT = setTimeout(() => { e.hidden = true; }, 6000);
  },
  setRoom(room, youId) { S.room = room; S.youId = youId; renderLobby(); if (S.paused === false && document.body.dataset.screen === 'game') { /* nothing: game screen ignores room changes */ } },
  setHats(list) { if (Array.isArray(list) && list.length) { S.hats = list.slice(); S.hatBtns.forEach(f => f()); } },
  countdown(n) {
    const c = S.el.count; clearTimeout(S.countT);
    if (!n) { c.hidden = true; return; }
    c.hidden = false; c.classList.remove('pop'); c.replaceChildren(h('span', { text: String(n) })); void c.offsetWidth; c.classList.add('pop');
    S.countT = setTimeout(() => { c.hidden = true; }, 1600);
  },
  hud(s) { updateHud(s); },
  subtitle(text, ms) {
    const el = S.el.sub; if (!S.settings.subs || !text) { el.hidden = true; return; }
    el.replaceChildren(h('span', { text: String(text) })); el.hidden = false; clearTimeout(S.subT); S.subT = setTimeout(() => { el.hidden = true; }, ms || 4000);
  },
  toast(text, kind) {
    const t = h('div', { class: 'toast ' + (kind || 'info'), text: String(text), role: 'status' }); S.el.toasts.append(t);
    while (S.el.toasts.children.length > 6) S.el.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3600);
  },
  logEntry(e) {
    if (!e) return;
    if (!S.logs.some(l => l.n === e.n && l.title === e.title)) S.logs.push({ title: String(e.title || 'Untitled'), text: String(e.text || ''), n: e.n | 0 });
    const p = S.el.logpop; clearTimeout(S.logT);
    p.replaceChildren(h('div', { class: 'hd' }, h('span', { class: 'rec', text: '● REC' }), h('span', { text: `INCIDENT LOG ${String(e.n | 0).padStart(2, '0')}${e.total ? '/' + e.total : ''}` })), h('h4', { text: String(e.title || '') }), h('p', { text: String(e.text || '') }));
    p.onclick = () => { p.hidden = true; }; p.hidden = false; S.logT = setTimeout(() => { p.hidden = true; }, 9000);
  },
  chat(line) {
    if (!line) return;
    const n = h('div', { class: 'cl' + (line.global ? ' g' : '') }, h('b', { text: String(line.name || '?') + ': ' }), h('span', { text: String(line.text || '') })); n._at = performance.now();
    S.el.chatLog.append(n); while (S.el.chatLog.children.length > 7) S.el.chatLog.firstChild.remove();
  },
  showEnd(end) {
    const E = S.el['scr-end'] || (S.el['scr-end'] = document.getElementById('scr-end')); if (!end) return;
    const r = S.room, me = (end.players || []).find(p => p.id === S.youId), youMon = !!(me && me.role === 'monster'), monMode = !!(r && r.settings && r.settings.mode === 'monster');
    let kind = end.result === 'secret' ? 'secret' : end.win ? 'win' : 'lose', title = kind === 'secret' ? 'The 67/10' : kind === 'win' ? 'Respect Boundaries' : 'Cooked', epi = EPI[kind];
    if (monMode && youMon) { if (end.monsterWon) { kind = 'win'; title = 'The Last Bell Tolls'; epi = EPI.monsterWin; } else { kind = 'lose'; title = 'Rung Out'; epi = 'The survivors collected every Seal and made it to sunrise. The Last Bell goes back to being a very large, very sad bell.'; } }
    else if (monMode && end.monsterWon) { title = 'Cooked'; epi = EPI.monsterWin; }
    const host = !!(r && r.host === S.youId), players = end.players || [];
    const cols = [['hits', 'Hits'], ['revives', 'Revives'], ['picks', 'Picks'], ['logs', 'Logs'], ['s67', '67s'], ['perfect', 'Perfect'], ['throws', 'Throws']];
    const tot = {}; for (const [k] of cols) tot[k] = players.reduce((a, p) => a + ((p.stats && p.stats[k]) | 0), 0);
    const tbl = h('table', { class: 'stats' }, h('thead', null, h('tr', null, h('th', { text: 'Player' }), cols.map(([, l]) => h('th', { text: l })))),
      h('tbody', null, players.map(p => h('tr', null, h('td', { text: (p.role === 'monster' ? '🔔 ' : '') + p.name + (p.id === S.youId ? ' (you)' : '') }), cols.map(([k]) => h('td', { text: String((p.stats && p.stats[k]) | 0) })))),
        h('tr', { style: 'font-weight:800' }, h('td', { text: 'Team' }), cols.map(([k]) => h('td', { text: String(tot[k]) })))));
    const acts = [];
    if (end.canRetry && host) acts.push(btn('Retry from checkpoint', 'pri big', () => cb('retry')));
    if (host) acts.push(btn('Back to lobby', '', () => cb('lobby'))); else acts.push(h('span', { class: 'dim', text: 'Waiting for the host…', style: 'align-self:center' }));
    acts.push(btn('Leave', 'ghost', () => cb('leave')));
    E.replaceChildren(h('div', { class: 'wrap', style: 'max-width:820px' },
      h('div', { class: 'end-head ' + kind }, h('h1', { text: title }), h('p', { text: epi })),
      h('div', { class: 'panel' }, h('div', { class: 'bigstats' },
        h('div', { class: 'bs' }, h('b', { text: fmtTime(end.time) }), h('span', { text: 'Time' })), h('div', { class: 'bs' }, h('b', { text: (end.seals | 0) + '/5' }), h('span', { text: 'Seals' })),
        h('div', { class: 'bs' }, h('b', { text: (end.logs | 0) + '/15' }), h('span', { text: 'Logs' })), h('div', { class: 'bs' }, h('b', { text: (end.s67 | 0) + '/15' }), h('span', { text: '67s' })),
        h('div', { class: 'bs' }, h('b', { text: '🪙' + (end.coins | 0) }), h('span', { text: 'Coins left' })))),
      h('div', { class: 'panel' }, h('div', { class: 'tblwrap' }, tbl), end.cheated ? h('div', { class: 'small dim', style: 'margin-top:8px', text: 'This run used host cheats.' }) : null),
      kind === 'lose' && !(monMode && youMon) ? h('div', { class: 'deathtip', text: DEATH_TIPS[Math.floor(Math.random() * DEATH_TIPS.length)] }) : null,
      h('div', { class: 'row', style: 'justify-content:center' }, acts)));
    E.scrollTop = 0;
    clearTimeout(S.rateTimer); document.querySelectorAll('.rate').forEach(n => n.remove());
    if (title === 'Cooked') S.rateTimer = setTimeout(() => { if (document.body.dataset.screen === 'end') S.root.append(rateCard()); }, 3000);
    UI.screen('end');
  },
  pause(on) { if (on) { S.paused = true; openOv('ov-pause'); } else { closeOv('ov-pause'); S.paused = false; } },
  isPaused() { return S.paused; },
  shop(open, data) {
    if (data) S.lastShop = data;
    if (open) { S.shopOpen = true; renderShop(); openOv('ov-shop'); } else if (S.shopOpen) { S.shopOpen = false; closeOv('ov-shop'); }
    else if (data && S.el['ov-shop'].classList.contains('on')) renderShop();
  },
  getSettings() { return S.settings; },
  openSettings(on) { if (on) openOv('ov-settings'); else closeOv('ov-settings'); },
  showDebug(on) { if (on) openOv('ov-debug'); else closeOv('ov-debug'); },
  applyFilter(canvas) {
    const c = canvas || S.canvas || document.getElementById('game'); if (canvas) S.canvas = canvas; if (!c) return;
    c.classList.remove('f-vhs', 'f-sepia', 'f-pixel'); const f = S.settings.filter; if (f !== 'none') c.classList.add('f-' + f);
    if (S.el.vhs) S.el.vhs.classList.toggle('on', f === 'vhs');
  },
  menuTip() {
    if (!S.el.tip) return; S.tipI = (S.tipI + 1) % TIPS.length;
    S.el.tip.replaceChildren(h('b', { text: 'Night shift tip' }), h('br'), TIPS[S.tipI]);
  },
};
export default UI;
