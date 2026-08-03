/**
 * Vite asset-URL imports (`?url`) — resolved by the CONSUMING app's Vite
 * build (this package ships source). The declarations keep standalone
 * `tsc --noEmit` green.
 */
declare module '*?url' {
  const url: string;
  export default url;
}
