#!/usr/bin/env node
/**
 * Wait for the ext-demo Vite server, then launch OpenFin.
 * Invoked as the third concurrently process — no shell `&&` needed.
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const launchScript = join(root, 'apps', 'velocitygrid-ext-demo', 'openfin', 'launch.mjs');
const url = process.env.EXT_DEMO_URL ?? 'http://127.0.0.1:5188/';
const timeoutMs = Number(process.env.EXT_DEMO_WAIT_MS ?? 120_000);

const start = Date.now();
while (Date.now() - start < timeoutMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok || (res.status >= 200 && res.status < 500)) break;
  } catch {
    /* keep polling */
  }
  await sleep(400);
}
if (Date.now() - start >= timeoutMs) {
  console.error(`[openfin] timed out waiting for ${url}`);
  process.exit(1);
}

const child = spawn(process.execPath, [launchScript], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
