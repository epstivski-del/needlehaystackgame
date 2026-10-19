// E2E harness: the REAL production server plus a separate test-only debug port (never part of the deployed app).
import { createServer } from '../../server/index.js';
import http from 'node:http';
const { server, hub } = createServer({ minDuration: 1 });
const port = Number(process.env.PORT || 3200);
server.listen(port, '127.0.0.1', () => console.log('READY', port));
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), q = k => u.searchParams.get(k), room = hub.rooms.get(q('code'));
  res.setHeader('Content-Type', 'application/json');
  if (!room) return res.end('{"err":"noroom"}');
  const r = room.round;
  if (u.pathname === '/state') return res.end(JSON.stringify({ phase: room.phase, mode: room.settings.mode, round: r?.id, pens: r && r.field.pens.map(p => [p.slot, r.sim.penValue(p.slot), r.sim.penCount(p.slot)]), total: r?.sim.totalValue(), sheep: r?.sim.sheep.length }));
  if (u.pathname === '/settings') { if (q('duration')) room.settings.duration = +q('duration'); return res.end('{}'); }
  // white-box shortcut: drop N sheep straight into a pen so the test does not have to herd for minutes
  if (u.pathname === '/pen') { const pen = r.field.pens[+q('slot')], n = +q('n'); r.sim.sheep.slice(0, n).forEach((s, i) => { s.x = pen.cx + ((i % 6) - 2.5) * 1.2; s.z = pen.cz + (Math.floor(i / 6) - 1) * 1.1; s.vx = s.vz = 0; s.lastPush = +q('by'); s.lastPushT = r.sim.time; }); return res.end('{}'); }
  if (u.pathname === '/teleport') { const p = room.players.get(+q('id')); p.pos.x = +q('x'); p.pos.z = +q('z'); p.pos.t = Date.now(); return res.end('{}'); }
  if (u.pathname === '/players') return res.end(JSON.stringify([...room.players.values()].map(p => ({ id: p.id, name: p.name, slot: p.slot, herded: p.stats.herded, round: p.stats.roundScore, barks: p.stats.barks, dashes: p.stats.dashes, x: p.pos?.x, z: p.pos?.z, connected: p.connected }))));
  res.end('{}');
}).listen(port + 1, '127.0.0.1');
