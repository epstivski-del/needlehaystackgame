// NIGHT SHIFT: THE LAST BELL — procedural audio. Zero assets: everything is synthesized with the Web Audio API.
// Graph: sources -> (music bus | sfx bus) -> master -> compressor -> destination. Music bus has a lowpass for "underwater".
// Every public method is a safe no-op when AudioContext is unavailable and never throws.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const MAXV = 40;                       // cap on simultaneous one-shot oscillators / noise sources

let ctx = null, tried = false;
let master, comp, musicBus, sfxBus, musicLP, revIn, noiseBuf, pinkBuf, timer = null;
let voices = 0;
const vol = { master: 0.8, music: 0.6, sfx: 0.9 };
const L = { x: 0, z: 0, yaw: 0 };
let wantZone = null, wantBoss = false, wantLaugh = 0;

// ------------------------------------------------------------------ low level helpers
function applyVol() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(vol.master, t, 0.03);
  musicBus.gain.setTargetAtTime(vol.music, t, 0.03);
  sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
}

function makeBuffers() {
  const sr = ctx.sampleRate || 44100;
  noiseBuf = ctx.createBuffer(1, sr * 2, sr);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  pinkBuf = ctx.createBuffer(1, sr * 4, sr);
  const p = pinkBuf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < p.length; i++) {            // Paul Kellet pink-noise filter
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
}

// Cheap reverb: four feedback delays with damping, summed.
function makeReverb() {
  revIn = ctx.createGain(); revIn.gain.value = 1;
  const out = ctx.createGain(); out.gain.value = 0.55;
  for (const dt of [0.037, 0.053, 0.071, 0.097]) {
    const d = ctx.createDelay(0.5); d.delayTime.value = dt;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const fb = ctx.createGain(); fb.gain.value = 0.5;
    revIn.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(out);
  }
  out.connect(sfxBus);
}

const envG = (g, t, a, hold, dur, v) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(v, 0.0002), t + a);
  if (hold) g.gain.setValueAtTime(Math.max(v, 0.0002), t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + dur);
};
function sendRev(g, amt) { if (!amt) return; const s = ctx.createGain(); s.gain.value = amt; g.connect(s); s.connect(revIn); }
function endVoice(src, ...nodes) { voices++; src.onended = () => { voices--; for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } }; }

let wobG = null;   // radio tape wobble (cents) shared LFO output

// Oscillator one-shot. p: type f f2 fd dur a hold vol lp|hp|bp lp2 q det vib[rate,depthHz] rv wob
function tone(dest, t, p) {
  if (voices >= MAXV) return null;
  const o = ctx.createOscillator(); o.type = p.type || 'sine';
  const dur = p.dur || 0.2, a = p.a ?? 0.005, hold = p.hold || 0, f = p.f || 440;
  o.frequency.setValueAtTime(f, t);
  if (p.f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, p.f2), t + (p.fd || a + hold + dur));
  if (p.det) o.detune.value = p.det;
  const g = ctx.createGain(); envG(g, t, a, hold, dur, p.vol ?? 0.2);
  let head = o, flt = null;
  const ft = p.lp ? 'lowpass' : p.hp ? 'highpass' : p.bp ? 'bandpass' : null;
  if (ft) {
    flt = ctx.createBiquadFilter(); flt.type = ft; const f0 = p.lp || p.hp || p.bp; flt.frequency.setValueAtTime(f0, t); flt.Q.value = p.q ?? 0.8;
    if (p.lp2) flt.frequency.exponentialRampToValueAtTime(p.lp2, t + a + hold + dur);
    o.connect(flt); flt.connect(g); head = flt;
  } else o.connect(g);
  void head;
  g.connect(dest); sendRev(g, p.rv);
  const end = t + a + hold + dur + 0.05;
  let lf = null, lg = null;
  if (p.vib) { lf = ctx.createOscillator(); lf.frequency.value = p.vib[0]; lg = ctx.createGain(); lg.gain.value = p.vib[1]; lf.connect(lg); lg.connect(o.frequency); lf.start(t); lf.stop(end); }
  let wg = null;
  if (p.wob && wobG) { wg = wobG; try { wg.connect(o.detune); } catch { wg = null; } }
  o.start(t); o.stop(end);
  endVoice(o, g, flt, lg, ...(wg ? [{ disconnect: () => wg.disconnect(o.detune) }] : []));
  return o;
}

// Noise one-shot. p: dur a hold vol ft(lowpass|highpass|bandpass) f f2 q pink
function noise(dest, t, p) {
  if (voices >= MAXV) return null;
  const dur = p.dur || 0.2, a = p.a ?? 0.005, hold = p.hold || 0, total = a + hold + dur;
  const s = ctx.createBufferSource(); s.buffer = p.pink ? pinkBuf : noiseBuf;
  const bl = s.buffer.duration; if (total + 0.1 > bl) s.loop = true;
  const g = ctx.createGain(); envG(g, t, a, hold, dur, p.vol ?? 0.2);
  let flt = null;
  if (p.f) {
    flt = ctx.createBiquadFilter(); flt.type = p.ft || 'lowpass'; flt.frequency.setValueAtTime(p.f, t); flt.Q.value = p.q ?? 0.8;
    if (p.f2) flt.frequency.exponentialRampToValueAtTime(p.f2, t + total);
    s.connect(flt); flt.connect(g);
  } else s.connect(g);
  g.connect(dest); sendRev(g, p.rv);
  s.start(t, s.loop ? 0 : rnd(0, Math.max(0, bl - total - 0.05))); s.stop(t + total + 0.05);
  endVoice(s, g, flt);
  return s;
}

// Distance + pan routing for positional one-shots. Returns the node to connect into, or null when out of earshot.
function route(o) {
  if (!ctx) return null;
  if (!o || o.x == null || o.z == null) return sfxBus;
  const dx = o.x - L.x, dz = o.z - L.z, d = Math.hypot(dx, dz);
  if (d > 95) return null;
  const att = 1 / (1 + d / 7);
  const g = ctx.createGain(); g.gain.value = att;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(18000 / (1 + d / 10), 700, 18000);
  g.connect(lp);
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    const pan = d < 0.6 ? 0 : (dx * Math.cos(L.yaw) + dz * -Math.sin(L.yaw)) / d;
    p.pan.value = clamp(pan * 0.9, -1, 1); lp.connect(p); p.connect(sfxBus);
  } else lp.connect(sfxBus);
  return g;
}

// ------------------------------------------------------------------ one-shot effects (d = dest, t = start, v = volume, r = rate)
const laughBurst = (d, t, v, n = 4) => {
  for (let i = 0; i < n; i++) {
    const ti = t + i * 0.17, f = rnd(170, 250) * (1 - i * 0.05);
    tone(d, ti, { type: 'sawtooth', f, f2: f * 0.8, dur: 0.13, a: 0.012, vol: 0.09 * v, bp: 800, q: 1.4 });
    noise(d, ti, { ft: 'bandpass', f: 1500, q: 2, dur: 0.11, a: 0.012, vol: 0.06 * v });
  }
};
const chime = (d, t, f, v, dur = 0.5, rv = 0) => {
  tone(d, t, { type: 'sine', f, dur, vol: 0.2 * v, rv });
  tone(d, t, { type: 'sine', f: f * 2.01, dur: dur * 0.5, vol: 0.07 * v, rv });
};
const bellHit = (d, t, v, r, dur = 2.6, rv = 0.5) => {
  const f0 = 196 * r;
  [[0.5, 1, 1], [1, 0.9, 0.9], [1.19, 0.55, 0.7], [1.5, 0.4, 0.55], [2, 0.5, 0.45], [2.5, 0.25, 0.3], [3.01, 0.2, 0.25], [4.1, 0.15, 0.15]]
    .forEach(([m, a, k]) => tone(d, t, { type: 'sine', f: f0 * m * (1 + rnd(-0.002, 0.002)), dur: dur * k, a: 0.003, vol: 0.14 * a * v, rv }));
  noise(d, t, { ft: 'bandpass', f: 2500, q: 1, dur: 0.05, vol: 0.12 * v });
};

const SFX = {
  pickup: (d, t, v, r) => { tone(d, t, { type: 'triangle', f: 660 * r, f2: 880 * r, fd: 0.07, dur: 0.12, vol: 0.25 * v }); tone(d, t + 0.07, { type: 'triangle', f: 1100 * r, dur: 0.16, vol: 0.22 * v }); },
  coin: (d, t, v, r) => { tone(d, t, { type: 'square', f: 988 * r, dur: 0.07, vol: 0.1 * v, lp: 5000 }); tone(d, t + 0.06, { type: 'square', f: 1319 * r, dur: 0.35, vol: 0.1 * v, lp: 6000 }); tone(d, t + 0.06, { f: 2638 * r, dur: 0.4, vol: 0.05 * v }); },
  battery: (d, t, v, r) => { noise(d, t, { ft: 'highpass', f: 3000, dur: 0.03, vol: 0.2 * v }); tone(d, t + 0.03, { type: 'sawtooth', f: 200 * r, f2: 520 * r, dur: 0.18, vol: 0.12 * v, lp: 1400 }); tone(d, t + 0.2, { type: 'triangle', f: 880 * r, dur: 0.2, vol: 0.18 * v }); },
  snack: (d, t, v, r) => { for (let i = 0; i < 4; i++) noise(d, t + i * 0.07, { ft: 'bandpass', f: rnd(2200, 3200) * r, q: 1.2, dur: 0.05, vol: 0.25 * v }); tone(d, t + 0.3, { type: 'triangle', f: 520 * r, f2: 780 * r, dur: 0.15, vol: 0.12 * v }); },
  throw: (d, t, v, r) => { noise(d, t, { ft: 'bandpass', f: 500 * r, f2: 2200 * r, q: 1.5, dur: 0.22, a: 0.06, vol: 0.28 * v }); },
  impact: (d, t, v, r) => { tone(d, t, { f: 140 * r, f2: 45, dur: 0.22, vol: 0.4 * v }); noise(d, t, { ft: 'lowpass', f: 900, dur: 0.12, vol: 0.3 * v }); },
  land: (d, t, v, r) => { tone(d, t, { f: 95 * r, f2: 40, dur: 0.25, vol: 0.3 * v }); noise(d, t, { ft: 'lowpass', f: 500, dur: 0.15, vol: 0.2 * v }); },
  door: (d, t, v, r) => { tone(d, t, { type: 'sawtooth', f: 150 * r, f2: 95 * r, dur: 0.55, a: 0.08, vol: 0.1 * v, bp: 500, q: 4, vib: [11, 8] }); noise(d, t + 0.55, { ft: 'highpass', f: 2000, dur: 0.04, vol: 0.2 * v }); tone(d, t + 0.57, { type: 'square', f: 180, f2: 90, dur: 0.06, vol: 0.18 * v, lp: 900 }); },
  gate: (d, t, v, r) => { [310, 467, 711, 1180].forEach((f, i) => tone(d, t, { type: 'square', f: f * r, dur: 0.5 - i * 0.07, vol: 0.07 * v, lp: 3000, rv: 0.3 })); noise(d, t, { ft: 'bandpass', f: 1800, dur: 0.08, vol: 0.2 * v }); tone(d, t, { f: 70, f2: 40, dur: 0.3, vol: 0.3 * v }); },
  chain: (d, t, v, r) => { let x = 0; for (let i = 0; i < 9; i++) { x += rnd(0.03, 0.08); noise(d, t + x, { ft: 'highpass', f: 4200, dur: 0.05, vol: 0.14 * v }); tone(d, t + x, { type: 'square', f: rnd(2400, 3600) * r, dur: 0.05, vol: 0.04 * v }); } tone(d, t + x, { type: 'sine', f: 1900 * r, dur: 0.5, vol: 0.1 * v, rv: 0.3 }); },
  hit: (d, t, v, r) => { noise(d, t, { ft: 'lowpass', f: 700, dur: 0.18, vol: 0.4 * v }); tone(d, t, { f: 110 * r, f2: 38, dur: 0.3, vol: 0.45 * v }); tone(d, t, { type: 'sawtooth', f: 230, f2: 110, dur: 0.15, vol: 0.14 * v, lp: 1400 }); },
  down: (d, t, v) => { tone(d, t, { f: 170, f2: 35, dur: 1.0, vol: 0.45 * v }); noise(d, t, { ft: 'lowpass', f: 1500, f2: 120, dur: 1.0, vol: 0.2 * v }); tone(d, t + 0.1, { f: 3100, dur: 1.6, a: 0.3, vol: 0.025 * v }); },
  revive: (d, t, v, r) => { [392, 494, 587, 784].forEach((f, i) => tone(d, t + i * 0.09, { type: 'triangle', f: f * r, dur: 0.3, vol: 0.18 * v, rv: 0.2 })); },
  shield: (d, t, v, r) => { tone(d, t, { f: 1200 * r, f2: 2400 * r, dur: 0.4, vol: 0.12 * v, vib: [14, 40] }); [880, 1108, 1318].forEach(f => tone(d, t + 0.05, { type: 'triangle', f: f * r, dur: 0.6, vol: 0.09 * v, rv: 0.4 })); },
  seal: (d, t, v, r) => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => { tone(d, t + i * 0.1, { type: 'sawtooth', f: f * r, dur: 0.5, vol: 0.07 * v, lp: 2600, rv: 0.35 }); tone(d, t + i * 0.1, { type: 'triangle', f: f * r, dur: 0.6, vol: 0.14 * v }); });
    [523, 659, 784, 1047].forEach(f => tone(d, t + 0.55, { type: 'triangle', f: f * r, dur: 1.6, a: 0.02, vol: 0.1 * v, rv: 0.5 }));
    bellHit(d, t + 0.55, 0.6 * v, r * 1.5, 2.2, 0.6);
  },
  log: (d, t, v, r) => { noise(d, t, { ft: 'bandpass', f: 3500, q: 0.7, dur: 0.18, a: 0.05, vol: 0.18 * v }); chime(d, t + 0.14, 880 * r, 0.6 * v, 0.4, 0.3); chime(d, t + 0.28, 1175 * r, 0.6 * v, 0.5, 0.3); },
  s67: (d, t, v, r) => { [523, 587, 523, 659, 784, 659, 1047].forEach((f, i) => tone(d, t + i * 0.075, { type: 'square', f: f * r, dur: 0.1, vol: 0.09 * v, lp: 3500 })); },
  click: (d, t, v, r) => { tone(d, t, { type: 'square', f: 1800 * r, dur: 0.02, vol: 0.1 * v, lp: 5000 }); noise(d, t, { ft: 'highpass', f: 4000, dur: 0.012, vol: 0.12 * v }); },
  buy: (d, t, v, r) => { noise(d, t, { ft: 'highpass', f: 5000, dur: 0.03, vol: 0.15 * v }); tone(d, t + 0.03, { type: 'triangle', f: 1568 * r, dur: 0.4, vol: 0.2 * v }); tone(d, t + 0.12, { type: 'triangle', f: 2093 * r, dur: 0.6, vol: 0.2 * v, rv: 0.2 }); },
  fail: (d, t, v, r) => { tone(d, t, { type: 'sawtooth', f: 220 * r, dur: 0.12, vol: 0.14 * v, lp: 900 }); tone(d, t + 0.14, { type: 'sawtooth', f: 165 * r, dur: 0.22, vol: 0.14 * v, lp: 800 }); },
  scare: (d, t, v) => {
    tone(d, t, { type: 'sawtooth', f: 220, f2: 330, dur: 0.5, a: 0.4, vol: 0.12 * v, lp: 900, lp2: 3200, rv: 0.5 });
    tone(d, t, { type: 'sawtooth', f: 311, f2: 466, dur: 0.5, a: 0.4, vol: 0.1 * v, lp: 900, lp2: 3000, rv: 0.5 });
    noise(d, t, { ft: 'bandpass', f: 800, f2: 4000, q: 2, dur: 0.4, a: 0.35, vol: 0.22 * v });
    const h = t + 0.55; tone(d, h, { f: 65, f2: 30, dur: 0.7, vol: 0.55 * v }); noise(d, h, { ft: 'lowpass', f: 2500, dur: 0.4, vol: 0.4 * v, rv: 0.5 });
    tone(d, h, { type: 'sawtooth', f: 233, dur: 0.8, vol: 0.14 * v, lp: 1500, rv: 0.6 }); tone(d, h, { type: 'sawtooth', f: 330, dur: 0.8, vol: 0.12 * v, lp: 1500, rv: 0.6 });
  },
  handshake: (d, t, v, r) => { tone(d, t, { type: 'sawtooth', f: 130 * r, f2: 55, dur: 0.6, vol: 0.2 * v, lp: 1600, lp2: 200, q: 9, vib: [26, 18] }); noise(d, t, { ft: 'bandpass', f: 600, f2: 200, q: 5, dur: 0.5, vol: 0.18 * v }); tone(d, t + 0.1, { f: 400, f2: 1800, dur: 1.2, a: 0.5, vol: 0.05 * v, rv: 0.4 }); },
  drag: (d, t, v) => { noise(d, t, { ft: 'lowpass', f: 400, f2: 120, dur: 1.2, a: 0.1, vol: 0.3 * v }); for (let i = 0; i < 6; i++) tone(d, t + rnd(0, 1.1), { f: rnd(300, 600), f2: rnd(800, 1400), dur: 0.08, vol: 0.1 * v }); },
  laugh: (d, t, v) => laughBurst(d, t, v, 5),
  bell: (d, t, v, r) => bellHit(d, t, v, r),
  splash: (d, t, v, r) => { noise(d, t, { ft: 'bandpass', f: 1400 * r, f2: 350, q: 0.9, dur: 0.5, a: 0.02, vol: 0.3 * v }); for (let i = 0; i < 4; i++) tone(d, t + rnd(0.05, 0.4), { f: rnd(400, 700), f2: rnd(900, 1500), dur: 0.07, vol: 0.07 * v }); },
  crash: (d, t, v, r) => { noise(d, t, { ft: 'lowpass', f: 4000, f2: 600, dur: 0.5, vol: 0.4 * v }); [260, 410, 650].forEach(f => tone(d, t, { type: 'square', f: f * r, dur: 0.35, vol: 0.06 * v, lp: 2500 })); tone(d, t, { f: 80, f2: 35, dur: 0.35, vol: 0.4 * v }); },
  toast: (d, t, v, r) => { tone(d, t, { type: 'square', f: 300, dur: 0.03, vol: 0.12 * v, lp: 1500 }); tone(d, t + 0.05, { type: 'triangle', f: 2093 * r, dur: 0.9, vol: 0.2 * v, rv: 0.3 }); tone(d, t + 0.05, { f: 3136 * r, dur: 0.6, vol: 0.07 * v }); },
  perfect: (d, t, v, r) => { [880, 1320, 1760].forEach((f, i) => tone(d, t + i * 0.05, { type: 'triangle', f: f * r, dur: 0.3, vol: 0.16 * v })); tone(d, t + 0.1, { f: 2640 * r, dur: 0.4, vol: 0.06 * v, rv: 0.3 }); },
  good: (d, t, v, r) => { tone(d, t, { type: 'triangle', f: 660 * r, dur: 0.14, vol: 0.18 * v }); tone(d, t + 0.07, { type: 'triangle', f: 880 * r, dur: 0.2, vol: 0.18 * v }); },
  miss: (d, t, v, r) => { tone(d, t, { type: 'sawtooth', f: 110 * r, f2: 80 * r, dur: 0.18, vol: 0.14 * v, lp: 500 }); },
  bossRoar: (d, t, v) => {
    [0, 7, -9].forEach(c => tone(d, t, { type: 'sawtooth', f: 72, f2: 38, dur: 1.5, a: 0.1, vol: 0.2 * v, det: c * 10, lp: 400, lp2: 1100, q: 3, vib: [28, 6], rv: 0.4 }));
    noise(d, t, { ft: 'lowpass', f: 700, f2: 200, dur: 1.5, a: 0.1, vol: 0.35 * v, rv: 0.4 }); tone(d, t, { f: 50, f2: 28, dur: 1.4, vol: 0.4 * v });
  },
  cheer: (d, t, v) => { noise(d, t, { ft: 'bandpass', f: 1500, q: 0.8, dur: 1.3, a: 0.3, vol: 0.2 * v, pink: true }); for (let i = 0; i < 6; i++) tone(d, t + rnd(0, 0.5), { type: 'sawtooth', f: rnd(220, 380), f2: rnd(300, 520), dur: 0.7, a: 0.1, vol: 0.04 * v, bp: 1000, q: 1.5 }); },
  ping: (d, t, v, r) => { tone(d, t, { f: 1400 * r, dur: 0.45, vol: 0.2 * v, rv: 0.4 }); tone(d, t + 0.12, { f: 1400 * r, dur: 0.3, vol: 0.08 * v, rv: 0.4 }); },
  chat: (d, t, v, r) => { tone(d, t, { type: 'triangle', f: 880 * r, dur: 0.07, vol: 0.1 * v }); tone(d, t + 0.07, { type: 'triangle', f: 1175 * r, dur: 0.1, vol: 0.1 * v }); },
  radioSwitch: (d, t, v) => { noise(d, t, { ft: 'bandpass', f: 800, f2: 3500, q: 3, dur: 0.22, vol: 0.2 * v }); tone(d, t + 0.2, { type: 'square', f: 660, dur: 0.05, vol: 0.06 * v, lp: 2500 }); },
  engine: (d, t, v, r) => { tone(d, t, { type: 'sawtooth', f: 60 * r, f2: 150 * r, dur: 1.0, a: 0.05, vol: 0.18 * v, lp: 500, lp2: 1200, vib: [22, 5] }); noise(d, t, { ft: 'lowpass', f: 800, dur: 1.0, vol: 0.12 * v }); },
  sneeze: (d, t, v, r) => { noise(d, t, { ft: 'highpass', f: 2500, dur: 0.16, a: 0.14, vol: 0.18 * v }); noise(d, t + 0.3, { ft: 'bandpass', f: 3000 * r, q: 1, dur: 0.1, vol: 0.3 * v }); tone(d, t + 0.3, { f: 900 * r, f2: 300, dur: 0.15, vol: 0.12 * v }); },
  countdown: (d, t, v, r) => { tone(d, t, { f: 880 * r, dur: 0.15, vol: 0.22 * v }); },
  whoosh: (d, t, v, r) => { noise(d, t, { ft: 'bandpass', f: 300 * r, f2: 3000 * r, q: 1.2, dur: 0.3, a: 0.12, vol: 0.28 * v }); },
  loafSigh: (d, t, v, r) => { tone(d, t, { type: 'triangle', f: 230 * r, f2: 150 * r, dur: 1.4, a: 0.25, vol: 0.14 * v, lp: 700, vib: [5, 4] }); noise(d, t, { ft: 'lowpass', f: 900, f2: 300, dur: 1.4, a: 0.3, vol: 0.12 * v }); },
  loafStep: (d, t, v, r) => { tone(d, t, { f: 70 * r, f2: 32, dur: 0.4, vol: 0.5 * v }); noise(d, t, { ft: 'lowpass', f: 300, dur: 0.25, vol: 0.3 * v }); tone(d, t + 0.05, { f: 140 * r, f2: 70, dur: 0.2, vol: 0.12 * v, lp: 400 }); },
  buzz: (d, t, v, r) => { for (let i = 0; i < 3; i++) { const ti = t + i * 0.045; tone(d, ti, { type: 'sawtooth', f: 100 * r, dur: 0.035, vol: 0.13 * v, hp: 300 }); noise(d, ti, { ft: 'highpass', f: 5000, dur: 0.03, vol: 0.15 * v }); } },
};

// ------------------------------------------------------------------ footsteps
let stepAlt = 0;
const STEP = {
  tile: (d, t, v, sp) => { stepAlt ^= 1; tone(d, t, { type: 'sine', f: (stepAlt ? 1900 : 1500) * sp, f2: 1000, dur: 0.03, vol: 0.12 * v }); noise(d, t, { ft: 'highpass', f: 2500, dur: 0.03, vol: 0.14 * v }); },
  timber: (d, t, v, sp) => { tone(d, t, { f: 120 * sp, f2: 65, dur: 0.13, vol: 0.32 * v }); noise(d, t, { ft: 'lowpass', f: 600, dur: 0.09, vol: 0.16 * v }); if (Math.random() < 0.25) tone(d, t + 0.02, { type: 'sawtooth', f: rnd(280, 330), f2: 200, dur: 0.16, vol: 0.05 * v, bp: 700, q: 4 }); },
  grass: (d, t, v) => { noise(d, t, { ft: 'bandpass', f: 3500, q: 0.5, dur: 0.12, a: 0.03, vol: 0.12 * v }); },
  sprinkle: (d, t, v) => { for (let i = 0; i < 5; i++) noise(d, t + i * rnd(0.01, 0.03), { ft: 'highpass', f: rnd(4000, 6500), dur: 0.012, vol: 0.12 * v }); noise(d, t, { ft: 'lowpass', f: 500, dur: 0.05, vol: 0.06 * v }); },
  concrete: (d, t, v, sp) => { noise(d, t, { ft: 'bandpass', f: 1500, q: 0.8, dur: 0.07, vol: 0.2 * v }); tone(d, t, { f: 200 * sp, f2: 120, dur: 0.06, vol: 0.1 * v }); },
  water: (d, t, v) => { noise(d, t, { ft: 'lowpass', f: 1500, f2: 400, dur: 0.32, a: 0.02, vol: 0.22 * v }); tone(d, t + 0.05, { f: 500, f2: 900, dur: 0.12, vol: 0.05 * v }); },
  carpet: (d, t, v, sp) => { tone(d, t, { f: 90 * sp, f2: 60, dur: 0.09, vol: 0.18 * v }); noise(d, t, { ft: 'lowpass', f: 300, dur: 0.07, vol: 0.1 * v }); },
};

// ------------------------------------------------------------------ ambient zone beds
let bed = null, curZone = null;
function makeBed(id) {
  const g = ctx.createGain(); g.gain.value = 0; g.connect(musicBus);
  const B = { id, g, srcs: [], next: 0, sched: null };
  const O = (type, f, v, o = {}) => {
    const os = ctx.createOscillator(); os.type = type; os.frequency.value = f; if (o.det) os.detune.value = o.det;
    const og = ctx.createGain(); og.gain.value = v; let head = os;
    if (o.lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; os.connect(fl); head = fl; }
    head.connect(og); og.connect(o.dest || g); os.start(); B.srcs.push(os); return og;
  };
  const N = (v, ft, f, q, pink = true, dest) => {
    const s = ctx.createBufferSource(); s.buffer = pink ? pinkBuf : noiseBuf; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = ft; fl.frequency.value = f; fl.Q.value = q;
    const ng = ctx.createGain(); ng.gain.value = v; s.connect(fl); fl.connect(ng); ng.connect(dest || g); s.start(0, rnd(0, 1)); B.srcs.push(s); return { g: ng, f: fl };
  };
  const LF = (rate, depth, param, type = 'sine') => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = rate; const lg = ctx.createGain(); lg.gain.value = depth; o.connect(lg); lg.connect(param); o.start(); B.srcs.push(o); };
  const every = (lo, hi, fn) => { B.sched = (until, now) => { if (B.next < now - 2) B.next = now + rnd(lo, hi) * 0.3; while (B.next < until) { fn(B.next); B.next += rnd(lo, hi); } }; };
  switch (id) {
    case 'safe': {
      O('sine', 110, 0.16, { lp: 500 }); O('sine', 110.8, 0.12); O('sine', 220, 0.04);
      const pg = ctx.createGain(); pg.gain.value = 0.07; pg.connect(g);
      const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 900; pf.connect(pg);
      for (const [f, c] of [[220, -6], [277.2, 5], [329.6, -3]]) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = c; o.connect(pf); o.start(); B.srcs.push(o); }
      LF(0.07, 0.04, pg.gain);
      break;
    }
    case 'night': {
      const w = N(0.35, 'bandpass', 420, 0.7); LF(0.1, 220, w.f.frequency); LF(0.13, 0.15, w.g.gain);
      O('sine', 55, 0.14); O('sawtooth', 55.4, 0.03, { lp: 180 });
      every(3, 8, t => { const f = rnd(3900, 4500), n = 3 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(g, t + i * 0.07, { f, dur: 0.035, a: 0.004, vol: 0.02 }); });
      break;
    }
    case 'sugar': {
      N(0.12, 'lowpass', 500, 0.5); O('sine', 130, 0.1); O('sine', 195.4, 0.07); O('sine', 98, 0.07);
      const sc = [784, 880, 988, 1175, 1319, 1568];
      every(0.4, 1.4, t => { let f = pick(sc); if (Math.random() < 0.12) f *= 1.06; tone(g, t, { f, dur: 0.9, vol: 0.05, rv: 0.4 }); tone(g, t, { f: f * 1.004, dur: 0.7, vol: 0.04, rv: 0.4 }); tone(g, t, { f: f * 2.7, dur: 0.2, vol: 0.012 }); });
      break;
    }
    case 'fog': {
      const n = N(0.16, 'bandpass', 600, 0.6); LF(0.08, 250, n.f.frequency); LF(0.11, 0.1, n.g.gain);
      O('sine', 49, 0.1);
      every(9, 14, t => { tone(g, t, { type: 'sawtooth', f: 98, dur: 2.6, a: 0.5, hold: 0.8, vol: 0.14, lp: 300, rv: 0.5 }); tone(g, t, { type: 'sawtooth', f: 98.6, dur: 2.6, a: 0.5, hold: 0.8, vol: 0.1, lp: 280, rv: 0.5 }); noise(g, t, { ft: 'bandpass', f: 500, q: 1, dur: 2.0, a: 0.8, vol: 0.06 }); });
      break;
    }
    case 'bread': {
      const r = N(0.5, 'lowpass', 150, 0.5); LF(0.25, 0.3, r.g.gain);
      const h = N(0.1, 'bandpass', 900, 1); LF(0.25, 0.09, h.g.gain);
      O('sine', 41, 0.16); O('sine', 55, 0.1); O('sine', 54.4, 0.08);
      every(2.5, 6, t => { tone(g, t, { f: rnd(200, 300), f2: 120, dur: 0.08, vol: 0.05, lp: 600 }); });
      break;
    }
    case 'water': {
      const a = N(0.3, 'bandpass', 500, 1, false); LF(0.2, 0.2, a.g.gain); LF(0.13, 200, a.f.frequency);
      N(0.2, 'lowpass', 200, 0.5); O('sine', 62, 0.06);
      every(1.5, 4, t => { tone(g, t, { f: rnd(500, 800), f2: rnd(1100, 1700), dur: 0.06, vol: 0.03, rv: 0.3 }); });
      // pings ride along with the drip scheduler
      const drip = B.sched; B.sched = (until, now) => { drip(until, now); if (!B.pingT || B.pingT < now - 5) B.pingT = now + rnd(1, 4); while (B.pingT < until) { tone(g, B.pingT, { f: 1500, dur: 1.6, vol: 0.06, rv: 0.7 }); B.pingT += rnd(5, 9); } };
      break;
    }
    case 'laugh': {
      O('sawtooth', 82.4, 0.05, { lp: 300 }); O('sawtooth', 87.3, 0.05, { lp: 300 }); O('sine', 164.8, 0.05);
      every(1, 3, t => { laughBurst(g, t, 0.35, 2 + Math.floor(Math.random() * 3)); });
      break;
    }
    default: break;
  }
  return B;
}
function stopBed(B) {
  const stop = () => { for (const s of B.srcs) { try { s.stop(); } catch { /* ended */ } } try { B.g.disconnect(); } catch { /* gone */ } };
  B.g.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
  const to = setTimeout(stop, 3200); to.unref?.();
}

// ------------------------------------------------------------------ continuous layers (chase, boss, sanity, scooter, laugh track, radio)
const CH = { g: null, next: 0, step: 0 };
const BO = { g: null, on: false, next: 0 };
const SA = { wg: null, rg: null, wf: null };
const SC = { g: null, o1: null, o2: null };
const LT = { g: null, level: 0, next: 0 };
const RD = { on: false, x: 0, z: 0, g: null, pan: null, att: null, next: 0, chord: 0, nextStatic: 0, nextPop: 0 };
let hbT = 0, hbSwap = 0, lastHunted = 0, lastUnder = false;

function ensureChase() {
  if (CH.g) return;
  CH.g = ctx.createGain(); CH.g.gain.value = 0; CH.g.connect(musicBus);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const pg = ctx.createGain(); pg.gain.value = 0.05; f.connect(pg); pg.connect(CH.g);
  for (const fr of [220, 233.1]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); }
}
function ensureBoss() {
  if (BO.g) return;
  BO.g = ctx.createGain(); BO.g.gain.value = 0; BO.g.connect(musicBus);
  const pulse = ctx.createGain(); pulse.gain.value = 0.5; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.connect(pulse); pulse.connect(BO.g);
  for (const fr of [55, 55.6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = 0.18; o.connect(og); og.connect(lp); o.start(); }
  const l = ctx.createOscillator(); l.frequency.value = 2; const lg = ctx.createGain(); lg.gain.value = 0.5; l.connect(lg); lg.connect(pulse.gain); l.start();
  const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 1500; const tg = ctx.createGain(); tg.gain.value = 0.018; tf.connect(tg); tg.connect(BO.g);
  for (const fr of [440, 466.2]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(tf); o.start(); }
  const tl = ctx.createOscillator(); tl.frequency.value = 6; const tlg = ctx.createGain(); tlg.gain.value = 0.01; tl.connect(tlg); tlg.connect(tg.gain); tl.start();
}
function ensureSanity() {
  if (SA.wg) return;
  SA.wg = ctx.createGain(); SA.wg.gain.value = 0; SA.wg.connect(sfxBus);
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  SA.wf = ctx.createBiquadFilter(); SA.wf.type = 'bandpass'; SA.wf.frequency.value = 3000; SA.wf.Q.value = 9;
  s.connect(SA.wf); SA.wf.connect(SA.wg); s.start(0, rnd(0, 1));
  const l = ctx.createOscillator(); l.frequency.value = 0.37; const lg = ctx.createGain(); lg.gain.value = 1200; l.connect(lg); lg.connect(SA.wf.frequency); l.start();
  SA.rg = ctx.createGain(); SA.rg.gain.value = 0; SA.rg.connect(sfxBus);
  for (const fr of [6900, 7011]) { const o = ctx.createOscillator(); o.frequency.value = fr; o.connect(SA.rg); o.start(); }
}
function ensureScooter() {
  if (SC.g) return;
  SC.g = ctx.createGain(); SC.g.gain.value = 0; SC.g.connect(sfxBus);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.connect(SC.g);
  SC.o1 = ctx.createOscillator(); SC.o1.type = 'sawtooth'; SC.o1.frequency.value = 60; SC.o1.connect(f); SC.o1.start();
  SC.o2 = ctx.createOscillator(); SC.o2.type = 'square'; SC.o2.frequency.value = 120; const g2 = ctx.createGain(); g2.gain.value = 0.4; SC.o2.connect(g2); g2.connect(f); SC.o2.start();
  const l = ctx.createOscillator(); l.frequency.value = 18; const lg = ctx.createGain(); lg.gain.value = 5; l.connect(lg); lg.connect(SC.o1.frequency); l.start();
}
function ensureLaughTrack() {
  if (LT.g) return;
  LT.g = ctx.createGain(); LT.g.gain.value = 0; LT.g.connect(sfxBus);
  for (const [f, rate] of [[900, 5.5], [1700, 4.3]]) {
    const s = ctx.createBufferSource(); s.buffer = pinkBuf; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 1.6;
    const am = ctx.createGain(); am.gain.value = 0.35; const l = ctx.createOscillator(); l.type = 'square'; l.frequency.value = rate; const lg = ctx.createGain(); lg.gain.value = 0.35;
    l.connect(lg); lg.connect(am.gain); s.connect(bp); bp.connect(am); am.connect(LT.g); s.start(0, rnd(0, 2)); l.start();
  }
}
function ensureRadio() {
  if (RD.g) return;
  RD.g = ctx.createGain(); RD.g.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
  RD.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; RD.att = ctx.createGain(); RD.att.gain.value = 0.5;
  RD.g.connect(lp); if (RD.pan) { lp.connect(RD.pan); RD.pan.connect(RD.att); } else lp.connect(RD.att);
  RD.att.connect(sfxBus);
  const l = ctx.createOscillator(); l.frequency.value = 0.7; wobG = ctx.createGain(); wobG.gain.value = 16; l.connect(wobG); l.start();
}
function updateRadioPos() {
  if (!RD.g || !RD.att) return;
  const dx = RD.x - L.x, dz = RD.z - L.z, d = Math.hypot(dx, dz);
  RD.att.gain.value = d > 70 ? 0 : 0.9 / (1 + d / 6);
  if (RD.pan) RD.pan.pan.value = d < 0.6 ? 0 : clamp((dx * Math.cos(L.yaw) + dz * -Math.sin(L.yaw)) / d * 0.9, -1, 1);
}

const CHORDS = [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 349.2]];
const STAB = [110, 110, 130.8, 110, 146.8, 110, 123.5, 116.5];

function pump() {
  if (!ctx || ctx.state === 'closed') return;
  try {
    const now = ctx.currentTime, until = now + 0.45;
    if (bed && bed.sched) bed.sched(until, now);
    if (CH.g && lastHunted > 0.03) {                       // chase stabs on a driving 8th-note grid
      if (CH.next < now - 1) CH.next = now + 0.05;
      const step = 60 / (130 + lastHunted * 40) / 2;
      while (CH.next < until) {
        const i = CH.step++ % STAB.length, f = STAB[i] * (lastHunted > 0.75 && i % 4 === 2 ? 2 : 1);
        tone(CH.g, CH.next, { type: 'sawtooth', f, dur: 0.13, vol: 0.13, lp: 1800, lp2: 500, q: 2 });
        if (i % 2 === 0) tone(CH.g, CH.next, { f: 90, f2: 40, dur: 0.14, vol: 0.2 });
        CH.next += step;
      }
    }
    if (BO.g && BO.on) {
      if (BO.next < now - 1) BO.next = now + 0.05;
      while (BO.next < until) {
        tone(BO.g, BO.next, { f: 110, f2: 38, dur: 0.25, vol: 0.38 });
        noise(BO.g, BO.next + 0.25, { ft: 'highpass', f: 7000, dur: 0.03, vol: 0.06 });
        BO.next += 0.5;
      }
    }
    if (LT.g && LT.level > 0.1) {
      if (LT.next < now - 1) LT.next = now + 0.1;
      while (LT.next < until) { laughBurst(LT.g, LT.next, 0.9, 2 + Math.floor(Math.random() * 3)); LT.next += rnd(0.7, 2.2) / (0.4 + LT.level); }
    }
    if (RD.on && RD.g) {
      if (RD.next < now - 1) RD.next = now + 0.1;
      while (RD.next < until) {
        const ch = CHORDS[RD.chord++ % CHORDS.length];
        ch.forEach((f, i) => {
          const ft = f * (Math.random() < 0.12 ? 0.944 : 1), tt = RD.next + i * 0.3;
          tone(RD.g, tt, { f: ft, dur: 1.5, a: 0.008, vol: 0.12, wob: true });
          tone(RD.g, tt, { f: ft * 2, dur: 0.5, a: 0.004, vol: 0.05, wob: true });
          tone(RD.g, tt, { f: ft * 4, dur: 0.08, a: 0.002, vol: 0.02 });
        });
        tone(RD.g, RD.next, { f: ch[0] / 2, dur: 1.8, a: 0.02, vol: 0.12, wob: true });
        RD.next += 2.4;
      }
      if (RD.nextPop < now - 1) RD.nextPop = now;
      while (RD.nextPop < until) { noise(RD.g, RD.nextPop, { ft: 'highpass', f: 3500, dur: 0.008, vol: 0.12 }); RD.nextPop += rnd(0.05, 0.4); }
      if (RD.nextStatic < now - 1) RD.nextStatic = now + rnd(6, 14);
      if (RD.nextStatic < until) { noise(RD.g, RD.nextStatic, { ft: 'bandpass', f: 900, f2: 3800, q: 2, dur: 0.3, a: 0.05, vol: 0.14 }); RD.nextStatic += rnd(8, 20); }
    }
  } catch { /* never let the scheduler kill the page */ }
}

// ------------------------------------------------------------------ stingers
const STINGER = {
  scare: (d, t) => SFX.scare(d, t, 1),
  chase: (d, t) => {
    tone(d, t, { type: 'sawtooth', f: 110, f2: 220, dur: 0.6, a: 0.3, vol: 0.14, lp: 600, lp2: 3000, rv: 0.4 });
    tone(d, t, { type: 'sawtooth', f: 116.5, f2: 233, dur: 0.6, a: 0.3, vol: 0.12, lp: 600, lp2: 3000, rv: 0.4 });
    tone(d, t + 0.6, { f: 70, f2: 35, dur: 0.5, vol: 0.45 }); noise(d, t + 0.6, { ft: 'lowpass', f: 2000, dur: 0.3, vol: 0.3 });
  },
  win: (d, t) => {
    SFX.seal(d, t, 1, 1);
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(d, t + 0.9 + i * 0.12, { type: 'triangle', f, dur: 0.5, vol: 0.14, rv: 0.4 }));
    [523, 659, 784, 1047].forEach(f => tone(d, t + 1.7, { type: 'sawtooth', f, dur: 2.2, a: 0.05, vol: 0.05, lp: 2000, rv: 0.6 }));
    SFX.cheer(d, t + 1.7, 0.8);
  },
  lose: (d, t) => {
    [392, 370, 330, 262].forEach((f, i) => tone(d, t + i * 0.55, { type: 'sawtooth', f, dur: 0.9, a: 0.05, vol: 0.12, lp: 900, rv: 0.5 }));
    tone(d, t + 2.2, { f: 65, f2: 40, dur: 2.5, a: 0.2, vol: 0.4, rv: 0.5 }); bellHit(d, t + 2.2, 0.6, 0.6, 3, 0.7);
  },
  sunrise: (d, t) => {
    [[261.6, 329.6, 392], [293.7, 370, 440], [329.6, 392, 493.9]].forEach((ch, k) => ch.forEach(f => tone(d, t + k * 1.6, { type: 'triangle', f, dur: 3.2, a: 1.5, vol: 0.09, rv: 0.6 })));
    for (let i = 0; i < 7; i++) { const ti = t + 1.5 + i * rnd(0.3, 0.7); tone(d, ti, { f: rnd(3000, 3600), f2: rnd(4200, 5200), dur: 0.08, vol: 0.04 }); tone(d, ti + 0.1, { f: rnd(3600, 4200), f2: rnd(3000, 3500), dur: 0.07, vol: 0.035 }); }
  },
  boss: (d, t) => {
    [65, 98, 130.8].forEach(f => tone(d, t, { type: 'sawtooth', f, dur: 1.8, a: 0.04, vol: 0.14, lp: 700, lp2: 300, rv: 0.5 }));
    SFX.bossRoar(d, t + 0.1, 0.8); bellHit(d, t, 0.8, 0.5, 3, 0.7);
  },
  phase: (d, t) => {
    noise(d, t, { ft: 'bandpass', f: 400, f2: 5000, q: 1.5, dur: 0.9, a: 0.7, vol: 0.25, rv: 0.4 });
    tone(d, t, { type: 'sawtooth', f: 110, f2: 330, dur: 0.9, a: 0.7, vol: 0.1, lp: 1500, rv: 0.4 });
    bellHit(d, t + 0.9, 0.9, 0.7, 2.5, 0.6); tone(d, t + 0.9, { f: 80, f2: 35, dur: 0.6, vol: 0.5 });
  },
};

// ------------------------------------------------------------------ public API
const guard = fn => (...a) => { try { return fn(...a); } catch (e) { return undefined; } };

export const Sound = {
  init: guard(() => {
    if (ctx || tried) return !!ctx;
    tried = true;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch { ctx = null; return false; }
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); musicBus = ctx.createGain(); sfxBus = ctx.createGain();
    musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 22000;
    musicBus.connect(musicLP); musicLP.connect(master); sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
    makeBuffers(); makeReverb(); applyVol();
    timer = setInterval(pump, 120); timer.unref?.();
    if (wantZone) Sound.setZone(wantZone);
    if (wantBoss) Sound.setBoss(true);
    return true;
  }),
  resume: guard(() => { if (ctx && ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } }),
  setVolume: guard(o => {
    if (o) { for (const k of ['master', 'music', 'sfx']) if (Number.isFinite(o[k])) vol[k] = clamp(o[k], 0, 1); }
    applyVol();
  }),
  setListener: guard((x, z, yaw) => { L.x = +x || 0; L.z = +z || 0; L.yaw = +yaw || 0; updateRadioPos(); }),
  setZone: guard(id => {
    wantZone = id;
    if (!ctx || id === curZone) return;
    if (!['safe', 'night', 'sugar', 'fog', 'bread', 'water', 'laugh'].includes(id)) return;
    curZone = id;
    if (bed) stopBed(bed);
    bed = makeBed(id); bed.next = ctx.currentTime + 0.5;
    bed.g.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
  }),
  setBoss: guard(on => {
    wantBoss = !!on;
    if (!ctx) return;
    if (on) ensureBoss();
    if (BO.g) BO.g.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, on ? 0.4 : 0.8);
    BO.on = !!on;
  }),
  tick: guard((dt, s) => {
    if (!ctx || !s) return;
    dt = clamp(+dt || 0.016, 0, 0.25);
    const now = ctx.currentTime, hunted = clamp(+s.hunted || 0, 0, 1), sane = clamp(s.sanity ?? 1, 0, 1), hp = s.hp ?? 2;
    // chase layer
    if (hunted > 0.02) ensureChase();
    if (CH.g && Math.abs(hunted - lastHunted) > 0.01) CH.g.gain.setTargetAtTime(hunted * 0.8, now, 0.25);
    lastHunted = hunted;
    // heartbeat
    const stress = Math.max(hunted, (1 - sane) * 0.8, hp <= 0 ? 0.7 : hp <= 1 ? 0.3 : 0);
    if (stress > 0.12) {
      hbT -= dt;
      if (hbT <= 0) {
        const bpm = 60 + 90 * stress, hv = 0.15 + 0.55 * stress;
        tone(sfxBus, now, { f: 62, f2: 38, dur: 0.14, vol: 0.5 * hv });
        tone(sfxBus, now + 0.17, { f: 55, f2: 34, dur: 0.12, vol: 0.32 * hv });
        hbT = 60 / bpm;
      }
    } else hbT = 0;
    // low-sanity whispers + ringing
    const insane = clamp((0.65 - sane) / 0.65, 0, 1);
    if (insane > 0 || SA.wg) {
      ensureSanity();
      SA.wg.gain.setTargetAtTime(insane * insane * 0.25, now, 0.3);
      SA.rg.gain.setTargetAtTime(insane * insane * 0.035, now, 0.5);
    }
    // underwater muffling
    const under = !!s.underwater;
    if (under !== lastUnder) { lastUnder = under; musicLP.frequency.setTargetAtTime(under ? 450 : 22000, now, 0.12); }
    // scooter engine
    if (s.scooter || SC.g) {
      ensureScooter();
      SC.g.gain.setTargetAtTime(s.scooter ? 0.16 : 0, now, 0.15);
      const f = s.scooter ? (s.moving ? 95 : 55) : 55;
      SC.o1.frequency.setTargetAtTime(f, now, 0.2); SC.o2.frequency.setTargetAtTime(f * 2, now, 0.2);
    }
  }),
  footstep: guard((surf, o = {}) => {
    if (!ctx) return;
    const d = route(o); if (!d) return;
    const fn = STEP[surf] || STEP.tile;
    const v = (o.vol ?? 1) * (o.sprint ? 1.6 : 1) * (o.crouch ? 0.4 : 1), sp = (o.sprint ? 1.2 : o.crouch ? 0.85 : 1) * rnd(0.94, 1.06);
    fn(d, ctx.currentTime, v, sp);
  }),
  sfx: guard((name, o = {}) => {
    if (!ctx) return;
    const fn = SFX[name]; if (!fn) return;
    const d = route(o); if (!d) return;
    fn(d, ctx.currentTime + (o.delay || 0), o.vol ?? 1, o.rate || 1);
  }),
  voice: guard((text, o = {}) => {
    if (!ctx || voices >= MAXV) return;
    const d = route(o); if (!d) return;
    const str = String(text ?? '').slice(0, 60); if (!str) return;
    const t0 = ctx.currentTime, base = 180 * (o.pitch || 1);
    const os = ctx.createOscillator(); os.type = 'square';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0);
    os.connect(lp); lp.connect(g); g.connect(d);
    let t = t0 + 0.01;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c !== 32) {
        const f = base * (0.8 + (c % 13) / 13 * 0.9 + 0.12 * Math.sin(i * 0.8));
        os.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1, t + 0.006); g.gain.setValueAtTime(0.1, t + 0.03); g.gain.linearRampToValueAtTime(0, t + 0.04);
      }
      t += 0.045;
    }
    os.start(t0); os.stop(t + 0.05); endVoice(os, g, lp);
  }),
  radio: guard((on, x, z) => {
    if (!ctx) return;
    if (on) {
      ensureRadio(); RD.on = true; if (x != null) RD.x = +x; if (z != null) RD.z = +z; updateRadioPos();
      RD.g.gain.setTargetAtTime(1, ctx.currentTime, 0.3); RD.next = ctx.currentTime + 0.1;
    } else if (RD.g) { RD.on = false; RD.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2); }
  }),
  stinger: guard(kind => {
    if (!ctx) return;
    const fn = STINGER[kind]; if (fn) fn(sfxBus, ctx.currentTime);
  }),
  laughTrack: guard(level => {
    if (!ctx) { wantLaugh = level; return; }
    const lv = clamp(+level || 0, 0, 1);
    if (lv > 0.01) ensureLaughTrack();
    LT.level = lv;
    if (LT.g) LT.g.gain.setTargetAtTime(lv * 0.45, ctx.currentTime, 0.25);
  }),
  beat: guard(time => {
    if (!ctx) return;
    const t = Math.max(ctx.currentTime, Number.isFinite(time) ? time : 0);
    tone(sfxBus, t, { type: 'square', f: 1000, dur: 0.03, vol: 0.1, lp: 3000 }); tone(sfxBus, t, { f: 120, f2: 70, dur: 0.06, vol: 0.12 });
  }),
  now: () => { try { return ctx ? ctx.currentTime : performance.now() / 1000; } catch { return Date.now() / 1000; } },
};
