import type {
  IServerSideDatasourceV2,
  IServerSideGetGroupLeafIdsParams,
  IServerSideGetLeafRowsParams,
  IServerSideGetRowsParams,
  IServerSideGetSkeletonParams,
  VelocityGridOptions,
} from '@wellsfargo-starui/vg-new-grid';
import { registerDataProviderFeedControl } from '@wellsfargo-starui/vg-new-data';
import { PerspectiveBook, type PositionRow, type ViewTick } from './book';

export type StompPerspectiveProviderConfig = {
  providerId?: string;
  feed?: 'seed' | 'stomp';
  snapshotRows?: number;
  label?: string;
};

type AttachableGrid = {
  applyServerSideTransaction(tx: { update?: unknown[] }): void;
  refreshServerSide(params?: { purge?: boolean }): void;
  setSsrmExpressionHost?(host: unknown | null): void;
};

/**
 * One View onto a shared book — sparse SSRM v2 datasource.
 */
export class StompPerspectiveProvider implements IServerSideDatasourceV2<PositionRow> {
  readonly viewId: string;
  private readonly book: PerspectiveBook;
  private destroyed = false;
  private detachAttached: (() => void) | null = null;
  private attachedGrid: AttachableGrid | null = null;
  private unregFeed: (() => void) | null = null;

  constructor(config: StompPerspectiveProviderConfig = {}) {
    this.viewId = `view-${Math.random().toString(16).slice(2, 8)}`;
    this.book = new PerspectiveBook({
      feed: config.feed ?? 'seed',
      snapshotRows: config.snapshotRows,
      onViewTick: (tick) => this.onTick(tick),
    });
    void this.book.registerView({ id: this.viewId, label: config.label });
    this.book.connect();
    if (config.providerId) {
      this.unregFeed = registerDataProviderFeedControl(config.providerId, {
        stop: () => this.book.stopFeed(),
        restart: () => this.book.restartFeed(),
      });
    }
  }

  get bookRef(): PerspectiveBook {
    return this.book;
  }

  gridOptions(): VelocityGridOptions<PositionRow> {
    return {
      getRowId: (r) => r.positionId,
      rowIdField: 'positionId',
      columnDefs: [
        { field: 'positionId', headerName: 'Id', width: 100 },
        { field: 'desk', headerName: 'Desk', width: 80, enableRowGroup: true },
        { field: 'region', headerName: 'Region', width: 80, enableRowGroup: true },
        { field: 'ticker', headerName: 'Ticker', width: 90 },
        { field: 'pnl', headerName: 'PnL', width: 100, enableValue: true, aggFunc: 'sum' },
        { field: 'dailyPnl', headerName: 'Daily', width: 100, enableValue: true, aggFunc: 'sum' },
      ],
      rowModelType: 'serverSide',
      serverSideDatasource: this,
      serverSideEnableClientSidePipeline: false,
      cacheBlockSize: 100,
      rowSelection: 'multiple',
    };
  }

  attach(grid: AttachableGrid): () => void {
    this.attachedGrid = grid;
    try { grid.setSsrmExpressionHost?.(this); } catch { /* optional */ }
    const detach = (): void => {
      if (this.attachedGrid === grid) this.attachedGrid = null;
      try { grid.setSsrmExpressionHost?.(null); } catch { /* optional */ }
    };
    this.detachAttached = detach;
    return () => {
      if (this.detachAttached === detach) this.detachAttached = null;
      detach();
    };
  }

  getRows(params: IServerSideGetRowsParams<PositionRow>): void {
    void this.book.getSsrmRows(this.viewId, params.request).then((r) => {
      params.success(r);
    }, () => params.fail());
  }

  getGroupSkeleton(params: IServerSideGetSkeletonParams): void {
    void this.book.getGroupSkeleton(this.viewId, params.request).then((r) => {
      params.success(r);
    }, () => params.fail());
  }

  getLeafRows(params: IServerSideGetLeafRowsParams<PositionRow>): void {
    void this.book.getLeafRows(this.viewId, params.request).then((r) => {
      params.success(r);
    }, () => params.fail());
  }

  getGroupLeafIds(params: IServerSideGetGroupLeafIdsParams): void {
    void this.book.getGroupLeafIds(this.viewId, params.request).then((r) => {
      params.success(r);
    }, () => params.fail());
  }

  private onTick(tick: ViewTick): void {
    if (tick.viewId !== this.viewId || !this.attachedGrid) return;
    if (tick.updates.length) {
      try { this.attachedGrid.applyServerSideTransaction({ update: tick.updates }); } catch { /* */ }
    }
    if (tick.refreshSsrm) {
      try { this.attachedGrid.refreshServerSide({ purge: false }); } catch { /* */ }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try { this.detachAttached?.(); } catch { /* */ }
    this.detachAttached = null;
    this.attachedGrid = null;
    this.unregFeed?.();
    void this.book.unregisterView(this.viewId);
    this.book.destroy();
  }
}
