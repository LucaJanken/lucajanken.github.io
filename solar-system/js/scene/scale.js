// Display scale. s = 0 is the "overview": distances and sizes compressed by power laws so that
// everything fits on one screen. s = 1 is true scale: 1 scene unit = 10⁶ km for both sizes and
// distances. In between, every length is interpolated geometrically (in log space), which keeps
// ordering intact (a moon never ends up inside its planet, a planet never inside the Sun).
//
// Directions are never distorted: a body is always drawn in the true direction from its primary,
// so alignments (eclipses, conjunctions, oppositions) look right at every scale.

import { AU_KM } from '../astro/ephemeris.js';

export const UNIT_KM = 1e6;

// mean orbital radius, km (for the compressed moon distance)
const MEAN_A = { Moon: 384400, Phobos: 9376, Deimos: 23463, Io: 421800, Europa: 671100, Ganymede: 1070400, Callisto: 1882700, Titan: 1221870 };
// how far out (scene units, beyond the planet's drawn radius) the outermost moon sits in the overview
const MOON_BUDGET = { Earth: 2.9, Mars: 2.9, Jupiter: 10.6, Saturn: 7.0 };
const OUTERMOST = { Earth: 384400, Mars: 23463, Jupiter: 1882700, Saturn: 1221870 };

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
