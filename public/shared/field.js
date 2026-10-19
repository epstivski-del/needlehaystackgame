// FLOCK RUSH: seeded field generator, shared by the server (authority), the browser (rendering) and Practice Mode.
// The same (seed, mode, pens, sheep) always produces the same field, so clients only need those four numbers.
// Everything here is axis-aligned boxes and circles on purpose: cheap, exact and easy to test.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;
export const DOG_RADIUS = 0.5;
export const SHEEP_RADIUS = 0.45;
export const forward = yaw => [-Math.sin(yaw), -Math.cos(yaw)]; // direction a dog with this yaw faces

// Field half-size grows with player count so 12 dogs still have room to run.
export function fieldHalf(players) { return players <= 1 ? 38 : players <= 2 ? 42 : players <= 4 ? 46 : players <= 8 ? 54 : 62; }
export function sheepCountFor(players, flockMul = 1, extra = 1) { return Math.max(18, Math.min(90, Math.round(Math.max(22, Math.min(64, 16 + 4 * players)) * flockMul * extra))); }

// A side of the arena in local coordinates: s runs along the fence, t is the distance inward from the fence.
const SIDES = [
  { id: 'S', n: [0, -1] }, { id: 'N', n: [0, 1] }, { id: 'W', n: [1, 0] }, { id: 'E', n: [-1, 0] },
];
function sp(H, side, s, t) {
  switch (side) {
    case 0: return { x: s, z: H - t };
    case 1: return { x: s, z: -H + t };
    case 2: return { x: -H + t, z: s };
    default: return { x: H - t, z: s };
  }
}
function boxFromSide(H, side, s0, s1, t0, t1) {
  const a = sp(H, side, s0, t0), b = sp(H, side, s1, t1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}
function solid(kind, box, h, extra) {
  return { kind, ...box, cx: (box.minX + box.maxX) / 2, cz: (box.minZ + box.maxZ) / 2, w: box.maxX - box.minX, d: box.maxZ - box.minZ, h, ...extra };
}
const mirrorBox = b => ({ minX: -b.maxX, maxX: -b.minX, minZ: -b.maxZ, maxZ: -b.minZ });

export function generateField(seed, { mode = 'ffa', pens = 1, sheep = 24 } = {}) {
  const rng = mulberry32((seed >>> 0) ^ 0x51ed270b);
  const R = (a, b) => a + (b - a) * rng();
  const team = mode === 'team';
  const nPens = team ? 2 : Math.max(1, Math.min(12, pens));
  const H = fieldHalf(team ? Math.max(4, pens) : nPens);
  const f = { seed: seed >>> 0, mode, half: H, pens: [], solids: [], mud: [], trees: [], sheep: [], clear: 5 };

  // ---- pens: open-fronted corrals set into the fence, facing the middle of the field ----
  const order = nPens === 1 ? [0] : nPens === 2 ? [0, 1] : [0, 1, 2, 3];
  const perSide = [0, 0, 0, 0];
  for (let i = 0; i < nPens; i++) perSide[order[i % order.length]]++;
  const w = team ? 14 : 10, d = team ? 10 : 8;
  const used = [0, 0, 0, 0];
  for (let i = 0; i < nPens; i++) {
    const side = order[i % order.length], c = perSide[side], j = used[side]++;
    const a = c === 1 ? 0 : ((j + 0.5) / c - 0.5) * (2 * H - 26);
    const t0 = 1.1, t1 = 1.1 + d;
    const rect = boxFromSide(H, side, a - w / 2 + 0.3, a + w / 2 - 0.3, t0, t1);
    const n = SIDES[side].n, mouth = sp(H, side, a, t1), spawn = sp(H, side, a, t1 + 4);
    const pen = {
      slot: i, side: SIDES[side].id, a, w, d, rect, cx: (rect.minX + rect.maxX) / 2, cz: (rect.minZ + rect.maxZ) / 2, n,
      u: side < 2 ? [1, 0] : [0, 1], mouth, spawn: { x: spawn.x, z: spawn.z, yaw: Math.atan2(-n[0], -n[1]) },
    };
    f.pens.push(pen);
    f.solids.push(solid('penwall', boxFromSide(H, side, a - w / 2 - 0.3, a + w / 2 + 0.3, 0.6, t0), 1.5, { pen: i, part: 'back' }));
    f.solids.push(solid('penwall', boxFromSide(H, side, a - w / 2 - 0.3, a - w / 2 + 0.3, 0.6, t1), 1.5, { pen: i, part: 'left' }));
    f.solids.push(solid('penwall', boxFromSide(H, side, a + w / 2 - 0.3, a + w / 2 + 0.3, 0.6, t1), 1.5, { pen: i, part: 'right' }));
  }
  // Keep-clear zone in front of every pen so the approach is never blocked.
  const zones = f.pens.map(p => {
    const side = SIDES.findIndex(s => s.id === p.side);
    return boxFromSide(H, side, p.a - p.w / 2 - 7, p.a + p.w / 2 + 7, 0, p.d + 1.1 + 11);
  });
  const inZone = (x, z, pad) => zones.some(b => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad);
  const hitsSolid = (x, z, pad) => f.solids.some(s => x > s.minX - pad && x < s.maxX + pad && z > s.minZ - pad && z < s.maxZ + pad);
  const boxClear = (b, pad) => !inZone((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, pad + Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2) &&
    !f.solids.some(s => b.maxX + pad > s.minX && b.minX - pad < s.maxX && b.maxZ + pad > s.minZ && b.minZ - pad < s.maxZ);
  const farFromCentre = b => Math.hypot((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) > f.clear + 5;
  const addPair = (kind, box, h, extra, pad) => { // everything is point-symmetric, so no pen is favoured by the scenery
    const m = mirrorBox(box);
    if (m.minX < box.maxX + 0.6 && m.maxX > box.minX - 0.6 && m.minZ < box.maxZ + 0.6 && m.maxZ > box.minZ - 0.6) return false;
    for (const b of [box, m]) if (!boxClear(b, pad) || !farFromCentre(b)) return false; // both halves must stay out of every pen's approach
    f.solids.push(solid(kind, box, h, extra), solid(kind, m, h, extra)); return true;
  };
  const inside = H - 8;

  // ---- scenery that shapes the herding: bale stacks, troughs and short rails ----
  for (let n = 0, tries = 0; n < Math.round(H / 7) && tries < 400; tries++) {
    const cx = R(-inside, inside), cz = R(-inside, inside), alongX = rng() < 0.5, len = 1 + Math.floor(rng() * 3), stack = 1 + Math.floor(rng() * 2);
    const box = { minX: cx - (alongX ? len * 0.9 : 0.5), maxX: cx + (alongX ? len * 0.9 : 0.5), minZ: cz - (alongX ? 0.5 : len * 0.9), maxZ: cz + (alongX ? 0.5 : len * 0.9) };
    if (addPair('bale', box, stack * 0.55, { stack, len, alongX }, 1.5)) n++;
  }
  for (let n = 0, tries = 0; n < 2 + Math.floor(H / 22) && tries < 300; tries++) {
    const cx = R(-inside, inside), cz = R(-inside, inside), alongX = rng() < 0.5;
    const box = { minX: cx - (alongX ? 1.7 : 0.55), maxX: cx + (alongX ? 1.7 : 0.55), minZ: cz - (alongX ? 0.55 : 1.7), maxZ: cz + (alongX ? 0.55 : 1.7) };
    if (addPair('trough', box, 0.8, { alongX }, 1.5)) n++;
  }
  for (let n = 0, tries = 0; n < 1 + Math.floor(H / 28) && tries < 300; tries++) {
    const cx = R(-inside + 4, inside - 4), cz = R(-inside + 4, inside - 4), alongX = rng() < 0.5, len = R(7, 12);
    const box = { minX: cx - (alongX ? len / 2 : 0.15), maxX: cx + (alongX ? len / 2 : 0.15), minZ: cz - (alongX ? 0.15 : len / 2), maxZ: cz + (alongX ? 0.15 : len / 2) };
    if (addPair('rail', box, 1.2, { alongX }, 2.5)) n++;
  }
  // ---- mud: slows dogs and sheep alike ----
  for (let n = 0, tries = 0; n < 2 + Math.floor(H / 20) && tries < 200; tries++) {
    const x = R(-inside, inside), z = R(-inside, inside), r = R(3, 4.6);
    if (inZone(x, z, r) || inZone(-x, -z, r) || Math.hypot(x, z) < f.clear + r + 3 || hitsSolid(x, z, r * 0.6) || hitsSolid(-x, -z, r * 0.6)) continue;
    if (Math.hypot(2 * x, 2 * z) < 2 * r + 2) continue;
    f.mud.push({ x, z, r }, { x: -x, z: -z, r }); n++;
  }
  // ---- decorative trees outside the fence (client only draws them) ----
  for (let i = 0; i < 26; i++) { const a = (i / 26) * TAU + R(-0.1, 0.1), dist = H + R(7, 24); f.trees.push({ x: Math.cos(a) * dist, z: Math.sin(a) * dist, s: R(0.8, 1.6) }); }

  // ---- sheep: a golden one dead centre, mirrored pairs around it ----
  const total = Math.max(1, Math.round(sheep));
  const golden = total >= 30 ? 1 : 0;
  const pairs = Math.floor((total - golden) / 2);
  const blackPairs = Math.round(pairs * 0.14);
  const rad = Math.min(H - 12, H * 0.62);
  const pts = [];
  const okSpot = (x, z, gap) => !hitsSolid(x, z, 1.1) && !hitsSolid(-x, -z, 1.1) && !inZone(x, z, 1) && !inZone(-x, -z, 1) && Math.hypot(x, z) > (golden ? 3 : 0.5) &&
    Math.hypot(2 * x, 2 * z) > gap && pts.every(p => Math.hypot(p.x - x, p.z - z) > gap && Math.hypot(p.x + x, p.z + z) > gap);
  for (let i = 0; i < pairs; i++) {
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 900 && !ok; tries++) {
      const a = R(0, TAU), r = rad * Math.sqrt(rng());
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      ok = okSpot(x, z, tries < 400 ? 1.9 : tries < 700 ? 1.2 : 0.8);
    }
    if (!ok) continue; // never place a sheep somewhere invalid; the count is topped up below
    pts.push({ x, z });
  }
  if (golden) f.sheep.push({ x: 0, z: 0, type: 'g' });
  pts.forEach((p, i) => { const type = i < blackPairs ? 'b' : 'w'; f.sheep.push({ x: p.x, z: p.z, type }, { x: -p.x, z: -p.z, type }); });
  // Top up to the requested count with validated single spots (odd totals, or a very crowded field).
  for (let tries = 0; f.sheep.length < total && tries < 3000; tries++) {
    const a = R(0, TAU), r = rad * Math.sqrt(rng()), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (hitsSolid(x, z, 1.1) || inZone(x, z, 1) || f.sheep.some(q => Math.hypot(q.x - x, q.z - z) < 0.9)) continue;
    f.sheep.push({ x, z, type: 'w' });
  }
  return f;
}

// ---- collision (circles against boxes; sliding along surfaces) ----
export function resolveCollision(field, x, z, radius) {
  const lim = field.half - 0.8;
  if (x > lim) x = lim; else if (x < -lim) x = -lim;
  if (z > lim) z = lim; else if (z < -lim) z = -lim;
  for (let pass = 0; pass < 2; pass++) {
    for (const s of field.solids) {
      if (x < s.minX - radius || x > s.maxX + radius || z < s.minZ - radius || z > s.maxZ + radius) continue;
      const px = Math.max(s.minX, Math.min(x, s.maxX)), pz = Math.max(s.minZ, Math.min(z, s.maxZ));
      const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-9) { const dist = Math.sqrt(d2), push = radius - dist; x += (dx / dist) * push; z += (dz / dist) * push; }
      else {
        const l = x - s.minX, r = s.maxX - x, t = z - s.minZ, b = s.maxZ - z, m = Math.min(l, r, t, b);
        if (m === l) x = s.minX - radius; else if (m === r) x = s.maxX + radius; else if (m === t) z = s.minZ - radius; else z = s.maxZ + radius;
      }
    }
  }
  return { x, z };
}

export function penAt(field, x, z) {
  for (const p of field.pens) { const r = p.rect; if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return p; }
  return null;
}
export function mudAt(field, x, z) {
  for (const m of field.mud) if ((m.x - x) ** 2 + (m.z - z) ** 2 < m.r * m.r) return m;
  return null;
}
