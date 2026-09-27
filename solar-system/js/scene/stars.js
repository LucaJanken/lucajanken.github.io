// The real sky: the 9,096 stars of the Yale Bright Star Catalogue (BSC5, everything down to
// about magnitude 6.5, i.e. what the naked eye can see), with proper motion applied for the
// displayed date, over the diffuse light of the Milky Way. Rendered at infinity in a separate pass,
// so they never show parallax or get clipped, and brightness and colour follow magnitude and B−V
// index.
//
// The Milky Way is NASA SVS's "Deep Star Maps 2020" background (Hipparcos-2, Tycho-2 and Gaia DR2
// with the Hipparcos and Tycho stars left out, so the catalogue's stars are not counted twice): an
// equirectangular map in J2000 right ascension and declination, centred on 0h with RA increasing
// to the left, tone mapped to sRGB with the 99.9th percentile at white. It includes the Magellanic
// Clouds and the Andromeda galaxy.

import * as THREE from '../../vendor/three.min.js';
import { eqjToEcl } from '../astro/ephemeris.js';
import { toScene } from './scale.js';
import { ADD_KEEP_ALPHA } from './glare.js';

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

// the J2000 equatorial axes expressed in the scene
const EQ_AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => toScene(eqjToEcl(e)));
// scene direction → J2000 equatorial: the rows are those axes
function sceneToEquatorial() {
  const r = EQ_AXES;
  return new THREE.Matrix3().set(...r[0], ...r[1], ...r[2]);
}

export class Stars {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    this.epochYear = null;
    this.visible = true;
    this.glare = { uDim: { value: 0 }, uSunDir: { value: new THREE.Vector3(1, 0, 0) } };
    this.milkyWay();
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
    // uDim: how much the Sun's glare, when it is in view, drowns the stars (most of all near it)
    this.uniforms = { uPx: { value: 1 }, uGain: { value: 1 }, ...this.glare };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: false, ...ADD_KEEP_ALPHA,
      vertexShader: /* glsl */`
        attribute float aMag; attribute vec3 aCol;
        uniform float uPx; uniform float uGain; uniform float uDim; uniform vec3 uSunDir;
        varying vec3 vCol; varying float vA;
        void main() {
          // perceived size grows slowly with flux; faint stars stay 1 px and fade instead
          float s = clamp(5.2 - 0.62 * aMag, 1.0, 8.0);
          float ang = acos(clamp(dot(normalize(position), uSunDir), -1.0, 1.0));
          float glare = uDim * (0.4 + 0.6 * exp(-ang / 0.2));
          vA = clamp(1.15 - 0.16 * aMag, 0.18, 1.0) * uGain * (1.0 - glare);
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
    // at the fastest rates this runs every frame, so no per-star allocations
    const pos = this.points.geometry.attributes.position.array, n = pos.length / 3, [X, Y, Z] = EQ_AXES;
    for (let i = 0; i < n; i++) {
      const ra = this.cat[i * 4] + this.cat[i * 4 + 2] * yearsSinceJ2000, de = this.cat[i * 4 + 1] + this.cat[i * 4 + 3] * yearsSinceJ2000;
      const x = 5 * Math.cos(de) * Math.cos(ra), y = 5 * Math.cos(de) * Math.sin(ra), z = 5 * Math.sin(de);
      pos[i * 3] = X[0] * x + Y[0] * y + Z[0] * z; pos[i * 3 + 1] = X[1] * x + Y[1] * y + Z[1] * z; pos[i * 3 + 2] = X[2] * x + Y[2] * y + Z[2] * z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  // faint and behind the stars: the brightest star clouds come out at about 13% grey
  milkyWay() {
    const tex = new THREE.TextureLoader().load('textures/milky_way.jpg');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    // always magnified at sensible fields of view, and mipmaps would draw a seam where RA wraps
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uToEq: { value: sceneToEquatorial() }, uGain: { value: 0.02 }, ...this.glare },
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, ...ADD_KEEP_ALPHA,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        #include <common>
        uniform sampler2D uMap; uniform mat3 uToEq; uniform float uGain; uniform float uDim; uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir), e = uToEq * d;
          vec2 uv = vec2(fract(0.5 - atan(e.y, e.x) / (2.0 * PI)), 0.5 + asin(clamp(e.z, -1.0, 1.0)) / PI);
          float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
          vec3 c = texture2D(uMap, uv).rgb * uGain * (1.0 - uDim * (0.4 + 0.6 * exp(-ang / 0.2)));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4, 64, 32), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  /** dim the sky for the Sun's glare: amount 0..1, direction of the Sun (world) */
  setGlare(amount, dir) { this.glare.uDim.value = amount; this.glare.uSunDir.value.copy(dir); }

  render(renderer, mainCamera, pixelRatio) {
    if (!this.visible) return;
    this.camera.quaternion.copy(mainCamera.quaternion);
    // the same projection as the main camera, including its view offset (see main.js)
    const v = mainCamera.view && mainCamera.view.enabled ? mainCamera.view : null, off = v ? v.offsetY / v.fullHeight : 0;
    if (this.camera.fov !== mainCamera.fov || this.camera.aspect !== mainCamera.aspect || this.offset !== off) {
      this.camera.fov = mainCamera.fov; this.camera.aspect = mainCamera.aspect; this.offset = off;
      if (v) this.camera.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
    }
    if (this.uniforms) this.uniforms.uPx.value = pixelRatio;
    renderer.render(this.scene, this.camera);
  }
}
