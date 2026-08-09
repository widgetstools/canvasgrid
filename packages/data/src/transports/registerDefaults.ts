import { registerTransportPlugin, _resetTransportPluginsForTests } from '../registry/plugins';
import { builtinTransportPlugins } from './builtinPlugins';

let registered = false;

/** Idempotent — call from hub worker and tests. */
export function registerDefaultTransports(): void {
  if (registered) return;
  registered = true;
  for (const p of builtinTransportPlugins) {
    registerTransportPlugin(p);
  }
}

/** Tests only — allows re-registration after registry clear. */
export function _resetDefaultTransportsFlagForTests(): void {
  registered = false;
  _resetTransportPluginsForTests();
}
