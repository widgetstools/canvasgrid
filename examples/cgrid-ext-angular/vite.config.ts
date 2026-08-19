import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { stompjsEsmEntry } from '../vite-stomp-esm.mjs';

const starui = [
  '@wellsfargo-starui/velocity-grid',
  '@wellsfargo-starui/velocity-grid-ext',
  '@wellsfargo-starui/velocity-grid-customizer',
  '@wellsfargo-starui/velocity-grid-data',
  '@wellsfargo-starui/velocity-grid-calc',
  '@wellsfargo-starui/velocity-grid-format',
  '@wellsfargo-starui/velocity-grid-rules',
  '@wellsfargo-starui/velocity-grid-edit',
  '@wellsfargo-starui/velocity-grid-renderers',
  '@wellsfargo-starui/velocity-grid-expression',
  '@wellsfargo-starui/velocity-grid-perspective',
  '@wellsfargo-starui/velocity-grid-storage',
  '@wellsfargo-starui/velocity-grid-appdata',
  '@wellsfargo-starui/velocity-grid-export',
];

export default defineConfig({
  server: {
    port: 5203,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  resolve: {
    alias: [
      { find: /^@stomp\/stompjs$/, replacement: stompjsEsmEntry(import.meta.url) },
    ],
  },
  optimizeDeps: { exclude: starui, include: ['@stomp/stompjs'] },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
});
