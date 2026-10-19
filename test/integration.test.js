// Integration tests: real HTTP + WebSocket server, independent client sockets (Node's built-in WebSocket client).
// Player actions all go over the network. The only white-box shortcut: the test reads the server's hidden needle
// position (to know where to stand) and places players near it, because walking 80 m in real time would be slow.
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';

const { server, hub } = createServer({ minDuration: 1 });
// All test sockets share 127.0.0.1, so kick-bans (which include the address) would hit later tests; clear them as we go.
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port, base = `http://127.0.0.1:${port}`, wsUrl = `ws://127.0.0.1:${port}/ws`;

let passed = 0, failed = 0; const out = [];
async function test(name, fn) {
  try { await fn(); passed++; out.push(['  ✓', name]); } catch (e) { failed++; out.push(['  ✗', name + '\n' + e.message + '\n' + (e.stack.split('\n').find(l => l.includes('integration.test')) || '')]); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.waiters = []; }
  async connect() {
    this.ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'joined') { this.you = m.you; this.token = m.token; this.code = m.code; } this.msgs.push(m); this.waiters = this.waiters.filter(w => !w(m)); };
    this.closed = new Promise(r => { this.ws.onclose = () => r(true); });
    return this;
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  last(t) { return [...this.msgs].reverse().find(m => m.t === t); }
  waitFor(pred, ms = 4000, label = '') {
    const f = typeof pred === 'string' ? (t => m => m.t === t)(pred) : pred;
    const hit = this.msgs.find(f); if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`timeout waiting for ${label || pred} (${this.name})`)), ms);
      this.waiters.push(m => { if (f(m)) { clearTimeout(to); res(m); return true; } return false; });
    });
  }
  fresh(t, ms = 4000) { const n = this.msgs.length; return this.waitFor(m => m.t === t && this.msgs.indexOf(m) >= n, ms, t); }
  close() { this.ws.close(); }
}

async function getJSON(p) { const r = await fetch(base + p); return { status: r.status, body: await r.text(), type: r.headers.get('content-type') }; }

await test('HTTP: health endpoint, game page, invite-link route, traversal protection', async () => {
  const h = await getJSON('/health'); assert.equal(h.status, 200); assert.equal(JSON.parse(h.body).ok, true);
  const idx = await getJSON('/'); assert.equal(idx.status, 200); assert.match(idx.type, /html/); assert.match(idx.body, /FLOCK RUSH/i);
  const inv = await getJSON('/r/ABCDE'); assert.equal(inv.status, 200); assert.equal(inv.body, idx.body);
  assert.equal((await getJSON('/shared/engine.js')).status, 200);
  const trav = await getJSON('/..%2fserver%2findex.js'); assert.ok([403, 404].includes(trav.status)); assert.ok(!trav.body.includes('createServer'));
  assert.equal((await getJSON('/nope')).status, 404);
});

await test('WS: only /ws upgrades; garbage input does not crash the server', async () => {
  const bad = new WebSocket(`ws://127.0.0.1:${port}/other`); await new Promise(r => { bad.onerror = r; bad.onclose = r; });
  const c = await new Client('junk').connect(); c.ws.send('not json'); c.ws.send('{"t":123}'); c.ws.send('[]'); c.ws.send(JSON.stringify({ t: 'pos', x: 'a' }));
  c.send({ t: 'ping', c: 1 }); await c.waitFor('pong'); c.close();
});

await test('cross-origin WebSocket upgrades are refused; same-origin ones work', async () => {
  const net = await import('node:net');
  const probe = origin => new Promise(res => { const s = net.connect(port, '127.0.0.1', () => { s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${origin ? 'Origin: ' + origin + '\r\n' : ''}\r\n`); }); let d = ''; s.on('data', c => { d += c; if (d.includes('\r\n\r\n')) { s.destroy(); res(d.split('\r\n')[0]); } }); s.on('error', () => res('error')); setTimeout(() => { s.destroy(); res('timeout'); }, 2000); });
  assert.match(await probe('https://evil.example'), /403/); assert.match(await probe(`http://127.0.0.1:${port}`), /101/); assert.match(await probe(null), /101/);
});

await test('invalid room code and unknown room are rejected over the wire', async () => {
  const c = await new Client('x').connect(); c.send({ t: 'join', code: 'ZZZZZ', name: 'X' });
  const e = await c.waitFor('err'); assert.equal(e.code, 'NOT_FOUND'); c.close();
});

let host, guest, code, round1;

await test('two independent sessions: create private room, friend joins via the invite code', async () => {
  host = await new Client('Host').connect(); host.send({ t: 'create', name: 'Alice' });
  const j = await host.waitFor('joined'); code = j.code; assert.match(code, /^[A-Z2-9]{5}$/);
  guest = await new Client('Guest').connect(); guest.send({ t: 'join', code: code.toLowerCase(), name: 'Bob' });
  await guest.waitFor('joined');
  const room = await host.waitFor(m => m.t === 'room' && m.players.length === 2, 3000, 'room with 2 players');
  assert.deepEqual(room.players.map(p => p.name).sort(), ['Alice', 'Bob']); assert.equal(room.hostId, host.you);
  const gr = await guest.waitFor(m => m.t === 'room' && m.players.length === 2); assert.equal(gr.code, code);
  host.send({ t: 'settings', mode: 'ffa', duration: 6, difficulty: 'easy', storms: false });
  await host.waitFor(m => m.t === 'room' && m.settings.duration === 6 && m.settings.difficulty === 'easy');
});

await test('lobby: guest cannot start; host must wait for ready, then start', async () => {
  guest.send({ t: 'start' }); assert.equal((await guest.waitFor('err')).code, 'NOT_HOST');
  host.send({ t: 'start' }); const e = await host.fresh('err'); assert.equal(e.code, 'NOT_READY');
  guest.send({ t: 'ready', v: true }); await host.waitFor(m => m.t === 'room' && m.players.find(p => p.id === guest.you)?.ready);
});

await test('match starts: both clients get the same shared field seed, their own pens, and the same sheep count', async () => {
  host.send({ t: 'start' });
  const [a, b] = await Promise.all([host.waitFor('round'), guest.waitFor('round')]);
  assert.equal(a.seed, b.seed); assert.equal(a.mode, 'ffa'); assert.equal(a.phase, 'countdown'); assert.deepEqual(a.field, b.field);
  assert.ok(a.you.slot >= 0 && b.you.slot >= 0 && a.you.slot !== b.you.slot, 'different pens');
  assert.ok(a.you.spawn && b.you.spawn && (a.you.spawn.x !== b.you.spawn.x || a.you.spawn.z !== b.you.spawn.z)); round1 = a;
  const pa = await host.waitFor(m => m.t === 'phase' && m.phase === 'playing', 5000, 'playing'); assert.ok(pa.remainingMs <= 6000);
  await guest.waitFor(m => m.t === 'phase' && m.phase === 'playing');
});

await test('the flock is streamed to both clients, and both see the same positions', async () => {
  const [sa, sb] = await Promise.all([host.fresh('sheep'), guest.fresh('sheep')]);
  assert.equal(sa.s.length, a_len(round1) * 4); assert.equal(sb.s.length, sa.s.length);
});
function a_len(r) { return r.field.sheep; }

await test('movement is synchronised: each player sees the other dog in the shared field', async () => {
  const room = hub.rooms.get(code), A = room.players.get(host.you);
  const sx = A.pos.x, sz = A.pos.z, dir = A.pos.z > 0 ? -1 : 1;
  for (let i = 1; i <= 6; i++) { host.send({ t: 'pos', x: sx, z: sz + dir * i * 0.3, yaw: 1.25, f: 1 }); await sleep(70); }
  const snap = await guest.waitFor(m => m.t === 'snap' && m.p.some(r => r[0] === host.you && Math.abs(r[2] - (sz + dir * 1.8)) < 0.06), 3000, 'snap with host moved');
  const row = snap.p.find(r => r[0] === host.you); assert.equal(row[3], 1.25); assert.equal(row[4] & 1, 1);
  const B = room.players.get(guest.you); guest.send({ t: 'pos', x: B.pos.x + 0.4, z: B.pos.z, yaw: 2, f: 0 });
  await host.waitFor(m => m.t === 'snap' && m.p.some(r => r[0] === guest.you && r[3] === 2), 3000, 'snap with guest');
});

await test('bark is validated by the server and visible to both dogs; sheep react', async () => {
  const room = hub.rooms.get(code), A = room.players.get(host.you), sim = room.round.sim;
  const s = sim.sheep[0]; const fwd = [-Math.sin(A.pos.yaw), -Math.cos(A.pos.yaw)]; s.x = A.pos.x + fwd[0] * 5; s.z = A.pos.z + fwd[1] * 5; s.vx = s.vz = 0;
  host.send({ t: 'bark' }); await guest.waitFor(m => m.t === 'ev' && m.k === 'bark' && m.id === host.you, 2000, 'bark event');
  assert.ok(Math.hypot(s.vx, s.vz) > 2, 'sheep startled'); assert.equal(A.stats.barks, 1);
  host.send({ t: 'bark' }); await sleep(100); assert.equal(A.stats.barks, 1, 'cooldown holds over the wire');
});

await test('penning a sheep is announced to everyone and scores match on both clients', async () => {
  const room = hub.rooms.get(code), A = room.players.get(host.you), sim = room.round.sim, pen = room.round.field.pens[A.slot];
  const s = sim.sheep[3]; s.x = pen.cx; s.z = pen.cz; s.vx = s.vz = 0; s.lastPush = A.id; s.lastPushT = sim.time;
  const ev = await guest.waitFor(m => m.t === 'ev' && m.k === 'penned' && m.sheep === 3, 3000, 'penned event'); assert.equal(ev.by, host.you); assert.equal(ev.slot, A.slot);
  const ok = m => m.t === 'scores' && m.pens.find(p => p[0] === A.slot)[1] >= s.value;
  const [ha, ga] = await Promise.all([host.waitFor(ok, 3000, 'host scores'), guest.waitFor(ok, 3000, 'guest scores')]);
  assert.deepEqual(ha.pens.map(p => p[0]), ga.pens.map(p => p[0]));
});

await test('round timer expiry is decided by the server; both clients get the same results', async () => {
  const [ra, rb] = await Promise.all([host.fresh('results', 12000), guest.fresh('results', 12000)]);
  assert.equal(ra.reason, 'timeout'); assert.deepEqual(ra.winners, rb.winners); assert.equal(ra.winners.length, 1, 'whoever has the most sheep penned wins'); assert.equal(ra.winners[0], host.you);
  assert.deepEqual(ra.standings.map(x => [x.id, x.roundScore]), rb.standings.map(x => [x.id, x.roundScore])); assert.ok(ra.standings[0].roundScore >= 1);
});

await test('another round starts in the same room without reconnecting; new field seed', async () => {
  host.send({ t: 'toLobby' }); await host.waitFor('lobby'); guest.send({ t: 'ready', v: true });
  await host.waitFor(m => m.t === 'room' && m.phase === 'lobby' && m.players.find(p => p.id === guest.you)?.ready, 3000, 'ready again');
  host.send({ t: 'start' });
  const r2 = await host.fresh('round'); const g2 = await guest.fresh('round');
  assert.equal(r2.seed, g2.seed); assert.notEqual(r2.seed, round1.seed); assert.equal(hub.rooms.get(code).roundCount, 2);
  await host.fresh('results', 12000);
});

await test('reconnect: dropped player rejoins with the stored token and keeps their identity and score', async () => {
  const id = guest.you, token = guest.token; guest.close(); await guest.closed;
  await host.waitFor(m => m.t === 'notice' && /disconnected/.test(m.text));
  const g2 = await new Client('Guest2').connect(); g2.send({ t: 'join', code, name: 'ignored', token });
  const j = await g2.waitFor('joined'); assert.equal(j.you, id); assert.equal(j.reconnected, true);
  const room = await g2.waitFor('room'); assert.equal(room.players.length, 2); assert.ok(room.players.every(p => p.connected));
  guest = g2;
});

await test('host disconnect transfers host to the remaining player', async () => {
  host.close(); await host.closed;
  const r = await guest.waitFor(m => m.t === 'room' && m.hostId === guest.you, 3000, 'host transfer'); assert.equal(r.hostId, guest.you);
  await guest.waitFor(m => m.t === 'notice' && /host/.test(m.text));
});

await test('kick works over the wire and the kicked socket is closed', async () => {
  const third = await new Client('Third').connect(); third.send({ t: 'join', code, name: 'Carol' }); await third.waitFor('joined');
  await guest.waitFor(m => m.t === 'room' && m.players.some(p => p.name === 'Carol'));
  const carol = [...hub.rooms.get(code).players.values()].find(p => p.name === 'Carol');
  guest.send({ t: 'kick', id: carol.id }); await third.waitFor('kicked'); assert.equal(await third.closed, true);
  hub.rooms.get(code).bannedIps.clear(); hub.rooms.get(code).banned.clear();
});

await test('oversized frames drop the connection; message floods are throttled', async () => {
  const c = await new Client('big').connect(); c.ws.send('x'.repeat(200 * 1024)); assert.equal(await Promise.race([c.closed, sleep(2000).then(() => false)]), true);
  const f = await new Client('flood').connect(); for (let i = 0; i < 700; i++) f.send({ t: 'ping', c: i }); await sleep(400);
  assert.ok(f.msgs.filter(m => m.t === 'pong').length <= 120, 'pongs: ' + f.msgs.filter(m => m.t === 'pong').length); f.close();
});

await test('solo practice-style room works over the wire and a locked room refuses newcomers', async () => {
  const s = await new Client('solo').connect(); s.send({ t: 'create', name: 'Solo', practice: true }); const r = await s.waitFor('round'); assert.equal(r.mode, 'ffa');
  const intruder = await new Client('in').connect(); intruder.send({ t: 'join', code: s.code, name: 'Z' }); assert.equal((await intruder.waitFor('err')).code, 'FULL');
  guest.send({ t: 'lock', v: true }); await guest.waitFor(m => m.t === 'room' && m.settings.locked);
  const late = await new Client('late').connect(); late.send({ t: 'join', code, name: 'Late' }); assert.equal((await late.waitFor('err')).code, 'LOCKED');
  s.close(); intruder.close(); late.close();
});

await test('server health reflects live rooms and players', async () => {
  const h = JSON.parse((await getJSON('/health')).body); assert.ok(h.rooms >= 1 && h.players >= 1 && h.roomsCreated >= 2);
});

guest?.close();
for (const [s, n] of out) console.log(s, n);
console.log(`\nintegration tests: ${passed} passed, ${failed} failed`);
server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 100);
