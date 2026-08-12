import {
  assertAppDataResolved,
  resolveCfg,
  type AppDataLookup,
} from '@wellsfargo-starui/vg-new-appdata';
import type { DataProviderConfig } from '../catalog/ConfigBackend';

/**
 * Resolve `{{name.key}}` tokens in a provider config at bind time.
 * Fail-closed when unresolved tokens remain.
 */
export function resolveProviderConfig(
  cfg: DataProviderConfig,
  lookup: AppDataLookup | null | undefined,
): DataProviderConfig {
  const resolved = lookup ? (resolveCfg(cfg, lookup) as DataProviderConfig) : cfg;
  const err = assertAppDataResolved(resolved, `provider:${cfg.id}`);
  if (err) throw new Error(`[vg-new-data] ${err}`);
  return resolved;
}
