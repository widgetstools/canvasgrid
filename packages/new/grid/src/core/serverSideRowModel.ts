/**
 * Flat-blocks SSRM entry point.
 *
 * Main-thread SSRM controller: block cache + datasource fan-in. The worker
 * holds only a sparse window for paint (see `ssrmHydrate`). The server owns
 * grouping and expansion, so an expand/collapse is a round trip that purges
 * the block cache.
 *
 * The implementation lives in {@link SsrmEngine} (SPEC.md collapse target #1 —
 * one engine, explicit modes). This module binds the `flat-blocks` mode and
 * keeps the legacy import path and class name so the ported kernel tests run
 * unmodified.
 */

import type { IServerSideDatasource } from '../types/ssrm';
import { SsrmEngine, type SsrmHost } from './ssrmEngine';

export type { SsrmHost } from './ssrmEngine';

export class ServerSideRowModelController<TRow = any> extends SsrmEngine<TRow> {
  constructor(
    host: SsrmHost<TRow>,
    opts: { cacheBlockSize?: number; maxConcurrentDatasourceRequests?: number } = {},
  ) {
    super(host, {
      mode: 'flat-blocks',
      cacheBlockSize: opts.cacheBlockSize,
      maxConcurrentDatasourceRequests: opts.maxConcurrentDatasourceRequests,
    });
  }

  override setDatasource(ds: IServerSideDatasource<TRow> | null): void {
    super.setDatasource(ds);
  }
}
