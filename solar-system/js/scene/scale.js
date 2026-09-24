// Display scale. s = 0 is the "overview": distances and sizes compressed by power laws so that
// everything fits on one screen. s = 1 is true scale: 1 scene unit = 10⁶ km for both sizes and
// distances. In between, every length is interpolated geometrically (in log space), which keeps
// ordering intact (a moon never ends up inside its planet, a planet never inside the Sun).
//
// Directions are never distorted: a body is always drawn in the true direction from its primary,
// so alignments (eclipses, conjunctions, oppositions) look right at every scale.

import { AU_KM } from '../astro/ephemeris.js';
import { BODIES } from '../data/bodies.js';

export const UNIT_KM = 1e6;

/** ecliptic (x, y, z) → scene axes (x, up = ecliptic north, −y) */
export const toScene = v => [v[0], v[2], -v[1]];

// mean orbital radius of each moon, and of each planet's outermost moon, km
const MEAN_A = Object.fromEntries(BODIES.filter(b => b.aKm).map(b => [b.name, b.aKm]));
const OUTERMOST = {};
for (const b of BODIES) if (b.aKm) OUTERMOST[b.parent] = Math.max(OUTERMOST[b.parent] || 0, b.aKm);
// how far out (scene units, beyond the planet's drawn radius) the outermost moon sits in the overview
const MOON_BUDGET = { Earth: 2.9, Mars: 2.9, Jupiter: 10.6, Saturn: 7.0 };

const geo = (a, b, s) => a * Math.pow(b / a, s);
const sizeC = Rkm => 1.6 * Math.pow(Rkm / 6371, 0.32);

export class DisplayScale {
  constructor() { this.s = 0; }
  /** drawn distance from the Sun for a heliocentric distance r (km) */
  helio(rKm) { return rKm <= 0 ? 0 : geo(60 * Math.pow(rKm / AU_KM, 0.42), rKm / UNIT_KM, this.s); }
  /** drawn radius for a true radius R (km) */
  size(Rkm) { return geo(sizeC(Rkm), Rkm / UNIT_KM, this.s); }
  /** drawn distance of a moon from its planet, for a true separation r (km) */
  moon(name, parent, parentRkm, rKm) {
    const a = MEAN_A[name];
    const dc = sizeC(parentRkm) + MOON_BUDGET[parent] * Math.pow(a / OUTERMOST[parent], 0.6);
    return geo(dc * rKm / a, rKm / UNIT_KM, this.s);
  }
}
