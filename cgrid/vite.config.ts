import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        cgrid: resolve(__dirname, 'src/cgrid.ts'),
        worker: resolve(__dirname, 'src/worker/worker.ts'),
      },
      formats: ['es'],
      // For multi-entry, fileName receives (format, entryName)
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
