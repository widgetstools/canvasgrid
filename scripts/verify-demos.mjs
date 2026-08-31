#!/usr/bin/env node
/**
 * Cross-platform demo boot check — starts each Vite demo briefly, hits its
 * URL, then tears the process tree down. Safe on macOS, Windows, and Linux.
 *
 * Usage:
 *   node scripts/verify-demos.mjs
 *   node scripts/verify-demos.mjs --only velocitygrid-csrm-provider-demo
 *
 * Requires `npm run build` (or at least kernel dist) beforehand for demos
 * that alias @wellsfargo-starui/velocity-grid to packages/kernel/dist.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const ALL = [
  { name: 'velocitygrid-csrm-provider-demo', workspace: 'velocitygrid-csrm-provider-demo', port: 5210, needsKernelDist: true },
  { name: 'velocitygrid-ssrm-provider-demo', workspace: 'velocitygrid-ssrm-provider-demo', port: 5211, needsKernelDist: true },
];

const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  ?? (process.argv.includes('--only') ? `--only=${process.argv[process.argv.indexOf('--only') + 1]}` : null);
const only = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const demos = only ? ALL.filter((d) => only.includes(d.name) || only.includes(d.workspace)) : ALL;

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group may not exist */ }
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }
}

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) return true;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${url} (${lastErr})`);
}

async function verifyOne(demo) {
  const child = spawn(
    'npm',
    ['run', 'dev', `--workspace=${demo.workspace}`, '--', '--host', '127.0.0.1', '--strictPort'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none' },
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
    },
  );

  let output = '';
  child.stdout?.on('data', (b) => { output += b.toString(); });
  child.stderr?.on('data', (b) => { output += b.toString(); });

  try {
    await waitForHttp(`http://127.0.0.1:${demo.port}/`, 45_000);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      output: output.slice(-2000),
    };
  } finally {
    killTree(child);
    await sleep(500);
  }
}

const results = [];
for (const demo of demos) {
  process.stdout.write(`verify ${demo.name} (:${demo.port}) ... `);
  const result = await verifyOne(demo);
  results.push({ demo, ...result });
  console.log(result.ok ? 'OK' : 'FAIL');
  if (!result.ok) {
    console.error(`  ${result.error}`);
    if (result.output) console.error(result.output);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} demos responded`);
process.exit(failed.length ? 1 : 0);
