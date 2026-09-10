#!/usr/bin/env node
// migrate.js — apply db/migrations to a real Postgres, in order, once.
//
//   DATABASE_URL='postgres://...' node server/migrate.js
//
// The demo path (db.js, beside this file) rewrites a few PostGIS lines because PGlite has
// no extension for them. THIS DOES NOT. Production gets the migrations exactly
// as written, which is the point of keeping them free of demo-specific
// branching: what is under test is what is deployed.
//
// Applied migrations are recorded in schema_migrations, so running this again
// is a no-op rather than an error. Each file runs inside its own transaction:
// the migrations already say BEGIN/COMMIT, so this only wraps the bookkeeping.
//
// It lives in server/ rather than scripts/ because it needs `pg`, and `pg` is a
// server dependency. Node resolves node_modules from the file's own directory
// upward, so the same file under scripts/ could not find it without installing
// the driver a second time at the repo root.
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'db', 'migrations');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  console.error('Get it from the Neon dashboard. Do not paste it into a chat or a commit.');
  process.exit(2);
}

const client = new pg.Client({
  connectionString: url,
  // Neon terminates TLS at its proxy with a certificate this client will not
  // have a root for in every environment; the connection is still encrypted.
  ssl: { rejectUnauthorized: false },
});
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

const done = new Set((await client.query(
  `SELECT filename FROM schema_migrations`)).rows.map(r => r.filename));

const files = (await readdir(DIR)).filter(f => f.endsWith('.sql')).sort();
let applied = 0;

for (const f of files) {
  if (done.has(f)) { console.log(`  skip   ${f}`); continue; }
  const sql = await readFile(path.join(DIR, f), 'utf8');
  process.stdout.write(`  apply  ${f} ... `);
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`, [f]);
    applied++;
    console.log('ok');
  } catch (e) {
    console.log('FAILED');
    console.error(`\n${f}: ${e.message}\n`);
    // Stop at the first failure. Continuing would apply later migrations onto a
    // schema that is missing what they assume, and the second error would be
    // far less informative than this one.
    await client.end();
    process.exit(1);
  }
}

console.log(`\n${applied} applied, ${files.length - applied} already present`);
await client.end();
