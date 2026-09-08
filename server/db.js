// db.js — demo database.
//
// The demo runs PGlite (Postgres 16 compiled to WASM) so it starts with no
// install and no account. Production is Supabase Postgres + PostGIS.
//
// ONE schema, two targets. The migrations in db/migrations are the source of
// truth and are applied verbatim except for the PostGIS-specific lines, which
// PGlite has no extension for. Every constraint, grant and suppression rule
// under test is identical in both. The shim below is deliberately narrow and
// loud: if it ever has to touch anything except geometry, that is a signal the
// demo has drifted from production and the drift must be fixed, not shimmed.

import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS = path.join(ROOT, 'db', 'migrations');
export const SEEDS = path.join(ROOT, 'db', 'seeds');

const SHIMS = [
  // PostGIS is not available in PGlite. Ward polygons are stored as GeoJSON
  // for the demo; the read path serves them as static files either way, and
  // nothing in the app queries them spatially at request time.
  [/CREATE EXTENSION IF NOT EXISTS postgis;/g, '-- [demo] postgis omitted'],
  // gen_random_uuid() is core in Postgres 16; the extension is only needed on
  // older servers.
  [/CREATE EXTENSION IF NOT EXISTS pgcrypto;.*$/gm, '-- [demo] pgcrypto is core in pg16'],
  [/geometry\(MultiPolygon,\s*4326\)/g, 'jsonb'],
  [/geometry\(Point,\s*4326\)/g, 'jsonb'],
  [/CREATE INDEX \w+ ON \w+ USING GIST \([\w]+\);/g, '-- [demo] no GIST without postgis'],
];

// Minimal stand-ins for the handful of PostGIS functions the migrations call,
// operating on GeoJSON in jsonb. This exists so the migrations themselves stay
// byte-identical between demo and production — the alternative is a second
// copy of the schema, which would drift, and schema drift in this project
// means a suppression rule that is true in the demo and false in production.
const POSTGIS_LITE = `
CREATE FUNCTION ST_MakePoint(x double precision, y double precision) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object('type','Point','coordinates', jsonb_build_array(x, y)) $$;
CREATE FUNCTION ST_SetSRID(g jsonb, srid integer) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$ SELECT g $$;
CREATE FUNCTION ST_Multi(g jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$ SELECT g $$;
CREATE FUNCTION ST_X(g jsonb) RETURNS double precision
  LANGUAGE sql IMMUTABLE AS $$ SELECT (g->'coordinates'->>0)::double precision $$;
CREATE FUNCTION ST_Y(g jsonb) RETURNS double precision
  LANGUAGE sql IMMUTABLE AS $$ SELECT (g->'coordinates'->>1)::double precision $$;
`;

function shim(sql) {
  return SHIMS.reduce((s, [re, to]) => s.replace(re, to), sql);
}

export async function open({ withSeeds = true } = {}) {
  const db = new PGlite();
  await db.exec(POSTGIS_LITE);
  const files = (await readdir(MIGRATIONS)).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = shim(await readFile(path.join(MIGRATIONS, f), 'utf8'));
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
  }
  if (withSeeds) await loadGeo(db);
  return db;
}

export async function loadGeo(db) {
  const thanas = JSON.parse(await readFile(path.join(SEEDS, 'dhaka_thanas.geojson'), 'utf8'));
  const wards  = JSON.parse(await readFile(path.join(SEEDS, 'dhaka_wards.geojson'), 'utf8'));

  for (const f of thanas.features) {
    const p = f.properties;
    await db.query(
      `INSERT INTO thanas (id,name_bn,name_en,division,district,geometry)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [p.id, p.name_bn ?? p.name_en, p.name_en, p.division, p.district,
       JSON.stringify(f.geometry)]);
  }
  for (const f of wards.features) {
    const p = f.properties;
    await db.query(
      `INSERT INTO wards (id,thana_id,name_bn,name_en,division,district,upazila,geometry,population,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [p.id, p.thana_id, p.name_bn ?? p.name_en, p.name_en, p.division,
       p.district, p.upazila, JSON.stringify(f.geometry), p.population,
       p.source]);
  }
  await db.query(`SELECT setval(pg_get_serial_sequence('wards','id'),
                    (SELECT max(id) FROM wards))`);
  await db.query(`SELECT setval(pg_get_serial_sequence('thanas','id'),
                    (SELECT max(id) FROM thanas))`);
}
