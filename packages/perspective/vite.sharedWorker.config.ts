import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

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
