import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const kernelDist = fileURLToPath(
  new URL('../../packages/kernel/dist/velocity-grid.js', import.meta.url),
);
const kernelCss = fileURLToPath(
  new URL('../../packages/kernel/dist/velocity-grid.css', import.meta.url),
);

export default defineConfig({
  server: { port: 5196, fs: { allow: ['../..'] } },
  resolve: {
    alias: [
      { find: /^@wellsfargo-starui\/velocity-grid$/, replacement: kernelDist },
      { find: '@wellsfargo-starui/velocity-grid/style.css', replacement: kernelCss },
      {
        find: /^@lab\/(.*)/,
        replacement: `${fileURLToPath(new URL('../lab-shared', import.meta.url))}/$1`,
      },
    ],
  },
  optimizeDeps: {
    exclude: ['@wellsfargo-starui/velocity-grid'],
  },
});
