import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const require_ = createRequire(import.meta.url);
const kernelDist = fileURLToPath(new URL('../../packages/kernel/dist/velocity-grid.js', import.meta.url));
const kernelCss = fileURLToPath(new URL('../../packages/kernel/dist/velocity-grid.css', import.meta.url));
const dshubPkg = dirname(require_.resolve('dshub-hub/package.json'));

export default defineConfig({
  server: { port: 5250, fs: { allow: ['../..'] } },
  resolve: {
    alias: [
      { find: /^@wellsfargo-starui\/velocity-grid$/, replacement: kernelDist },
      { find: '@wellsfargo-starui/velocity-grid/style.css', replacement: kernelCss },
      // The plane carries a literal `import('@starui/dshub')` so rangrez's
      // worker build can inline the wasm there. This demo injects its own
      // factory, so it never EXECUTES — but vite still has to RESOLVE it.
      { find: '@starui/dshub', replacement: join(dshubPkg, 'runtime', 'dshub.js') },
    ],
  },
  optimizeDeps: {
    exclude: ['@wellsfargo-starui/velocity-grid', 'dshub-hub'],
  },
});
