// Rendering layer (the ONLY module that touches Three.js). Game logic lives elsewhere and talks to this API.
// Procedural everything: textures are generated on canvases, hay is thousands of instanced strands.
const T = globalThis.__THREE;
const TAU = Math.PI * 2;

// ---- tiny deterministic noise so geometry is stable between sessions ----
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; if (repeat) t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 4; return t;
}

function makeTextures() {
  const r = rnd(7);
  const ground = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b9965a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const x = r() * w, y = r() * h, a = r() * Math.PI, l = 6 + r() * 16; g.strokeStyle = `hsla(${38 + r() * 12},${50 + r() * 25}%,${38 + r() * 30}%,${0.25 + r() * 0.4})`; g.lineWidth = 0.8 + r() * 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(90,60,30,${r() * 0.18})`; g.beginPath(); g.arc(r() * w, r() * h, 3 + r() * 10, 0, TAU); g.fill(); }
  }, [1, 1]);
  const drawHay = (g, w, h) => {
    g.fillStyle = '#d8b25a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { const x = r() * w, y = r() * h, a = -0.4 + r() * 0.8 + Math.PI / 2 * (r() < .3 ? 1 : 0), l = 10 + r() * 30; g.strokeStyle = `hsla(${40 + r() * 14},${60 + r() * 30}%,${42 + r() * 28}%,${0.4 + r() * 0.5})`; g.lineWidth = 1 + r() * 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  };
  const hay = canvasTex(256, 256, drawHay);
  const bale = canvasTex(256, 256, (g, w, h) => {
    drawHay(g, w, h);
    g.strokeStyle = '#6b4a22'; g.lineWidth = 5; for (const x of [h * 0.28, h * 0.72]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  });
  const wood = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6a4526'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) { g.fillStyle = `hsl(${24 + r() * 8},${38 + r() * 10}%,${22 + r() * 10}%)`; g.fillRect(0, y, w, 30); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y + 30, w, 2); }
    for (let i = 0; i < 700; i++) { g.strokeStyle = `rgba(20,10,0,${r() * 0.3})`; g.lineWidth = 1; const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 80, y + (r() - 0.5) * 3); g.stroke(); }
  });
  const sky = canvasTex(8, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5b8fc7'); gr.addColorStop(0.55, '#a9c6d8'); gr.addColorStop(0.82, '#f2dcae'); gr.addColorStop(1, '#f6e3b4'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  sky.wrapS = sky.wrapT = T.ClampToEdgeWrapping;
  const dot = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,245,210,1)'); gr.addColorStop(1, 'rgba(255,245,210,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const star = canvasTex(64, 64, (g, w, h) => { g.translate(32, 32); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,240,170,.8)'); gr.addColorStop(1, 'rgba(255,220,120,0)'); g.fillStyle = gr; g.fillRect(-32, -32, 64, 64); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-30, 0); g.lineTo(30, 0); g.moveTo(0, -30); g.lineTo(0, 30); g.stroke(); });
  return { ground, hay, bale, wood, sky, dot, star };
}

function strandGeometry() {
  // two crossed, slightly bent blades (6 triangles): cheap but reads as straw from any angle
  const pos = [], uv = [], idx = [];
  const blade = (rot) => {
    const c = Math.cos(rot), s = Math.sin(rot), base = pos.length / 3;
    const pts = [[0, 0, 0.018], [0, 0, -0.018], [0.05, 0.5, 0.012], [0.05, 0.5, -0.012], [0.16, 0.95, 0], [0.16, 0.95, 0]];
    pts.forEach(([x, y, z], i) => { pos.push(x * c - z * s, y, x * s + z * c); uv.push(i % 2, y); });
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  };
  blade(0); blade(Math.PI / 2);
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

function lumpyDome() {
  const g = new T.SphereGeometry(1, 28, 14, 0, TAU, 0, Math.PI / 2), p = g.attributes.position, r = rnd(99);
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.09 * Math.sin(x * 5 + ph[0]) * Math.cos(z * 4 + ph[1]) + 0.05 * Math.sin(y * 9 + x * 3 + ph[2]); p.setXYZ(i, x * n, y * (0.92 + 0.12 * Math.sin(x * 3 + z * 2 + ph[0])), z * n); }
  g.computeVertexNormals(); return g;
}

export function createView(canvas) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0xe9d3a0);
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(75, 1, 0.05, 600);
  camera.rotation.order = 'YXZ'; scene.add(camera);
  const tex = makeTextures(), strandGeo = strandGeometry(), domeGeo = lumpyDome();

  // ----- lighting & sky -----
  const hemi = new T.HemisphereLight(0xcfe3ff, 0xb08a4a, 1.6); scene.add(hemi);
  const sun = new T.DirectionalLight(0xffe2b0, 2.9); sun.position.set(60, 90, 35); sun.castShadow = false; scene.add(sun); scene.add(sun.target);
  const skyMesh = new T.Mesh(new T.SphereGeometry(450, 24, 16), new T.MeshBasicMaterial({ map: tex.sky, side: T.BackSide, fog: false, depthWrite: false, toneMapped: false })); skyMesh.renderOrder = -10; scene.add(skyMesh);
  const sunGlow = new T.Sprite(new T.SpriteMaterial({ map: tex.dot, color: 0xffe9b0, blending: T.AdditiveBlending, fog: false, depthWrite: false, transparent: true })); sunGlow.scale.set(160, 160, 1); sunGlow.position.set(240, 330, 130); scene.add(sunGlow);
  scene.fog = new T.Fog(0xe8cf9a, 35, 230);

  const mats = {
    straw: new T.MeshLambertMaterial({ color: 0xffffff, side: T.DoubleSide, map: null }),
    dome: new T.MeshLambertMaterial({ map: tex.hay, color: 0xe6c070 }),
    bale: new T.MeshLambertMaterial({ map: tex.bale }),
    wood: new T.MeshLambertMaterial({ map: tex.wood }),
    darkwood: new T.MeshLambertMaterial({ map: tex.wood, color: 0x8a6a4a }),
    metal: new T.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.35 }),
    rust: new T.MeshStandardMaterial({ color: 0x7a4a2a, metalness: 0.6, roughness: 0.8 }),
    roof: new T.MeshLambertMaterial({ color: 0x5a3a28 }),
  };
  let quality = 'medium', worldRoot = null, piles = [], world = null, dust = null, shadowOn = false;
  const remotes = new Map(), needles = new Map(), floaters = [], particles = [];
  const hands = new T.Group(); camera.add(hands);
  let detModel = null, digT = 0, digging = false, detOn = false, detLevel = 0, skinId = 'brass', gloveColor = 0xb88a4a;

  const Q = {
    low:    { shadow: 0,    strands: 0.3,  dust: 150, ratio: 1,    dist: 150 },
    medium: { shadow: 1024, strands: 0.65, dust: 350, ratio: 1.25, dist: 200 },
    high:   { shadow: 2048, strands: 1,    dust: 650, ratio: 2,    dist: 260 },
  };

  function applyQuality() {
    const q = Q[quality] || Q.medium;
    renderer.setPixelRatio(Math.min(q.ratio, window.devicePixelRatio || 1));
    shadowOn = q.shadow > 0; renderer.shadowMap.enabled = shadowOn; renderer.shadowMap.type = T.PCFSoftShadowMap;
    sun.castShadow = shadowOn;
    if (shadowOn) { sun.shadow.mapSize.set(q.shadow, q.shadow); const c = sun.shadow.camera; c.left = c.bottom = -38; c.right = c.top = 38; c.near = 10; c.far = 260; c.updateProjectionMatrix(); sun.shadow.bias = -0.0006; sun.shadow.map?.dispose(); sun.shadow.map = null; }
    if (world) rebuildStrandsOnly();
    buildDust();
    resize();
  }

  function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  // ----- dust motes in the sun -----
  function buildDust() {
    if (dust) { scene.remove(dust); dust.geometry.dispose(); dust.material.dispose(); }
    const n = (Q[quality] || Q.medium).dust, p = new Float32Array(n * 3), r = rnd(5);
    for (let i = 0; i < n; i++) { p[i * 3] = (r() - 0.5) * 50; p[i * 3 + 1] = r() * 12; p[i * 3 + 2] = (r() - 0.5) * 50; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
    dust = new T.Points(g, new T.PointsMaterial({ map: tex.dot, size: 0.16, color: 0xfff0c8, transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true, fog: false }));
    dust.frustumCulled = false; scene.add(dust);
  }

  // ----- world -----
  function box(w, h, d, mat, x, y, z, parent) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; (parent || worldRoot).add(m); return m; }

  function buildPileStrands(pile, k) {
    const q = Q[quality] || Q.medium, r = rnd(pile.id * 7919 + (world.seed & 0xffff));
    const count = Math.max(60, Math.min(1800, Math.floor(pile.r * pile.r * 30 * q.strands))) * (pile.deep ? 0.7 : 1) | 0;
    const mesh = new T.InstancedMesh(strandGeo, mats.straw, count), m4 = new T.Matrix4(), e = new T.Euler(), qn = new T.Quaternion(), pos = new T.Vector3(), sc = new T.Vector3(), col = new T.Color();
    for (let i = 0; i < count; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * pile.r * 0.98, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const t = d / pile.r, y = pile.h * Math.pow(Math.max(0, 1 - t * t), 0.8) - 0.1;
      e.set((r() - 0.5) * 1.5 + Math.sin(a) * t * 0.5, r() * TAU, (r() - 0.5) * 1.5 - Math.cos(a) * t * 0.5);
      qn.setFromEuler(e); const s = 0.9 + r() * 1.1; sc.set(s, s * (0.8 + r() * 0.8), s);
      pos.set(pile.x + x, Math.max(0, y), pile.z + z); m4.compose(pos, qn, sc); mesh.setMatrixAt(i, m4);
      col.setHSL(0.11 + r() * 0.03, 0.55 + r() * 0.3, 0.42 + r() * 0.22); mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadowOn; mesh.receiveShadow = true; mesh.userData = { pile, full: count };
    mesh.boundingSphere = new T.Sphere(new T.Vector3(pile.x, pile.h * 0.5, pile.z), pile.r + 1.5); mesh.frustumCulled = true;
    return mesh;
  }

  function rebuildStrandsOnly() {
    for (const p of piles) { worldRoot.remove(p.mesh); p.mesh.dispose?.(); }
    piles = world.piles.map(pile => { const mesh = buildPileStrands(pile); worldRoot.add(mesh); return { pile, mesh }; });
  }

  function loadWorld(w) {
    clearWorld(); world = w; worldRoot = new T.Group(); scene.add(worldRoot);
    const half = w.half, far = Math.max(180, w.size * 1.3);
    scene.fog.near = 35; scene.fog.far = far;
    // ground (+ darker outer field) & boundary
    tex.ground.repeat.set(w.size / 7, w.size / 7);
    const g = new T.Mesh(new T.PlaneGeometry(w.size + 40, w.size + 40), new T.MeshLambertMaterial({ map: tex.ground })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; worldRoot.add(g);
    const outer = new T.Mesh(new T.PlaneGeometry(2000, 2000), new T.MeshLambertMaterial({ color: 0x9a8049 })); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.05; worldRoot.add(outer);
    const posts = new T.InstancedMesh(new T.BoxGeometry(0.22, 1.8, 0.22), mats.wood, Math.ceil(w.size * 4 / 3.5) + 4), m4 = new T.Matrix4(); let pi = 0;
    for (let s = 0; s < 4; s++) for (let d = -half; d < half; d += 3.5) { const x = s < 2 ? d : (s === 2 ? half : -half), z = s < 2 ? (s === 0 ? half : -half) : d; m4.makeTranslation(x, 0.9, z); posts.setMatrixAt(pi++, m4); }
    posts.count = pi; posts.castShadow = true; worldRoot.add(posts);
    for (const y of [0.55, 1.25]) { box(w.size, 0.12, 0.1, mats.wood, 0, y, half, worldRoot); box(w.size, 0.12, 0.1, mats.wood, 0, y, -half, worldRoot); box(0.1, 0.12, w.size, mats.wood, half, y, 0, worldRoot); box(0.1, 0.12, w.size, mats.wood, -half, y, 0, worldRoot); }

    // pile domes (instanced) + strands (one instanced mesh per pile for culling + LOD)
    const domes = new T.InstancedMesh(domeGeo, mats.dome, Math.max(1, w.piles.length)), col = new T.Color(), qn = new T.Quaternion(), r = rnd(w.seed);
    w.piles.forEach((p, i) => { m4.compose(new T.Vector3(p.x, -0.05, p.z), qn.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * TAU), new T.Vector3(p.r * 1.02, Math.max(0.5, p.h), p.r * 1.02)); domes.setMatrixAt(i, m4); col.setHSL(0.11 + r() * 0.02, 0.6, 0.55 + r() * 0.12); domes.setColorAt(i, col); });
    domes.receiveShadow = true; domes.castShadow = shadowOn; worldRoot.add(domes);
    piles = []; rebuildStrandsOnly();

    // solids: bales, barn walls, posts, fences, props
    const bales = w.solids.filter(s => s.kind === 'bale'), baleInst = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), mats.bale, Math.max(1, bales.reduce((n, s) => n + s.stack, 0)));
    let bi = 0; for (const s of bales) for (let l = 0; l < s.stack; l++) { m4.compose(new T.Vector3(s.cx, 0.275 + l * 0.55, s.cz), new T.Quaternion(), new T.Vector3(s.w, 0.54, s.d)); baleInst.setMatrixAt(bi++, m4); }
    baleInst.count = bi; baleInst.castShadow = baleInst.receiveShadow = true; worldRoot.add(baleInst);
    for (const s of w.solids) {
      if (s.kind === 'barnwall') box(s.w, s.h, s.d, mats.wood, s.cx, s.h / 2, s.cz);
      else if (s.kind === 'post') box(s.w, s.h, s.d, mats.darkwood, s.cx, s.h / 2, s.cz);
      else if (s.kind === 'fence') { box(s.w, 0.12, s.d, mats.wood, s.cx, 0.55, s.cz); box(s.w, 0.12, s.d, mats.wood, s.cx, 1.1, s.cz); const n = Math.floor((s.alongX ? s.w : s.d) / 2.5) + 1; for (let i = 0; i < n; i++) { const o = -(s.alongX ? s.w : s.d) / 2 + i * ((s.alongX ? s.w : s.d) / Math.max(1, n - 1)); box(0.2, 1.3, 0.2, mats.darkwood, s.cx + (s.alongX ? o : 0), 0.65, s.cz + (s.alongX ? 0 : o)); } }
      else if (s.kind === 'barrel') { const m = new T.Mesh(new T.CylinderGeometry(0.47, 0.42, 1.1, 14), mats.wood); m.position.set(s.cx, 0.55, s.cz); m.castShadow = true; worldRoot.add(m); const band = new T.Mesh(new T.TorusGeometry(0.46, 0.025, 6, 16), mats.metal); band.rotation.x = Math.PI / 2; band.position.set(s.cx, 0.9, s.cz); worldRoot.add(band); const b2 = band.clone(); b2.position.y = 0.25; worldRoot.add(b2); }
      else if (s.kind === 'crate') { const m = box(s.w, s.h, s.d, mats.wood, s.cx, s.h / 2, s.cz); m.rotation.y = 0.2; }
      else if (s.kind === 'cart') { const gp = new T.Group(); gp.position.set(s.cx, 0, s.cz); gp.rotation.y = s.rot || 0; box(3.0, 0.15, 1.5, mats.darkwood, 0, 0.7, 0, gp); box(3.0, 0.5, 0.1, mats.wood, 0, 1.0, 0.7, gp); box(3.0, 0.5, 0.1, mats.wood, 0, 1.0, -0.7, gp); for (const sx of [-0.9, 0.9]) { const wh = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 0.1, 14), mats.wood); wh.rotation.x = Math.PI / 2; wh.position.set(sx, 0.55, 0.85); gp.add(wh); const w2 = wh.clone(); w2.position.z = -0.85; gp.add(w2); } box(1.6, 0.06, 0.06, mats.wood, 2.1, 0.5, 0, gp).rotation.z = 0.3; worldRoot.add(gp); }
    }
    for (const p of w.props) { const gp = new T.Group(); gp.position.set(p.x, 0, p.z); gp.rotation.y = p.rot; const pole = new T.Mesh(new T.CylinderGeometry(0.025, 0.03, 1.7, 6), mats.wood); pole.position.y = 0.85; pole.rotation.z = 0.25; gp.add(pole); for (let i = -1; i <= 1; i++) { const pr = new T.Mesh(new T.CylinderGeometry(0.01, 0.015, 0.4, 5), mats.metal); pr.position.set(-0.4 + i * 0.05, 1.6 - 0.05, i * 0.07); pr.rotation.z = 0.25; gp.add(pr); } gp.position.y = 0; worldRoot.add(gp); }
    for (const b of w.barns) { // roof, floor, beams and a loft
      const pw = b.d / 2 + 0.9, len = Math.hypot(pw, 2.4), ang = Math.atan2(2.4, pw);
      for (const sgn of [-1, 1]) { const rp = box(b.w + 1.2, 0.25, len, mats.roof, b.cx, b.h + 1.2, b.cz + sgn * (pw / 2)); rp.rotation.x = -sgn * ang; }
      const fl = new T.Mesh(new T.PlaneGeometry(b.w, b.d), new T.MeshLambertMaterial({ map: tex.wood, color: 0xb59468 })); fl.rotation.x = -Math.PI / 2; fl.position.set(b.cx, 0.03, b.cz); fl.receiveShadow = true; worldRoot.add(fl);
      for (let x = -b.w / 2 + 2; x < b.w / 2; x += 3.5) box(0.35, 0.4, b.d, mats.darkwood, b.cx + x, b.h - 0.2, b.cz);
      box(b.w, 0.4, 0.4, mats.darkwood, b.cx, b.h - 0.2, b.cz);
    }
    buildDust();
  }

  function clearWorld() {
    if (!worldRoot) return;
    scene.remove(worldRoot);
    worldRoot.traverse(o => { if (o.geometry && o.geometry !== strandGeo && o.geometry !== domeGeo) o.geometry.dispose(); });
    worldRoot = null; piles = []; world = null; hideNeedles();
    for (const f of floaters) scene.remove(f.obj); floaters.length = 0; for (const p of particles) scene.remove(p.obj); particles.length = 0;
  }

  // ----- hay LOD (distance based instance counts + hard cull beyond fog) -----
  let lodTick = 0;
  function updateLOD() {
    if (++lodTick % 12) return;
    const cx = camera.position.x, cz = camera.position.z, farD = scene.fog.far + 20;
    for (const { pile, mesh } of piles) {
      const d = Math.hypot(pile.x - cx, pile.z - cz) - pile.r, full = mesh.userData.full;
      mesh.visible = d < farD;
      mesh.count = d < 30 ? full : d < 70 ? Math.ceil(full * 0.55) : Math.ceil(full * 0.22);
    }
  }

  // ----- avatars -----
  const HAT = {
    straw: c => { const g = new T.Group(); const br = new T.Mesh(new T.CylinderGeometry(0.34, 0.34, 0.02, 14), new T.MeshLambertMaterial({ color: 0xe0c070 })); const top = new T.Mesh(new T.CylinderGeometry(0.17, 0.2, 0.15, 12), new T.MeshLambertMaterial({ color: 0xd8b860 })); top.position.y = 0.08; g.add(br, top); return g; },
    cap: c => { const g = new T.Group(); const d = new T.Mesh(new T.SphereGeometry(0.21, 12, 8, 0, TAU, 0, Math.PI / 2), new T.MeshLambertMaterial({ color: c })); const v = new T.Mesh(new T.BoxGeometry(0.22, 0.02, 0.18), new T.MeshLambertMaterial({ color: c })); v.position.set(0, 0.02, -0.2); g.add(d, v); return g; },
    cowboy: c => { const g = new T.Group(); const br = new T.Mesh(new T.CylinderGeometry(0.4, 0.38, 0.02, 16), new T.MeshLambertMaterial({ color: 0x6a4a2a })); const top = new T.Mesh(new T.CylinderGeometry(0.15, 0.2, 0.22, 12), new T.MeshLambertMaterial({ color: 0x6a4a2a })); top.position.y = 0.11; g.add(br, top); return g; },
    tophat: c => { const g = new T.Group(); const br = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.02, 16), new T.MeshLambertMaterial({ color: 0x1b1b1b })); const top = new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.36, 14), new T.MeshLambertMaterial({ color: 0x1b1b1b })); top.position.y = 0.18; const band = new T.Mesh(new T.CylinderGeometry(0.195, 0.195, 0.06, 14), new T.MeshLambertMaterial({ color: 0xc0392b })); band.position.y = 0.06; g.add(br, top, band); return g; },
  };
  const JACKET = { none: null, overalls: 0x3a5a8c, plaid: 0xa83232, vest: 0x4a6a3a };
  const BOOT = { plain: 0x4a3626, rubber: 0x2d5a3a, cowboy: 0x7a4a2a };
  const SKIN = { brass: 0xc9a227, chrome: 0xcfd6dc, neon: 0x39ff88 };

  function label(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.font = 'bold 30px "Trebuchet MS", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(20,12,4,.85)'; g.strokeText(text, 128, 34); g.fillStyle = color || '#fff3d0'; g.fillText(text, 128, 34);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false })); s.scale.set(1.6, 0.4, 1); s.renderOrder = 20; return s;
  }

  function buildAvatar(info) {
    const root = new T.Group(), c = info.cosm || {};
    const skin = new T.MeshLambertMaterial({ color: 0xe6b88f }), cloth = new T.MeshLambertMaterial({ color: new T.Color(c.color || '#c0392b') });
    const jc = JACKET[c.jacket]; const body = new T.Mesh(new T.CylinderGeometry(0.24, 0.27, 0.62, 12), jc ? new T.MeshLambertMaterial({ color: jc }) : cloth); body.position.y = 1.08; root.add(body);
    if (c.jacket === 'overalls') { const bib = new T.Mesh(new T.BoxGeometry(0.3, 0.3, 0.05), cloth); bib.position.set(0, 1.12, -0.25); root.add(bib); }
    const head = new T.Mesh(new T.SphereGeometry(0.18, 14, 12), skin); head.position.y = 1.58; root.add(head);
    const hatMk = HAT[c.hat]; if (hatMk) { const h = hatMk(c.hat === 'cap' ? new T.Color(c.color || '#c0392b') : 0); h.position.y = 1.72; root.add(h); }
    const mkLimb = (x, len, mat, y) => { const p = new T.Group(); p.position.set(x, y, 0); const m = new T.Mesh(new T.CylinderGeometry(0.07, 0.065, len, 8), mat); m.position.y = -len / 2; p.add(m); root.add(p); return p; };
    const pants = new T.MeshLambertMaterial({ color: 0x3a4a63 }), boots = new T.MeshLambertMaterial({ color: BOOT[c.boots] || BOOT.plain });
    const legL = mkLimb(-0.11, 0.78, pants, 0.8), legR = mkLimb(0.11, 0.78, pants, 0.8);
    for (const l of [legL, legR]) { const f = new T.Mesh(new T.BoxGeometry(0.14, 0.1, 0.26), boots); f.position.set(0, -0.78, -0.05); l.add(f); }
    const gl = c.gloves && c.gloves !== 'none' ? new T.MeshLambertMaterial({ color: c.gloves === 'leather' ? 0x6a4a2a : 0xc9a860 }) : skin;
    const armL = mkLimb(-0.33, 0.6, jc ? new T.MeshLambertMaterial({ color: jc }) : cloth, 1.32), armR = mkLimb(0.33, 0.6, jc ? new T.MeshLambertMaterial({ color: jc }) : cloth, 1.32);
    for (const a of [armL, armR]) { const h = new T.Mesh(new T.SphereGeometry(0.075, 8, 8), gl); h.position.y = -0.62; a.add(h); }
    const det = new T.Group(); const shaft = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.9, 6), new T.MeshLambertMaterial({ color: SKIN[c.skin] || SKIN.brass })); shaft.rotation.x = Math.PI / 2; const dish = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.02, 14), new T.MeshLambertMaterial({ color: 0x333 })); dish.position.z = -0.45; det.add(shaft, dish); det.position.set(0, -0.6, 0); det.visible = false; armR.add(det);
    const name = label(info.name || '?', info.team === 0 ? '#ff8a7a' : info.team === 1 ? '#7ab8ff' : '#fff3d0'); name.position.y = 2.15; root.add(name);
    root.traverse(o => { if (o.isMesh) o.castShadow = shadowOn; });
    return { root, legL, legR, armL, armR, det, name, head, phase: Math.random() * 6, nameText: info.name, team: info.team, cosmKey: JSON.stringify(c) };
  }

  function setRemote(id, d) {
    let r = remotes.get(id);
    const key = JSON.stringify(d.cosm || {});
    if (r && (r.nameText !== d.name || r.team !== d.team || r.cosmKey !== key)) { scene.remove(r.root); remotes.delete(id); r = null; }
    if (!r) { r = buildAvatar(d); scene.add(r.root); remotes.set(id, r); }
    r.root.position.set(d.x, d.y, d.z); r.root.rotation.y = d.yaw; // model front is -Z, same convention as the camera
    const moving = d.flags & 1, sprint = (d.flags & 2) ? 1.5 : 1, searching = d.flags & 4, det = d.flags & 8;
    r.phase += (moving ? 0.19 * sprint : 0);
    const sw = moving ? Math.sin(r.phase * 3) * 0.7 * sprint : 0;
    r.legL.rotation.x = sw; r.legR.rotation.x = -sw;
    if (searching) { const t = performance.now() / 160; r.armL.rotation.x = -0.9 + Math.sin(t) * 0.5; r.armR.rotation.x = -0.9 - Math.sin(t) * 0.5; r.root.children[0].rotation.x = 0.35; }
    else { r.root.children[0].rotation.x = 0; r.armL.rotation.x = -sw * 0.8; r.armR.rotation.x = det ? -1.2 : sw * 0.8; }
    r.det.visible = !!det; r.head.rotation.x = d.pitch * -0.5;
  }
  function removeRemote(id) { const r = remotes.get(id); if (r) { scene.remove(r.root); remotes.delete(id); } }
  function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

  // ----- first-person hands & detector -----
  function buildHands() {
    hands.clear();
    const skinM = new T.MeshLambertMaterial({ color: gloveColor }), sleeve = new T.MeshLambertMaterial({ color: 0x3a5a8c });
    const mk = (x) => { const g = new T.Group(); const arm = new T.Mesh(new T.BoxGeometry(0.09, 0.09, 0.55), sleeve); arm.position.z = 0.1; const hand = new T.Mesh(new T.BoxGeometry(0.1, 0.07, 0.14), skinM); hand.position.z = -0.2; g.add(arm, hand); g.position.set(x, -0.3, -0.45); g.rotation.x = 0.1; hands.add(g); return g; };
    hands.userData.L = mk(-0.26); hands.userData.R = mk(0.26);
    detModel = new T.Group();
    const handle = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.5, 8), new T.MeshStandardMaterial({ color: 0x222, metalness: 0.4, roughness: 0.6 })); handle.rotation.x = Math.PI / 2.4; handle.position.set(0, 0, 0);
    const shaft = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, 0.85, 8), new T.MeshStandardMaterial({ color: SKIN[skinId] || SKIN.brass, metalness: 0.8, roughness: 0.3 })); shaft.rotation.x = Math.PI / 2; shaft.position.set(0, 0, -0.45);
    const dish = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.018, 20), new T.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.5, roughness: 0.5 })); dish.position.set(0, -0.06, -0.88); dish.rotation.x = 0.15;
    const ring = new T.Mesh(new T.TorusGeometry(0.17, 0.012, 6, 24), new T.MeshStandardMaterial({ color: SKIN[skinId] || SKIN.brass, metalness: 0.9, roughness: 0.25 })); ring.rotation.x = Math.PI / 2 + 0.15; ring.position.copy(dish.position);
    const screen = new T.Mesh(new T.BoxGeometry(0.1, 0.012, 0.08), new T.MeshBasicMaterial({ color: 0x33ff88 })); screen.position.set(0, 0.04, -0.1); screen.rotation.x = -0.4;
    detModel.add(handle, shaft, dish, ring, screen); detModel.userData.screen = screen; detModel.userData.shaft = shaft; detModel.userData.ring = ring;
    detModel.position.set(0.22, -0.34, -0.42); detModel.visible = false; hands.add(detModel);
  }
  buildHands();

  function setLoadout({ skin, gloves, jacket } = {}) {
    if (skin) skinId = skin; if (gloves) gloveColor = gloves === 'leather' ? 0x6a4a2a : gloves === 'work' ? 0xc9a860 : 0xe6b88f; buildHands();
  }

  // ----- needle, decoys, particles -----
  function showNeedle(id, x, z, golden) {
    hideNeedle(id);
    const g = new T.Group(), col = golden ? 0xffd24a : 0xe8edf2;
    const mat = new T.MeshStandardMaterial({ color: col, metalness: 1, roughness: 0.18, emissive: golden ? 0xaa7a10 : 0x334455, emissiveIntensity: 0.9 });
    const n = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, 0.42, 6), mat); n.rotation.z = Math.PI / 2; n.rotation.y = 0.6; n.position.y = 0.06; g.add(n);
    const eye = new T.Mesh(new T.TorusGeometry(0.02, 0.005, 6, 10), mat); eye.position.set(-0.17 * Math.cos(0.6), 0.06, 0.17 * Math.sin(0.6)); g.add(eye);
    const glint = new T.Sprite(new T.SpriteMaterial({ map: tex.star, color: golden ? 0xffe27a : 0xffffff, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); glint.scale.set(0.9, 0.9, 1); glint.position.y = 0.12; g.add(glint);
    g.position.set(x, 0, z); scene.add(g); needles.set(id, { g, glint, t: 0 });
  }
  function hideNeedle(id) { const n = needles.get(id); if (n) { scene.remove(n.g); needles.delete(id); } }
  function hideNeedles() { for (const id of [...needles.keys()]) hideNeedle(id); }

  function decoyMesh(type) {
    const g = new T.Group(), M = mats;
    if (type === 'coin') { const m = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.015, 16), new T.MeshStandardMaterial({ color: 0xffd24a, metalness: 1, roughness: 0.25 })); m.rotation.x = Math.PI / 2; g.add(m); }
    else if (type === 'twig') { const m = new T.Mesh(new T.CylinderGeometry(0.012, 0.016, 0.4, 5), M.wood); m.rotation.z = 1.2; g.add(m); }
    else if (type === 'nail') { const s = new T.Mesh(new T.CylinderGeometry(0.01, 0.006, 0.3, 6), M.metal); const h = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.01, 8), M.metal); h.position.y = 0.15; g.add(s, h); g.rotation.z = 1.1; }
    else if (type === 'bolt') { const s = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.18, 6), M.metal); const h = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.04, 6), M.metal); h.position.y = 0.11; g.add(s, h); }
    else if (type === 'wire') { const m = new T.Mesh(new T.TorusGeometry(0.1, 0.006, 5, 14, Math.PI * 1.6), M.metal); g.add(m); }
    else if (type === 'tool') { const a = new T.Mesh(new T.BoxGeometry(0.28, 0.03, 0.05), M.rust), b = new T.Mesh(new T.BoxGeometry(0.06, 0.07, 0.04), M.metal); b.position.x = 0.15; g.add(a, b); }
    else { const m = new T.Mesh(new T.BoxGeometry(0.2, 0.02, 0.14), M.rust); m.rotation.y = 0.5; g.add(m); }
    return g;
  }
  function spawnDecoy(type, x, z) { const g = decoyMesh(type); g.position.set(x, 0.2, z); scene.add(g); floaters.push({ obj: g, t: 0, x, z }); }

  const strandMat = new T.MeshLambertMaterial({ color: 0xe3bf62, side: T.DoubleSide });
  function strawBurst(x, y, z, n = 10, power = 3) {
    for (let i = 0; i < n; i++) {
      const m = new T.Mesh(strandGeo, strandMat); const a = Math.random() * TAU, v = power * (0.4 + Math.random());
      m.position.set(x, y, z); m.scale.setScalar(0.8 + Math.random() * 0.8); m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); scene.add(m);
      particles.push({ obj: m, vx: Math.cos(a) * v, vy: 2 + Math.random() * 3.5, vz: Math.sin(a) * v, t: 0, life: 0.9 + Math.random() * 0.5, spin: (Math.random() - 0.5) * 12 });
    }
    while (particles.length > 160) { scene.remove(particles.shift().obj); }
  }

  // ----- per-frame -----
  const sunOff = new T.Vector3(60, 90, 35);
  function render(dt, local) {
    camera.position.set(local.x, local.y + local.eye + (local.bob || 0), local.z); camera.rotation.set(local.pitch, local.yaw, local.roll || 0);
    if (Math.abs(camera.fov - local.fov) > 0.05) { camera.fov += (local.fov - camera.fov) * Math.min(1, dt * 8); camera.updateProjectionMatrix(); }
    skyMesh.position.copy(camera.position);
    sun.position.set(Math.round(local.x) + sunOff.x, sunOff.y, Math.round(local.z) + sunOff.z); sun.target.position.set(Math.round(local.x), 0, Math.round(local.z)); sun.target.updateMatrixWorld();
    if (dust) { dust.position.set(local.x, 0, local.z); const p = dust.geometry.attributes.position, t = performance.now() / 4000; for (let i = 0; i < p.count; i += 3) p.setY(i, (p.getY(i) + dt * 0.05) % 12); p.needsUpdate = true; dust.material.opacity = 0.5 + Math.sin(t) * 0.1; }
    // hands: idle sway, digging animation, detector raise
    digT += dt * (digging ? 9 : 2.2);
    const L = hands.userData.L, R = hands.userData.R;
    if (digging) { L.position.set(-0.22, -0.34 + Math.sin(digT) * 0.12, -0.5 - Math.max(0, Math.sin(digT)) * 0.2); R.position.set(0.22, -0.34 - Math.sin(digT) * 0.12, -0.5 - Math.max(0, -Math.sin(digT)) * 0.2); L.rotation.x = 0.3 + Math.sin(digT) * 0.5; R.rotation.x = 0.3 - Math.sin(digT) * 0.5; }
    else { L.position.set(-0.26, -0.3 + Math.sin(digT) * 0.006, -0.45); R.position.set(0.26, -0.3 + Math.cos(digT) * 0.006, -0.45); L.rotation.x = R.rotation.x = 0.1; }
    R.visible = !detOn; detModel.visible = detOn;
    if (detOn) { const s = detModel.userData.screen.material; s.color.setHSL(0.33 - detLevel * 0.33, 1, 0.5); detModel.rotation.x = Math.sin(digT * 0.7) * 0.04 - 0.05; detModel.position.y = -0.34 + Math.sin(digT) * 0.01; }
    // needles pulse
    for (const n of needles.values()) { n.t += dt; n.glint.material.opacity = 0.65 + Math.sin(n.t * 6) * 0.35; n.glint.scale.setScalar(0.7 + Math.sin(n.t * 4) * 0.25); n.g.rotation.y += dt * 0.6; }
    for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.t += dt; f.obj.position.y = 0.3 + f.t * 0.9; f.obj.rotation.y += dt * 4; f.obj.scale.setScalar(Math.max(0.01, 1 - Math.max(0, f.t - 1.1) * 3)); if (f.t > 1.5) { scene.remove(f.obj); floaters.splice(i, 1); } }
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.t += dt; p.vy -= 11 * dt; p.obj.position.x += p.vx * dt; p.obj.position.y += p.vy * dt; p.obj.position.z += p.vz * dt; p.obj.rotation.x += p.spin * dt; p.obj.rotation.z += p.spin * dt; if (p.obj.position.y < 0.02 || p.t > p.life) { scene.remove(p.obj); particles.splice(i, 1); } }
    updateLOD();
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', resize);
  const api = {
    setQuality(q) { quality = Q[q] ? q : 'medium'; applyQuality(); },
    loadWorld, clearWorld, setRemote, removeRemote, clearRemotes, showNeedle, hideNeedle, hideNeedles, spawnDecoy, strawBurst, setLoadout, render, resize,
    setDigging(v) { digging = v; }, setDetector(on, level) { detOn = on; detLevel = level; },
    get camera() { return camera; }, get canvas() { return canvas; },
    dispose() { clearWorld(); clearRemotes(); window.removeEventListener('resize', resize); renderer.dispose(); },
    info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, piles: piles.length }; },
  };
  applyQuality();
  return api;
}
