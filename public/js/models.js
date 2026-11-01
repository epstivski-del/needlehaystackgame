// Procedural low-poly models: players, hats, enemies, pickups. No asset files; everything is boxes, spheres and lathes.
// Front of every model is local -Z (matches the game's yaw convention: forward = (-sin yaw, -cos yaw)).
const T = globalThis.__THREE;
import * as TX from '/js/tex.js';

const matCache = new Map();
export function mat(color, o = {}) {
  o = o || {};
  const k = color + '|' + JSON.stringify(o); let m = matCache.get(k);
  if (!m) { m = new T.MeshLambertMaterial({ color, ...o }); matCache.set(k, m); }
  return m;
}
export function basic(color, o = {}) {
  if (o.basic) { o = { ...o }; delete o.basic; }
  const k = 'b' + color + '|' + JSON.stringify(o); let m = matCache.get(k);
  if (!m) { m = new T.MeshBasicMaterial({ color, ...o }); matCache.set(k, m); }
  return m;
}
const G = { box: new T.BoxGeometry(1, 1, 1), sph: new T.SphereGeometry(0.5, 10, 8), cyl: new T.CylinderGeometry(0.5, 0.5, 1, 10), cone: new T.ConeGeometry(0.5, 1, 10), plane: new T.PlaneGeometry(1, 1) };
export function box(w, h, d, color, o, x = 0, y = 0, z = 0) { const m = new T.Mesh(G.box, o && o.basic ? basic(color, o) : mat(color, o)); m.scale.set(w, h, d); m.position.set(x, y, z); return m; }
export function sph(r, color, o, x = 0, y = 0, z = 0) { const m = new T.Mesh(G.sph, o && o.basic ? basic(color, o) : mat(color, o)); m.scale.setScalar(r * 2); m.position.set(x, y, z); return m; }
export function cyl(r, h, color, o, x = 0, y = 0, z = 0) { const m = new T.Mesh(G.cyl, mat(color, o)); m.scale.set(r * 2, h, r * 2); m.position.set(x, y, z); return m; }
export function cone(r, h, color, o, x = 0, y = 0, z = 0) { const m = new T.Mesh(G.cone, mat(color, o)); m.scale.set(r * 2, h, r * 2); m.position.set(x, y, z); return m; }
const rnd = (a, b) => a + Math.random() * (b - a);

export function glowSprite(color, size, opacity = 0.9) {
  const s = new T.Sprite(new T.SpriteMaterial({ map: TX.glow(), color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1); return s;
}
export function textSprite(text, opt = {}) {
  const s = new T.Sprite(new T.SpriteMaterial({ map: TX.label(text, { w: 256, h: 64, fg: opt.fg || '#fff', bg: opt.bg, font: opt.font || 'bold 34px system-ui, sans-serif' }), transparent: true, depthWrite: false, fog: false }));
  s.scale.set(opt.w || 1.8, (opt.w || 1.8) / 4, 1); return s;
}

// ---------------------------------------------------------------- hats (index matches HATS in sim.js)
export function makeHat(i) {
  const g = new T.Group();
  switch (i) {
    case 1: g.add(cyl(0.2, 0.1, 0xd63a3a, null, 0, 0.05, 0), box(0.28, 0.03, 0.22, 0xd63a3a, null, 0, 0.02, -0.2)); break;
    case 2: g.add(cone(0.18, 0.5, 0xff7a1a, null, 0, 0.25, 0), cyl(0.2, 0.04, 0xff7a1a, null, 0, 0.02, 0), cyl(0.12, 0.08, 0xf4f4f4, null, 0, 0.22, 0)); break;
    case 3: g.add(sph(0.2, 0x2d6a9a, null, 0, 0.04, 0), sph(0.06, 0xf2f2f2, null, 0, 0.22, 0)); break;
    case 4: { g.add(cyl(0.19, 0.16, 0xffd23a, { emissive: 0x5a4200 }, 0, 0.08, 0)); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.add(cone(0.05, 0.14, 0xffd23a, { emissive: 0x5a4200 }, Math.cos(a) * 0.15, 0.22, Math.sin(a) * 0.15)); } break; }
    case 5: g.add(box(0.46, 0.2, 0.26, 0xd6923c, null, 0, 0.12, 0), sph(0.13, 0xd6923c, null, 0, 0.22, 0)); break;
    case 6: g.add(sph(0.14, 0xffe03a, null, 0, 0.12, 0), sph(0.08, 0xffe03a, null, 0, 0.26, -0.04), box(0.1, 0.03, 0.08, 0xff8a1a, null, 0, 0.26, -0.13)); break;
    case 7: { const t = new T.Mesh(new T.TorusGeometry(0.17, 0.025, 6, 14), basic(0xfff0a0)); t.rotation.x = Math.PI / 2; t.position.y = 0.26; g.add(t); break; }
    default: break;
  }
  return g;
}

// ---------------------------------------------------------------- people
const SUITS = [0x7a1f2a, 0x1f3a7a, 0x2a6a3a, 0x6a3a7a, 0x7a5a1f, 0x1f6a6a, 0x7a2a5a, 0x4a4a52];
const SKIN = [0xf0c8a0, 0xd8a070, 0xa87048, 0x7a4a2c, 0xf4d6b8];
let flashGeo = null;
export function makePerson(id) {
  const g = new T.Group();
  const suit = SUITS[id % SUITS.length], skin = SKIN[(id * 7) % SKIN.length];
  const legL = box(0.18, 0.8, 0.2, 0x25262e, null, -0.12, 0.4, 0), legR = box(0.18, 0.8, 0.2, 0x25262e, null, 0.12, 0.4, 0);
  const pivL = new T.Group(), pivR = new T.Group(); pivL.position.set(-0.12, 0.8, 0); pivR.position.set(0.12, 0.8, 0);
  legL.position.set(0, -0.4, 0); legR.position.set(0, -0.4, 0); pivL.add(legL); pivR.add(legR);
  const torso = box(0.5, 0.7, 0.28, suit, null, 0, 1.15, 0);
  const armL = box(0.14, 0.62, 0.16, suit, null, -0.34, 1.12, 0), armR = box(0.14, 0.62, 0.16, suit, null, 0.34, 1.12, 0);
  const head = sph(0.17, skin, null, 0, 1.68, 0);
  const hair = box(0.3, 0.12, 0.3, 0x2a1d14, null, 0, 1.79, 0.02);
  const hatSlot = new T.Group(); hatSlot.position.set(0, 1.8, 0);
  if (!flashGeo) { flashGeo = new T.ConeGeometry(1.5, 7, 12, 1, true); flashGeo.translate(0, -3.5, 0); flashGeo.rotateX(Math.PI / 2); }
  const flash = new T.Mesh(flashGeo, new T.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.1, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  flash.position.set(0.25, 1.2, -0.2); flash.visible = false;
  g.add(pivL, pivR, torso, armL, armR, head, hair, hatSlot, flash);
  g.userData = { pivL, pivR, armL, armR, hatSlot, flash, torso, hat: -1, tag: null };
  return g;
}
export function setHat(model, i) {
  const u = model.userData; if (u.hat === i) return; u.hat = i;
  while (u.hatSlot.children.length) u.hatSlot.remove(u.hatSlot.children[0]);
  if (i > 0) u.hatSlot.add(makeHat(i));
}
export function poseDown(model, down) { model.userData.torso.parent.rotation.x = down ? -Math.PI / 2 : 0; }

// ---------------------------------------------------------------- enemies
function stalker() {
  const g = new T.Group(), dough = 0x9a5a2a, glaze = 0xff7fb0;
  const pivL = new T.Group(), pivR = new T.Group(); pivL.position.set(-0.22, 0.95, 0); pivR.position.set(0.22, 0.95, 0);
  pivL.add(box(0.3, 0.95, 0.3, dough, null, 0, -0.47, 0)); pivR.add(box(0.3, 0.95, 0.3, dough, null, 0, -0.47, 0));
  g.add(pivL, pivR, box(0.9, 1.0, 0.55, dough, null, 0, 1.45, 0), box(0.98, 0.34, 0.62, glaze, { emissive: 0x3a1020 }, 0, 1.82, 0));
  g.add(sph(0.34, dough, null, 0, 2.3, 0), sph(0.36, glaze, { emissive: 0x3a1020 }, 0, 2.42, 0.0).translateY(0.0));
  g.children[g.children.length - 1].scale.set(0.74, 0.42, 0.74);
  g.add(box(0.07, 0.07, 0.04, 0xffee66, { basic: true }, -0.12, 2.3, -0.32), box(0.07, 0.07, 0.04, 0xffee66, { basic: true }, 0.12, 2.3, -0.32));
  g.add(box(0.36, 0.07, 0.04, 0xffffff, { basic: true }, 0, 2.15, -0.33));
  for (let k = 0; k < 7; k++) g.add(box(0.05, 0.2 + Math.random() * 0.4, 0.05, glaze, null, -0.4 + k * 0.133, 1.55, -0.3));
  for (let k = 0; k < 26; k++) g.add(box(0.06, 0.02, 0.02, [0xffffff, 0x7cd4ff, 0xffe46b, 0x8affb0][k % 4], null, rnd(-0.42, 0.42), rnd(1.3, 1.95), -0.3));
  const arms = new T.Group(); arms.position.set(0, 1.8, 0);
  arms.add(box(0.2, 1.1, 0.2, dough, null, -0.58, -0.45, -0.1), box(0.2, 1.1, 0.2, dough, null, 0.58, -0.45, -0.1));
  g.add(arms);
  g.userData = { pivL, pivR, arms, kind: 'walker' }; return g;
}
function rush() {
  const g = new T.Group();
  const roll = new T.Group(); roll.position.y = 0.95;
  const ring = new T.Mesh(new T.TorusGeometry(0.75, 0.38, 8, 18), mat(0xc27a3a)); ring.rotation.y = Math.PI / 2;
  const gl = new T.Mesh(new T.TorusGeometry(0.75, 0.4, 8, 18), mat(0xff6fa8, { emissive: 0x401028 })); gl.rotation.y = Math.PI / 2; gl.scale.set(0.55, 1, 1);
  gl.position.x = 0.1; roll.add(ring, gl);
  for (let k = 0; k < 18; k++) { const a = rnd(0, 6.28); roll.add(box(0.02, 0.08, 0.02, [0xffffff, 0x7cd4ff, 0xffe46b][k % 3], null, 0.3, Math.cos(a) * 0.75, Math.sin(a) * 0.75)); }
  g.add(roll);
  g.add(box(0.9, 0.9, 0.06, 0x120608, null, 0, 0.95, -0.55));
  g.add(box(0.14, 0.1, 0.04, 0xff3040, { basic: true }, -0.2, 1.15, -0.59), box(0.14, 0.1, 0.04, 0xff3040, { basic: true }, 0.2, 1.15, -0.59));
  for (let k = 0; k < 6; k++) g.add(box(0.08, 0.14, 0.04, 0xffffff, { basic: true }, -0.25 + k * 0.1, 0.7, -0.59));
  g.userData = { roll, kind: 'roller' }; return g;
}
function handshake(decoy) {
  const g = new T.Group(), pale = decoy ? 0xb4c8b0 : 0xe6e2da, o = decoy ? { emissive: 0x0c2410 } : { emissive: 0x181816 };
  const pivL = new T.Group(), pivR = new T.Group(); pivL.position.set(-0.14, 1.0, 0); pivR.position.set(0.14, 1.0, 0);
  pivL.add(box(0.2, 1.0, 0.22, pale, o, 0, -0.5, 0)); pivR.add(box(0.2, 1.0, 0.22, pale, o, 0, -0.5, 0));
  g.add(pivL, pivR, box(0.56, 1.0, 0.3, pale, o, 0, 1.5, 0), box(0.14, 0.2, 0.14, pale, o, 0, 2.08, 0), sph(0.21, pale, o, 0, 2.28, 0));
  g.add(box(0.15, 1.0, 0.15, pale, o, -0.36, 1.35, 0));
  const arm = new T.Group(); arm.position.set(0.34, 1.8, -0.05);
  arm.add(box(0.14, 0.14, 1.5, pale, o, 0, 0, -0.75), box(0.26, 0.06, 0.32, pale, o, 0, 0, -1.62));
  for (let k = 0; k < 4; k++) arm.add(box(0.045, 0.045, 0.22, pale, o, -0.1 + k * 0.066, 0, -1.9));
  arm.add(box(0.05, 0.05, 0.2, pale, o, 0.16, 0.0, -1.78));
  g.add(arm);
  g.userData = { pivL, pivR, arm, kind: 'walker' }; return g;
}
function loaf() {
  const g = new T.Group(), crust = 0xc98a3c;
  const body = new T.Group();
  body.add(box(2.1, 1.1, 1.2, crust, null, 0, 1.0, 0));
  const top = new T.Mesh(G.cyl, mat(crust)); top.scale.set(1.2, 2.1, 1.2); top.rotation.z = Math.PI / 2; top.position.set(0, 1.55, 0); body.add(top);
  for (let k = 0; k < 4; k++) { const sc = box(0.1, 0.05, 0.8, 0x7a4a14, null, -0.7 + k * 0.47, 2.14, 0); sc.rotation.y = 0.6; body.add(sc); }
  body.add(box(2.14, 0.12, 1.24, 0xe6b46a, null, 0, 0.5, 0));
  body.add(sph(0.12, 0x5a3410, null, 0.4, 1.5, -0.62), sph(0.12, 0x5a3410, null, -0.4, 1.5, -0.62));
  g.add(body);
  const legs = [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].map(([x, z]) => { const l = box(0.4, 0.5, 0.4, 0x8a5a24, null, x, 0.25, z); g.add(l); return l; });
  g.userData = { body, legs, kind: 'loaf', baseMat: [] };
  g.traverse(o => { if (o.isMesh) g.userData.baseMat.push([o, o.material]); });
  return g;
}
let bibMat = null;
function wraith() {
  const g = new T.Group(), c = 0x233c46, o = { emissive: 0x06121a };
  const pivL = new T.Group(), pivR = new T.Group(); pivL.position.set(-0.13, 0.9, 0); pivR.position.set(0.13, 0.9, 0);
  pivL.add(box(0.2, 0.9, 0.2, c, o, 0, -0.45, 0)); pivR.add(box(0.2, 0.9, 0.2, c, o, 0, -0.45, 0));
  const torso = box(0.52, 0.8, 0.3, c, o, 0, 1.3, 0), head = sph(0.2, 0x7e9aa0, o, 0, 1.85, 0);
  const hair = new T.Group(); for (let k = 0; k < 9; k++) hair.add(box(0.03, 0.5 + Math.random() * 0.5, 0.03, 0x0c1418, null, -0.17 + k * 0.042, 1.7, 0.1));
  if (!bibMat) bibMat = new T.MeshBasicMaterial({ map: TX.label('LAST', { w: 128, h: 96, bg: '#ececec', fg: '#101418', font: 'bold 52px system-ui, sans-serif', border: '#c33' }) });
  const bib = new T.Mesh(G.plane, bibMat); bib.scale.set(0.42, 0.34, 1); bib.position.set(0, 1.35, -0.16); bib.rotation.y = Math.PI;
  g.add(pivL, pivR, torso, head, hair, bib, box(0.06, 0.06, 0.04, 0xbff8ff, { basic: true }, -0.07, 1.87, -0.19), box(0.06, 0.06, 0.04, 0xbff8ff, { basic: true }, 0.07, 1.87, -0.19));
  const armsG = new T.Group(); armsG.position.set(0, 1.55, 0); armsG.add(box(0.14, 0.14, 0.9, c, o, -0.38, 0, -0.45), box(0.14, 0.14, 0.9, c, o, 0.38, 0, -0.45));
  g.add(armsG);
  g.userData = { pivL, pivR, arms: armsG, kind: 'walker' }; return g;
}
function audience() {
  const g = new T.Group();
  g.add(box(0.5, 0.6, 0.3, 0x070709, null, 0, 0.75, 0), sph(0.21, 0x040405, null, 0, 1.25, 0));
  g.add(box(0.07, 0.07, 0.03, 0xffffff, { basic: true }, -0.08, 1.3, -0.2), box(0.07, 0.07, 0.03, 0xffffff, { basic: true }, 0.08, 1.3, -0.2));
  g.add(box(0.26, 0.05, 0.03, 0xffffff, { basic: true }, 0, 1.17, -0.2), box(0.2, 0.025, 0.03, 0x000000, { basic: true }, 0, 1.17, -0.215));
  const arms = new T.Group(); arms.position.set(0, 0.95, 0); arms.add(box(0.12, 0.6, 0.12, 0x070709, null, -0.32, 0.2, -0.1), box(0.12, 0.6, 0.12, 0x070709, null, 0.32, 0.2, -0.1));
  g.add(arms);
  g.userData = { arms, kind: 'seated' }; return g;
}
export function makeBell(scale = 1, phase = 1) {
  const g = new T.Group();
  const pts = [[0.05, 5.2], [0.55, 5.0], [0.9, 4.4], [1.15, 3.5], [1.45, 2.4], [1.9, 1.2], [2.3, 0.4], [2.4, 0.2], [2.1, 0.2], [1.8, 0.5]].map(([x, y]) => new T.Vector2(x, y));
  const bm = mat(0xb8862e, { emissive: 0x201000 });
  const bell = new T.Mesh(new T.LatheGeometry(pts, 14), bm); bell.material.side = T.DoubleSide; g.add(bell);
  g.add(box(0.35, 0.4, 0.35, 0x3a3a40, null, 0, 5.4, 0));
  const face = new T.Group(); face.position.set(0, 2.6, -1.62);
  face.add(box(0.36, 0.26, 0.08, 0xfff08a, { basic: true }, -0.55, 0.9, 0), box(0.36, 0.26, 0.08, 0xfff08a, { basic: true }, 0.55, 0.9, 0));
  face.add(box(1.7, 0.34, 0.08, 0x120608, { basic: true }, 0, 0.1, 0.03));
  for (let k = 0; k < 9; k++) face.add(box(0.14, 0.3, 0.06, 0xffffff, { basic: true }, -0.72 + k * 0.18, 0.1 + (k % 2 ? -0.02 : 0.02), -0.02));
  g.add(face);
  const clapper = sph(0.38, 0x57341a, null, 0, 0.45, 0); g.add(clapper);
  const orbit = new T.Group(); orbit.position.y = 2.4;
  for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, r = 2.9 + (k % 3) * 0.3; const slip = box(0.4, 0.02, 0.28, k % 2 ? 0xf4f0e0 : 0xff9ac0, { emissive: 0x201818 }, Math.cos(a) * r, (k % 4) * 0.5 - 0.6, Math.sin(a) * r); slip.rotation.set(Math.random(), Math.random(), 0); orbit.add(slip); }
  g.add(orbit);
  g.scale.setScalar(scale);
  g.userData = { bell, clapper, orbit, face, kind: 'bell', phase };
  return g;
}
const BUILD = { 1: stalker, 7: rush, 2: () => handshake(false), 8: () => handshake(true), 3: loaf, 4: wraith, 5: audience, 6: () => makeBell(0.72, 1) };
export function makeEnemy(kind) { const f = BUILD[kind]; return f ? f() : box(1, 2, 1, 0xff00ff); }

// Animate an enemy model. st = { state, aux, toasted, frozen, moving, t, dt, waterY, groundY, tag }
export function animEnemy(g, kind, st) {
  const u = g.userData, t = st.t, sp = st.moving ? 1 : 0;
  if (u.kind === 'walker') {
    const s = Math.sin(t * 7) * 0.6 * sp;
    u.pivL.rotation.x = s; u.pivR.rotation.x = -s;
    if (kind === 1) { u.arms.rotation.x = -1.2 * (st.state === 2 ? 1 : 0.2) + Math.sin(t * 7) * 0.1; }
    if (kind === 2 || kind === 8) { u.arm.rotation.x = st.frozen ? 0 : Math.sin(t * 20) * 0.04; g.rotation.z = st.frozen ? 0 : Math.sin(t * 17) * 0.03; }
    if (kind === 4) { u.arms.rotation.x = st.state === 2 ? -0.3 : 0.2; }
  } else if (u.kind === 'roller') {
    u.roll.rotation.x = -t * 9;
  } else if (u.kind === 'loaf') {
    const toasted = st.toasted;
    const wob = st.state === 5 ? Math.sin(t * 18) * 0.12 : Math.sin(t * 2.3) * 0.02;
    u.body.rotation.z = wob; u.body.position.y = Math.abs(Math.sin(t * 2.6)) * 0.08 * sp * (st.state === 2 ? 2 : 1);
    u.legs.forEach((l, i) => { l.position.y = 0.25 + Math.max(0, Math.sin(t * 5 + i * 1.6)) * 0.2 * sp; });
    if (g.userData.toasted !== toasted) { g.userData.toasted = toasted; g.userData.baseMat.forEach(([m, om]) => { m.material = toasted ? mat(om.color.getHex() === 0xe6b46a ? 0x6a3a12 : 0x4a2a0e) : om; }); }
    const eat = st.state === 4; g.scale.setScalar(1 + (eat ? Math.sin(t * 14) * 0.03 : 0));
  } else if (u.kind === 'seated') {
    u.arms.rotation.x = st.state === 1 ? -2.6 : Math.sin(t * 3 + g.id) * 0.1;
  } else if (u.kind === 'bell') {
    u.orbit.rotation.y = t * (st.state === 4 ? 2.2 : 0.9);
    u.clapper.position.x = Math.sin(t * (st.state === 3 ? 22 : 3)) * 0.25;
    u.bell.rotation.z = st.state === 5 ? Math.sin(t * 16) * 0.12 : st.state === 3 ? -0.2 : Math.sin(t * 1.8) * 0.03;
    u.bell.material.color.setHex(st.aux === 3 ? 0xe6c040 : st.aux === 2 ? 0xc0602a : 0xb8862e);
    u.face.visible = true;
  }
}

// ---------------------------------------------------------------- pickups
const PCOL = { crumb: 0xffd24a, key: 0x6ae8ff, toasterkey: 0xff9a3a, knife: 0xd0d6dc, jam: 0xff4060, butter: 0xffe86a, trophy: 0xffd24a, board: 0x3ab6ff, battery: 0x6aff8a, snack: 0xff8ac0, coin: 0xffd23a, can: 0xb8c0c8, duck: 0xffe03a, stress: 0x9aff5a, log: 0x6ab0ff, s67: 0x9aff7a, seal: 0xfff2a0, bike: 0xffd23a };
export function makePickup(type) {
  const g = new T.Group(), inner = new T.Group(); g.add(inner);
  const c = PCOL[type] || 0xffffff; let glowSize = 1.2, y = 0.75, spin = 1.2;
  switch (type) {
    case 'crumb': { const t = new T.Mesh(new T.TorusGeometry(0.26, 0.1, 6, 12, Math.PI * 1.25), mat(0xe8a830, { emissive: 0x6a3a00 })); inner.add(t, new T.Mesh(new T.TorusGeometry(0.28, 0.06, 6, 12, Math.PI * 1.25), mat(0xff8ac0, { emissive: 0x401030 })).translateY(0.05)); glowSize = 1.5; break; }
    case 'key': case 'toasterkey': { const s = type === 'toasterkey' ? 1.5 : 1; inner.add(box(0.07 * s, 0.07 * s, 0.4 * s, c, { emissive: 0x104050 }, 0, 0, 0.0), box(0.2 * s, 0.2 * s, 0.05 * s, c, { emissive: 0x104050 }, 0, 0, -0.22 * s), box(0.12 * s, 0.1 * s, 0.05 * s, c, null, 0, -0.08 * s, 0.14 * s)); glowSize = 1.4; break; }
    case 'knife': inner.add(box(0.05, 0.03, 0.5, 0xd0d6dc, { emissive: 0x303438 }, 0, 0, -0.1), box(0.06, 0.05, 0.22, 0x5a3418, null, 0, 0, 0.26)); break;
    case 'jam': inner.add(cyl(0.14, 0.26, 0xff2a4a, { emissive: 0x500010 }), cyl(0.15, 0.06, 0xf4f4f4, null, 0, 0.16, 0)); break;
    case 'butter': inner.add(box(0.34, 0.14, 0.2, 0xffe27a, { emissive: 0x504010 })); break;
    case 'trophy': { inner.add(cone(0.2, 0.34, 0xffd24a, { emissive: 0x6a4a00 }, 0, 0.1, 0), sph(0.08, 0xffd24a, { emissive: 0x6a4a00 }, 0.2, 0.0, 0.06)); inner.rotation.z = 0.4; glowSize = 2.2; break; }
    case 'board': { const b = box(0.5, 0.07, 1.1, 0x2aa0ff, { emissive: 0x08304a }); inner.add(b, box(0.12, 0.08, 1.12, 0xff8a1a), cyl(0.0, 0, 0xffffff)); inner.rotation.x = -0.4; y = 0.9; glowSize = 1.8; break; }
    case 'battery': inner.add(cyl(0.1, 0.3, 0x2ae05a, { emissive: 0x083a14 }), cyl(0.05, 0.06, 0xc8ccd0, null, 0, 0.18, 0)); break;
    case 'snack': inner.add(box(0.28, 0.4, 0.08, 0xff5a9a, { emissive: 0x401028 }), box(0.18, 0.12, 0.09, 0xffe03a, null, 0, 0.0, 0)); break;
    case 'coin': inner.add(cyl(0.2, 0.05, 0xffd23a, { emissive: 0x6a4a00 })); inner.rotation.x = Math.PI / 2; spin = 3; break;
    case 'can': inner.add(cyl(0.1, 0.22, 0xb8c0c8, { emissive: 0x202428 })); break;
    case 'duck': inner.add(sph(0.14, 0xffe03a, { emissive: 0x504000 }), sph(0.08, 0xffe03a, { emissive: 0x504000 }, 0, 0.14, -0.06), box(0.08, 0.03, 0.06, 0xff8a1a, null, 0, 0.14, -0.14)); break;
    case 'stress': inner.add(sph(0.13, 0x9aff5a, { emissive: 0x204010 })); break;
    case 'log': inner.add(box(0.32, 0.05, 0.42, 0x1a2230, { emissive: 0x081020 }), box(0.22, 0.01, 0.18, 0x6ab0ff, { basic: true }, 0, 0.03, -0.04), box(0.22, 0.01, 0.06, 0xff5a5a, { basic: true }, 0, 0.03, 0.14)); inner.rotation.x = -0.5; glowSize = 1.6; break;
    case 's67': { const m = new T.Mesh(G.plane, new T.MeshBasicMaterial({ map: TX.label('67', { w: 128, h: 128, bg: '#141c14', fg: '#9aff7a', border: '#9aff7a', font: 'bold 76px monospace' }), side: T.DoubleSide })); m.scale.set(0.5, 0.5, 1); inner.add(m); glowSize = 0.9; y = 1.1; spin = 0.5; break; }
    case 'seal': {
      inner.add(sph(0.32, 0xfff2a0, { basic: true }), new T.Mesh(new T.TorusGeometry(0.5, 0.04, 6, 24), basic(0xff9a3a)));
      const r2 = new T.Mesh(new T.TorusGeometry(0.5, 0.04, 6, 24), basic(0xff5a5a)); r2.rotation.x = Math.PI / 2; inner.add(r2);
      glowSize = 3.4; y = 1.1; spin = 1.6; break;
    }
    case 'bike': {
      const wheel = (z) => { const w = new T.Mesh(new T.TorusGeometry(0.42, 0.05, 6, 18), mat(0x202020)); w.rotation.y = Math.PI / 2; w.position.set(0, 0.0, z); return w; };
      inner.add(wheel(-0.6), wheel(0.6), box(0.06, 0.06, 1.2, 0xffd23a, { emissive: 0x6a4a00 }, 0, 0.3, 0), box(0.06, 0.5, 0.06, 0xffd23a, null, 0, 0.5, -0.35), box(0.5, 0.05, 0.05, 0xc0c0c0, null, 0, 0.78, -0.4), box(0.14, 0.05, 0.3, 0x202020, null, 0, 0.62, 0.35));
      const lbl = new T.Mesh(G.plane, new T.MeshBasicMaterial({ map: TX.label('67/10', { w: 256, h: 96, bg: '#111', fg: '#ffd23a', font: 'bold 60px system-ui' }), side: T.DoubleSide })); lbl.scale.set(0.9, 0.34, 1); lbl.position.set(0, 1.3, 0); inner.add(lbl);
      inner.scale.setScalar(1.6); glowSize = 4; y = 1.0; spin = 0.8; break;
    }
    default: inner.add(box(0.2, 0.2, 0.2, c));
  }
  const gl = glowSprite(c, glowSize, type === 's67' ? 0.35 : 0.8); gl.position.y = 0; g.add(gl);
  g.userData = { inner, y, spin, type, glow: gl, phase: Math.random() * 6.28 };
  return g;
}
export function animPickup(g, t) {
  const u = g.userData; u.inner.rotation.y = t * u.spin + u.phase; g.position.y = (g.userData.baseY ?? 0) + u.y + Math.sin(t * 1.6 + u.phase) * 0.08;
  u.glow.material.opacity = (u.type === 's67' ? 0.25 : 0.55) + Math.sin(t * 3 + u.phase) * 0.2;
}

// First-person scooter handlebars (attached to the camera while riding).
export function makeScooterFP() {
  const g = new T.Group();
  g.add(box(0.7, 0.05, 0.05, 0x1a1c22, null, 0, -0.34, -0.55), box(0.05, 0.4, 0.05, 0x1a1c22, null, -0.3, -0.5, -0.5), box(0.05, 0.4, 0.05, 0x1a1c22, null, 0.3, -0.5, -0.5), box(0.1, 0.1, 0.1, 0xd04a1a, null, -0.36, -0.32, -0.55), box(0.1, 0.1, 0.1, 0xd04a1a, null, 0.36, -0.32, -0.55));
  g.add(box(0.5, 0.04, 1.4, 0x2a2e36, null, 0, -0.92, -1.0));
  g.visible = false; return g;
}
