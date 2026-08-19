/// <reference types="vite/client" />

declare module '@perspective-dev/client/dist/wasm/perspective-js.wasm?url' {
  const url: string;
  export default url;
}
declare module '@perspective-dev/server/dist/wasm/perspective-server.wasm?url' {
  const url: string;
  export default url;
}
