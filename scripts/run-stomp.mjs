#!/usr/bin/env node
/**
 * Cross-platform launcher for a stomp-view-server fixture.
 *
 * Resolution order:
 *   1. STOMP_SERVER_ENTRY=/abs/path/to/main.js
 *   2. ../ssrm-grid/apps/stomp-view-server/dist/main.js  (preferred — port 8082)
 *   3. ../starui/apps/stomp-view-server/dist/main.js     (legacy sibling)
 *
 * Works on macOS, Windows, and Linux — resolves paths via node:path.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const parent = resolve(repoRoot, '..');

const candidates = [
  process.env.STOMP_SERVER_ENTRY
    ? resolve(process.env.STOMP_SERVER_ENTRY)
    : null,
  resolve(parent, 'ssrm-grid', 'apps', 'stomp-view-server', 'dist', 'main.js'),
  resolve(parent, 'starui', 'apps', 'stomp-view-server', 'dist', 'main.js'),
].filter(Boolean);

const entry = candidates.find((p) => p && existsSync(p));

if (!entry) {
  console.error(`[stomp] stomp-view-server entry not found. Tried:
${candidates.map((p) => `  ${p}`).join('\n')}

Expected a sibling checkout:
  <parent>/
    canvasgrid/     ← this repo
    ssrm-grid/      ← preferred (apps/stomp-view-server, port 8082)
    starui/         ← legacy fallback

Build the broker first:
  cd ../ssrm-grid/apps/stomp-view-server && npm run build
  # or: npm run dev   (tsx watch — then point STOMP_SERVER_ENTRY at nothing;
  #                     prefer running ssrm-grid's npm run dev directly)

Or set STOMP_SERVER_ENTRY to an absolute path to main.js.

Sample that uses this broker:
  npm run dev:ssrm-provider   # or npm run dev:csrm-provider`);
  process.exit(1);
}

const isSsrmGrid = entry.includes(`${join('ssrm-grid', 'apps', 'stomp-view-server')}`)
  || entry.includes('ssrm-grid/apps/stomp-view-server')
  || entry.includes('ssrm-grid\\apps\\stomp-view-server');

const env = { ...process.env };
// ssrm-grid fixture defaults to 8082; keep explicit so canvasgrid samples match.
if (isSsrmGrid && env.PORT == null) env.PORT = '8082';

console.log(`[stomp] starting ${entry}`);
if (env.PORT) console.log(`[stomp] PORT=${env.PORT}`);

const child = spawn(process.execPath, [entry], {
  stdio: 'inherit',
  cwd: dirname(entry),
  env,
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
