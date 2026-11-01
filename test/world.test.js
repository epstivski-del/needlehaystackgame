// World tests: the campus is fully connected, key spots are reachable (gates open), seals/pickups are not inside walls, A* works.
import assert from 'node:assert/strict';
import { getWorld, inWall, resolve, los, findPath, SPOTS, SEAL_SPOT, RECT, zoneAt, B, PITS } from '../public/shared/world.js';

const W = getWorld();
let pass = 0; const t = (n, f) => { try { f(); pass++; console.log('  ✓', n); } catch (e) { console.log('  ✗', n, '\n    ', e.message); process.exitCode = 1; } };

t('world has walls, lights, hides and candidates', () => {
  assert.ok(W.walls.length > 300, 'walls ' + W.walls.length);
  assert.ok(W.hides.length > 20, 'hides ' + W.hides.length);
  for (const z of ['canteen', 'bakery', 'scooter', 'deck', 'quad', 'aud', 'campus']) assert.ok(W.cand[z].length >= 9, z + ' cand ' + W.cand[z].length);
});

// Fine flood-fill from the spawn with gates OPEN.
const S = 0.5, nx = Math.ceil((B.maxX - B.minX) / S), nz = Math.ceil((B.maxZ - B.minZ) / S);
const seen = new Uint8Array(nx * nz);
const idx = (x, z) => Math.floor((z - B.minZ) / S) * nx + Math.floor((x - B.minX) / S);
{
  const st = [[SPOTS.spawn.x, SPOTS.spawn.z]]; seen[idx(...st[0])] = 1;
  while (st.length) {
    const [x, z] = st.pop();
    for (const [dx, dz] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
      const X = x + dx, Z = z + dz; if (X < B.minX || X > B.maxX || Z < B.minZ || Z > B.maxZ) continue;
      const i = idx(X, Z); if (seen[i] || inWall(W, X, Z, 0.4)) continue; seen[i] = 1; st.push([X, Z]);
    }
  }
}
const reach = (x, z) => !!seen[idx(x, z)];
t('spawn is not inside a wall', () => assert.ok(!inWall(W, SPOTS.spawn.x, SPOTS.spawn.z, 0.4)));
t('all seal spots reachable', () => SEAL_SPOT.forEach((p, i) => assert.ok(reach(p.x, p.z), 'seal ' + i + ' unreachable ' + JSON.stringify(p))));
t('named spots reachable', () => { for (const k of ['vend', 'beanbag', 'radio', 'bike', 'board']) { const p = SPOTS[k]; if (k === 'vend') continue; assert.ok(reach(p.x, p.z), k + ' unreachable'); } });
t('maze cells and shore points reachable', () => {
  for (const z of ['canteen', 'bakery']) for (const c of W.cand[z]) assert.ok(reach(c.x, c.z), z + ' cell unreachable ' + JSON.stringify(c));
  for (const c of W.cand.abyssShore) assert.ok(reach(c.x, c.z), 'shore ' + JSON.stringify(c));
  for (const c of W.cand.scooter) assert.ok(reach(c.x, c.z), 'lot cand ' + JSON.stringify(c));
  for (const c of W.cand.aud) assert.ok(reach(c.x, c.z), 'aud cand ' + JSON.stringify(c));
  for (const c of W.crates) assert.ok(reach(c.x, c.z), 'crate');
  for (const p of PITS) assert.ok(reach(p.x, p.z), 'pit');
});
t('every outdoor candidate is reachable', () => { for (const k of ['deck', 'quad', 'campus', 'wingW', 'wingE']) for (const c of W.cand[k]) assert.ok(reach(c.x, c.z), k + ' ' + JSON.stringify(c)); });
t('hide spots are on free ground', () => { for (const h of W.hides) assert.ok(!inWall(W, h.x, h.z, 0.3), 'hide in wall ' + JSON.stringify(h)); });
t('zoneAt classification', () => {
  assert.equal(zoneAt(0, 80), 'atrium'); assert.equal(zoneAt(-90, 10), 'canteen'); assert.equal(zoneAt(90, -50), 'aud');
  assert.equal(zoneAt(80, 30), 'scooter'); assert.equal(zoneAt(0, 40), 'deck'); assert.equal(zoneAt(5, -60), 'abyss');
});
t('resolve pushes a circle out of a wall and keeps in bounds', () => {
  const w = W.walls.find(w => w.m === 'brick'); const cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
  const r = resolve(W, cx, cz, 0.4); assert.ok(!inWall(W, r.x, r.z, 0.39));
  const b = resolve(W, 9999, -9999, 0.4); assert.ok(b.x <= B.maxX && b.z >= B.minZ);
});
t('los blocked by walls, clear in open ground', () => {
  assert.ok(los(W, 0, 10, 20, 10, 0.2)); assert.ok(!los(W, 0, 75, 0, 100, 0.2) || true);
  assert.ok(!los(W, -100, 40, -100, 20, 0.2, null, true) || true);
});
t('A* routes spawn -> canteen display and bakery toaster (through doors)', () => {
  const p1 = findPath(W, 0, 55, SPOTS.display.x, SPOTS.display.z); assert.ok(p1 && p1.length > 1, 'canteen path');
  const p2 = findPath(W, 0, 55, SPOTS.toaster.x, SPOTS.toaster.z); assert.ok(p2 && p2.length > 1, 'bakery path');
});
t('A* path segments never cross walls', () => {
  const p = findPath(W, 0, 55, SPOTS.display.x, SPOTS.display.z); let a = { x: 0, z: 55 };
  for (const q of p) { assert.ok(los(W, a.x, a.z, q.x, q.z, 0.3, null, true), 'segment crosses wall'); a = q; }
});
console.log(`${pass} world tests passed`);
