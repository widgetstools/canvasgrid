/**
 * Vite asset-URL imports (`?url`) — resolved by the consuming app's Vite
 * build (this package ships source).
 */
declare module '*?url' {
  const url: string;
  export default url;
}
