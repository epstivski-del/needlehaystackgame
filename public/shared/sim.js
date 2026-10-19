// FLOCK RUSH: authoritative sheep simulation (pure, deterministic, no I/O).
// Runs on the server for online rooms and in the browser for offline Practice Mode.
import { mulberry32, TAU, forward, resolveCollision, penAt, mudAt, SHEEP_RADIUS } from './field.js';

export const TUNING = {
  step: 0.05,
  fleeR: 8.5, fleeSpeed: 5.3, panicMul: 1.3, accel: 5.5, maxImpulseSpeed: 11,
  barkRange: 14, barkHalfAngle: 0.95, barkImpulse: 8.5, barkCooldown: 1.4, barkPanic: 2.0,
  howlRange: 15, howlImpulse: 7, howlCooldown: 14, howlPanic: 3.0,
  dashDuration: 0.4, dashCooldown: 3.5, dashSpeed: 16, dashHitRadius: 1.8, dashImpulse: 9,
  penCalm: 0.55, dogWalk: 6.5, dogSprint: 9.5, mudSlow: 0.55,
  creditWindow: 6,
};
export const SHEEP_TYPES = {
  w: { name: 'Sheep',        value: 1, speed: 1,    skit: 1 },
  b: { name: 'Black sheep',  value: 2, speed: 1.22, skit: 1.3 },
  g: { name: 'Golden sheep', value: 5, speed: 1.12, skit: 1.2 },
};
// How jumpy the flock is. "nerves" scales how far away a dog frightens them; "speed" scales how fast they run.
export const DIFFICULTY = { easy: { nerves: 0.85, speed: 0.9 }, normal: { nerves: 1, speed: 1 }, hard: { nerves: 1.15, speed: 1.1 } };

export class FlockSim {
  constructor(field, { seed = 1, difficulty = 'normal' } = {}) {
    this.field = field; this.time = 0;
    this.rng = mulberry32((seed >>> 0) ^ 0xa5a5a5a5);
    const d = DIFFICULTY[difficulty] || DIFFICULTY.normal; this.nerves = d.nerves; this.speedMul = d.speed;
    this.sheep = field.sheep.map((s, id) => {
      const spec = SHEEP_TYPES[s.type] || SHEEP_TYPES.w;
      return { id, type: s.type, value: spec.value, spd: spec.speed, skit: spec.skit, x: s.x, z: s.z, vx: 0, vz: 0, yaw: this.rng() * TAU,
        panicUntil: 0, wanderT: this.rng() * 2, wx: 0, wz: 0, pen: -1, lastPush: -1, lastPushT: -99 };
    });
    this.events = [];
  }

  totalValue() { let v = 0; for (const s of this.sheep) v += s.value; return v; }
  penValue(slot) { let v = 0; for (const s of this.sheep) if (s.pen === slot) v += s.value; return v; }
  penCount(slot) { let c = 0; for (const s of this.sheep) if (s.pen === slot) c++; return c; }
  creditFor(s) { return this.time - s.lastPushT <= TUNING.creditWindow ? s.lastPush : -1; }

  // dogs: [{ id, x, z, sprinting, dashing }]. Returns pen entry/exit events from this step.
  step(dt, dogs) {
    const T = TUNING, F = this.field, S = this.sheep, n = S.length, now = (this.time += dt), ev = [];
    for (let i = 0; i < n; i++) {
      const s = S[i];
      let fx = 0, fz = 0, fear = 0, pusher = -1;
      for (const dg of dogs) {
        const dx = s.x - dg.x, dz = s.z - dg.z, d2 = dx * dx + dz * dz;
        const R = T.fleeR * s.skit * this.nerves * (s.pen >= 0 ? T.penCalm : 1) * (dg.dashing ? 1.35 : dg.sprinting ? 1.2 : 1);
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 0.001, k = Math.pow(1 - d / R, 1.2);
        fx += (dx / d) * k; fz += (dz / d) * k;
        if (k > fear) { fear = k; pusher = dg.id; }
      }
      const panic = now < s.panicUntil;
      let cx = 0, cz = 0, cn = 0, avx = 0, avz = 0, sx = 0, sz = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = S[j], dx = o.x - s.x, dz = o.z - s.z, d2 = dx * dx + dz * dz;
        if (d2 > 49) continue;
        cn++; cx += o.x; cz += o.z; avx += o.vx; avz += o.vz;
        if (d2 < 0.81) { const d = Math.sqrt(d2) || 0.001; sx -= (dx / d) * (0.9 - d); sz -= (dz / d) * (0.9 - d); }
      }
      const maxV = T.fleeSpeed * s.spd * this.speedMul * (panic ? T.panicMul : 1);
      let dvx = 0, dvz = 0;
      if (fear > 0) {
        const m = Math.hypot(fx, fz) || 1, f = Math.min(1, fear * 1.3 + (panic ? 0.5 : 0));
        dvx = (fx / m) * maxV * f; dvz = (fz / m) * maxV * f;
      } else if (panic) { dvx = s.vx * 0.92; dvz = s.vz * 0.92; }
      if (cn) { // flocks hold together, and a running flock drags its neighbours along
        const k = fear > 0.25 ? 0.15 : 0.5;
        dvx += ((cx / cn - s.x) * 0.12 + (avx / cn) * 0.25) * k; dvz += ((cz / cn - s.z) * 0.12 + (avz / cn) * 0.25) * k;
      }
      dvx += sx * 3; dvz += sz * 3;
      s.wanderT -= dt;
      if (s.wanderT <= 0) { s.wanderT = 1.2 + this.rng() * 2.5; const a = this.rng() * TAU, m = this.rng() < 0.45 ? 0 : 0.5 + this.rng() * 1.1; s.wx = Math.cos(a) * m; s.wz = Math.sin(a) * m; }
      const inPen = s.pen >= 0;
      if (fear === 0 && !panic) {
        dvx += s.wx * (inPen ? 0.35 : 1); dvz += s.wz * (inPen ? 0.35 : 1);
        if (inPen) { const p = F.pens[s.pen]; dvx += clampMag((p.cx - s.x) * 0.25, 1); dvz += clampMag((p.cz - s.z) * 0.25, 1); } // settled sheep stay put
      }
      const dm = Math.hypot(dvx, dvz); if (dm > maxV) { dvx *= maxV / dm; dvz *= maxV / dm; }
      const a = Math.min(1, T.accel * dt);
      s.vx += (dvx - s.vx) * a; s.vz += (dvz - s.vz) * a;
      if (fear > 0.12 && pusher >= 0) { s.lastPush = pusher; s.lastPushT = now; }
    }
    for (const s of S) { // integrate after every sheep has decided, so update order cannot bias anyone
      const slow = mudAt(F, s.x, s.z) ? T.mudSlow : 1;
      const nx = s.x + s.vx * slow * dt, nz = s.z + s.vz * slow * dt;
      const r = resolveCollision(F, nx, nz, SHEEP_RADIUS);
      s.vx = (r.x - s.x) / dt / slow; s.vz = (r.z - s.z) / dt / slow;
      s.x = r.x; s.z = r.z;
      if (Math.hypot(s.vx, s.vz) > 0.35) { const ty = Math.atan2(-s.vx, -s.vz); s.yaw += angDiff(ty, s.yaw) * Math.min(1, 8 * dt); }
      const pen = penAt(F, s.x, s.z), slot = pen ? pen.slot : -1;
      if (slot !== s.pen) { ev.push({ sheep: s.id, from: s.pen, to: slot, by: this.creditFor(s) }); s.pen = slot; }
    }
    return ev;
  }

  _cap(s) { const m = Math.hypot(s.vx, s.vz); if (m > TUNING.maxImpulseSpeed) { s.vx *= TUNING.maxImpulseSpeed / m; s.vz *= TUNING.maxImpulseSpeed / m; } }
  _push(s, dx, dz, d, mag, panic, by) {
    s.vx += (dx / d) * mag; s.vz += (dz / d) * mag; this._cap(s);
    s.panicUntil = Math.max(s.panicUntil, this.time + panic); s.lastPush = by; s.lastPushT = this.time;
  }

  // A bark startles everything in a forward cone (and a small bubble all round).
  bark(dog) {
    const [fx, fz] = forward(dog.yaw), T = TUNING, cosHalf = Math.cos(T.barkHalfAngle); let hit = 0;
    for (const s of this.sheep) {
      const dx = s.x - dog.x, dz = s.z - dog.z, d = Math.hypot(dx, dz);
      if (d < 0.01 || d > T.barkRange) continue;
      if ((dx * fx + dz * fz) / d < cosHalf) { if (d < 3) { this._push(s, dx, dz, d, T.barkImpulse * 0.4, 0.8, dog.id); hit++; } continue; }
      this._push(s, dx, dz, d, T.barkImpulse * (1 - 0.55 * d / T.barkRange), T.barkPanic, dog.id); hit++;
    }
    return hit;
  }
  inBarkCone(dog, x, z) {
    const [fx, fz] = forward(dog.yaw), dx = x - dog.x, dz = z - dog.z, d = Math.hypot(dx, dz);
    return d > 0.01 && d <= TUNING.barkRange && (dx * fx + dz * fz) / d >= Math.cos(TUNING.barkHalfAngle);
  }
  howl(dog) {
    const T = TUNING; let hit = 0;
    for (const s of this.sheep) {
      const dx = s.x - dog.x, dz = s.z - dog.z, d = Math.hypot(dx, dz);
      if (d < 0.01 || d > T.howlRange) continue;
      this._push(s, dx, dz, d, T.howlImpulse * (1 - 0.4 * d / T.howlRange), T.howlPanic, dog.id); hit++;
    }
    return hit;
  }
  // Barging through the flock: sheep close to a dashing dog are thrown along its path.
  dashHit(dog, dirx, dirz) {
    const T = TUNING; let hit = 0;
    for (const s of this.sheep) {
      const dx = s.x - dog.x, dz = s.z - dog.z, d = Math.hypot(dx, dz);
      if (d > T.dashHitRadius) continue;
      const m = Math.hypot(dirx, dirz) || 1;
      s.vx += (dirx / m) * T.dashImpulse + (d > 0.01 ? (dx / d) * 2 : 0); s.vz += (dirz / m) * T.dashImpulse + (d > 0.01 ? (dz / d) * 2 : 0);
      this._cap(s); s.panicUntil = Math.max(s.panicUntil, this.time + 1.5); s.lastPush = dog.id; s.lastPushT = this.time; hit++;
    }
    return hit;
  }
  // Thunder: every loose sheep bolts in a random direction. Settled sheep in a pen are only half spooked.
  thunder() {
    for (const s of this.sheep) {
      const a = this.rng() * TAU, mag = (7 + this.rng() * 3) * (s.pen >= 0 ? 0.35 : 1);
      s.vx += Math.cos(a) * mag; s.vz += Math.sin(a) * mag; this._cap(s);
      s.panicUntil = Math.max(s.panicUntil, this.time + 2.5);
    }
  }

  // Compact wire format: [x*10, z*10, yaw*20, flags] per sheep (flags: 1 moving, 2 panicking, 4 in a pen).
  encode() {
    const out = new Array(this.sheep.length * 4); let k = 0;
    for (const s of this.sheep) {
      out[k++] = Math.round(s.x * 10); out[k++] = Math.round(s.z * 10); out[k++] = Math.round(s.yaw * 20);
      out[k++] = (Math.hypot(s.vx, s.vz) > 0.4 ? 1 : 0) | (this.time < s.panicUntil ? 2 : 0) | (s.pen >= 0 ? 4 : 0);
    }
    return out;
  }
}
export function decodeSheep(arr, i) { return { x: arr[i * 4] / 10, z: arr[i * 4 + 1] / 10, yaw: arr[i * 4 + 2] / 20, flags: arr[i * 4 + 3] }; }

function clampMag(v, m) { return v > m ? m : v < -m ? -m : v; }
function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
