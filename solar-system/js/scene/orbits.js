// Orbit paths: the osculating ellipse of each body at the current instant.
//
// The osculating ellipse is the two-body orbit with the body's current position and velocity, so
// it passes exactly through the body and is tangent to its true path; perturbations only show up
// far from the body (and the drawn orbit slowly changes, as real orbits do).
//
// Vertices are stored relative to the body itself, so precision is best right where the eye is
// looking: zoomed in on Pluto, its orbit still runs through its centre instead of missing it by
// thousands of km as a Sun-centred float32 polyline would.

import * as THREE from '../../vendor/three.min.js';
import { oscElements, orbitState } from '../astro/ephemeris.js';
import { BODIES } from '../data/bodies.js';
import { toScene } from './scale.js';

const N = 480;
// eccentric anomaly behind the body of each sample: dense at both ends (next to the body), sparse
// on the far side
const BEHIND = Float64Array.from({ length: N }, (_, i) => Math.PI * (1 - Math.cos(Math.PI * i / (N - 1))));

export class Orbits {
  constructor(scene) {
    this.lines = {};
    for (const def of BODIES) {
      if (!def.parent) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const col = new Float32Array(N * 4), c = new THREE.Color(def.color);
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        // brightest right behind the body, fading around the orbit: shows the direction of motion
        col.set([c.r, c.g, c.b, 0.75 * (1 - u) + 0.1 * u], i * 4);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
      line.frustumCulled = false;
      scene.add(line);
      this.lines[def.name] = { def, line };
    }
  }

  /**
   * @param map(name) → { centre, radial }: a point p (km, scene axes, relative to the body's
   *   primary) is drawn at centre + p · radial(|p|) / |p|, relative to the body's own display position
   * @param stamp  changes whenever the display positions do (time, scale); lines are only rebuilt then
   */
  update(snap, disp, origin, visible, map, stamp) {
    for (const name in this.lines) {
      const L = this.lines[name];
      L.line.visible = visible(name);
      const d = disp[name];
      L.line.position.set(d[0] - origin[0], d[1] - origin[1], d[2] - origin[2]);
      if (!L.line.visible || L.stamp === stamp) continue;
      const os = orbitState(snap, name);
      // Earth's ellipse is that of the Earth–Moon barycentre; shifted by Earth's offset from it
      // (≤ 4,700 km, the scale of the Moon's monthly tug) it runs through Earth's centre
      const b = snap.bodies[name], off = toScene(name === 'Earth'
        ? [b.pos[0] - os.pos[0], b.pos[1] - os.pos[1], b.pos[2] - os.pos[2]] : os.offset);
      const el = oscElements(os.pos, os.vel, os.mu);
      if (!(el.e < 1)) { L.line.visible = false; L.stamp = null; continue; }
      // the ellipse x P + y Q (orbitPoint), with P and Q taken into scene axes once
      const P = toScene(el.P), Q = toScene(el.Q), bAxis = el.a * Math.sqrt(1 - el.e * el.e);
      const { centre: c, radial } = map(name);
      const arr = L.line.geometry.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const E = el.E - BEHIND[i], x = el.a * (Math.cos(E) - el.e), y = bAxis * Math.sin(E);
        const px = P[0] * x + Q[0] * y + off[0], py = P[1] * x + Q[1] * y + off[1], pz = P[2] * x + Q[2] * y + off[2];
        const r = Math.sqrt(px * px + py * py + pz * pz), k = radial(r) / r;
        arr[i * 3] = c[0] + px * k; arr[i * 3 + 1] = c[1] + py * k; arr[i * 3 + 2] = c[2] + pz * k;
      }
      L.line.geometry.attributes.position.needsUpdate = true;
      L.stamp = stamp;
    }
  }
}
