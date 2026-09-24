// Name labels and locator rings, as a DOM layer over the canvas. Labels are clickable. A body
// smaller than a few pixels gets a thin ring around its true position so it can be found, since
// in true scale almost everything is sub-pixel.

import * as THREE from '../../vendor/three.min.js';

const v3 = new THREE.Vector3(), ray = new THREE.Vector3(), oc = new THREE.Vector3();

// is the point hidden behind one of the drawn spheres (as seen from the camera)?
function occluded(cam, pos, self, spheres) {
  ray.subVectors(pos, cam);
  const L = ray.length();
  ray.divideScalar(L);
  for (const s of spheres) {
    if (s.name === self) continue;
    oc.subVectors(s.pos, cam);
    const t = oc.dot(ray);
    if (t <= 0 || t >= L) continue;
    if (oc.lengthSq() - t * t < s.R * s.R) return true;
  }
  return false;
}

export class Labels {
  constructor(layer, bodies, onPick) {
    this.layer = layer;
    this.items = {};
    for (const def of bodies) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'lbl' + (def.parent && def.parent !== 'Sun' ? ' lbl-moon' : '');
      el.textContent = def.name;
      // lightened so that dark body colours (Mars, Neptune) stay readable on the night sky
      el.style.color = `color-mix(in oklab, ${def.color} 72%, white)`;
      el.addEventListener('click', e => { e.stopPropagation(); onPick(def.name); });
      const ring = document.createElement('div');
      ring.className = 'loc';
      ring.style.borderColor = def.color;
      layer.appendChild(ring); layer.appendChild(el);
      this.items[def.name] = { def, el, ring, w: 0, shown: false };
    }
  }

  /** label widths change once the web font arrives */
  remeasure() { for (const n in this.items) this.items[n].w = 0; }

  /**
   * entries: [{ name, pos: Vector3 (world), R: drawn radius, show: bool, prio: number }]
   * blockers: [{left,right,top,bottom}] HUD rectangles to keep clear of
   */
  update(camera, W, H, entries, blockers, selected) {
    const placed = blockers.slice();
    const tanF = Math.tan(camera.fov * Math.PI / 360);
    const out = [];
    entries.sort((a, b) => b.prio - a.prio);
    for (const e of entries) {
      const it = this.items[e.name];
      v3.copy(e.pos);
      const dist = v3.distanceTo(camera.position);
      v3.project(camera);
      const onScreen = v3.z < 1 && Math.abs(v3.x) <= 1.05 && Math.abs(v3.y) <= 1.05;
      const px = (v3.x * 0.5 + 0.5) * W, py = (-v3.y * 0.5 + 0.5) * H;
      const rpx = e.R / Math.max(dist, 1e-12) * (H / 2) / tanF;
      out.push({ name: e.name, px, py, rpx, onScreen, dist });
      const hide = () => {
        if (it.shown) { it.el.style.display = 'none'; it.shown = false; }
        it.ring.style.display = 'none';
      };
      if (!onScreen || !e.show || occluded(camera.position, e.pos, e.name, entries)) { hide(); continue; }
      // locator ring for sub-pixel bodies
      if (rpx < 2.5 && e.ring) {
        it.ring.style.display = 'block';
        it.ring.style.transform = `translate(${px - 5}px, ${py - 5}px)`;
      } else it.ring.style.display = 'none';
      // a body filling the screen needs no caption across its own surface
      if (!e.label || rpx > H * 0.3) { if (it.shown) { it.el.style.display = 'none'; it.shown = false; } continue; }
      if (!it.shown) { it.el.style.display = 'block'; it.shown = true; }
      if (!it.w) it.w = it.el.offsetWidth || 60;
      const hw = it.w / 2 + 3, hh = 9;
      const baseY = py - Math.min(H * 0.4, rpx + 13);
      let ok = false, lx = px, ly = baseY;
      for (const [dx, dy] of [[0, 0], [0, 22], [0, -22], [1, 0], [-1, 0], [0, 44], [0, -44]]) {
        lx = Math.max(hw, Math.min(W - hw, px + dx * (hw + rpx + 10)));
        ly = Math.max(hh + 2, Math.min(H - hh - 2, (dx ? py : baseY) + dy));
        if (!placed.some(b => lx + hw > b.left && lx - hw < b.right && ly + hh > b.top && ly - hh < b.bottom)) { ok = true; break; }
      }
      if (!ok) { it.el.style.display = 'none'; it.shown = false; continue; }
      placed.push({ left: lx - hw, right: lx + hw, top: ly - hh, bottom: ly + hh });
      it.el.style.transform = `translate(${lx - hw + 3}px, ${ly - hh}px)`;
      it.el.classList.toggle('sel', e.name === selected);
    }
    return out;   // screen positions, reused for click picking
  }
}
