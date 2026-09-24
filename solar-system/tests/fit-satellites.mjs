// Fit the precessing-ellipse models of js/astro/satellites.js to Horizons vectors.
//
//   python3 tests/fetch_horizons.py 606 401 402
//   node tests/fit-satellites.mjs 606 15.945448 x 0.0334442282     # Titan  (id, period d, -, planet mean motion °/d)
//   node tests/fit-satellites.mjs 401 0.31891023 nd 0.5240207766   # Phobos ('nd': also fit tidal acceleration)
//   node tests/fit-satellites.mjs 402 1.2624407 x 0.5240207766     # Deimos
//
// Levenberg–Marquardt on all 3-D positions, seeded from osculating elements. Prints the RMS and
// maximum error and the parameters (angles in degrees, rates per day; reduce L0, node0, peri0 mod 360).
// Fit a precessing Keplerian orbit (in a fitted Laplace plane) to Horizons jovicentric/planetocentric vectors.
import fs from 'fs';
const REF = process.env.REF || new URL('./horizons-full', import.meta.url).pathname, D = Math.PI / 180, J2000 = 2451545.0;
const [key, P0] = [process.argv[2], +process.argv[3]];
const NP = (+process.argv[5] || 0) * Math.PI / 180;
const data = JSON.parse(fs.readFileSync(`${REF}/${key}.json`)).map(r => ({ t: r[0] - J2000, r: r.slice(1, 4), v: r.slice(4, 7) }));
const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
const norm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// 1. Laplace pole guess = mean orbit normal
let hs = [0, 0, 0]; data.forEach(d => { const h = norm(cross(d.r, d.v)); hs = hs.map((x, i) => x + h[i]); });
const p0 = norm(hs);
const ra0 = Math.atan2(p0[1], p0[0]), de0 = Math.asin(p0[2]);
function frame(ra, de) { // Laplace frame: x = ascending node on ICRF equator, z = pole
  const z = [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)];
  const x = [-Math.sin(ra), Math.cos(ra), 0]; const y = cross(z, x); return [x, y, z];
}
// params: ra, de, a, e, i, O0, Odot, w0(peri long), wdot, L0, n, ndot
function model(p, t) {
  const [ra, de, a, e, inc, O0, Od, W0, Wd, L0, n, nd, c1, s1, c2, s2, c3, s3] = p;
  const f = NP * t, Oa = O0 + Od * t;
  const O = O0 + Od * t, W = W0 + Wd * t, L = L0 + n * t + 0.5 * nd * t * t + c1 * Math.cos(f) + s1 * Math.sin(f) + c2 * Math.cos(2 * f) + s2 * Math.sin(2 * f) + c3 * Math.cos(Oa) + s3 * Math.sin(Oa);
  const M = L - W, w = W - O;
  let E = M; for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(inc), si = Math.sin(inc);
  const X = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const Y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const Z = (sw * si) * xp + (cw * si) * yp;
  const [fx, fy, fz] = frame(ra, de);
  return [0, 1, 2].map(k => fx[k] * X + fy[k] * Y + fz[k] * Z);
}
// 2. seed from osculating elements in the Laplace frame, with unwrapped linear trends
const GM = { '606': 37931207.7, '401': 42828.37, '402': 42828.37 }[key];
const [fx, fy, fz] = frame(ra0, de0);
const loc = a => [dot(a, fx), dot(a, fy), dot(a, fz)];
const osc = data.map(d => {
  const r = loc(d.r), v = loc(d.v), R = Math.hypot(...r), h = cross(r, v), H = Math.hypot(...h);
  const ev = cross(v, h).map((x, k) => x / GM - r[k] / R);
  const inc = Math.acos(h[2] / H), O = Math.atan2(h[0], -h[1]);
  const e = Math.hypot(...ev);
  // longitude of pericentre and true longitude measured in the plane (node-referenced, then + O)
  const nvec = [Math.cos(O), Math.sin(O), 0], m = cross(h.map(x => x / H), nvec);
  const w = Math.atan2(dot(ev, m), dot(ev, nvec)), u = Math.atan2(dot(r, m), dot(r, nvec));
  const nu = u - w, E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2)), M = E - e * Math.sin(E);
  return { t: d.t, e, inc, O, W: O + w, L: O + w + M };
});
function linfit(key, rate0) { // unwrap successive samples against an expected rate, then least squares
  let prev = null, acc = 0; const ys = [];
  osc.forEach((o, i) => { let y = o[key]; if (prev !== null) { const exp = prev + rate0 * (o.t - osc[i - 1].t); y = exp + wrap(y - exp); } ys.push(y); prev = y; });
  let sx = 0, sy = 0, sxx = 0, sxy = 0; const N = ys.length;
  osc.forEach((o, i) => { sx += o.t; sy += ys[i]; sxx += o.t * o.t; sxy += o.t * ys[i]; });
  const b = (N * sxy - sx * sy) / (N * sxx - sx * sx); return [(sy - b * sx) / N, b];
}
const mean = k => osc.reduce((s, o) => s + o[k], 0) / osc.length;
const n0 = 2 * Math.PI / P0;
const [L0g, ng] = linfit('L', n0);
const [O0g, Odg] = linfit('O', 0), [W0g, Wdg] = linfit('W', 0);
console.log('seed', key, { e: mean('e'), i: mean('inc') / D, Odot: Odg / D, Wdot: Wdg / D, n: ng / D });
let p = [ra0, de0, data.reduce((s, d) => s + Math.hypot(...d.r), 0) / data.length, mean('e'), mean('inc'), O0g, Odg, W0g, Wdg, L0g, ng, 0, 0, 0, 0, 0, 0, 0];
const fitMask = p.map((_, i) => i === 11 ? (process.argv[4] === 'nd' ? 1 : 0) : i >= 16 ? 1 : i >= 12 ? (NP ? 1 : 0) : 1);
function resid(p) { const out = []; data.forEach(d => { const m = model(p, d.t); out.push(m[0] - d.r[0], m[1] - d.r[1], m[2] - d.r[2]); }); return out; }
const rms = r => Math.sqrt(r.reduce((s, x) => s + x * x, 0) / (r.length / 3));
// Levenberg-Marquardt
let lam = 1e-3, r = resid(p), cost = rms(r);
const scale = [1e-6, 1e-6, 1, 1e-6, 1e-6, 1e-4, 1e-9, 1e-4, 1e-9, 1e-5, 1e-11, 1e-16, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6];
for (let it = 0; it < 200; it++) {
  const idx = fitMask.map((m, i) => m ? i : -1).filter(i => i >= 0);
  const J = idx.map(i => { const q = p.slice(); q[i] += scale[i]; const rq = resid(q); return rq.map((x, k) => (x - r[k]) / scale[i]); });
  const m = idx.length, A = Array.from({ length: m }, () => new Array(m).fill(0)), g = new Array(m).fill(0);
  for (let a = 0; a < m; a++) { for (let b = 0; b <= a; b++) { let s = 0; for (let k = 0; k < r.length; k++) s += J[a][k] * J[b][k]; A[a][b] = A[b][a] = s; } let s = 0; for (let k = 0; k < r.length; k++) s += J[a][k] * r[k]; g[a] = -s; }
  let improved = false;
  for (let tries = 0; tries < 12 && !improved; tries++) {
    const M = A.map((row, a) => row.map((x, b) => a === b ? x * (1 + lam) : x)), bb = g.slice();
    for (let c = 0; c < m; c++) { let piv = c; for (let rr = c + 1; rr < m; rr++) if (Math.abs(M[rr][c]) > Math.abs(M[piv][c])) piv = rr; [M[c], M[piv]] = [M[piv], M[c]]; [bb[c], bb[piv]] = [bb[piv], bb[c]]; for (let rr = c + 1; rr < m; rr++) { const f = M[rr][c] / M[c][c]; for (let k = c; k < m; k++) M[rr][k] -= f * M[c][k]; bb[rr] -= f * bb[c]; } }
    const dx = new Array(m); for (let c = m - 1; c >= 0; c--) { let s = bb[c]; for (let k = c + 1; k < m; k++) s -= M[c][k] * dx[k]; dx[c] = s / M[c][c]; }
    const q = p.slice(); idx.forEach((i, k) => q[i] += dx[k]); if (q[3] < 0) { q[3] = -q[3]; q[7] += Math.PI; }
    const rq = resid(q), cq = rms(rq);
    if (cq < cost) { p = q; r = rq; cost = cq; lam = Math.max(lam / 5, 1e-9); improved = true; } else lam *= 8;
  }
  if (!improved) break;
}
const errs = []; data.forEach((d, i) => errs.push([d.t, Math.hypot(r[3 * i], r[3 * i + 1], r[3 * i + 2])]));
const pre = errs.filter(e => e[0] < -36525).map(e => e[1]), post = errs.filter(e => e[0] >= -36525).map(e => e[1]);
console.log(key, 'rms km', cost.toFixed(1), 'max km <1900', Math.max(...pre).toFixed(0), '>=1900', Math.max(...post).toFixed(0));
const [ra, de, a, e, inc, O0, Od, W0, Wd, L0, n, nd, c1, s1, c2, s2, c3, s3] = p;
console.log(JSON.stringify({ lonTerms: [c1, s1, c2, s2, c3, s3].map(x => x / D), NPdeg: NP / D, poleRA: ra / D, poleDec: de / D, a, e, i: inc / D, node0: O0 / D, nodeRate: Od / D, peri0: W0 / D, periRate: Wd / D, L0: L0 / D, n: n / D, ndot: nd / D }));
{ // residual decomposition + dominant period of each component
  const comp = { rad: [], along: [], cross: [] };
  data.forEach((d, i) => {
    const R = norm(d.r), H = norm(cross(d.r, d.v)), T = cross(H, R), e = [r[3 * i], r[3 * i + 1], r[3 * i + 2]];
    comp.rad.push(dot(e, R)); comp.along.push(dot(e, T)); comp.cross.push(dot(e, H));
  });
  for (const [k, v] of Object.entries(comp)) {
    let best = [0, 0];
    for (let P = 60; P < 30000; P *= 1.01) { const w = 2 * Math.PI / P; let c = 0, s = 0; data.forEach((d, i) => { c += v[i] * Math.cos(w * d.t); s += v[i] * Math.sin(w * d.t); }); const A = 2 * Math.hypot(c, s) / v.length; if (A > best[0]) best = [A, P]; }
    console.log(k, 'rms', rms(v.flatMap(x => [x, 0, 0])).toFixed(1), 'peak amp', best[0].toFixed(1), 'km at period', best[1].toFixed(0), 'd');
  }
}
