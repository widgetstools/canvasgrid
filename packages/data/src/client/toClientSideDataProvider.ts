import type {
  IClientSideDataProvider,
  IClientSideDataProviderDelta,
} from '@wellsfargo-starui/velocity-grid';
import type { IDataProvider } from '../types';

/**
 * Adapt a hub {@link IDataProvider} to the kernel's `clientSideDataProvider`
 * grid option.
 *
 * `bindProviderToGrid` wires a provider to a grid from the OUTSIDE, calling
 * `setRowData` / `applyTransactionAsync` itself. This instead hands the grid
 * a row source and lets IT own the subscription, so a client-side grid is
 * configured the same way a server-side one is (`serverSideDatasource`).
 *
 * Both remain supported: `bindProviderToGrid` also pushes column defs and
 * accepts any grid-shaped host, which this deliberately narrower row-only
 * contract does not cover.
 *
 * Note the provider's own pipeline (hub-side throttle / conflate, configured
 * per `DataProviderConfig`) still applies upstream; the grid then applies its
 * `asyncTransaction*` knobs to whatever arrives. Two independent stages —
 * tune the hub for wire volume and the grid for paint cadence.
 */
export function toClientSideDataProvider<T extends Record<string, unknown>>(
  provider: IDataProvider<T>,
): IClientSideDataProvider<T> {
  return {
    getSnapshot: () => provider.getData(),
    onSnapshot: (handler) => provider.onSnapshotData((rows) => handler(rows as T[])),
    onDelta: (handler) => {
      // Prefer the classified delta; it carries real removes. `onTick` is the
      // legacy union of updates+adds with no removal channel, so it maps to
      // an update-only delta (matching `bindProviderToGrid`'s fallback).
      if (typeof provider.onDelta === 'function') {
        return provider.onDelta((d) => {
          const delta: IClientSideDataProviderDelta<T> = {
            add: d.adds as T[],
            update: d.updates as T[],
            removeIds: d.removes,
          };
          handler(delta);
        });
      }
      return provider.onTick((rows) => handler({ update: rows as T[] }));
    },
  };
}
