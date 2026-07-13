#!/usr/bin/env node
/**
 * Launch the CGridExt demo in an OpenFin window from a manifest URL.
 *
 *   node apps/cgrid-ext-demo/openfin/launch.mjs [manifestUrl]
 *
 * Default manifest is the dev manifest served by Vite from `public/`
 * (http://localhost:5188/openfin.json → loads the :5188 dev server so HMR
 * works). Pass a URL to override — e.g. the build-preview manifest served
 * at http://localhost:4188/openfin.json after `npm run build && vite preview
 * --port 4188` (copy public/openfin.json's `url` to :4188 first, or use the
 * perf `openfin/app.json` via the CLI).
 *
 * Uses @openfin/node-adapter (a root devDependency) so the launch is
 * cross-platform and quits cleanly on Ctrl+C — the same approach as
 * starui's `tools/scripts/launch-openfin.mjs` / star-demo `launch.mjs`.
 * The import is dynamic so a pruned install surfaces a clear error rather
 * than a cryptic module-not-found.
 */
import { setDefaultResultOrder } from 'node:dns';

// Prefer IPv4 first — the OpenFin runtime's local RVM/websocket handshake
// resolves `localhost` and can stall on an IPv6 (::1) first result.
try { setDefaultResultOrder('ipv4first'); } catch { /* older node — ignore */ }

const DEFAULT_MANIFEST = 'http://localhost:5188/openfin.json';

async function main() {
  const { connect, launch } = await import('@openfin/node-adapter').catch((err) => {
    console.error('[openfin] @openfin/node-adapter not installed — run `npm install` at the repo root.');
    console.error(err?.message ?? err);
    process.exit(1);
  });

  const manifestUrl = process.argv[2] ?? DEFAULT_MANIFEST;
  console.log(`[openfin] launching manifest: ${manifestUrl}`);

  let fin;
  try {
    const port = await launch({ manifestUrl });
    fin = await connect({
      uuid: `cgrid-ext-demo-launcher-${Date.now()}`,
      address: `ws://127.0.0.1:${port}`,
      nonPersistent: true,
    });
  } catch (e) {
    console.error('[openfin] failed to launch — is the dev server up and the manifest reachable?');
    console.error(e?.message ?? e);
    process.exit(1);
  }

  const manifest = await fin.System.fetchManifest(manifestUrl);
  const uuid = manifest.platform?.uuid ?? manifest.startup_app.uuid;
  console.log(`[openfin] connected — app "${uuid}". Ctrl+C to quit.`);

  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    try {
      if (manifest.platform?.uuid) {
        await fin.Platform.wrapSync({ uuid }).quit();
      } else {
        await fin.Application.wrapSync({ uuid }).quit();
      }
    } catch (err) {
      if (!String(err).includes('no longer connected')) console.error('[openfin] quit error:', err);
    }
    process.exit();
  };

  fin.once('disconnected', () => { console.log('[openfin] disconnected — exiting'); process.exit(); });
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}

main().catch((e) => { console.error(e); process.exit(1); });
