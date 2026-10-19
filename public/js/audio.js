// Fully procedural audio (no asset files): footsteps by surface, hay rustle, detector beeps, ambience, music, UI, stingers.
// Everything is synthesised with WebAudio so there is nothing to download and nothing to fail to load.
let ctx = null, master, musicBus, sfxBus, ambBus, noiseBuf, ambNodes = null, musicTimer = null, musicOn = false, musicMode = 'menu', musicStep = 0;
const vol = { master: 0.8, music: 0.5, sfx: 0.9 };
const lastPlayed = new Map();

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); sfxBus = ctx.createGain(); musicBus = ctx.createGain(); ambBus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
  sfxBus.connect(master); musicBus.connect(master); ambBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
  const len = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes(); return ctx;
}
function applyVolumes() { if (!ctx) return; master.gain.value = vol.master; sfxBus.gain.value = vol.sfx; musicBus.gain.value = vol.music * 0.5; ambBus.gain.value = vol.sfx * 0.55; }
function throttle(key, ms) { const t = performance.now(); if (t - (lastPlayed.get(key) || 0) < ms) return false; lastPlayed.set(key, t); return true; }

function noise(dur, { type = 'bandpass', f = 2000, q = 1, gain = 0.3, attack = 0.005, f2 = null, dest = null, pan = 0, t0 = 0 } = {}) {
  if (!ensure()) return; const t = ctx.currentTime + t0, src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur); flt.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = g; if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); out = p; }
  src.connect(flt); flt.connect(g); out.connect(dest || sfxBus); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
function tone(freq, dur, { type = 'sine', gain = 0.2, attack = 0.005, freq2 = null, dest = null, t0 = 0, pan = 0 } = {}) {
  if (!ensure()) return; const t = ctx.currentTime + t0, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = g; if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  o.connect(g); out.connect(dest || sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
// distance attenuation + stereo pan relative to the listener (cheap "spatial" audio)
function spatial(dx, dz, yaw) { const d = Math.hypot(dx, dz), a = Math.max(0, 1 - d / 38) ** 1.6; const rx = Math.cos(yaw) * dx - Math.sin(yaw) * dz; return { gain: a, pan: d > 0.01 ? Math.max(-1, Math.min(1, rx / Math.max(d, 4))) : 0 }; }

export const audio = {
  setVolumes(v) { Object.assign(vol, v); applyVolumes(); },
  unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
  suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }, resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },

  footstep(surface, sprint, rel) {
    if (!ensure()) return; const s = rel ? spatial(rel.dx, rel.dz, rel.yaw) : { gain: 1, pan: 0 }; if (s.gain < 0.02) return;
    if (rel && !throttle('fs' + rel.id, 180)) return;
    const k = sprint ? 1.3 : 1, g = 0.28 * k * s.gain * (0.8 + Math.random() * 0.4);
    if (surface === 'wood') { noise(0.09, { f: 700 + Math.random() * 200, q: 3, gain: g * 1.2, pan: s.pan }); tone(110 + Math.random() * 20, 0.09, { type: 'triangle', gain: g * 0.7, freq2: 70, pan: s.pan }); }
    else if (surface === 'dirt') { noise(0.11, { type: 'lowpass', f: 900, gain: g * 1.1, pan: s.pan }); noise(0.05, { f: 2500, q: 1.5, gain: g * 0.3, pan: s.pan }); }
    else { noise(0.17, { f: 3200 + Math.random() * 1500, f2: 1800, q: 0.7, gain: g * 0.85, attack: 0.02, pan: s.pan }); noise(0.07, { type: 'lowpass', f: 600, gain: g * 0.5, pan: s.pan }); }
  },
  jump() { noise(0.2, { f: 2500, f2: 1200, q: 0.6, gain: 0.18 }); }, land(hard) { noise(0.22, { type: 'lowpass', f: 700, gain: hard ? 0.5 : 0.3 }); tone(80, 0.15, { type: 'sine', gain: hard ? 0.3 : 0.15, freq2: 45 }); },
  rustle(rel) { const s = rel ? spatial(rel.dx, rel.dz, rel.yaw) : { gain: 1, pan: 0 }; if (s.gain < 0.03 || (rel && !throttle('ru' + rel.id, 120))) return; noise(0.14 + Math.random() * 0.1, { f: 4200, f2: 2200, q: 0.6, gain: 0.3 * s.gain, attack: 0.03, pan: s.pan }); },
  scrape() { noise(0.28, { f: 3000, f2: 1400, q: 0.8, gain: 0.34, attack: 0.04 }); noise(0.2, { type: 'lowpass', f: 500, gain: 0.2, t0: 0.05 }); },
  searchStart() { this.scrape(); }, searchCancel() { tone(300, 0.12, { type: 'triangle', gain: 0.1, freq2: 180 }); },
  nothing() { noise(0.3, { f: 2000, f2: 900, q: 0.5, gain: 0.2 }); tone(180, 0.2, { type: 'sine', gain: 0.07, freq2: 120 }); },
  decoy(type) {
    if (type === 'coin') { tone(1568, 0.25, { type: 'triangle', gain: 0.22 }); tone(2093, 0.4, { type: 'triangle', gain: 0.2, t0: 0.07 }); }
    else if (type === 'twig') { noise(0.06, { f: 4000, q: 4, gain: 0.35 }); noise(0.05, { f: 3000, q: 4, gain: 0.3, t0: 0.05 }); }
    else if (type === 'wire') { tone(900, 0.5, { type: 'sawtooth', gain: 0.07, freq2: 700 }); noise(0.2, { f: 6000, q: 5, gain: 0.15 }); }
    else { tone(1200 + Math.random() * 400, 0.28, { type: 'square', gain: 0.1, freq2: 800 }); tone(2400, 0.18, { type: 'sine', gain: 0.12 }); noise(0.1, { f: 5000, q: 6, gain: 0.2 }); }
  },
  needleReveal() { for (let i = 0; i < 4; i++) tone(2000 + i * 500, 0.5, { type: 'sine', gain: 0.1, t0: i * 0.06 }); tone(880, 0.6, { type: 'triangle', gain: 0.1 }); },
  needlePickup(golden) { const n = golden ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047]; n.forEach((f, i) => { tone(f, 0.55, { type: 'triangle', gain: 0.22, t0: i * 0.09 }); tone(f * 2, 0.4, { type: 'sine', gain: 0.08, t0: i * 0.09 }); }); noise(0.4, { f: 7000, q: 6, gain: 0.12, t0: 0.3 }); },
  beep(level) { tone(950 + level * 700, 0.07 + (1 - level) * 0.03, { type: 'sine', gain: 0.1 + level * 0.14, attack: 0.002 }); },
  detOn() { tone(500, 0.1, { type: 'square', gain: 0.07, freq2: 900 }); }, detOff() { tone(700, 0.12, { type: 'square', gain: 0.07, freq2: 300 }); },
  detLow() { tone(300, 0.2, { type: 'square', gain: 0.1 }); tone(240, 0.3, { type: 'square', gain: 0.1, t0: 0.22 }); },
  tick(final) { tone(final ? 880 : 660, final ? 0.35 : 0.12, { type: 'sine', gain: 0.18 }); },
  go() { tone(523, 0.1, { type: 'triangle', gain: 0.2 }); tone(784, 0.5, { type: 'triangle', gain: 0.24, t0: 0.1 }); tone(1047, 0.6, { type: 'sine', gain: 0.1, t0: 0.1 }); },
  victory() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => { tone(f, 0.45, { type: 'triangle', gain: 0.22, t0: i * 0.12 }); tone(f / 2, 0.45, { type: 'sine', gain: 0.1, t0: i * 0.12 }); }); },
  defeat() { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.55, { type: 'triangle', gain: 0.2, t0: i * 0.2, freq2: f * 0.97 })); },
  roundEndOther() { tone(330, 0.5, { type: 'triangle', gain: 0.18, freq2: 220 }); tone(196, 0.6, { type: 'sine', gain: 0.1, t0: 0.15 }); },
  notify() { tone(740, 0.12, { type: 'sine', gain: 0.12 }); tone(988, 0.18, { type: 'sine', gain: 0.12, t0: 0.09 }); },
  join() { tone(587, 0.1, { type: 'sine', gain: 0.1 }); tone(784, 0.15, { type: 'sine', gain: 0.1, t0: 0.08 }); }, leave() { tone(500, 0.12, { type: 'sine', gain: 0.1, freq2: 350 }); },
  click() { tone(520, 0.05, { type: 'triangle', gain: 0.1, freq2: 640 }); }, hover() { if (throttle('hov', 60)) tone(800, 0.025, { type: 'sine', gain: 0.03 }); },
  error() { tone(200, 0.2, { type: 'sawtooth', gain: 0.08, freq2: 140 }); },
  // ---- FLOCK RUSH ----
  bark(rel) { const sp = rel ? spatial(rel.dx, rel.dz, rel.yaw) : { gain: 1, pan: 0 }; if (sp.gain < 0.04 || (rel && !throttle('bk' + rel.id, 150))) return; tone(520, 0.09, { type: 'sawtooth', gain: 0.22 * sp.gain, freq2: 300, pan: sp.pan }); noise(0.1, { f: 1400, q: 1.2, gain: 0.16 * sp.gain, pan: sp.pan }); tone(420, 0.12, { type: 'square', gain: 0.1 * sp.gain, freq2: 250, t0: 0.09, pan: sp.pan }); },
  howl(rel) { const sp = rel ? spatial(rel.dx, rel.dz, rel.yaw) : { gain: 1, pan: 0 }; if (sp.gain < 0.04) return; tone(380, 1.3, { type: 'sine', gain: 0.22 * sp.gain, freq2: 760, attack: 0.25, pan: sp.pan }); tone(384, 1.3, { type: 'triangle', gain: 0.1 * sp.gain, freq2: 770, attack: 0.3, pan: sp.pan }); },
  dash(rel) { const sp = rel ? spatial(rel.dx, rel.dz, rel.yaw) : { gain: 1, pan: 0 }; if (sp.gain < 0.04) return; noise(0.3, { f: 600, f2: 2600, q: 0.7, gain: 0.3 * sp.gain, pan: sp.pan }); },
  bump(rel) { const sp = rel ? spatial(rel.dx, rel.dz, rel.yaw) : { gain: 1, pan: 0 }; tone(120, 0.18, { type: 'sine', gain: 0.4 * sp.gain, freq2: 55, pan: sp.pan }); noise(0.1, { type: 'lowpass', f: 600, gain: 0.3 * sp.gain, pan: sp.pan }); },
  baa(rel) { const sp = rel ? spatial(rel.dx, rel.dz, rel.yaw) : { gain: 1, pan: 0 }; if (sp.gain < 0.05 || !throttle('baa', 260)) return; const f = 300 + Math.random() * 120; tone(f, 0.38, { type: 'sawtooth', gain: 0.07 * sp.gain, freq2: f * 0.8, attack: 0.04, pan: sp.pan }); tone(f * 2, 0.3, { type: 'square', gain: 0.025 * sp.gain, freq2: f * 1.5, pan: sp.pan }); },
  penned(value) { const n = value >= 5 ? [659, 784, 988, 1319] : value >= 2 ? [587, 740, 988] : [523, 784]; n.forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.16, t0: i * 0.07 })); },
  stolen(mine) { if (mine) { tone(440, 0.12, { type: 'square', gain: 0.1, freq2: 880 }); tone(880, 0.25, { type: 'triangle', gain: 0.16, t0: 0.1 }); } else { tone(300, 0.3, { type: 'sawtooth', gain: 0.12, freq2: 150 }); } },
  thunderWarn() { noise(1.2, { type: 'lowpass', f: 300, gain: 0.25, attack: 0.5 }); tone(60, 1.4, { type: 'sine', gain: 0.18, attack: 0.6 }); },
  thunder() { noise(2.2, { type: 'lowpass', f: 900, f2: 120, gain: 0.7, attack: 0.01 }); tone(48, 1.6, { type: 'sine', gain: 0.5, freq2: 30 }); noise(0.15, { f: 3500, q: 0.5, gain: 0.5 }); },
  dominating() { [220, 233, 220, 233].forEach((f, i) => tone(f, 0.18, { type: 'square', gain: 0.07, t0: i * 0.2 })); },
  cooldownReady() { tone(900, 0.04, { type: 'sine', gain: 0.05 }); },
  otherSearch(rel) { this.rustle(rel); },

  // wind + barn creaks + crickets
  startAmbience() {
    if (!ensure() || ambNodes) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.18; const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.12; lg.gain.value = 0.09; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    const lf2 = ctx.createOscillator(), lg2 = ctx.createGain(); lf2.frequency.value = 0.07; lg2.gain.value = 180; lf2.connect(lg2); lg2.connect(f.frequency); lf2.start();
    src.connect(f); f.connect(g); g.connect(ambBus); src.start();
    const timer = setInterval(() => { if (!ctx || ctx.state !== 'running') return; const r = Math.random(); if (r < 0.18) tone(180 + Math.random() * 90, 0.9, { type: 'sawtooth', gain: 0.012, freq2: 140 + Math.random() * 60, dest: ambBus }); else if (r < 0.5) { const b = 3600 + Math.random() * 400; for (let i = 0; i < 3; i++) tone(b, 0.05, { type: 'sine', gain: 0.02, t0: i * 0.08, dest: ambBus }); } }, 1900);
    ambNodes = { src, timer, lfo, lf2 };
  },
  stopAmbience() { if (!ambNodes) return; try { ambNodes.src.stop(); ambNodes.lfo.stop(); ambNodes.lf2.stop(); } catch {} clearInterval(ambNodes.timer); ambNodes = null; },

  // restrained generative folk-ish music: slow plucked arpeggio over a drone
  setMusic(mode) { musicMode = mode; if (mode === 'off') { this.stopMusic(); return; } this.startMusic(); },
  startMusic() {
    if (!ensure() || musicOn) return; musicOn = true;
    const prog = [[196, 247, 294, 392], [175, 220, 262, 349], [165, 208, 247, 330], [147, 185, 220, 294]];
    const play = () => {
      if (!musicOn || !ctx || ctx.state !== 'running') return;
      const ch = prog[Math.floor(musicStep / 8) % prog.length], n = ch[[0, 1, 2, 3, 2, 1, 3, 2][musicStep % 8]] * (musicMode === 'game' ? 1 : 2);
      tone(n, 1.4, { type: 'triangle', gain: musicMode === 'game' ? 0.05 : 0.09, dest: musicBus, attack: 0.01 }); if (musicStep % 8 === 0) tone(ch[0] / 2, 3.2, { type: 'sine', gain: 0.07, dest: musicBus, attack: 0.4 });
      musicStep++;
    };
    musicTimer = setInterval(play, musicMode === 'game' ? 520 : 430); play();
  },
  stopMusic() { musicOn = false; clearInterval(musicTimer); musicTimer = null; },
  musicRestart() { this.stopMusic(); this.startMusic(); },
};
