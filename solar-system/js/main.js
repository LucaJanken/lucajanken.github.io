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
import { InfoPanel } from './ui/info.js';
import { fmtDate, fmtTime, tzName, localInput, parseLocalInput, civil, fmtRate, fmtRelative } from './ui/format.js';

const $ = id => document.getElementById(id);
const DAY_MS = 86400000;
// 1 Jan 1000 in the Julian calendar (6 Jan proleptic Gregorian) to 31 Dec 2999
const MIN_MS = Date.UTC(1000, 0, 6), MAX_MS = Date.UTC(2999, 11, 31, 23, 59);
const VALID_FROM = Date.UTC(1800, 0, 1), VALID_TO = Date.UTC(2051, 0, 1);
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- state
const state = {
  simMs: Date.now(),
  playing: !REDUCED_MOTION,
  speed: Math.log10(86400),          // log10(simulated seconds per real second): 1 day per second
  dir: 1,
  show: { orbits: true, labels: true, moons: true, stars: true },
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
const sunLight = new THREE.PointLight(0xfff6ea, 3.4, 0, 0);
scene.add(sunLight);

const grid = new THREE.PolarGridHelper(1, 12, 8, 128, 0x2a3346, 0x1b2130);
grid.material.transparent = true; grid.material.depthWrite = false;
scene.add(grid);

const shared = { shGamma: { value: 1 }, nightOn: { value: 1 } };
const scale = new DisplayScale();
const bodies = new BodyViews(scene, renderer, shared);
const orbits = new Orbits(scene);
const stars = new Stars();
const view = new View(camera, renderer.domElement);
const info = new InfoPanel();
const labels = new Labels($('labels'), BODIES, name => select(name, true));

// ---------------------------------------------------------------- display positions
let snap = null, disp = {};
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
// orbit sample (km, relative to the body's primary) → display offset from the body itself
function mapOrbitPoint(name, relKm) {
  const def = BY_NAME[name], p = toScene(relKm), r = Math.hypot(...p), me = disp[name];
  if (def.parent === 'Sun') {
    const k = scale.helio(r) / r;
    return [p[0] * k - me[0], p[1] * k - me[1], p[2] * k - me[2]];
  }
  const k = scale.moon(name, def.parent, meanRadius(BY_NAME[def.parent]), r) / r, pp = disp[def.parent];
  return [pp[0] + p[0] * k - me[0], pp[1] + p[1] * k - me[1], pp[2] + p[2] * k - me[2]];
}
const drawnRadius = name => scale.size(meanRadius(BY_NAME[name]));
const overviewDistance = () => 2.1 * scale.helio(30.1 * AU_KM);
const focusDistance = name => name === 'Sun' ? overviewDistance() : drawnRadius(name) * 5;

// ---------------------------------------------------------------- selection and focus
function select(name, fly) {
  wake();
  state.selected = name;
  info.show(name);
  info.update(snap);
  paintList();
  if (fly) {
    camera.fov = DEFAULT_FOV; camera.updateProjectionMatrix();
    view.setFocus(name, disp, focusDistance(name));
  }
  hudDirty = true;
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
  if (Number.isFinite(factor) && factor > 0) view.rescale(factor);
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
const rate = () => state.playing ? state.dir * Math.pow(10, state.speed) : 0;

// ---------------------------------------------------------------- main loop
let last = performance.now(), lastHud = 0, hudDirty = true, frameDt = 1 / 60;
let hudBoxes = null, screenPos = [];
// Render on demand: while time is paused and nobody interacts, nothing changes on screen, so an
// idle page draws nothing (laptop and phone batteries). Input, loads and state changes wake it.
let wakeUntil = performance.now() + 3000;
function wake(ms = 1500) { wakeUntil = Math.max(wakeUntil, performance.now() + ms); }
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const active = state.playing || view.tween || scaleAnim || now < wakeUntil;
  if (!active) {
    // the clock text ("… from now") still ages, slowly
    if (hudDirty || now - lastHud > 1000) { lastHud = now; hudDirty = false; updateHud(); }
    return;
  }
  frameDt = frameDt * 0.9 + dt * 0.1;
  const dtSim = rate() * dt;
  if (dtSim) {
    const next = state.simMs + dtSim * 1000;
    if (next <= MIN_MS || next >= MAX_MS) { state.playing = false; toast('The model covers the years 1000–3000.'); }
    state.simMs = Math.max(MIN_MS, Math.min(MAX_MS, next));
  }

  snap = snapshot(state.simMs);
  if (scaleAnim) {
    const k = Math.min(1, (now - scaleAnim.t0) / scaleAnim.ms), e = k * k * (3 - 2 * k);
    // interpolate in the exponent, so the morph looks even across the ~5 decades of change
    applyScale(scaleAnim.from + (scaleAnim.to - scaleAnim.from) * e);
    if (k >= 1) scaleAnim = null;
  }
  computeDisplay();
  const fd = BY_NAME[view.focus];
  view.update(disp, drawnRadius(view.focus) * Math.max(...fd.shape) / meanRadius(fd), 3.2 * scale.helio(50 * AU_KM));
  const origin = view.origin;
  // simulated time per rendered frame, for rotation blur and to hide bodies that would strobe
  const perFrame = rate() * frameDt;
  bodies.update(snap, disp, origin, scale, perFrame);
  bodies.updateGlow(camera, stage.clientHeight);
  for (const def of BODIES) {
    const v = bodies.views[def.name];
    const isMoon = def.parent && def.parent !== 'Sun';
    const tooFast = def.periodD && Math.abs(perFrame) / (def.periodD * 86400) > 0.1;
    v.group.visible = !(isMoon && !state.show.moons) && !tooFast;
    v.tooFast = tooFast;
  }
  orbits.update(snap, disp, origin, n => state.show.orbits && (state.show.moons || BY_NAME[n].parent === 'Sun'), mapOrbitPoint);
  sunLight.position.set(-origin[0], -origin[1], -origin[2]);

  const gridR = scale.helio(31 * AU_KM);
  grid.position.set(-origin[0], -origin[1], -origin[2]);
  grid.scale.setScalar(gridR);
  const camD = view.distance();
  grid.material.opacity = state.show.orbits ? 0.3 * Math.max(0, Math.min(1, (camD / gridR - 0.15) / 0.3)) : 0;
  grid.visible = grid.material.opacity > 0.01;

  stars.setEpoch((snap.tt) / 365.25);
  stars.points && (stars.points.visible = state.show.stars);

  // labels (and screen positions for picking)
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!hudBoxes) hudBoxes = [...document.querySelectorAll('[data-hud]')].filter(e => e.offsetParent).map(e => {
    const r = e.getBoundingClientRect(); return { left: r.left - 4, right: r.right + 4, top: r.top - 4, bottom: r.bottom + 4 };
  });
  const entries = BODIES.map(def => {
    const v = bodies.views[def.name];
    const isMoon = def.parent && def.parent !== 'Sun';
    // moon labels only when their planet's system is spread out enough on screen
    let prio = def.name === state.selected ? 100 : !def.parent ? 90 : isMoon ? 10 : 50 - BODIES.indexOf(def) * 0.1;
    return { name: def.name, pos: v.group.position, R: v.R || drawnRadius(def.name), show: !(isMoon && !state.show.moons), label: state.show.labels, ring: true, prio, isMoon, parent: def.parent };
  });
  screenPos = labels.update(camera, W, H, entries.filter(e => !e.isMoon || moonSpread(e)), hudBoxes, state.selected);
  for (const e of entries.filter(e => e.isMoon && !moonSpread(e))) labels.items[e.name].el.style.display = 'none', labels.items[e.name].shown = false, labels.items[e.name].ring.style.display = 'none';

  bodies.loadVisible(camera, H);
  // swap in the high-resolution Earth when it fills the screen
  const se = screenPos.find(s => s.name === 'Earth');
  if (se && se.onScreen && se.rpx > 350) bodies.upgrade('Earth');

  renderer.clear();
  stars.render(renderer, camera, renderer.getPixelRatio());
  renderer.clearDepth();
  renderer.render(scene, camera);

  if (hudDirty || now - lastHud > 125) { lastHud = now; hudDirty = false; updateHud(); }
}

// a moon's label is worth showing once it separates from its planet on screen
function moonSpread(e) {
  const pv = bodies.views[e.parent].group.position, mv = bodies.views[e.name].group.position;
  const d = camera.position.distanceTo(pv);
  const px = pv.distanceTo(mv) / d * stage.clientHeight / 2 / Math.tan(camera.fov * Math.PI / 360);
  return px > 26 || e.name === state.selected;
}

// ---------------------------------------------------------------- HUD
const timeEls = { clock: $('clock'), date: $('date'), rel: $('rel'), tz: $('tzLabel'), ut: $('ut'), badge: $('badge') };
function updateHud() {
  const d = new Date(state.simMs);
  timeEls.clock.textContent = fmtTime(d);
  timeEls.date.textContent = fmtDate(d);
  timeEls.tz.textContent = 'Local time · ' + tzName(d) + (civil(d).julian ? ' · Julian calendar' : '');
  timeEls.rel.textContent = fmtRelative(state.simMs - Date.now());
  timeEls.ut.textContent = 'UT ' + fmtTime(d, true, false) + (d.getUTCDate() !== d.getDate() ? ' (' + fmtDate(d, true) + ')' : '');
  const valid = state.simMs >= VALID_FROM && state.simMs < VALID_TO;
  timeEls.badge.textContent = valid ? 'Validated 1800–2050' : 'Extrapolated';
  timeEls.badge.className = 'chip ' + (valid ? 'ok' : 'warn');
  if (!$('timeDetails').hidden && snap) {
    $('tdUT').textContent = fmtDate(d, true) + ' ' + fmtTime(d, true);
    const tt = new Date(state.simMs + snap.deltaT * 1000);
    $('tdTT').textContent = fmtDate(tt, true) + ' ' + fmtTime(tt, true);
    const dtNote = state.simMs > DT_MEASURED_UNTIL ? ' (predicted)' : state.simMs < Date.UTC(1657, 0, 1) ? ' (estimated from historical eclipses)' : ' (measured)';
    $('tdDT').textContent = snap.deltaT.toFixed(1) + ' s' + dtNote;
    $('tdJD').textContent = (snap.tt + 2451545).toFixed(5);
  }
  const when = $('when');
  if (document.activeElement !== when) when.value = localInput(d);
  $('playBtn').textContent = state.playing ? 'Pause' : 'Play';
  $('rate').textContent = state.playing ? fmtRate(state.dir * Math.pow(10, state.speed)) : 'paused';
  if (document.activeElement !== $('speed')) $('speed').value = state.speed;
  $('dirBtn').setAttribute('aria-pressed', state.dir < 0);
  if (snap) info.update(snap);
}

// ---------------------------------------------------------------- body list
function buildList() {
  const ul = $('bodyList');
  for (const def of BODIES) {
    const isMoon = def.parent && def.parent !== 'Sun';
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'body-btn' + (isMoon ? ' moon' : '');
    btn.dataset.body = def.name;
    if (isMoon) btn.dataset.parent = def.parent;
    btn.innerHTML = `<span class="dot" style="background:${def.color}"></span><span>${def.name}</span>`;
    const nMoons = BODIES.filter(b => b.parent === def.name).length;
    if (nMoons && def.name !== 'Sun') btn.insertAdjacentHTML('beforeend', `<span class="n" data-n="${nMoons}">${nMoons}</span>`);
    btn.addEventListener('click', () => select(def.name, true));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}
function paintList() {
  const sel = state.selected, selSystem = BY_NAME[sel] && BY_NAME[sel].parent && BY_NAME[sel].parent !== 'Sun' ? BY_NAME[sel].parent : sel;
  for (const btn of document.querySelectorAll('.body-btn')) {
    const name = btn.dataset.body, parent = btn.dataset.parent;
    btn.setAttribute('aria-current', name === sel);
    if (parent) btn.parentElement.hidden = !(parent === selSystem && state.show.moons);
    const n = btn.querySelector('.n');
    if (n) n.textContent = n.dataset.n + (name === selSystem && state.show.moons ? ' ▾' : ' ▸');
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
  state.speed = Math.log10({ solar: 120, lunar: 600, transit: 600 }[e.kind]);
  snap = snapshot(state.simMs);
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
    view.follow = true; paintToggles();
    view.setFocus('Earth', disp, drawnRadius('Earth') * 2.6, { dir });
  } else if (e.kind === 'lunar') {
    // view the Moon from the Earth side, where it is seen during the eclipse
    const dir = P('Earth').sub(P('Moon')).normalize();
    select('Moon', false);
    view.follow = true; paintToggles();
    view.setFocus('Moon', disp, drawnRadius('Moon') * 5, { dir: dir.add(new THREE.Vector3(0, 0.25, 0)).normalize() });
  } else {
    // a transit: telescope view from Earth toward the Sun
    const earth = P('Earth');
    select(e.sub, false);
    view.setFocus('Sun', disp, 1, {});
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
  if (camera.fov !== DEFAULT_FOV) q.set('fov', +camera.fov.toPrecision(4));
  return location.origin + location.pathname + '#' + q.toString();
}
function readUrl() {
  const q = new URLSearchParams(location.hash.slice(1));
  const t = Date.parse(q.get('t') || '');
  if (!Number.isNaN(t)) setTime(t);
  const num = k => q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : null;
  if (num('speed') !== null) state.speed = Math.max(0, Math.min(8.2, num('speed')));
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
    const on = k === 'follow' ? view.follow : k === 'penumbra' ? shared.shGamma.value < 1 : state.show[k];
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
    if (k === 'follow') view.follow = !view.follow;
    else if (k === 'penumbra') shared.shGamma.value = shared.shGamma.value < 1 ? 1 : 0.45;
    else state.show[k] = !state.show[k];
    if (k === 'moons') paintList();
    paintToggles();
  });
  $('scale').addEventListener('input', e => setScale(+e.target.value, false));
  $('scaleMin').addEventListener('click', () => setScale(0));
  $('scaleMax').addEventListener('click', () => setScale(1));
  $('playBtn').addEventListener('click', () => { state.playing = !state.playing; hudDirty = true; });
  $('dirBtn').addEventListener('click', () => { state.dir = -state.dir; hudDirty = true; });
  $('backBtn').addEventListener('click', () => setTime(state.simMs - DAY_MS));
  $('fwdBtn').addEventListener('click', () => setTime(state.simMs + DAY_MS));
  $('nowBtn').addEventListener('click', () => setTime(Date.now()));
  $('speed').addEventListener('input', e => { state.speed = +e.target.value; hudDirty = true; });
  $('slowBtn').addEventListener('click', () => { state.speed = Math.max(0, +(state.speed - 0.25).toFixed(2)); hudDirty = true; });
  $('fastBtn').addEventListener('click', () => { state.speed = Math.min(8.2, +(state.speed + 0.25).toFixed(2)); hudDirty = true; });
  $('when').addEventListener('change', e => {
    const t = parseLocalInput(e.target.value);   // local time, Julian calendar before 1582
    if (!Number.isNaN(t) && t >= MIN_MS && t <= MAX_MS) setTime(t);
  });
  $('timeMore').addEventListener('click', e => {
    const box = $('timeDetails'); box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-expanded', !box.hidden); hudBoxes = null; hudDirty = true;
  });
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
  $('menuBtn').addEventListener('click', e => {
    const r = $('right'); r.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', r.classList.contains('open')); hudBoxes = null;
  });

  // click on the canvas: pick the body whose drawn disc (or a generous halo around tiny ones) is nearest
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null;
    for (const s of screenPos) {
      if (!s.onScreen || !bodies.views[s.name].group.visible) continue;
      const d = Math.hypot(s.px - x, s.py - y), reach = Math.max(s.rpx, 12);
      if (d < reach && (!best || s.dist < best.dist)) best = { ...s };
    }
    if (best) select(best.name, true);
  });

  window.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key.startsWith('Arrow')) e.stopImmediatePropagation(); return; }
    if (e.key.startsWith('Arrow') && e.target.closest && e.target.closest('.sheet')) { e.stopImmediatePropagation(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    let used = true;
    switch (e.key) {
      case ' ': if (tag === 'BUTTON' || tag === 'SUMMARY') { used = false; break; } state.playing = !state.playing; break;
      case ',': setTime(state.simMs - DAY_MS); break;
      case '.': setTime(state.simMs + DAY_MS); break;
      case '[': state.speed = Math.max(0, state.speed - 0.25); break;
      case ']': state.speed = Math.min(8.2, state.speed + 0.25); break;
      case 'r': case 'R': state.dir = -state.dir; break;
      case 'n': case 'N': setTime(Date.now()); break;
      case 't': case 'T': setScale(scale.s < 0.5 ? 1 : 0); break;
      case 'Escape':
        if (!document.querySelector('.sheet:not([hidden])')) { camera.fov = DEFAULT_FOV; camera.updateProjectionMatrix(); select('Sun', true); }
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
}

// ---------------------------------------------------------------- start
buildList();
wire();
const fromUrl = readUrl();
snap = snapshot(state.simMs);
computeDisplay();
camera.position.set(0, 0.42, 1).normalize().multiplyScalar(overviewDistance());
select(fromUrl.sel || 'Sun', false);
if (fromUrl.focus) {
  view.setFocus(fromUrl.focus, disp, focusDistance(fromUrl.focus), { ms: 1 });
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
  view.setFocus(name, disp, drawnRadius(name) * k, { dir: d });
}
window.solarSystem = { look, state, view, scale, bodies, renderer, snapshotAt: ms => snapshot(ms), setTime, setScale, select, jumpToEvent, upcomingEvents };
