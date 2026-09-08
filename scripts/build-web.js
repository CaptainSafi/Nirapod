#!/usr/bin/env node
// build-web.js — cross-platform frontend build.
// On Windows and macOS this is just `npm --prefix web run build`.
// scripts/build_web.sh exists for the case where the repo sits on a mounted or
// synced drive and node_modules must live elsewhere; this is the normal path.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const web = path.join(ROOT, 'web');

if (!existsSync(path.join(web, 'node_modules'))) {
  spawnSync(npm, ['install', '--no-fund', '--no-audit'], { cwd: web, stdio: 'inherit', shell: isWin });
}
const r = spawnSync(npm, ['run', 'build'], { cwd: web, stdio: 'inherit', shell: isWin });
process.exit(r.status ?? 1);
