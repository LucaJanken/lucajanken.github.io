// The real sky: the 9,096 stars of the Yale Bright Star Catalogue (BSC5, everything down to
// about magnitude 6.5, i.e. what the naked eye can see), with proper motion applied for the
// displayed date. Rendered at infinity in a separate pass, so they never show parallax or get
// clipped, and brightness and colour follow magnitude and B−V index.

import * as THREE from '../../vendor/three.min.js';
import { eqjToEcl } from '../astro/ephemeris.js';
import { toScene } from './bodies.js';

// B−V colour index → approximate sRGB, through effective temperature (Ballesteros 2012) and a
// Planck-curve fit (Tanner Helland), then desaturated: the eye sees star colours only faintly
function bvToRgb(bv) {
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const t = T / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = [r, g, b].map(x => Math.max(0, Math.min(255, x)) / 255);
  const m = (c[0] + c[1] + c[2]) / 3;
  return c.map(x => m + (x - m) * 0.55);
}

export class Stars {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    this.epochYear = null;
    this.ready = fetch('data/stars.bin').then(r => r.arrayBuffer()).then(buf => this.build(buf)).catch(e => console.warn('stars', e));
  }

  build(buf) {
    const dv = new DataView(buf), n = dv.getUint32(0, true);
    this.cat = new Float64Array(n * 4);
    const mag = new Float32Array(n), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = 4 + i * 12;
      const ra = dv.getUint16(o, true) / 65535 * 2 * Math.PI, de = dv.getInt16(o + 2, true) / 32767 * Math.PI / 2;
      mag[i] = dv.getInt16(o + 4, true) / 1000;
      col.set(bvToRgb(dv.getInt16(o + 6, true) / 1000), i * 3);
      // proper motion, radians per year (μα is μα·cos δ in the catalogue)
      const pmra = dv.getInt16(o + 8, true) / 1000 / 206264.806 / Math.max(Math.cos(de), 1e-6);
      const pmde = dv.getInt16(o + 10, true) / 1000 / 206264.806;
      this.cat.set([ra, de, pmra, pmde], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.uniforms = { uPx: { value: 1 }, uGain: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float aMag; attribute vec3 aCol;
        uniform float uPx; uniform float uGain;
        varying vec3 vCol; varying float vA;
        void main() {
          // perceived size grows slowly with flux; faint stars stay 1 px and fade instead
          float s = clamp(5.2 - 0.62 * aMag, 1.0, 8.0);
          vA = clamp(1.15 - 0.16 * aMag, 0.18, 1.0) * uGain;
          vCol = aCol;
          gl_PointSize = s * uPx;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vA;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(q, q);
          if (r2 > 1.0) discard;
          gl_FragColor = vec4(vCol * vA * exp(-3.2 * r2), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  // re-apply proper motion when the date has moved by more than half a year
  setEpoch(yearsSinceJ2000) {
    if (!this.points || (this.epochYear !== null && Math.abs(yearsSinceJ2000 - this.epochYear) < 0.5)) return;
    this.epochYear = yearsSinceJ2000;
    const pos = this.points.geometry.attributes.position.array, n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const ra = this.cat[i * 4] + this.cat[i * 4 + 2] * yearsSinceJ2000, de = this.cat[i * 4 + 1] + this.cat[i * 4 + 3] * yearsSinceJ2000;
      const v = toScene(eqjToEcl([Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)]));
      pos[i * 3] = v[0] * 5; pos[i * 3 + 1] = v[1] * 5; pos[i * 3 + 2] = v[2] * 5;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  render(renderer, mainCamera, pixelRatio) {
    if (!this.points || !this.points.visible) return;
    this.camera.quaternion.copy(mainCamera.quaternion);
    if (this.camera.fov !== mainCamera.fov || this.camera.aspect !== mainCamera.aspect) {
      this.camera.fov = mainCamera.fov; this.camera.aspect = mainCamera.aspect; this.camera.updateProjectionMatrix();
    }
    this.uniforms.uPx.value = pixelRatio;
    renderer.render(this.scene, this.camera);
  }
}
