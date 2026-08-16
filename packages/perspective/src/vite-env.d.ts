/**
 * Vite asset-URL imports (`?url`) — resolved by the CONSUMING app's Vite
 * build (this package ships source). The declarations keep standalone
 * `tsc --noEmit` green.
 */
declare module '*?url' {
  const url: string;
  export default url;
}

// Perspective WASM imports
declare module '@perspective-dev/client/dist/wasm/perspective-js.wasm?url' {
  const url: string;
  export default url;
}

declare module '@perspective-dev/server/dist/wasm/perspective-server.wasm?url' {
  const url: string;
  export default url;
}
