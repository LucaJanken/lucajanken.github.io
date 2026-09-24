// Accuracy checks, shared by the Node runner (tests/run.mjs) and the browser page (tests/index.html).
// Every check compares the model with an independent reference and fails above a stated tolerance.

import { A, snapshot, eqjToEcl } from '../js/astro/ephemeris.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const DEG = 180 / Math.PI, ARCSEC = 206264.806;

// tolerances: the "eye can never tell" budget (1′ on the sky, ~1 px at full-screen zooms)
const LIMITS = {
  planetsFromEarthArcsec: 30, moonKm: 30,
  Io: 1000, Europa: 1000, Ganymede: 1000, Callisto: 1000, Titan: 1000, Phobos: 25, Deimos: 70,
};

export function horizonsChecks(fixture) {
  const out = [];
  const B = fixture.bodies;
  const earthRef = new Map(B.Earth.rows.map(r => [r[0], r.slice(1)]));
  for (const [name, { center, rows }] of Object.entries(B)) {
    let worstKm = 0, worstArc = 0, at = null;
    for (const r of rows) {
      const s = snapshot(A.AstroTime.FromTerrestrialTime(r[0] - 2451545.0));
      const ref = eqjToEcl(r.slice(1));
      const model = center === 'Sun' ? s.bodies[name].pos : s.bodies[name].rel.pos;
      const errKm = len(sub(model, ref));
      let arc = 0;
      if (center === 'Sun' && name !== 'Earth' && earthRef.has(r[0])) {
        // error as seen from Earth: compare the geocentric vectors of model and reference
        const eRef = eqjToEcl(earthRef.get(r[0]));
        const gModel = sub(model, s.bodies.Earth.pos), gRef = sub(ref, eRef);
        arc = len(sub(gModel, gRef)) / len(gRef) * ARCSEC;
      }
      if (errKm > worstKm) { worstKm = errKm; at = r[0]; }
      worstArc = Math.max(worstArc, arc);
    }
    let pass, detail;
    if (center === 'Sun') {
      pass = name === 'Earth' ? worstKm < 5000 : worstArc < LIMITS.planetsFromEarthArcsec;
      detail = `max ${Math.round(worstKm).toLocaleString('en-US')} km` + (name === 'Earth' ? '' : `, ${worstArc.toFixed(1)}″ as seen from Earth`);
    } else {
      const lim = name === 'Moon' ? LIMITS.moonKm : LIMITS[name];
      pass = worstKm < lim;
      detail = `max ${worstKm.toFixed(0)} km (limit ${lim} km)`;
    }
    out.push({ name: `${name} vs JPL Horizons, 1800–2050`, pass, detail });
  }
  return out;
}

// Where the Moon's shadow axis meets Earth (WGS84 ellipsoid), in geodetic coordinates.
function shadowPoint(s) {
  // the Moon as the light saw it, |Moon − Earth|/c earlier (see scene/bodies.js)
  const E = s.bodies.Earth.pos, M0 = s.bodies.Moon.pos, V = s.bodies.Moon.vel;
  const lt = len(sub(M0, E)) / 299792.458;
  const M = M0.map((x, i) => x - V[i] * lt);
  const ax = M.map(x => x / len(M));
  const { pole, prime } = s.axes.Earth, east = cross(pole, prime);
  // express in Earth-fixed axes, then solve |p|² on the ellipsoid (x² + y²)/a² + z²/b² = 1
  const toBF = v => [dot(v, prime), dot(v, east), dot(v, pole)];
  const o = toBF(sub([0, 0, 0], E)), d = toBF(ax);   // ray from the Sun centre toward the Moon
  const a = 6378.137, b = 6356.752;
  const S = v => [v[0] / a, v[1] / a, v[2] / b];
  const os = S(o), ds = S(d);
  const qa = dot(ds, ds), qb = dot(os, ds), qc = dot(os, os) - 1;
  const tca = -qb / qa;
  const missKm = len(sub(o.map((x, i) => x + tca * d[i]), [0, 0, 0]));
  const disc = qb * qb - qa * qc;
  if (disc < 0) return { missKm };
  const t = (-qb - Math.sqrt(disc)) / qa;
  const p = o.map((x, i) => x + t * d[i]);
  const lon = Math.atan2(p[1], p[0]) * DEG;
  // geodetic latitude on the ellipsoid
  const lat = Math.atan2(p[2] * a * a, b * b * Math.hypot(p[0], p[1])) * DEG;
  return { missKm, lat, lon };
}

// NASA Five Millennium Canon of Solar Eclipses (Espenak & Meeus): greatest eclipse, UT, and gamma
const ECLIPSES = [
  ['1919-05-29T13:08:34Z', 4.40, -16.70, -0.2955],
  ['1999-08-11T11:03:05Z', 45.07, 24.28, 0.5062],
  ['2024-04-08T18:17:20Z', 25.29, -104.14, 0.3431],
  ['2027-08-02T10:06:39Z', 25.51, 33.18, 0.1421],
];

export function eclipseChecks() {
  return ECLIPSES.map(([iso, lat, lon, gamma]) => {
    // greatest eclipse = shadow axis closest to Earth's centre; search ±10 min around the canon time
    const t0 = Date.parse(iso);
    let best = null;
    for (let dt = -600; dt <= 600; dt += 2) {
      const p = shadowPoint(snapshot(t0 + dt * 1000));
      if (!best || p.missKm < best.missKm) best = { ...p, dt };
    }
    const dLat = best.lat - lat, dLon = (best.lon - lon) * Math.cos(lat / DEG);
    const km = Math.hypot(dLat, dLon) * 111.2;
    const dGammaKm = Math.abs(best.missKm - Math.abs(gamma) * 6378.137);
    return {
      name: `Solar eclipse ${iso.slice(0, 10)}: greatest-eclipse point and time`,
      pass: km < 15 && Math.abs(best.dt) < 8 && dGammaKm < 10,
      detail: `${best.lat.toFixed(2)}°, ${best.lon.toFixed(2)}°: ${km.toFixed(0)} km from NASA's point, ${best.dt >= 0 ? '+' : ''}${best.dt} s, axis offset differs by ${dGammaKm.toFixed(0)} km`,
    };
  });
}

export function geometryChecks() {
  const out = [];
  // Saturn's ring-plane crossing as seen from Earth, 23 March 2025
  {
    const s = snapshot(Date.parse('2025-03-23T12:00:00Z'));
    const v = sub(s.bodies.Earth.pos, s.bodies.Saturn.pos);
    const B = Math.asin(dot(v, s.axes.Saturn.pole) / len(v)) * DEG;
    out.push({ name: 'Saturn ring-plane crossing (Earth), 23 Mar 2025', pass: Math.abs(B) < 0.2, detail: `ring opening angle ${B.toFixed(3)}°` });
  }
  // Laplace resonance of Io, Europa, Ganymede: λ1 − 3λ2 + 2λ3 librates about 180°
  {
    let worst = 0;
    for (let k = 0; k < 40; k++) {
      const s = snapshot(Date.UTC(1850 + k * 5, 0, 1));
      const pole = s.axes.Jupiter.pole;
      const ref = cross(pole, [0, 0, 1]);
      const lam = n => { const p = s.bodies[n].rel.pos; return Math.atan2(dot(cross(ref, p), pole), dot(ref, p)); };
      let L = (lam('Io') - 3 * lam('Europa') + 2 * lam('Ganymede')) * DEG;
      L = ((L % 360) + 360) % 360;
      worst = Math.max(worst, Math.abs(L - 180));
    }
    // true (not mean) longitudes: the moons' forced eccentricities (0.004, 0.009, 0.001) allow
    // up to 2e1 + 6e2 + 4e3 ≈ 4° of swing; the mean-longitude libration itself is only ~0.03°
    out.push({ name: 'Laplace resonance λIo − 3λEuropa + 2λGanymede = 180°', pass: worst < 4.5, detail: `largest deviation ${worst.toFixed(2)}° over 1850–2045 (true longitudes; eccentricity terms allow ~4°)` });
  }
  // Earth's rotation: Greenwich faces the right right ascension (apparent sidereal time)
  {
    const s = snapshot(Date.parse('1919-05-29T13:08:00Z'));
    const lst = A.SiderealTime(s.time) * 15;
    const pm = s.axes.Earth.prime;
    const eqd = A.RotateVector(A.Rotation_EQJ_EQD(s.time), new A.Vector(...eclToEqj(pm), s.time));
    const ra = (Math.atan2(eqd.y, eqd.x) * DEG + 360) % 360;
    const d = Math.abs(((ra - lst + 540) % 360) - 180) * 240;
    out.push({ name: 'Earth rotation: Greenwich meridian at GAST (1919)', pass: d < 1, detail: `off by ${d.toFixed(3)} s of time` });
  }
  return out;
}

function eclToEqj(v) {
  const R = A.Rotation_ECL_EQJ().rot;
  return [0, 1, 2].map(j => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]);
}

export function runAll(fixture) {
  return [...geometryChecks(), ...eclipseChecks(), ...horizonsChecks(fixture)];
}
