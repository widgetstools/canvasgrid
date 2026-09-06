import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `@stomp/stompjs`'s browser export is a UMD bundle with no named ESM exports,
// so the STOMP path needs its esm6 entry by absolute path. Resolved through
// `createRequire` rather than a hand-rolled path walk: this app is a workspace
// member, so npm hoists the dependency to the repo root and any candidate list
// rooted at the app directory misses it.
// The package's `exports` map does not expose `./esm6/*` as a subpath, so the
// entry cannot be resolved directly; resolve the package's main file and take
// its root instead. `browser` resolves to the UMD bundle, which is exactly the
// build we are steering around.
const require = createRequire(import.meta.url);
const stompRoot = dirname(dirname(require.resolve('@stomp/stompjs')));
const stompEsm = join(stompRoot, 'esm6/index.js');

// Source-direct companion packages: their entry points are .ts, so Vite must
// compile them rather than prebundle. Prebundling the kernel also rewrites
// `import.meta.url`, which would 404 the grid's own worker.js.
const starui = [
  '@wellsfargo-starui/velocity-grid',
  '@wellsfargo-starui/velocity-grid/calc',
  '@wellsfargo-starui/velocity-grid/format',
  '@wellsfargo-starui/velocity-grid/rules',
  '@wellsfargo-starui/velocity-grid/expression',
  '@wellsfargo-starui/velocity-grid-ext',
  '@wellsfargo-starui/velocity-grid-ext/customizer',
  '@wellsfargo-starui/velocity-grid-ext/edit',
  '@wellsfargo-starui/velocity-grid-ext/renderers',
  '@wellsfargo-starui/velocity-grid-data',
  '@wellsfargo-starui/velocity-grid-perspective',
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5302,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  resolve: {
    alias: [{ find: /^@stomp\/stompjs$/, replacement: stompEsm }],
  },
  optimizeDeps: { exclude: starui, include: ['@stomp/stompjs'] },
});
