// The Sun's glare: what an eye or a camera exposed for the planets does with a source ~10¹⁰ times
// brighter. Drawn in screen space over the finished picture, and sized in pixels relative to the
// Sun's drawn disc:
//   bloom  a rim of light hugging the limb, a few percent of the disc radius wide, at every size;
//   halo   a soft glow and a wide faint veil, with four faint diffraction spikes, while the disc is
//          small on screen. It fades out as the disc grows, so a close or telescope view (the Sun
//          seen through a filter) keeps its limb darkening and the planets crossing it.
// It lights only empty sky (the quad sits at the far plane and is depth tested), never the disc or a
// body in front of it, and the whole glare scales with the fraction of the disc not hidden by one.

// Add colour but leave alpha alone: the canvas is transparent over the page's sky gradient, and
// writing alpha would paint that sky black wherever something is added.
export const ADD_KEEP_ALPHA = {
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
};

import * as THREE from '../../vendor/three.min.js';

export class SunGlare {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      uSun: { value: new THREE.Vector2() },   // Sun centre, device pixels
      uR: { value: 1 },                       // disc radius, CSS pixels
      uPx: { value: 1 },                      // device pixel ratio
      uHalo: { value: 1 },                    // 0..1: how much of the wide glare to show
      uVis: { value: 1 },                     // visible fraction of the disc
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthTest: true, depthWrite: false, ...ADD_KEEP_ALPHA,
      vertexShader: /* glsl */`void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec2 uSun; uniform float uR; uniform float uPx; uniform float uHalo; uniform float uVis;
        void main() {
          vec2 q = (gl_FragCoord.xy - uSun) / uPx;
          // Full strength right up to the limb: the depth test already confines the glare to sky,
          // per antialiasing sample, so a pixel on the edge blends the limb with the glare beside
          // it. Fading the glare in there instead left those pixels darker than both, a dark ring
          // (several device pixels wide on a phone).
          float x = max(length(q) - uR, 0.0);
          // display values (added to the finished sRGB picture, so no colour-space conversion)
          // once the disc is large its limb is visibly darker (limb darkening): the rim of bloom must
          // stay below it, or it reads as a white outline
          float bloom = (0.12 + 0.33 * uHalo) * exp(-x / (2.0 + 0.05 * uR));
          float halo = 0.25 * exp(-x / (8.0 + 0.8 * uR)) + 0.05 / (1.0 + pow(x / (40.0 + 2.0 * uR), 2.0));
          float a = atan(q.y, q.x) + 0.35;
          float spikes = 0.10 * pow(abs(cos(2.0 * a)), 600.0) * exp(-x / (40.0 + 3.0 * uR));
          float I = (bloom + uHalo * (halo + spikes)) * uVis;
          gl_FragColor = vec4(vec3(1.0, 0.96, 0.88) * I, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.on = false;
    this.halo = 0; this.vis = 0; this.dir = new THREE.Vector3();   // for dimming the stars
  }

  /**
   * @param sunPos  Sun's position in the scene; R its drawn radius
   * @param occluders [{ pos: Vector3, R, visible }] spheres that can hide it
   */
  update(camera, sunPos, R, W, H, pixelRatio, occluders) {
    const v = _v.copy(sunPos).project(camera);
    const d = camera.position.distanceTo(sunPos), tanF = Math.tan(camera.fov * Math.PI / 360);
    // radius of the silhouette: a sphere seen from close by looks wider than R/d
    const rpx = R / Math.sqrt(Math.max(d * d - R * R, 1e-24)) * (H / 2) / tanF;
    const x = (v.x * 0.5 + 0.5) * W, y = (v.y * 0.5 + 0.5) * H;
    // behind the camera, or so far off screen that not even the glare reaches in
    const reach = 150 + 3 * rpx;
    this.on = v.z < 1 && x > -reach && x < W + reach && y > -reach && y < H + reach;
    if (!this.on) { this.vis = 0; return; }
    this.vis = visibleFraction(camera, sunPos, R, occluders);
    this.on = this.vis > 0.001;
    this.halo = Math.max(0, Math.min(1, (90 - rpx) / 60));
    this.dir.copy(sunPos).sub(camera.position).normalize();
    const u = this.uniforms;
    u.uSun.value.set(x * pixelRatio, y * pixelRatio);
    u.uR.value = rpx; u.uPx.value = pixelRatio; u.uHalo.value = this.halo; u.uVis.value = this.vis;
  }

  render(renderer) { if (this.on) renderer.render(this.scene, this.camera); }
}

// fraction of the Sun's disc not hidden by the drawn spheres, sampled at the centre and two rings
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _ray = new THREE.Vector3(), _oc = new THREE.Vector3(), _t = new THREE.Vector3();
function visibleFraction(camera, sunPos, R, occluders) {
  const cam = camera.position;
  _ray.subVectors(sunPos, cam).normalize();
  _u.set(0, 1, 0).cross(_ray); if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0).cross(_ray);
  _u.normalize(); _w.crossVectors(_ray, _u);
  let seen = 0, n = 0;
  for (const [rr, k] of [[0, 1], [0.5, 6], [0.9, 8]]) {
    for (let i = 0; i < k; i++) {
      const a = 2 * Math.PI * i / k;
      _s.copy(sunPos).addScaledVector(_u, R * rr * Math.cos(a)).addScaledVector(_w, R * rr * Math.sin(a));
      n++;
      if (!hidden(cam, _s, occluders)) seen++;
    }
  }
  return seen / n;
}
function hidden(cam, p, occluders) {
  _oc.subVectors(p, cam);
  const L = _oc.length(), dir = _oc.divideScalar(L);
  for (const o of occluders) {
    if (!o.visible) continue;
    const t = _t.subVectors(o.pos, cam).dot(dir);
    if (t <= 0 || t >= L) continue;
    if (_t.lengthSq() - t * t < o.R * o.R) return true;
  }
  return false;
}
