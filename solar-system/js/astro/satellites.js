// Orbits of Titan, Triton, Charon, Phobos and Deimos, which astronomy-engine does not provide.
//
// Each is a precessing Keplerian ellipse in its own Laplace plane, with a few long-period terms in
// mean longitude (solar perturbation at the planet's orbital frequency, and a term in the node).
// The parameters were least-squares fitted to JPL Horizons state vectors (SAT441 for Titan, NEP097
// for Triton, PLU058 for Charon, MAR097 for the Martian moons) sampled every 37 days over 1800–2050.
// Maximum position error over that span: Phobos 20 km, Deimos 56 km, Titan 900 km (0.04° of its
// orbit), Triton 96 km, Charon 1 km. Triton orbits backwards: its fitted Laplace pole points away
// from Neptune's north pole, about which the orbit swings every ~690 years. Charon's position is
// relative to Pluto's centre. The fit script lives in tests/fit-satellites.mjs.
//
// Angles in degrees, rates in degrees per day, time t in TT days since J2000.0.

const D = Math.PI / 180;

const FITS = {
  Phobos: {
    poleRA: 317.751424229654, poleDec: 52.938925256828, a: 9374.922336127434, e: 0.015122931805, i: 1.074631736163,
    node0: 169.077447229898, nodeRate: -0.435789589061, peri0: 25.560092669661, periRate: 0.435182825618,
    L0: 215.124995544553, n: 1128.844756219671, ndot: 1.8888e-8, NP: 0.5240207766,
    lon: [-0.0017624746, -0.005558537, -0.0002625944, 0.0032235464, 0.0012349737, -0.0016087006],
  },
  Deimos: {
    poleRA: 316.735446052753, poleDec: 53.573631511346, a: 23457.533265726943, e: 0.000261056624, i: 1.794056064035,
    node0: 54.594476557352, nodeRate: -0.018067530695, peri0: 248.61336108756, periRate: 0.017919721049,
    L0: 259.340410802513, n: 285.161886979726, ndot: 0, NP: 0.5240207766,
    lon: [-0.006951281, -0.0222075182, -0.0010923097, 0.0117049738, 0.1883176323, -0.1950654029],
  },
  Titan: {
    poleRA: 36.205839202865, poleDec: 83.970831212178, a: 1221865.0992359817, e: 0.028887730519, i: 0.323742928336,
    node0: 28.830087346249, nodeRate: -0.001378537559, peri0: 208.371584950542, periRate: 0.001394905332,
    L0: 11.901906562503, n: 22.576975420102, ndot: 0, NP: 0.0334442282,
    lon: [0.0071009769, -0.0077018183, -0.0110931591, 0.0045091952, 0.031107251, -0.0228031997],
  },
  Triton: {
    poleRA: 119.409784818915, poleDec: -43.365137625959, a: 354797.6847073379, e: 0.000175786845, i: 23.076446361081,
    node0: 182.260438171155, nodeRate: -0.001439824761, peri0: 232.800326235039, periRate: 2.8788825936,
    L0: 60.752261781134, n: 61.257260345235, ndot: 0, NP: 0.0059811,
    lon: [-0.0007244184, -0.0003287765, 0.0006434694, 0.0013693269, 0.0119563981, 0.0244113442],
  },
  Charon: {
    poleRA: 133.007128972885, poleDec: -6.262120053898, a: 19595.764510365814, e: 0.000160900211, i: 0.017562037945,
    node0: 179.929277549725, nodeRate: -0.000314427064, peri0: 155.355064577547, periRate: 0.000002701842,
    L0: 304.410033453256, n: 56.362525311303, ndot: 0, NP: 0.0039753,
    lon: [-0.0023979786, -0.0037946571, -0.0002186544, -0.0024228474, 0.2847930864, 0.9797396336],
  },
};

// Laplace-plane basis in ICRF/J2000 equatorial coordinates: x = ascending node on the equator, z = pole
const FRAMES = {};
for (const [name, f] of Object.entries(FITS)) {
  const ra = f.poleRA * D, de = f.poleDec * D;
  const z = [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)];
  const x = [-Math.sin(ra), Math.cos(ra), 0];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  FRAMES[name] = [x, y, z];
}

export const FITTED = Object.keys(FITS);

// position relative to the parent, km, J2000 equatorial (EQJ)
export function satellitePosition(name, t) {
  const f = FITS[name], fr = FRAMES[name];
  const arg = f.NP * t * D;
  const O = (f.node0 + f.nodeRate * t) * D;
  const W = (f.peri0 + f.periRate * t) * D;
  const L = (f.L0 + f.n * t + 0.5 * f.ndot * t * t) * D
    + (f.lon[0] * Math.cos(arg) + f.lon[1] * Math.sin(arg) + f.lon[2] * Math.cos(2 * arg) + f.lon[3] * Math.sin(2 * arg)
      + f.lon[4] * Math.cos(O) + f.lon[5] * Math.sin(O)) * D;
  const M = L - W, w = W - O, e = f.e, inc = f.i * D;
  let E = M;
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = f.a * (Math.cos(E) - e), yp = f.a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(inc), si = Math.sin(inc);
  const X = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const Y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const Z = (sw * si) * xp + (cw * si) * yp;
  return [0, 1, 2].map(k => fr[0][k] * X + fr[1][k] * Y + fr[2][k] * Z);
}

// position (km) and velocity (km/s), EQJ, relative to the parent
export function satelliteState(name, t) {
  const h = 20 / 86400;
  const a = satellitePosition(name, t - h), b = satellitePosition(name, t + h), p = satellitePosition(name, t);
  return { pos: p, vel: [0, 1, 2].map(k => (b[k] - a[k]) / 40) };
}
