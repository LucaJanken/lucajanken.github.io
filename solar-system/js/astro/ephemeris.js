// Positions, velocities and spin orientations for every body, at one instant.
//
// Everything is returned in one frame: the J2000 mean ecliptic and equinox (x toward the vernal
// equinox, z toward the ecliptic north pole), in km and km/s, heliocentric. Mixing frames (e.g. a
// Moon theory "of date" with J2000 planets) is what put the old page's eclipse shadows 1,700 km
// off, so every source is rotated into this one frame here and nowhere else.
//
// Sources
//   planets, Pluto      astronomy-engine: VSOP87 (truncated) and a numerically integrated Pluto
//   Moon                astronomy-engine: ELP/MPP02-derived series
//   Galilean moons      astronomy-engine: Lainey's L1.2 theory
//   Titan, Phobos, Deimos  fits to JPL Horizons (see satellites.js)
//   spin axes           IAU WGCCRE 2015 (astronomy-engine RotationAxis); Earth: precession, nutation, ERA
//   time scales         astronomy-engine: UT → TT via ΔT (Espenak & Meeus polynomial)
//
// tests/ compares all of these against JPL Horizons (DE440) over 1800–2050.

import * as A from '../../vendor/astronomy.min.js';
import { BODIES, BY_NAME } from '../data/bodies.js';
import { satelliteState, FITTED } from './satellites.js';

export const AU_KM = A.KM_PER_AU;
const AUD_KMS = AU_KM / 86400;
const EQJ_ECL = A.Rotation_EQJ_ECL();

// astronomy-engine's row-major convention: out_j = Σ_i rot[i][j] v_i
const R = EQJ_ECL.rot;
export function eqjToEcl(v) {
  return [
    R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
    R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
    R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
  ];
}

const PLANETS = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const GALILEAN = { Io: 'io', Europa: 'europa', Ganymede: 'ganymede', Callisto: 'callisto' };
// bodies whose spin axis astronomy-engine knows (IAU); the rest are tidally locked moons
const IAU_AXIS = new Set(['Sun', 'Moon', ...PLANETS]);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

function stateKm(sv) {
  return { pos: eqjToEcl([sv.x * AU_KM, sv.y * AU_KM, sv.z * AU_KM]), vel: eqjToEcl([sv.vx * AUD_KMS, sv.vy * AUD_KMS, sv.vz * AUD_KMS]) };
}

// Body-fixed axes in the ecliptic frame. IAU convention: W is measured along the body's equator
// from its ascending node on the ICRF equator, which lies at Q = ẑ_ICRF × pole.
function iauAxes(axis) {
  const pole = eqjToEcl([axis.north.x, axis.north.y, axis.north.z]);
  const q = eqjToEcl(unit(cross([0, 0, 1], [axis.north.x, axis.north.y, axis.north.z])));
  const w = axis.spin * Math.PI / 180;
  const pq = cross(pole, q);
  const prime = add(scale(q, Math.cos(w)), scale(pq, Math.sin(w)));
  return { pole, prime };
}

// Earth: the IAU node convention above is degenerate because Earth's pole lies within a fraction of
// a degree of the ICRF pole (astronomy-engine's Earth `spin` is off by up to 180° far from J2000 for
// this reason). Instead: Greenwich sits at right ascension GAST on the true equator of date, which
// is then rotated into J2000 with the full precession–nutation model.
function earthAxes(time) {
  const gast = A.SiderealTime(time) * 15 * Math.PI / 180;
  const rot = A.Rotation_EQD_EQJ(time);
  const pm = A.RotateVector(rot, new A.Vector(Math.cos(gast), Math.sin(gast), 0, time));
  const pl = A.RotateVector(rot, new A.Vector(0, 0, 1, time));
  return { pole: eqjToEcl([pl.x, pl.y, pl.z]), prime: eqjToEcl([pm.x, pm.y, pm.z]) };
}

/**
 * All bodies at one instant.
 * @param {Date|number|A.AstroTime} when  UTC instant (Date or ms), or an AstroTime
 * @returns {{time, ut, tt, deltaT, bodies: Object<string,{pos,vel,rel?:{pos,vel}}>, axes: Object<string,{pole,prime}>}}
 */
export function snapshot(when) {
  const time = when instanceof A.AstroTime ? when : A.MakeTime(when instanceof Date ? when : new Date(when));
  const bodies = { Sun: { pos: [0, 0, 0], vel: [0, 0, 0] } };
  for (const p of PLANETS) bodies[p] = stateKm(A.HelioState(A.Body[p], time));

  const moon = stateKm(A.GeoMoonState(time));
  bodies.Moon = { pos: add(bodies.Earth.pos, moon.pos), vel: add(bodies.Earth.vel, moon.vel), rel: moon };

  const jm = A.JupiterMoons(time);
  for (const [name, key] of Object.entries(GALILEAN)) {
    const rel = stateKm(jm[key]);
    bodies[name] = { pos: add(bodies.Jupiter.pos, rel.pos), vel: add(bodies.Jupiter.vel, rel.vel), rel };
  }
  for (const name of FITTED) {
    const s = satelliteState(name, time.tt);
    const rel = { pos: eqjToEcl(s.pos), vel: eqjToEcl(s.vel) };
    const par = bodies[BY_NAME[name].parent];
    bodies[name] = { pos: add(par.pos, rel.pos), vel: add(par.vel, rel.vel), rel };
  }

  const axes = {};
  for (const b of BODIES) {
    if (b.name === 'Earth') { axes.Earth = earthAxes(time); continue; }
    if (IAU_AXIS.has(b.name)) { axes[b.name] = iauAxes(A.RotationAxis(A.Body[b.name], time)); continue; }
    // synchronous rotation: pole along the orbit normal, prime meridian facing the planet
    // (the IAU definition of longitude 0 for these moons, to within their small librations)
    const { pos, vel } = bodies[b.name].rel;
    const pole = unit(cross(pos, vel));
    const toParent = scale(pos, -1);
    const prime = unit(sub(toParent, scale(pole, dot(toParent, pole))));
    axes[b.name] = { pole, prime };
  }
  return { time, ut: time.ut, tt: time.tt, deltaT: (time.tt - time.ut) * 86400, bodies, axes };
}

// ---- orbital elements -------------------------------------------------------------------------

const G = 6.6743e-20; // km³ kg⁻¹ s⁻²

export function gmOf(name) { return G * BY_NAME[name].massKg; }

/**
 * Osculating two-body elements of a relative state (km, km/s) about a centre of mass `mu` (km³/s²).
 * Angles in radians, in the ecliptic J2000 frame.
 */
export function oscElements(pos, vel, mu) {
  const r = Math.hypot(...pos), v2 = dot(vel, vel);
  const h = cross(pos, vel), hn = Math.hypot(...h);
  const ev = sub(scale(pos, v2 / mu - 1 / r), scale(vel, dot(pos, vel) / mu));
  const e = Math.hypot(...ev);
  const a = 1 / (2 / r - v2 / mu);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hn)));
  const nvec = [-h[1], h[0], 0], nn = Math.hypot(nvec[0], nvec[1]);
  const node = nn > 1e-12 ? Math.atan2(nvec[1], nvec[0]) : 0;
  // in-plane basis: P toward pericentre, Q 90° ahead
  const hu = scale(h, 1 / hn);
  const P = e > 1e-9 ? scale(ev, 1 / e) : unit(pos);
  const Q = cross(hu, P);
  const nu = Math.atan2(dot(pos, Q), dot(pos, P));
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = E - e * Math.sin(E);
  const argp = nn > 1e-12 ? Math.atan2(dot(cross([nvec[0] / nn, nvec[1] / nn, 0], P), hu), dot([nvec[0] / nn, nvec[1] / nn, 0], P)) : Math.atan2(P[1], P[0]);
  const n = Math.sqrt(mu / Math.abs(a * a * a));
  return { a, e, i, node, argp, M, E, nu, P, Q, n, periodS: 2 * Math.PI / n };
}

// point on the osculating ellipse at eccentric anomaly E, relative to the focus (km)
export function orbitPoint(el, E) {
  const x = el.a * (Math.cos(E) - el.e), y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  return [el.P[0] * x + el.Q[0] * y, el.P[1] * x + el.Q[1] * y, el.P[2] * x + el.Q[2] * y];
}

export { A };
