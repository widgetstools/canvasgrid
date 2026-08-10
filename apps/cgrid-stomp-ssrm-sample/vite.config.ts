import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const kernelDist = fileURLToPath(
  new URL('../../packages/kernel/dist/velocity-grid.js', import.meta.url),
);
const kernelCss = fileURLToPath(
  new URL('../../packages/kernel/dist/velocity-grid.css', import.meta.url),
);

export default defineConfig({
  server: { port: 5201 },
  resolve: {
    alias: [
      { find: /^@wellsfargo-starui\/velocity-grid$/, replacement: kernelDist },
      { find: '@wellsfargo-starui/velocity-grid/style.css', replacement: kernelCss },
    ],
  },
  optimizeDeps: {
    exclude: ['@wellsfargo-starui/velocity-grid'],
  },
});
