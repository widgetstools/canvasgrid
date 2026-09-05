/**
 * Verify the CSRM data hub's identity model against a REAL production build.
 *
 * Three claims, none of which a dev server can answer, because all of them
 * turn on what the bundler emits:
 *
 *   - tabs of one app share that app's hub;
 *   - two apps that bundle their own copies do NOT share, whatever they are
 *     called (a SharedWorker is keyed on `(origin, script URL, name)`);
 *   - one deployed script + one app name joins them, and a different name
 *     partitions them again.
 *
 * So this stages the real thing:
 *
 *   1. builds the standalone hub-worker artefact
 *   2. builds the CSRM demo TWICE, under bases /a1/ and /a2/
 *   3. deploys ONE copy of the worker at the origin root
 *   4. serves the lot from a single origin
 *   5. runs `e2e/csrm-two-apps-one-origin.spec.ts` against it
 *
 * Needs the STOMP fixture up (`npm run dev:stomp`) — the hub has to reach a
 * non-empty book for any of the subscriber counts to mean anything.
 *
 *   npm run verify:data-hub
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Distinct from verify:shared-engine's :4000, so the two can run at once.
const PORT = Number(process.env.TWO_APP_PORT ?? 4100);
const BROKER_PORT = 8082;

const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} → ${code}`))));
  p.on('error', reject);
});

const portOpen = (port) => new Promise((resolve) => {
  const s = createConnection({ port, host: '127.0.0.1' })
    .on('connect', () => { s.end(); resolve(true); })
    .on('error', () => resolve(false));
  setTimeout(() => { s.destroy(); resolve(false); }, 1500);
});

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm',
  '.map': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

async function main() {
  if (!(await portOpen(BROKER_PORT))) {
    console.error(`\n  The STOMP fixture is not listening on :${BROKER_PORT}.`);
    console.error('  Start it first:  npm run dev:stomp\n');
    process.exit(2);
  }

  const stage = await mkdtemp(join(tmpdir(), 'vg-data-hub-'));
  let server;
  try {
    console.log('\n[1/5] building the standalone hub-worker artefact');
    await run('npx', ['vite', 'build', '-c', 'vite.hubWorker.config.ts'],
      join(ROOT, 'packages', 'data'));

    const demo = join(ROOT, 'apps', 'velocitygrid-csrm-provider-demo');
    for (const app of ['a1', 'a2']) {
      console.log(`[2/5] building the demo under /${app}/`);
      await run('npx', ['vite', 'build', `--base=/${app}/`, '--outDir', join(stage, app), '--emptyOutDir'], demo);
    }

    console.log('[3/5] deploying one hub copy at the origin root');
    await copyFile(
      join(ROOT, 'packages', 'data', 'dist', 'velocity-grid-data-hub.js'),
      join(stage, 'velocity-grid-data-hub.js'),
    );

    console.log(`[4/5] serving ${stage} on http://localhost:${PORT}`);
    server = createServer(async (req, res) => {
      try {
        let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
          .replace(/^(\.\.[/\\])+/, '');
        if (p.endsWith('/') || p.endsWith('\\')) p += 'index.html';
        let file = join(stage, p);
        let body;
        try {
          body = await readFile(file);
        } catch {
          file = join(stage, p, 'index.html');
          body = await readFile(file);
        }
        res.writeHead(200, {
          'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    await new Promise((r) => server.listen(PORT, r));

    console.log('[5/5] running e2e/csrm-two-apps-one-origin.spec.ts\n');
    await run('npx', [
      'playwright', 'test', 'e2e/csrm-two-apps-one-origin.spec.ts',
      // Serially, explicitly: every test in the file competes for one origin's
      // SharedWorkers, so overlapping runs would read each other's counts.
      '--reporter=list', '--timeout=900000', '--workers=1',
    ], ROOT);
    console.log('\n  Tabs share their app\'s hub; the app name partitions hubs;'
      + '\n  one deployed script is what lets two apps converge at all.\n');
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
