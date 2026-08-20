import { resolveCfg, type AppDataLookup } from '../appdata/index';
import type { DataProviderConfig } from '../types';

/**
 * Deep-resolve `{{token}}` placeholders in a provider config via AppData lookup.
 * Does not mutate the input.
 */
export function resolveProviderConfig(
  cfg: DataProviderConfig,
  lookup: AppDataLookup,
): DataProviderConfig {
  return resolveCfg(cfg, lookup) as DataProviderConfig;
}
