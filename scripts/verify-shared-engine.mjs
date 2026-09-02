/**
 * Verify that two DIFFERENT apps on ONE origin share a Perspective engine.
 *
 * The question is what the BUNDLER emits, so a dev server cannot answer it.
 * This stages the real thing:
 *
 *   1. builds the standalone shared-worker artefact
 *   2. builds the SSRM demo TWICE, under bases /a1/ and /a2/
 *   3. deploys ONE copy of the worker at the origin root
 *   4. serves the lot from a single origin
 *   5. runs `e2e/ssrm-two-apps-one-origin.spec.ts` against it
 *
 * Needs the STOMP fixture up (`npm run dev:stomp`) — the apps have to reach
 * `live` for any of the assertions to mean anything.
 *
 *   npm run verify:shared-engine
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, copyFile, mkdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.TWO_APP_PORT ?? 4000);
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

  const stage = await mkdtemp(join(tmpdir(), 'vg-two-app-'));
  let server;
  try {
    console.log('\n[1/5] building the standalone shared-worker artefact');
    await run('npx', ['vite', 'build', '-c', 'vite.sharedWorker.config.ts'],
      join(ROOT, 'packages', 'perspective'));

    const demo = join(ROOT, 'apps', 'velocitygrid-ssrm-provider-demo');
    for (const app of ['a1', 'a2']) {
      console.log(`[2/5] building the demo under /${app}/`);
      await run('npx', ['vite', 'build', `--base=/${app}/`, '--outDir', join(stage, app), '--emptyOutDir'], demo);
    }

    console.log('[3/5] deploying one worker copy at the origin root');
    await mkdir(stage, { recursive: true });
    await copyFile(
      join(ROOT, 'packages', 'perspective', 'dist', 'perspective-shared-worker.js'),
      join(stage, 'psp-shared-worker.js'),
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

    console.log('[5/5] running e2e/ssrm-two-apps-one-origin.spec.ts\n');
    await run('npx', [
      'playwright', 'test', 'e2e/ssrm-two-apps-one-origin.spec.ts',
      '--reporter=list', '--timeout=900000',
    ], ROOT);
    console.log('\n  Two apps on one origin share one engine, one table and one feed.\n');
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

void dirname;
main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
