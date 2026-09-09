// places.js — searching Dhaka by the names people actually use.
//
// Nobody thinks in ward numbers. They think "Panthapath", or the name of the
// road they were standing on. Until this existed the location box could only
// match ward names, so the one thing a reporter would naturally type found
// nothing at all.
//
// The index is built by scripts/build_gazetteer.js out of the vector tiles this
// repo already ships, NOT from a geocoding API. Sending a reporter's search for
// the street where they were mugged to a third party is exactly what this site
// refuses to do, and a self-hosted list means the search works with the network
// panel empty.
//
// Loaded on demand: 352 KB is not worth downloading for a visitor who only
// reads the map.
let cache = null;
let inflight = null;

export async function loadPlaces() {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch('/geo/places.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => { cache = rows; inflight = null; return rows; })
    .catch(() => { inflight = null; return []; });
  return inflight;
}

// OSM spells the same road three ways: "Panthapath", "Pantha Path",
// "Panthopath". Stripping everything that is not a letter or digit makes those
// one search key, so typing any of them finds all of them.
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9ঀ-৿]/g, '');

/**
 * Rank matters more than filtering here. Someone typing "gulshan" wants the
 * neighbourhood first, not "Gulshan Lake Park Road", so an exact hit beats a
 * prefix, a prefix beats a substring, and a place beats a road at equal score.
 */
export function searchPlaces(rows, query, limit = 8) {
  const q = norm(query);
  if (q.length < 2) return [];
  const out = [];
  for (const r of rows) {
    const en = norm(r.n), bn = norm(r.b);
    let score = -1;
    if (en === q || bn === q) score = 0;
    else if (en.startsWith(q) || bn.startsWith(q)) score = 1;
    else if (en.includes(q) || bn.includes(q)) score = 2;
    else continue;
    if (r.k === 'r') score += 0.5;          // places before roads at equal rank
    score += Math.min(en.length / 200, 0.4); // shorter names first within a tier
    out.push({ ...r, score });
  }
  out.sort((a, b) => a.score - b.score);
  return out.slice(0, limit);
}

/** What the reader sees: the name they typed, then where it is. */
export function placeLabel(p, lang) {
  return lang === 'bn' && p.b ? p.b : p.n;
}
export function placeWhere(p, lang) {
  const bits = [];
  if (p.t) bits.push(p.t);
  if (p.wn && p.wn !== p.t) bits.push(p.wn);
  const where = bits.join(', ');
  const kind = p.k === 'p' ? (lang === 'bn' ? 'এলাকা' : 'area')
                           : (lang === 'bn' ? 'রাস্তা' : 'road');
  return where ? `${kind} · ${where}` : kind;
}
