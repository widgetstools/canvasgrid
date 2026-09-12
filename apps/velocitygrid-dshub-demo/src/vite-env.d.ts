/// <reference types="vite/client" />
/// <reference types="dshub-hub/plane/dshub-module.d.ts" />

/** The vendored wasm-bindgen glue, reached by its package subpath. */
declare module 'dshub-hub/runtime/dshub.js' {
  export class RustHub { static new(): RustHub }
  export default function init(opts?: { module_or_path?: string | URL }): Promise<unknown>;
}
