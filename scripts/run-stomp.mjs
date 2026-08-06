#!/usr/bin/env node
/**
 * Cross-platform launcher for the sibling starui stomp-view-server.
 *
 * Expects a checkout at ../starui (next to this repo) with a built
 * stomp-view-server (`npm run build` inside that app). Works on macOS,
 * Windows, and Linux — resolves paths via node:path, never shell globs.
 *
 * Override the entry with STOMP_SERVER_ENTRY=/abs/path/to/main.js
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const entry = process.env.STOMP_SERVER_ENTRY
  ? resolve(process.env.STOMP_SERVER_ENTRY)
  : resolve(repoRoot, '..', 'starui', 'apps', 'stomp-view-server', 'dist', 'main.js');

if (!existsSync(entry)) {
  console.error(`[stomp] stomp-view-server entry not found:
  ${entry}

Demos that need live data expect a sibling starui checkout:
  <parent>/
    canvasgrid/   ← this repo
    starui/       ← build apps/stomp-view-server first

Or set STOMP_SERVER_ENTRY to an absolute path to main.js.

Self-contained demos (no STOMP required):
  npm run dev:showcase
  npm run dev:ssrm-demo
  npm run dev:ext-ssrm-demo
  npm run dev:colgroups
  npm run dev:ag-showcase`);
  process.exit(1);
}

console.log(`[stomp] starting ${entry}`);
const child = spawn(process.execPath, [entry], {
  stdio: 'inherit',
  cwd: dirname(entry),
  env: process.env,
  // Windows: do not use shell — path may contain spaces; node handles argv.
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
