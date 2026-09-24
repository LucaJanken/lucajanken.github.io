// GLSL for physically computed sunlight: eclipses, ring shadows, night lights, rotation blur.
//
// Shadows are not shadow maps. For every fragment we compute how much of the Sun's disc each
// occluder hides, from the true angular radii and separations, in the true (km) geometry, whatever
// display scale is chosen. So the eclipse on Earth's surface is at its real place and size even when
// the Moon is drawn at an exaggerated distance.

import * as THREE from '../../vendor/three.min.js';

// The solar disc is limb darkened, I(μ) = 1 − u(1 − μ) with u ≈ 0.6 in visible light (Cox 2000).
// It is represented as K nested uniform discs whose weights reproduce that profile annulus by
// annulus, so partial phases dim in the right way (a uniform disc overstates the light loss at 2nd
// and 3rd contact).
const K = 6, U_LD = 0.6;
const I = k => { const r = (k - 0.5) / K; return 1 - U_LD * (1 - Math.sqrt(1 - r * r)); };
const LD_W = Array.from({ length: K }, (_, k) => I(k + 1) - (k + 1 < K ? I(k + 2) : 0));

const COMMON = /* glsl */`
varying vec3 vOmRel;
uniform vec3 uSunRel;
uniform float uSunR;
uniform vec4 uOcc[4];
uniform int uOccN;
uniform int uAtmoIdx;
uniform vec3 uAtmoLight;
uniform float uShGamma;
uniform float uRingOn;
uniform vec3 uRingN;
uniform float uRingIn;
uniform float uRingOut;
uniform sampler2D uRingTex;

const float OM_W[${K}] = float[${K}](${LD_W.map(w => w.toFixed(8)).join(', ')});

// overlap area of two discs of radii R, r at centre distance d (flat-sky, angles in radians)
float omLens(float R, float r, float d) {
  if (d >= R + r) return 0.0;
  if (d <= abs(R - r)) { float m = min(R, r); return PI * m * m; }
  float R2 = R * R, r2 = r * r, d2 = d * d;
  float a1 = acos(clamp((d2 + R2 - r2) / (2.0 * d * R), -1.0, 1.0));
  float a2 = acos(clamp((d2 + r2 - R2) / (2.0 * d * r), -1.0, 1.0));
  return R2 * (a1 - 0.5 * sin(2.0 * a1)) + r2 * (a2 - 0.5 * sin(2.0 * a2));
}

// fraction of the limb-darkened Sun's light hidden by a disc of angular radius r at separation d
float omCover(float Rs, float r, float d) {
  float hidden = 0.0, total = 0.0;
  for (int k = 0; k < ${K}; k++) {
    float Rk = Rs * float(k + 1) / ${K}.0;
    hidden += OM_W[k] * omLens(Rk, r, d);
    total += OM_W[k] * PI * Rk * Rk;
  }
  return hidden / total;
}

// Direct sunlight reaching point p (km from the body's centre, world axes), as an RGB factor.
vec3 omSunlight(vec3 p) {
  vec3 toSun = uSunRel - p;
  float dS = length(toSun);
  vec3 nS = toSun / dS;
  float aS = asin(clamp(uSunR / dS, 0.0, 1.0));
  vec3 light = vec3(1.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uOccN) break;
    vec3 toO = uOcc[i].xyz - p;
    float dO = length(toO);
    if (dot(toO, nS) <= 0.0 || dO >= dS) continue;
    vec3 nO = toO / dO;
    float rad = uOcc[i].w;
    bool atmo = i == uAtmoIdx;
    // Earth's atmosphere makes the umbra ~2% larger than geometry alone (Danjon's 1/85 rule)
    if (atmo) rad *= 1.0118;
    float aO = asin(clamp(rad / dO, 0.0, 1.0));
    // atan2 of |cross| and dot keeps full precision for nearly aligned vectors, where acos(dot) fails
    float sep = atan(length(cross(nS, nO)), dot(nS, nO));
    if (sep >= aS + aO) continue;
    float cov = pow(omCover(aS, aO, sep), uShGamma);
    // inside Earth's umbra the Moon is lit only by sunlight refracted through Earth's atmosphere,
    // which is reddened by Rayleigh scattering: the copper "blood moon"
    vec3 through = atmo ? uAtmoLight : vec3(0.0);
    light *= vec3(1.0 - cov) + cov * through;
  }
  if (uRingOn > 0.5) {
    // shadow of a ring system in the planet's equatorial plane: follow the ray toward the Sun to
    // the ring plane and attenuate by the ring's slant optical depth there
    float dn = dot(nS, uRingN);
    if (abs(dn) > 1e-5) {
      float t = -dot(p, uRingN) / dn;
      if (t > 0.0) {
        float rho = length(p + t * nS);
        if (rho > uRingIn && rho < uRingOut) {
          float a0 = texture2D(uRingTex, vec2((rho - uRingIn) / (uRingOut - uRingIn), 0.5)).a;
          light *= pow(max(1.0 - a0, 1e-4), 1.0 / abs(dn));
        }
      }
    }
  }
  return light;
}
`;

export function makeShadowUniforms() {
  return {
    uSunRel: { value: new THREE.Vector3() },
    uSunR: { value: 695700 },
    uOcc: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    uOccN: { value: 0 },
    uAtmoIdx: { value: -1 },
    uAtmoLight: { value: new THREE.Color(0.11, 0.030, 0.009) },
    uShGamma: { value: 1.0 },
    uRingOn: { value: 0 },
    uRingN: { value: new THREE.Vector3(0, 1, 0) },
    uRingIn: { value: 0 },
    uRingOut: { value: 1 },
    uRingTex: { value: null },
    uPhysScale: { value: 1 },
    uBlurU: { value: 0 },
    uBlurN: { value: 1 },
  };
}

/**
 * Patch a MeshStandardMaterial so its direct sunlight is computed by omSunlight().
 * opts.night: texture of night-side lights (added where the Sun is below the horizon)
 * opts.blur: enable rotation blur of the colour map (used when the body spins faster than the frame rate can show)
 */
export function patchBodyMaterial(mat, u, opts = {}) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    if (opts.night) { sh.uniforms.uNight = { value: opts.night }; sh.uniforms.uNightOn = opts.nightOn; }
    sh.vertexShader = 'varying vec3 vOmRel;\nuniform float uPhysScale;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vOmRel = mat3(modelMatrix) * transformed * uPhysScale;');
    let frag = COMMON + 'uniform float uBlurU;\nuniform int uBlurN;\n';
    if (opts.night) frag += 'uniform sampler2D uNight;\nuniform float uNightOn;\n';
    let body = sh.fragmentShader;
    if (opts.blur) {
      // average the map over the longitude swept during one frame: what a camera with a
      // frame-long exposure would record, instead of a strobing texture
      body = body.replace('#include <map_fragment>', /* glsl */`
#ifdef USE_MAP
  vec4 sampledDiffuseColor;
  if (uBlurN <= 1) sampledDiffuseColor = texture2D(map, vMapUv);
  else {
    sampledDiffuseColor = vec4(0.0);
    for (int k = 0; k < 16; k++) {
      if (k >= uBlurN) break;
      float f = (float(k) + 0.5) / float(uBlurN) - 0.5;
      sampledDiffuseColor += texture2D(map, vMapUv + vec2(f * uBlurU, 0.0));
    }
    sampledDiffuseColor /= float(uBlurN);
  }
  diffuseColor *= sampledDiffuseColor;
#endif`);
    }
    body = body.replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
  vec3 omLight = omSunlight(vOmRel);
  reflectedLight.directDiffuse *= omLight;
  reflectedLight.directSpecular *= omLight;`);
    if (opts.night) {
      body = body.replace('#include <opaque_fragment>', /* glsl */`
  {
    vec3 up = normalize(vOmRel);
    float sunAlt = dot(up, normalize(uSunRel - vOmRel));
    // lights fade in through civil twilight (sun 0°..-6° below the horizon)
    float night = smoothstep(0.0, -0.1, sunAlt);
    outgoingLight += texture2D(uNight, vMapUv).rgb * night * uNightOn * 0.6;
  }
#include <opaque_fragment>`);
    }
    sh.fragmentShader = body.replace('#include <common>', '#include <common>\n' + frag);
  };
  mat.customProgramCacheKey = () => 'om' + (opts.night ? 'N' : '') + (opts.blur ? 'B' : '');
}

// ---- Sun: textured, limb darkened, unlit ----------------------------------------------------

export function sunMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D map;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        vec3 c = texture2D(map, vUv).rgb * 1.25 * (1.0 - ${U_LD.toFixed(2)} * (1.0 - mu));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ---- rings: slant optical depth, lit and unlit faces, the planet's shadow --------------------

export function ringMaterial(tex, planetShadow) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTex: { value: tex },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },   // unit vector toward the Sun (world)
      uN: { value: new THREE.Vector3(0, 1, 0) },        // ring-plane normal (world)
      uCenter: { value: new THREE.Vector3() },          // planet centre (world, display units)
      uKmPerUnit: { value: 1 },
      uReq: { value: 60268 }, uRpol: { value: 54364 },  // planet radii, km
      uSunAng: { value: 0.001 },                        // Sun's angular radius at the planet
      uAlbedo: { value: 1 },
      uPlanetShadow: { value: planetShadow ? 1 : 0 },
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uTex; uniform vec3 uSunDir; uniform vec3 uN; uniform vec3 uCenter;
      uniform float uKmPerUnit; uniform float uReq; uniform float uRpol; uniform float uSunAng;
      uniform float uAlbedo; uniform float uPlanetShadow;
      varying vec2 vUv; varying vec3 vW;
      void main() {
        #include <logdepthbuf_fragment>
        vec4 t = texture2D(uTex, vec2(vUv.x, 0.5));
        float a0 = t.a;                                   // opacity seen face-on
        if (a0 < 0.002) discard;
        vec3 V = normalize(cameraPosition - vW);
        float muV = max(abs(dot(V, uN)), 0.02), muS = max(abs(dot(uSunDir, uN)), 0.002);
        float tr = max(1.0 - a0, 1e-4);
        float alpha = 1.0 - pow(tr, 1.0 / muV);            // slant path through the ring
        bool litFace = dot(V, uN) * dot(uSunDir, uN) > 0.0;
        // Radiance of a thin slab of particles (single scattering). Lit face: light reflected back,
        // ∝ μ0/(μ0+μ)·(1 − T^(1/μ0 + 1/μ)), normalised to 1 for an opaque ring seen and lit face-on.
        // Far face: light diffusely transmitted through the layer, bright only where the ring is
        // semi-transparent (the C ring and Cassini Division glow, the dense B ring goes dark).
        float R = litFace
          ? 2.0 * muS / (muS + muV) * (1.0 - pow(tr, 1.0 / muS + 1.0 / muV))
          : 1.4 * a0 * (1.0 - a0) * (1.0 - pow(tr, 1.0 / muS));
        // blending multiplies by alpha, so divide it out to display radiance R
        float b = R / max(alpha, 1e-3);
        // shadow of the (oblate) planet on the rings, with a penumbra from the Sun's disc
        if (uPlanetShadow > 0.5) {
          vec3 p = (vW - uCenter) * uKmPerUnit;
          float pn = dot(p, uN), dn = dot(uSunDir, uN);
          vec3 ps = (p - pn * uN) / uReq + uN * (pn / uRpol);
          vec3 ds = (uSunDir - dn * uN) / uReq + uN * (dn / uRpol);
          float tca = -dot(ps, ds) / dot(ds, ds);
          if (tca > 0.0) {
            float miss = length(ps + tca * ds);
            float w = uSunAng * tca * length(ds) + 1e-4;
            b *= smoothstep(1.0 - w, 1.0 + w, miss);
          }
        }
        gl_FragColor = vec4(t.rgb * b * uAlbedo, alpha);
        #include <colorspace_fragment>
      }`,
  });
}

// ---- thin atmosphere limb glow (Earth) --------------------------------------------------------

export function atmosphereMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uColor: { value: new THREE.Color(...color) } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vWN;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vWN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSunDir; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vV; varying vec3 vWN;
      void main() {
        #include <logdepthbuf_fragment>
        float rim = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 4.0);
        float lit = smoothstep(-0.25, 0.35, dot(vWN, uSunDir));
        gl_FragColor = vec4(uColor * rim * lit * 0.9, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
