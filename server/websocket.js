// Minimal dependency-free RFC 6455 WebSocket server (text frames, ping/pong, close, fragmentation).
// Built on Node's http 'upgrade' event so it works behind Railway's HTTPS/WSS edge proxy.
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

export function acceptUpgrade(req, socket, onConnection) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  socket.setNoDelay(true);
  socket.setTimeout(0);
  onConnection(new WSConnection(socket, req));
}

export class WSConnection {
  constructor(socket, req) {
    this.socket = socket; this.req = req; this.open = true; this.buf = Buffer.alloc(0);
    this.fragments = []; this.fragOp = 0; this.alive = true;
    this.onmessage = null; this.onclose = null;
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() { if (!this.open) return; this.open = false; this.onclose?.(); }

  _data(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    if (this.buf.length > MAX_PAYLOAD * 4) return this.terminate();
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (!masked) return this.terminate(); // clients must mask
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6); if (hi) return this.terminate(); len = lo; off = 10; }
      if (len > MAX_PAYLOAD) return this.terminate();
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this._frame(fin, op, payload);
      if (!this.open) return;
    }
  }

  _frame(fin, op, payload) {
    if (op === 0x8) { this._write(0x8, payload.subarray(0, 2)); this.socket.end(); return this._closed(); }
    if (op === 0x9) return this._write(0xA, payload);
    if (op === 0xA) { this.alive = true; return; }
    if (op === 0x1 || op === 0x2) { this.fragOp = op; this.fragments = [payload]; }
    else if (op === 0x0) { this.fragments.push(payload); }
    else return this.terminate();
    if (!fin) { if (this.fragments.reduce((n, f) => n + f.length, 0) > MAX_PAYLOAD) this.terminate(); return; }
    const data = Buffer.concat(this.fragments); this.fragments = [];
    if (this.fragOp === 0x1) this.onmessage?.(data.toString('utf8'));
  }

  _write(op, payload) {
    if (!this.open) return;
    const len = payload.length; let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this.terminate(); }
  }

  send(text) { this._write(0x1, Buffer.from(text, 'utf8')); }
  ping() { this.alive = false; this._write(0x9, Buffer.alloc(0)); }
  close() { if (!this.open) return; try { this._write(0x8, Buffer.from([0x03, 0xe8])); this.socket.end(); } catch {} this._closed(); }
  terminate() { try { this.socket.destroy(); } catch {} this._closed(); }
}
