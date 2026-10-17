// E2E harness: the REAL production server plus a separate test-only debug port (never part of the deployed app).
import { createServer } from '../../server/index.js';
import http from 'node:http';
const { server, hub } = createServer({ minDuration: 1 });
const port = Number(process.env.PORT || 3200);
server.listen(port, '127.0.0.1', () => console.log('READY', port));
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), room = hub.rooms.get(u.searchParams.get('code'));
  res.setHeader('Content-Type', 'application/json');
  if (!room) return res.end('{"err":"noroom"}');
  if (u.pathname === '/needle') { const r = room.round; return res.end(JSON.stringify({ phase: room.phase, needle: r?.needles[0] && { x: r.needles[0].x, z: r.needles[0].z, id: r.needles[0].id }, mode: r?.mode, roundId: r?.id })); }
  if (u.pathname === '/teleport') { const p = room.players.get(+u.searchParams.get('id')); p.pos.x = +u.searchParams.get('x'); p.pos.z = +u.searchParams.get('z'); p.pos.t = Date.now(); return res.end('{"ok":1}'); }
  if (u.pathname === '/players') return res.end(JSON.stringify([...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.stats.score, round: p.stats.roundScore, x: p.pos?.x, z: p.pos?.z }))));
  res.end('{}');
}).listen(port + 1, '127.0.0.1');
