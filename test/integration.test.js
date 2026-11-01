// Integration: real HTTP + WebSocket server, two independent clients, full lobby -> countdown -> game start -> moves -> snapshots.
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';

const { server } = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port, base = `http://127.0.0.1:${port}`, wsUrl = `ws://127.0.0.1:${port}/ws`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.msgs = []; }
  async connect() {
    this.ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'joined') { this.you = m.you; this.code = m.code; } this.msgs.push(m); };
    return this;
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async waitFor(f, ms = 8000, label = '') { const t0 = Date.now(); while (Date.now() - t0 < ms) { const h = this.msgs.find(f); if (h) return h; await sleep(40); } throw new Error(`timeout: ${label} (${this.name})`); }
}
let ok = 0;
const step = (n) => { ok++; console.log('  ✓', n); };

const h = await (await fetch(base + '/health')).json();
assert.equal(h.ok, true); step('health');
const page = await (await fetch(base + '/')).text();
assert.match(page, /NIGHT SHIFT/i); step('index served');

const a = await new Client('Alice').connect(), b = await new Client('Bob').connect();
a.send({ t: 'create', name: 'Alice', hat: 'none' });
await a.waitFor(m => m.t === 'joined', 3000, 'joined A');
assert.match(a.code, /^[A-Z0-9]{5}$/); step('room created ' + a.code);
b.send({ t: 'join', code: a.code, name: 'Bob', hat: 'crown' });
await b.waitFor(m => m.t === 'joined', 3000, 'joined B');
await a.waitFor(m => m.t === 'room' && m.players?.length === 2, 3000, 'room has 2'); step('second player joined');
b.send({ t: 'ready', v: true });
a.send({ t: 'start' });
await a.waitFor(m => m.t === 'start', 12000, 'start A'); await b.waitFor(m => m.t === 'start', 12000, 'start B');
step('countdown -> both received start');
a.send({ t: 'pos', x: 0, z: 79, yaw: 3.14, pitch: 0 }); b.send({ t: 'pos', x: 2, z: 79, yaw: 3.14, pitch: 0 });
await sleep(800);
const snap = a.msgs.filter(m => m.t === 's' || m.t === 'snap').pop();
assert.ok(snap, 'got snapshots'); step('snapshots streaming');
a.send({ t: 'chat', text: 'hello' });
a.ws.close(); b.ws.close();
await sleep(100);
server.close(); step('clean shutdown');
console.log(`${ok} passed`); process.exit(0);
