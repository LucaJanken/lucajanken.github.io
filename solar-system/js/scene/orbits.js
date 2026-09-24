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
import { oscElements, orbitPoint, orbitState } from '../astro/ephemeris.js';
import { BODIES } from '../data/bodies.js';

const N = 480;

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
   * @param map(name, relKm) → display offset of a point relative to the body's own display position
   */
  update(snap, disp, origin, visible, map) {
    for (const name in this.lines) {
      const L = this.lines[name];
      L.line.visible = visible(name);
      const d = disp[name];
      L.line.position.set(d[0] - origin[0], d[1] - origin[1], d[2] - origin[2]);
      if (!L.line.visible) continue;
      const os = orbitState(snap, name), off = os.offset;
      const el = oscElements(os.pos, os.vel, os.mu);
      if (!(el.e < 1)) { L.line.visible = false; continue; }
      const arr = L.line.geometry.attributes.position.array;
      for (let i = 0; i < N; i++) {
        // sample densely at both ends (next to the body), sparsely on the far side
        const g = (1 - Math.cos(Math.PI * i / (N - 1))) / 2;
        const q = orbitPoint(el, el.E - 2 * Math.PI * g);
        const p = map(name, [q[0] + off[0], q[1] + off[1], q[2] + off[2]]);
        arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
      }
      L.line.geometry.attributes.position.needsUpdate = true;
    }
  }
}
