// Engine tests: rooms, permissions, authoritative pickups, scoring, all five modes, detector, chat, reconnects.
// Uses a fake clock so round timers are verified deterministically (no sleeping).
import assert from 'node:assert/strict';
import { Hub } from '../public/shared/engine.js';
import { generateWorld, pickHiddenSpot, isReachable, mulberry32, MAPS } from '../public/shared/world.js';

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
  const make = (n, mode = 'classic', settings = {}) => {
    const a = client('Alice'); a.send({ t: 'create', name: 'Alice' });
    const code = a.last('joined').code;
    const rest = [];
    for (let i = 1; i < n; i++) { const c = client('Bob' + i); c.send({ t: 'join', code, name: 'Bob' + i }); rest.push(c); }
    a.send({ t: 'settings', mode, duration: 60, ...settings });
    for (const c of rest) c.send({ t: 'ready', v: true });
    return { a, rest, all: [a, ...rest], code, room: hub.rooms.get(code) };
  };
  // move a player via legitimate position messages (server enforces speed limits)
  const moveTo = (c, x, z) => {
    for (let i = 0; i < 60; i++) {
      const q = c.p.pos; const dx = x - q.x, dz = z - q.z, d = Math.hypot(dx, dz);
      if (d < 0.05) return;
      const step = Math.min(d, 9); adv(1000);
      c.send({ t: 'pos', x: q.x + dx / d * step, z: q.z + dz / d * step, y: 0, yaw: 0, pitch: 0, f: 1 });
    }
  };
  const toPlaying = room => { adv(3100); assert.equal(room.phase, 'playing'); };
  const doSearch = (c, secs = 2.6) => { c.send({ t: 'search_start' }); adv(secs * 1000); c.send({ t: 'search_finish' }); return c.last('search_result'); };
  return { hub, adv, client, make, moveTo, toPlaying, doSearch, now: () => clock };
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
  assert.equal(a.room.settings.mode, 'classic'); assert.equal(a.room.settings.locked, false);
});

await test('duplicate names are made unique and bad names are refused', () => {
  const env = makeEnv(); const a = env.client(); a.send({ t: 'create', name: 'Sam' }); const code = a.last('joined').code;
  const b = env.client(); b.send({ t: 'join', code, name: 'sam' });
  assert.notEqual(a.p.name.toLowerCase(), b.p.name.toLowerCase());
  const c = env.client(); c.send({ t: 'join', code, name: 'xxfuckxx' }); assert.equal(c.last('err').code, 'NAME_BAD');
});

await test('start requires enough players, ready status; solo only when the host allows it', () => {
  const env = makeEnv(); const a = env.client(); a.send({ t: 'create', name: 'Solo' });
  a.send({ t: 'start' }); assert.equal(a.last('err').code, 'TOO_FEW');
  a.send({ t: 'settings', soloAllowed: true, duration: 60 }); a.clear(); a.send({ t: 'start' }); assert.equal(a.room.phase, 'countdown');
  const e2 = makeEnv(); const g = e2.make(2); g.rest[0].send({ t: 'ready', v: false }); g.a.send({ t: 'start' });
  assert.equal(g.a.last('err').code, 'NOT_READY'); assert.equal(g.room.phase, 'lobby');
  const e3 = makeEnv(); const h = e3.make(2, 'hideseek', { soloAllowed: true }); h.rest[0].conn.player.connected = false; h.a.send({ t: 'start' });
  assert.equal(h.a.last('err').code, 'TOO_FEW');
});

await test('needle coordinates are never sent to clients before it is uncovered', () => {
  const env = makeEnv(); const g = env.make(2); g.a.send({ t: 'start' }); env.toPlaying(g.room); env.adv(5000);
  const n = g.room.round.needles[0];
  for (const c of g.all) {
    const s = JSON.stringify(c.log);
    assert.ok(!s.includes(n.x.toFixed(3)) && !s.includes(String(n.x).slice(0, 8)), 'needle x leaked');
    assert.ok(!c.log.some(m => m.t === 'reveal'));
    const rm = c.last('round'); assert.ok(rm.seed && !('needles' in rm) && !('items' in rm));
  }
});

await test('round timers are authoritative: countdown -> playing -> timeout', () => {
  const env = makeEnv(); const g = env.make(2, 'classic', { duration: 5 }); g.a.send({ t: 'start' });
  assert.equal(g.room.phase, 'countdown'); env.adv(2000); assert.equal(g.room.phase, 'countdown'); env.adv(1200); assert.equal(g.room.phase, 'playing');
  env.adv(4000); assert.equal(g.room.phase, 'playing'); env.adv(1500); assert.equal(g.room.phase, 'results');
  const r = g.a.last('results'); assert.equal(r.reason, 'timeout'); assert.deepEqual(r.winners, []); assert.equal(r.needles.length, 1);
  for (const c of g.all) assert.ok(c.last('results'));
});

await test('players cannot teleport: impossible moves are clamped and corrected', () => {
  const env = makeEnv(); const g = env.make(2); g.a.send({ t: 'start' }); env.toPlaying(g.room);
  const p = g.a.p, x0 = p.pos.x, z0 = p.pos.z; env.adv(100);
  g.a.send({ t: 'pos', x: x0 + 60, y: 0, z: z0, yaw: 0, pitch: 0, f: 0 });
  assert.ok(Math.abs(p.pos.x - x0) < 3, 'moved too far: ' + (p.pos.x - x0)); assert.ok(g.a.last('tp'));
});

await test('frozen during countdown; positions out of arena are clamped', () => {
  const env = makeEnv(); const g = env.make(2); g.a.send({ t: 'start' }); const x0 = g.a.p.pos.x;
  env.adv(500); g.a.send({ t: 'pos', x: x0 + 1, y: 0, z: g.a.p.pos.z, yaw: 0, pitch: 0, f: 0 }); assert.equal(g.a.p.pos.x, x0);
  env.toPlaying(g.room);
  for (let i = 0; i < 40; i++) { env.adv(1000); g.a.send({ t: 'pos', x: 9999, y: 0, z: 0, yaw: 0, pitch: 0, f: 0 }); }
  assert.ok(Math.abs(g.a.p.pos.x) <= g.room.round.world.half);
});

await test('search must run its full duration; searching away from hay is refused', () => {
  const env = makeEnv(); const g = env.make(2); g.a.send({ t: 'start' }); env.toPlaying(g.room);
  g.a.send({ t: 'search_start' }); assert.equal(g.a.last('search_denied')?.why, 'nopile'); // spawn points are clear of hay
  const w = g.room.round.world, pile = w.piles[0]; env.moveTo(g.a, pile.x, pile.z);
  g.a.clear(); g.a.send({ t: 'search_start' }); assert.ok(g.a.last('search_started'));
  env.adv(300); g.a.send({ t: 'search_finish' }); assert.equal(g.a.last('search_denied')?.why, 'early');
  env.adv(3000); g.a.send({ t: 'search_finish' }); const r = g.a.last('search_result'); assert.ok(['nothing', 'decoy', 'needle'].includes(r.result));
});

await test('classic: first valid pickup wins, scores are server-side, second pickup is refused', () => {
  const env = makeEnv(); const g = env.make(2); const [A, B] = g.all; A.send({ t: 'start' }); env.toPlaying(g.room);
  const n = g.room.round.needles[0];
  // a client claiming a pickup without uncovering it is refused
  B.send({ t: 'pickup', id: n.id }); assert.equal(B.last('pickup_fail')?.why, 'hidden'); assert.equal(g.room.phase, 'playing');
  env.moveTo(A, n.x, n.z); env.moveTo(B, n.x, n.z);
  const ra = env.doSearch(A); assert.equal(ra.result === 'needle' || ra.result === 'decoy', true);
  let tries = 0; while (!A.p.exposed.has(n.id) && tries++ < 6) env.doSearch(A);
  assert.ok(A.p.exposed.has(n.id), 'needle never uncovered'); assert.ok(A.last('reveal'));
  B.p.exposed.add(n.id); // simulate B also having uncovered it (simultaneous race)
  env.moveTo(A, n.x + 1, n.z); A.clear(); B.clear();
  A.send({ t: 'pickup', id: n.id }); B.send({ t: 'pickup', id: n.id });
  assert.equal(g.room.phase, 'results');
  const res = A.last('results'), resB = B.last('results');
  assert.deepEqual(res.winners, [A.id]); assert.deepEqual(resB.winners, [A.id]); assert.equal(res.finderName, 'Alice');
  assert.ok(A.p.stats.roundScore >= 100); assert.equal(B.p.stats.roundScore, 0); assert.equal(B.last('pickup_fail').why, 'late');
  assert.equal(A.p.stats.wins, 1); assert.equal(B.p.stats.losses, 1);
});

await test('pickup out of range is refused even when uncovered', () => {
  const env = makeEnv(); const g = env.make(2); const [A] = g.all; A.send({ t: 'start' }); env.toPlaying(g.room);
  const n = g.room.round.needles[0]; A.p.exposed.add(n.id); env.moveTo(A, n.x + 12, n.z);
  A.send({ t: 'pickup', id: n.id }); assert.equal(A.last('pickup_fail').why, 'range'); assert.equal(g.room.phase, 'playing');
});

await test('a new round starts in the same room without reconnecting; streak bonus applies', () => {
  const env = makeEnv(); const g = env.make(2); const [A] = g.all;
  const win = () => {
    A.send({ t: 'start' }); env.toPlaying(g.room); const n = g.room.round.needles[0]; env.moveTo(A, n.x + 1, n.z);
    A.p.exposed.add(n.id); A.send({ t: 'pickup', id: n.id }); assert.equal(g.room.phase, 'results');
  };
  win(); const s1 = A.p.stats.roundScore; assert.equal(s1, 100);
  const seed1 = g.room.round.seed; win(); assert.notEqual(g.room.round.seed, seed1); assert.equal(A.p.stats.roundScore, 110); assert.equal(A.p.stats.bestStreak, 2); assert.equal(A.p.stats.score, 210);
  assert.equal(g.room.roundCount, 2);
});

await test('team hunt: two needles, team-only exposure, 75 points to each eligible teammate', () => {
  const env = makeEnv(); const g = env.make(4, 'team'); const [A, B, C, D] = g.all; A.send({ t: 'start' }); env.toPlaying(g.room);
  const teams = g.all.map(c => c.p.team); assert.equal(teams.filter(t => t === 0).length, 2); assert.equal(teams.filter(t => t === 1).length, 2);
  const r = g.room.round; assert.equal(r.needles.length, 2);
  const mine = r.needles.find(n => n.team === A.p.team), theirs = r.needles.find(n => n.team !== A.p.team);
  env.moveTo(A, theirs.x + 1, theirs.z); A.p.exposed.add(theirs.id); A.send({ t: 'pickup', id: theirs.id }); assert.equal(A.last('pickup_fail').why, 'team');
  env.moveTo(A, mine.x + 1, mine.z); A.p.exposed.add(mine.id); A.send({ t: 'pickup', id: mine.id });
  assert.equal(g.room.phase, 'results'); const res = A.last('results'); assert.equal(res.winnerTeam, A.p.team);
  for (const c of g.all) assert.equal(c.p.stats.roundScore, c.p.team === A.p.team ? 75 : 0);
});

await test('golden needle: bigger arena, bonus points, weaker detector', () => {
  const env = makeEnv(); const g = env.make(2, 'golden'); const [A] = g.all; A.send({ t: 'start' }); env.toPlaying(g.room);
  const r = g.room.round; assert.equal(r.mapId, 'goldenfield'); assert.equal(r.world.size, 210); assert.equal(r.needles[0].golden, true);
  assert.ok(r.searchSecs > 2.4);
  env.moveTo(A, r.needles[0].x + 1, r.needles[0].z); A.p.exposed.add(1); A.send({ t: 'pickup', id: 1 }); assert.equal(A.p.stats.roundScore, 250);
});

await test('endless: round continues, new needle placed, highest score wins at timer end', () => {
  const env = makeEnv(); const g = env.make(2, 'endless', { duration: 20 }); const [A, B] = g.all; A.send({ t: 'start' }); env.toPlaying(g.room);
  const n = g.room.round.needles[0], old = { x: n.x, z: n.z, id: n.id };
  env.moveTo(A, n.x + 1, n.z); A.p.exposed.add(n.id); A.send({ t: 'pickup', id: n.id });
  assert.equal(g.room.phase, 'playing'); assert.equal(A.p.stats.roundScore, 100); assert.ok(n.id !== old.id && (n.x !== old.x || n.z !== old.z)); assert.equal(A.p.exposed.size, 0);
  env.adv(25000); assert.equal(g.room.phase, 'results'); const r = A.last('results'); assert.deepEqual(r.winners, [A.id]); assert.equal(r.standings[0].name, 'Alice');
});

await test('hide and seek: hider places the needle, seekers are frozen during setup, hider scores on timeout', () => {
  const env = makeEnv(); const g = env.make(2, 'hideseek', { duration: 10 }); const [A, B] = g.all; A.send({ t: 'start' }); env.adv(3100);
  assert.equal(g.room.phase, 'setup'); const r = g.room.round; const hider = g.all.find(c => c.id === r.hiderId), seeker = g.all.find(c => c !== hider);
  const sx = seeker.p.pos.x; env.adv(500); seeker.send({ t: 'pos', x: sx + 2, y: 0, z: seeker.p.pos.z, yaw: 0, pitch: 0, f: 0 }); assert.equal(seeker.p.pos.x, sx);
  seeker.send({ t: 'place_needle' }); assert.equal(seeker.last('err').code, 'BAD_ACTION');
  hider.clear(); hider.send({ t: 'place_needle' }); assert.equal(hider.last('placed').ok, false); // spawn is not inside hay
  const pile = r.world.piles.find(p => !p.deep && p.barn < 0); env.moveTo(hider, pile.x, pile.z); hider.send({ t: 'place_needle' });
  const placed = hider.last('placed'); if (placed.ok) assert.equal(r.needles.length, 1);
  env.adv(LIMIT_SETUP()); assert.equal(g.room.phase, 'playing'); assert.equal(r.needles.length, 1);
  hider.send({ t: 'search_start' }); assert.equal(hider.last('search_started'), undefined); // hider cannot hunt
  env.adv(11000); assert.equal(g.room.phase, 'results'); assert.deepEqual(hider.last('results').winners, [hider.id]); assert.equal(hider.p.stats.roundScore, 100);
});
function LIMIT_SETUP() { return 20500; }

await test('hide and seek: if the hider never places it, the server hides it validly', () => {
  const env = makeEnv(); const g = env.make(2, 'hideseek'); g.a.send({ t: 'start' }); env.adv(3100); env.adv(20500);
  assert.equal(g.room.phase, 'playing'); assert.equal(g.room.round.needles.length, 1);
});

await test('metal detector gives distance-based signal without revealing coordinates', () => {
  const env = makeEnv(); const g = env.make(2); const [A] = g.all; A.send({ t: 'start' }); env.toPlaying(g.room);
  const n = g.room.round.needles[0]; g.room.round.items.forEach(i => { i.taken = true; }); /* isolate the needle: decoys also ping the detector */ A.send({ t: 'detector', on: true });
  env.moveTo(A, n.x > 0 ? n.x - 45 : n.x + 45, n.z > 0 ? n.z - 25 : n.z + 25); A.clear(); env.adv(1300);
  const near = () => { env.adv(1300); return A.last('det'); };
  const far = near(); assert.equal(far.s, 0);
  env.moveTo(A, n.x + 1.2, n.z); const close = near(); assert.ok(close.s > 0.5, 'close signal ' + close.s);
  assert.ok(!JSON.stringify(A.log.filter(m => m.t === 'det')).match(/"x"|"z"/)); assert.ok(close.b < 100);
});

await test('detector can be disabled by the host and has a limited battery', () => {
  const env = makeEnv(); const g = env.make(2, 'classic', { detector: 'off' }); const [A] = g.all; A.send({ t: 'start' }); env.toPlaying(g.room);
  A.send({ t: 'detector', on: true }); assert.equal(A.last('err').code, 'DET_OFF');
  const e2 = makeEnv(); const h = e2.make(2); h.a.send({ t: 'start' }); e2.toPlaying(h.room); h.a.send({ t: 'detector', on: true });
  for (let i = 0; i < 31; i++) e2.adv(1000); assert.equal(h.a.p.det.on, false); assert.ok(h.a.p.det.battery < 15);
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
  A.send({ t: 'cosmetic', hat: 'tophat' }); assert.equal(A.last('err').code, 'LOCKED_ITEM'); assert.equal(A.p.cosm.hat, 'straw');
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
  assert.equal(c.room.practice, true); assert.equal(c.room.phase, 'countdown'); assert.ok(c.last('round')); assert.equal(c.room.settings.maxPlayers, 1);
  const x = env.client(); x.send({ t: 'join', code: c.last('joined').code, name: 'Intruder' }); assert.equal(x.last('err').code, 'FULL');
});

await test('worlds are deterministic and every hidden spot is valid on every map', () => {
  for (const mapId of Object.keys(MAPS)) for (let seed = 1; seed <= 15; seed++) {
    const w1 = generateWorld(seed, mapId), w2 = generateWorld(seed, mapId);
    assert.equal(JSON.stringify([w1.piles, w1.solids, w1.spawns]), JSON.stringify([w2.piles, w2.solids, w2.spawns]));
    assert.ok(w1.piles.length > 20 && w1.spawns.length === 12);
    const rng = mulberry32(seed), taken = [];
    for (let i = 0; i < 8; i++) {
      const s = pickHiddenSpot(w1, rng, taken); assert.ok(s, `no spot ${mapId}/${seed}`); taken.push(s);
      assert.ok(Math.abs(s.x) < w1.half - 1 && Math.abs(s.z) < w1.half - 1, 'outside arena');
      assert.ok(isReachable(w1, s.x, s.z), 'unreachable');
      assert.ok(!w1.solids.some(o => s.x > o.minX - 0.5 && s.x < o.maxX + 0.5 && s.z > o.minZ - 0.5 && s.z < o.maxZ + 0.5), 'inside solid');
      assert.ok(!w1.spawns.some(sp => Math.hypot(sp.x - s.x, sp.z - s.z) < 6), 'at spawn');
    }
  }
});

for (const [s, n, e] of results) console.log(s === 'PASS' ? '  ✓' : '  ✗', n, e ? '\n' + e : '');
console.log(`\nengine tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
