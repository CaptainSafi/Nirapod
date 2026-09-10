#!/usr/bin/env node
// make-roles.js — give the three database roles passwords, and print the
// connection strings that use them. Run once, after migrate.js.
//
//   DATABASE_URL='postgres://<owner>...' node server/make-roles.js
//
// WHY BOTHER, when one connection string already works. Because the string in
// the Cloudflare dashboard is going to sit in a settings page, in a build log
// if something goes wrong, and in whatever copies of it exist afterwards. The
// question is not whether it leaks, it is what it can do when it does.
//
//   nirapod_submit      INSERT on reports and hazards. Cannot SELECT them.
//                       If the Worker's string leaks, the holder can add rows.
//                       They cannot read a single report.
//   nirapod_aggregator  SELECT only, plus the public_* functions. Used by the
//                       hourly publish job, which needs to read and must never
//                       write.
//   nirapod_moderator   SELECT and UPDATE, plus the moderation tables. This is
//                       the powerful one. Do not put it anywhere automated.
//
// The grants themselves are in 0005 and 0010; this only makes the roles able to
// log in. Passwords are generated here and printed ONCE. They are not stored,
// not written to a file, and not recoverable: run this again to rotate them.
import pg from 'pg';
import { randomBytes } from 'node:crypto';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }

// URL-safe, so it survives being embedded in a connection string without
// escaping. 24 bytes of base64url is 192 bits.
const password = () => randomBytes(24).toString('base64url');

const client = new pg.Client({ connectionString: url });
await client.connect();

const ROLES = ['nirapod_submit', 'nirapod_aggregator', 'nirapod_moderator'];
const made = {};

for (const role of ROLES) {
  const exists = await client.query(
    `SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
  if (!exists.rows.length) {
    console.error(`role ${role} does not exist. Run server/migrate.js first.`);
    await client.end();
    process.exit(1);
  }
  const pw = password();
  // Identifiers cannot be parameterised; the role names are a fixed list above,
  // never user input. The password IS parameterised via format(%L).
  await client.query(
    `DO $$ BEGIN EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1, $2); END $$`,
    [role, pw]);
  made[role] = pw;
}

// Neon needs the role to own nothing but still see the schema.
for (const role of ROLES) {
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
}

const base = new URL(url.replace(/^postgres(ql)?:\/\//, 'https://'));
const host = base.host;
const dbname = base.pathname.replace(/^\//, '') || 'neondb';
const pooled = host.includes('-pooler') ? host : host.replace(/^([^.]+)\./, '$1-pooler.');
const direct = host.replace('-pooler', '');

console.log('\nPaste these where they belong. They are shown once and are not stored.\n');
console.log('CLOUDFLARE PAGES  ->  Settings, Environment variables, DATABASE_URL (encrypted)');
console.log(`postgresql://nirapod_submit:${made.nirapod_submit}@${pooled}/${dbname}?sslmode=verify-full\n`);
console.log('GITHUB            ->  Settings, Secrets, Actions, DATABASE_URL_AGGREGATOR');
console.log(`postgresql://nirapod_aggregator:${made.nirapod_aggregator}@${direct}/${dbname}?sslmode=verify-full\n`);
console.log('KEEP SOMEWHERE SAFE, NOT IN A DASHBOARD  ->  moderator');
console.log(`postgresql://nirapod_moderator:${made.nirapod_moderator}@${direct}/${dbname}?sslmode=verify-full\n`);
console.log('Do not paste any of these into a chat, a commit, or an issue.');

await client.end();
