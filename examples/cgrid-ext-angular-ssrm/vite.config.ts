import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
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
  server: {
    port: 5204,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: [
      { find: /^@stomp\/stompjs$/, replacement: stompjsEsmEntry(import.meta.url) },
    ],
    dedupe: ['@perspective-dev/client', '@perspective-dev/server'],
  },
  optimizeDeps: {
    exclude: [
      ...starui,
      '@perspective-dev/client',
      '@perspective-dev/server',
    ],
    include: ['@stomp/stompjs'],
  },
  worker: { format: 'es' },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
});
