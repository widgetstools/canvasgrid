/**
 * Skeleton-sparse SSRM entry point — client-owned group skeleton.
 *
 * The kernel owns the tree shape: all group rows (skeleton) plus a
 * FlattenIndex over (skeleton × expandedKeys). The datasource answers two
 * expansion-free queries — `getGroupSkeleton` and `getLeafRows` — plus the
 * flat `getRows` window when no grouping is active.
 *
 * What this buys over `flat-blocks`:
 *  - expand/collapse is a local reflow (no round trip, no purge flash);
 *  - leaf caches are per-group, so toggles never invalidate them;
 *  - rowCount, expandAll, sticky ancestors are exact by construction.
 *
 * The implementation lives in {@link SsrmEngine} (SPEC.md collapse target #1 —
 * one engine, explicit modes). This module binds the `skeleton-sparse` mode
 * and keeps the legacy import path and class name so the ported kernel tests
 * run unmodified.
 *
 * See docs/ssrm-group-skeleton-design.md.
 */

import type { IServerSideDatasourceV2 } from '../types/ssrm';
import { SsrmEngine, type SsrmHostV2 } from './ssrmEngine';

export type { SsrmHost, SsrmHostV2 } from './ssrmEngine';
export {
  SSRM_GROUP_ROW_ID_PREFIX,
  SSRM_FOOTER_ROW_ID_PREFIX,
  SSRM_GRAND_TOTAL_ROW_ID,
} from './ssrmEngine';

export class ServerSideRowModelV2Controller<TRow = any> extends SsrmEngine<TRow> {
  constructor(
    host: SsrmHostV2<TRow>,
    opts: {
      rowIdField: string;
      cacheBlockSize?: number;
      maxConcurrentDatasourceRequests?: number;
      maxCachedLeafBlocks?: number;
      /** In-scroll per-group total rows (AG `groupTotalRow`). */
      groupTotalRow?: 'top' | 'bottom' | null;
      /** In-scroll grand-total row (AG `grandTotalRow` 'top'|'bottom' —
       *  pinned variants ride the totals subgrid, not the index). */
      grandTotalRow?: 'top' | 'bottom' | null;
      /** AG `groupMaintainOrder` — pin skeleton sibling order across
       *  refetches. */
      maintainOrder?: boolean;
    },
  ) {
    super(host, { mode: 'skeleton-sparse', ...opts });
  }

  override setDatasource(ds: IServerSideDatasourceV2<TRow> | null): void {
    super.setDatasource(ds);
  }
}
