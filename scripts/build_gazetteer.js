#!/usr/bin/env node
// build_gazetteer.js — a searchable list of Dhaka place and road names.
//
//   node scripts/build_gazetteer.js
//   -> web/static/geo/places.json
//
// WHY. The location box could only ever find ward names, so typing a place
// people actually use ("Panthapath") found nothing. Nobody thinks in ward
// numbers; they think in the name of the road they were standing on.
//
// WHERE THE NAMES COME FROM. Not a geocoding API: sending a reporter's search
// for the street where they were mugged to a third party is exactly what this
// site refuses to do. The names are already in the vector tiles this repo
// builds, so this reads them straight back out of web/static/tiles/base and
// stamps each one with the ward it falls in.
//
// This decodes MVT by hand. The format is small (protobuf wire format, command
// integers, zigzag deltas) and hand-decoding it beats depending on a package
// registry that is not always reachable from where this runs.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILES = path.join(ROOT, 'web', 'static', 'tiles', 'base');
const WARDS = path.join(ROOT, 'db', 'seeds', 'dhaka_wards.geojson');
// NOT web/static/data: the build wipes that folder and refills it from
// web/data (the published aggregates). This is a different kind of file.
const OUT_DIR = path.join(ROOT, 'web', 'static', 'geo');

// ---------- protobuf wire reader ----------
function Reader(buf) {
  return { buf, p: 0, end: buf.length };
}
function varint(r) {
  let result = 0, shift = 0, b;
  do { b = r.buf[r.p++]; result += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
  return result;
}
function skip(r, wire) {
  if (wire === 0) varint(r);
  else if (wire === 1) r.p += 8;
  else if (wire === 2) r.p += varint(r);
  else if (wire === 5) r.p += 4;
  else throw new Error('bad wire type ' + wire);
}
function sub(r) { const len = varint(r); const s = Reader(r.buf.subarray(r.p, r.p + len)); r.p += len; return s; }
function str(r) { const len = varint(r); const s = r.buf.toString('utf8', r.p, r.p + len); r.p += len; return s; }

// ---------- MVT ----------
function readValue(r) {
  let v = null;
  while (r.p < r.end) {
    const tag = varint(r), f = tag >> 3, w = tag & 7;
    if (f === 1 && w === 2) v = str(r);
    else if (f === 4 && w === 0) v = varint(r);
    else if (f === 5 && w === 0) v = varint(r);
    else skip(r, w);
  }
  return v;
}

// Geometry: commands are (id & 7) with (id >> 3) repeats. 1 = MoveTo,
// 2 = LineTo, 7 = ClosePath. Coordinates are zigzag-encoded deltas.
function firstPoint(geomWords) {
  let x = 0, y = 0, i = 0;
  while (i < geomWords.length) {
    const cmd = geomWords[i] & 7, count = geomWords[i] >> 3;
    i++;
    if (cmd === 7) continue;
    for (let k = 0; k < count; k++) {
      const dx = (geomWords[i] >> 1) ^ (-(geomWords[i] & 1)); i++;
      const dy = (geomWords[i] >> 1) ^ (-(geomWords[i] & 1)); i++;
      x += dx; y += dy;
      // The first vertex is a good enough anchor for a search result: it puts
      // the map on the right road, and the reporter drops the pin themselves.
      return [x, y];
    }
  }
  return null;
}

function readFeature(r) {
  const out = { tags: [], geom: [], type: 0 };
  while (r.p < r.end) {
    const tag = varint(r), f = tag >> 3, w = tag & 7;
    if (f === 2 && w === 2) { const s = sub(r); while (s.p < s.end) out.tags.push(varint(s)); }
    else if (f === 3 && w === 0) out.type = varint(r);
    else if (f === 4 && w === 2) { const s = sub(r); while (s.p < s.end) out.geom.push(varint(s)); }
    else skip(r, w);
  }
  return out;
}

function readLayer(r) {
  const layer = { name: '', extent: 4096, keys: [], values: [], features: [] };
  while (r.p < r.end) {
    const tag = varint(r), f = tag >> 3, w = tag & 7;
    if (f === 1 && w === 2) layer.name = str(r);
    else if (f === 2 && w === 2) layer.features.push(readFeature(sub(r)));
    else if (f === 3 && w === 2) layer.keys.push(str(r));
    else if (f === 4 && w === 2) layer.values.push(readValue(sub(r)));
    else if (f === 5 && w === 0) layer.extent = varint(r);
    else skip(r, w);
  }
  return layer;
}

function readTile(buf) {
  const r = Reader(buf), layers = [];
  while (r.p < r.end) {
    const tag = varint(r), f = tag >> 3, w = tag & 7;
    if (f === 3 && w === 2) layers.push(readLayer(sub(r)));
    else skip(r, w);
  }
  return layers;
}

// ---------- geo ----------
const tile2lon = (x, z) => x / 2 ** z * 360 - 180;
const tile2lat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(lon, lat, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    if (!pointInRing(lon, lat, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(lon, lat, poly[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

// ---------- walk ----------
if (!existsSync(TILES)) {
  console.error(`no tiles at ${TILES}. Run the build once so they are unpacked.`);
  process.exit(1);
}

const wards = JSON.parse(readFileSync(WARDS, 'utf8')).features.map((f) => {
  const c = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const ring of (f.geometry.type === 'Polygon' ? [c[0]] : c.map((p) => p[0] ?? p))) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { id: String(f.properties.id ?? f.properties.ward_id ?? ''),
           name: f.properties.name ?? f.properties.ward_name ?? '',
           thana: f.properties.thana ?? f.properties.thana_name ?? '',
           geom: f.geometry, bbox: [minX, minY, maxX, maxY] };
});
console.log(`wards loaded: ${wards.length}`);

function wardAt(lon, lat) {
  for (const w of wards) {
    const [a, b, c, d] = w.bbox;
    if (lon < a || lon > c || lat < b || lat > d) continue;
    if (pointInPolygon(lon, lat, w.geom)) return w;
  }
  return null;
}

const found = new Map(); // key -> entry
let tilesRead = 0;

function walk(dir, z) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, z ?? Number(e.name)); continue; }
    if (!e.name.endsWith('.pbf')) continue;
    const parts = full.split(path.sep);
    const y = Number(parts[parts.length - 1].replace('.pbf', ''));
    const x = Number(parts[parts.length - 2]);
    const zz = Number(parts[parts.length - 3]);
    tilesRead++;
    let layers;
    try { layers = readTile(readFileSync(full)); } catch { continue; }
    for (const layer of layers) {
      if (layer.name !== 'places' && layer.name !== 'roads') continue;
      for (const f of layer.features) {
        const props = {};
        for (let i = 0; i < f.tags.length; i += 2) props[layer.keys[f.tags[i]]] = layer.values[f.tags[i + 1]];
        const name = props.name_en || props.name;
        if (!name || typeof name !== 'string' || name.length < 2) continue;
        const pt = firstPoint(f.geom);
        if (!pt) continue;
        const lon = tile2lon(x + pt[0] / layer.extent, zz);
        const lat = tile2lat(y + pt[1] / layer.extent, zz);
        // One entry per name. A road crosses many tiles and a place repeats
        // across zooms; the deepest zoom wins because its geometry is finest.
        const key = name.toLowerCase() + '|' + layer.name;
        const prev = found.get(key);
        if (prev && prev.z >= zz) continue;
        found.set(key, { name, bn: typeof props.name === 'string' ? props.name : null,
                         kind: layer.name === 'places' ? 'place' : 'road',
                         lon, lat, z: zz });
      }
    }
  }
}
walk(TILES);
console.log(`tiles read: ${tilesRead}, distinct names: ${found.size}`);

const out = [];
for (const e of found.values()) {
  const w = wardAt(e.lon, e.lat);
  if (!w) continue; // outside the published wards: not somewhere a report can land
  out.push({
    n: e.name,
    b: e.bn && e.bn !== e.name ? e.bn : undefined,
    k: e.kind === 'place' ? 'p' : 'r',
    // Five decimals is about a metre. More is false precision from a tile
    // vertex and makes the file bigger for nothing.
    o: Number(e.lon.toFixed(5)),
    a: Number(e.lat.toFixed(5)),
    w: w.id,
    wn: w.name || undefined,
    t: w.thana || undefined,
  });
}
// Places before roads, then alphabetical: a neighbourhood is more often what
// someone means than a road with a similar name.
out.sort((p, q) => (p.k === q.k ? p.n.localeCompare(q.n) : p.k === 'p' ? -1 : 1));

mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, 'places.json');
writeFileSync(file, JSON.stringify(out));
const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0);
console.log(`wrote ${out.length} entries (${kb} KB) -> web/static/geo/places.json`);
console.log(`  places: ${out.filter((e) => e.k === 'p').length}, roads: ${out.filter((e) => e.k === 'r').length}`);
