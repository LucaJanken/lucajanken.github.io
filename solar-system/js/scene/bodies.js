// Meshes and materials for every body, and their per-frame update from the ephemeris snapshot.
import * as THREE from '../../vendor/three.min.js';
import { BODIES, BY_NAME, OCCLUDERS, URANUS_RINGS, meanRadius } from '../data/bodies.js';
import { makeShadowUniforms, patchBodyMaterial, sunMaterial, ringMaterial, atmosphereMaterial } from './shaders.js';

const TEX_DIR = 'textures/';
const C_KMS = 299792.458;
export const toScene = v => [v[0], v[2], -v[1]];     // ecliptic (x, y, z) → scene (x, up = ecliptic north, -y)

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

function uranusRingTexture() {
  // 1-D opacity profile from the measured ring radii, widths and optical depths
  const W = 4096, inner = 41000, outer = 52000, kmPx = (outer - inner) / W;
  const c = document.createElement('canvas'); c.width = W; c.height = 1;
  const g = c.getContext('2d'), img = g.createImageData(W, 1);
  for (const [r, w, tau] of URANUS_RINGS) {
    const x0 = (r - w / 2 - inner) / kmPx, x1 = (r + w / 2 - inner) / kmPx;
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
      const cover = Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0));   // fraction of the pixel
      const a = cover * (1 - Math.exp(-tau));
      const i = x * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 200;
      img.data[i + 3] = Math.min(255, img.data[i + 3] + Math.round(255 * a));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex: t, innerKm: inner, outerKm: outer };
}

// a flat ring whose uv.x runs radially from inner (0) to outer (1) edge
function ringGeometry(inner, outer) {
  const geo = new THREE.RingGeometry(inner, outer, 256, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), 0.5);
  geo.rotateX(-Math.PI / 2);   // into the local xz plane: the equator, since local y is the pole
  return geo;
}

export class BodyViews {
  constructor(scene, renderer, shared) {
    this.scene = scene;
    this.loader = new THREE.TextureLoader();
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.shared = shared;   // { shGamma: {value}, nightOn: {value} }
    this.views = {};
    for (const def of BODIES) this.views[def.name] = this.create(def);
  }

  tex(file, color = true) {
    const t = this.loader.load(TEX_DIR + file);
    t.anisotropy = this.aniso;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  create(def) {
    const group = new THREE.Group(), orient = new THREE.Group();
    group.add(orient);
    this.scene.add(group);
    const v = { def, group, orient, Rmean: meanRadius(def), k: 1, u: null, rings: null };
    const seg = def.name === 'Sun' || def.parent === 'Sun' ? [96, 64] : [64, 40];

    if (def.name === 'Sun') {
      v.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, ...seg), sunMaterial(this.tex(def.tex.map)));
      orient.add(v.mesh);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      group.add(glow);
      v.glow = glow;
      return v;
    }

    const u = makeShadowUniforms();
    u.uShGamma = this.shared.shGamma;
    v.u = u;
    const t = def.tex || {};
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    if (t.map) mat.map = this.tex(t.map);
    if (t.tint) mat.color = new THREE.Color(t.tint);
    if (t.rough) { mat.roughnessMap = this.tex(t.rough, false); mat.roughness = 1; }
    patchBodyMaterial(mat, u, { blur: !!t.map, night: t.night ? this.tex(t.night) : null, nightOn: this.shared.nightOn });
    v.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, ...seg), mat);
    v.mesh.userData.name = def.name;
    orient.add(v.mesh);

    if (t.clouds) {
      const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: this.tex(t.clouds, false), transparent: true, depthWrite: false, roughness: 1 });
      patchBodyMaterial(cm, u, {});
      v.clouds = new THREE.Mesh(new THREE.SphereGeometry(1, ...seg), cm);
      orient.add(v.clouds);
    }
    if (def.atmosphere) {
      v.atmo = new THREE.Mesh(new THREE.SphereGeometry(1, ...seg), atmosphereMaterial(def.atmosphere.color));
      orient.add(v.atmo);
    }
    if (def.rings) {
      let tex, inner, outer, albedo = 1;
      if (def.rings.procedural === 'uranus') ({ tex, innerKm: inner, outerKm: outer } = uranusRingTexture()), albedo = 0.1;
      else { tex = this.tex(def.rings.tex); inner = def.rings.innerKm; outer = def.rings.outerKm; }
      const Req = def.shape[0];
      const rm = ringMaterial(tex, true);
      rm.uniforms.uAlbedo.value = albedo;
      rm.uniforms.uReq.value = Req; rm.uniforms.uRpol.value = def.shape[2];
      v.rings = new THREE.Mesh(ringGeometry(inner / Req, outer / Req), rm);
      orient.add(v.rings);
      if (!def.rings.procedural) Object.assign(u, { uRingTex: { value: tex } }), u.uRingIn.value = inner, u.uRingOut.value = outer, u.uRingOn.value = 1;
    }
    const occ = OCCLUDERS[def.name] || [];
    u.uOccN.value = occ.length;
    u.uAtmoIdx.value = occ.findIndex(n => BY_NAME[n].atmosphere && BY_NAME[n].atmosphere.refractsUmbra);
    v.occ = occ;
    return v;
  }

  // swap in a higher-resolution map once a body fills much of the screen
  upgrade(name) {
    const v = this.views[name];
    if (v.upgraded || !v.def.tex || !v.def.tex.hires) return;
    v.upgraded = true;
    this.loader.load(TEX_DIR + v.def.tex.hires, t => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.aniso;
      const old = v.mesh.material.map; v.mesh.material.map = t; v.mesh.material.needsUpdate = true; old && old.dispose();
    });
  }

  /**
   * @param snap   ephemeris snapshot (km, ecliptic)
   * @param disp   display positions, scene units, relative to the Sun (double precision arrays)
   * @param origin display position of the floating origin
   * @param scale  DisplayScale
   * @param dtSim  simulated seconds per rendered frame (for motion blur / aliasing)
   */
  update(snap, disp, origin, scale, dtSim) {
    for (const name in this.views) {
      const v = this.views[name], def = v.def, d = disp[name];
      v.group.position.set(d[0] - origin[0], d[1] - origin[1], d[2] - origin[2]);
      const ax = snap.axes[name];
      _x.fromArray(toScene(ax.prime)); _y.fromArray(toScene(ax.pole)); _z.crossVectors(_x, _y);
      v.orient.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));

      const R = scale.size(v.Rmean), k = R / v.Rmean;
      v.k = k; v.R = R;
      v.mesh.scale.set(def.shape[0] * k, def.shape[2] * k, def.shape[1] * k);
      if (v.glow) { v.glow.scale.setScalar(R * (5 + 30 * scale.s)); continue; }
      if (v.clouds) v.clouds.scale.copy(v.mesh.scale).multiplyScalar(1.002);
      if (v.atmo) v.atmo.scale.copy(v.mesh.scale).multiplyScalar(1 + def.atmosphere.heightKm / def.shape[0]);
      if (v.rings) v.rings.scale.setScalar(def.shape[0] * k);

      // true geometry for the lighting, in km relative to this body's centre
      const me = snap.bodies[name].pos, u = v.u;
      u.uPhysScale.value = 1 / k;
      const sun = toScene([-me[0], -me[1], -me[2]]);
      u.uSunRel.value.set(sun[0], sun[1], sun[2]);
      v.occ.forEach((o, i) => {
        // Light that reaches us now passed the occluder |Δr|/c earlier, when it was a little behind
        // (38 km for the Moon, which moves at 30 km/s around the Sun). Without this, eclipses
        // would come ~35 s late and ~35 km off track: the same correction NASA's canon applies.
        const po = snap.bodies[o].pos, vo = snap.bodies[o].vel;
        const lt = Math.hypot(po[0] - me[0], po[1] - me[1], po[2] - me[2]) / C_KMS;
        const p = [po[0] - vo[0] * lt, po[1] - vo[1] * lt, po[2] - vo[2] * lt];
        const rel = toScene([p[0] - me[0], p[1] - me[1], p[2] - me[2]]);
        u.uOcc.value[i].set(rel[0], rel[1], rel[2], meanRadius(BY_NAME[o]));
      });
      if (u.uRingOn.value) u.uRingN.value.copy(_y);

      // rotation blur: fraction of a turn swept during one rendered frame
      const periodS = Math.abs((def.rotationH || def.periodD * 24) * 3600);
      const turns = Math.abs(dtSim) / periodS;
      u.uBlurU.value = Math.min(turns, 1);
      u.uBlurN.value = turns < 0.01 ? 1 : Math.min(16, 2 + Math.ceil(turns * 48));

      const sunDist = Math.hypot(...me), sunDir = new THREE.Vector3(sun[0], sun[1], sun[2]).divideScalar(sunDist);
      if (v.atmo) v.atmo.material.uniforms.uSunDir.value.copy(sunDir);
      if (v.rings) {
        const ru = v.rings.material.uniforms;
        ru.uSunDir.value.copy(sunDir); ru.uN.value.copy(_y);
        ru.uCenter.value.copy(v.group.position); ru.uKmPerUnit.value = 1 / k;
        ru.uSunAng.value = 695700 / sunDist;
      }
    }
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,240,210,0.9)');
  grd.addColorStop(0.2, 'rgba(255,214,150,0.35)');
  grd.addColorStop(0.5, 'rgba(255,180,90,0.08)');
  grd.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
