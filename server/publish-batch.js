#!/usr/bin/env node
// publish-batch.js — run the batch publish against a real Postgres, once.
//
//   DATABASE_URL='postgres://...' MODE=live node server/publish-batch.js
//
// Called by .github/workflows/publish.yml on a schedule. It runs the SAME
// aggregate.js the demo and the tests run: every suppression rule that
// the 74 tests assert is the code that runs here. That is the whole reason the
// batch stayed in Node instead of being ported to a Worker.
//
// It writes web/data/*.json. The workflow commits them only if they changed,
// and that commit is what deploys the site.
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publish } from './aggregate.js';
import { SEEDS } from './db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }

const client = new pg.Client({ connectionString: url });
await client.connect();

// aggregate.js only ever calls db.query(text, params), which is exactly pg's
// shape, so no adapter is needed. If that stops being true this line is where
// it will break, loudly.
const out = await publish(client, path.join(ROOT, 'web', 'data'), {
  seedsDir: SEEDS,
  demo: false,
  mode: process.env.MODE ?? 'live',
});

console.log(`published ${out.published} of ${out.cells} cells, ` +
            `${out.hazards} hazards, ${out.methods} method patterns`);

await client.end();
