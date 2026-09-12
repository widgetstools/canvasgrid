import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vitest/config';

const require_ = createRequire(import.meta.url);
const dshubPkg = dirname(require_.resolve('dshub-hub/package.json'));

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
    alias: {
      // `dshub-hub/plane/RustHubHost.ts` carries a literal
      // `import('@starui/dshub')` so that rangrez's worker build can inline
      // the wasm. canvasgrid injects its own `RustHubFactory` instead, so
      // that import is never EXECUTED — but the specifier still has to
      // RESOLVE for vite to transform the module. Pointing it at the
      // vendored glue satisfies the resolver with the real thing.
      '@starui/dshub': join(dshubPkg, 'runtime', 'dshub.js'),
    },
  },
});
