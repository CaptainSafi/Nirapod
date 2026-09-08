#!/usr/bin/env node
// ingest_geo.js — emit SQL to load ward/thana boundaries into PostGIS.
//
//   node scripts/ingest_geo.js | psql "$DATABASE_URL"
//
// ST_Multi() is not decoration: the source files contain Polygon geometries
// and the column is geometry(MultiPolygon,4326), which rejects a bare Polygon.
// Normalising here means one shape type in the database and no per-row
// branching in every query that touches geometry afterwards.
//
// Idempotent: re-running updates names and boundaries in place rather than
// duplicating wards, so a boundary correction is a re-run.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = path.join(ROOT, 'db', 'seeds');
const q = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

const geom = (g) =>
  `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${q(JSON.stringify(g))}), 4326))`;

const thanas = JSON.parse(await readFile(path.join(SEEDS, 'dhaka_thanas.geojson'), 'utf8'));
const wards  = JSON.parse(await readFile(path.join(SEEDS, 'dhaka_wards.geojson'), 'utf8'));

console.log('BEGIN;');
for (const f of thanas.features) {
  const p = f.properties;
  console.log(
    `INSERT INTO thanas (id,name_bn,name_en,division,district,geometry) VALUES ` +
    `(${p.id},${q(p.name_bn ?? p.name_en)},${q(p.name_en)},${q(p.division)},` +
    `${q(p.district)},${geom(f.geometry)})\n` +
    `ON CONFLICT (id) DO UPDATE SET name_bn=EXCLUDED.name_bn, name_en=EXCLUDED.name_en, ` +
    `geometry=EXCLUDED.geometry;`);
}
for (const f of wards.features) {
  const p = f.properties;
  console.log(
    `INSERT INTO wards (id,thana_id,name_bn,name_en,division,district,upazila,geometry,population,source) VALUES ` +
    `(${p.id},${p.thana_id},${q(p.name_bn ?? p.name_en)},${q(p.name_en)},${q(p.division)},` +
    `${q(p.district)},${q(p.upazila)},${geom(f.geometry)},${p.population ?? 'NULL'},${q(p.source)})\n` +
    `ON CONFLICT (id) DO UPDATE SET thana_id=EXCLUDED.thana_id, name_bn=EXCLUDED.name_bn, ` +
    `name_en=EXCLUDED.name_en, geometry=EXCLUDED.geometry, population=EXCLUDED.population;`);
}
console.log(`SELECT setval(pg_get_serial_sequence('wards','id'), (SELECT max(id) FROM wards));`);
console.log(`SELECT setval(pg_get_serial_sequence('thanas','id'), (SELECT max(id) FROM thanas));`);
console.log('COMMIT;');
