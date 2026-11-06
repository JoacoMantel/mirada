// De la malla de la cara a un punto de la pantalla. Sin dependencias del navegador.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const STD_FLOOR = [0.01, 0.01, 0.02, 0.01, 0.01, 0.02, 0.01, 0.01, 0.005];

export function extractFeatures(lm, width, height) {
  const p = (i) => [lm[i].x * width, lm[i].y * height];
  const eye = (a, b, top, bottom, iris) => {
    const A = p(a), B = p(b), I = p(iris);
    const w = dist(A, B) || 1;
    const u = [(B[0] - A[0]) / w, (B[1] - A[1]) / w];
    const v = [-u[1], u[0]];
    const d = [I[0] - (A[0] + B[0]) / 2, I[1] - (A[1] + B[1]) / 2];
    return {
      ix: (d[0] * u[0] + d[1] * u[1]) / w,
      iy: (d[0] * v[0] + d[1] * v[1]) / w,
      open: dist(p(top), p(bottom)) / w,
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

  return {
    f: [
      (l.ix + r.ix) / 2, (l.iy + r.iy) / 2, (l.open + r.open) / 2,
      yaw, pitch, roll,
      (eyeA[0] + eyeB[0]) / 2 / width, (eyeA[1] + eyeB[1]) / 2 / height,
      axis / size,
    ],
    open: (l.open + r.open) / 2,
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
  constructor({ lambda = 0.02, maxOnline = 30, onlineWeight = 6 } = {}) {
    this.lambda = lambda;
    this.maxOnline = maxOnline;
    this.onlineWeight = onlineWeight;
    this.reset();
  }

  reset() {
    this.base = [];
    this.online = [];
    this.nextId = 1;
    this.fitted = false;
  }

  addCalibration(f, x, y) { this.base.push({ f, x, y, w: 1 }); }

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

    const d = n + 1;
    const XtX = Array.from({ length: d }, () => new Array(d).fill(0));
    const Xtx = new Array(d).fill(0);
    const Xty = new Array(d).fill(0);
    for (const s of samples) {
      const z = this.design(s.f);
      for (let i = 0; i < d; i++) {
        Xtx[i] += s.w * z[i] * s.x;
        Xty[i] += s.w * z[i] * s.y;
        for (let j = 0; j < d; j++) XtX[i][j] += s.w * z[i] * z[j];
      }
    }
    for (let i = 1; i < d; i++) XtX[i][i] += this.lambda * W;
    this.bx = solve(XtX, Xtx);
    this.by = solve(XtX, Xty);
    this.fitted = true;
    return true;
  }

  design(f) { return [1, ...f.map((v, i) => (v - this.mean[i]) / this.std[i])]; }

  predict(f) {
    if (!this.fitted) return null;
    const z = this.design(f);
    return {
      x: z.reduce((a, v, i) => a + v * this.bx[i], 0),
      y: z.reduce((a, v, i) => a + v * this.by[i], 0),
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

// Tiempo de mirada: tolera salidas breves y hace una pausa después de cada selección.
export class Dwell {
  constructor({ dwellMs = 900, graceMs = 220, refractoryMs = 650 } = {}) {
    Object.assign(this, { dwellMs, graceMs, refractoryMs });
    this.reset();
  }
  reset() {
    this.active = null; this.elapsed = 0; this.awaySince = null;
    this.lastT = null; this.blockedUntil = 0;
  }
  update(zone, t) {
    const dt = this.lastT === null ? 0 : Math.min(t - this.lastT, 150);
    this.lastT = t;
    if (t < this.blockedUntil) return { zone: null, progress: 0, selected: null };
    if (zone === this.active && zone !== null) {
      this.awaySince = null;
      this.elapsed += dt;
    } else if (this.active !== null && this.awaySince === null) {
      this.awaySince = t;
    } else if (this.active === null || t - this.awaySince >= this.graceMs) {
      this.active = zone; this.elapsed = 0; this.awaySince = null;
    }
    if (this.active !== null && this.elapsed >= this.dwellMs) {
      const selected = this.active;
      this.active = null; this.elapsed = 0; this.awaySince = null;
      this.blockedUntil = t + this.refractoryMs;
      return { zone: null, progress: 0, selected };
    }
    return { zone: this.active, progress: this.active === null ? 0 : this.elapsed / this.dwellMs, selected: null };
  }
}
