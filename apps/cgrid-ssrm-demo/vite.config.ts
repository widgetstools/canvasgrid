import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const kernelDist = fileURLToPath(
  new URL('../../packages/kernel/dist/cgrid.js', import.meta.url),
);
const kernelCss = fileURLToPath(
  new URL('../../packages/kernel/dist/kernel.css', import.meta.url),
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
      { find: /^@cgrid\/kernel$/, replacement: kernelDist },
      { find: '@cgrid/kernel/style.css', replacement: kernelCss },
    ],
  },
  optimizeDeps: {
    exclude: ['@cgrid/kernel', '@perspective-dev/client', '@perspective-dev/server'],
  },
  worker: {
    format: 'es',
  },
});
