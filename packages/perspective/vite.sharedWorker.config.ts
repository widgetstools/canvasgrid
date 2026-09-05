import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** Read the worker's wire-protocol version out of its source, so the build
 *  can tell whoever runs it what they are about to deploy. */
function protocolVersion(): string {
  const src = readFileSync(
    fileURLToPath(new URL('./src/sharedServer.worker.ts', import.meta.url)),
    'utf8',
  );
  return /SHARED_ENGINE_PROTOCOL\s*=\s*(\d+)/.exec(src)?.[1] ?? '?';
}

/**
 * Print the deployment guidance at the one moment it is relevant — the
 * artefact is per-origin and long-lived, so the protocol it speaks is the
 * thing a rollout has to reason about.
 */
function announceProtocol(): Plugin {
  return {
    name: 'announce-shared-engine-protocol',
    closeBundle() {
      const v = protocolVersion();
      this.info?.(
        `\n  perspective-shared-worker.js speaks wire protocol ${v}.`
        + '\n  Deploy ONE copy per origin and point every app at it with'
        + '\n    configurePerspectiveSharedWorker({ url, name, strict: true }).'
        + '\n  Apps on independent release cycles can meet on it safely — the'
        + `\n  \`hello\` handshake reports a mismatch and never reaps a client`
        + '\n  that predates it. Pin a versioned path'
        + `\n    /vendor/velocity-grid/psp-shared-worker.v${v}.js`
        + '\n  only to keep versions deliberately apart, at the cost of one'
        + '\n  engine (and one feed) per live version during the rollout.\n',
      );
    },
  };
}

/**
 * Build the Perspective shared-worker host as ONE deployable file.
 *
 * The package otherwise ships source, and each consuming app's bundler emits
 * its own content-hashed copy of `sharedServer.worker.ts`. That is correct
 * for a single app — but a SharedWorker's identity is
 * `(origin, script URL, name)`, so two apps on one origin with two hashed
 * copies get two engines, two copies of the same table and two feeds.
 *
 * This artefact is what lets them agree: deploy it ONCE per origin at a
 * fixed path and point every app at that path with
 * `configurePerspectiveSharedWorker({ url })`.
 *
 *   npm run build:shared-worker --workspace=@wellsfargo-starui/velocity-grid-perspective
 *   # → dist/perspective-shared-worker.js
 *
 * Self-contained by design: the Emscripten glue for the server engine is
 * bundled in, and the engine's `.wasm` never comes from here — a page sends
 * it as a compiled `WebAssembly.Module` on the init message. So the deployed
 * file has no sibling assets and no import map to satisfy.
 */
export default defineConfig({
  plugins: [announceProtocol()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/sharedServer.worker.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'perspective-shared-worker.js',
    },
    rollupOptions: {
      // Nothing external: a deployed worker script cannot resolve bare
      // specifiers against the host app's module graph.
      external: [],
      output: { inlineDynamicImports: true },
    },
  },
});
