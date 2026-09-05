import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Build the data-provider hub worker as ONE deployable file.
 *
 * The package otherwise ships source, and each consuming app's bundler emits
 * its own copy of `worker.ts`. That is correct for a single app — but a
 * SharedWorker's identity is `(origin, script URL, name)`, so two apps on one
 * origin with two copies get two hubs: two upstream connections per
 * `providerId` and two caches of the same book.
 *
 * This artefact is what lets them agree: deploy it ONCE per origin at a fixed
 * path and pass that path as `connectHub({ workerUrl, name })`.
 *
 *   npm run build:hub-worker --workspace=@wellsfargo-starui/velocity-grid-data
 *   # → dist/velocity-grid-data-hub.js
 */
function announceDeployment(): Plugin {
  return {
    name: 'announce-hub-worker',
    closeBundle() {
      const src = readFileSync(
        fileURLToPath(new URL('./src/client/hubConnection.ts', import.meta.url)),
        'utf8',
      );
      const name = /DEFAULT_HUB_NAME\s*=\s*'([^']+)'/.exec(src)?.[1] ?? '?';
      this.info?.(
        '\n  velocity-grid-data-hub.js — deploy ONE copy per origin and point'
        + '\n  every app at it:'
        + '\n    connectHub({ workerUrl: \'/vendor/velocity-grid/data-hub.js\','
        + '\n                 name: \'<your app name>\', strict: true })'
        + `\n  Default name when unset: ${name}. Same origin + same name ⇒ same`
        + '\n  hub, one upstream connection per providerId, one cache.\n',
      );
    },
  };
}

export default defineConfig({
  plugins: [announceDeployment()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/worker.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'velocity-grid-data-hub.js',
    },
    // Nothing external: a deployed worker script cannot resolve bare
    // specifiers against the host app's module graph.
    rollupOptions: { external: [], output: { inlineDynamicImports: true } },
  },
});
