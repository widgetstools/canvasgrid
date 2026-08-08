import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const kernelDist = fileURLToPath(
  new URL('../../packages/kernel/dist/velocity-grid.js', import.meta.url),
);
const kernelCss = fileURLToPath(
  new URL('../../packages/kernel/dist/velocity-grid.css', import.meta.url),
);

export default defineConfig({
  server: { port: 5188 },
  // Pin @wellsfargo-starui/velocity-grid to dist so `new URL('./worker.js', import.meta.url)`
  // resolves next to the built worker (src/ has no worker.js — that 404s as
  // text/html and the grid never gets data).
  resolve: {
    alias: [
      { find: /^@wellsfargo-starui\/velocity-grid$/, replacement: kernelDist },
      { find: '@wellsfargo-starui/velocity-grid/style.css', replacement: kernelCss },
    ],
  },
  // Do NOT prebundle kernel — Vite's dep optimizer rewrites import.meta.url
  // to the .vite/deps chunk, so `./worker.js` would 404 again. Serve the
  // built ESM from dist as-is so the co-located worker loads.
  optimizeDeps: {
    exclude: ['@wellsfargo-starui/velocity-grid'],
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        bench: fileURLToPath(new URL('./bench/raster-grain.html', import.meta.url)),
      },
    },
  },
});
