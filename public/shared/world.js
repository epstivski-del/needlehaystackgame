// Shared, deterministic world generator. Runs in Node (server) and the browser (client + practice mode).
// The same (seed, mapId) always yields the same arena, so clients only need the seed to render it.
// Hidden-object positions are NOT part of the world: only the server (or the practice engine) knows them.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PLAYER_RADIUS = 0.42;
export const EYE_HEIGHT = 1.7;
export const WALK_SPEED = 4.6;
export const SPRINT_SPEED = 7.4;
export const JUMP_VELOCITY = 6.2;
export const GRAVITY = 18;

export const MAPS = {
  hayfield:    { name: 'Hayfield',     size: 140, piles: 72, bales: 28, barns: 2, crates: 10, fences: 6, goldenOnly: false },
  barnyard:    { name: 'Barnyard',     size: 110, piles: 56, bales: 44, barns: 4, crates: 18, fences: 8, goldenOnly: false },
  goldenfield: { name: 'Golden Field', size: 210, piles: 150, bales: 60, barns: 3, crates: 20, fences: 10, goldenOnly: true },
};

const CELL = 1;

function addBox(world, kind, cx, cz, w, d, h, extra) {
  const s = { kind, cx, cz, w, d, h, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, ...extra };
  world.solids.push(s);
  return s;
}

export function generateWorld(seed, mapId) {
  const cfg = MAPS[mapId] || MAPS.hayfield;
  const id = MAPS[mapId] ? mapId : 'hayfield';
  const rng = mulberry32(seed >>> 0);
  const R = (a, b) => a + (b - a) * rng();
  const size = cfg.size, half = size / 2;
  const world = { seed: seed >>> 0, mapId: id, size, half, spawns: [], piles: [], solids: [], props: [], barns: [], reach: null };

  // Spawn points on a ring, facing the centre.
  const nSpawn = 12, sr = half * 0.6;
  for (let i = 0; i < nSpawn; i++) {
    const a = (i / nSpawn) * Math.PI * 2 + R(-0.1, 0.1);
    const rr = sr * R(0.85, 1.1);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    world.spawns.push({ x, z, yaw: Math.atan2(x, z) });
  }
  const nearSpawn = (x, z, d) => world.spawns.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < d * d);
  const hitsSolid = (x, z, pad) => world.solids.some(s => x > s.minX - pad && x < s.maxX + pad && z > s.minZ - pad && z < s.maxZ + pad);
  const inside = (x, z, m) => Math.abs(x) < half - m && Math.abs(z) < half - m;

  // Barns (4 walls with a door gap, corner posts). Each has a hay pile inside.
  const barnPiles = [];
  for (let b = 0, tries = 0; b < cfg.barns && tries < 200; tries++) {
    const w = 15, d = 11;
    const cx = R(-half + 14, half - 14), cz = R(-half + 12, half - 12);
    if (nearSpawn(cx, cz, 13)) continue;
    if (world.barns.some(o => Math.hypot(o.cx - cx, o.cz - cz) < 26)) continue;
    const t = 0.5, doorW = 3.6, h = 5;
    const side = Math.floor(rng() * 4); // 0:+z 1:-z 2:+x 3:-x door side
    const walls = [];
    const wallX = (zc, hasDoor) => { // wall running along x at z=zc
      if (!hasDoor) walls.push([cx, zc, w, t]);
      else { const seg = (w - doorW) / 2; walls.push([cx - (doorW + seg) / 2, zc, seg, t], [cx + (doorW + seg) / 2, zc, seg, t]); }
    };
    const wallZ = (xc, hasDoor) => {
      if (!hasDoor) walls.push([xc, cz, t, d]);
      else { const seg = (d - doorW) / 2; walls.push([xc, cz - (doorW + seg) / 2, t, seg], [xc, cz + (doorW + seg) / 2, t, seg]); }
    };
    wallX(cz + d / 2, side === 0); wallX(cz - d / 2, side === 1);
    wallZ(cx + w / 2, side === 2); wallZ(cx - w / 2, side === 3);
    for (const [x, z, ww, dd] of walls) addBox(world, 'barnwall', x, z, ww, dd, h, { barn: b });
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addBox(world, 'post', cx + px * (w / 2 - 1.2), cz + pz * (d / 2 - 1.2), 0.6, 0.6, h, { barn: b });
    world.barns.push({ cx, cz, w, d, h, side });
    barnPiles.push({ x: cx + R(-2, 2), z: cz + R(-1.2, 1.2), r: R(2.4, 3.2), barn: b });
    b++;
  }

  // Hay bale stacks.
  for (let n = 0, tries = 0; n < cfg.bales && tries < 600; tries++) {
    const cx = R(-half + 4, half - 4), cz = R(-half + 4, half - 4);
    if (nearSpawn(cx, cz, 7) || hitsSolid(cx, cz, 3)) continue;
    const alongX = rng() < 0.5, len = 1 + Math.floor(rng() * 3), stack = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < len; i++) {
      const bx = cx + (alongX ? i * 1.7 : 0), bz = cz + (alongX ? 0 : i * 1.7);
      if (!inside(bx, bz, 2)) continue;
      addBox(world, 'bale', bx, bz, alongX ? 1.6 : 0.95, alongX ? 0.95 : 1.6, stack * 0.55, { stack });
    }
    n++;
  }

  // Interior fence runs.
  for (let n = 0, tries = 0; n < cfg.fences && tries < 200; tries++) {
    const cx = R(-half + 12, half - 12), cz = R(-half + 12, half - 12), len = R(8, 16), alongX = rng() < 0.5;
    if (nearSpawn(cx, cz, 9 + len / 2) || hitsSolid(cx, cz, 5 + len / 2)) continue;
    addBox(world, 'fence', cx, cz, alongX ? len : 0.25, alongX ? 0.25 : len, 1.3, { alongX });
    n++;
  }

  // Props: barrels, crates, broken carts (solid), pitchforks/rakes (decorative).
  for (let n = 0, tries = 0; n < cfg.crates && tries < 300; tries++) {
    const x = R(-half + 4, half - 4), z = R(-half + 4, half - 4);
    if (nearSpawn(x, z, 6) || hitsSolid(x, z, 2.5)) continue;
    const t = rng();
    if (t < 0.4) addBox(world, 'barrel', x, z, 0.95, 0.95, 1.1);
    else if (t < 0.7) addBox(world, 'crate', x, z, 1.1, 1.1, 1.0);
    else addBox(world, 'cart', x, z, 3.0, 1.7, 1.2, { rot: R(-0.4, 0.4) });
    n++;
  }
  for (let n = 0, tries = 0; n < 30 && tries < 200; tries++) {
    const x = R(-half + 3, half - 3), z = R(-half + 3, half - 3);
    if (nearSpawn(x, z, 4) || hitsSolid(x, z, 1.2)) continue;
    world.props.push({ kind: rng() < 0.5 ? 'pitchfork' : 'rake', x, z, rot: R(0, Math.PI * 2) });
    n++;
  }

  // Hay piles: wadeable mounds. A few are very large "deep loose hay" areas.
  const pileOk = (x, z, r) => {
    if (!inside(x, z, r + 1)) return false;
    if (nearSpawn(x, z, r + 8)) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (hitsSolid(x + Math.cos(a) * r, z + Math.sin(a) * r, 0.2)) return false;
    }
    if (hitsSolid(x, z, 0.2)) return false;
    return !world.piles.some(p => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.8);
  };
  for (const bp of barnPiles) {
    world.piles.push({ id: world.piles.length, x: bp.x, z: bp.z, r: bp.r, h: bp.r * 0.45, deep: false, barn: bp.barn });
  }
  let deepLeft = 3;
  for (let tries = 0; world.piles.length < cfg.piles + barnPiles.length && tries < 2000; tries++) {
    const deep = deepLeft > 0 && rng() < 0.05;
    const r = deep ? R(7, 9) : 2 + Math.pow(rng(), 1.6) * 4.6;
    const x = R(-half + 4, half - 4), z = R(-half + 4, half - 4);
    if (!pileOk(x, z, r)) continue;
    if (deep) deepLeft--;
    world.piles.push({ id: world.piles.length, x, z, r, h: deep ? 0.9 : r * R(0.35, 0.7), deep, barn: -1 });
  }
  return world;
}

// ---- Collision helpers (2D; the arena is flat) ----
export function resolveCollision(world, x, z, radius = PLAYER_RADIUS) {
  const lim = world.half - 0.8;
  if (x > lim) x = lim; else if (x < -lim) x = -lim;
  if (z > lim) z = lim; else if (z < -lim) z = -lim;
  for (let pass = 0; pass < 2; pass++) {
    for (const s of world.solids) {
      if (x < s.minX - radius || x > s.maxX + radius || z < s.minZ - radius || z > s.maxZ + radius) continue;
      const cxp = Math.max(s.minX, Math.min(x, s.maxX)), czp = Math.max(s.minZ, Math.min(z, s.maxZ));
      let dx = x - cxp, dz = z - czp;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-9) { const d = Math.sqrt(d2), push = radius - d; x += (dx / d) * push; z += (dz / d) * push; }
      else { // centre inside the box: push out through the nearest face
        const l = x - s.minX, r = s.maxX - x, t = z - s.minZ, b = s.maxZ - z, m = Math.min(l, r, t, b);
        if (m === l) x = s.minX - radius; else if (m === r) x = s.maxX + radius; else if (m === t) z = s.minZ - radius; else z = s.maxZ + radius;
      }
    }
  }
  return { x, z };
}

export function pileAt(world, x, z, extra = 0) {
  let best = null, bd = Infinity;
  for (const p of world.piles) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= p.r + extra && d - p.r < bd) { best = p; bd = d - p.r; }
  }
  return best;
}

export function surfaceAt(world, x, z) {
  if (world.barns.some(b => Math.abs(x - b.cx) < b.w / 2 && Math.abs(z - b.cz) < b.d / 2)) return 'wood';
  if (pileAt(world, x, z)) return 'straw';
  return Math.hypot(x, z) < world.half * 0.25 ? 'dirt' : 'straw';
}

// ---- Reachability (server-side placement safety) ----
export function computeReach(world) {
  if (world.reach) return world.reach;
  const n = Math.ceil(world.size / CELL), blocked = new Uint8Array(n * n), seen = new Uint8Array(n * n);
  const ci = v => Math.floor((v + world.half) / CELL);
  const pad = PLAYER_RADIUS + 0.05;
  for (const s of world.solids) {
    const x0 = Math.max(0, ci(s.minX - pad)), x1 = Math.min(n - 1, ci(s.maxX + pad));
    const z0 = Math.max(0, ci(s.minZ - pad)), z1 = Math.min(n - 1, ci(s.maxZ + pad));
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) blocked[iz * n + ix] = 1;
  }
  for (let i = 0; i < n; i++) for (const m of [0, 1]) { // arena border margin
    blocked[i * n + m] = blocked[i * n + (n - 1 - m)] = blocked[m * n + i] = blocked[(n - 1 - m) * n + i] = 1;
  }
  const q = [];
  for (const s of world.spawns) {
    const ix = ci(s.x), iz = ci(s.z), k = iz * n + ix;
    if (!blocked[k] && !seen[k]) { seen[k] = 1; q.push(k); }
  }
  for (let h = 0; h < q.length; h++) {
    const k = q[h], ix = k % n, iz = (k / n) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = ix + dx, z = iz + dz;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const j = z * n + x;
      if (blocked[j] || seen[j]) continue;
      seen[j] = 1; q.push(j);
    }
  }
  world.reach = { n, seen, blocked, ci };
  return world.reach;
}

export function isReachable(world, x, z) {
  const r = computeReach(world);
  const ix = r.ci(x), iz = r.ci(z);
  if (ix < 0 || iz < 0 || ix >= r.n || iz >= r.n) return false;
  return r.seen[iz * r.n + ix] === 1;
}

// Pick a valid hidden spot inside a pile: reachable, clear of solids and spawns, spaced from other items.
export function pickHiddenSpot(world, rng, taken = [], pileFilter = null) {
  const piles = world.piles.filter(p => !pileFilter || pileFilter(p));
  if (!piles.length) return null;
  for (let tries = 0; tries < 400; tries++) {
    const p = piles[Math.floor(rng() * piles.length)];
    const a = rng() * Math.PI * 2, d = p.r * 0.85 * Math.sqrt(rng());
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    if (Math.abs(x) > world.half - 1.5 || Math.abs(z) > world.half - 1.5) continue;
    if (world.spawns.some(s => Math.hypot(s.x - x, s.z - z) < 6)) continue;
    if (world.solids.some(s => x > s.minX - 0.7 && x < s.maxX + 0.7 && z > s.minZ - 0.7 && z < s.maxZ + 0.7)) continue;
    if (!isReachable(world, x, z)) continue;
    if (taken.some(t => Math.hypot(t.x - x, t.z - z) < 1.5)) continue;
    return { x, z, pile: p.id };
  }
  return null;
}
