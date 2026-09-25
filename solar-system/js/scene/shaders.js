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
uniform vec4 uOcc[4];      // occluder centre (km from this body) and equatorial radius
uniform vec4 uOccPole[4];  // occluder pole (unit) and equatorial / polar radius
uniform int uOccN;
uniform int uAtmoIdx;
uniform vec3 uAtmoLight;
uniform float uRingOn;
uniform vec3 uRingN;
uniform float uRingIn;
uniform float uRingOut;
uniform sampler2D uRingTex;

// Partial shadows are drawn a little darker than photometric, cov^0.7 instead of cov, because on a
// screen a surface at half light still looks almost fully lit and the penumbra of a solar eclipse,
// thousands of km across, would be invisible. Only the partial phase changes: where a shadow
// begins (cov = 0) and the umbra (cov = 1) are exact, so eclipse geometry and timing are not affected.
const float SH_GAMMA = 0.7;
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

// Stretch space along an occluder's pole so that the flattened planet becomes a sphere of its
// equatorial radius (Jupiter is 6.5% flatter than a sphere: with a mean radius, Io's eclipses would
// start ~90 s late and end ~90 s early). The Sun's disc is barely distorted, since eclipses happen
// with the Sun close to the occluder's equatorial plane.
vec3 omStretch(vec3 v, vec4 pk) { return v + (pk.w - 1.0) * dot(v, pk.xyz) * pk.xyz; }

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
  vec3 light = vec3(1.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uOccN) break;
    vec3 toO = omStretch(uOcc[i].xyz - p, uOccPole[i]);
    vec3 toS = omStretch(toSun, uOccPole[i]);
    float dSi = length(toS);
    vec3 nSi = toS / dSi;
    float aS = asin(clamp(uSunR / dSi, 0.0, 1.0));
    float dO = length(toO);
    if (dot(toO, nSi) <= 0.0 || dO >= dSi) continue;
    vec3 nO = toO / dO;
    float rad = uOcc[i].w;
    bool atmo = i == uAtmoIdx;
    // Earth's atmosphere makes the umbra ~2% larger than geometry alone (Danjon's 1/85 rule)
    if (atmo) rad *= 1.0118;
    float aO = asin(clamp(rad / dO, 0.0, 1.0));
    // atan2 of |cross| and dot keeps full precision for nearly aligned vectors, where acos(dot) fails
    float sep = atan(length(cross(nSi, nO)), dot(nSi, nO));
    if (sep >= aS + aO) continue;
    float cov = pow(omCover(aS, aO, sep), SH_GAMMA);
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
    uOccPole: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 1, 0, 1)) },
    uOccN: { value: 0 },
    uAtmoIdx: { value: -1 },
    uAtmoLight: { value: new THREE.Color(0.11, 0.030, 0.009) },
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
 * opts.night: uniform { value: texture } of night-side lights (added where the Sun is below the horizon)
 * opts.blur: enable rotation blur of the colour map (used when the body spins faster than the frame rate can show)
 * opts.lunar: airless regolith photometry (see below) instead of Lambert's law
 * opts.extinction: [τR, τG, τB] zenith optical depth of an atmosphere that the sunlight crosses
 */
export function patchBodyMaterial(mat, u, opts = {}) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    if (opts.night) { sh.uniforms.uNight = opts.night; sh.uniforms.uNightOn = opts.nightOn; }
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
    // Lunar–Lambert law (McEwen 1991): regolith scatters light back toward the Sun, so a full Moon
    // is evenly bright right to its limb instead of darkening like a Lambertian ball.
    //   radiance ∝ μ0 · [2L/(μ0 + μ) + (1 − L)],  L(α) = 1 − 0.019α + 2.42e-4α² − 1.46e-6α³ (α in °)
    // Lambert gives μ0 alone, so the direct light is multiplied by the bracket. μ0, μ: cosines of
    // the incidence and emission angles, α: phase angle.
    const lunar = !opts.lunar ? '' : /* glsl */`
  {
    vec3 sunV = normalize((viewMatrix * vec4(normalize(uSunRel - vOmRel), 0.0)).xyz);
    float mu0 = max(dot(normal, sunV), 0.0), mu = max(dot(normal, geometryViewDir), 0.0);
    float a = degrees(acos(clamp(dot(sunV, geometryViewDir), -1.0, 1.0)));
    float L = clamp(1.0 + a * (-0.019 + a * (2.42e-4 - 1.46e-6 * a)), 0.0, 1.0);
    reflectedLight.directDiffuse *= 2.0 * L / max(mu0 + mu, 1e-3) + (1.0 - L);
    reflectedLight.directSpecular *= 0.0;   // regolith has no glossy reflection
  }`;
    // Atmospheric extinction of the direct sunlight: at a low Sun the light crosses up to 38 air
    // masses (Kasten & Young 1989), so the terminator dims and reddens instead of staying at full
    // strength to a hard edge. Relative to an overhead Sun, because the maps already show the
    // ground as seen through one air mass.
    const ext = !opts.extinction ? '' : /* glsl */`
  {
    float cz = dot(normalize(vOmRel), normalize(uSunRel - vOmRel));
    float z = degrees(acos(clamp(cz, 0.0, 1.0)));
    float X = 1.0 / (max(cz, 0.0) + 0.50572 * pow(96.07995 - z, -1.6364));
    omLight *= exp(-vec3(${opts.extinction.map(x => x.toFixed(3)).join(', ')}) * (X - 1.0));
  }`;
    body = body.replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
  vec3 omLight = omSunlight(vOmRel);${ext}
  reflectedLight.directDiffuse *= omLight;
  reflectedLight.directSpecular *= omLight;${lunar}`);
    if (opts.night) {
      // (only once the day map has loaded: it provides the texture coordinates)
      body = body.replace('#include <opaque_fragment>', /* glsl */`
#ifdef USE_MAP
  {
    vec3 up = normalize(vOmRel);
    float sunAlt = dot(up, normalize(uSunRel - vOmRel));
    // lights fade in through civil twilight (sun 0°..-6° below the horizon)
    float night = 1.0 - smoothstep(-0.1, 0.0, sunAlt);
    // the Black Marble map also records moonlit land and sea; keep only the artificial lights
    vec3 lights = texture2D(uNight, vMapUv).rgb;
    lights *= smoothstep(0.02, 0.12, dot(lights, vec3(0.2126, 0.7152, 0.0722)));
    outgoingLight += lights * night * uNightOn * 0.6;
  }
#endif
#include <opaque_fragment>`);
    }
    sh.fragmentShader = body.replace('#include <common>', '#include <common>\n' + frag);
  };
  mat.customProgramCacheKey = () => 'om' + (opts.night ? 'N' : '') + (opts.blur ? 'B' : '') + (opts.lunar ? 'L' : '') + (opts.extinction ? 'X' + opts.extinction.join() : '');
}

// ---- Sun: the white-light photosphere ----------------------------------------------------------
//
// No surface map: in visible light the real disc is smooth apart from sunspots (not shown). What it
// does show is limb darkening, stronger and so redder toward the edge. Modelled from first
// principles: a grey atmosphere in the Eddington approximation, T⁴(τ) = ¾ Teff⁴ (τ + ⅔), seen at
// optical depth τ = ⅔μ (Eddington–Barbier), so I(μ, λ) ∝ B_λ(T(⅔μ)). At 550 nm this gives an
// edge-to-centre ratio of 0.42 (linear coefficient u ≈ 0.58; measured ≈ 0.6), weaker in red and
// stronger in blue, as observed.
const TEFF = 5772;
const CENTRE_RGB = [1.0, 0.95, 0.9];   // a 5772 K photosphere is very slightly warm white in sRGB

export function sunMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vN; varying vec3 vV;
      // hc/(λk) in kelvin for the effective wavelengths of the sRGB channels (610, 550, 465 nm)
      const vec3 X = vec3(23587.0, 26160.0, 30942.0);
      void main() {
        #include <logdepthbuf_fragment>
        float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        float T = ${TEFF.toFixed(1)} * pow(0.75 * (2.0 / 3.0 * mu + 2.0 / 3.0), 0.25);
        // Planck ratio B_λ(T) / B_λ(Teff)
        vec3 I = (exp(X / ${TEFF.toFixed(1)}) - 1.0) / (exp(X / T) - 1.0);
        gl_FragColor = vec4(vec3(${CENTRE_RGB.map(x => x.toFixed(2)).join(', ')}) * I, 1.0);
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
//
// Single Rayleigh scattering, per pixel, on the same scale as the ground's Lambert shading: radiance
// E·(1 − e^(−τX))·P(θ)/4π, with τ the blue zenith optical depth and P = ¾(1 + cos²θ). X is the air
// along the view ray in air masses: over the disc, the chord through the shell beyond the one air
// mass the day map already shows; above the limb, that of an exponential atmosphere (scale height
// 8 km) at the ray's tangent height, which keeps the limb a thin blue band instead of a white ring.
// The sunlight E has itself crossed the atmosphere to the scattering point (Kasten & Young air mass,
// the same extinction as the ground below), so the glow fades where the ground does, at the
// terminator, instead of spreading into the night side; forward scattering lights a crescent's limb.

export const SUN_INTENSITY = 3.4;   // the scene's sunlight (irradiance at normal incidence)

export function atmosphereMaterial(atmo, innerRatio) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uColor: { value: new THREE.Color(...atmo.color) },
      uTau: { value: new THREE.Vector3(...atmo.tauZenith) },
      uRin: { value: innerRatio },   // planet radius / shell radius
      uHs: { value: 8 / atmo.heightKm },   // scale height / shell thickness
      uXlimb: { value: Math.sqrt(2 * Math.PI * atmo.radiusKm / 8) },   // air masses along a ray grazing the ground
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform vec3 uSunDir;
      varying vec3 vPos; varying vec3 vCam; varying vec3 vSun;
      void main() {
        // work in the shell's own frame, where it is the unit sphere
        vPos = position;
        vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vSun = normalize(inverse(mat3(modelMatrix)) * uSunDir);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor; uniform vec3 uTau; uniform float uRin; uniform float uHs; uniform float uXlimb;
      varying vec3 vPos; varying vec3 vCam; varying vec3 vSun;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vPos - vCam), sun = normalize(vSun);
        vec3 pc = vCam - dot(vCam, d) * d;              // closest approach of the ray to the centre
        float b2 = dot(pc, pc), r2 = uRin * uRin;
        float hs = sqrt(max(1.0 - b2, 0.0));             // half chord through the shell sphere
        float X, X0;
        vec3 mid;
        if (b2 < r2) {                                   // the ray ends on the ground
          float hp = sqrt(r2 - b2);
          X = (hs - hp) / (1.0 - uRin); X0 = 1.0; mid = pc - d * 0.5 * (hs + hp);
        } else {                                         // it passes above the limb
          float hb = (sqrt(b2) - uRin) / (1.0 - uRin);  // tangent height, in shell thicknesses
          X = uXlimb * exp(-hb / uHs); X0 = 0.0; mid = pc;
        }
        // sunlight at the scattering point, after its own path through the air
        float cz = dot(normalize(mid), sun);
        float z = degrees(acos(clamp(cz, 0.0, 1.0)));
        float Xs = 1.0 / (max(cz, 0.0) + 0.50572 * pow(96.07995 - z, -1.6364));
        vec3 light = exp(-uTau * (Xs - 1.0)) * smoothstep(-0.05, 0.02, cz);
        float mu = dot(d, sun);                          // cosine of the scattering angle
        float phase = 0.75 * (1.0 + mu * mu);
        float scatter = 1.0 - exp(-uTau.b * max(X - X0, 0.0));
        vec3 glow = ${SUN_INTENSITY.toFixed(2)} / (4.0 * PI) * uColor * scatter * light * phase;
        gl_FragColor = vec4(glow, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
