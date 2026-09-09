#!/usr/bin/env node
// build-beta.js — a real, empty build you can put on the internet.
//
//   npm run build:beta
//   → web/build/   upload the CONTENTS to Cloudflare Pages, Netlify, anywhere
//
// The difference from build:review is the data: nothing is seeded, so every
// figure is real and every figure is zero. That is the honest state of a site
// that has not opened for reports yet, and it is what a beta tester should see.
//
// WHAT THIS BUILD CANNOT DO. There is no write path on a static host, so it
// cannot accept a report. The form detects that on load and says so on the
// first screen. Testers can walk every screen; nothing is stored anywhere.
//
// It stays noindex (robots.txt + X-Robots-Tag in _headers). A beta with no
// data has no business in a search result for a Dhaka ward.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;

console.log('1/4  generating published data (real, empty)…');
const gen = spawnSync(node, [path.join(ROOT, 'scripts', 'generate-data.js')],
  { stdio: 'inherit', env: { ...process.env, DEMO: '0', MODE: 'beta' } });
if (gen.status !== 0) process.exit(gen.status ?? 1);

console.log('2/4  rebuilding the sharing card without the DEMO stripe…');
const card = spawnSync('python3', [path.join(ROOT, 'scripts', 'build_og_card.py'),
  '--font', path.join(ROOT, 'web', 'static', 'fonts', 'nirapod-sans.ttf')],
  { stdio: 'inherit' });
if (card.status !== 0) {
  console.warn('     (card not rebuilt: python3 or pillow missing. The old one stays.)');
}

console.log('3/4  building the static site…');
// build-web.js uses web/node_modules, which on Windows carries a win32 rollup
// binary. The same checkout mounted into a Linux shell cannot run it, so fall
// back to build_web.sh, which installs its own deps outside the repo.
let build = spawnSync(node, [path.join(ROOT, 'scripts', 'build-web.js')], { stdio: 'inherit' });
if (build.status !== 0 && process.platform !== 'win32') {
  console.log('     (retrying with scripts/build_web.sh)');
  build = spawnSync('bash', [path.join(ROOT, 'scripts', 'build_web.sh')], { stdio: 'inherit' });
}
if (build.status !== 0) process.exit(build.status ?? 1);

console.log('4/4  copying data into the build…');
const from = path.join(ROOT, 'web', 'data');
const to = path.join(ROOT, 'web', 'build', 'data');
await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const f of await readdir(from)) await cp(path.join(from, f), path.join(to, f));

// Host file-size limits. Cloudflare Pages refuses any file over 25 MiB, and
// the full-detail basemap is 47.8 MB, so an upload would fail at the very last
// step with a message that does not explain itself. Say it here instead.
const LIMIT = 25 * 1024 * 1024;
const { stat } = await import('node:fs/promises');
const oversize = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full);
    else {
      const { size } = await stat(full);
      if (size > LIMIT) oversize.push([full, size]);
    }
  }
}
await walk(path.join(ROOT, 'web', 'build'));
if (oversize.length) {
  console.warn('\nHEADS UP — files over 25 MiB (Cloudflare Pages will reject these):');
  for (const [f, size] of oversize) {
    console.warn(`  ${(size / 1048576).toFixed(1)} MiB  ${path.relative(ROOT, f)}`);
  }
  console.warn('\nEither deploy somewhere with a higher limit (GitHub Pages allows 100 MB');
  console.warn('per file, so does Netlify), or cut the basemap to zoom 14:');
  console.warn('  pmtiles extract web/static/dhaka.pmtiles web/build/dhaka.pmtiles --maxzoom=14');
  console.warn('That is 23.8 MiB and still sharp when overzoomed. See docs/TILES.md.\n');
}

for (const f of ['robots.txt', '_headers']) {
  try {
    await access(path.join(ROOT, 'web', 'build', f));
  } catch {
    console.error(`\nrefusing to finish: web/build/${f} is missing.`);
    process.exit(1);
  }
}

console.log(`\ndone. Upload the CONTENTS of:\n  ${path.join(ROOT, 'web', 'build')}\n`);
console.log('Every figure in it is real and every figure is zero.');
console.log('It cannot accept a report: there is no write path on a static host.');
