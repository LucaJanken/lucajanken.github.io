// Upcoming and past eclipses and transits, searched from the ephemeris itself (not a hard-coded list).
import * as A from '../../vendor/astronomy.min.js';

const KIND = { penumbral: 'Penumbral', partial: 'Partial', annular: 'Annular', total: 'Total' };

function fmtLatLon(lat, lon) {
  if (lat === undefined || lat === null || Number.isNaN(lat)) return '';
  const la = Math.abs(lat).toFixed(0) + '°' + (lat >= 0 ? 'N' : 'S');
  const lo = Math.abs(lon).toFixed(0) + '°' + (lon >= 0 ? 'E' : 'W');
  return la + ' ' + lo;
}

/** Eclipses (solar and lunar) and transits of Mercury and Venus, from `start` onward. */
export function upcomingEvents(start, { solar = 5, lunar = 5, transits = 2 } = {}) {
  const out = [];
  try {
    let e = A.SearchGlobalSolarEclipse(start);
    for (let k = 0; k < solar; k++) {
      out.push({
        kind: 'solar', sub: e.kind, date: e.peak.date,
        title: KIND[e.kind] + ' solar eclipse',
        where: e.kind === 'partial' ? 'partial only (polar regions)' : 'greatest eclipse ' + fmtLatLon(e.latitude, e.longitude),
        lat: e.latitude, lon: e.longitude,
      });
      e = A.NextGlobalSolarEclipse(e.peak);
    }
    let l = A.SearchLunarEclipse(start);
    for (let k = 0; k < lunar; k++) {
      const dur = l.kind === 'total' ? l.sd_total * 2 : l.kind === 'partial' ? l.sd_partial * 2 : l.sd_penum * 2;
      out.push({
        kind: 'lunar', sub: l.kind, date: l.peak.date,
        title: KIND[l.kind] + ' lunar eclipse',
        where: (l.kind === 'total' ? 'totality ' : l.kind === 'partial' ? 'partial phase ' : 'penumbral phase ') + Math.round(dur) + ' min',
      });
      l = A.NextLunarEclipse(l.peak);
    }
    for (const body of ['Mercury', 'Venus']) {
      let t = A.SearchTransit(A.Body[body], start);
      for (let k = 0; k < transits; k++) {
        out.push({ kind: 'transit', sub: body, date: t.peak.date, title: 'Transit of ' + body, where: 'across the Sun, seen from Earth' });
        t = A.NextTransit(A.Body[body], t.peak);
      }
    }
  } catch (err) { console.warn('event search failed', err); }
  out.sort((a, b) => a.date - b.date);
  return out;
}
