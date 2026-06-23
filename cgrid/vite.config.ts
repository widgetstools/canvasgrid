import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/cgrid.ts'),
      formats: ['es'],
      fileName: 'cgrid',
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
