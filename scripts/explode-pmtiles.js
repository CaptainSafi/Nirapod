#!/usr/bin/env node
// explode-pmtiles.js — turn a PMTiles archive into ordinary {z}/{x}/{y}.pbf files.
//
//   node scripts/explode-pmtiles.js web/static/dhaka.pmtiles web/build/tiles/base
//
// WHY THIS EXISTS. PMTiles reads one archive over HTTP range requests. That is
// elegant and it is also a hard dependency on the host supporting byte serving.
// Cloudflare does not, on either Workers static assets or Pages: a ranged GET
// comes back 200 with the whole file, no accept-ranges, no content-range, and
// MapLibre dies with "content-length exceeding request" and paints nothing.
// Measured, not assumed, on both hosts.
//
// So the deploy stops depending on it. The archive stays the source of truth in
// web/static — it is what the Python tilers write and what you rebuild — and the
// build unpacks it into plain files that any static host on earth can serve.
// Nothing clever is left to break.
//
// Tiles are written with the bytes exactly as stored, which for our archives is
// gzip. web/static/_headers sets Content-Encoding: gzip on /tiles/* so the
// browser inflates them; MapLibre does not inflate tiles itself. Pass
// --inflate to write raw protobuf instead, if a host ever mangles that header.
import { openSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const [, , archive, outDir, ...rest] = process.argv;
if (!archive || !outDir) {
  console.error('usage: explode-pmtiles.js <archive.pmtiles> <out-dir> [--inflate]');
  process.exit(2);
}
const INFLATE = rest.includes('--inflate');

const fd = openSync(archive, 'r');
const read = (off, len) => { const b = Buffer.alloc(len); readSync(fd, b, 0, len, off); return b; };

const h = read(0, 127);
if (h.toString('utf8', 0, 7) !== 'PMTiles' || h[7] !== 3) {
  throw new Error(`${archive}: not a PMTiles v3 archive`);
}
const n = (o) => Number(h.readBigUInt64LE(o));
const header = {
  rootOffset: n(8), rootLength: n(16),
  metaOffset: n(24), metaLength: n(32),
  leafOffset: n(40), leafLength: n(48),
  dataOffset: n(56), dataLength: n(64),
  internalCompression: h[97], tileCompression: h[98],
  minZoom: h[100], maxZoom: h[101],
};

// 1 = none, 2 = gzip. Anything else (brotli, zstd) we have never written and
// will not guess at.
const decompress = (buf, kind) => {
  if (kind === 1) return buf;
  if (kind === 2) return gunzipSync(buf);
  throw new Error(`unsupported compression id ${kind}`);
};

// --- varint + directory -----------------------------------------------------
function reader(buf) {
  let p = 0;
  return {
    varint() {
      let result = 0, shift = 0, b;
      do { b = buf[p++]; result += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
      return result;
    },
    get done() { return p >= buf.length; },
  };
}

// PMTiles v3 directories are column-oriented: all the tile ids (as deltas),
// then all the run lengths, then all the lengths, then all the offsets. An
// offset of 0 means "directly after the previous entry", which is how a
// clustered archive stays small.
function deserializeDirectory(buf) {
  const r = reader(buf);
  const count = r.varint();
  const entries = new Array(count);
  let last = 0;
  for (let i = 0; i < count; i++) { last += r.varint(); entries[i] = { tileId: last }; }
  for (let i = 0; i < count; i++) entries[i].runLength = r.varint();
  for (let i = 0; i < count; i++) entries[i].length = r.varint();
  for (let i = 0; i < count; i++) {
    const v = r.varint();
    entries[i].offset = (v === 0 && i > 0)
      ? entries[i - 1].offset + entries[i - 1].length
      : v - 1;
  }
  return entries;
}

// --- Hilbert tile id -> z/x/y ----------------------------------------------
function rotate(size, x, y, rx, ry) {
  if (ry === 0) {
    if (rx === 1) { x = size - 1 - x; y = size - 1 - y; }
    return [y, x];
  }
  return [x, y];
}
function tileIdToZxy(id) {
  let acc = 0, z = 0;
  for (;;) {
    const tilesAtZoom = 4 ** z;
    if (acc + tilesAtZoom > id) break;
    acc += tilesAtZoom;
    z++;
  }
  let pos = id - acc, x = 0, y = 0;
  const size = 2 ** z;
  for (let s = 1; s < size; s *= 2) {
    const rx = 1 & Math.floor(pos / 2);
    const ry = 1 & (pos ^ rx);
    [x, y] = rotate(s, x, y, rx, ry);
    x += s * rx; y += s * ry;
    pos = Math.floor(pos / 4);
  }
  return [z, x, y];
}

// --- walk -------------------------------------------------------------------
const root = deserializeDirectory(
  decompress(read(header.rootOffset, header.rootLength), header.internalCompression));

const metadata = header.metaLength
  ? JSON.parse(decompress(read(header.metaOffset, header.metaLength),
                          header.internalCompression).toString('utf8'))
  : {};

let written = 0;
const zooms = new Set();
// Track the tile extent so the style can carry real bounds. Without them
// MapLibre asks for every tile in the viewport, most of which were never in
// the Dhaka extract, and the console fills with 404s for tiles that were never
// supposed to exist.
const extent = new Map(); // z -> {minX,maxX,minY,maxY}
function emit(entry) {
  // A run of length r means r consecutive tile ids share one blob — identical
  // tiles, usually empty ocean. Every id in the run needs its own file.
  for (let k = 0; k < Math.max(1, entry.runLength); k++) {
    const [z, x, y] = tileIdToZxy(entry.tileId + k);
    zooms.add(z);
    const e = extent.get(z) ?? { minX: x, maxX: x, minY: y, maxY: y };
    e.minX = Math.min(e.minX, x); e.maxX = Math.max(e.maxX, x);
    e.minY = Math.min(e.minY, y); e.maxY = Math.max(e.maxY, y);
    extent.set(z, e);
    const dir = path.join(outDir, String(z), String(x));
    mkdirSync(dir, { recursive: true });
    let blob = read(header.dataOffset + entry.offset, entry.length);
    if (INFLATE) blob = decompress(blob, header.tileCompression);
    writeFileSync(path.join(dir, `${y}.pbf`), blob);
    written++;
  }
}

for (const e of root) {
  if (e.runLength === 0) {
    // runLength 0 points at a leaf directory rather than a tile. Our archives
    // have no leaves (leafLength is 0), but handle it rather than silently
    // dropping tiles if a future rebuild grows one.
    const leaf = deserializeDirectory(
      decompress(read(header.leafOffset + e.offset, e.length), header.internalCompression));
    for (const le of leaf) {
      if (le.runLength === 0) throw new Error('nested leaf directories are not supported');
      emit(le);
    }
  } else {
    emit(e);
  }
}
closeSync(fd);

const zoomList = [...zooms].sort((a, b) => a - b);

// Tile extent at the deepest zoom -> a lon/lat bounding box. Slippy-map y runs
// north to south, so maxY gives the SOUTH edge.
function tileBounds(z, e) {
  const n = 2 ** z;
  const lon = (x) => x / n * 360 - 180;
  const lat = (y) => {
    const r = Math.PI - 2 * Math.PI * y / n;
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(r) - Math.exp(-r)));
  };
  return [lon(e.minX), lat(e.maxY + 1), lon(e.maxX + 1), lat(e.minY)];
}
const deepest = zoomList[zoomList.length - 1];
const bounds = tileBounds(deepest, extent.get(deepest));
console.log(`     ${path.basename(archive)} -> ${outDir}`);
console.log(`     ${written} tiles, zoom ${zoomList[0]}-${zoomList[zoomList.length - 1]}` +
            `${INFLATE ? ', inflated' : ', gzip as stored'}`);

// The style needs minzoom/maxzoom/bounds and they must match the archive, not
// a number somebody typed. Write them where the build can read them.
writeFileSync(path.join(outDir, 'tiles.json'), JSON.stringify({
  tilejson: '3.0.0',
  tiles: [],
  minzoom: header.minZoom,
  maxzoom: header.maxZoom,
  bounds: metadata.bounds ?? bounds.map((v) => Number(v.toFixed(6))),
  vector_layers: metadata.vector_layers ?? undefined,
}, null, 2) + '\n');
