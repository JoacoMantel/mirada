// De la malla de la cara a un punto de la pantalla. Sin dependencias del navegador.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const STD_FLOOR = [0.01, 0.01, 0.02, 0.01, 0.01, 0.02, 0.01, 0.01, 0.005, 0.01, 0.002, 0.005, 0.02, 0.02];
// Cada eje usa solo sus rasgos: así el ruido vertical de los ojos no desvía el eje horizontal, ni al revés.
const X_FEATURES = [0, 3, 5, 6, 12];
const Y_FEATURES = [1, 2, 4, 5, 7, 9, 10, 11, 13];

export function extractFeatures(lm, width, height) {
  const p = (i) => [lm[i].x * width, lm[i].y * height];
  const eye = (a, b, top, bottom, iris) => {
    const A = p(a), B = p(b), I = p(iris);
    const w = dist(A, B) || 1;
    const u = [(B[0] - A[0]) / w, (B[1] - A[1]) / w];
    const v = [-u[1], u[0]];
    const d = [I[0] - (A[0] + B[0]) / 2, I[1] - (A[1] + B[1]) / 2];
    const T = p(top);
    const iy = (d[0] * v[0] + d[1] * v[1]) / w;
    const topY = ((T[0] - (A[0] + B[0]) / 2) * v[0] + (T[1] - (A[1] + B[1]) / 2) * v[1]) / w;
    return {
      ix: (d[0] * u[0] + d[1] * u[1]) / w,
      iy,
      upper: iy - topY, // Distancia del iris al párpado superior: baja cuando la mirada baja.
      open: dist(T, p(bottom)) / w,
    };
  };
  const l = eye(33, 133, 159, 145, 468);
  const r = eye(362, 263, 386, 374, 473);

  const eyeA = p(33), eyeB = p(263);
  const axis = Math.hypot(eyeB[0] - eyeA[0], eyeB[1] - eyeA[1]) || 1;
  const u = [(eyeB[0] - eyeA[0]) / axis, (eyeB[1] - eyeA[1]) / axis];
  const v = [-u[1], u[0]];
  const nose = p(1), cheekA = p(234), cheekB = p(454), top = p(10), chin = p(152);
  const midH = [(cheekA[0] + cheekB[0]) / 2, (cheekA[1] + cheekB[1]) / 2];
  const midV = [(top[0] + chin[0]) / 2, (top[1] + chin[1]) / 2];
  const yaw = ((nose[0] - midH[0]) * u[0] + (nose[1] - midH[1]) * u[1]) / (dist(cheekA, cheekB) || 1);
  const pitch = ((nose[0] - midV[0]) * v[0] + (nose[1] - midV[1]) * v[1]) / (dist(top, chin) || 1);
  const roll = Math.atan2(u[1], u[0]);
  const size = Math.max(width, height);

  const iy = (l.iy + r.iy) / 2;
  const open = (l.open + r.open) / 2;
  return {
    f: [
      (l.ix + r.ix) / 2, iy, open,
      yaw, pitch, roll,
      (eyeA[0] + eyeB[0]) / 2 / width, (eyeA[1] + eyeB[1]) / 2 / height,
      axis / size,
      (l.upper + r.upper) / 2, iy * iy, open * open,
      (l.ix + r.ix) / 2 * 0.2 / (axis / size), iy * 0.2 / (axis / size),
    ],
    open,
    faceWidth: axis / width,
  };
}

function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-9));
}

// Regresión lineal regularizada de rasgos a (x, y) en fracciones de pantalla.
export class GazeModel {
  constructor({ lambda = 0.02, maxOnline = 30, onlineWeight = 6, xFeatures = X_FEATURES, yFeatures = Y_FEATURES } = {}) {
    this.lambda = lambda;
    this.xFeatures = xFeatures;
    this.yFeatures = yFeatures;
    this.maxOnline = maxOnline;
    this.onlineWeight = onlineWeight;
    this.reset();
  }

  reset() {
    this.base = [];
    this.online = [];
    this.nextId = 1;
    this.offset = { x: 0, y: 0 };
    this.fitted = false;
  }

  addCalibration(f, x, y) { this.base.push({ f, x, y, w: 1 }); }

  // Corrige la desviación sin recalibrar: se mira un punto conocido y se ajusta la diferencia.
  recenter(f, x, y) {
    const p = this.predict(f);
    this.offset = { x: this.offset.x + x - p.x, y: this.offset.y + y - p.y };
  }

  addOnline(f, x, y) {
    const id = this.nextId++;
    this.online.push({ id, f, x, y, w: this.onlineWeight });
    if (this.online.length > this.maxOnline) this.online.shift();
    this.fit();
    return id;
  }

  removeOnline(id) {
    const before = this.online.length;
    this.online = this.online.filter((s) => s.id !== id);
    if (this.online.length !== before) this.fit();
  }

  fit() {
    const samples = [...this.base, ...this.online];
    if (samples.length < 12) return false;
    const n = samples[0].f.length;
    let W = 0;
    this.mean = new Array(n).fill(0);
    this.std = new Array(n).fill(0);
    for (const s of samples) { W += s.w; s.f.forEach((v, i) => { this.mean[i] += v * s.w; }); }
    this.mean = this.mean.map((v) => v / W);
    for (const s of samples) s.f.forEach((v, i) => { this.std[i] += s.w * (v - this.mean[i]) ** 2; });
    this.std = this.std.map((v, i) => Math.max(Math.sqrt(v / W), STD_FLOOR[i] ?? 0.01));

    this.bx = this.solveAxis(samples, this.xFeatures, 'x');
    this.by = this.solveAxis(samples, this.yFeatures, 'y');
    this.fitted = true;
    return true;
  }

  solveAxis(samples, features, target) {
    const d = features.length + 1;
    const A = Array.from({ length: d }, () => new Array(d).fill(0));
    const b = new Array(d).fill(0);
    let W = 0;
    for (const s of samples) {
      W += s.w;
      const z = this.design(s.f, features);
      for (let i = 0; i < d; i++) {
        b[i] += s.w * z[i] * s[target];
        for (let j = 0; j < d; j++) A[i][j] += s.w * z[i] * z[j];
      }
    }
    for (let i = 1; i < d; i++) A[i][i] += this.lambda * W;
    return solve(A, b);
  }

  design(f, features) { return [1, ...features.map((i) => (f[i] - this.mean[i]) / this.std[i])]; }

  predict(f) {
    if (!this.fitted) return null;
    const dot = (z, b) => z.reduce((a, v, i) => a + v * b[i], 0);
    return {
      x: dot(this.design(f, this.xFeatures), this.bx) + this.offset.x,
      y: dot(this.design(f, this.yFeatures), this.by) + this.offset.y,
    };
  }
}

// Filtro One Euro: suaviza cuando la mirada está quieta y responde rápido cuando salta.
export class OneEuro {
  constructor(minCutoff = 0.9, beta = 1.2, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 });
  }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(value, t) {
    if (this.x === null) { this.x = value; this.t = t; return value; }
    const dt = Math.max((t - this.t) / 1000, 0.001);
    this.t = t;
    const dx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

// Zona bajo la mirada. La actual tiene ventaja para que el temblor no la haga saltar.
export function classify(point, zones, current = null, restBelowY = 0, hysteresis = 0.85) {
  if (!point) return null;
  if (point.y < restBelowY || point.x < -0.3 || point.x > 1.3 || point.y > 1.3) return null;
  let best = null, bestD = Infinity, currentD = Infinity;
  zones.forEach((z, i) => {
    const d = Math.hypot((point.x - z.x) / z.w, (point.y - z.y) / z.h);
    if (d < bestD) { bestD = d; best = i; }
    if (i === current) currentD = d;
  });
  if (current !== null && best !== current && bestD > currentD * hysteresis) return current;
  return best;
}

// Tiempo de mirada: cada zona acumula tiempo mientras se la mira y lo pierde de a poco al dejar de mirarla.
// Así un temblor entre zonas vecinas demora la selección, pero no la reinicia.
export class Dwell {
  constructor({ dwellMs = 900, decay = 0.7, refractoryMs = 650 } = {}) {
    Object.assign(this, { dwellMs, decay, refractoryMs });
    this.reset();
  }
  reset() { this.charge = new Map(); this.lastT = null; this.blockedUntil = 0; }
  update(zone, t) {
    const dt = this.lastT === null ? 0 : Math.min(t - this.lastT, 150);
    this.lastT = t;
    if (t < this.blockedUntil) return { zone: null, progress: 0, selected: null };
    for (const [z, c] of this.charge) {
      if (z !== zone) {
        const next = c - dt * this.decay;
        if (next > 0) this.charge.set(z, next); else this.charge.delete(z);
      }
    }
    if (zone !== null) this.charge.set(zone, (this.charge.get(zone) || 0) + dt);
    let best = null, top = 0;
    for (const [z, c] of this.charge) if (c > top) { top = c; best = z; }
    if (best !== null && top >= this.dwellMs) {
      this.charge.clear();
      this.blockedUntil = t + this.refractoryMs;
      return { zone: null, progress: 0, selected: best };
    }
    return { zone: best, progress: best === null ? 0 : top / this.dwellMs, selected: null };
  }
}

// Guía para volver a poner el celular donde estaba al calibrar.
// Compara la posición, el tamaño y el ángulo de la cara en la imagen con los de la calibración.
const GUIDE = {
  dist: { i: 8, min: 0.1 },  // Tamaño de la cara (relativo): más grande = más cerca.
  x: { i: 6, min: 0.045 },
  y: { i: 7, min: 0.045 },
  roll: { i: 5, min: 0.12 },
  yaw: { i: 3, min: 0.07 },
  pitch: { i: 4, min: 0.07 },
};
const MESSAGES = {
  closer: { icon: '－', text: 'Alejá el celular' },
  farther: { icon: '＋', text: 'Acercá el celular' },
  left: { icon: '←', text: 'Mové el celular a la izquierda' },
  right: { icon: '→', text: 'Mové el celular a la derecha' },
  up: { icon: '↑', text: 'Subí el celular' },
  down: { icon: '↓', text: 'Bajá el celular' },
  roll: { icon: '⟲', text: 'Enderezá el celular' },
  angle: { icon: '◎', text: 'Poné el celular de frente a la cara' },
};

export class PoseGuide {
  constructor() { this.ref = null; this.showing = false; }

  setReference(list) {
    if (!list.length) { this.ref = null; return; }
    this.ref = {};
    for (const [k, { i, min }] of Object.entries(GUIDE)) {
      const vals = list.map((f) => (k === 'dist' ? Math.log(f[i]) : f[i]));
      const m = vals.reduce((a, v) => a + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length);
      // Se tolera todo el rango que se recorrió al calibrar: el modelo ya lo conoce.
      this.ref[k] = { m, tol: Math.max(min, 2 * sd), raw: k === 'dist' ? Math.exp(m) : m };
    }
    this.showing = false;
  }

  // level: 0 = igual que al calibrar; 1 = en el borde de lo que se calibró.
  check(f) {
    if (!this.ref) return null;
    const d = (k) => ((k === 'dist' ? Math.log(f[GUIDE[k].i]) : f[GUIDE[k].i]) - this.ref[k].m) / this.ref[k].tol;
    const dev = {
      dist: d('dist'),
      x: -d('x'), // En la vista de selfie la imagen está espejada.
      y: d('y'),
      roll: d('roll'),
      angle: Math.max(Math.abs(d('yaw')), Math.abs(d('pitch'))),
    };
    let key = 'dist', level = 0;
    for (const [k, v] of Object.entries(dev)) if (Math.abs(v) > level) { level = Math.abs(v); key = k; }
    let msg;
    if (key === 'dist') msg = dev.dist > 0 ? MESSAGES.closer : MESSAGES.farther;
    else if (key === 'x') msg = dev.x > 0 ? MESSAGES.right : MESSAGES.left;
    else if (key === 'y') msg = dev.y > 0 ? MESSAGES.down : MESSAGES.up;
    else msg = MESSAGES[key];
    this.showing = level > (this.showing ? 0.75 : 1);
    return { level, show: this.showing, ...msg };
  }
}
