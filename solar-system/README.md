# Solar System

An interactive 3D model of the Solar System for any instant between the years 1000 and 3000.
Plain HTML, CSS and JavaScript modules: no build step, no framework. GitHub Pages serves it as-is.

## Layout

```
index.html, css/style.css
js/astro/       the physics, with no graphics:
  ephemeris.js    positions, velocities, spin axes of every body (one frame: J2000 ecliptic, km)
  satellites.js   Titan, Phobos, Deimos: orbit models fitted to JPL Horizons
  events.js       eclipse and transit search
js/data/        bodies.js: physical data and descriptions, with sources
js/scene/       three.js rendering
  scale.js        overview ↔ true-scale mapping
  bodies.js       meshes, materials, rings; per-frame update
  shaders.js      eclipse and ring shadows, lunar-eclipse reddening, rotation blur, Sun, rings
  orbits.js       osculating orbits, stored relative to each body for precision
  stars.js        Yale Bright Star Catalogue with proper motion
  view.js         camera, floating origin, focus transitions
  labels.js       labels and locator rings
js/ui/          information panel and formatting
js/main.js      state, main loop, controls
vendor/         three.js r186 (+ OrbitControls) and astronomy-engine 2.1.19, minified ES modules
data/stars.bin  9,096 BSC5 stars: RA, Dec, V, B−V, proper motion (int16 each)
tests/          accuracy checks against JPL Horizons and NASA's eclipse canon
```

## Accuracy

`node tests/run.mjs` (Node 18+, no dependencies), or open `tests/index.html` in a browser. It checks:

- every body against JPL Horizons (DE440 and satellite ephemerides) over 1800–2050
  (planets < 25″ as seen from Earth, Moon < 21 km, Galilean moons < 900 km, Titan < 850 km,
  Phobos < 20 km, Deimos < 56 km);
- the greatest-eclipse point and time of four solar eclipses (1919, 1999, 2024, 2027), all within
  5 km and 5 s of NASA's *Five Millennium Canon*;
- Saturn's ring-plane crossing of 23 Mar 2025, the Laplace resonance of Io, Europa and Ganymede,
  and Earth's rotation angle.

To regenerate the reference data or refit the satellite models:
`python3 tests/fetch_horizons.py`, then `node tests/fit-satellites.mjs …` (usage in the file header).

## Updating the vendored libraries

```
npm i three astronomy-engine esbuild
printf "export * from 'three';\nexport { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';\n" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=inline --outfile=vendor/three.min.js
npx esbuild node_modules/astronomy-engine/esm/astronomy.js --format=esm --minify --legal-comments=inline --outfile=vendor/astronomy.min.js
```
`js/scene/shaders.js` patches three.js shader chunks by name (`map_fragment`, `lights_fragment_end`,
`opaque_fragment`); check those still exist after an upgrade.

## Credits

Astronomy Engine (Don Cross, MIT) · three.js (MIT) · JPL Horizons · Yale Bright Star Catalogue (CDS) ·
planet maps from Solar System Scope (CC BY 4.0) · moon maps from USGS Astrogeology / NASA / JPL and
Pluto from NASA / JHUAPL / SwRI (public domain) · IBM Plex (OFL).
