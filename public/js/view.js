// FLOCK RUSH rendering layer (the ONLY module that touches Three.js). Game logic lives elsewhere and talks to this API.
// Everything is procedural: canvas textures, low-poly sheep and dogs, instanced sheep so 90 of them stay cheap.
const T = globalThis.__THREE;
const TAU = Math.PI * 2;

function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; if (repeat) t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 4; return t;
}
function makeTextures() {
  const r = rnd(11);
  const grass = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6fae4a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = `hsla(${88 + r() * 30},${40 + r() * 25}%,${34 + r() * 22}%,${0.12 + r() * 0.2})`; g.beginPath(); g.arc(r() * w, r() * h, 10 + r() * 38, 0, TAU); g.fill(); }
    for (let i = 0; i < 7000; i++) { const x = r() * w, y = r() * h; g.strokeStyle = `hsla(${80 + r() * 40},${45 + r() * 30}%,${28 + r() * 34}%,${0.25 + r() * 0.45})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 7); g.stroke(); }
  });
  const hay = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d9b457'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) { const x = r() * w, y = r() * h, l = 10 + r() * 28; g.strokeStyle = `hsla(${40 + r() * 14},${60 + r() * 30}%,${42 + r() * 28}%,${0.3 + r() * 0.5})`; g.lineWidth = 1 + r() * 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (r() - 0.5) * 4); g.stroke(); }
    g.strokeStyle = '#6b4a22'; g.lineWidth = 5; for (const x of [70, 186]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  });
  const wood = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8a5a30'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) { g.fillStyle = `hsl(${26 + r() * 8},${40 + r() * 10}%,${30 + r() * 10}%)`; g.fillRect(0, y, w, 30); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, y + 30, w, 2); }
    for (let i = 0; i < 500; i++) { g.strokeStyle = `rgba(30,12,0,${r() * 0.25})`; const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 90, y + (r() - 0.5) * 3); g.stroke(); }
  });
  const sky = canvasTex(8, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#4f86c6'); gr.addColorStop(0.55, '#a8cde6'); gr.addColorStop(0.85, '#f4e6c3'); gr.addColorStop(1, '#f8efd4'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  sky.wrapS = sky.wrapT = T.ClampToEdgeWrapping;
  const dot = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const ring = canvasTex(128, 128, (g) => { g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 56, 0, TAU); g.stroke(); const gr = g.createRadialGradient(64, 64, 20, 64, 64, 60); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.35)'); g.fillStyle = gr; g.fill(); });
  const rain = canvasTex(8, 64, (g) => { const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(210,225,255,0)'); gr.addColorStop(1, 'rgba(210,225,255,.9)'); g.fillStyle = gr; g.fillRect(3, 0, 2, 64); });
  return { grass, hay, wood, sky, dot, ring, rain };
}

// Merge several geometries (each already transformed) into one, so a dog's legs or a sheep's four legs are a single draw.
function mergeGeos(list) {
  const pos = [], nor = [];
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); return g;
}
function boxAt(w, h, d, x, y, z) { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
function labelSprite(text, color = '#fff', size = 44) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.font = `800 ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 9; g.strokeStyle = 'rgba(20,28,10,.85)'; g.lineJoin = 'round'; g.strokeText(text, 256, 50); g.fillStyle = color; g.fillText(text, 256, 50);
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
  const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })); s.scale.set(4.4, 0.82, 1); s.renderOrder = 10; s.userData.tex = tex; return s;
}

export function createView(canvas) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new T.Scene(), tex = makeTextures();
  scene.background = tex.sky; scene.fog = new T.Fog(0xbfd9e6, 70, 220);
  const camera = new T.PerspectiveCamera(62, 1, 0.1, 500);
  const hemi = new T.HemisphereLight(0xdcecff, 0x6b8a46, 0.95), sun = new T.DirectionalLight(0xfff1d0, 2.1);
  sun.position.set(40, 70, 25); scene.add(hemi, sun, sun.target);
  let quality = 'medium', world = null, storm = false, flashT = 0, time = 0;
  const root = new T.Group(); scene.add(root);          // everything that belongs to the current field
  const dogsRoot = new T.Group(); scene.add(dogsRoot);   // dogs persist across field loads only if re-added by main
  const fx = [];                                         // transient effects
  const penViews = [];
  const sheepM = {}, SHEEP_MAX = 128;

  // ---- sheep: three instanced meshes (wool, head, legs) ----
  const woolGeo = new T.IcosahedronGeometry(0.5, 1); woolGeo.scale(0.9, 0.78, 1.15); woolGeo.translate(0, 0.62, 0);
  const headGeo = mergeGeos([(() => { const g = new T.SphereGeometry(0.2, 10, 8); g.scale(0.9, 1, 1.15); g.translate(0, 0.78, -0.62); return g; })(), boxAt(0.09, 0.14, 0.05, -0.17, 0.82, -0.58), boxAt(0.09, 0.14, 0.05, 0.17, 0.82, -0.58)]);
  const legGeo = mergeGeos([boxAt(0.09, 0.34, 0.09, -0.22, 0.17, -0.3), boxAt(0.09, 0.34, 0.09, 0.22, 0.17, -0.3), boxAt(0.09, 0.34, 0.09, -0.22, 0.17, 0.3), boxAt(0.09, 0.34, 0.09, 0.22, 0.17, 0.3)]);
  const mkInst = (geo, mat) => { const m = new T.InstancedMesh(geo, mat, SHEEP_MAX); m.count = 0; m.frustumCulled = false; m.castShadow = true; return m; };
  sheepM.wool = mkInst(woolGeo, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }));
  sheepM.head = mkInst(headGeo, new T.MeshStandardMaterial({ color: 0x2c2723, roughness: 0.9 }));
  sheepM.legs = mkInst(legGeo, new T.MeshStandardMaterial({ color: 0x2c2723, roughness: 0.9 }));
  scene.add(sheepM.wool, sheepM.head, sheepM.legs);
  const sheepState = [], tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpE = new T.Euler(), tmpS = new T.Vector3(1, 1, 1), tmpP = new T.Vector3(), tmpC = new T.Color();
  const WOOL = { w: 0xf4f1ea, b: 0x3d3a3a, g: 0xf3c63c };

  // ---- sky, ground, rain ----
  const ground = new T.Mesh(new T.PlaneGeometry(900, 900), new T.MeshStandardMaterial({ map: tex.grass, roughness: 1 }));
  tex.grass.repeat.set(150, 150); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const rainGeo = new T.BufferGeometry(), RAIN = 900, rp = new Float32Array(RAIN * 3);
  for (let i = 0; i < RAIN; i++) { rp[i * 3] = (Math.random() - 0.5) * 60; rp[i * 3 + 1] = Math.random() * 30; rp[i * 3 + 2] = (Math.random() - 0.5) * 60; }
  rainGeo.setAttribute('position', new T.BufferAttribute(rp, 3));
  const rain = new T.Points(rainGeo, new T.PointsMaterial({ color: 0xcfe0ff, size: 0.18, transparent: true, opacity: 0.55, depthWrite: false })); rain.visible = false; rain.frustumCulled = false; scene.add(rain);

  // ---- helpers for dogs ----
  const dogs = new Map();
  const matCache = new Map(), mat = (color, extra = {}) => { const k = color + JSON.stringify(extra); if (!matCache.has(k)) matCache.set(k, new T.MeshStandardMaterial({ color, roughness: 0.85, ...extra })); return matCache.get(k); };
  const BAND = { red: 0xd9453b, blue: 0x3a78d8, green: 0x3cae5b, gold: 0xf0c239 };
  function buildHat(kind) {
    const g = new T.Group();
    if (kind === 'cap') { const b = new T.Mesh(new T.SphereGeometry(0.2, 12, 8, 0, TAU, 0, Math.PI / 2), mat(0x2f5fb3)); const v = new T.Mesh(new T.BoxGeometry(0.22, 0.02, 0.16), mat(0x2f5fb3)); v.position.set(0, 0.01, -0.2); g.add(b, v); }
    else if (kind === 'straw') { const brim = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.03, 16), mat(0xe2c36b)); const top = new T.Mesh(new T.CylinderGeometry(0.17, 0.2, 0.17, 14), mat(0xe9cf80)); top.position.y = 0.09; const band = new T.Mesh(new T.CylinderGeometry(0.205, 0.205, 0.04, 14), mat(0xb4402d)); band.position.y = 0.04; g.add(brim, top, band); }
    else if (kind === 'cowboy') { const brim = new T.Mesh(new T.CylinderGeometry(0.46, 0.46, 0.025, 16), mat(0x7a4b25)); brim.scale.set(1, 1, 0.8); const top = new T.Mesh(new T.CylinderGeometry(0.15, 0.2, 0.22, 14), mat(0x8b5a2b)); top.position.y = 0.11; g.add(brim, top); }
    else if (kind === 'tophat') { const brim = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.025, 16), mat(0x1a1a1f)); const top = new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.4, 16), mat(0x1a1a1f)); top.position.y = 0.2; const band = new T.Mesh(new T.CylinderGeometry(0.195, 0.195, 0.07, 16), mat(0xb02a37)); band.position.y = 0.06; g.add(brim, top, band); }
    else if (kind === 'crown') { const ring = new T.Mesh(new T.CylinderGeometry(0.2, 0.17, 0.12, 8), mat(0xf2c230, { metalness: 0.7, roughness: 0.3, emissive: 0x6a4a00 })); g.add(ring); for (let i = 0; i < 6; i++) { const sp = new T.Mesh(new T.ConeGeometry(0.04, 0.12, 5), mat(0xf2c230, { metalness: 0.7, roughness: 0.3, emissive: 0x6a4a00 })); const a = i / 6 * TAU; sp.position.set(Math.cos(a) * 0.18, 0.11, Math.sin(a) * 0.18); g.add(sp); } }
    return g;
  }
  function buildDog(info) {
    const g = new T.Group(), body = new T.Group(); g.add(body);
    const fur = mat(new T.Color(info.cosm?.color || '#c0392b')), dark = mat(0x2a211c), cream = mat(0xf2e6cf);
    const torso = new T.Mesh(new T.BoxGeometry(0.62, 0.55, 1.15), fur); torso.position.y = 0.72; torso.castShadow = true;
    const chest = new T.Mesh(new T.BoxGeometry(0.5, 0.4, 0.5), cream); chest.position.set(0, 0.62, -0.42);
    const head = new T.Group(); head.position.set(0, 1.0, -0.72);
    const skull = new T.Mesh(new T.BoxGeometry(0.46, 0.42, 0.44), fur), snout = new T.Mesh(new T.BoxGeometry(0.24, 0.2, 0.3), cream); snout.position.set(0, -0.07, -0.34);
    const nose = new T.Mesh(new T.BoxGeometry(0.1, 0.08, 0.06), dark); nose.position.set(0, 0.0, -0.5);
    const earL = new T.Mesh(new T.BoxGeometry(0.12, 0.28, 0.14), dark), earR = earL.clone(); earL.position.set(-0.26, 0.14, 0.03); earR.position.set(0.26, 0.14, 0.03); earL.rotation.z = 0.35; earR.rotation.z = -0.35;
    const eyeL = new T.Mesh(new T.BoxGeometry(0.06, 0.07, 0.04), dark), eyeR = eyeL.clone(); eyeL.position.set(-0.12, 0.07, -0.22); eyeR.position.set(0.12, 0.07, -0.22);
    const jaw = new T.Mesh(new T.BoxGeometry(0.2, 0.06, 0.26), mat(0xd96a77)); jaw.position.set(0, -0.19, -0.33); head.add(skull, snout, nose, earL, earR, eyeL, eyeR, jaw);
    const tail = new T.Group(); tail.position.set(0, 0.95, 0.58); const tailM = new T.Mesh(new T.BoxGeometry(0.12, 0.12, 0.5), fur); tailM.position.z = 0.22; tailM.rotation.x = -0.5; tail.add(tailM);
    const legs = [], lp = [[-0.2, -0.4], [0.2, -0.4], [-0.2, 0.42], [0.2, 0.42]];
    for (const [x, z] of lp) { const l = new T.Group(); l.position.set(x, 0.5, z); const m = new T.Mesh(new T.BoxGeometry(0.16, 0.5, 0.16), fur); m.position.y = -0.25; const paw = new T.Mesh(new T.BoxGeometry(0.18, 0.08, 0.22), cream); paw.position.set(0, -0.5, -0.02); l.add(m, paw); body.add(l); legs.push(l); }
    body.add(torso, chest, head, tail);
    if (info.cosm?.bandana && info.cosm.bandana !== 'none') { const b = new T.Mesh(new T.CylinderGeometry(0.31, 0.31, 0.14, 10), mat(BAND[info.cosm.bandana] || 0xd9453b)); b.position.set(0, 0.95, -0.55); b.rotation.x = Math.PI / 2; const knot = new T.Mesh(new T.ConeGeometry(0.1, 0.2, 4), mat(BAND[info.cosm.bandana] || 0xd9453b)); knot.position.set(0, 0.85, -0.42); knot.rotation.x = Math.PI; b.visible = true; body.add(b, knot); }
    if (info.cosm?.hat && info.cosm.hat !== 'none') { const hat = buildHat(info.cosm.hat); hat.position.set(0, 0.24, 0.02); hat.rotation.x = 0; head.add(hat); }
    g.traverse(o => { if (o.isMesh) o.castShadow = quality === 'high'; });
    const ringMat = new T.MeshBasicMaterial({ map: tex.ring, color: new T.Color(info.cosm?.color || '#fff'), transparent: true, depthWrite: false, opacity: 0.9 });
    const ring = new T.Mesh(new T.PlaneGeometry(2.4, 2.4), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
    const label = labelSprite(info.name || '', '#ffffff', 40); label.position.y = 2.6; g.add(label);
    const stars = new T.Group(); stars.visible = false; for (let i = 0; i < 4; i++) { const s = new T.Mesh(new T.OctahedronGeometry(0.1), mat(0xffe27a, { emissive: 0xffc400 })); stars.add(s); } stars.position.y = 1.85; g.add(stars);
    dogsRoot.add(g);
    return { g, body, head, tail, legs, jaw, label, stars, ring, name: info.name, color: info.cosm?.color, cosmKey: JSON.stringify(info.cosm), phase: Math.random() * 6, x: 0, z: 0, yaw: 0, init: false, barkT: 0, speed: 0 };
  }

  function addFx(mesh, life, update) { scene.add(mesh); fx.push({ mesh, life, max: life, update }); }
  function ringFx(x, z, color, size, life) {
    const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: tex.ring, color, transparent: true, depthWrite: false, opacity: 0.9 })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.1, z);
    addFx(m, life, (f, k) => { const s = lerp(1, size, 1 - (1 - k) * (1 - k)); m.scale.set(s, s, 1); m.material.opacity = 0.9 * (1 - k); });
  }
  function puff(x, y, z, color = 0xe7d9b0, n = 5, spread = 1) {
    for (let i = 0; i < n; i++) {
      const m = new T.Sprite(new T.SpriteMaterial({ map: tex.dot, color, transparent: true, depthWrite: false, opacity: 0.7 })); m.position.set(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
      const vx = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2, vy = 0.8 + Math.random();
      addFx(m, 0.7, (f, k) => { m.position.x += vx * 0.016; m.position.z += vz * 0.016; m.position.y += vy * 0.016; const s = 0.5 + k * 1.4; m.scale.set(s, s, 1); m.material.opacity = 0.7 * (1 - k); });
    }
  }
  function sparkle(x, y, z, color = 0xffe27a, n = 14) {
    for (let i = 0; i < n; i++) {
      const m = new T.Sprite(new T.SpriteMaterial({ map: tex.dot, color, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); m.position.set(x, y, z); m.scale.set(0.5, 0.5, 1);
      const a = Math.random() * TAU, sp = 2 + Math.random() * 3, vy = 3 + Math.random() * 4;
      addFx(m, 0.9, (f, k) => { m.position.x += Math.cos(a) * sp * 0.016; m.position.z += Math.sin(a) * sp * 0.016; m.position.y += (vy - k * 9) * 0.016; m.material.opacity = 1 - k; });
    }
  }

  // ---- field construction ----
  function clearRoot() { for (const c of [...root.children]) { root.remove(c); c.traverse?.(o => { o.geometry?.dispose?.(); }); } penViews.length = 0; }
  function loadField(f) {
    clearRoot(); world = f; const H = f.half;
    const r = rnd(f.seed ^ 0x77);
    // perimeter fence: instanced posts + rail boxes
    const postN = Math.ceil(H * 8 / 3.2), posts = new T.InstancedMesh(new T.BoxGeometry(0.28, 1.8, 0.28), new T.MeshStandardMaterial({ map: tex.wood, roughness: 1 }), postN * 1 + 8);
    let pi = 0;
    for (let s = 0; s < 4; s++) { const n = Math.floor(2 * H / 3.2); for (let i = 0; i <= n; i++) { const t = -H + i * (2 * H / n); const x = s < 2 ? t : (s === 2 ? -H : H), z = s < 2 ? (s === 0 ? -H : H) : t; tmpM.makeTranslation(x, 0.9, z); posts.setMatrixAt(pi++, tmpM); } }
    posts.count = pi; posts.castShadow = true; root.add(posts);
    const railMat = new T.MeshStandardMaterial({ map: tex.wood, roughness: 1 });
    for (const [x, z, w, d] of [[0, -H, 2 * H, 0.14], [0, H, 2 * H, 0.14], [-H, 0, 0.14, 2 * H], [H, 0, 0.14, 2 * H]]) for (const y of [0.65, 1.3]) { const m = new T.Mesh(new T.BoxGeometry(w, 0.16, d), railMat); m.position.set(x, y, z); root.add(m); }
    // solids
    const baleMat = new T.MeshStandardMaterial({ map: tex.hay, roughness: 1 }), troughMat = new T.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 }), waterMat = new T.MeshStandardMaterial({ color: 0x4e91c8, roughness: 0.2, metalness: 0.1 });
    for (const s of f.solids) {
      if (s.kind === 'penwall') { const m = new T.Mesh(new T.BoxGeometry(s.w, 1.5, s.d), railMat); m.position.set(s.cx, 0.75, s.cz); m.castShadow = true; root.add(m); continue; }
      if (s.kind === 'bale') { const hgt = (s.stack || 1) * 0.95; const m = new T.Mesh(new T.BoxGeometry(s.w, hgt, s.d), baleMat); m.position.set(s.cx, hgt / 2, s.cz); m.castShadow = true; m.receiveShadow = true; root.add(m); continue; }
      if (s.kind === 'trough') { const m = new T.Mesh(new T.BoxGeometry(s.w, 0.8, s.d), troughMat); m.position.set(s.cx, 0.4, s.cz); m.castShadow = true; const wtr = new T.Mesh(new T.BoxGeometry(Math.max(0.1, s.w - 0.25), 0.05, Math.max(0.1, s.d - 0.25)), waterMat); wtr.position.set(s.cx, 0.78, s.cz); root.add(m, wtr); continue; }
      if (s.kind === 'rail') { const long = s.w > s.d; for (const y of [0.4, 0.85]) { const m = new T.Mesh(new T.BoxGeometry(s.w, 0.14, s.d), railMat); m.position.set(s.cx, y, s.cz); root.add(m); } for (let i = 0; i <= 3; i++) { const t = (i / 3 - 0.5) * (long ? s.w - 0.3 : s.d - 0.3); const p = new T.Mesh(new T.BoxGeometry(0.22, 1.2, 0.22), railMat); p.position.set(s.cx + (long ? t : 0), 0.6, s.cz + (long ? 0 : t)); root.add(p); } }
    }
    for (const m of f.mud) { const c = new T.Mesh(new T.CircleGeometry(m.r, 28), new T.MeshStandardMaterial({ color: 0x5a3f27, roughness: 0.4, metalness: 0.05, transparent: true, opacity: 0.92 })); c.rotation.x = -Math.PI / 2; c.position.set(m.x, 0.03, m.z); root.add(c); }
    // trees outside
    const trunkM = new T.InstancedMesh(new T.CylinderGeometry(0.3, 0.45, 3, 7), new T.MeshStandardMaterial({ color: 0x6a4727, roughness: 1 }), Math.max(1, f.trees.length));
    const leafM = new T.InstancedMesh(new T.IcosahedronGeometry(2.4, 1), new T.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 1, flatShading: true }), Math.max(1, f.trees.length));
    f.trees.forEach((t, i) => { tmpM.makeScale(t.s, t.s, t.s); tmpM.setPosition(t.x, 1.5 * t.s, t.z); trunkM.setMatrixAt(i, tmpM); tmpM.makeScale(t.s * (0.9 + r() * 0.3), t.s * (0.9 + r() * 0.3), t.s); tmpM.setPosition(t.x, 4.2 * t.s, t.z); leafM.setMatrixAt(i, tmpM); tmpC.setHSL(0.28 + r() * 0.07, 0.45, 0.3 + r() * 0.12); leafM.setColorAt(i, tmpC); });
    trunkM.count = leafM.count = f.trees.length; root.add(trunkM, leafM);
    // pens
    for (const p of f.pens) {
      const floorMat = new T.MeshBasicMaterial({ map: tex.ring, color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false });
      const floor = new T.Mesh(new T.PlaneGeometry(p.rect.maxX - p.rect.minX, p.rect.maxZ - p.rect.minZ), new T.MeshStandardMaterial({ color: 0xcaa968, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(p.cx, 0.02, p.cz); floor.receiveShadow = true;
      const tint = new T.Mesh(new T.PlaneGeometry(p.rect.maxX - p.rect.minX, p.rect.maxZ - p.rect.minZ), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }));
      tint.rotation.x = -Math.PI / 2; tint.position.set(p.cx, 0.05, p.cz);
      const pole = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 5.2, 8), railMat); pole.position.set(p.cx - p.u[0] * (p.w / 2 - 0.2), 2.6, p.cz - p.u[1] * (p.w / 2 - 0.2));
      const flag = new T.Mesh(new T.PlaneGeometry(2.2, 1.3), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide })); flag.position.set(pole.position.x + p.u[0] * 1.1, 4.5, pole.position.z + p.u[1] * 1.1);
      flag.rotation.y = p.u[0] ? 0 : Math.PI / 2;
      const label = labelSprite('', '#fff', 46); label.position.set(p.cx, 7, p.cz); label.scale.set(6.6, 1.2, 1);
      const glow = new T.Mesh(new T.PlaneGeometry(p.rect.maxX - p.rect.minX + 2, p.rect.maxZ - p.rect.minZ + 2), floorMat); glow.rotation.x = -Math.PI / 2; glow.position.set(p.cx, 0.07, p.cz);
      root.add(floor, tint, pole, flag, label, glow);
      penViews.push({ slot: p.slot, tint, flag, label, glow, pulse: 0, name: '', color: '#ffffff' });
    }
    ground.material.map.repeat.set(150, 150);
    sun.target.position.set(0, 0, 0); sun.shadow.camera.left = -H - 10; sun.shadow.camera.right = H + 10; sun.shadow.camera.top = H + 10; sun.shadow.camera.bottom = -H - 10; sun.shadow.camera.updateProjectionMatrix?.();
    sheepState.length = f.sheep.length; for (let i = 0; i < f.sheep.length; i++) sheepState[i] = { x: f.sheep[i].x, z: f.sheep[i].z, yaw: 0, flags: 0, tx: f.sheep[i].x, tz: f.sheep[i].z, tyaw: 0, type: f.sheep[i].type, ph: i * 1.7 };
    sheepM.wool.count = sheepM.head.count = sheepM.legs.count = f.sheep.length;
    f.sheep.forEach((s, i) => { sheepM.wool.setColorAt(i, tmpC.set(WOOL[s.type] || WOOL.w)); });
    sheepM.wool.instanceColor && (sheepM.wool.instanceColor.needsUpdate = true);
    for (const s of sheepState) s.yaw = Math.random() * TAU;
  }
  function setPenOwner(slot, name, color) {
    const pv = penViews.find(p => p.slot === slot); if (!pv) return;
    pv.name = name; pv.color = color; pv.tint.material.color.set(color); pv.flag.material.color.set(color); pv.glow.material.color.set(color);
    pv.label.material.map?.dispose?.(); const l = labelSprite(name, '#fff', 46); pv.label.material.map = l.userData.tex; pv.label.material.needsUpdate = true;
  }
  function clearField() { clearRoot(); world = null; for (const id of [...dogs.keys()]) removeDog(id); sheepM.wool.count = sheepM.head.count = sheepM.legs.count = 0; sheepState.length = 0; fx.splice(0).forEach(f => scene.remove(f.mesh)); }

  // ---- dynamic state ----
  function setSheep(arr) { // arr: compact wire format [x*10, z*10, yaw*20, flags]
    const n = Math.min(sheepState.length, Math.floor(arr.length / 4));
    for (let i = 0; i < n; i++) { const s = sheepState[i]; s.tx = arr[i * 4] / 10; s.tz = arr[i * 4 + 1] / 10; s.tyaw = arr[i * 4 + 2] / 20; s.flags = arr[i * 4 + 3]; }
  }
  function setDog(id, d) { // d: {x,z,yaw,flags,name,cosm,you,slot}
    let v = dogs.get(id);
    const key = JSON.stringify(d.cosm || {});
    if (v && (v.cosmKey !== key || v.name !== d.name)) { removeDog(id); v = null; }
    if (!v) { v = buildDog(d); dogs.set(id, v); }
    const f = d.flags | 0;
    if (!v.init) { v.x = d.x; v.z = d.z; v.yaw = d.yaw; v.init = true; }
    const dx = d.x - v.x, dz = d.z - v.z; v.speed = Math.hypot(dx, dz) / Math.max(0.001, d.dt || 0.016);
    v.x = d.x; v.z = d.z; v.yaw = d.yaw; v.flags = f; v.you = !!d.you;
    if ((f & 4) && !v.barking) { v.barkT = 0.45; }
    v.barking = !!(f & 4);
    v.label.visible = !d.you; v.g.position.set(v.x, 0, v.z); v.g.rotation.y = v.yaw;
  }
  function removeDog(id) { const v = dogs.get(id); if (!v) return; dogsRoot.remove(v.g); dogs.delete(id); }
  function clearDogs() { for (const id of [...dogs.keys()]) removeDog(id); }

  function bark(x, z, yaw) {
    const fx_ = -Math.sin(yaw), fz_ = -Math.cos(yaw);
    for (let i = 1; i <= 3; i++) setTimeout(() => ringFx(x + fx_ * i * 3.2, z + fz_ * i * 3.2, 0xfff2b0, 2 + i * 2.2, 0.45), i * 45);
  }
  function howl(x, z) { ringFx(x, z, 0xbfe0ff, 30, 0.9); setTimeout(() => ringFx(x, z, 0xbfe0ff, 22, 0.8), 140); }
  function dashFx(x, z) { puff(x, 0.2, z, 0xe7d9b0, 6, 1.2); }
  function bumpFx(x, z) { sparkle(x, 1.2, z, 0xffe27a, 16); }
  function pennedFx(slot, golden) {
    const pv = penViews.find(p => p.slot === slot); if (!pv) return; pv.pulse = 1;
    const p = world.pens[slot]; sparkle(p.cx, 1.3, p.cz, golden ? 0xffd34a : 0xffffff, golden ? 28 : 14);
  }
  function stolenFx(slot) { const p = world?.pens[slot]; if (p) sparkle(p.cx, 1.3, p.cz, 0xff6a5a, 18); const pv = penViews.find(q => q.slot === slot); if (pv) pv.pulse = 1; }
  function lightning() { flashT = 0.35; }
  function setStorm(on) { storm = on; rain.visible = on; }
  function setQuality(q) {
    quality = q; const pr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    renderer.setPixelRatio(pr); renderer.shadowMap.enabled = q !== 'low'; renderer.shadowMap.type = q === 'high' ? T.PCFSoftShadowMap : T.PCFShadowMap;
    sun.castShadow = q !== 'low'; sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024); sun.shadow.camera.near = 10; sun.shadow.camera.far = 200; sun.shadow.bias = -0.0006;
    resize();
  }
  function resize() { const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  window.addEventListener('resize', resize);

  // ---- per-frame ----
  const cam = { x: 0, z: 0, yaw: 0, init: false };
  function render(dt, view = {}) {
    time += dt;
    // dogs: legs, tail, head, state visuals
    for (const v of dogs.values()) {
      const moving = (v.flags & 1) || v.speed > 0.8, sprint = !!(v.flags & 2), dash = !!(v.flags & 8), stun = !!(v.flags & 16), slow = !!(v.flags & 32), howlIn = !!(v.flags & 64);
      const rate = dash ? 22 : sprint ? 17 : 11; v.phase += dt * (moving ? rate : 1.5);
      const amp = moving ? (sprint || dash ? 0.9 : 0.6) : 0.0;
      v.legs.forEach((l, i) => { l.rotation.x = Math.sin(v.phase + (i === 1 || i === 2 ? Math.PI : 0)) * amp; });
      v.body.position.y = moving ? Math.abs(Math.sin(v.phase)) * (sprint ? 0.12 : 0.06) : 0;
      v.body.rotation.x = dash ? 0.28 : sprint && moving ? 0.08 : 0; v.body.scale.z = dash ? 1.12 : 1; v.body.rotation.z = stun ? Math.sin(time * 14) * 0.12 : 0;
      v.tail.rotation.y = Math.sin(time * (moving ? 14 : 6) + v.phase) * 0.6; v.tail.rotation.x = sprint ? -0.35 : 0;
      v.barkT = Math.max(0, v.barkT - dt); const b = v.barkT / 0.45;
      v.head.rotation.x = b > 0 ? -0.55 * Math.sin(b * Math.PI) : howlIn ? -0.9 : 0; v.jaw.rotation.x = b > 0 || howlIn ? 0.65 : 0;
      v.stars.visible = stun; if (stun) v.stars.children.forEach((s, i) => { const a = time * 5 + i * TAU / 4; s.position.set(Math.cos(a) * 0.45, Math.sin(time * 6 + i) * 0.05, Math.sin(a) * 0.45); });
      v.ring.material.opacity = v.you ? 0.95 : 0.55; v.ring.scale.setScalar(slow ? 0.8 : 1);
      if (dash && Math.random() < 0.6) puff(v.x, 0.15, v.z, 0xe7d9b0, 1, 0.6); else if (sprint && moving && Math.random() < 0.12) puff(v.x, 0.12, v.z, 0xe7d9b0, 1, 0.5);
      if (slow && moving && Math.random() < 0.2) puff(v.x, 0.1, v.z, 0x7b5a38, 1, 0.5);
    }
    // sheep: smooth toward the latest server positions, hop while moving
    const k = Math.min(1, dt * 12), hop = time * 11;
    for (let i = 0; i < sheepState.length; i++) {
      const s = sheepState[i], dx = s.tx - s.x, dz = s.tz - s.z;
      if (dx * dx + dz * dz > 25) { s.x = s.tx; s.z = s.tz; } else { s.x += dx * k; s.z += dz * k; }
      let dy = s.tyaw - s.yaw; dy = ((dy + Math.PI) % TAU + TAU) % TAU - Math.PI; s.yaw += dy * Math.min(1, dt * 10);
      const moving = (s.flags & 1), panic = (s.flags & 2);
      const y = moving ? Math.abs(Math.sin(hop * (panic ? 1.5 : 1) + s.ph)) * (panic ? 0.2 : 0.1) : 0;
      const sc = s.type === 'g' ? 1.12 : s.type === 'b' ? 1.0 : 1.0;
      tmpE.set(panic && moving ? Math.sin(hop + s.ph) * 0.08 : 0, s.yaw, 0); tmpQ.setFromEuler(tmpE); tmpS.set(sc, sc, sc); tmpP.set(s.x, y, s.z); tmpM.compose(tmpP, tmpQ, tmpS);
      sheepM.wool.setMatrixAt(i, tmpM); sheepM.head.setMatrixAt(i, tmpM); sheepM.legs.setMatrixAt(i, tmpM);
      if (s.type === 'g' && Math.random() < 0.02) sparkle(s.x, 1.2, s.z, 0xffe27a, 1);
    }
    sheepM.wool.instanceMatrix.needsUpdate = sheepM.head.instanceMatrix.needsUpdate = sheepM.legs.instanceMatrix.needsUpdate = true;
    // pens pulse
    for (const pv of penViews) { pv.pulse = Math.max(0, pv.pulse - dt * 1.6); pv.glow.material.opacity = 0.18 * pv.pulse; pv.tint.material.opacity = 0.2 + 0.25 * pv.pulse; pv.label.position.y = 7 + Math.sin(time * 2 + pv.slot) * 0.2; if (pv.flag) pv.flag.rotation.z = Math.sin(time * 3 + pv.slot) * 0.06; }
    // effects
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.life -= dt; const kk = 1 - f.life / f.max; if (f.life <= 0) { scene.remove(f.mesh); f.mesh.material?.dispose?.(); fx.splice(i, 1); continue; } f.update(f, kk); }
    // storm look
    const dark = storm ? 0.62 : 1; hemi.intensity = (storm ? 0.55 : 0.95) + flashT * 3; sun.intensity = (storm ? 0.9 : 2.1) + flashT * 5; flashT = Math.max(0, flashT - dt);
    scene.fog.color.set(storm ? 0x7d8a99 : 0xbfd9e6); scene.fog.near = storm ? 45 : 70; scene.fog.far = storm ? 150 : 220;
    if (storm && rain.visible) { const p = rainGeo.attributes.position.array; for (let i = 0; i < RAIN; i++) { p[i * 3 + 1] -= dt * 28; if (p[i * 3 + 1] < 0) p[i * 3 + 1] = 30; } rainGeo.attributes.position.needsUpdate = true; rain.position.set(cam.x, 0, cam.z); }
    // third-person camera
    const tx = view.x ?? 0, tz = view.z ?? 0, yaw = view.yaw ?? 0, pitch = clamp(view.pitch ?? 0.5, 0.15, 1.1), dist = view.dist ?? 9.5;
    if (!cam.init) { cam.x = tx; cam.z = tz; cam.init = true; }
    const ck = Math.min(1, dt * 9); cam.x += (tx - cam.x) * ck; cam.z += (tz - cam.z) * ck; cam.yaw = yaw;
    const bx = Math.sin(yaw), bz = Math.cos(yaw); // behind the dog
    const hd = Math.cos(pitch) * dist, hy = Math.sin(pitch) * dist + 1.2;
    const shake = view.shake ? (Math.random() - 0.5) * view.shake : 0;
    camera.position.set(cam.x + bx * hd + shake, hy, cam.z + bz * hd + shake);
    camera.lookAt(cam.x - bx * 3.2, 1.2, cam.z - bz * 3.2);
    camera.fov = view.fov || 62; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  function snapCamera() { cam.init = false; }
  function dispose() { window.removeEventListener('resize', resize); renderer.dispose(); }
  setQuality('medium');
  return { loadField, clearField, setPenOwner, setSheep, setDog, removeDog, clearDogs, bark, howl, dashFx, bumpFx, pennedFx, stolenFx, lightning, setStorm, setQuality, render, snapCamera, resize, dispose };
}
