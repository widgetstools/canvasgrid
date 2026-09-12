/**
 * Pull `dshub-hub`'s own `@starui/dshub` declaration into the program.
 *
 * `RustHubHost.ts` carries a literal `import('@starui/dshub')` so rangrez's
 * worker build can inline the wasm at that specifier. canvasgrid injects a
 * `RustHubFactory` instead, so the import is never REACHED at runtime — but
 * TypeScript still has to resolve it to typecheck the vendored source, and
 * an ambient declaration living inside node_modules is not picked up unless
 * something references it.
 *
 * A reference, not a copy: the shipped declaration is authoritative and gains
 * methods as the engine does (it grew four lifecycle verbs in 3b1d0fe). A
 * hand-maintained duplicate here would drift silently.
 *
 * vite needs the same specifier to resolve when it transforms the module —
 * see the alias in packages/data/vitest.config.ts.
 */
/// <reference types="dshub-hub/plane/dshub-module.d.ts" />
export {};
