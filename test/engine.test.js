// Engine tests: rooms, permissions, authoritative sheep sim, scoring, modes, stun, thunder, chat, reconnects.
// Uses a fake clock so round timers are verified deterministically (no sleeping).
import assert from 'node:assert/strict';
import { Hub } from '../public/shared/engine.js';
import { generateField, sheepCountFor, penAt, resolveCollision } from '../public/shared/field.js';
import { FlockSim, TUNING } from '../public/shared/sim.js';

let passed = 0, failed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; results.push(['PASS', name]); }
  catch (e) { failed++; results.push(['FAIL', name, (e.message + '\n' + e.stack.split('\n').filter(l => l.includes('engine.test')).slice(0,2).join('\n'))]); }
}

function makeEnv(opts = {}) {
  let clock = 1_000_000;
  const hub = new Hub({ now: () => clock, minDuration: 1, ...opts });
  const adv = ms => { clock += ms; hub.tick(); };
  const client = (name = 'P', ip = '1.1.1.1') => {
    const log = [];
    let ident = null;
    const conn = { ip, send: o => { if (o.t === 'joined') ident = o; log.push(o); }, close() { this.closed = true; } };
    hub.attach(conn);
    const c = {
      conn, log, name,
      send: m => hub.handle(conn, m),
      last: t => [...log].reverse().find(m => m.t === t),
      all: t => log.filter(m => m.t === t),
      clear: () => { log.length = 0; },
      get id() { return ident?.you; },
      get token() { return ident?.token; },
      get room() { return conn.room; },
      get p() { return conn.player; },
    };
    return c;
  };
  const make = (n, mode = 'ffa', settings = {}) => {
    const a = client('Alice'); a.send({ t: 'create', name: 'Alice' });
    const code = a.last('joined').code;
    const rest = [];
    for (let i = 1; i < n; i++) { const c = client('Bob' + i); c.send({ t: 'join', code, name: 'Bob' + i }); rest.push(c); }
    a.send({ t: 'settings', mode, duration: 60, ...settings });
    for (const c of rest) c.send({ t: 'ready', v: true });
    return { a, rest, all: [a, ...rest], code, room: hub.rooms.get(code) };
  };
  // Walk a dog with legitimate position messages (the server enforces speed limits).
  const moveTo = (c, x, z) => {
    for (let i = 0; i < 80; i++) {
      const q = c.p.pos; const dx = x - q.x, dz = z - q.z, d = Math.hypot(dx, dz);
      if (d < 0.05) return;
      const step = Math.min(d, 9); adv(1000);
      c.send({ t: 'pos', x: q.x + dx / d * step, z: q.z + dz / d * step, yaw: Math.atan2(-dx, -dz), f: 1 });
    }
  };
  const toPlaying = room => { adv(3100); assert.equal(room.phase, 'playing'); };
  return { hub, adv, client, make, moveTo, toPlaying, now: () => clock };
}

await test('room creation produces a real room with a unique 5-char code', () => {
  const env = makeEnv(); const codes = new Set();
  for (let i = 0; i < 60; i++) { const c = env.client('x', 'ip' + i); c.send({ t: 'create', name: 'Host' + i }); const code = c.last('joined').code; assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/); codes.add(code); }
  assert.equal(codes.size, 60); assert.equal(env.hub.rooms.size, 60);
});

await test('invalid and unknown codes are rejected with clear errors', () => {
  const env = makeEnv(); const c = env.client();
  c.send({ t: 'join', code: 'abc', name: 'Z' }); assert.equal(c.last('err').code, 'BAD_CODE');
  c.send({ t: 'join', code: 'ZZZZZ', name: 'Z' }); assert.equal(c.last('err').code, 'NOT_FOUND');
});

await test('room capacity is enforced', () => {
  const env = makeEnv(); const { a, code } = env.make(1);
  a.send({ t: 'settings', maxPlayers: 2 });
  const b = env.client(); b.send({ t: 'join', code, name: 'B' }); assert.ok(b.last('joined'));
  const c = env.client(); c.send({ t: 'join', code, name: 'C' }); assert.equal(c.last('err').code, 'FULL');
});

await test('12-player rooms fill and the 13th is rejected', () => {
  const env = makeEnv(); const { code } = env.make(12);
  const x = env.client(); x.send({ t: 'join', code, name: 'Late' }); assert.equal(x.last('err').code, 'FULL');
});

await test('only the host can change settings, lock, kick or start', () => {
  const env = makeEnv(); const { a, rest } = env.make(2); const b = rest[0];
  for (const m of [{ t: 'settings', mode: 'golden' }, { t: 'lock', v: true }, { t: 'kick', id: a.id }, { t: 'start' }]) { b.clear(); b.send(m); assert.equal(b.last('err')?.code, 'NOT_HOST', m.t); }
  assert.equal(a.room.settings.mode, 'ffa'); assert.equal(a.room.settings.locked, false);
});

await test('duplicate names are made unique and bad names are refused', () => {
  const env = makeEnv(); const a = env.client(); a.send({ t: 'create', name: 'Sam' }); const code = a.last('joined').code;
  const b = env.client(); b.send({ t: 'join', code, name: 'sam' });
  assert.notEqual(a.p.name.toLowerCase(), b.p.name.toLowerCase());
  const c = env.client(); c.send({ t: 'join', code, name: 'xxfuckxx' }); assert.equal(c.last('err').code, 'NAME_BAD');
});

const run = (env, ms) => { for (let i = 0; i < ms / 50; i++) env.adv(50); };
const place = (room, i, x, z, by = -1) => { const s = room.round.sim.sheep[i]; s.x = x; s.z = z; s.vx = s.vz = 0; s.lastPush = by; s.lastPushT = room.round.sim.time; return s; };
const penOf = (room, slot) => room.round.field.pens[slot];
const start = (n, mode = 'ffa', settings = {}) => { const env = makeEnv(); const g = env.make(n, mode, settings); g.a.send({ t: 'start' }); return { env, g }; };

await test('start requires enough players, ready status; solo only when the host allows it', () => {
  const env = makeEnv(); const a = env.client(); a.send({ t: 'create', name: 'Solo' });
  a.send({ t: 'start' }); assert.equal(a.last('err').code, 'TOO_FEW');
  a.send({ t: 'settings', soloAllowed: true, duration: 60 }); a.clear(); a.send({ t: 'start' }); assert.equal(a.room.phase, 'countdown');
  const e2 = makeEnv(); const g = e2.make(2); g.rest[0].send({ t: 'ready', v: false }); g.a.send({ t: 'start' });
  assert.equal(g.a.last('err').code, 'NOT_READY'); assert.equal(g.room.phase, 'lobby');
});

await test('every player gets their own pen in Roundup, and the round message lets clients rebuild the identical field', () => {
  const { g } = start(4); const room = g.room, r = room.round;
  assert.equal(r.field.pens.length, 4);
  assert.deepEqual(new Set(g.all.map(c => c.p.slot)).size, 4);
  const m = g.rest[0].last('round'); assert.equal(m.mode, 'ffa'); assert.equal(m.phase, 'countdown');
  const again = generateField(m.seed, m.field);
  assert.equal(JSON.stringify(again), JSON.stringify(r.field));
  assert.equal(m.you.slot, g.rest[0].p.slot); assert.equal(m.you.spectator, false);
});

await test('round timers are authoritative: countdown -> playing -> timeout results', () => {
  const env = makeEnv(); const g = env.make(2, 'ffa', { duration: 5, storms: false }); g.a.send({ t: 'start' });
  assert.equal(g.room.phase, 'countdown'); env.adv(2000); assert.equal(g.room.phase, 'countdown'); env.adv(1200); assert.equal(g.room.phase, 'playing');
  run(env, 4000); assert.equal(g.room.phase, 'playing'); run(env, 1500); assert.equal(g.room.phase, 'results');
  const res = g.a.last('results'); assert.equal(res.reason, 'timeout'); assert.deepEqual(res.winners, [], 'nobody penned anything: no winner');
});

await test('dogs cannot teleport: impossible moves are clamped and corrected; countdown freezes dogs', () => {
  const { env, g } = start(2); const [A] = g.all; const sp = { ...A.p.pos };
  A.send({ t: 'pos', x: sp.x + 5, z: sp.z, yaw: 0, f: 1 }); assert.equal(A.p.pos.x, sp.x, 'frozen during countdown');
  env.toPlaying(g.room); env.adv(100);
  A.send({ t: 'pos', x: sp.x + 40, z: sp.z, yaw: 0, f: 1 });
  assert.ok(Math.hypot(A.p.pos.x - sp.x, A.p.pos.z - sp.z) < 3, 'clamped to a believable step'); assert.ok(A.last('tp'));
  A.send({ t: 'pos', x: 9999, z: -9999, yaw: 0, f: 1 }); assert.ok(Math.abs(A.p.pos.x) < 70 && Math.abs(A.p.pos.z) < 70);
  A.send({ t: 'pos', x: NaN, z: 'x', yaw: 0 }); assert.ok(Number.isFinite(A.p.pos.x));
});

await test('dogs cannot walk through walls or hay bales', () => {
  const { env, g } = start(2); env.toPlaying(g.room); const A = g.a, f = g.room.round.field;
  const wall = f.solids.find(s => s.kind === 'bale'); env.adv(200);
  A.p.pos = { x: wall.minX - 3, z: wall.cz, yaw: 0, t: env.now() };
  for (let i = 0; i < 6; i++) { env.adv(200); A.send({ t: 'pos', x: wall.cx, z: wall.cz, yaw: 0, f: 1 }); }
  const q = A.p.pos; assert.ok(!(q.x > wall.minX && q.x < wall.maxX && q.z > wall.minZ && q.z < wall.maxZ), 'dog ended up inside a bale');
});

await test('penning a sheep is decided by the server: owner is credited, scores update, event is broadcast', () => {
  const { env, g } = start(2); env.toPlaying(g.room); const [A, B] = g.all, room = g.room;
  const pen = penOf(room, A.p.slot); g.all.forEach(c => c.clear());
  const s = place(room, 0, pen.cx, pen.cz, A.id); run(env, 200);
  assert.equal(s.pen, A.p.slot);
  const ev = B.all('ev').find(e => e.k === 'penned'); assert.ok(ev, 'rival sees it'); assert.equal(ev.by, A.id); assert.equal(ev.slot, A.p.slot);
  assert.equal(A.p.stats.herded, 1); assert.equal(B.p.stats.herded, 0);
  run(env, 600); const sc = B.last('scores'); assert.equal(sc.pens.find(p => p[0] === A.p.slot)[1], room.round.sim.sheep[0].value);
  assert.equal(sc.players.find(p => p[0] === A.id)[1], room.round.sim.sheep[0].value);
});

await test('a sheep herded into somebody else\'s pen does not credit the herder; moving it between pens is a steal', () => {
  const { env, g } = start(2); env.toPlaying(g.room); const [A, B] = g.all, room = g.room;
  place(room, 1, penOf(room, B.p.slot).cx, penOf(room, B.p.slot).cz, A.id); run(env, 200);
  assert.equal(A.p.stats.herded, 0, 'pushed into the rival\'s pen: no credit');
  A.clear(); B.clear();
  place(room, 1, penOf(room, A.p.slot).cx, penOf(room, A.p.slot).cz, A.id); run(env, 200);
  assert.ok(B.all('ev').some(e => e.k === 'stolen' && e.by === A.id), 'steal broadcast'); assert.equal(A.p.stats.steals, 1);
  assert.equal(room.round.sim.sheep[1].pen, A.p.slot);
});

await test('bark startles sheep in front of the dog, respects its cooldown, and cannot be used during countdown', () => {
  const { env, g } = start(2); const A = g.a, room = g.room;
  A.send({ t: 'bark' }); assert.equal(A.p.stats.barks, 0, 'countdown');
  env.toPlaying(g.room); env.adv(100);
  const q = A.p.pos, fwd = [-Math.sin(q.yaw), -Math.cos(q.yaw)];
  const s = place(room, 2, q.x + fwd[0] * 6, q.z + fwd[1] * 6, -1); const before = Math.hypot(s.x - q.x, s.z - q.z);
  A.send({ t: 'bark' }); assert.equal(A.p.stats.barks, 1); assert.ok(room.round.sim.time >= 0);
  assert.ok(Math.hypot(s.vx, s.vz) > 3, 'sheep bolted'); run(env, 300); assert.ok(Math.hypot(s.x - q.x, s.z - q.z) > before + 1, 'and ran away');
  A.send({ t: 'bark' }); assert.equal(A.p.stats.barks, 1, 'cooldown');
  run(env, 1500); A.send({ t: 'bark' }); assert.equal(A.p.stats.barks, 2);
});

await test('dash barges sheep and stuns a rival dog who is hit; stunned dogs are held in place', () => {
  const { env, g } = start(2); env.toPlaying(g.room); const [A, B] = g.all, room = g.room; env.adv(100);
  B.p.pos = { x: A.p.pos.x + 1.0, z: A.p.pos.z, yaw: 0, t: env.now() };
  B.clear(); A.send({ t: 'dash' }); assert.equal(A.p.stats.dashes, 1); run(env, 100);
  assert.ok(B.last('fx')?.k === 'stun', 'rival stunned'); assert.equal(A.p.stats.bumps, 1);
  const held = { ...B.p.pos }; B.send({ t: 'pos', x: held.x + 2, z: held.z, yaw: 0, f: 1 }); assert.equal(B.p.pos.x, held.x);
  run(env, 1300); env.adv(200); B.send({ t: 'pos', x: held.x + 0.5, z: held.z, yaw: 0, f: 1 }); assert.notEqual(B.p.pos.x, held.x, 'free again');
  A.send({ t: 'dash' }); assert.equal(A.p.stats.dashes, 1, 'dash cooldown');
});

await test('domination: holding most of the flock for 8 seconds ends the round early and the dominator wins', () => {
  const { env, g } = start(2, 'ffa', { duration: 120, storms: false }); env.toPlaying(g.room); const [A, B] = g.all, room = g.room, sim = room.round.sim, pen = penOf(room, A.p.slot);
  sim.sheep.forEach((s, i) => place(room, i, pen.cx + ((i % 6) - 2.5) * 1.2, pen.cz + (Math.floor(i / 6) - 1) * 1.1, A.id));
  run(env, 2500); assert.equal(room.phase, 'playing'); assert.ok(B.all('ev').some(e => e.k === 'dominating'), 'warning sent'); assert.ok(B.last('scores').dom);
  run(env, 8000); assert.equal(room.phase, 'results');
  const res = B.last('results'); assert.equal(res.reason, 'domination'); assert.deepEqual(res.winners, [A.id]); assert.equal(res.standings[0].id, A.id);
});

await test('domination resets when a rival steals enough sheep back', () => {
  const { env, g } = start(2, 'ffa', { duration: 120, storms: false }); env.toPlaying(g.room); const [A, B] = g.all, room = g.room, sim = room.round.sim, pen = penOf(room, A.p.slot), bp = penOf(room, B.p.slot);
  sim.sheep.forEach((s, i) => place(room, i, pen.cx + ((i % 6) - 2.5) * 1.2, pen.cz + (Math.floor(i / 6) - 1) * 1.1, A.id));
  run(env, 3000); assert.ok(room.round.dom);
  for (let i = 0; i < Math.ceil(sim.sheep.length * 0.5); i++) place(room, i, bp.cx + ((i % 6) - 2.5) * 1.2, bp.cz + (Math.floor(i / 6) - 1) * 1.1, B.id);
  run(env, 2500); assert.equal(room.round.dom, null); assert.ok(B.all('ev').some(e => e.k === 'dom_broken')); assert.equal(room.phase, 'playing');
});

await test('solo practice: penning every sheep wins the round', () => {
  const env = makeEnv(); const c = env.client(); c.send({ t: 'create', name: 'Me', practice: true }); env.adv(3100);
  const room = c.room, sim = room.round.sim, pen = penOf(room, 0);
  sim.sheep.forEach((s, i) => place(room, i, pen.cx + ((i % 6) - 2.5) * 1.2, pen.cz + (Math.floor(i / 6) - 1) * 1.1, c.id));
  run(env, 3500); assert.equal(room.phase, 'results'); const res = c.last('results'); assert.equal(res.reason, 'domination'); assert.deepEqual(res.winners, [c.id]); assert.equal(res.solo, true);
});

await test('team roundup: two pens, balanced teams, team score decides the winner', () => {
  const { env, g } = start(4, 'team', { duration: 20 }); const room = g.room, r = room.round;
  assert.equal(r.field.pens.length, 2); const t = g.all.map(c => c.p.team); assert.equal(t.filter(x => x === 0).length, 2); assert.equal(t.filter(x => x === 1).length, 2);
  assert.ok(g.all.every(c => c.p.slot === c.p.team));
  env.toPlaying(room); const pen = penOf(room, 1);
  for (let i = 0; i < 4; i++) place(room, i, pen.cx + i, pen.cz, g.all.find(c => c.p.team === 1).id);
  run(env, 21000); assert.equal(room.phase, 'results'); const res = g.a.last('results');
  assert.equal(res.winnerTeam, 1); assert.deepEqual(new Set(res.winners), new Set(g.all.filter(c => c.p.team === 1).map(c => c.id)));
});

await test('stampede: bigger flock and thunder - a warning, then everything loose bolts', () => {
  const norm = start(2).g.room.round.field.sheep.length; const { env, g } = start(2, 'stampede', { duration: 120 }); const room = g.room;
  assert.ok(room.round.field.sheep.length > norm, 'flock is larger than Roundup'); env.toPlaying(room);
  run(env, 17000); assert.ok(g.a.all('ev').some(e => e.k === 'thunder_warn'), 'warning first');
  const sim = room.round.sim; sim.sheep.forEach(s => { s.vx = s.vz = 0; s.panicUntil = 0; });
  run(env, 12000); assert.ok(g.a.all('ev').some(e => e.k === 'thunder')); assert.ok(sim.sheep.some(s => s.panicUntil > 0));
});

await test('storms setting is off by default in Roundup (no thunder events)', () => {
  const { env, g } = start(2, 'ffa', { duration: 90, storms: false }); env.toPlaying(g.room); run(env, 40000);
  assert.ok(!g.a.all('ev').some(e => e.k === 'thunder' || e.k === 'thunder_warn'));
});

await test('a new round starts in the same room; wins and streaks carry over; settings changes are refused mid-round', () => {
  const { env, g } = start(2, 'ffa', { duration: 100, storms: false }); const [A, B] = g.all, room = g.room;
  env.toPlaying(room); A.send({ t: 'settings', mode: 'stampede' }); assert.equal(A.last('err').code, 'BUSY');
  const win = () => { env.toPlaying(room); const pen = penOf(room, A.p.slot); place(room, 0, pen.cx, pen.cz, A.id); place(room, 1, pen.cx + 1, pen.cz, A.id); run(env, 150000 > 0 ? 100500 : 0); };
  win(); assert.equal(room.phase, 'results'); assert.equal(A.p.stats.wins, 1); assert.equal(B.p.stats.losses, 1); assert.equal(A.p.stats.streak, 1);
  A.send({ t: 'toLobby' }); assert.equal(room.phase, 'lobby'); B.send({ t: 'ready', v: true }); A.send({ t: 'start' }); assert.equal(room.phase, 'countdown');
  assert.equal(room.round.id, 2); win(); assert.equal(A.p.stats.bestStreak, 2); assert.ok(A.p.stats.score >= 2);
});

await test('late joiners take a free pen when one exists, otherwise they spectate; team late-joiners fill the smaller team', () => {
  const { env, g } = start(3, 'ffa'); env.toPlaying(g.room); const room = g.room;
  const x = env.client(); x.send({ t: 'join', code: g.code, name: 'Late' });
  assert.equal(x.last('round').you.spectator, true); assert.equal(x.p.inRound, false);
  env.hub.close(g.all[2].conn); env.adv(46000);
  const y = env.client(); y.send({ t: 'join', code: g.code, name: 'Late2' }); assert.equal(y.last('round').you.spectator, false); assert.ok(y.p.slot >= 0);
  const t = start(3, 'team'); t.env.toPlaying(t.g.room); const z = t.env.client(); z.send({ t: 'join', code: t.g.code, name: 'LateT' }); assert.ok(z.p.team === 0 || z.p.team === 1); assert.equal(z.p.slot, z.p.team);
});

await test('reconnect mid-round restores the same dog, pen and sheep positions', () => {
  const { env, g } = start(2, 'ffa', { storms: false }); env.toPlaying(g.room); run(env, 300); const B = g.rest[0], id = B.id, token = B.token, slot = B.p.slot;
  env.hub.close(B.conn); const B2 = env.client(); B2.send({ t: 'join', code: g.code, name: 'x', token });
  assert.equal(B2.id, id); assert.equal(B2.p.slot, slot); const rm = B2.last('round'); assert.equal(rm.you.slot, slot); assert.equal(rm.phase, 'playing'); assert.ok(B2.last('sheep')); assert.ok(B2.last('scores'));
});

await test('flock simulation is deterministic and sheep never leave the field or enter solids', () => {
  for (const [mode, pens] of [['ffa', 1], ['ffa', 5], ['team', 6]]) for (let seed = 1; seed <= 6; seed++) {
    const f = generateField(seed, { mode, pens, sheep: sheepCountFor(pens, 1, 1) }), a = new FlockSim(f, { seed }), b = new FlockSim(f, { seed });
    const dogs = [{ id: 1, x: 0, z: 0, sprinting: false, dashing: false }];
    for (let i = 0; i < 400; i++) { dogs[0].x = Math.sin(i / 40) * 12; dogs[0].z = Math.cos(i / 40) * 12; a.step(0.05, dogs); b.step(0.05, dogs); }
    assert.equal(JSON.stringify(a.encode()), JSON.stringify(b.encode()));
    for (const s of a.sheep) { assert.ok(Math.abs(s.x) < f.half && Math.abs(s.z) < f.half); const c = resolveCollision(f, s.x, s.z, 0.45); assert.ok(Math.hypot(c.x - s.x, c.z - s.z) < 0.05, 'inside a solid'); }
  }
});

await test('generated fields: valid pens, clear spawns, no overlaps, correct sheep counts, for every player count and mode', () => {
  for (const mode of ['ffa', 'team']) for (let n = 1; n <= 12; n++) for (let seed = 1; seed <= 12; seed++) {
    const total = sheepCountFor(n, 1, 1), f = generateField(seed, { mode, pens: n, sheep: total });
    assert.equal(f.pens.length, mode === 'team' ? 2 : n); assert.equal(f.sheep.length, total, `${mode} ${n} seed ${seed}`);
    for (const p of f.pens) { const c = resolveCollision(f, p.spawn.x, p.spawn.z, 0.5); assert.ok(Math.hypot(c.x - p.spawn.x, c.z - p.spawn.z) < 0.05, `spawn blocked ${mode} ${n} ${seed}`); assert.ok(!penAt(f, p.spawn.x, p.spawn.z)); }
    for (const s of f.sheep) { const c = resolveCollision(f, s.x, s.z, 0.45); assert.ok(Math.hypot(c.x - s.x, c.z - s.z) < 0.05, `sheep in solid ${mode} ${n} ${seed}`); assert.ok(!penAt(f, s.x, s.z), 'sheep starts in a pen'); }
    for (let i = 0; i < f.pens.length; i++) for (let j = i + 1; j < f.pens.length; j++) { const a = f.pens[i].rect, b = f.pens[j].rect; assert.ok(a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ, 'pens overlap'); }
    assert.equal(JSON.stringify(generateField(seed, { mode, pens: n, sheep: total })), JSON.stringify(f), 'deterministic');
  }
});

await test('fairness: every pen sees the same scenery (point-symmetric field) and sheep come in mirrored pairs', () => {
  const f = generateField(5, { mode: 'ffa', pens: 4, sheep: 40 });
  const key = s => [s.kind, ...[s.minX, s.maxX, s.minZ, s.maxZ].map(v => Math.round(v * 10))].join(',');
  const set = new Set(f.solids.filter(s => s.kind !== 'penwall').map(key));
  for (const s of f.solids) if (s.kind !== 'penwall') assert.ok(set.has(key({ kind: s.kind, minX: -s.maxX, maxX: -s.minX, minZ: -s.maxZ, maxZ: -s.minZ })), 'unmirrored ' + s.kind);
  const tot = f.sheep.filter(s => Math.abs(s.x) + Math.abs(s.z) > 0.01); assert.ok(tot.length >= 36);
});

await test('disconnects: host passes to another player; ghost players are removed after the grace period', () => {
  const env = makeEnv(); const g = env.make(3); const [A, B, C] = g.all;
  env.hub.close(A.conn); assert.equal(g.room.hostId, B.id); assert.equal(A.p, null); assert.ok(B.last('notice'));
  env.adv(46000); assert.equal(g.room.players.size, 2); assert.ok(!g.room.dead);
});

await test('reconnect with token restores the same player (and round state) after a drop', () => {
  const env = makeEnv(); const g = env.make(2); const [A, B] = g.all; A.send({ t: 'start' }); env.toPlaying(g.room);
  const id = B.id, token = B.token, score = B.p.stats.score; env.hub.close(B.conn);
  const B2 = env.client(); B2.send({ t: 'join', code: g.code, name: 'whatever', token });
  assert.equal(B2.id, id); assert.equal(B2.last('joined').reconnected, true); assert.ok(B2.last('round')); assert.equal(B2.p.stats.score, score);
});

await test('empty rooms are closed after the grace period', () => {
  const env = makeEnv(); const g = env.make(2); env.hub.close(g.all[0].conn); env.hub.close(g.all[1].conn);
  env.adv(121000); assert.equal(env.hub.rooms.has(g.code), false);
});

await test('kicked players are removed and cannot rejoin (by token or network address); locked rooms refuse new joins but allow reconnects', () => {
  const env = makeEnv(); const a = env.client('Alice', '10.0.0.1'); a.send({ t: 'create', name: 'Alice' }); const code = a.last('joined').code;
  const b = env.client('Bob', '10.0.0.2'); b.send({ t: 'join', code, name: 'Bob' }); const c = env.client('Cy', '10.0.0.3'); c.send({ t: 'join', code, name: 'Cy' });
  const tokB = b.token; a.send({ t: 'kick', id: b.id }); assert.ok(b.last('kicked')); assert.equal(a.room.players.size, 2);
  const b2 = env.client('B2', '10.0.0.2'); b2.send({ t: 'join', code, name: 'Bobby' }); assert.equal(b2.last('err').code, 'BANNED', 'same address, no token');
  const b3 = env.client('B3', '10.9.9.9'); b3.send({ t: 'join', code, name: 'Bob', token: tokB }); assert.equal(b3.last('err').code, 'BANNED', 'old token, new address');
  const ok = env.client('Dee', '10.0.0.4'); ok.send({ t: 'join', code, name: 'Dee' }); assert.ok(ok.last('joined'), 'other players are unaffected');
  a.send({ t: 'lock', v: true }); const d = env.client('D', '10.0.0.5'); d.send({ t: 'join', code, name: 'D' }); assert.equal(d.last('err').code, 'LOCKED');
  const tokC = c.token; env.hub.close(c.conn); const c2 = env.client('C2', '10.0.0.3'); c2.send({ t: 'join', code, name: 'Cy', token: tokC }); assert.ok(c2.last('joined'), 'reconnect still works while locked');
});

await test('chat is sanitised, profanity masked, and spam rate-limited', () => {
  const env = makeEnv(); const g = env.make(2); const [A, B] = g.all; B.clear();
  A.send({ t: 'chat', text: '<b>hello</b> fuck' }); const m = B.last('chat'); assert.ok(!m.text.includes('<') && !m.text.toLowerCase().includes('fuck'));
  A.clear(); B.clear(); for (let i = 0; i < 12; i++) A.send({ t: 'chat', text: 'msg' + i }); assert.ok(B.all('chat').length <= 5); assert.ok(A.last('err')?.code === 'CHAT_RATE');
});

await test('cosmetics are validated; locked items cannot be equipped; no competitive effect', () => {
  const env = makeEnv(); const g = env.make(2); const [A] = g.all;
  A.send({ t: 'cosmetic', hat: 'tophat' }); assert.equal(A.last('err').code, 'LOCKED_ITEM'); assert.equal(A.p.cosm.hat, 'none');
  A.p.stats.herded = 12; A.send({ t: 'cosmetic', hat: 'tophat' }); assert.equal(A.p.cosm.hat, 'tophat', 'unlocked by herding sheep this session');
  A.send({ t: 'cosmetic', hat: 'cap', color: '#2980b9' }); assert.equal(A.p.cosm.hat, 'cap'); assert.equal(A.p.cosm.color, '#2980b9');
  A.send({ t: 'cosmetic', color: 'javascript:alert(1)' }); assert.equal(A.p.cosm.color, '#2980b9');
});

await test('message flooding is rate limited per connection', () => {
  const env = makeEnv(); const c = env.client(); for (let i = 0; i < 600; i++) c.send({ t: 'ping', c: i });
  assert.ok(c.all('pong').length <= 100, 'processed ' + c.all('pong').length);
});

await test('room creation is rate limited per IP', () => {
  const env = makeEnv(); let refused = 0;
  for (let i = 0; i < 10; i++) { const c = env.client('x', '9.9.9.9'); c.send({ t: 'create', name: 'S' + i }); if (c.last('err')?.code === 'RATE_LIMIT') refused++; }
  assert.ok(refused >= 3);
});

await test('Play Online matchmaking joins an open public lobby, otherwise opens a new public room', () => {
  const env = makeEnv(); const a = env.client('a', 'ip1'); a.send({ t: 'quick', name: 'One' }); const code = a.last('joined').code; assert.equal(a.room.isPublic, true);
  const b = env.client('b', 'ip2'); b.send({ t: 'quick', name: 'Two' }); assert.equal(b.last('joined').code, code); assert.equal(env.hub.rooms.size, 1);
  const priv = env.client('p', 'ip3'); priv.send({ t: 'create', name: 'Priv' }); const c = env.client('c', 'ip4'); c.send({ t: 'quick', name: 'Three' });
  assert.equal(c.last('joined').code, code); assert.notEqual(priv.last('joined').code, code); // private rooms are never matched
  a.send({ t: 'lock', v: true }); const d = env.client('d', 'ip5'); d.send({ t: 'quick', name: 'Four' }); assert.notEqual(d.last('joined').code, code);
});

await test('practice mode: solo room auto-starts with no other players and its own state', () => {
  const env = makeEnv(); const c = env.client(); c.send({ t: 'create', name: 'Me', practice: true, difficulty: 'easy' });
  assert.equal(c.room.practice, true); assert.equal(c.room.phase, 'countdown'); assert.ok(c.last('round')); assert.equal(c.room.settings.maxPlayers, 1); assert.equal(c.room.settings.mode, 'ffa');
  const x = env.client(); x.send({ t: 'join', code: c.last('joined').code, name: 'Intruder' }); assert.equal(x.last('err').code, 'FULL');
});

for (const [s, n, e] of results) console.log(s === 'PASS' ? '  ✓' : '  ✗', n, e ? '\n' + e : '');
console.log(`\nengine tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
