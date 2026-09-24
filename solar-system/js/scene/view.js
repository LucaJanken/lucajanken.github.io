// Camera: orbit controls around the focused body, a floating origin, smooth focus changes.
//
// Floating origin: the focused body is always at the scene origin, and everything else is placed
// relative to it (subtracted in double precision on the CPU). GPU float32 precision is therefore
// best exactly where the camera is looking, from a 10 km moon to the whole Solar System.

import * as THREE from '../../vendor/three.min.js';

const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

export class View {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new THREE.OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.2;
    this.controls.listenToKeyEvents(window);
    this.focus = 'Sun';
    this.follow = true;
    this.origin = [0, 0, 0];
    this.tween = null;
    this.controls.addEventListener('start', () => { if (this.tween && this.tween.cancelable) this.tween = null; });
  }

  distance() { return this.camera.position.distanceTo(this.controls.target); }

  /** start a smooth move: keep the viewing direction, bring the target to the origin (the focus) */
  flyTo(dist, { dir = null, ms = 1400, cancelable = true } = {}) {
    const c = this.camera, t = this.controls.target;
    this.tween = {
      t0: performance.now(), ms, cancelable,
      fromTarget: t.clone(), fromDist: this.distance(), toDist: dist,
      fromDir: c.position.clone().sub(t).normalize(), toDir: dir ? dir.clone().normalize() : null,
    };
  }

  /** change focus; the view does not jump, it flies from where it is */
  setFocus(name, disp, dist, opts) {
    const o = disp[name], old = this.origin;
    const shift = new THREE.Vector3(old[0] - o[0], old[1] - o[1], old[2] - o[2]);
    this.camera.position.add(shift); this.controls.target.add(shift);
    this.origin = o.slice();
    this.focus = name;
    this.flyTo(dist, opts);
  }

  /** scale the camera offset when the display scale changes, so the view keeps framing the same thing */
  rescale(f) {
    const t = this.controls.target;
    this.camera.position.sub(t).multiplyScalar(f).add(t.multiplyScalar(f));
    if (this.tween) { this.tween.fromDist *= f; this.tween.toDist *= f; this.tween.fromTarget.multiplyScalar(f); }
  }

  /** per frame, after display positions are known */
  update(disp, focusRadius, maxDist) {
    const o = disp[this.focus];
    const d = [o[0] - this.origin[0], o[1] - this.origin[1], o[2] - this.origin[2]];
    this.origin = o.slice();
    if (!this.follow && !this.tween) {
      // inertial camera: the world moves by -d relative to the new origin
      this.camera.position.x -= d[0]; this.camera.position.y -= d[1]; this.camera.position.z -= d[2];
      this.controls.target.x -= d[0]; this.controls.target.y -= d[1]; this.controls.target.z -= d[2];
    }
    const c = this.camera, t = this.controls.target;
    if (this.tween) {
      const tw = this.tween, k = ease((performance.now() - tw.t0) / tw.ms);
      t.copy(tw.fromTarget).multiplyScalar(1 - k);
      const dist = tw.fromDist * Math.pow(tw.toDist / tw.fromDist, k);
      const dir = tw.toDir ? tw.fromDir.clone().lerp(tw.toDir, k).normalize() : c.position.clone().sub(t).normalize();
      if (dir.lengthSq() < 0.5) dir.copy(tw.toDir || new THREE.Vector3(0, 0.4, 1)).normalize();
      c.position.copy(t).addScaledVector(dir, dist);
      if (k >= 1) this.tween = null;
    }
    const nearFocus = t.length() < focusRadius * 0.5;
    this.controls.minDistance = nearFocus ? focusRadius * 1.02 : 1e-9;
    this.controls.maxDistance = maxDist;
    this.controls.update();
    const cd = this.distance();
    // logarithmic depth buffer: a generous range costs nothing, but the near plane must stay in
    // front of the closest surface
    const near = Math.max(1e-9, (nearFocus ? cd - focusRadius : cd) * 1e-3);
    if (Math.abs(c.near / near - 1) > 0.05) { c.near = near; c.far = 1e7; c.updateProjectionMatrix(); }
  }
}
