// Number and time formatting for the HUD.
import { AU_KM } from '../astro/ephemeris.js';

export const pad = (n, w = 2) => String(Math.trunc(n)).padStart(w, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIGHT_S_PER_KM = 1 / 299792.458;

// Calendar. JavaScript dates are proleptic Gregorian, but before the Gregorian reform (Friday
// 15 October 1582 followed Thursday 4 October) historical records, and NASA's eclipse canon, use the
// Julian calendar. Dates before the reform are therefore shown, and typed, in the Julian calendar.
const DAY = 86400000, JD_UNIX = 2440587.5, JD_REFORM = 2299160.5;   // JD of 1582-10-15 00:00
const mod = (a, n) => ((a % n) + n) % n;

/** calendar fields of an instant, in UT or in the browser's local time */
export function civil(d, utc = false) {
  const ms = d.getTime() - (utc ? 0 : d.getTimezoneOffset() * 60000);
  const tod = mod(ms, DAY), jd = Math.floor(ms / DAY) + JD_UNIX + 0.5;   // JD at noon of that day
  let y, m, day, julian = jd < JD_REFORM;
  if (julian) {
    // Julian calendar from the JD (Meeus, Astronomical Algorithms, ch. 7)
    const B = jd + 1524, C = Math.floor((B - 122.1) / 365.25), D = Math.floor(365.25 * C), E = Math.floor((B - D) / 30.6001);
    day = B - D - Math.floor(30.6001 * E); m = E < 14 ? E - 1 : E - 13; y = m > 2 ? C - 4716 : C - 4715;
  } else {
    const g = new Date(ms); y = g.getUTCFullYear(); m = g.getUTCMonth() + 1; day = g.getUTCDate();
  }
  return { y, m, d: day, h: Math.floor(tod / 3600000), min: Math.floor(tod / 60000) % 60, s: Math.floor(tod / 1000) % 60, julian };
}

/** instant (ms) for calendar fields in local time; Julian calendar before 15 Oct 1582 */
export function fromCivil(y, m, day, h, min) {
  let localMs;
  if (y < 1582 || (y === 1582 && (m < 10 || (m === 10 && day < 15)))) {
    const yy = m > 2 ? y : y - 1, mm = m > 2 ? m : m + 12;
    const jd = Math.floor(365.25 * (yy + 4716)) + Math.floor(30.6001 * (mm + 1)) + day - 1524.5;
    localMs = (jd - JD_UNIX) * DAY;
  } else {
    const g = new Date(0); g.setUTCFullYear(y, m - 1, day); localMs = g.getTime();
  }
  localMs += (h * 60 + min) * 60000;
  // local → UT with the zone offset in force then (local mean time before standard time)
  return localMs + new Date(localMs).getTimezoneOffset() * 60000;
}

export function fmtDate(d, utc = false) {
  const c = civil(d, utc);
  return pad(c.d) + ' ' + MON[c.m - 1] + ' ' + c.y;
}
export function fmtTime(d, utc = false, secs = true) {
  const c = civil(d, utc);
  return pad(c.h) + ':' + pad(c.min) + (secs ? ':' + pad(c.s) : '');
}
export function tzName(d) {
  const off = -d.getTimezoneOffset();
  return 'UTC' + (off >= 0 ? '+' : '−') + Math.floor(Math.abs(off) / 60) + (Math.abs(off) % 60 ? ':' + pad(Math.abs(off) % 60) : '');
}
// value for <input type=datetime-local> (local time, in the calendar of that date)
export function localInput(d) {
  const c = civil(d);
  return pad(c.y, 4) + '-' + pad(c.m) + '-' + pad(c.d) + 'T' + pad(c.h) + ':' + pad(c.min);
}
export function parseLocalInput(v) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(v);
  return m ? fromCivil(+m[1], +m[2], +m[3], +m[4], +m[5]) : NaN;
}

export function fmtDuration(sec) {
  const a = Math.abs(sec);
  if (a < 60) return a.toFixed(1) + ' s';
  if (a < 3600) return Math.floor(a / 60) + ' min ' + pad(a % 60) + ' s';
  if (a < 86400 * 2) return Math.floor(a / 3600) + ' h ' + pad((a % 3600) / 60) + ' min';
  if (a < 86400 * 800) return (a / 86400).toFixed(a < 86400 * 20 ? 2 : 1) + ' days';
  return (a / 86400 / 365.25).toFixed(2) + ' years';
}

export function fmtRelative(ms) {
  const a = Math.abs(ms) / 1000;
  if (a < 30) return 'now';
  const sign = ms > 0 ? '+' : '−';
  if (a < 3600) return sign + Math.round(a / 60) + ' min from now';
  if (a < 86400) return sign + (a / 3600).toFixed(1) + ' h from now';
  if (a < 86400 * 400) return sign + (a / 86400).toFixed(a < 86400 * 10 ? 1 : 0) + ' d from now';
  return sign + (a / 86400 / 365.25).toFixed(1) + ' yr from now';
}

export function fmtRate(r) {
  const s = r < 0 ? '−' : '', a = Math.abs(r);
  const u = x => a < x * 0.9995;
  if (u(60)) return s + a.toFixed(a < 10 ? 1 : 0) + '× real time';
  if (u(3600)) return s + (a / 60).toFixed(1) + ' min / s';
  if (u(86400)) return s + (a / 3600).toFixed(1) + ' h / s';
  if (u(86400 * 60)) return s + (a / 86400).toFixed(a < 86400 * 10 ? 2 : 1) + (a < 86400 * 1.0005 ? ' day / s' : ' days / s');
  return s + (a / 31557600).toFixed(2) + ' years / s';
}

export function fmtDist(km) {
  if (km < 1e6) return Math.round(km).toLocaleString('en-US') + ' km';
  const au = km / AU_KM;
  return (au < 0.1 ? au.toFixed(5) : au.toFixed(4)) + ' AU (' + (km / 1e6).toFixed(km < 1e8 ? 2 : 1) + ' million km)';
}
export function fmtLight(km) { return fmtDuration(km * LIGHT_S_PER_KM) + ' at light speed'; }

export function fmtMass(kg) {
  const e = Math.floor(Math.log10(kg)), m = kg / Math.pow(10, e);
  return m.toFixed(3) + ' × 10^' + e + ' kg';
}

export function fmtAngle(rad, dec = 2) { return (rad * 180 / Math.PI).toFixed(dec) + '°'; }
export function fmtHours(h) {
  const a = Math.abs(h);
  return a < 48 ? a.toFixed(a < 30 ? 2 : 1) + ' h' : (a / 24).toFixed(2) + ' days';
}
export function fmtRA(hours) {
  const h = ((hours % 24) + 24) % 24, m = (h - Math.floor(h)) * 60;
  return pad(Math.floor(h)) + 'h ' + pad(Math.floor(m)) + 'm ' + ((m - Math.floor(m)) * 60).toFixed(1).padStart(4, '0') + 's';
}
export function fmtDec(deg) {
  const a = Math.abs(deg), m = (a - Math.floor(a)) * 60;
  return (deg < 0 ? '−' : '+') + pad(Math.floor(a)) + '° ' + pad(Math.floor(m)) + '′ ' + pad(Math.round((m - Math.floor(m)) * 60)) + '″';
}
