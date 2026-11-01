// NIGHT SHIFT: THE LAST BELL — shared world definition.
// Pure ES module used by the Node server (authoritative sim), the browser client (rendering + prediction)
// and the offline loopback. Everything here is deterministic, so both sides build identical colliders.
//
// Coordinates are metres. +x is east, +z is south, y is up. The campus is fictional ("Midnight Regional College").

export const B = { minX: -130, maxX: 130, minZ: -108, maxZ: 100 };
export const T = 0.4;      // wall thickness
export const H = 3.2;      // wall height

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- zones
export const RECT = {
  atrium:  { x0: -16, z0: 70,  x1: 16,  z1: 88 },
  secret:  { x0: -26, z0: 74,  x1: -16, z1: 84 },
  canteen: { x0: -119, z0: -12, x1: -63, z1: 37 },
  bakery:  { x0: -119, z0: -96, x1: -63, z1: -40 },
  aud:     { x0: 60,  z0: -96, x1: 124, z1: -24 },
  scooter: { x0: 54,  z0: 0,   x1: 128, z1: 76 },
  shed:    { x0: 104, z0: 44,  x1: 124, z1: 66 },
  abyss:   { x0: -42, z0: -106, x1: 52, z1: -22 },
  wingW:   { x0: -52, z0: 24,  x1: -36, z1: 62 },
  wingE:   { x0: 36,  z0: 24,  x1: 52,  z1: 62 },
  deck:    { x0: -34, z0: 18,  x1: 34,  z1: 68 },
  quad:    { x0: -60, z0: -22, x1: 60,  z1: 18 },
};
// Priority order for zoneAt().
const ZONE_ORDER = ['atrium', 'secret', 'canteen', 'bakery', 'aud', 'shed', 'scooter', 'abyss', 'wingW', 'wingE', 'deck', 'quad'];

// Per-zone look & sound. Colours are 0xRRGGBB. `fog` = fog colour, `fd` = fog density, `amb` = ambient light colour.
export const ZONES = {
  atrium:  { name: 'Front Atrium',        short: 'ATRIUM',   fog: 0x14181a, fd: 0.010, amb: 0x7a7560, ai: 0.55, music: 'safe',    surf: 'tile' },
  secret:  { name: 'The 67 Room',         short: '67 ROOM',  fog: 0x14181a, fd: 0.012, amb: 0x806a40, ai: 0.55, music: 'safe',    surf: 'tile' },
  deck:    { name: 'Timber Deck',         short: 'DECK',     fog: 0x0a1020, fd: 0.014, amb: 0x2a3555, ai: 0.35, music: 'night',   surf: 'timber' },
  quad:    { name: 'The Quad',            short: 'QUAD',     fog: 0x0a1020, fd: 0.016, amb: 0x2a3555, ai: 0.32, music: 'night',   surf: 'grass' },
  wingW:   { name: 'West Wing',           short: 'W WING',   fog: 0x0b1020, fd: 0.020, amb: 0x2c3a58, ai: 0.35, music: 'night',   surf: 'tile' },
  wingE:   { name: 'East Wing',           short: 'E WING',   fog: 0x0b1020, fd: 0.020, amb: 0x2c3a58, ai: 0.35, music: 'night',   surf: 'tile' },
  canteen: { name: 'The Doughnut Dungeon', short: 'CANTEEN', fog: 0x2a1018, fd: 0.030, amb: 0x5a2838, ai: 0.45, music: 'sugar',   surf: 'sprinkle' },
  scooter: { name: 'Scooter Catastrophe', short: 'BIKE LOT', fog: 0x1c2428, fd: 0.036, amb: 0x34484c, ai: 0.35, music: 'fog',     surf: 'concrete' },
  shed:    { name: 'The Bike Shed',       short: 'SHED',     fog: 0x1c2428, fd: 0.040, amb: 0x34484c, ai: 0.35, music: 'fog',     surf: 'concrete' },
  bakery:  { name: 'The Loaf Bakery',     short: 'BAKERY',   fog: 0x2a1a0a, fd: 0.030, amb: 0x5a3c1a, ai: 0.45, music: 'bread',   surf: 'tile' },
  abyss:   { name: 'The Bodyboard Abyss', short: 'THE OVAL', fog: 0x04161c, fd: 0.030, amb: 0x1a4650, ai: 0.35, music: 'water',   surf: 'water' },
  aud:     { name: 'The Foghorn Auditorium', short: 'AUDITORIUM', fog: 0x120406, fd: 0.030, amb: 0x501820, ai: 0.4, music: 'laugh', surf: 'carpet' },
  campus:  { name: 'Campus Grounds',      short: 'GROUNDS',  fog: 0x0a1020, fd: 0.016, amb: 0x2a3555, ai: 0.32, music: 'night',   surf: 'grass' },
};

// Hand-placed spots that gameplay and visuals both refer to.
export const SPOTS = {
  spawn:   { x: 0,   z: 80 },
  vend:    { x: 11,  z: 72.6 },
  beanbag: { x: -9,  z: 82 },
  radio:   { x: -13, z: 72.8 },
  trophy:  { x: -15.6, z: 86 },
  plateA:  { x: -5,  z: 74 },
  plateB:  { x: 5,   z: 74 },
  board:   { x: 13,  z: 85 },
  bike:    { x: -21,  z: 79 },
  display: { x: -87.5, z: 12.5 },    // canteen: Golden Doughnut display case (seal spot)
  toaster: { x: -94.5, z: -64.5 },   // bakery: the Toaster / seal spot
  podium:  { x: 5,   z: -66 },       // oval: trophy podium (seal spot)
  shedSeal: { x: 114, z: 55 },       // bike shed (seal spot)
  stage:   { x: 92,  z: -89 },       // auditorium stage centre
  sign:    { x: 9.5, z: 63 },
};
export const SEAL_SPOT = [SPOTS.display, SPOTS.shedSeal, SPOTS.toaster, SPOTS.podium, SPOTS.stage];

export const PITS = [
  { x: -12, z: -84, r: 7 },
  { x: 14,  z: -90, r: 6.5 },
  { x: -26, z: -52, r: 6 },
  { x: 16,  z: -46, r: 6 },
];
const OVAL = { cx: 5, cz: -63, rx: 44, rz: 42 };

export function groundY(x, z) {
  const e = ((x - OVAL.cx) / OVAL.rx) ** 2 + ((z - OVAL.cz) / OVAL.rz) ** 2;
  if (e >= 1) return 0;
  let g = e < 0.78 ? -0.5 : -0.5 * (1 - (e - 0.78) / 0.22);
  for (const p of PITS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r) { const k = 1 - d / p.r; g -= 2.4 * Math.min(1, k * 2.2); }
  }
  return g;
}
export const inOval = (x, z) => ((x - OVAL.cx) / OVAL.rx) ** 2 + ((z - OVAL.cz) / OVAL.rz) ** 2 < 1;
// Tide: a slow sine plus occasional surges (added by the sim through `off`).
export function waterLevel(t, off = 0) { return -0.35 + 0.95 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 90)) + off; }
export function depthAt(x, z, t, off = 0) { return inOval(x, z) ? waterLevel(t, off) - groundY(x, z) : 0; }

// ---------------------------------------------------------------- build
let _world = null;
export function getWorld() { return _world || (_world = build()); }

function build() {
  const W = {
    walls: [], gates: {}, decor: [], hides: [], lights: [], cand: {}, noAI: [], paths: [], floors: [],
    seats: [], crates: [], clouds: [], zoneRect: RECT,
  };
  const wall = (x0, z0, x1, z1, m = 'wall', h = H, extra) => {
    const w = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h, m, _s: 0, ...extra };
    W.walls.push(w); return w;
  };
  const hw = (xa, xb, z, m, h) => wall(xa, z - T / 2, xb, z + T / 2, m, h);
  const vw = (x, za, zb, m, h) => wall(x - T / 2, za, x + T / 2, zb, m, h);
  const prop = (x, z, w, d, h, m, extra) => wall(x - w / 2, z - d / 2, x + w / 2, z + d / 2, m, h, extra);
  const gate = (id, x0, z0, x1, z1, m = 'gate') => { W.gates[id] = { id, x0, z0, x1, z1, h: H, m, _s: 0 }; };

  // A rectangle of walls with door gaps. doors: {side:'n'|'s'|'e'|'w', c, w}. gateId: closes that door with a dynamic gate.
  function building(r, doors, m = 'wall', h = H) {
    const sides = {
      n: { a: r.x0, b: r.x1, fixed: r.z0, horiz: true },
      s: { a: r.x0, b: r.x1, fixed: r.z1, horiz: true },
      w: { a: r.z0, b: r.z1, fixed: r.x0, horiz: false },
      e: { a: r.z0, b: r.z1, fixed: r.x1, horiz: false },
    };
    for (const k of Object.keys(sides)) {
      const s = sides[k];
      const gaps = doors.filter(d => d.side === k).map(d => [d.c - d.w / 2, d.c + d.w / 2]).sort((p, q) => p[0] - q[0]);
      let cur = s.a;
      const seg = (p, q) => { if (q - p < 0.01) return; s.horiz ? hw(p, q, s.fixed, m, h) : vw(s.fixed, p, q, m, h); };
      for (const g of gaps) { seg(cur, g[0]); cur = g[1]; }
      seg(cur, s.b);
    }
  }

  // Recursive-division maze: every wall has exactly one gap, so every cell is reachable.
  function maze(x0, z0, cols, rows, cell, seed, opt = {}) {
    const r = rng(seed), gap = opt.gap || 4.0, stop = opt.stop || 6;
    const H2 = (xa, xb, z) => { if (xb - xa > 0.1) hw(xa, xb, z, opt.m || 'wall'); };
    const V2 = (x, za, zb) => { if (zb - za > 0.1) vw(x, za, zb, opt.m || 'wall'); };
    (function div(c0, r0, w, h) {
      if (w < 2 || h < 2) return;
      if (w * h <= stop && r() < 0.6) return;
      const horiz = w === h ? r() < 0.5 : w < h;
      if (horiz) {
        const row = r0 + 1 + Math.floor(r() * (h - 1)), gc = c0 + Math.floor(r() * w);
        const zl = z0 + row * cell, xs = x0 + c0 * cell, xe = x0 + (c0 + w) * cell, gx = x0 + (gc + 0.5) * cell;
        H2(xs, gx - gap / 2, zl); H2(gx + gap / 2, xe, zl);
        div(c0, r0, w, row - r0); div(c0, row, w, r0 + h - row);
      } else {
        const col = c0 + 1 + Math.floor(r() * (w - 1)), gr = r0 + Math.floor(r() * h);
        const xl = x0 + col * cell, zs = z0 + r0 * cell, ze = z0 + (r0 + h) * cell, gz = z0 + (gr + 0.5) * cell;
        V2(xl, zs, gz - gap / 2); V2(xl, gz + gap / 2, ze);
        div(c0, r0, col - c0, h); div(col, r0, c0 + w - col, h);
      }
    })(0, 0, cols, rows);
    return r;
  }

  // -------- perimeter fence
  hw(B.minX, B.maxX, B.minZ, 'fence'); hw(B.minX, B.maxX, B.maxZ, 'fence');
  vw(B.minX, B.minZ, B.maxZ, 'fence'); vw(B.maxX, B.minZ, B.maxZ, 'fence');

  // -------- FRONT ATRIUM (spawn, safe room): cream angled roof, timber pergola, sliding doors, hedges + steps
  const A = RECT.atrium;
  building(A, [{ side: 'n', c: 0, w: 6 }, { side: 'w', c: 79, w: 3.6 }], 'wall');
  // glass strip so the front reads as the "Reception" frontage
  W.decor.push({ k: 'atriumFront', x0: A.x0, z0: A.z0, x1: A.x1, z1: A.z1 });
  prop(10, 71.4, 2.2, 1.2, 2.0, 'vend', { id: 'vend' });
  prop(-13, 71.6, 2.4, 1.0, 1.0, 'desk');                      // radio table
  prop(0, 76, 8, 1.2, 1.1, 'desk');                            // reception desk
  prop(-8, 85.4, 4.2, 1.8, 0.5, 'couch');
  prop(6, 85.4, 5, 1.4, 0.9, 'desk');                          // trophy cabinet-ish counter
  prop(-6.6, 64.6, 4.2, 4.6, 2.4, 'hedge');                    // hedges flanking the steps
  prop(6.6, 64.6, 4.2, 4.6, 2.4, 'hedge');
  W.decor.push({ k: 'steps', x0: -3.5, z0: 62, x1: 3.5, z1: 70 });
  W.decor.push({ k: 'pergola', x0: -5, z0: 63, x1: 5, z1: 70.4 });
  gate('secret', A.x0 - 0.3, 77.2, A.x0 + 0.3, 80.8, 'secretdoor');
  gate('front', -3, 69.8, 3, 70.2, 'frontgate');   // opens when two players (or a player + Buddy) stand on the tutorial plates
  // secret 67 room
  building(RECT.secret, [{ side: 'e', c: 79, w: 3.6 }], 'wall');
  W.decor.push({ k: 'floor', x0: RECT.secret.x0, z0: RECT.secret.z0, x1: RECT.secret.x1, z1: RECT.secret.z1, m: 'carpet' });
  W.floors.push({ ...A, m: 'tile', roof: true });
  W.floors.push({ ...RECT.secret, m: 'carpet', roof: true });
  W.noAI.push(A, RECT.secret);
  W.lights.push({ x: -8, y: 3, z: 76, c: 0xfff2c8, i: 1.0, fl: 0.0, z_: 'atrium' }, { x: 8, y: 3, z: 82, c: 0xfff2c8, i: 1.0, fl: 0.05, z_: 'atrium' },
    { x: -21, y: 3, z: 79, c: 0xffd070, i: 1.0, fl: 0.0, z_: 'secret' });

  // -------- TIMBER DECK COURTYARD (photos: timber boards, covered walkways, orange cladding, picnic tables, raised platform round a bare tree)
  W.decor.push({ k: 'deckfloor', x0: -34, z0: 18, x1: 34, z1: 62 });
  // covered walkway canopy posts along both wings (slim steel posts, big overhanging steel canopies)
  for (const side of [-1, 1]) {
    const xa = side < 0 ? -36 : 36, xb = side < 0 ? -26 : 26;
    W.decor.push({ k: 'canopy', x0: Math.min(xa, xb), z0: 26, x1: Math.max(xa, xb), z1: 60, y: 3.6 });
    for (let z = 28; z <= 58; z += 10) prop(xb, z, 0.25, 0.25, 3.6, 'post');
  }
  W.decor.push({ k: 'canopy', x0: -14, z0: 20, x1: 14, z1: 32, y: 3.9 });
  for (const [px, pz] of [[-13, 21], [13, 21], [-13, 31], [13, 31]]) prop(px, pz, 0.25, 0.25, 3.9, 'post');
  prop(-4, 44, 6.4, 6.4, 0.45, 'platform');                      // raised timber platform...
  W.decor.push({ k: 'bareTree', x: -4, z: 44 });                 // ...around a bare tree
  for (const [x, z, ry] of [[-22, 36, 0], [-22, 50, 0], [22, 36, 0], [22, 50, 0], [14, 56, 1], [-14, 56, 1]]) {
    prop(x, z, ry ? 1.6 : 2.4, ry ? 2.4 : 1.6, 0.95, 'ptable', { ry });
    W.hides.push({ id: 'h' + W.hides.length, x: x + (ry ? 1.7 : 0), z: z + (ry ? 0 : 1.6), kind: 'bench', r: 1.4, zone: 'deck' });
  }
  prop(31, 20.5, 0.8, 0.8, 1.1, 'tap');                          // blue drinking tap
  for (const [x, z] of [[-30, 40], [30, 40], [0, 20], [0, 60]]) W.lights.push({ x, y: 4, z, c: 0xffe2a0, i: 0.9, fl: 0.0, z_: 'deck' });

  // -------- WINGS: glass-walled classrooms opening onto the deck
  for (const side of ['W', 'E']) {
    const R = side === 'W' ? RECT.wingW : RECT.wingE;
    const doorX = side === 'W' ? R.x1 : R.x0;
    const doors = [];
    const rooms = 4, rh = (R.z1 - R.z0) / rooms;
    for (let i = 0; i < rooms; i++) doors.push({ side: side === 'W' ? 'e' : 'w', c: R.z0 + rh * (i + 0.5), w: 4 });
    building(R, doors, 'glass');
    for (let i = 1; i < rooms; i++) hw(R.x0, R.x1, R.z0 + rh * i, 'wall');
    W.floors.push({ ...R, m: 'tile', roof: true });
    for (let i = 0; i < rooms; i++) {
      const cz = R.z0 + rh * (i + 0.5), cx = (R.x0 + R.x1) / 2;
      // desk clusters + a teacher's desk
      prop(cx + (side === 'W' ? -3 : 3), cz - 2.4, 5, 1.2, 0.9, 'desk');
      prop(cx + (side === 'W' ? -3 : 3), cz + 2.4, 5, 1.2, 0.9, 'desk');
      const hx = side === 'W' ? R.x0 + 1.2 : R.x1 - 1.2;
      prop(hx, cz, 1.0, 1.0, 2.0, 'locker', { id: 'lk' + side + i });
      W.hides.push({ id: 'h' + W.hides.length, x: hx + (side === 'W' ? 1 : -1), z: cz, kind: 'locker', r: 1.5, zone: 'wing' + side });
      W.lights.push({ x: cx, y: 3, z: cz, c: 0xdfe8ff, i: 0.8, fl: 0.18, z_: 'wing' + side });
    }
  }

  // -------- CANTEEN (Doughnut Dungeon) maze
  const C = RECT.canteen;
  building(C, [{ side: 'e', c: 5.5, w: 4 }, { side: 's', c: -94.5, w: 4 }], 'brick');
  maze(C.x0, C.z0, 8, 7, 7, 1337, { stop: 5, m: 'brick' });
  W.floors.push({ ...C, m: 'sprinkle', roof: true });
  // the glass display case (seal spot) gets a visible plinth with a tiny collider off to the side
  prop(SPOTS.display.x, SPOTS.display.z + 2.4, 2.2, 1, 1.1, 'counter');
  // -------- BAKERY (Loaf level)
  const K = RECT.bakery;
  building(K, [{ side: 'e', c: -71.5, w: 4 }, { side: 's', c: -87.5, w: 4 }], 'brick');
  maze(K.x0, K.z0, 8, 8, 7, 4242, { stop: 6, m: 'brick' });
  W.floors.push({ ...K, m: 'tile', roof: true });
  prop(SPOTS.toaster.x, SPOTS.toaster.z - 2.6, 3, 1.4, 1.6, 'toaster', { id: 'toaster' });

  // scatter hiding spots, lights and candidate cells inside the mazes
  function mazeExtras(R, cols, rows, cell, zone, seed, kind, avoid) {
    const r = rng(seed), cells = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const cx = R.x0 + (i + 0.5) * cell, cz = R.z0 + (j + 0.5) * cell;
      if (avoid.some(a => Math.hypot(a.x - cx, a.z - cz) < 5)) continue;
      cells.push({ x: cx + (r() - 0.5) * 2, z: cz + (r() - 0.5) * 2, cell: [i, j] });
      if (r() < 0.55) W.lights.push({ x: cx, y: 3, z: cz, c: zone === 'canteen' ? 0xff9ab8 : 0xffc880, i: 0.9, fl: 0.35, z_: zone });
      if (r() < 0.2) {
        const hx = cx + (r() < 0.5 ? -2.6 : 2.6), hz = cz + (r() < 0.5 ? -2.6 : 2.6);
        prop(hx, hz, 1.1, 1.1, kind === 'locker' ? 2.0 : 1.3, kind, { id: 'hs' + W.hides.length });
        W.hides.push({ id: 'h' + W.hides.length, x: hx, z: hz + (hz > cz ? -1.1 : 1.1), kind, r: 1.5, zone });
      } else if (r() < 0.25) {
        prop(cx + (r() - 0.5) * 3, cz + (r() - 0.5) * 3, 2.4, 1.2, 1.0, zone === 'canteen' ? 'counter' : 'bread');
      }
    }
    W.cand[zone] = cells;
  }
  mazeExtras(C, 8, 7, 7, 'canteen', 11, 'cupboard', [SPOTS.display, { x: -94.5, z: 37 }, { x: -63, z: 5.5 }]);
  mazeExtras(K, 8, 8, 7, 'bakery', 22, 'breadbin', [SPOTS.toaster, { x: -87.5, z: -40 }, { x: -63, z: -71.5 }]);

  // -------- SCOOTER LOT (foggy car park) + bike shed with a chain gate
  const S = RECT.scooter, SH = RECT.shed;
  W.decor.push({ k: 'lot', x0: S.x0, z0: S.z0, x1: S.x1, z1: S.z1 });
  building(SH, [{ side: 'w', c: 55, w: 4 }], 'fence', 2.6);
  gate('chain', SH.x0 - 0.3, 53, SH.x0 + 0.3, 57, 'chain');
  W.decor.push({ k: 'shedRoof', ...SH });
  W.noAI.push(SH);
  const rs = rng(808);
  for (let i = 0; i < 46; i++) {
    const x = S.x0 + 4 + rs() * (S.x1 - S.x0 - 8), z = S.z0 + 4 + rs() * (S.z1 - S.z0 - 8);
    if (x > SH.x0 - 5 && z > SH.z0 - 5 && z < SH.z1 + 5) continue;
    if (Math.hypot(x - 45, z - 10) < 8) continue;
    const ry = rs() < 0.5 ? 0 : 1;
    prop(x, z, ry ? 0.7 : 1.7, ry ? 1.7 : 0.7, 1.1, 'scooter', { ry });
    if (rs() < 0.25) W.hides.push({ id: 'h' + W.hides.length, x: x + 1.4, z, kind: 'scooters', r: 1.2, zone: 'scooter' });
  }
  for (const [x, z] of [[64, 12], [64, 36], [64, 60], [88, 12], [88, 36], [88, 66], [112, 12], [112, 36], [96, 52]]) {
    prop(x, z, 0.35, 0.35, 5, 'pole');
    W.lights.push({ x, y: 4.6, z, c: 0xbfe8d8, i: 0.85, fl: 0.4, z_: 'scooter' });
  }

  // -------- AUDITORIUM (Foghorn): foyer, hall, stage, rows of seats with aisles. The door is a gate until 4 seals.
  const AU = RECT.aud;
  building(AU, [{ side: 's', c: 92, w: 5 }], 'plaster');
  gate('aud', 89.5, AU.z1 - 0.3, 94.5, AU.z1 + 0.3, 'audgate');
  hw(AU.x0, 76, -40, 'plaster'); hw(80, 104, -40, 'plaster'); hw(108, AU.x1, -40, 'plaster'); // foyer divider: two double gaps (76-80, 104-108)
  W.floors.push({ ...AU, m: 'carpet', roof: true });
  W.decor.push({ k: 'stage', x0: AU.x0 + 2, z0: AU.z0, x1: AU.x1 - 2, z1: -80 });
  prop(92, -91, 0.4, 0.4, 1.8, 'prop');                              // mic stand
  for (let row = 0; row < 5; row++) {
    const z = -50 - row * 4.6;
    for (const [xa, xb] of [[66, 78], [82, 102], [106, 118]]) {
      prop((xa + xb) / 2, z, xb - xa, 1.4, 1.0, 'seat');
      for (let x = xa + 1.2; x < xb; x += 2.4) W.seats.push({ x, z: z + 0.1 });
    }
  }
  for (const [x, z] of [[70, -76], [86, -76], [98, -76], [114, -76]]) W.crates.push({ id: 'cr' + W.crates.length, x, z });
  for (const [x, z] of [[72, -62], [96, -62], [112, -62], [86, -46], [104, -76]]) W.clouds.push({ x, z, r: 5.5 });
  for (const x of [68, 82, 100, 116]) W.lights.push({ x, y: 4.2, z: -60, c: 0xff4850, i: 0.8, fl: 0.25, z_: 'aud' });
  for (const x of [72, 112]) W.lights.push({ x, y: 3, z: -32, c: 0xffa0a0, i: 0.7, fl: 0.2, z_: 'aud' });
  W.lights.push({ x: 92, y: 5, z: -86, c: 0xffe0c0, i: 1.2, fl: 0.0, z_: 'aud' });
  W.cand.aud = [{ x: 70, z: -32 }, { x: 114, z: -32 }, { x: 80, z: -56 }, { x: 104, z: -56 }, { x: 80, z: -68 }, { x: 104, z: -68 }, { x: 64, z: -44 }, { x: 120, z: -44 }, { x: 92, z: -45 }];

  // -------- ABYSS: oval + fenced court
  const court = { x0: 28, z0: -62, x1: 48, z1: -32 };
  building(court, [{ side: 's', c: 38, w: 4 }, { side: 'w', c: -47, w: 4 }], 'meshfence', 2.6);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; W.decor.push({ k: 'gum', x: OVAL.cx + Math.cos(a) * 46, z: OVAL.cz + Math.sin(a) * 44, s: 1.3 }); }
  prop(SPOTS.podium.x, SPOTS.podium.z - 2.4, 3.2, 1.2, 1.1, 'podium');
  W.cand.abyssShore = [{ x: 4, z: -30 }, { x: -22, z: -30 }, { x: 30, z: -28 }, { x: -34, z: -66 }, { x: 44, z: -78 }, { x: 36, z: -98 }, { x: -8, z: -102 }, { x: 22, z: -100 }];
  W.lights.push({ x: 5, y: 7, z: -30, c: 0x9fe0ff, i: 0.8, fl: 0.15, z_: 'abyss' }, { x: -30, y: 7, z: -60, c: 0x9fe0ff, i: 0.8, fl: 0.15, z_: 'abyss' }, { x: 40, y: 7, z: -90, c: 0x9fe0ff, i: 0.8, fl: 0.15, z_: 'abyss' });

  // -------- QUAD, paths, signs, trees
  W.decor.push({ k: 'sign', x: SPOTS.sign.x, z: SPOTS.sign.z, text: 'wayfinding' });
  W.paths.push({ x0: -3.5, z0: -22, x1: 3.5, z1: 62 }, { x0: -60, z0: 2, x1: 60, z1: 8 }, { x0: 40, z0: -4, x1: 60, z1: 12 },
    { x0: -3, z0: -60, x1: 3, z1: -22 }, { x0: 88, z0: -24, x1: 96, z1: 0 }, { x0: -65, z0: 3, x1: -60, z1: 8 }, { x0: -60, z0: -72, x1: -3, z1: -66 });
  const rt = rng(7), avoid = [...Object.values(RECT)];
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 46; tries++) {
    const x = B.minX + 6 + rt() * (B.maxX - B.minX - 12), z = B.minZ + 6 + rt() * (B.maxZ - B.minZ - 12);
    if (avoid.some(a => x > a.x0 - 5 && x < a.x1 + 5 && z > a.z0 - 5 && z < a.z1 + 5)) continue;
    if (Math.abs(x) < 6 && z > -24 && z < 70) continue;
    if (z > 2 && z < 8 && x > -62 && x < 62) continue;
    prop(x, z, 0.9, 0.9, 6, 'trunk');
    W.decor.push({ k: 'gum', x, z, s: 0.9 + rt() * 0.7 });
    placed++;
  }
  for (const [x, z] of [[-20, -6], [20, -6], [-40, 10], [40, 14], [0, -14]]) { prop(x, z, 1.6, 0.6, 0.5, 'bench'); }
  for (const [x, z] of [[-20, 10], [20, 10], [0, -10], [-45, -10], [45, -10], [-60, 62], [60, 80]]) W.lights.push({ x, y: 4.6, z, c: 0xbfd4ff, i: 0.55, fl: 0.1, z_: 'quad' });

  finalize(W);
  // ---------- candidate positions for scattered pickups
  W.cand.outdoor = [];
  const ro = rng(555);
  const free = (x, z, rad) => !inWall(W, x, z, rad);
  const zonesToSample = [['scooter', RECT.scooter], ['deck', RECT.deck], ['quad', RECT.quad], ['wingW', RECT.wingW], ['wingE', RECT.wingE], ['campus', { x0: -125, z0: -105, x1: 125, z1: 95 }]];
  for (const [name, R] of zonesToSample) {
    const arr = [];
    let tries = 0;
    while (arr.length < (name === 'campus' ? 40 : 34) && tries++ < 1500) {
      const x = R.x0 + 1.5 + ro() * (R.x1 - R.x0 - 3), z = R.z0 + 1.5 + ro() * (R.z1 - R.z0 - 3);
      if (!free(x, z, 1.3)) continue;
      if (name === 'scooter' && x > SH.x0 - 2 && x < SH.x1 && z > SH.z0 - 2 && z < SH.z1) continue;
      if (name === 'campus' && zoneAt(x, z) !== 'campus' && zoneAt(x, z) !== 'quad') continue;
      arr.push({ x, z });
    }
    W.cand[name] = arr;
  }
  // wings: one candidate per classroom
  W.cand.wingW = W.cand.wingW.filter(c => zoneAt(c.x, c.z) === 'wingW'); W.cand.wingE = W.cand.wingE.filter(c => zoneAt(c.x, c.z) === 'wingE');
  W.cand.atrium = [{ x: -4, z: 84 }, { x: 13, z: 80 }, { x: -13, z: 78 }, { x: 4, z: 73 }];
  W.cand.secret = [{ x: -21, z: 79 }];
  for (const z of ['canteen', 'bakery']) W.cand[z] = W.cand[z].filter(c => !inWall(W, c.x, c.z, 1.0));
  return W;
}

export function zoneAt(x, z) {
  for (const k of ZONE_ORDER) { const r = RECT[k]; if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return k; }
  return 'campus';
}
export const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

// ---------------------------------------------------------------- spatial hash + collision
const CS = 8;
function finalize(W) {
  W.hash = new Map();
  W.walls.forEach((w, i) => { w.i = i; addHash(W, w); });
  W._stamp = 1;
}
const hkey = (ix, iz) => (ix + 40) * 1000 + (iz + 40);
function addHash(W, w) {
  for (let ix = Math.floor(w.x0 / CS); ix <= Math.floor(w.x1 / CS); ix++) for (let iz = Math.floor(w.z0 / CS); iz <= Math.floor(w.z1 / CS); iz++) {
    const k = hkey(ix, iz); let a = W.hash.get(k); if (!a) { a = []; W.hash.set(k, a); } a.push(w);
  }
}
function forNear(W, x0, z0, x1, z1, cb) {
  const st = ++W._stamp;
  for (let ix = Math.floor(x0 / CS); ix <= Math.floor(x1 / CS); ix++) for (let iz = Math.floor(z0 / CS); iz <= Math.floor(z1 / CS); iz++) {
    const a = W.hash.get(hkey(ix, iz)); if (!a) continue;
    for (let i = 0; i < a.length; i++) { const w = a[i]; if (w._s === st) continue; w._s = st; if (cb(w) === true) return true; }
  }
  return false;
}
// Closed gates the caller wants treated as walls.
export function closedGates(W, open) { const out = []; for (const id in W.gates) if (!open || !open[id]) out.push(W.gates[id]); return out; }

export function inWall(W, x, z, r = 0.3, extra) {
  const hit = forNear(W, x - r, z - r, x + r, z + r, w => {
    const px = clamp(x, w.x0, w.x1), pz = clamp(z, w.z0, w.z1);
    return (x - px) ** 2 + (z - pz) ** 2 < r * r;
  });
  if (hit) return true;
  if (extra) for (const w of extra) { const px = clamp(x, w.x0, w.x1), pz = clamp(z, w.z0, w.z1); if ((x - px) ** 2 + (z - pz) ** 2 < r * r) return true; }
  return false;
}

const _out = { x: 0, z: 0 };
// Slide a circle out of walls. Returns a shared {x,z} (copy it!).
export function resolve(W, x, z, r, extra) {
  for (let it = 0; it < 3; it++) {
    let moved = false;
    const fix = w => {
      const px = clamp(x, w.x0, w.x1), pz = clamp(z, w.z0, w.z1);
      const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return false;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; x += dx * k; z += dz * k; }
      else {
        const l = x - w.x0, rr = w.x1 - x, t = z - w.z0, b = w.z1 - z, m = Math.min(l, rr, t, b);
        if (m === l) x = w.x0 - r; else if (m === rr) x = w.x1 + r; else if (m === t) z = w.z0 - r; else z = w.z1 + r;
      }
      moved = true; return false;
    };
    forNear(W, x - r, z - r, x + r, z + r, fix);
    if (extra) for (const w of extra) fix(w);
    if (!moved) break;
  }
  x = clamp(x, B.minX + r, B.maxX - r); z = clamp(z, B.minZ + r, B.maxZ - r);
  _out.x = x; _out.z = z; return _out;
}

// Segment vs expanded AABBs. true = clear line.
export function los(W, x0, z0, x1, z1, r = 0, extra, all = false) {
  const dx = x1 - x0, dz = z1 - z0;
  const hit = w => {
    let tmin = 0, tmax = 1;
    const ax0 = w.x0 - r, ax1 = w.x1 + r, az0 = w.z0 - r, az1 = w.z1 + r;
    if (Math.abs(dx) < 1e-9) { if (x0 < ax0 || x0 > ax1) return false; }
    else { let t1 = (ax0 - x0) / dx, t2 = (ax1 - x0) / dx; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return false; }
    if (Math.abs(dz) < 1e-9) { if (z0 < az0 || z0 > az1) return false; }
    else { let t1 = (az0 - z0) / dz, t2 = (az1 - z0) / dz; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return false; }
    return true;
  };
  if (forNear(W, Math.min(x0, x1) - r, Math.min(z0, z1) - r, Math.max(x0, x1) + r, Math.max(z0, z1) + r, w => (all || w.h >= 1.2 || w.m === 'fence') && hit(w))) return false;
  if (extra) for (const w of extra) if (hit(w)) return false;
  return true;
}

// ---------------------------------------------------------------- waypoint grid + A*
const GS = 2.0;
const GX = Math.floor((B.maxX - B.minX) / GS) + 1, GZ = Math.floor((B.maxZ - B.minZ) / GS) + 1;
export function gridInfo() { return { GS, GX, GZ }; }
function ensureGrid(W) {
  if (W.gv) return;
  W.gv = new Uint8Array(GX * GZ);
  W.ge = new Uint8Array(GX * GZ * 8);
  for (let iz = 0; iz < GZ; iz++) for (let ix = 0; ix < GX; ix++) {
    const x = B.minX + ix * GS, z = B.minZ + iz * GS;
    let ok = x > B.minX + 1 && x < B.maxX - 1 && z > B.minZ + 1 && z < B.maxZ - 1 && !inWall(W, x, z, 0.75);
    if (ok) for (const r of W.noAI) if (inRect(r, x, z)) { ok = false; break; }
    W.gv[iz * GX + ix] = ok ? 1 : 0;
  }
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function edgeOK(W, ix, iz, d) {
  const idx = (iz * GX + ix) * 8 + d, c = W.ge[idx]; if (c) return c === 1;
  const nx = ix + DIRS[d][0], nz = iz + DIRS[d][1];
  let ok = nx >= 0 && nz >= 0 && nx < GX && nz < GZ && W.gv[nz * GX + nx] === 1;
  if (ok && d >= 4) ok = W.gv[iz * GX + nx] === 1 && W.gv[nz * GX + ix] === 1;
  if (ok) ok = los(W, B.minX + ix * GS, B.minZ + iz * GS, B.minX + nx * GS, B.minZ + nz * GS, 0.35, null, true);
  W.ge[idx] = ok ? 1 : 2; return ok;
}
export function nearestNode(W, x, z) {
  ensureGrid(W);
  const cx = Math.round((x - B.minX) / GS), cz = Math.round((z - B.minZ) / GS);
  let best = -1, bd = 1e9;
  for (let r = 0; r <= 6 && best < 0; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const ix = cx + dx, iz = cz + dz; if (ix < 0 || iz < 0 || ix >= GX || iz >= GZ || !W.gv[iz * GX + ix]) continue;
    const d = (B.minX + ix * GS - x) ** 2 + (B.minZ + iz * GS - z) ** 2; if (d < bd) { bd = d; best = iz * GX + ix; }
  }
  return best;
}

// Returns an array of {x,z} waypoints (smoothed) or null if no route.
export function findPath(W, sx, sz, tx, tz, maxExpand = 14000) {
  ensureGrid(W);
  if (los(W, sx, sz, tx, tz, 0.5, null, true)) return [{ x: tx, z: tz }];
  const s = nearestNode(W, sx, sz), g = nearestNode(W, tx, tz);
  if (s < 0 || g < 0) return null;
  const n = GX * GZ;
  if (!W._g) { W._g = new Float32Array(n); W._p = new Int32Array(n); W._c = new Uint32Array(n); W._tick = 0; }
  const G = W._g, P = W._p, Cc = W._c, tick = ++W._tick;
  const gx = g % GX, gz = (g / GX) | 0;
  const heap = []; // [f, idx]
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const hfn = (ix, iz) => { const dx = Math.abs(ix - gx), dz = Math.abs(iz - gz); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * GS; };
  G[s] = 0; P[s] = -1; Cc[s] = tick; push(hfn(s % GX, (s / GX) | 0), s);
  let expanded = 0, found = false;
  if (!W._cl) W._cl = new Uint32Array(n);
  const CL = W._cl;
  while (heap.length && expanded++ < maxExpand) {
    const [, cur] = pop();
    if (CL[cur] === tick) continue;
    CL[cur] = tick;
    if (cur === g) { found = true; break; }
    const ix = cur % GX, iz = (cur / GX) | 0;
    for (let d = 0; d < 8; d++) {
      if (!edgeOK(W, ix, iz, d)) continue;
      const nx = ix + DIRS[d][0], nz = iz + DIRS[d][1], ni = nz * GX + nx;
      if (CL[ni] === tick) continue;
      const ng = G[cur] + (d < 4 ? GS : GS * 1.414);
      if (Cc[ni] !== tick || ng < G[ni]) { G[ni] = ng; P[ni] = cur; Cc[ni] = tick; push(ng + hfn(nx, nz), ni); }
    }
  }
  if (!found) return null;
  const pts = [];
  for (let c = g; c !== -1; c = P[c]) pts.push({ x: B.minX + (c % GX) * GS, z: B.minZ + ((c / GX) | 0) * GS });
  pts.reverse();
  pts[pts.length - 1] = { x: tx, z: tz };
  // string-pull
  const out = []; let a = { x: sx, z: sz }, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !los(W, a.x, a.z, pts[j].x, pts[j].z, 0.5, null, true)) j--;
    out.push(pts[j]); a = pts[j]; i = j + 1;
  }
  return out;
}
