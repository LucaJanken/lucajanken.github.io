# Solar System

An interactive 3D model of the Solar System for any instant between the years 1000 and 3000.
Plain HTML, CSS and JavaScript modules: no build step, no framework. GitHub Pages serves it as-is.

## Using it

- Time starts at the present, running at real time. The speed slider is signed and logarithmic:
  right runs forward, left backward, from real time next to the centre to years per second at the
  ends; the notch in the middle stops time (the rate reads 0×). Play/Pause keeps the chosen speed
  (shown dimmed while paused), and `R` reverses it. ◂ ▸ (or `,` `.`) step by an hour, a day, a
  calendar month or a calendar year; tapping the step between them changes it (remembered).
- The calendar button goes to a date: on phones through the system's own picker (confirming there
  applies it), on computers through a small popover with Go (or Enter; Esc closes it).
- The clock shows Local time, UTC, or Scientific (UTC with UT, TT, ΔT and the Julian Date); the
  choice is remembered. An Extrapolated tag appears outside the validated 1800–2050.
- Selecting a body glides the camera over to it without changing zoom or viewing angle (it only
  backs off if it would end up inside the body). Selecting it again flies in to a comfortable view
  of its lit side; a third time flies back out. Lock keeps the camera travelling with the
  selected body; locking again after drifting catches up with it. Axis shows its rotation axis.
- Dragging (one finger) turns the view around the focus; scroll or pinch zooms. Moving the view
  sideways (right- or shift-drag, arrow keys, two-finger drag) works only with Lock off. The phone
  menu stays open while bodies are picked from it; a planet's moon count opens its moons in the
  list. The information panel starts folded down to the body's name: tapping it opens it, and
  its – button folds it again.
- The view state, including time, speed and direction, is kept in the URL by Share view
  (`#t=…&speed=…&dir=-1…`; links without `dir` run forward).

## Layout

```
index.html, css/style.css
js/astro/       the physics, with no graphics:
  ephemeris.js    positions, velocities, spin axes, osculating orbits (one frame: J2000 ecliptic, km)
  satellites.js   Titan, Phobos, Deimos: orbit models fitted to JPL Horizons
  rotation.js     IAU rotation models of the moons (generated from NAIF pck00011)
  deltat.js       ΔT = TT − UT1 from USNO/IERS (generated)
  events.js       eclipse and transit search
js/data/        bodies.js: physical data and descriptions, with sources
js/scene/       three.js rendering
  scale.js        overview ↔ true-scale mapping; ecliptic → scene axes
  bodies.js       meshes, materials, rings, spin axis; per-frame update
  shaders.js      eclipse and ring shadows, lunar-eclipse reddening, rotation blur, regolith
                  photometry, the Sun's photosphere, rings, Earth's atmospheric glow
  glare.js        the Sun's glare, drawn in screen space
  orbits.js       osculating orbits, stored relative to each body for precision
  stars.js        Yale Bright Star Catalogue with proper motion, over the Milky Way
  view.js         camera, floating origin, focus glides, lock
  labels.js       labels
js/ui/          information panel and formatting
js/main.js      state, main loop, controls
vendor/         three.js r186 (+ OrbitControls) and astronomy-engine 2.1.19, minified ES modules
data/stars.bin  9,096 BSC5 stars: RA, Dec, V, B−V, proper motion (int16 each)
textures/       maps, 2048 × 1024 unless noted; milky_way.jpg is equirectangular in J2000 RA/Dec
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
  and Earth's rotation angle;
- ΔT against IERS values, and the moons' IAU prime meridians against the direction of their planet.

The eclipse checks use the canon's own ΔT formula, so they test geometry; the page itself uses
measured ΔT.

To regenerate the reference data or refit the satellite models:
`python3 tests/fetch_horizons.py`, then `node tests/fit-satellites.mjs …` (usage in the file header).
`python3 tests/make_deltat.py` refreshes ΔT (worth doing once a year, as measurements accumulate);
`python3 tests/make_rotation.py` rebuilds the moons' rotation models from NAIF's kernel.

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

Astronomy Engine (Don Cross, MIT) · three.js (MIT) · JPL Horizons · NASA NAIF · USNO/IERS ·
Yale Bright Star Catalogue (CDS) · Milky Way from NASA/GSFC Scientific Visualization Studio, Deep Star
Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2: ESA/Gaia/DPAC) · planet maps from Solar System Scope
(CC BY 4.0) · moon maps from USGS Astrogeology / NASA / JPL (Europa from the 500 m Voyager–Galileo
mosaic) and Pluto from NASA / JHUAPL / SwRI (public domain) · IBM Plex (OFL).

The Milky Way map was made from `milkyway_2020_4k.exr` (svs.gsfc.nasa.gov/4851): halved to
2048 × 1024, a floor of 0.002 subtracted, the 99.9th percentile (0.4) scaled to white, sRGB-encoded.
