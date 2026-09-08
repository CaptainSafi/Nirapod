#!/usr/bin/env node
// dev.js — run the whole thing with one command, on any OS.
//
//   npm run dev              API server + Vite dev server with hot reload
//   npm run dev -- --no-vite API server only, serving the built static site
//
// Two processes are needed because the architecture has two halves: a
// write-only API and a static read path. Vite serves the frontend and proxies
// /api and /data to the API server, which is the same shape as production
// (Cloudflare Pages in front, an edge function for writes) — so a thing that
// works in dev works deployed.
//
// No dependency on `concurrently` or similar: this file is the whole runner.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noVite = process.argv.includes('--no-vite');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

const env = {
  ...process.env,
  DEMO: process.env.DEMO ?? '1',          // synthetic data unless told otherwise
  BATCH_MS: process.env.BATCH_MS ?? '15000',
};

function need(dir, label) {
  if (existsSync(path.join(ROOT, dir, 'node_modules'))) return null;
  console.log(`installing ${label} dependencies (first run only)…`);
  const r = spawnSync(npm, ['install', '--no-fund', '--no-audit'],
    { cwd: path.join(ROOT, dir), stdio: 'inherit', shell: isWin });   // npm.cmd needs the shell
  if (r.status !== 0) {
    console.error(`\n${label} install failed. Run it by hand:  cd ${dir} && npm install`);
    process.exit(1);
  }
}
need('server', 'server');
if (!noVite) need('web', 'web');

const children = [];
// `shell` is needed on Windows ONLY to run npm.cmd — Node itself is a real
// executable. Using a shell for Node breaks the moment any path contains a
// space ("H:\\Dev Games\\..." becomes two arguments and Node reports
// "Cannot find module 'H:\\Dev'"), so it is opt-in per command.
function run(name, cmd, args, cwd, colour, useShell = false) {
  const c = spawn(cmd, args, { cwd, env, shell: useShell });
  children.push(c);
  const tag = `\x1b[${colour}m[${name}]\x1b[0m `;
  const pipe = (stream, to) => stream.on('data', d => {
    for (const line of String(d).split('\n')) {
      if (!line.trim()) continue;
      // Vite silently moves to the next free port. Echo the port it actually
      // took, so the URL printed below is never a lie.
      const m = line.match(/Local:\s+(http:\/\/\S+)/);
      if (m) console.log(`\n  site        ${m[1].replace(/\/$/, '')}   (hot reload)\n`);
      to.write(tag + line + '\n');
    }
  });
  pipe(c.stdout, process.stdout);
  pipe(c.stderr, process.stderr);
  c.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`${tag}exited with ${code}`);
    shutdown();
  });
  return c;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) { try { c.kill(); } catch { /* already gone */ } }
  setTimeout(() => process.exit(0), 200);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('api', process.execPath, [path.join(ROOT, 'server', 'index.js')], ROOT, '33');   // no shell

if (!noVite) {
  run('web', npm, ['run', 'dev', '--', '--port', '5173'], path.join(ROOT, 'web'), '36', isWin);
  console.log('\n  site        starting…   (the URL appears below once Vite is up)');
} else {
  console.log('\n  site        http://localhost:8787');
}
console.log('  moderation  http://localhost:8788/?token=' +
  (process.env.MOD_TOKEN ?? 'demo-moderator-token'));
console.log('  Ctrl+C to stop\n');
