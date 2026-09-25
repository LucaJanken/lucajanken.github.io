// The information panel for the selected body.
import { A, AU_KM, oscElements, orbitState } from '../astro/ephemeris.js';
import { BY_NAME, meanRadius } from '../data/bodies.js';
import { fmtDist, fmtLight, fmtMass, fmtHours, fmtAngle, fmtRA, fmtDec, fmtDuration } from './format.js';

const EARTH = BY_NAME.Earth;
const ENGINE_BODIES = new Set(['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']);
const len = v => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const esc = x => String(x).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const shownHtml = new WeakMap();
function dl(el, rows) {
  // rows: [label, value, extra?]; `extra` rows are hidden in the compact phone layout
  let html = '';
  for (const [k, v, extra] of rows) {
    if (v === null || v === undefined || v === '') continue;
    const cls = extra ? ' class="x"' : '';
    // exponents written as 10^n are set as superscripts
    html += `<dt${cls}>${esc(k)}</dt><dd${cls}>${esc(v).replace(/\^(-?\d+)/g, '<sup>$1</sup>')}</dd>`;
  }
  // most values stay put from one refresh to the next
  if (shownHtml.get(el) !== html) { el.innerHTML = html; shownHtml.set(el, html); }
}

export class InfoPanel {
  constructor() {
    this.el = document.getElementById('info');
    this.name = document.getElementById('infoName');
    this.type = document.getElementById('infoType');
    this.desc = document.getElementById('infoDesc');
    this.facts = document.getElementById('facts');
    this.more = document.getElementById('moreFacts');
    this.moreBox = document.getElementById('more');
    this.note = document.getElementById('infoNote');
    this.current = null;
    this.drawn = null;   // the snapshot and body the panel shows
    // on phones the panel is compact; tapping it expands it
    this.el.addEventListener('click', e => { if (e.target.closest('summary')) return; this.el.classList.toggle('expanded'); });
  }

  show(name) {
    const d = BY_NAME[name];
    this.current = name;
    this.name.textContent = d.name;
    this.type.textContent = d.type;
    this.desc.textContent = d.desc;
    this.note.textContent = d.representative ? 'Note: ' + d.representative + '.' : '';
    this.note.hidden = !d.representative;
  }

  update(snap) {
    const name = this.current;
    if (!name || (this.drawn && this.drawn.snap === snap && this.drawn.name === name)) return;
    this.drawn = { snap, name };
    const d = BY_NAME[name], b = snap.bodies[name], E = snap.bodies.Earth.pos;
    const R = meanRadius(d), rows = [];
    const toEarth = name === 'Earth' ? 0 : len(sub(b.pos, E));
    if (d.parent === 'Sun') rows.push(['From the Sun', fmtDist(len(b.pos))]);
    else if (d.parent) rows.push(['From ' + d.parent, fmtDist(len(b.rel.pos))]);
    if (name !== 'Earth') {
      if (d.parent !== 'Earth') rows.push(['From Earth', fmtDist(toEarth)]);
      rows.push(['Light time', fmtLight(toEarth).replace(' at light speed', '') + ' from Earth', true]);
    }
    if (d.parent) {
      const v = d.parent === 'Sun' ? b.vel : b.rel.vel;
      rows.push(['Orbital speed', len(v).toFixed(2) + ' km/s', true]);
    }
    rows.push(['Radius', Math.round(R).toLocaleString('en-US') + ' km' + (name !== 'Earth' ? '  (' + fmtRatio(R / meanRadius(EARTH)) + ' Earth)' : '')]);
    rows.push(['Mass', fmtMass(d.massKg) + (name !== 'Earth' ? '  (' + fmtRatio(d.massKg / EARTH.massKg) + ' Earth)' : ''), true]);
    if (d.periodD) rows.push(['Orbit takes', fmtPeriod(d.periodD)]);
    if (d.synchronous) rows.push(['Rotation', 'always shows ' + d.parent + ' the same face']);
    else if (d.rotationH) {
      rows.push(['Spins once in', fmtHours(d.rotationH) + (d.rotationH < 0 ? ', backwards' : '') + (d.rotationNote ? ' (' + d.rotationNote + ')' : '')]);
      if (d.solarDayH) rows.push(['Day (noon to noon)', fmtHours(d.solarDayH)]);
    }
    if (d.obliquity !== undefined) rows.push(['Axial tilt', d.obliquity.toFixed(2) + '°', true]);
    if (d.synodicD) rows.push(['Lunar month', d.synodicD.toFixed(3) + ' days (new moon to new moon)', true]);

    const more = [];
    if (ENGINE_BODIES.has(name) && name !== 'Sun') {
      try {
        const il = A.Illumination(A.Body[name], snap.time);
        rows.push(['Brightness', 'magnitude ' + il.mag.toFixed(2) + ' from Earth']);
        if (name !== 'Moon') rows.push(['Elongation', A.AngleFromSun(A.Body[name], snap.time).toFixed(1) + '° from the Sun', true]);
        rows.push(['Phase', (il.phase_fraction * 100).toFixed(1) + '% lit, seen from Earth', name !== 'Moon']);
      } catch (e) { /* engine cannot do this body */ }
    }
    if (ENGINE_BODIES.has(name) || name === 'Earth') {
      if (name !== 'Earth') {
        const g = A.GeoVector(A.Body[name], snap.time, true), eq = A.EquatorFromVector(g);
        more.push(['RA (J2000, from Earth)', fmtRA(eq.ra)], ['Dec (J2000, from Earth)', fmtDec(eq.dec)]);
      }
    }
    if (name !== 'Sun') {
      const p = b.pos;
      const lon = (Math.atan2(p[1], p[0]) * 180 / Math.PI + 360) % 360, lat = Math.asin(p[2] / len(p)) * 180 / Math.PI;
      more.push(['Heliocentric ecl. lon/lat', lon.toFixed(3) + '° / ' + lat.toFixed(3) + '°']);
      const os = orbitState(snap, name);
      const el = oscElements(os.pos, os.vel, os.mu);
      more.push(['Orbit elements about', os.about]);
      const aStr = d.parent === 'Sun' ? (el.a / AU_KM).toFixed(6) + ' AU' : Math.round(el.a).toLocaleString('en-US') + ' km';
      more.push(['Osculating a', aStr], ['e', el.e.toFixed(6)], ['i (to ecliptic)', fmtAngle(el.i, 4)],
        ['Ω (ascending node)', fmtAngle((el.node + 2 * Math.PI) % (2 * Math.PI), 3)], ['ω (argument of periapsis)', fmtAngle((el.argp + 2 * Math.PI) % (2 * Math.PI), 3)],
        ['M (mean anomaly)', fmtAngle((el.M + 2 * Math.PI) % (2 * Math.PI), 3)], ['Two-body period', fmtDuration(el.periodS)]);
    }
    dl(this.facts, rows);
    dl(this.more, more);
    this.moreBox.hidden = more.length === 0;
  }
}

function fmtRatio(x) { return x >= 100 ? Math.round(x).toLocaleString('en-US') + '×' : x >= 0.001 ? +x.toPrecision(3) + '×' : x.toExponential(2).replace(/e([+-])(\d+)/, (m, sg, d) => ' × 10^' + (sg === '-' ? '-' : '') + d) + '×'; }
function fmtPeriod(d) { return d < 2 ? (d * 24).toFixed(2) + ' hours' : d < 800 ? d.toFixed(d < 20 ? 3 : 2) + ' days' : (d / 365.25).toFixed(2) + ' years'; }
