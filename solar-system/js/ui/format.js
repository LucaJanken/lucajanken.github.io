// Number and time formatting for the HUD.
import { AU_KM } from '../astro/ephemeris.js';

export const pad = (n, w = 2) => String(Math.trunc(n)).padStart(w, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIGHT_S_PER_KM = 1 / 299792.458;

export function fmtDate(d, utc = false) {
  const y = utc ? d.getUTCFullYear() : d.getFullYear(), m = utc ? d.getUTCMonth() : d.getMonth(), day = utc ? d.getUTCDate() : d.getDate();
  return pad(day) + ' ' + MON[m] + ' ' + y;
}
export function fmtTime(d, utc = false, secs = true) {
  const h = utc ? d.getUTCHours() : d.getHours(), m = utc ? d.getUTCMinutes() : d.getMinutes(), s = utc ? d.getUTCSeconds() : d.getSeconds();
  return pad(h) + ':' + pad(m) + (secs ? ':' + pad(s) : '');
}
export function tzName(d) {
  const off = -d.getTimezoneOffset();
  return 'UTC' + (off >= 0 ? '+' : '−') + Math.floor(Math.abs(off) / 60) + (Math.abs(off) % 60 ? ':' + pad(Math.abs(off) % 60) : '');
}
// value for <input type=datetime-local> (local time)
export function localInput(d) {
  return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
