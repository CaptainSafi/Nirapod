#!/usr/bin/env node
// generate-data.js — run the seed and the batch publish once, then exit.
// Used by build:review so the static bundle carries a full set of data files
// without anyone having to leave a server running.
import { open, SEEDS } from '../server/db.js';
import { publish } from '../server/aggregate.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = process.env.DEMO === '1';
// MODE=beta publishes a real but empty set: nothing seeded, nothing invented.
const MODE = process.env.MODE || (DEMO ? 'demo' : 'live');

const db = await open();
if (DEMO) {
  const { seed } = await import('../server/demo_seed.js');
  const s = await seed(db);
  console.log(`     seeded ${s.reports} reports and ${s.hazards} hazards — all synthetic`);
}
const out = await publish(db, path.join(ROOT, 'web', 'data'),
  { seedsDir: SEEDS, demo: DEMO, mode: MODE });
console.log(`     mode=${MODE}`);
console.log(`     published ${out.published} of ${out.cells} cells, ` +
            `${out.hazards} hazards, ${out.methods} method patterns`);
process.exit(0);
