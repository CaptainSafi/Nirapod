#!/usr/bin/env node
// build-review.js — produce a folder that can be uploaded to any static host.
//
//   npm run build:review
//   → web/build/  (drag this onto Cloudflare Pages, Netlify, GitHub Pages…)
//
// It generates the published JSON once, builds the static site, and copies the
// data in beside it. No server is needed to view the result: the read path was
// always static, which is the whole point of the architecture.
//
// What the uploaded copy CANNOT do is accept a report — there is no write path
// on a static host. The submit form detects that and says so, rather than
// failing with a network error.

import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const node = process.execPath;

console.log('1/3  generating published data (synthetic demo set)…');
const gen = spawnSync(node, [path.join(ROOT, 'scripts', 'generate-data.js')],
  { stdio: 'inherit', env: { ...process.env, DEMO: '1' } });
if (gen.status !== 0) process.exit(gen.status ?? 1);

console.log('2/3  building the static site…');
const build = spawnSync(node, [path.join(ROOT, 'scripts', 'build-web.js')], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

console.log('3/3  copying data into the build…');
const from = path.join(ROOT, 'web', 'data');
const to = path.join(ROOT, 'web', 'build', 'data');
await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const f of await readdir(from)) {
  await cp(path.join(from, f), path.join(to, f));
}

// robots.txt and _headers come from web/static and are copied by the build.
// If either is missing the deploy is still functional but no longer protected,
// so fail loudly rather than shipping an indexable review build.
for (const f of ['robots.txt', '_headers']) {
  try {
    await access(path.join(ROOT, 'web', 'build', f));
  } catch {
    console.error(`\nrefusing to finish: web/build/${f} is missing.` +
      `\nIt should be copied from web/static/${f} by the build.`);
    process.exit(1);
  }
}

console.log(`\ndone. Upload the contents of:\n  ${path.join(ROOT, 'web', 'build')}\n`);
console.log('Everything in it is synthetic. The ward and thana names are real.');
