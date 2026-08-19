#!/usr/bin/env node
/**
 * Cross-platform OpenFin + Vite + STOMP launcher for velocitygrid-ext-demo.
 *
 * Spawns three child processes and tears them all down on exit — no
 * concurrently / wait-on / shell `&&`, so the same entry works under
 * macOS Terminal and Windows PowerShell/cmd via `npm run ext-demo:openfin`.
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const isWin = process.platform === 'win32';

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function start(label, command, args) {
  console.log(`[${label}] ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: isWin,
    detached: !isWin,
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${label}] exited code=${code} signal=${signal ?? ''}`);
    shutdown(code ?? 1);
  });
  return child;
}

function killOne(child) {
  if (!child.pid || child.killed) return;
  if (isWin) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: true,
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ignore */ }
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killOne(child);
  setTimeout(() => process.exit(code), isWin ? 800 : 200).unref?.();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => shutdown(0));
}

start('stomp', 'npm', ['run', 'dev:stomp']);
start('vite', 'npm', ['run', 'dev:ext-demo']);
start('openfin', process.execPath, [join(root, 'scripts', 'wait-and-launch-openfin.mjs')]);
