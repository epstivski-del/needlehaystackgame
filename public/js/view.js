// NIGHT SHIFT rendering layer (the ONLY module that owns the WebGL renderer). Game logic lives in main.js and talks to this API.
// Everything is procedural: canvas textures, boxes merged per material, instanced foliage, low-poly characters.
const T = globalThis.__THREE;
import { B, H, RECT, ZONES, SPOTS, PITS, groundY, waterLevel, zoneAt, getWorld } from '/shared/world.js';
import * as TX from '/js/tex.js';
import * as MD from '/js/models.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash2 = (x, z) => { let h = Math.imul((x * 73856093) ^ (z * 19349663), 2654435761) >>> 0; h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const hex = c => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

// kind -> [texture, tint, metres per texture repeat, material options]
const KIND = {
  wall: ['plaster', 0xd8d2c0, 4], plaster: ['plaster', 0xc08890, 4], brick: ['brick', 0xffffff, 4], fence: ['mesh', 0xffffff, 1, { transparent: true, alphaTest: 0.35, side: T.DoubleSide }],
  meshfence: ['mesh', 0xffffff, 1, { transparent: true, alphaTest: 0.35, side: T.DoubleSide }], glass: ['glass', 0xffffff, 2, { transparent: true, depthWrite: false, side: T.DoubleSide }],
  vend: ['plaster', 0xc02030, 2], desk: ['timber', 0xb89a70, 2], couch: ['carpet', 0xc07890, 2], hedge: ['leaf', 0xb0e0a0, 2], post: ['metal', 0xb8bec8, 1], platform: ['timber', 0xd0b080, 2],
  ptable: ['timber', 0xc8a070, 2], tap: ['plaster', 0x2a6fd0, 2], locker: ['locker', 0xffffff, 1.2], cupboard: ['timber', 0xa07050, 2], breadbin: ['bread', 0xffffff, 1.5],
  counter: ['plaster', 0xf0d8e0, 2], bread: ['bread', 0xffffff, 1.5], toaster: ['metal', 0xd8dce4, 1], scooter: ['metal', 0x30343c, 1], pole: ['metal', 0x30343a, 1],
  seat: ['seat', 0xffffff, 1.5], prop: ['plaster', 0x606068, 2], podium: ['timber', 0xe0c070, 2], bench: ['timber', 0xb89060, 2], trunk: ['bark', 0xd0c8b8, 2],
  floor_tile: ['tile', 0xc8ced0, 4], floor_carpet: ['carpet', 0xffffff, 4], floor_sprinkle: ['sprinkle', 0xffffff, 4], floor_timber: ['timber', 0xb89a70, 4], floor_asphalt: ['asphalt', 0xffffff, 4],
  floor_concrete: ['concrete', 0xa8aaa6, 4], floor_stage: ['stage', 0xffffff, 4], roof: ['concrete', 0x44464c, 4], roof_cream: ['plaster', 0xe8dcc0, 4], roof_steel: ['metal', 0xa8aeb8, 1.5],
  cladding: ['cladding', 0xffffff, 2], timber: ['timber', 0xa07040, 2], steel: ['metal', 0x9098a0, 1.5], curtain: ['seat', 0xb02838, 2],
};

class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; }
  box(x0, y0, z0, x1, y1, z1, col, tile) {
    const [r, g, b] = hex(col);
    const F = [
      [[1, 0, 0], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 'x'], [[-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 'x'],
      [[0, 1, 0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 'y'], [[0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 'y'],
      [[0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 'z'], [[0, 0, -1], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 'z'],
    ];
    for (const f of F) {
      for (let k = 1; k <= 4; k++) {
        const q = f[k]; this.p.push(q[0], q[1], q[2]); this.n.push(f[0][0], f[0][1], f[0][2]);
        this.u.push((f[5] === 'x' ? q[2] : q[0]) / tile, (f[5] === 'y' ? q[2] : q[1]) / tile); this.c.push(r, g, b);
      }
      this.i.push(this.v, this.v + 1, this.v + 2, this.v, this.v + 2, this.v + 3); this.v += 4;
    }
  }
  geo() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3)); g.setIndex(this.i);
    g.computeBoundingSphere(); return g;
  }
}

export function createView(canvas) {
  const R = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  R.setPixelRatio(1); R.setClearColor(0x070a12);
  const scene = new T.Scene(); scene.fog = new T.FogExp2(0x0a1020, 0.016); scene.background = new T.Color(0x0a1020);
  const cam = new T.PerspectiveCamera(75, 1, 0.08, 320); cam.rotation.order = 'YXZ'; scene.add(cam);
  const hemi = new T.HemisphereLight(0x2a3555, 0x0c0c12, 1.2); scene.add(hemi);
  const flash = new T.SpotLight(0xfff0d0, 0, 46, 0.46, 0.55, 1.3); flash.position.set(0.12, -0.12, 0.1); cam.add(flash);
  const ftar = new T.Object3D(); ftar.position.set(0, 0, -6); cam.add(ftar); flash.target = ftar;
  const NL = 8, plights = [];
  for (let i = 0; i < NL; i++) { const l = new T.PointLight(0xffffff, 0, 18, 1.7); scene.add(l); plights.push(l); }
  const fpScooter = MD.makeScooterFP(); cam.add(fpScooter);
  const starGeo = new T.BufferGeometry(); starGeo.setAttribute('position', new T.BufferAttribute(TX.stars(), 3));
  const starMat = new T.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false });
  const stars = new T.Points(starGeo, starMat); stars.frustumCulled = false; scene.add(stars);
  const moon = MD.glowSprite(0xdfe8ff, 26, 0.7); moon.material.fog = false; moon.position.set(-120, 150, -140); scene.add(moon);

  const V = { quality: 'med', scale: 1, W: null, built: false, t: 0, zone: 'atrium', dawn: 0 };
  const world = new T.Group(); scene.add(world);
  const gateObjs = {}, gateOpen = {}, gateK = {};
  let waterMesh = null, lightList = [], lightTick = 0, foliage = null;
  const dyn = new T.Group(); scene.add(dyn);

  // ------------------------------------------------------------- world construction
  function groundMesh(x0, z0, x1, z1, step, skip) {
    const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step), pos = [], col = [], uv = [], idx = [];
    const vi = (i, j) => j * (nx + 1) + i;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step, y = groundY(x, z); pos.push(x, y, z); uv.push(x / 4, z / 4);
      let c = hex(0x3a5a36); const n = hash2(Math.round(x * 3), Math.round(z * 3)) * 0.35 + 0.78;
      const e = ((x - 5) / 44) ** 2 + ((z + 63) / 42) ** 2;
      if (e < 1) { const m = clamp((e - 0.7) / 0.3, 0, 1); const mud = hex(0x54432c), gr = hex(0x3a5a36); c = [mud[0] + (gr[0] - mud[0]) * m, mud[1] + (gr[1] - mud[1]) * m, mud[2] + (gr[2] - mud[2]) * m]; if (y < -1) c = hex(0x2a2418); }
      else if (x > 28 && x < 48 && z > -62 && z < -32) c = hex(0x2a6a58);
      col.push(c[0] * n, c[1] * n, c[2] * n);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
      if (skip && cx > skip.x0 && cx < skip.x1 && cz > skip.z0 && cz < skip.z1) continue;
      const a = vi(i, j), b = vi(i + 1, j), c = vi(i + 1, j + 1), d = vi(i, j + 1); idx.push(a, d, b, b, d, c);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return new T.Mesh(g, new T.MeshLambertMaterial({ map: TX.tex('grass'), vertexColors: true }));
  }

  function buildWorld(W) {
    if (V.built) return; V.built = true; V.W = W;
    const OV = { x0: -40, z0: -106, x1: 50, z1: -20 };
    world.add(groundMesh(B.minX - 10, B.minZ - 10, B.maxX + 10, B.maxZ + 10, 2, OV), groundMesh(OV.x0, OV.z0, OV.x1, OV.z1, 1, null));
    const gbs = {}, gb = k => gbs[k] || (gbs[k] = new GB());
    const add = (k, x0, y0, z0, x1, y1, z1, col, tileOverride) => gb(k).box(x0, y0, z0, x1, y1, z1, col ?? KIND[k][1], tileOverride ?? KIND[k][2]);
    const vary = (c, s) => { const [r, g, b] = hex(c), k = 0.88 + s * 0.24; return (clamp(r * k, 0, 1) * 255 << 16) | (clamp(g * k, 0, 1) * 255 << 8) | (clamp(b * k, 0, 1) * 255); };
    const cut = (x, z) => { const zn = zoneAt(x, z); return zn; };

    // walls and props
    W.walls.forEach((w, i) => {
      const k = w.m, s = hash2(i, 7), cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2, h = w.h, kd = KIND[k] ? k : 'prop';
      let tint = KIND[kd][1];
      if (kd === 'brick') tint = cut(cx, cz) === 'canteen' ? 0xf4b8c8 : 0xf4c88c;
      if (kd === 'scooter') {
        const long = (w.x1 - w.x0) > (w.z1 - w.z0), dd = 0.2;
        if (long) { add('prop', w.x0, 0.1, cz - dd, w.x1, 0.22, cz + dd, 0x2a2e36, 1); add('prop', w.x0 - 0.0, 0.05, cz - 0.12, w.x0 + 0.32, 0.4, cz + 0.12, 0x101216, 1); add('prop', w.x1 - 0.32, 0.05, cz - 0.12, w.x1, 0.4, cz + 0.12, 0x101216, 1); add('prop', w.x1 - 0.18, 0.2, cz - 0.04, w.x1 - 0.1, h, cz + 0.04, 0x6a6e76, 1); add('prop', w.x1 - 0.3, h - 0.06, cz - 0.3, w.x1 + 0.0, h, cz + 0.3, 0xd04a1a, 1); }
        else { add('prop', cx - dd, 0.1, w.z0, cx + dd, 0.22, w.z1, 0x2a2e36, 1); add('prop', cx - 0.12, 0.05, w.z0, cx + 0.12, 0.4, w.z0 + 0.32, 0x101216, 1); add('prop', cx - 0.12, 0.05, w.z1 - 0.32, cx + 0.12, 0.4, w.z1, 0x101216, 1); add('prop', cx - 0.04, 0.2, w.z1 - 0.18, cx + 0.04, h, w.z1 - 0.1, 0x6a6e76, 1); add('prop', cx - 0.3, h - 0.06, w.z1 - 0.3, cx + 0.3, h, w.z1, 0xd04a1a, 1); }
        return;
      }
      if (kd === 'pole') { add('steel', cx - 0.07, 0, cz - 0.07, cx + 0.07, h, cz + 0.07, 0x30343a); add('steel', cx - 0.45, h - 0.12, cz - 0.05, cx + 0.1, h - 0.06, cz + 0.05, 0x30343a); return; }
      if (kd === 'post') { add('steel', cx - 0.09, 0, cz - 0.09, cx + 0.09, h, cz + 0.09, 0xb8bec8); return; }
      if (kd === 'trunk') { add('trunk', cx - 0.25, 0, cz - 0.25, cx + 0.25, h, cz + 0.25, vary(tint, s)); return; }
      if (kd === 'ptable') { add('timber', w.x0, 0.78, w.z0, w.x1, 0.86, w.z1, 0xb88858); const bx = (w.x1 - w.x0) < (w.z1 - w.z0); add('timber', w.x0 + 0.1, 0, w.z0 + 0.1, w.x0 + 0.2, 0.78, w.z0 + 0.2, 0x7a5a38); add('timber', w.x1 - 0.2, 0, w.z1 - 0.2, w.x1 - 0.1, 0.78, w.z1 - 0.1, 0x7a5a38); add('timber', bx ? w.x0 - 0.35 : w.x0 + 0.1, 0.42, bx ? w.z0 : w.z0 - 0.35, bx ? w.x0 - 0.05 : w.x1 - 0.1, 0.5, bx ? w.z1 : w.z0 - 0.05, 0x9a7448); return; }
      if (kd === 'toaster') {
        add('steel', w.x0, 0.2, w.z0, w.x1, h, w.z1, 0xd8dce4); add('prop', w.x0 + 0.5, h, w.z0 + 0.2, w.x0 + 1.0, h + 0.05, w.z1 - 0.2, 0x101010, 1); add('prop', w.x1 - 1.0, h, w.z0 + 0.2, w.x1 - 0.5, h + 0.05, w.z1 - 0.2, 0x101010, 1);
        add('prop', w.x0 + 0.5, h, w.z0 + 0.2, w.x0 + 1.0, h + 0.4, w.z1 - 0.2, 0xff6a2a, 1); return;
      }
      if (kd === 'glass') { add('glass', w.x0, 0, w.z0, w.x1, h, w.z1, 0xffffff, 2); return; }
      add(kd, w.x0, 0, w.z0, w.x1, h, w.z1, vary(tint, s), KIND[kd][2]);
      if (kd === 'vend') add('prop', w.x0 + 0.15, 0.5, w.z1, w.x1 - 0.15, h - 0.2, w.z1 + 0.04, 0x7affff, 1);
    });
    // floors + roofs
    const floorKey = { tile: 'floor_tile', carpet: 'floor_carpet', sprinkle: 'floor_sprinkle' };
    for (const f of W.floors) {
      add(floorKey[f.m] || 'floor_tile', f.x0, -0.3, f.z0, f.x1, 0.02, f.z1);
      if (f.roof) add('roof', f.x0 - 0.2, H, f.z0 - 0.2, f.x1 + 0.2, H + 0.3, f.z1 + 0.2);
    }
    for (const p of W.paths) add('floor_concrete', p.x0, -0.2, p.z0, p.x1, 0.03, p.z1);
    for (const d of W.decor) {
      switch (d.k) {
        case 'deckfloor': add('floor_timber', d.x0, -0.2, d.z0, d.x1, 0.05, d.z1); break;
        case 'lot': add('floor_asphalt', d.x0, -0.2, d.z0, d.x1, 0.025, d.z1); for (let x = d.x0 + 6; x < d.x1 - 4; x += 8) add('prop', x, 0.026, d.z0 + 2, x + 0.14, 0.04, d.z0 + 8, 0xd8d27a, 1); break;
        case 'canopy': add('roof_steel', d.x0, d.y, d.z0, d.x1, d.y + 0.16, d.z1); add('steel', d.x0, d.y - 0.12, d.z0, d.x1, d.y, d.z0 + 0.1); break;
        case 'shedRoof': add('roof_steel', d.x0 - 0.3, 2.7, d.z0 - 0.3, d.x1 + 0.3, 2.85, d.z1 + 0.3); break;
        case 'stage': add('floor_stage', d.x0, -0.2, d.z0, d.x1, 0.05, d.z1); add('curtain', d.x0, 0, d.z0, d.x1, H + 0.2, d.z0 + 0.3); add('curtain', d.x0, 0, d.z0, d.x0 + 3, H + 0.2, d.z1); add('curtain', d.x1 - 3, 0, d.z0, d.x1, H + 0.2, d.z1); break;
        case 'floor': add('floor_carpet', d.x0, -0.3, d.z0, d.x1, 0.03, d.z1); break;
        case 'steps': for (let s = 0; s < 3; s++) add('floor_concrete', d.x0 - s * 0.1, -0.1, d.z0 + s * 2.6, d.x1 + s * 0.1, 0.05 + (2 - s) * 0.0, d.z0 + s * 2.6 + 2.6, 0x6a6c68); break;
        case 'pergola': { for (const [x, z] of [[d.x0, d.z0], [d.x1, d.z0], [d.x0, d.z1], [d.x1, d.z1], [d.x0, (d.z0 + d.z1) / 2], [d.x1, (d.z0 + d.z1) / 2]]) add('timber', x - 0.16, 0, z - 0.16, x + 0.16, 3.4, z + 0.16, 0x8a5a2a); for (let k = 0; k <= 4; k++) { const x = d.x0 + (d.x1 - d.x0) * k / 4; add('timber', x - 0.1, 3.4, d.z0, x + 0.1, 3.58, d.z1, 0x8a5a2a); } add('timber', d.x0, 3.38, d.z0 - 0.1, d.x1, 3.62, d.z0 + 0.1, 0x8a5a2a); add('timber', d.x0, 3.38, d.z1 - 0.1, d.x1, 3.62, d.z1 + 0.1, 0x8a5a2a); break; }
        case 'atriumFront': add('roof_cream', d.x0 - 1, H + 0.3, d.z0 - 8, d.x1 + 1, H + 0.55, d.z0 + 1); add('roof_cream', d.x0 - 1, H + 0.55, d.z0 - 8, d.x1 + 1, H + 0.75, d.z0 - 7.4); break;
        case 'bareTree': {
          add('trunk', d.x - 0.22, 0, d.z - 0.22, d.x + 0.22, 3.4, d.z + 0.22, 0x6a5a4a);
          for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, l = 1.4 + hash2(k, 3) * 1.2, hy = 3.0 + (k % 3) * 0.5; add('trunk', d.x + Math.cos(a) * 0.1 - 0.05, hy, d.z + Math.sin(a) * 0.1 - 0.05, d.x + Math.cos(a) * l + 0.05, hy + 0.9, d.z + Math.sin(a) * l + 0.05, 0x6a5a4a); }
          break;
        }
      }
    }
    // atrium sign + hanging entrance sign
    const sgn = new T.Mesh(new T.PlaneGeometry(4.2, 0.7), new T.MeshBasicMaterial({ map: TX.label('RECEPTION', { w: 512, h: 96, bg: '#0c0c10', fg: '#f4f4f4', font: 'bold 54px system-ui', border: '#5a5a62' }) })); sgn.position.set(0, 3.0, 69.7); sgn.rotation.y = 0; world.add(sgn);
    const sgn2 = sgn.clone(); sgn2.position.set(0, 3.0, 70.3); sgn2.rotation.y = Math.PI; world.add(sgn2);
    const bar = new T.Mesh(new T.PlaneGeometry(2.4, 0.5), new T.MeshBasicMaterial({ map: TX.label('MIDNIGHT ATRIUM', { w: 512, h: 96, bg: '#14161c', fg: '#ffd27a', font: 'bold 46px system-ui', border: '#6a5a3a' }) })); bar.position.set(0, 4.0, 62.9); world.add(bar);
    // wayfinding sign
    const sg = W.decor.find(d => d.k === 'sign');
    if (sg) {
      add('prop', sg.x - 1.2, 0, sg.z - 0.09, sg.x + 1.2, 2.5, sg.z + 0.09, 0x0e1014, 1);
      const sp = new T.Mesh(new T.PlaneGeometry(2.2, 2.3), new T.MeshBasicMaterial({ map: TX.label('Canteen  ←  West\nBakery  ↖  North-West\nOval  ↑  North\nAuditorium  ↗  North-East\nBike Lot  →  East', { w: 512, h: 512, bg: '#0e1014', fg: '#e8ecf4', font: 'bold 34px system-ui', lh: 62, border: '#3a4a5a' }) })); sp.position.set(sg.x, 1.28, sg.z + 0.11); world.add(sp);
    }
    // meshes per kind
    for (const k in gbs) {
      const [tx, , , o] = KIND[k], m = new T.MeshLambertMaterial({ map: TX.tex(tx), vertexColors: true, ...(o || {}) });
      const mesh = new T.Mesh(gbs[k].geo(), m); mesh.frustumCulled = true; if (o && o.transparent && k === 'glass') mesh.renderOrder = 2; world.add(mesh);
    }
    // light fixtures (glowing boxes), merged
    const fx = new GB(); lightList = W.lights;
    W.lights.forEach(L => { const s = L.y > 4 ? 0.4 : 0.55; fx.box(L.x - s, L.y - 0.1, L.z - s * 0.5, L.x + s, L.y + 0.02, L.z + s * 0.5, L.c, 1); });
    world.add(new T.Mesh(fx.geo(), new T.MeshBasicMaterial({ vertexColors: true })));
    // foliage (instanced low-poly crowns)
    const gums = W.decor.filter(d => d.k === 'gum'), ico = new T.IcosahedronGeometry(1, 1);
    foliage = new T.InstancedMesh(ico, new T.MeshLambertMaterial({ color: 0x3c6a3a }), gums.length * 3 + 6); const mm = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3();
    let n = 0;
    for (const g of gums) for (let k = 0; k < 3; k++) { const s = (2.2 + hash2(n, 9) * 1.4) * g.s * (k ? 0.75 : 1); ps.set(g.x + (k - 1) * 1.3 * g.s, 6.2 + k * 0.5 * g.s + hash2(n, 4), g.z + (hash2(n, 5) - 0.5) * 2); sc.set(s, s * 0.7, s); mm.compose(ps, q, sc); foliage.setMatrixAt(n++, mm); }
    foliage.count = n; foliage.instanceMatrix.needsUpdate = true; world.add(foliage);
    // water + oval details
    waterMesh = new T.Mesh(new T.CircleGeometry(1, 40), new T.MeshLambertMaterial({ map: TX.tex('water'), color: 0x9adff0, transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide }));
    waterMesh.rotation.x = -Math.PI / 2; waterMesh.scale.set(43.5, 41.5, 1); waterMesh.position.set(5, 0, -63); waterMesh.renderOrder = 1; world.add(waterMesh); waterMesh.material.map = waterMesh.material.map.clone(); waterMesh.material.map.needsUpdate = true; waterMesh.material.map.repeat.set(30, 30);
    // radio, beanbag, board, whiteboard, trophy case, plates, crates
    const radio = new T.Group(); radio.position.set(SPOTS.radio.x, 1.0, SPOTS.radio.z - 0.2); radio.add(MD.box(0.7, 0.4, 0.3, 0x5a3a22), MD.box(0.5, 0.18, 0.02, 0xffb040, { basic: true }, 0, 0, 0.16), MD.box(0.02, 0.5, 0.02, 0xc0c0c0, null, 0.3, 0.4, 0)); world.add(radio);
    world.add(MD.sph(0.7, 0xd9602a, null, SPOTS.beanbag.x, 0.35, SPOTS.beanbag.z + 0.4).translateY(0)); world.children[world.children.length - 1].scale.set(1.5, 0.8, 1.5);
    const mkBoard = (txt, x, y, z, ry, w, h, bg, fg) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: TX.label(txt, { w: 512, h: Math.round(512 * h / w), bg, fg, font: 'bold 38px system-ui', lh: 50, border: '#444' }) })); m.position.set(x, y, z); m.rotation.y = ry; world.add(m); };
    mkBoard('STUDENT OF THE MONTH\n\n(photo missing)\n(student missing)', SPOTS.board.x, 1.8, 87.7, Math.PI, 2.4, 1.6, '#1a2a4a', '#f4e4a0');
    mkBoard('INCIDENT TIMELINE\n8:25 rumour\n8:26 group chat\n8:30 cooked\n8:31 the bell', -3.5, 1.9, 87.7, Math.PI, 3.4, 1.8, '#e8e8e8', '#222');
    const tc = new T.Group(); tc.position.set(SPOTS.trophy.x + 0.4, 0, SPOTS.trophy.z); tc.add(MD.box(0.6, 1.2, 2.4, 0x3a2a1c), MD.box(0.5, 0.9, 2.2, 0x9ad8e8, { transparent: true, opacity: 0.35 }, 0.1, 1.05, 0));
    for (let k = 0; k < 4; k++) tc.add(MD.cone(0.12, 0.3, 0xffd23a, { emissive: 0x5a4200 }, 0.1, 1.25, -0.8 + k * 0.5)); world.add(tc);
    V.plates = [SPOTS.plateA, SPOTS.plateB].map(p => { const m = MD.cyl(0.95, 0.06, 0x2a6aff, { emissive: 0x103070 }, p.x, 0.05, p.z); world.add(m); const r = new T.Mesh(new T.TorusGeometry(0.95, 0.05, 6, 20), MD.basic(0x6aa8ff)); r.rotation.x = Math.PI / 2; r.position.set(p.x, 0.09, p.z); world.add(r); return { m, r }; });
    V.crates = new Map(); for (const c of W.crates) { const m = MD.box(0.9, 0.7, 0.9, 0xa07040, null, c.x, 0.35, c.z); const lb = new T.Mesh(new T.PlaneGeometry(0.6, 0.3), new T.MeshBasicMaterial({ map: TX.label('PROPS', { w: 128, h: 64, bg: '#c8a060', fg: '#3a2410', font: 'bold 30px system-ui' }) })); lb.position.set(0, 0.1, 0.46); m.add(lb); world.add(m); V.crates.set(c.id, m); }
    // gates
    const mkGate = (id, g, cfg) => { const grp = new T.Group(); gateObjs[id] = grp; grp.position.set(0, 0, 0); cfg(grp, g); world.add(grp); gateOpen[id] = false; gateK[id] = 0; };
    mkGate('front', W.gates.front, (grp, g) => { const L = new T.Group(), Rr = new T.Group(); const pane = (x) => MD.box(2.9, 3.0, 0.05, 0x9ad8e8, { transparent: true, opacity: 0.3 }, x, 1.5, 70); const fr = (x) => MD.box(2.9, 0.1, 0.1, 0x2a2c32, null, x, 3.0, 70); L.add(pane(-1.5), fr(-1.5), MD.box(0.1, 3, 0.1, 0x2a2c32, null, -3, 1.5, 70)); Rr.add(pane(1.5), fr(1.5), MD.box(0.1, 3, 0.1, 0x2a2c32, null, 3, 1.5, 70)); grp.add(L, Rr); grp.userData = { L, Rr }; });
    mkGate('secret', W.gates.secret, (grp, g) => { grp.add(MD.box(0.5, 3.2, 3.6, 0x7a5a3a, null, (g.x0 + g.x1) / 2, 1.6, (g.z0 + g.z1) / 2)); const lb = new T.Mesh(new T.PlaneGeometry(1.6, 0.8), new T.MeshBasicMaterial({ map: TX.label('6 7', { w: 256, h: 128, bg: '#2a1a10', fg: '#ffd27a', font: 'bold 90px monospace', border: '#ffd27a' }) })); lb.position.set((g.x0 + g.x1) / 2 + 0.28, 1.8, (g.z0 + g.z1) / 2); lb.rotation.y = Math.PI / 2; grp.add(lb); });
    mkGate('chain', W.gates.chain, (grp, g) => { const m = new T.Mesh(new T.PlaneGeometry(4, 2.6), new T.MeshLambertMaterial({ map: TX.tex('mesh'), transparent: true, alphaTest: 0.35, side: T.DoubleSide })); m.position.set((g.x0 + g.x1) / 2, 1.3, (g.z0 + g.z1) / 2); m.rotation.y = Math.PI / 2; grp.add(m, MD.box(0.5, 0.35, 0.4, 0xc0a040, { emissive: 0x403000 }, (g.x0 + g.x1) / 2, 1.3, (g.z0 + g.z1) / 2)); });
    mkGate('aud', W.gates.aud, (grp, g) => { const cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2; grp.add(MD.box(2.4, 3.2, 0.3, 0x7a1018, { emissive: 0x200408 }, cx - 1.3, 1.6, cz), MD.box(2.4, 3.2, 0.3, 0x7a1018, { emissive: 0x200408 }, cx + 1.3, 1.6, cz)); const lb = new T.Mesh(new T.PlaneGeometry(4, 0.6), new T.MeshBasicMaterial({ map: TX.label('THE FOGHORN', { w: 512, h: 80, bg: '#1a0408', fg: '#ff9aa0', font: 'bold 52px system-ui' }) })); lb.position.set(cx, 3.5, cz + 0.2); grp.add(lb); });
    V.zoneFx = {}; applyZone('atrium', 1);
  }

  // ------------------------------------------------------------- zone look
  const fogCol = new T.Color(0x0a1020), fogTarget = new T.Color(0x0a1020); let fogD = 0.016, fogDT = 0.016, ambI = 1.2, ambT = 1.2; const ambCol = new T.Color(0x2a3555), ambTarget = new T.Color(0x2a3555);
  function applyZone(z, snap) {
    const Z = ZONES[z] || ZONES.campus; V.zone = z; fogTarget.setHex(Z.fog); fogDT = Z.fd; ambTarget.setHex(Z.amb); ambT = 0.9 + Z.ai * 3.2;
    if (snap) { fogCol.copy(fogTarget); fogD = fogDT; ambCol.copy(ambTarget); ambI = ambT; }
  }

  // ------------------------------------------------------------- entities
  const players = new Map(), enemies = new Map(), pickups = new Map(), projs = new Map(), pings = [], haz = [], clouds = [], beams = [], tele = [];
  let floodMesh = null, hallu = null, halluT = 0;
  const cloudMat = new T.MeshLambertMaterial({ color: 0x7ad84a, transparent: true, opacity: 0.32, depthWrite: false, emissive: 0x1a4a08 });
  function groundAt(x, z) { return groundY(x, z); }

  function syncPlayers(list, names, youId) {
    const seen = new Set();
    for (const a of list) {
      const id = a[0]; if (id === youId) continue; seen.add(id);
      let r = players.get(id);
      if (!r) { r = { id, model: null, form: '', x: a[1], z: a[2], yaw: a[3], tag: null, speed: 0, nm: '' }; players.set(id, r); }
      r.tx = a[1]; r.tz = a[2]; r.tyaw = a[3]; r.pitch = a[4]; r.flags = a[5]; r.hp = a[6]; r.rev = a[7]; r.hat = a[8]; r.bot = !!a[9]; r.name = names.get(id) || '';
    }
    for (const [id, r] of players) if (!seen.has(id)) { if (r.model) dyn.remove(r.model); players.delete(id); }
  }
  function syncEnemies(list) {
    const seen = new Set();
    for (const a of list) {
      const id = a[0]; seen.add(id);
      let r = enemies.get(id);
      if (!r) { const model = MD.makeEnemy(a[1]); model.position.set(a[2], 0, a[3]); dyn.add(model); r = { id, kind: a[1], model, x: a[2], z: a[3], yaw: a[4], speed: 0, tx: a[2], tz: a[3], tyaw: a[4], st: 0, aux: 0 }; enemies.set(id, r); }
      r.tx = a[2]; r.tz = a[3]; r.tyaw = a[4]; r.st = a[5]; r.aux = a[6];
    }
    for (const [id, r] of enemies) if (!seen.has(id)) { dyn.remove(r.model); enemies.delete(id); }
  }
  function addPickup(p) {
    if (pickups.has(p.id)) return;
    const m = MD.makePickup(p.ty); const gy = groundAt(p.x, p.z);
    m.position.set(p.x, 0, p.z); m.userData.baseY = p.dv ? gy : Math.max(gy, 0); dyn.add(m); pickups.set(p.id, { m, x: p.x, z: p.z, type: p.ty });
  }
  function removePickup(id) { const r = pickups.get(id); if (r) { dyn.remove(r.m); pickups.delete(id); } }
  function clearPickups() { for (const r of pickups.values()) dyn.remove(r.m); pickups.clear(); }
  function clearDynamic() {
    for (const r of players.values()) if (r.model) dyn.remove(r.model); players.clear();
    for (const r of enemies.values()) dyn.remove(r.model); enemies.clear();
    clearPickups(); for (const r of projs.values()) dyn.remove(r.m); projs.clear();
    for (const p of pings) dyn.remove(p.s); pings.length = 0; for (const b of beams) dyn.remove(b.m); beams.length = 0; for (const t of tele) dyn.remove(t.m); tele.length = 0;
    if (hallu) { dyn.remove(hallu); hallu = null; }
  }
  const PJ = { can: () => MD.cyl(0.1, 0.24, 0xb8c0c8), duck: () => MD.sph(0.14, 0xffe03a), stress: () => MD.sph(0.12, 0x9aff5a), butter: () => MD.box(0.3, 0.12, 0.18, 0xffe27a), knife: () => MD.box(0.04, 0.03, 0.4, 0xd0d6dc), jam: () => MD.cyl(0.12, 0.22, 0xff2a4a), doughnut: () => { const t = new T.Mesh(new T.TorusGeometry(0.3, 0.14, 6, 12), MD.mat(0xff6fa8, { emissive: 0x501830 })); return t; } };
  function syncProjectiles(list) {
    const seen = new Set();
    for (const a of list) { const id = a[0]; seen.add(id); let r = projs.get(id); if (!r) { r = { m: (PJ[a[4]] || PJ.can)() }; dyn.add(r.m); projs.set(id, r); } r.m.position.set(a[1], a[2], a[3]); r.m.rotation.x += 0.3; r.m.rotation.z += 0.2; }
    for (const [id, r] of projs) if (!seen.has(id)) { dyn.remove(r.m); projs.delete(id); }
  }
  function syncHazards(list) {
    while (haz.length < list.length) { const ring = new T.Mesh(new T.RingGeometry(0.6, 1, 24), new T.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; const loaf = MD.box(0.9, 0.5, 0.5, 0xc98a3c); ring.add(loaf); dyn.add(ring); haz.push(ring); }
    haz.forEach((h, i) => { const a = list[i]; if (!a) { h.visible = false; return; } h.visible = true; h.position.set(a[0], 0.07, a[1]); h.scale.setScalar(a[2]); const k = clamp(a[3] / 1.4, 0, 1); h.material.opacity = 0.9 - k * 0.5; h.children[0].position.set(0, 0.02 + k * 14 / a[2], 0); h.children[0].scale.setScalar(1 / a[2]); h.children[0].rotation.y += 0.2; });
  }
  function syncClouds(list) {
    while (clouds.length < list.length) { const g = new T.Group(); for (let k = 0; k < 4; k++) { const s = new T.Mesh(new T.SphereGeometry(1, 9, 7), cloudMat); s.userData.k = k; g.add(s); } dyn.add(g); clouds.push(g); }
    clouds.forEach((g, i) => { const a = list[i]; if (!a) { g.visible = false; return; } g.visible = true; g.position.set(a[0], 1.2, a[1]); g.userData.r = a[2]; });
  }
  function setFlood(f) { if (!f) { if (floodMesh) floodMesh.visible = false; return; } if (!floodMesh) { floodMesh = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 20, 1, true), new T.MeshLambertMaterial({ color: 0x2a8ab0, transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false })); dyn.add(floodMesh); } floodMesh.visible = true; floodMesh.position.set(f[0], 0.5, f[1]); floodMesh.scale.set(f[2], 1.0, f[2]); }
  function addPing(x, z, kind, name) {
    const col = { enemy: 0xff4a4a, here: 0x6ae8ff, battery: 0x6aff8a, '67': 0x9aff7a }[kind] || 0x6ae8ff;
    const s = MD.glowSprite(col, 2.4, 0.95); s.material.depthTest = false; s.position.set(x, 2.2, z); s.renderOrder = 10; dyn.add(s);
    const tag = MD.textSprite((name ? name + ': ' : '') + ({ enemy: 'ENEMY', here: 'GO HERE', battery: 'BATTERY', '67': '67!' }[kind] || kind), { fg: '#' + col.toString(16).padStart(6, '0'), w: 2.6 }); tag.material.depthTest = false; tag.position.set(0, 0.9, 0); tag.renderOrder = 11; s.add(tag);
    pings.push({ s, until: V.t + 7 });
  }
  function reveal(list) { for (const p of list) { const m = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 14, 6), new T.MeshBasicMaterial({ color: 0x9aff7a, transparent: true, opacity: 0.45, blending: T.AdditiveBlending, depthWrite: false })); m.position.set(p.x, 7, p.z); dyn.add(m); beams.push({ m, until: V.t + 25 }); } }
  function telegraph(x, z, dx, dz, dur) { const len = 40, m = new T.Mesh(new T.PlaneGeometry(2.6, len), new T.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, side: T.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(dx, dz) + Math.PI; const g = new T.Group(); g.add(m); m.position.set(0, 0.08, -len / 2); g.position.set(x, 0, z); g.rotation.y = Math.atan2(-dx, -dz) ; m.rotation.set(-Math.PI / 2, 0, 0); dyn.add(g); tele.push({ m: g, until: V.t + dur }); }
  function setHallu(h) {
    if (!h) { if (hallu) hallu.visible = false; return; }
    if (!hallu) { hallu = MD.makeEnemy(2); hallu.traverse(o => { if (o.isMesh) o.material = MD.mat(0x050508, { transparent: true, opacity: 0.8 }); }); dyn.add(hallu); }
    hallu.visible = true; hallu.position.set(h.x, groundAt(h.x, h.z), h.z); hallu.rotation.y = h.yaw || 0;
  }
  function setGates(open) { for (const id in gateObjs) gateOpen[id] = !!(open && open[id]); }
  function snapGates() { for (const id in gateObjs) gateK[id] = gateOpen[id] ? 1 : 0; }
  function setPlates(a, b, open) { if (!V.plates) return; V.plates.forEach((p, i) => { const on = i === 0 ? a : b; p.m.visible = p.r.visible = !open; p.m.material = MD.mat(on ? 0x2aff6a : 0x2a6aff, { emissive: on ? 0x108a30 : 0x103070 }); }); }

  // ------------------------------------------------------------- per-frame
  const tmpC = new T.Color();
  function updateGates(dt) {
    for (const id in gateObjs) {
      const target = gateOpen[id] ? 1 : 0; gateK[id] += (target - gateK[id]) * Math.min(1, dt * 3); const k = gateK[id], g = gateObjs[id];
      if (id === 'front') { g.userData.L.position.x = -3 * k; g.userData.Rr.position.x = 3 * k; }
      else if (id === 'secret') g.position.y = -3.4 * k;
      else if (id === 'chain') g.position.y = -2.8 * k;
      else if (id === 'aud') g.position.y = 3.4 * k;
      g.visible = k < 0.98;
    }
  }
  function assignLights(cx, cz, dt, flickerBase) {
    lightTick -= dt; if (lightTick > 0) { return; } lightTick = 0.18;
    const near = [];
    for (let i = 0; i < lightList.length; i++) { const L = lightList[i], d = (L.x - cx) ** 2 + (L.z - cz) ** 2; if (d < 900) near.push([d, i]); }
    near.sort((a, b) => a[0] - b[0]);
    const cap = V.quality === 'low' ? 4 : NL;
    for (let k = 0; k < NL; k++) {
      const pl = plights[k], e = near[k];
      if (!e || k >= cap) { pl.userData.base = 0; pl.userData.idx = -1; continue; }
      const L = lightList[e[1]]; pl.position.set(L.x, Math.min(L.y, 4.2), L.z); pl.color.setHex(L.c); pl.userData.base = L.i * 34; pl.userData.fl = L.fl; pl.userData.idx = e[1];
    }
  }
  function render(dt, s) {
    V.t += dt; const t = V.t;
    // camera
    const sh = s.shake || 0, jx = sh ? (Math.random() - 0.5) * sh * 0.05 : 0, jy = sh ? (Math.random() - 0.5) * sh * 0.05 : 0;
    cam.position.set(s.x + jx, s.y + jy, s.z); cam.rotation.set(s.pitch + jy, s.yaw + jx, s.roll || 0);
    const fov = (s.fov || 75) + (s.fovKick || 0); if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (s.zone && s.zone !== V.zone) applyZone(s.zone);
    // dawn: fade stars, warm the sky
    V.dawn = s.dawn || 0; const dk = clamp((V.dawn - 0.7) / 0.3, 0, 1);
    fogCol.lerp(fogTarget, Math.min(1, dt * 1.6)); fogD += (fogDT - fogD) * Math.min(1, dt * 1.6); ambCol.lerp(ambTarget, Math.min(1, dt * 1.6)); ambI += (ambT - ambI) * Math.min(1, dt * 1.6);
    const under = !!s.underwater;
    tmpC.copy(fogCol); if (dk > 0) tmpC.lerp(new T.Color(0xff9a5a), dk * 0.35); if (under) tmpC.setHex(0x0a4658);
    scene.fog.color.copy(tmpC); scene.background.copy(tmpC); scene.fog.density = under ? 0.1 : fogD * (s.fogMul || 1) * (1 - dk * 0.35);
    hemi.color.copy(ambCol); hemi.intensity = (s.nightvision ? 2.6 : ambI) * (1 + dk * 0.8) + (s.sanityGlow || 0);
    starMat.opacity = 0.8 * (1 - dk); stars.position.copy(cam.position); moon.position.set(cam.position.x - 120, 150, cam.position.z - 140);
    // flashlight
    const fl = s.flash || { on: false, level: 0, flicker: 0 };
    let fi = fl.on ? 70 * (0.35 + 0.65 * clamp(fl.level, 0, 1)) : 0;
    if (fl.on && fl.flicker > 0 && Math.sin(t * 40 + Math.sin(t * 13) * 5) > 1 - fl.flicker * 1.4) fi *= 0.1;
    if (fl.on && fl.level < 0.12) fi *= 0.5 + 0.5 * Math.sin(t * 30);
    flash.intensity = fi; flash.visible = fi > 0.01; flash.distance = V.quality === 'low' ? 30 : 46;
    // pooled point lights
    assignLights(s.x, s.z, dt);
    for (const pl of plights) {
      const b = pl.userData.base || 0; let m = 1;
      if (b && pl.userData.fl) { const idx = pl.userData.idx; m = Math.sin(t * 13 + idx * 7.3) * Math.sin(t * 7.1 + idx * 2.1) > 1 - pl.userData.fl * 1.3 ? 0.2 : 1; }
      if (s.blackout && b) m *= 0.25;
      pl.intensity += (b * m - pl.intensity) * Math.min(1, dt * 12);
    }
    updateGates(dt);
    // water
    if (waterMesh) { waterMesh.position.y = waterLevel(s.tide || 0, s.tideOff || 0); const m = waterMesh.material.map; m.offset.set((t * 0.01) % 1, (t * 0.014) % 1); }
    // first-person scooter
    fpScooter.visible = !!s.scooter; if (s.scooter) fpScooter.rotation.z = Math.sin(t * 9) * 0.01;
    // remote players
    const k = 1 - Math.exp(-dt * 14);
    for (const r of players.values()) {
      const form = (r.flags & 256) ? 'bell' : 'person';
      if (form !== r.form) { if (r.model) dyn.remove(r.model); r.model = form === 'bell' ? MD.makeBell(0.36, 0) : MD.makePerson(r.id); r.form = form; dyn.add(r.model); r.model.userData.hat = -1; r.nm = ''; if (r.tag) { r.model.add(r.tag); } }
      const dx = r.tx - r.x, dz = r.tz - r.z; r.x += dx * k; r.z += dz * k; let dy = r.tyaw - r.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU; r.yaw += dy * k;
      r.speed = r.speed * 0.8 + Math.min(8, Math.hypot(dx, dz) / Math.max(dt, 0.001) * 0.2 * 1.0) * 0.2;
      const m = r.model, fg = r.flags | 0, hidden = !!(fg & 32), down = !!(fg & 8), dead = !!(fg & 16), swim = !!(fg & 64);
      m.visible = !hidden && !dead;
      const wl = waterLevel(s.tide || 0, s.tideOff || 0), gy = groundAt(r.x, r.z); m.position.set(r.x, swim ? wl - 1.15 : gy, r.z); m.rotation.y = r.yaw;
      if (form === 'person') {
        const u = m.userData; if (u.hat !== r.hat) MD.setHat(m, r.hat);
        const sp = clamp(r.speed, 0, 7), sw = Math.sin(t * (6 + sp)) * 0.7 * Math.min(1, sp / 3);
        u.pivL.rotation.x = sw; u.pivR.rotation.x = -sw; u.armL.rotation.x = -sw * 0.6; u.armR.rotation.x = sw * 0.6;
        u.flash.visible = !!(fg & 4) && !down; u.flash.rotation.x = r.pitch || 0;
        m.rotation.x = down ? -Math.PI / 2 : 0; if (down) m.position.y += 0.25;
        if (r.name && r.nm !== r.name) { r.nm = r.name; if (r.tag) m.remove(r.tag); r.tag = MD.textSprite(r.name, { w: 1.6 }); r.tag.position.set(0, 2.25, 0); m.add(r.tag); }
        else if (!r.tag && r.name) { r.tag = MD.textSprite(r.name, { w: 1.6 }); r.tag.position.set(0, 2.25, 0); m.add(r.tag); r.nm = r.name; }
        if (r.tag) r.tag.visible = Math.hypot(r.x - s.x, r.z - s.z) < 28;
      } else MD.animEnemy(m, 6, { t, state: 4, aux: 0 });
    }
    // enemies
    for (const r of enemies.values()) {
      const dx = r.tx - r.x, dz = r.tz - r.z, kk = 1 - Math.exp(-dt * 10); r.x += dx * kk; r.z += dz * kk; let dy = r.tyaw - r.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU; r.yaw += dy * kk;
      const moving = Math.hypot(dx, dz) / Math.max(dt, 0.001) > 0.3, m = r.model, st = r.st & 7, frozen = !!(r.st & 8), toasted = !!(r.st & 16);
      const wl = waterLevel(s.tide || 0, s.tideOff || 0), gy = groundAt(r.x, r.z);
      let y = gy; if (r.kind === 4 && r.aux === 1) y = wl - 1.25; if (r.kind === 6) y = 0.9 + Math.sin(t * 1.5) * 0.15;
      m.position.set(r.x, y, r.z); m.rotation.y = r.yaw;
      if (r.kind === 5) m.position.y = 0;
      MD.animEnemy(m, r.kind, { t: t + r.id, state: st, aux: r.aux, toasted, frozen, moving });
      m.visible = Math.hypot(r.x - s.x, r.z - s.z) < 130;
    }
    // pickups
    for (const r of pickups.values()) { const d = Math.hypot(r.x - s.x, r.z - s.z); r.m.visible = d < 70; if (r.m.visible) MD.animPickup(r.m, t); }
    // clouds
    clouds.forEach((g, i) => { if (!g.visible) return; const R0 = g.userData.r || 5; g.children.forEach((c, j) => { const a = t * 0.3 + j * 1.6; c.position.set(Math.cos(a) * R0 * 0.35, Math.sin(t * 0.6 + j) * 0.4, Math.sin(a) * R0 * 0.35); c.scale.setScalar(R0 * (0.55 + 0.12 * Math.sin(t + j * 2 + i))); }); });
    // transient markers
    for (let i = pings.length - 1; i >= 0; i--) { const p = pings[i]; p.s.position.y = 2.2 + Math.sin(t * 4) * 0.15; if (t > p.until) { dyn.remove(p.s); pings.splice(i, 1); } }
    for (let i = beams.length - 1; i >= 0; i--) { const b = beams[i]; b.m.material.opacity = 0.25 + 0.2 * Math.sin(t * 5 + i); if (t > b.until) { dyn.remove(b.m); beams.splice(i, 1); } }
    for (let i = tele.length - 1; i >= 0; i--) { const b = tele[i]; if (t > b.until) { dyn.remove(b.m); tele.splice(i, 1); } }
    R.render(scene, cam);
  }

  function resize() {
    const w = Math.max(2, Math.floor(innerWidth * V.scale)), h = Math.max(2, Math.floor(innerHeight * V.scale));
    R.setSize(w, h, false); canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.imageRendering = V.scale < 0.95 ? 'pixelated' : 'auto';
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  function setQuality(q, scale) { V.quality = q; V.scale = clamp(scale || 1, 0.3, 1); cam.far = q === 'low' ? 160 : q === 'high' ? 340 : 240; cam.updateProjectionMatrix(); resize(); }
  addEventListener('resize', resize); resize();
  return { buildWorld, setQuality, resize, render, syncPlayers, syncEnemies, syncProjectiles, syncHazards, syncClouds, setFlood, addPickup, removePickup, clearPickups, clearDynamic, addPing, reveal, telegraph, setHallu, setGates, snapGates, setPlates, applyZone,
    get camera() { return cam; }, get renderer() { return R; }, get scene() { return scene; }, playerPos(id) { const r = players.get(id); return r ? { x: r.x, z: r.z, yaw: r.yaw } : null; }, hasEnemy: id => enemies.has(id) };
}
