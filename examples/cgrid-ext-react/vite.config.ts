import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stompjsEsmEntry } from '../vite-stomp-esm.mjs';

const starui = [
  '@wellsfargo-starui/velocity-grid',
  '@wellsfargo-starui/velocity-grid-ext',
  '@wellsfargo-starui/velocity-grid-ext/customizer',
  '@wellsfargo-starui/velocity-grid-data',
  '@wellsfargo-starui/velocity-grid/calc',
  '@wellsfargo-starui/velocity-grid/format',
  '@wellsfargo-starui/velocity-grid/rules',
  '@wellsfargo-starui/velocity-grid-ext/edit',
  '@wellsfargo-starui/velocity-grid-ext/renderers',
  '@wellsfargo-starui/velocity-grid/expression',
  '@wellsfargo-starui/velocity-grid-perspective',
  '@wellsfargo-starui/velocity-grid-ext/export',
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5202,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  resolve: {
    alias: [
      { find: /^@stomp\/stompjs$/, replacement: stompjsEsmEntry(import.meta.url) },
    ],
  },
  // Do not prebundle the kernel — Vite would rewrite import.meta.url and
  // worker.js would 404. Source-direct companion packages stay unbundled
  // so their .ts entry points compile through Vite.
  optimizeDeps: { exclude: starui, include: ['@stomp/stompjs'] },
});
