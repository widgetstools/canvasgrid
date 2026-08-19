import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const kernelDist = fileURLToPath(
  new URL('../../packages/kernel/dist/velocity-grid.js', import.meta.url),
);
const kernelCss = fileURLToPath(
  new URL('../../packages/kernel/dist/velocity-grid.css', import.meta.url),
);

export default defineConfig({
  server: {
    port: 5191,
    // Perspective WASM workers need correct MIME; Vite handles .wasm.
    fs: {
      allow: ['../..'],
    },
  },
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: [
      { find: /^@wellsfargo-starui\/velocity-grid$/, replacement: kernelDist },
      { find: '@wellsfargo-starui/velocity-grid/style.css', replacement: kernelCss },
    ],
  },
  optimizeDeps: {
    exclude: ['@wellsfargo-starui/velocity-grid', '@perspective-dev/client', '@perspective-dev/server', '@wellsfargo-starui/velocity-grid-perspective'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        simple: fileURLToPath(new URL('./simple.html', import.meta.url)),
        playground: fileURLToPath(new URL('./playground.html', import.meta.url)),
      },
    },
  },
});
