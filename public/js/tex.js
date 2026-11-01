// Procedural textures (no image files). Small canvases with nearest-neighbour magnification for the chunky PS1 look.
const T = globalThis.__THREE;
const cache = new Map();

function rnd(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function make(key, size, draw, repeat = true) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  let h = 7; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  draw(g, size, rnd(h));
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace; t.magFilter = T.NearestFilter; t.minFilter = T.NearestMipmapLinearFilter; t.anisotropy = 2;
  if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
  cache.set(key, t); return t;
}
function speck(g, n, r, cols, count, sz = 1) { for (let i = 0; i < count; i++) { g.fillStyle = cols[(r() * cols.length) | 0]; g.fillRect((r() * n) | 0, (r() * n) | 0, sz, sz); } }

const DRAW = {
  plaster: (g, n, r) => { g.fillStyle = '#c4beae'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#b4ae9e', '#d0cabb', '#aaa493'], 260); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, n - 3, n, 3); },
  brick: (g, n, r) => {
    g.fillStyle = '#4a302a'; g.fillRect(0, 0, n, n);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? n / 8 : 0;
      for (let col = -1; col < 4; col++) { const s = 0.85 + r() * 0.3; g.fillStyle = `rgb(${(150 * s) | 0},${(72 * s) | 0},${(56 * s) | 0})`; g.fillRect(col * (n / 4) + off + 1, row * (n / 8) + 1, n / 4 - 2, n / 8 - 2); }
    }
    speck(g, n, r, ['#00000022', '#ffffff14'], 120);
  },
  tile: (g, n, r) => { g.fillStyle = '#c9d1cc'; g.fillRect(0, 0, n, n); g.fillStyle = '#7c8782'; g.fillRect(0, 0, n, 1); g.fillRect(0, 0, 1, n); g.fillRect(n / 2, 0, 1, n); g.fillRect(0, n / 2, n, 1); speck(g, n, r, ['#bcc5c0', '#d6ddd8'], 140); },
  timber: (g, n, r) => {
    for (let i = 0; i < 8; i++) { const s = 0.85 + r() * 0.3; g.fillStyle = `rgb(${(134 * s) | 0},${(98 * s) | 0},${(64 * s) | 0})`; g.fillRect(0, i * (n / 8), n, n / 8); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, i * (n / 8), n, 1); }
    speck(g, n, r, ['#5a3f26', '#9b7448'], 160); g.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 3; i++) g.fillRect((r() * n) | 0, 0, 1, n);
  },
  carpet: (g, n, r) => { g.fillStyle = '#6e1a26'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#5a1420', '#82222f', '#4a101a'], 420); },
  grass: (g, n, r) => { g.fillStyle = '#2a4026'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#1d3019', '#355230', '#2f4a2b', '#223a20'], 500); },
  asphalt: (g, n, r) => { g.fillStyle = '#2c2f33'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#25282c', '#383c40', '#42464a'], 420); },
  sprinkle: (g, n, r) => { g.fillStyle = '#d9a0b2'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#cb94a6', '#e8b2c2'], 220); const cols = ['#fff', '#7cd4ff', '#ffe46b', '#8affb0', '#ff5a7a', '#b890ff']; for (let i = 0; i < 70; i++) { g.fillStyle = cols[(r() * cols.length) | 0]; g.fillRect((r() * n) | 0, (r() * n) | 0, 2, 1); } },
  glass: (g, n) => { g.clearRect(0, 0, n, n); g.fillStyle = 'rgba(150,190,215,0.28)'; g.fillRect(0, 0, n, n); g.fillStyle = 'rgba(40,46,52,0.95)'; g.fillRect(0, 0, n, 3); g.fillRect(0, n - 3, n, 3); g.fillRect(0, 0, 2, n); g.fillRect(n / 2, 0, 2, n); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(6, 6, 6, n - 12); },
  metal: (g, n, r) => { for (let i = 0; i < n; i += 4) { g.fillStyle = (i / 4) % 2 ? '#6c727a' : '#565b62'; g.fillRect(i, 0, 4, n); } speck(g, n, r, ['#00000018', '#ffffff10'], 80); },
  mesh: (g, n) => { g.clearRect(0, 0, n, n); g.fillStyle = '#9aa2aa'; for (let i = 0; i < n; i += 8) { g.fillRect(i, 0, 1, n); g.fillRect(0, i, n, 1); } g.fillStyle = '#6c737b'; g.fillRect(0, 0, n, 2); },
  concrete: (g, n, r) => { g.fillStyle = '#6d6f6c'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#60625f', '#7a7c78', '#585a57'], 300); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, 0, n, 1); g.fillRect(0, 0, 1, n); },
  locker: (g, n, r) => { g.fillStyle = '#4c6272'; g.fillRect(0, 0, n, n); g.fillStyle = '#34454f'; g.fillRect(0, 0, 2, n); g.fillRect(n - 2, 0, 2, n); for (let i = 0; i < 4; i++) g.fillRect(10, 8 + i * 4, n - 20, 2); g.fillStyle = '#c8ccd0'; g.fillRect(n - 14, n / 2, 4, 10); speck(g, n, r, ['#00000018'], 60); },
  bread: (g, n, r) => { g.fillStyle = '#cb8c3e'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#a86c28', '#e0a458', '#b97a32'], 300); g.fillStyle = '#8a5518'; for (let i = 0; i < 4; i++) g.fillRect(0, i * (n / 4) + 2, n, 2); },
  seat: (g, n, r) => { g.fillStyle = '#7c1626'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#681220', '#8c1e30'], 200); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, n / 2, n, 2); },
  cladding: (g, n, r) => { for (let i = 0; i < 4; i++) { g.fillStyle = ['#d8581f', '#c04418', '#e06a28', '#b83a1c'][i]; g.fillRect(i * (n / 4), 0, n / 4, n); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(i * (n / 4), 0, 1, n); } speck(g, n, r, ['#00000014'], 90); },
  bark: (g, n, r) => { g.fillStyle = '#3d2f24'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#2e231a', '#4e3c2d', '#a49a88'], 260); g.fillStyle = '#2a2019'; for (let i = 0; i < 6; i++) g.fillRect((r() * n) | 0, 0, 1, n); },
  leaf: (g, n, r) => { g.fillStyle = '#35602f'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#284c24', '#3f7437', '#2e5629'], 380, 2); },
  stage: (g, n, r) => { g.fillStyle = '#4a2a1c'; g.fillRect(0, 0, n, n); for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(i * (n / 8), 0, 1, n); } speck(g, n, r, ['#5e3826', '#3a2014'], 200); },
  water: (g, n, r) => { g.fillStyle = '#1f7a92'; g.fillRect(0, 0, n, n); speck(g, n, r, ['#2a90a8', '#17657a', '#4db3c8'], 140, 2); },
  lines: (g, n) => { g.fillStyle = '#2c2f33'; g.fillRect(0, 0, n, n); g.fillStyle = '#d8d27a'; g.fillRect(n - 4, 0, 3, n * 0.6); },
};

export function tex(name) {
  if (!DRAW[name]) name = 'plaster';
  const rep = name !== 'glass' && name !== 'mesh' ? true : true;
  return make(name, 64, DRAW[name], rep);
}

// Non-repeating canvas label (signs, bibs, plaques). Cached by content.
export function label(text, opt = {}) {
  const w = opt.w || 256, h = opt.h || 64, key = 'L' + text + '|' + (opt.bg || '') + (opt.fg || '') + w + h + (opt.font || '');
  return make(key, Math.max(w, h), (g, n) => {
    g.canvas.width = w; g.canvas.height = h;
    if (opt.bg) { g.fillStyle = opt.bg; g.fillRect(0, 0, w, h); }
    if (opt.border) { g.strokeStyle = opt.border; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4); }
    g.fillStyle = opt.fg || '#fff'; g.font = opt.font || 'bold 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = String(text).split('\n'); lines.forEach((ln, i) => g.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (opt.lh || 44)));
  }, false);
}

// Soft round glow used for pickup halos and flashlight dust.
export function glow() {
  return make('glow', 64, (g, n) => { const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }, false);
}
export function stars(n = 600) {
  const pos = [], r = rnd(99);
  for (let i = 0; i < n; i++) { const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); const y = Math.abs(u) * 0.9 + 0.1; pos.push(Math.cos(a) * s * 220, y * 220, Math.sin(a) * s * 220); }
  return new Float32Array(pos);
}
