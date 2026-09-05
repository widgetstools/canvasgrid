/**
 * Take the broker away from a running worker-side feed, and give it back.
 *
 * The feed no longer lives on any tab, so no tab can see or repair its
 * socket — which makes "what does a broker drop look like from up here?" the
 * question worth staging. It cannot be staged against the shared STOMP
 * fixture, because everything else is using it, so this puts a severable
 * relay in front:
 *
 *   1. starts `scripts/ws-relay.mjs` on :8099, pointed at the real fixture
 *   2. starts the SSRM demo on :5219 with VITE_STOMP_URL pointed at the relay
 *   3. runs `e2e/ssrm-worker-feed-reconnect.spec.ts`, which cuts and heals it
 *
 * Needs the STOMP fixture up (`npm run dev:stomp`).
 *
 *   npm run verify:worker-feed-reconnect
 */
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BROKER_PORT = 8082;
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 8099);
const DEMO_PORT = Number(process.env.RECONNECT_DEMO_PORT ?? 5219);

/**
 * `localhost` rather than `127.0.0.1`: Vite binds the IPv6 loopback, so an
 * IPv4-only probe reports a dev server that is plainly printing its own URL
 * as "never came up". Node's happy-eyeballs tries both.
 */
const portOpen = (port) => new Promise((resolve) => {
  const s = createConnection({ port, host: 'localhost' })
    .on('connect', () => { s.end(); resolve(true); })
    .on('error', () => resolve(false));
  setTimeout(() => { s.destroy(); resolve(false); }, 1500);
});

const waitForPort = async (port, label, timeoutMs = 90_000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} never came up on :${port}`);
};

const run = (cmd, args, opts) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} → ${code}`))));
  p.on('error', reject);
});

const children = [];
const background = (cmd, args, env) => {
  const p = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    // Own process group off Windows, so the whole tree can be signalled.
    detached: process.platform !== 'win32',
    env: { ...process.env, ...env },
  });
  children.push(p);
  return p;
};

async function main() {
  if (!(await portOpen(BROKER_PORT))) {
    console.error(`\n  The STOMP fixture is not listening on :${BROKER_PORT}.`);
    console.error('  Start it first:  npm run dev:stomp\n');
    process.exit(2);
  }

  try {
    console.log(`\n[1/3] starting the severable relay on :${RELAY_PORT}`);
    background('node', ['scripts/ws-relay.mjs'], {
      RELAY_PORT: String(RELAY_PORT),
      RELAY_UPSTREAM: `ws://localhost:${BROKER_PORT}`,
    });
    await waitForPort(RELAY_PORT, 'ws-relay');

    console.log(`[2/3] starting the SSRM demo on :${DEMO_PORT}, fed through the relay`);
    background('npm', [
      'run', 'dev', '--workspace=velocitygrid-ssrm-provider-demo',
      '--', '--port', String(DEMO_PORT), '--strictPort',
    ], { VITE_STOMP_URL: `ws://localhost:${RELAY_PORT}` });
    await waitForPort(DEMO_PORT, 'ssrm demo');

    console.log('[3/3] running e2e/ssrm-worker-feed-reconnect.spec.ts\n');
    await run('npx', [
      'playwright', 'test', 'e2e/ssrm-worker-feed-reconnect.spec.ts',
      '--reporter=list', '--timeout=600000',
    ], {
      env: {
        ...process.env,
        RECONNECT_DEMO_URL: `http://localhost:${DEMO_PORT}/`,
        RECONNECT_RELAY_URL: `http://localhost:${RELAY_PORT}`,
      },
    });
    console.log('\n  A broker drop reaches every tab, and the feed recovers on its own.\n');
  } finally {
    // `child.kill()` on Windows kills the cmd shim npm runs under and leaves
    // vite listening — the next run then silently reuses a stale server on a
    // stale build, which is worse than failing. `taskkill /t` takes the tree,
    // and it has to be SYNCHRONOUS or the process exits before it lands.
    for (const p of children) {
      if (p.exitCode !== null || p.pid === undefined) continue;
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(p.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          process.kill(-p.pid, 'SIGKILL');
        }
      } catch { /* already gone */ }
    }
  }
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
