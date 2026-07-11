import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Second build pass: the kernel worker as a SELF-CONTAINED module graph
// (see vite.config.ts for why it cannot share chunks with cgrid.js).
// `emptyOutDir: false` layers it into the same dist/ as the main pass.
// The worker's own dynamic imports (csv/xlsx export writers) stay dynamic —
// consumer bundlers re-emit them correctly alongside their worker chunk.
export default defineConfig({
  build: {
    lib: {
      entry: { worker: resolve(__dirname, 'src/worker/worker.ts') },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: 'es2022',
    sourcemap: true,
    emptyOutDir: false,
    rollupOptions: {
      external: [],
    },
  },
});
