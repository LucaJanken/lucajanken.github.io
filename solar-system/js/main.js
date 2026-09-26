// Solar System: app state, main loop and controls.
import * as THREE from '../vendor/three.min.js';
import { snapshot, AU_KM } from './astro/ephemeris.js';
import { upcomingEvents } from './astro/events.js';
import { DT_MEASURED_UNTIL } from './astro/deltat.js';
import { BODIES, BY_NAME, meanRadius } from './data/bodies.js';
import { DisplayScale, toScene } from './scene/scale.js';
import { BodyViews } from './scene/bodies.js';
import { Orbits } from './scene/orbits.js';
import { Stars } from './scene/stars.js';
import { View } from './scene/view.js';
import { Labels } from './scene/labels.js';
import { SunGlare } from './scene/glare.js';
import { SUN_INTENSITY } from './scene/shaders.js';
import { InfoPanel } from './ui/info.js';
import { fmtDate, fmtTime, tzName, localInput, parseLocalInput, civil, fmtRate } from './ui/format.js';

const $ = id => document.getElementById(id);
const DAY_MS = 86400000;
// 1 Jan 1000 in the Julian calendar (6 Jan proleptic Gregorian) to 31 Dec 2999
const MIN_MS = Date.UTC(1000, 0, 6), MAX_MS = Date.UTC(2999, 11, 31, 23, 59);
const VALID_FROM = Date.UTC(1800, 0, 1), VALID_TO = Date.UTC(2051, 0, 1);
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// The speed slider is signed and logarithmic: its value is ±(NOTCH + log10 |rate|), and the notch
// in the middle, |value| < NOTCH, stops time. Just outside the notch runs at real time.
const SPEED_MAX = 8.2, NOTCH = 0.7;

// ---------------------------------------------------------------- state
const state = {
  simMs: Date.now(),
  playing: !REDUCED_MOTION,
  speed: 0,          // log10 |simulated seconds per real second|: 0 is real time
  dir: 1,            // +1 forward, −1 backward
  parked: false,     // stopped by the speed slider's notch (so the slider shows 0, not the last rate)
  show: { orbits: true, labels: true, moons: true, stars: true, axis: true },
  scaleTarget: 0,
  selected: 'Sun',
};

// ---------------------------------------------------------------- renderer and scene
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.autoClear = false;
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 1e-6, 1e7);
const DEFAULT_FOV = 45;

// The Sun is the only light, so night sides are black, as a camera exposed for daylight sees them.
// Decay 0 keeps distant worlds visible (see the guide).
const sunLight = new THREE.PointLight(0xfff6ea, SUN_INTENSITY, 0, 0);
scene.add(sunLight);

const grid = new THREE.PolarGridHelper(1, 12, 8, 128, 0x2a3346, 0x1b2130);
grid.material.transparent = true; grid.material.depthWrite = false;
scene.add(grid);

const shared = { nightOn: { value: 1 } };
const scale = new DisplayScale();
const bodies = new BodyViews(scene, renderer, shared);
const orbits = new Orbits(scene);
const stars = new Stars();
const glare = new SunGlare();
const view = new View(camera, renderer.domElement);
const info = new InfoPanel();
const labels = new Labels($('labels'), BODIES, name => select(name, true), () => updateHover());

// ---------------------------------------------------------------- display positions
let snap = null, snapMs = NaN, disp = {};
// the ephemeris at the displayed time, recomputed only when the time changes
function refreshSnap() { if (snapMs !== state.simMs) { snap = snapshot(state.simMs); snapMs = state.simMs; } }
function computeDisplay() {
  disp = { Sun: [0, 0, 0] };
  for (const b of BODIES) {
    if (b.parent !== 'Sun') continue;
    const p = toScene(snap.bodies[b.name].pos), r = Math.hypot(...p), k = scale.helio(r) / r;
    disp[b.name] = [p[0] * k, p[1] * k, p[2] * k];
  }
  for (const b of BODIES) {
    if (!b.parent || b.parent === 'Sun') continue;
    const rel = toScene(snap.bodies[b.name].rel.pos), r = Math.hypot(...rel);
    const k = scale.moon(b.name, b.parent, meanRadius(BY_NAME[b.parent]), r) / r, pp = disp[b.parent];
    disp[b.name] = [pp[0] + rel[0] * k, pp[1] + rel[1] * k, pp[2] + rel[2] * k];
  }
}
// orbit samples (km, scene axes, relative to the body's primary) → display offsets from the body
// itself: centre + p · radial(|p|) / |p|, as computeDisplay places the body
function orbitMapping(name) {
  const def = BY_NAME[name], me = disp[name];
  if (def.parent === 'Sun') return { centre: [-me[0], -me[1], -me[2]], radial: r => scale.helio(r) };
  const pp = disp[def.parent], R = meanRadius(BY_NAME[def.parent]);
  return { centre: [pp[0] - me[0], pp[1] - me[1], pp[2] - me[2]], radial: r => scale.moon(name, def.parent, R, r) };
}
const drawnRadius = name => scale.size(meanRadius(BY_NAME[name]));
const overviewDistance = () => 2.1 * scale.helio(30.1 * AU_KM);
// largest drawn radius (equatorial, for flattened planets)
const drawnExtent = name => { const d = BY_NAME[name]; return drawnRadius(name) * Math.max(...d.shape) / meanRadius(d); };
const focusDistance = name => name === 'Sun' ? overviewDistance() : closeDistance(name);
// A comfortable distance to look at a body from: it spans about 40% of the narrower side of the
// part of the screen the panels leave free (so a phone held upright does not crop it), Saturn's
// rings included.
function closeDistance(name) {
  const d = BY_NAME[name], W = stage.clientWidth || 1, H = stage.clientHeight || 1;
  const extent = Math.max(drawnExtent(name), d.rings && d.rings.outerKm ? drawnRadius(name) * d.rings.outerKm / meanRadius(d) : 0);
  const side = Math.min(W, H, free.bottom - free.top);
  return extent / Math.sin(Math.atan(0.4 * Math.tan(DEFAULT_FOV * Math.PI / 360) * side / H));
}
// The viewing direction for that close look: the user's own, turned toward the Sun just enough that
// the body is seen at most 60° from full phase (three quarters lit) rather than as a dark disc.
const MAX_PHASE = Math.PI / 3;
function litSide(name) {
  if (name === 'Sun') return null;
  const s = new THREE.Vector3(...disp[name]).negate().normalize();
  const c = camera.position.clone().sub(view.controls.target).normalize(), cos = c.dot(s);
  if (cos >= Math.cos(MAX_PHASE)) return c;
  const perp = c.addScaledVector(s, -cos);
  // straight from behind: come round over the body's north side of the ecliptic
  if (perp.lengthSq() < 1e-6) perp.set(0, 1, 0).addScaledVector(s, -s.y);
  return s.multiplyScalar(Math.cos(MAX_PHASE)).addScaledVector(perp.normalize(), Math.sin(MAX_PHASE));
}

// On phones the clock covers the top of the screen and the information panel and time controls
// the lower half, right where the focused body would be. The projection is shifted (a view offset,
// so orbiting still turns about the body) to put the focus in the middle of the part left free.
const free = { top: 0, bottom: Infinity };
let viewShift = 0, shiftTarget = 0, shiftApplied = null;
function measureFree() {
  const W = stage.clientWidth, H = stage.clientHeight, cx = W / 2;
  free.top = 0; free.bottom = H;
  for (const el of [document.querySelector('header.time'), $('info'), document.querySelector('.timectl')]) {
    if (!el.offsetParent) continue;
    const r = el.getBoundingClientRect();
    // only panels across the middle of the screen are in the way (the desktop layout keeps to the sides)
    if (r.left > cx || r.right < cx) continue;
    if (r.top < H / 2 && r.bottom < H * 0.4) free.top = Math.max(free.top, r.bottom);
    else free.bottom = Math.min(free.bottom, r.top);
  }
  if (free.bottom - free.top < H * 0.2) { free.top = 0; free.bottom = H; }
  shiftTarget = H / 2 - (free.top + free.bottom) / 2;
}
function applyShift(dt) {
  const W = stage.clientWidth, H = stage.clientHeight;
  viewShift += (shiftTarget - viewShift) * Math.min(1, dt * 8);
  if (Math.abs(shiftTarget - viewShift) < 0.5) viewShift = shiftTarget;
  const key = W + 'x' + H + ':' + viewShift.toFixed(1);
  if (key === shiftApplied) return;
  shiftApplied = key;
  if (Math.abs(viewShift) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(W, H, 0, viewShift, W, H);
}

// ---------------------------------------------------------------- selection and focus
function select(name, fly) {
  wake();
  const again = name === state.selected;
  state.selected = name;
  openSystems.add(systemOf(name));
  info.show(name);
  info.update(snap);
  paintList();
  if (fly) {
    camera.fov = DEFAULT_FOV; camera.updateProjectionMatrix();
    const R = drawnExtent(name);
    if (again) closeLook(name);
    // otherwise only the target moves; zoom and angle stay the user's, unless the camera would be inside the body
    else view.setFocus(name, disp, { minDist: R * 1.2, safeDist: R * 3 });
  }
  bodies.setAxis(name);
  hudDirty = true;
}

// Choosing the selected body again flies in to a comfortable view of it, from its lit side; once
// there, choosing it again flies back out to where the camera was before (or to the distance of the
// overview, if that was about as close).
let zoomBack = null;   // { name, dist }: the distance to return to
function closeLook(name) {
  const close = closeDistance(name), d = view.distance();
  if (view.focus === name && d < close * 1.5) {
    const back = zoomBack && zoomBack.name === name && zoomBack.dist > close * 2 ? zoomBack.dist : Math.max(overviewDistance(), close * 4);
    zoomBack = null;
    view.setFocus(name, disp, { dist: back });
  } else {
    zoomBack = { name, dist: d };
    view.setFocus(name, disp, { dist: close, dir: litSide(name) });
  }
}

// ---------------------------------------------------------------- scale changes
let scaleAnim = null;
function setScale(s, animate = true) {
  wake();
  s = Math.max(0, Math.min(1, s));
  state.scaleTarget = s;
  if (animate && !REDUCED_MOTION) scaleAnim = { from: scale.s, to: s, t0: performance.now(), ms: 2200 };
  else { scaleAnim = null; applyScale(s); }
}
// keep the camera framing the same thing while every length changes
function applyScale(s) {
  const f = view.focus, cd = view.distance();
  const before = { r: drawnRadius(f), d: helioInverse(cd) };
  scale.s = s;
  let factor;
  if (f !== 'Sun' && cd < 12 * before.r) factor = drawnRadius(f) / before.r;
  else factor = scale.helio(before.d) / cd;
  if (Number.isFinite(factor) && factor > 0) { view.rescale(factor); if (zoomBack) zoomBack.dist *= factor; }
  $('scale').value = s;
  $('scaleMin').classList.toggle('on', s === 0);
  $('scaleMax').classList.toggle('on', s === 1);
}
// heliocentric distance (km) whose drawn distance is `units`, at the current scale
function helioInverse(units) {
  let lo = 1e3, hi = 1e12;
  for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (scale.helio(m) < units) lo = m; else hi = m; }
  return Math.sqrt(lo * hi);
}

// ---------------------------------------------------------------- time
function setTime(ms, { pause = false } = {}) {
  state.simMs = Math.max(MIN_MS, Math.min(MAX_MS, ms));
  if (pause) state.playing = false;
  hudDirty = true;
  wake();
}
const setRate = () => state.dir * Math.pow(10, state.speed);   // the rate while playing
const rate = () => state.playing ? setRate() : 0;
function setSpeed(x) { state.speed = Math.max(0, Math.min(SPEED_MAX, +x.toFixed(2))); state.parked = false; hudDirty = true; }
// the time step of the ◂ ▸ buttons (and , .): calendar months and years keep the day and time
const STEPS = [
  { label: '1 h', name: 'hour', ms: 3600000 }, { label: '1 d', name: 'day', ms: DAY_MS },
  { label: '1 mo', name: 'month', months: 1 }, { label: '1 yr', name: 'year', months: 12 },
];
let step = STEPS[1];
try { step = STEPS.find(s => s.name === localStorage.getItem('solarSystem.step')) || step; } catch {}
function stepTime(sign) {
  if (step.ms) return setTime(state.simMs + sign * step.ms);
  // in UTC, clamped to the length of the month (31 Jan + 1 month is 28 or 29 Feb)
  const d = new Date(state.simMs), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + sign * step.months);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  setTime(d.getTime());
}
function setStep(s) {
  step = s;
  try { localStorage.setItem('solarSystem.step', s.name); } catch {}
  $('stepBtn').textContent = s.label;
  $('stepBtn').setAttribute('aria-label', `Step: one ${s.name}. Change`);
  $('backBtn').title = `Back one ${s.name} ( , )`; $('backBtn').setAttribute('aria-label', $('backBtn').title);
  $('fwdBtn').title = `Forward one ${s.name} ( . )`; $('fwdBtn').setAttribute('aria-label', $('fwdBtn').title);
}
function setPlaying(on) { state.playing = on; if (on) state.parked = false; hudDirty = true; }

// ---------------------------------------------------------------- main loop
let last = performance.now(), lastHud = 0, hudDirty = true, frameDt = 1 / 60, whenStaged = false;
let hudBoxes = null, screenPos = [];
// Render on demand: while time is paused and nobody interacts, nothing changes on screen, so an
// idle page draws nothing (laptop and phone batteries). Input, loads and state changes wake it.
let wakeUntil = performance.now() + 3000;
function wake(ms = 1500) { wakeUntil = Math.max(wakeUntil, performance.now() + ms); }
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = (now - last) / 1000, dt = Math.min(0.1, elapsed);
  last = now;
  const active = state.playing || view.tween || scaleAnim || now < wakeUntil || viewShift !== shiftTarget;
  if (!active) {
    if (hudDirty) { lastHud = now; hudDirty = false; updateHud(); }
    return;
  }
  frameDt = frameDt * 0.9 + dt * 0.1;
  // At real time the clock keeps pace with the wall clock, also across slow frames and a hidden
  // tab (no frames at all); faster rates are capped so that a hiccup cannot skip years.
  const dtSim = rate() * (Math.abs(rate()) <= 1 ? elapsed : dt);
  if (dtSim) {
    const next = state.simMs + dtSim * 1000;
    if (next <= MIN_MS || next >= MAX_MS) { state.playing = false; toast('The model covers the years 1000–3000.'); }
    state.simMs = Math.max(MIN_MS, Math.min(MAX_MS, next));
  }

  refreshSnap();
  if (scaleAnim) {
    const k = Math.min(1, (now - scaleAnim.t0) / scaleAnim.ms), e = k * k * (3 - 2 * k);
    // interpolate in the exponent, so the morph looks even across the ~5 decades of change
    applyScale(scaleAnim.from + (scaleAnim.to - scaleAnim.from) * e);
    if (k >= 1) scaleAnim = null;
  }
  computeDisplay();
  view.update(disp, drawnExtent(view.focus), 3.2 * scale.helio(50 * AU_KM));
  applyShift(dt);
  // OrbitControls turns the camera with lookAt, which leaves the view matrix one orientation
  // behind until the render; the labels, picking and glare below project with it
  camera.updateMatrixWorld();
  const origin = view.origin;
  // simulated time per rendered frame, for rotation blur and to hide bodies that would strobe
  const perFrame = rate() * frameDt;
  bodies.update(snap, disp, origin, scale, perFrame);
  for (const def of BODIES) {
    const v = bodies.views[def.name];
    const isMoon = def.parent && def.parent !== 'Sun';
    const tooFast = def.periodD && Math.abs(perFrame) / (def.periodD * 86400) > 0.1;
    v.group.visible = !(isMoon && !state.show.moons) && !tooFast;
    v.tooFast = tooFast;
  }
  // display positions depend only on the time and the scale, so camera moves reuse the lines
  orbits.update(snap, disp, origin, n => state.show.orbits && (state.show.moons || BY_NAME[n].parent === 'Sun'), orbitMapping, state.simMs + '/' + scale.s);
  sunLight.position.set(-origin[0], -origin[1], -origin[2]);

  const gridR = scale.helio(31 * AU_KM);
  grid.position.set(-origin[0], -origin[1], -origin[2]);
  grid.scale.setScalar(gridR);
  const camD = view.distance();
  grid.material.opacity = state.show.orbits ? 0.3 * Math.max(0, Math.min(1, (camD / gridR - 0.15) / 0.3)) : 0;
  grid.visible = grid.material.opacity > 0.01;

  stars.setEpoch((snap.tt) / 365.25);
  stars.visible = state.show.stars;

  // labels (and screen positions for picking)
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!hudBoxes) {
    hudBoxes = [...document.querySelectorAll('[data-hud]')].filter(e => e.offsetParent).map(e => {
      const r = e.getBoundingClientRect(); return { left: r.left - 4, right: r.right + 4, top: r.top - 4, bottom: r.bottom + 4 };
    });
    measureFree();
  }
  const entries = BODIES.map((def, i) => {
    const v = bodies.views[def.name];
    const isMoon = def.parent && def.parent !== 'Sun';
    // moon labels only when their planet's system is spread out enough on screen
    let prio = def.name === state.selected ? 100 : !def.parent ? 90 : isMoon ? 10 : 50 - i * 0.1;
    // a body hidden because it moves too fast to draw takes its label with it, which would
    // otherwise jump around its orbit from frame to frame
    return { name: def.name, pos: v.group.position, R: v.R || drawnRadius(def.name), show: v.group.visible, label: state.show.labels, prio, isMoon, parent: def.parent };
  });
  const labelled = [];
  for (const e of entries) {
    if (!e.isMoon || moonSpread(e)) { labelled.push(e); continue; }
    const it = labels.items[e.name];
    if (it.shown) { it.el.style.display = 'none'; it.shown = false; }
  }
  screenPos = labels.update(camera, W, H, labelled, hudBoxes, state.selected);
  updateHover();
  // the selected body's spin axis, once the body is big enough on screen for it to mean anything
  const sp = screenPos.find(p => p.name === state.selected);
  bodies.axis.visible = state.show.axis && bodies.views[state.selected].group.visible && !!sp && sp.rpx > 5;

  bodies.loadVisible(camera, H);
  // swap in the high-resolution Earth when it fills the screen
  const se = screenPos.find(s => s.name === 'Earth');
  if (se && se.onScreen && se.rpx > 350) bodies.upgrade('Earth');

  const sunV = bodies.views.Sun;
  glare.update(camera, sunV.group.position, sunV.R, W, H, renderer.getPixelRatio(),
    BODIES.filter(d => d.parent).map(d => { const v = bodies.views[d.name]; return { pos: v.group.position, R: v.R, visible: v.group.visible }; }));
  stars.setGlare(glare.on ? 0.75 * glare.vis * glare.halo : 0, glare.dir);

  renderer.clear();
  stars.render(renderer, camera, renderer.getPixelRatio());
  renderer.clearDepth();
  renderer.render(scene, camera);
  glare.render(renderer);

  if (hudDirty || now - lastHud > 125) { lastHud = now; hudDirty = false; updateHud(); }
}

// a moon's label is worth showing once it separates from its planet on screen
function moonSpread(e) {
  const pv = bodies.views[e.parent].group.position, mv = bodies.views[e.name].group.position;
  const d = camera.position.distanceTo(pv);
  const px = pv.distanceTo(mv) / d * stage.clientHeight / 2 / Math.tan(camera.fov * Math.PI / 360);
  return px > 26 || e.name === state.selected;
}

// ---------------------------------------------------------------- picking and hover
// the body whose drawn disc (or a generous halo around tiny ones) is under a screen point, nearest first
function pick(x, y) {
  let best = null;
  for (const s of screenPos) {
    if (!s.onScreen || !bodies.views[s.name].group.visible) continue;
    const d = Math.hypot(s.px - x, s.py - y), reach = Math.max(s.rpx, 12);
    if (d < reach && (!best || s.dist < best.dist)) best = s;
  }
  return best;
}
let pointer = null, hovered = null;
const hoverRing = $('hoverRing');
function updateHover() {
  const name = labels.hover || (pointer && pick(...pointer) || {}).name || null;
  const s = name && screenPos.find(p => p.name === name);
  if (name !== hovered) { hovered = name; renderer.domElement.style.cursor = pointer && name ? 'pointer' : ''; }
  // a thin ring just outside the drawn disc; bodies larger than the screen need none
  if (!s || !s.onScreen || s.rpx > stage.clientHeight * 0.45) { hoverRing.classList.remove('on'); return; }
  const r = Math.max(s.rpx + 5, 11);
  hoverRing.style.transform = `translate(${s.px - r}px, ${s.py - r}px)`;
  hoverRing.style.width = hoverRing.style.height = 2 * r + 'px';
  hoverRing.style.borderColor = `color-mix(in oklab, ${BY_NAME[name].color} 55%, white)`;
  hoverRing.classList.add('on');
}

// ---------------------------------------------------------------- HUD
// The clock shows local time, UTC, or UTC with the astronomical time scales ("scientific").
// The model takes UTC to be UT1 (they never differ by more than 0.9 s).
const TIME_MODES = ['Local', 'UTC', 'Scientific'];
let timeMode = 'Local';
try { const m = localStorage.getItem('solarSystem.timeMode'); if (TIME_MODES.includes(m)) timeMode = m; } catch {}
function setTimeMode(m) {
  timeMode = m;
  try { localStorage.setItem('solarSystem.timeMode', m); } catch {}
  $('timeMode').textContent = m;
  $('timeDetails').hidden = m !== 'Scientific';
  // the date field is typed in the same time as the clock shows
  $('when').setAttribute('aria-label', m === 'Local' ? 'Date and time (local)' : 'Date and time (UTC)');
  hudBoxes = null; hudDirty = true; wake();
}
const timeEls = { clock: $('clock'), date: $('date'), tz: $('tzLabel'), badge: $('badge') };
const dayTag = n => n ? `<span class="dtag" title="${n > 0 ? 'the next' : 'the previous'} day">${n > 0 ? '+' : '−'}${Math.abs(n)} d</span>` : '';
function updateHud() {
  const d = new Date(state.simMs), utc = timeMode !== 'Local';
  timeEls.clock.textContent = fmtTime(d, utc);
  timeEls.date.textContent = fmtDate(d, utc);
  const julian = civil(d, utc).julian ? 'Julian calendar' : '';
  timeEls.tz.textContent = [timeMode === 'Local' ? tzName(d) : timeMode === 'Scientific' ? 'UTC' : '', julian].filter(Boolean).join(' · ');
  // nothing to say while inside the validated range
  timeEls.badge.hidden = state.simMs >= VALID_FROM && state.simMs < VALID_TO;
  if (timeMode === 'Scientific' && snap) {
    $('tdUT').textContent = fmtTime(d, true);
    // TT runs about a minute ahead of UT, so near midnight it is already on the next day
    const ttMs = state.simMs + snap.deltaT * 1000;
    $('tdTT').innerHTML = fmtTime(new Date(ttMs), true) + dayTag(Math.floor(ttMs / DAY_MS) - Math.floor(state.simMs / DAY_MS));
    const dtNote = state.simMs > DT_MEASURED_UNTIL ? ' (predicted)' : state.simMs < Date.UTC(1657, 0, 1) ? ' (estimated from historical eclipses)' : ' (measured)';
    $('tdDT').textContent = snap.deltaT.toFixed(1) + ' s' + dtNote;
    $('tdJD').textContent = (snap.tt + 2451545).toFixed(5);
  }
  const when = $('when');
  if (!whenStaged && document.activeElement !== when) when.value = localInput(d, utc);
  $('playBtn').textContent = state.playing ? 'Pause' : 'Play';
  // Paused with the button, the rate stays visible (dimmed): it is what Play resumes at. Stopped in
  // the slider's notch, time stands still and the rate says so.
  const rateEl = $('rate'), stopped = !state.playing && state.parked;
  rateEl.textContent = stopped ? fmtRate(0) : fmtRate(setRate());
  rateEl.classList.toggle('paused', !state.playing && !stopped);
  rateEl.title = state.playing ? 'Simulation speed' : stopped ? 'Stopped. Move the slider out of the middle, or press Play, to run time again.' : 'Paused. Play resumes at this speed.';
  const speed = $('speed');
  if (document.activeElement !== speed) speed.value = !state.playing && state.parked ? 0 : state.dir * (state.speed + NOTCH);
  speed.setAttribute('aria-valuetext', state.playing ? fmtRate(setRate()) : 'stopped, resumes at ' + fmtRate(setRate()));
  if (snap) info.update(snap);
}

// ---------------------------------------------------------------- body list
// planets whose moons are listed: the selected body's system opens by itself, and each planet's
// moon count opens or closes its moons, so a moon can be chosen without flying to the planet first
const openSystems = new Set();
const systemOf = name => BY_NAME[name].parent && BY_NAME[name].parent !== 'Sun' ? BY_NAME[name].parent : name;
function buildList() {
  const ul = $('bodyList');
  for (const def of BODIES) {
    const isMoon = def.parent && def.parent !== 'Sun';
    const li = document.createElement('li');
    li.className = 'body-item' + (isMoon ? ' moon' : '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'body-btn';
    btn.dataset.body = def.name;
    if (isMoon) li.dataset.parent = def.parent;
    btn.innerHTML = `<span class="dot" style="background:${def.color}"></span><span>${def.name}</span>`;
    // the menu stays open, so several bodies can be visited in a row; tapping the view closes it
    btn.addEventListener('click', () => select(def.name, true));
    li.appendChild(btn);
    const nMoons = BODIES.filter(b => b.parent === def.name).length;
    if (nMoons && def.name !== 'Sun') {
      const exp = document.createElement('button');
      exp.type = 'button';
      exp.className = 'exp';
      exp.dataset.system = def.name;
      exp.dataset.n = nMoons;
      exp.setAttribute('aria-label', `${def.name}: ${nMoons} ${nMoons > 1 ? 'moons' : 'moon'}`);
      exp.addEventListener('click', () => {
        if (openSystems.has(def.name)) openSystems.delete(def.name); else openSystems.add(def.name);
        paintList();
      });
      li.appendChild(exp);
    }
    ul.appendChild(li);
  }
}
// the phone layout's menu (bodies and view options); on wider screens they are always shown
function setMenu(open) {
  $('right').classList.toggle('open', open);
  $('menuBtn').setAttribute('aria-expanded', open);
  hudBoxes = null;
}
function paintList() {
  const sel = state.selected, moons = state.show.moons;
  for (const li of document.querySelectorAll('.body-item')) {
    const btn = li.querySelector('.body-btn'), exp = li.querySelector('.exp');
    btn.setAttribute('aria-current', btn.dataset.body === sel);
    li.classList.toggle('cur', btn.dataset.body === sel);
    if (li.dataset.parent) li.hidden = !(moons && openSystems.has(li.dataset.parent));
    if (exp) {
      const open = moons && openSystems.has(exp.dataset.system);
      exp.textContent = exp.dataset.n + (moons ? open ? ' ▾' : ' ▸' : '');
      exp.setAttribute('aria-expanded', open);
      // with moons hidden there is nothing to open
      exp.disabled = !moons;
    }
  }
  hudBoxes = null;
}

// ---------------------------------------------------------------- events (eclipses, transits)
let evFrom = null;
function openEvents(more = false) {
  const list = $('evList');
  if (!more) { list.innerHTML = ''; evFrom = new Date(state.simMs); }
  const evs = upcomingEvents(evFrom, { solar: 4, lunar: 4, transits: 1 });
  // list only up to the earlier of the last solar and last lunar eclipse found, so the next batch
  // (which starts there) cannot skip an eclipse of the other kind
  const lastOf = kind => evs.filter(e => e.kind === kind).reduce((m, e) => Math.max(m, e.date), 0);
  const cutoff = Math.min(lastOf('solar'), lastOf('lunar'));
  if (!cutoff) { toast('No further events found.'); openSheet('events'); return; }
  for (const e of evs) {
    if (e.date > cutoff) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ev';
    b.innerHTML = `<span class="d">${fmtDate(e.date, true)}<br>${fmtTime(e.date, true, false)} UT</span><span class="t">${e.title}</span><span class="w">${e.where}</span>`;
    b.addEventListener('click', () => { closeSheets(); jumpToEvent(e); });
    list.appendChild(b);
  }
  evFrom = new Date(cutoff + DAY_MS);
  openSheet('events');
}

function jumpToEvent(e) {
  setTime(e.date.getTime(), { pause: true });
  // a playback rate at which the event takes tens of seconds instead of passing in one frame
  setSpeed(Math.log10({ solar: 120, lunar: 600, transit: 600 }[e.kind]));
  state.dir = 1;
  refreshSnap();
  setScale(1, false);
  computeDisplay();
  camera.fov = DEFAULT_FOV; camera.updateProjectionMatrix();
  const P = n => new THREE.Vector3(...toScene(snap.bodies[n].pos));
  if (e.kind === 'solar') {
    // look down on the point where the shadow axis (Sun → Moon) meets Earth
    const earth = P('Earth'), moon = P('Moon'), ax = moon.clone().normalize();
    const b = ax.dot(earth), R = meanRadius(BY_NAME.Earth), disc = b * b - (earth.lengthSq() - R * R);
    const hit = disc >= 0 ? ax.clone().multiplyScalar(b - Math.sqrt(disc)) : ax.clone().multiplyScalar(b);
    const dir = hit.sub(earth).normalize();
    select('Earth', false);
    view.lock = true; paintToggles();
    view.setFocus('Earth', disp, { dist: drawnRadius('Earth') * 2.6, dir });
  } else if (e.kind === 'lunar') {
    // view the Moon from the Earth side, where it is seen during the eclipse
    const dir = P('Earth').sub(P('Moon')).normalize();
    select('Moon', false);
    view.lock = true; paintToggles();
    view.setFocus('Moon', disp, { dist: drawnRadius('Moon') * 5, dir: dir.add(new THREE.Vector3(0, 0.25, 0)).normalize() });
  } else {
    // a transit: telescope view from Earth toward the Sun
    const earth = P('Earth');
    select(e.sub, false);
    view.setFocus('Sun', disp, { dist: 1 });
    view.tween = null;
    const k = scale.helio(earth.length()) / earth.length();
    camera.position.copy(earth.multiplyScalar(k * 0.9995));
    view.controls.target.set(0, 0, 0);
    camera.fov = 1.1; camera.updateProjectionMatrix();
    toast('Telescope view from Earth toward the Sun. Press Esc to return.');
  }
  hudDirty = true;
}

// ---------------------------------------------------------------- sheets, toasts, sharing
function openSheet(id) { closeSheets(); $(id).hidden = false; $(id).querySelector('[data-close]').focus(); }
function closeSheets() { for (const s of document.querySelectorAll('.sheet')) s.hidden = true; }
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200); }

function shareUrl() {
  const off = camera.position.clone().sub(view.controls.target);
  const q = new URLSearchParams({
    t: new Date(state.simMs).toISOString().replace('.000Z', 'Z'), focus: view.focus, sel: state.selected,
    scale: scale.s.toFixed(3), speed: state.speed.toFixed(2), play: state.playing ? 1 : 0,
    cam: [off.x, off.y, off.z].map(x => +x.toPrecision(5)).join(','),
  });
  if (state.dir < 0) q.set('dir', -1);
  if (camera.fov !== DEFAULT_FOV) q.set('fov', +camera.fov.toPrecision(4));
  return location.origin + location.pathname + '#' + q.toString();
}
function readUrl() {
  const q = new URLSearchParams(location.hash.slice(1));
  const t = Date.parse(q.get('t') || '');
  if (!Number.isNaN(t)) setTime(t);
  const num = k => q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : null;
  // speed: log10 |rate|; links from before the signed slider have no `dir` and ran forward
  if (num('speed') !== null) state.speed = Math.max(0, Math.min(SPEED_MAX, num('speed')));
  state.dir = num('dir') === -1 ? -1 : 1;
  if (q.has('play')) state.playing = q.get('play') === '1';
  if (num('scale') !== null) setScale(num('scale'), false);
  const focus = q.get('focus');
  return { focus: BY_NAME[focus] ? focus : null, sel: BY_NAME[q.get('sel')] ? q.get('sel') : null, cam: (q.get('cam') || '').split(',').map(Number), fov: num('fov') };
}

// ---------------------------------------------------------------- controls wiring
function paintToggles() {
  wake();
  for (const b of document.querySelectorAll('[data-toggle]')) {
    const k = b.dataset.toggle;
    const on = k === 'lock' ? view.lock : state.show[k];
    b.setAttribute('aria-pressed', on);
  }
}
function wire() {
  // anything the user does, and anything that finishes loading, may change the picture
  for (const ev of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'click', 'touchstart']) window.addEventListener(ev, () => wake(), { capture: true, passive: true });
  window.addEventListener('pointermove', e => { if (e.buttons) wake(); }, { passive: true });
  document.addEventListener('visibilitychange', () => wake());
  view.controls.addEventListener('change', () => wake(300));   // includes damping after a drag
  THREE.DefaultLoadingManager.onProgress = () => wake();
  bodies.onChange = () => wake();
  stars.ready.then(() => wake());
  document.fonts && document.fonts.ready.then(() => { labels.remeasure(); wake(); });

  for (const b of document.querySelectorAll('[data-toggle]')) b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    // re-locking brings the camera back onto the body it drifted away from
    if (k === 'lock') { view.lock = !view.lock; if (view.lock) view.glide(); }
    else state.show[k] = !state.show[k];
    if (k === 'moons') paintList();
    paintToggles();
  });
  $('scale').addEventListener('input', e => setScale(+e.target.value, false));
  $('scaleMin').addEventListener('click', () => setScale(0));
  $('scaleMax').addEventListener('click', () => setScale(1));
  $('playBtn').addEventListener('click', () => setPlaying(!state.playing));
  $('backBtn').addEventListener('click', () => stepTime(-1));
  $('fwdBtn').addEventListener('click', () => stepTime(1));
  $('stepBtn').addEventListener('click', () => setStep(STEPS[(STEPS.indexOf(step) + 1) % STEPS.length]));
  setStep(step);
  $('nowBtn').addEventListener('click', () => setTime(Date.now()));
  $('speed').addEventListener('input', e => {
    const v = +e.target.value;
    if (Math.abs(v) < NOTCH) { state.playing = false; state.parked = true; }
    else {
      // leaving the notch starts time again; a pause from the button stays a pause
      const wasParked = state.parked;
      state.dir = Math.sign(v); setSpeed(Math.abs(v) - NOTCH);
      if (wasParked) state.playing = true;
    }
    hudDirty = true;
  });
  $('slowBtn').addEventListener('click', () => setSpeed(state.speed - 0.25));
  $('fastBtn').addEventListener('click', () => setSpeed(state.speed + 0.25));

  // the date field is a draft until confirmed with OK or Enter; Esc, or leaving it for something
  // else, puts back the displayed time
  const when = $('when'), whenOk = $('whenOk');
  const draft = on => { whenStaged = on; $('whenForm').classList.toggle('staged', on); whenOk.disabled = !on; if (!on) hudDirty = true; };
  when.addEventListener('input', () => draft(true));
  when.addEventListener('change', () => draft(true));
  $('whenForm').addEventListener('submit', e => {
    e.preventDefault();
    // in the clock's time (local or UTC), Julian calendar before 1582
    const t = parseLocalInput(when.value, timeMode !== 'Local');
    if (Number.isNaN(t) || t < MIN_MS || t > MAX_MS) { toast('Choose a date between the years 1000 and 2999.'); return; }
    draft(false); setTime(t); when.blur();
  });
  when.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); draft(false); when.blur(); }
  });
  // Focus moving to another control discards the draft, but a blur with nowhere to go does not:
  // on phones the native picker closes that way, and the draft must survive until OK is tapped.
  when.addEventListener('blur', e => { if (e.relatedTarget && e.relatedTarget !== whenOk) draft(false); });
  window.addEventListener('pointerdown', e => { if (whenStaged && !e.target.closest('#whenForm')) draft(false); }, true);
  $('timeMode').addEventListener('click', () => setTimeMode(TIME_MODES[(TIME_MODES.indexOf(timeMode) + 1) % TIME_MODES.length]));
  $('badge').addEventListener('click', () => { openSheet('guide'); $('guide').querySelector('table').scrollIntoView({ block: 'center' }); });
  $('eventsBtn').addEventListener('click', () => openEvents(false));
  $('evMore').addEventListener('click', () => openEvents(true));
  $('guideBtn').addEventListener('click', () => openSheet('guide'));
  $('shareBtn').addEventListener('click', async () => {
    const url = shareUrl();
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); toast('Link to this exact view copied.'); } catch { toast('Link is in the address bar.'); }
  });
  for (const c of document.querySelectorAll('[data-close]')) c.addEventListener('click', closeSheets);
  // the info panel changes height when "More data" opens or (on phones) when it expands
  $('more').addEventListener('toggle', () => { hudBoxes = null; });
  $('info').addEventListener('click', () => { hudBoxes = null; });
  $('menuBtn').addEventListener('click', () => setMenu(!$('right').classList.contains('open')));

  // click on the canvas: pick the body under the pointer
  let down = null;
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; setMenu(false); });
  cv.addEventListener('pointerup', e => {
    if (!down || Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 5) return;
    // on touchscreens the labels let touches through to the view (see style.css), so a tap on one
    // is found here
    const r = cv.getBoundingClientRect(), name = labels.at(e.clientX, e.clientY) || (pick(e.clientX - r.left, e.clientY - r.top) || {}).name;
    if (name) select(name, true);
  });
  // hover: a faint ring and a pointer cursor say that bodies can be clicked
  cv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons) { pointer = null; updateHover(); return; }
    const r = cv.getBoundingClientRect();
    pointer = [e.clientX - r.left, e.clientY - r.top];
    updateHover();
  }, { passive: true });
  cv.addEventListener('pointerleave', () => { pointer = null; updateHover(); });

  // whether focus was last moved with the keyboard (Tab) rather than by clicking
  let keyboardNav = false;
  window.addEventListener('pointerdown', () => { keyboardNav = false; }, true);
  window.addEventListener('keydown', e => {
    if (e.key === 'Tab') keyboardNav = true;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key.startsWith('Arrow')) e.stopImmediatePropagation(); return; }
    if (e.key.startsWith('Arrow') && e.target.closest && e.target.closest('.sheet')) { e.stopImmediatePropagation(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    let used = true;
    switch (e.key) {
      // Space presses a button reached with the keyboard; after a click it is play/pause again
      case ' ': if ((tag === 'BUTTON' || tag === 'SUMMARY') && keyboardNav) { used = false; break; } setPlaying(!state.playing); break;
      case ',': stepTime(-1); break;
      case '.': stepTime(1); break;
      case '[': setSpeed(state.speed - 0.25); break;
      case ']': setSpeed(state.speed + 0.25); break;
      case 'r': case 'R': state.dir = -state.dir; break;
      case 'n': case 'N': setTime(Date.now()); break;
      case 't': case 'T': setScale(scale.s < 0.5 ? 1 : 0); break;
      case 'Escape':
        if (!document.querySelector('.sheet:not([hidden])')) {
          camera.fov = DEFAULT_FOV; camera.updateProjectionMatrix();
          select('Sun', false);
          view.setFocus('Sun', disp, { dist: overviewDistance() });
        }
        closeSheets(); break;
      default: used = false;
    }
    if (used) { e.preventDefault(); hudDirty = true; }
  }, true);

  const resize = () => {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    hudBoxes = null;
    wake();
  };
  new ResizeObserver(resize).observe(stage);
  resize();
  // the phone layout stacks the information panel on the time controls, whose height depends on
  // how their rows wrap
  const ctl = document.querySelector('.timectl');
  new ResizeObserver(() => { $('app').style.setProperty('--ctl-h', ctl.offsetHeight + 'px'); hudBoxes = null; }).observe(ctl);
  // and the part of the screen the panels leave free changes with them
  new ResizeObserver(() => { hudBoxes = null; wake(); }).observe($('info'));
}

// ---------------------------------------------------------------- start
buildList();
wire();
setTimeMode(timeMode);
const fromUrl = readUrl();
refreshSnap();
computeDisplay();
camera.position.set(0, 0.42, 1).normalize().multiplyScalar(overviewDistance());
select(fromUrl.sel || 'Sun', false);
if (fromUrl.focus) {
  view.setFocus(fromUrl.focus, disp, { dist: focusDistance(fromUrl.focus), ms: 1 });
  if (fromUrl.cam.length === 3 && fromUrl.cam.every(Number.isFinite)) {
    view.tween = null;
    view.controls.target.set(0, 0, 0);
    camera.position.set(...fromUrl.cam);
  }
  if (fromUrl.fov > 0 && fromUrl.fov < 120) { camera.fov = fromUrl.fov; camera.updateProjectionMatrix(); }
}
paintToggles();
applyScale(scale.s);
stars.ready.then(() => { stars.setEpoch(snap.tt / 365.25); });
if (REDUCED_MOTION) toast('Reduced motion is on: time starts paused.');
requestAnimationFrame(t => { last = t; frame(t); });

// for debugging from the console
// look at a body from a direction given relative to the Sun direction ('sun'), or as a scene vector
function look(name, dir = 'sun', k = 5) {
  select(name, false);
  const me = new THREE.Vector3(...toScene(snap.bodies[name].pos));
  let d = dir === 'sun' ? me.clone().negate().normalize() : new THREE.Vector3(...dir).normalize();
  if (dir === 'sun') d.add(new THREE.Vector3(0, 0.35, 0)).normalize();
  view.setFocus(name, disp, { dist: drawnRadius(name) * k, dir: d });
}
window.solarSystem = { look, state, view, scale, bodies, glare, renderer, snapshotAt: ms => snapshot(ms), setTime, setScale, select, jumpToEvent, upcomingEvents };
