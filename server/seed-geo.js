#!/usr/bin/env node
// seed-geo.js — put Dhaka's wards and thanas into a real Postgres, once.
//
//   DATABASE_URL='postgres://...' node server/seed-geo.js
//
// WHY THIS IS NOT loadGeo() FROM db.js. That function inserts the geometry as a
// JSON string, because the demo runs PGlite where the column is jsonb. In
// production the column is geometry(MultiPolygon, 4326) and the same insert
// would fail. This is the one place the demo and production genuinely diverge,
// and it diverges here rather than by shimming the migrations, so the schema
// under test stays byte-identical to the schema deployed.
//
// It uses db/seeds/full_precision: the simplified copies exist so the demo
// starts quickly, but the database geometry is what decides which ward a
// reported hazard falls in, and a simplified boundary puts points in the wrong
// ward near every edge.
//
// Safe to re-run: ON CONFLICT DO NOTHING, then the id sequences are set past
// what was inserted.
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = path.join(ROOT, 'db', 'seeds', 'full_precision');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }

const client = new pg.Client({ connectionString: url });
await client.connect();

const geo = (f) => JSON.stringify(f.geometry);
// ST_GeomFromGeoJSON returns whatever the GeoJSON was; ST_Multi normalises a
// stray Polygon into the MultiPolygon the column requires, which some of these
// features are.
const GEOM = 'ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($GEOJSON$), 4326))';

const thanas = JSON.parse(await readFile(path.join(SEEDS, 'dhaka_thanas.geojson'), 'utf8'));
const wards = JSON.parse(await readFile(path.join(SEEDS, 'dhaka_wards.geojson'), 'utf8'));

let t = 0;
for (const f of thanas.features) {
  const p = f.properties;
  const r = await client.query(
    `INSERT INTO thanas (id,name_bn,name_en,division,district,geometry)
     VALUES ($1,$2,$3,$4,$5, ${GEOM.replace('$GEOJSON$', '$6')})
     ON CONFLICT DO NOTHING`,
    [p.id, p.name_bn ?? p.name_en, p.name_en, p.division, p.district, geo(f)]);
  t += r.rowCount;
}

let w = 0;
for (const f of wards.features) {
  const p = f.properties;
  const r = await client.query(
    `INSERT INTO wards (id,thana_id,name_bn,name_en,division,district,upazila,geometry,population,source)
     VALUES ($1,$2,$3,$4,$5,$6,$7, ${GEOM.replace('$GEOJSON$', '$8')}, $9,$10)
     ON CONFLICT DO NOTHING`,
    [p.id, p.thana_id, p.name_bn ?? p.name_en, p.name_en, p.division,
     p.district, p.upazila, geo(f), p.population, p.source]);
  w += r.rowCount;
}

// Both tables have explicit ids in the seed, so the sequence has never been
// used and would otherwise hand out 1 for the next insert.
await client.query(`SELECT setval(pg_get_serial_sequence('thanas','id'), (SELECT max(id) FROM thanas))`);
await client.query(`SELECT setval(pg_get_serial_sequence('wards','id'),  (SELECT max(id) FROM wards))`);

const counts = (await client.query(
  `SELECT (SELECT count(*) FROM thanas) AS thanas, (SELECT count(*) FROM wards) AS wards`)).rows[0];
console.log(`inserted ${t} thanas and ${w} wards`);
console.log(`table now holds ${counts.thanas} thanas and ${counts.wards} wards`);

await client.end();
