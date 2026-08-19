import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { stompjsEsmEntry } from '../vite-stomp-esm.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));
const kernelDist = fileURLToPath(new URL('../../packages/kernel/dist/velocity-grid.js', import.meta.url));
const kernelCss = fileURLToPath(new URL('../../packages/kernel/dist/velocity-grid.css', import.meta.url));

/** Perspective WASM/workers must resolve from the workspace hoisted copy, not tarball nests. */
const staruiAliases = [
  { find: /^@wellsfargo-starui\/velocity-grid$/, replacement: kernelDist },
  { find: '@wellsfargo-starui/velocity-grid/style.css', replacement: kernelCss },
  { find: /^@wellsfargo-starui\/velocity-grid-ext$/, replacement: pkg('ext') },
  { find: /^@wellsfargo-starui\/velocity-grid-perspective$/, replacement: pkg('perspective') },
  { find: /^@wellsfargo-starui\/velocity-grid-data$/, replacement: pkg('data') },
  { find: /^@wellsfargo-starui\/velocity-grid-appdata$/, replacement: pkg('appdata') },
  { find: /^@wellsfargo-starui\/velocity-grid-storage$/, replacement: pkg('storage') },
  { find: /^@wellsfargo-starui\/velocity-grid-format$/, replacement: pkg('format') },
  { find: /^@wellsfargo-starui\/velocity-grid-calc$/, replacement: pkg('calc') },
  { find: /^@wellsfargo-starui\/velocity-grid-rules$/, replacement: pkg('rules') },
  { find: /^@wellsfargo-starui\/velocity-grid-edit$/, replacement: pkg('edit') },
  { find: /^@wellsfargo-starui\/velocity-grid-customizer$/, replacement: pkg('customizer') },
  { find: /^@wellsfargo-starui\/velocity-grid-expression$/, replacement: pkg('expression') },
  { find: /^@wellsfargo-starui\/velocity-grid-renderers$/, replacement: pkg('renderers') },
  { find: /^@wellsfargo-starui\/velocity-grid-export$/, replacement: pkg('export') },
];

const starui = staruiAliases.map((a) =>
  typeof a.find === 'string' ? a.find : String(a.find).slice(2, -1),
);

export default defineConfig({
  server: {
    port: 5204,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: [
      ...staruiAliases,
      { find: /^@stomp\/stompjs$/, replacement: stompjsEsmEntry(import.meta.url) },
    ],
    dedupe: ['@perspective-dev/client', '@perspective-dev/server'],
  },
  optimizeDeps: {
    exclude: [
      ...starui,
      '@perspective-dev/client',
      '@perspective-dev/server',
    ],
    include: ['@stomp/stompjs'],
  },
  worker: { format: 'es' },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
});
