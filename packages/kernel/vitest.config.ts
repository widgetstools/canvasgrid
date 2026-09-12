import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vitest/config';

const require_ = createRequire(import.meta.url);
const dshubPkg = dirname(require_.resolve('dshub-hub/package.json'));

export default defineConfig({
  test: {
    environment: 'happy-dom',
    alias: {
      // `dshub-hub/plane/RustHubHost.ts` carries a literal
      // `import('@starui/dshub')` for rangrez's worker build to inline the
      // wasm at. The end-to-end test injects its own factory, so the import
      // never EXECUTES — but vite still has to RESOLVE it to transform the
      // module. Same alias as packages/data.
      '@starui/dshub': join(dshubPkg, 'runtime', 'dshub.js'),
    },
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
