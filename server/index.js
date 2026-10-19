// FLOCK RUSH — production server: static files + /health + /ws (authoritative multiplayer).
// Zero npm dependencies. Railway terminates TLS, so browsers connect over https:// and wss:// automatically.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Hub } from '../public/shared/engine.js';
import { acceptUpgrade } from './websocket.js';
import { getThree } from './vendor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };

export function createServer(opts = {}) {
  const hub = new Hub({ minDuration: opts.minDuration ?? Number(process.env.MIN_ROUND_SECONDS || 30) });
  const conns = new Set();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/health' || url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ ...hub.health(), connections: conns.size }));
      }
      if (url.pathname === '/vendor/three.module.js') {
        try { const js = await getThree(); res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'public, max-age=86400' }); return res.end(js); }
        catch { res.writeHead(502, { 'Content-Type': 'text/plain' }); return res.end('three.js unavailable'); }
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || /^\/r\/[A-Za-z0-9]{5}\/?$/.test(rel)) rel = '/index.html'; // invite links: /r/ABCDE
      const file = path.resolve(PUBLIC, '.' + rel);
      if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) { res.writeHead(403); return res.end('Forbidden'); }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      const ext = path.extname(file).toLowerCase();
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      });
      res.end(body);
    } catch (e) { res.writeHead(500); res.end('Server error'); }
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    const origin = req.headers.origin; // browsers always send Origin; refuse pages served from other sites
    if (origin) { let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch {} if (!ok) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; } }
    acceptUpgrade(req, socket, ws => {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const conn = {
        ip: fwd || req.socket.remoteAddress || 'unknown',
        send: obj => ws.send(JSON.stringify(obj)),
        close: () => ws.close(),
      };
      hub.attach(conn); conns.add(conn);
      ws.onmessage = text => { let m; try { m = JSON.parse(text); } catch { return; } hub.handle(conn, m); };
      ws.onclose = () => { conns.delete(conn); hub.close(conn); };
      conn._ws = ws;
    });
  });

  const tickTimer = setInterval(() => hub.tick(), 50);
  // Heartbeat: drop connections that stop answering pings so rooms never hold ghost players.
  const hb = setInterval(() => { for (const c of conns) { const ws = c._ws; if (!ws) continue; if (!ws.alive) { ws.terminate(); continue; } ws.ping(); } }, 15000);
  server.on('close', () => { clearInterval(tickTimer); clearInterval(hb); });
  return { server, hub };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`Flock Rush listening on :${port}`));
  const stop = () => { console.log('Shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
