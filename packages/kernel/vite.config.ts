import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Main-thread bundle ONLY. The worker is built by a second pass
// (vite.worker.config.ts) so the two entries never share a static chunk:
// with both entries in one build, rollup split their common modules into a
// shared chunk (`clipboardPass-*.js`) that dist/worker.js statically
// imported — and consumer bundlers that re-bundle `new Worker(new URL(...))`
// (vite app builds) copy only the worker entry's own graph, leaving that
// import dangling at runtime (the worker died on boot and grids rendered
// empty in production builds). Each pass owning a self-contained graph is
// the contract consumers rely on.
export default defineConfig({
  build: {
    lib: {
      entry: { 'velocity-grid': resolve(__dirname, 'src/velocityGrid.ts') },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      external: [],
    },
  },
  worker: {
    format: 'es',
  },
});
