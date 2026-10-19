// Serves Three.js from our own origin: from node_modules (installed with the app) if present, otherwise fetched once from a public CDN by the server (servers have open internet,
// unlike the build sandbox) and cached in memory, so players' browsers load a single same-origin file.
const SOURCES = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://unpkg.com/three@0.160.0/build/three.module.js',
];
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const LOCAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/three/build/three.module.js');
let cached = null, inflight = null;

export async function getThree() {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try { const text = await readFile(LOCAL, 'utf8'); if (text.includes('WebGLRenderer')) { cached = text; return text; } } catch {} // installed with the app (npm install)
    let lastErr;
    for (const url of SOURCES) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`${url} -> ${res.status}`);
        const text = await res.text();
        if (!text.includes('WebGLRenderer')) throw new Error('unexpected three.js payload');
        cached = text; return text;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  })().finally(() => { inflight = null; });
  return inflight;
}
