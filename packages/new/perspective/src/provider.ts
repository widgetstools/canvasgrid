import type {
  IServerSideDatasourceV2,
  IServerSideGetGroupLeafIdsParams,
  IServerSideGetLeafRowsParams,
  IServerSideGetRowsParams,
  IServerSideGetSkeletonParams,
  VelocityGridOptions,
} from '@wellsfargo-starui/vg-new-grid';
import { registerDataProviderFeedControl } from '@wellsfargo-starui/vg-new-data';
import { PerspectiveBook, type BookEngine, type PositionRow, type ViewTick } from './book';
import {
  broadcastProviderFeedRestart,
  broadcastProviderFeedStop,
  subscribeProviderFeedBroadcast,
} from './feedBroadcast';

export type StompPerspectiveProviderConfig = {
  providerId?: string;
  feed?: 'seed' | 'stomp';
  engine?: BookEngine;
  snapshotRows?: number;
  label?: string;
  wsUrl?: string;
  clientId?: string;
  snapshotTopic?: string;
  triggerTopic?: string;
  snapshotEndToken?: string;
  keyColumn?: string;
  rate?: number;
  batchSize?: number;
  onPhase?: (phase: import('./book').BookPhase) => void;
};

type AttachableGrid = {
  applyServerSideTransaction(tx: { update?: unknown[] }): void;
  refreshServerSide(params?: { purge?: boolean }): void;
  setSsrmExpressionHost?(host: unknown | null): void;
};

type TickHandler = (tick: ViewTick) => void;

type BookEntry = {
  book: PerspectiveBook;
  refs: number;
  unsubBroadcast: (() => void) | null;
  tickHandlers: Set<TickHandler>;
};

/** Page-level book share — same providerId → one Book, N Views. */
const bookEntries = new Map<string, BookEntry>();

function entryKey(config: StompPerspectiveProviderConfig): string {
  return config.providerId ?? `anon:${config.feed ?? 'seed'}:${Math.random().toString(16).slice(2, 8)}`;
}

function sharedKey(config: StompPerspectiveProviderConfig): string | null {
  return config.providerId ?? null;
}

function acquireBook(config: StompPerspectiveProviderConfig): { book: PerspectiveBook; key: string } {
  const key = sharedKey(config) ?? entryKey(config);
  let entry = bookEntries.get(key);
  if (!entry) {
    const tickHandlers = new Set<TickHandler>();
    const book = new PerspectiveBook({
      feed: config.feed ?? 'seed',
      engine: config.engine ?? 'memory',
      snapshotRows: config.snapshotRows,
      schemaKey: config.providerId ?? 'positions',
      wsUrl: config.wsUrl,
      clientId: config.clientId,
      snapshotTopic: config.snapshotTopic,
      triggerTopic: config.triggerTopic,
      snapshotEndToken: config.snapshotEndToken,
      keyColumn: config.keyColumn,
      rate: config.rate,
      batchSize: config.batchSize,
      onPhase: config.onPhase,
      onViewTick: (tick) => {
        for (const h of tickHandlers) h(tick);
      },
    });
    const providerId = config.providerId ?? '';
    const unsubBroadcast = providerId
      ? subscribeProviderFeedBroadcast(providerId, {
        onStop: () => book.stopFeed(),
        onRestart: () => book.restartFeed(),
      })
      : null;
    entry = { book, refs: 0, unsubBroadcast, tickHandlers };
    bookEntries.set(key, entry);
  }
  entry.refs++;
  return { book: entry.book, key };
}

function releaseBook(key: string): void {
  const entry = bookEntries.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  entry.unsubBroadcast?.();
  entry.book.destroy();
  bookEntries.delete(key);
}

/** Test helper. */
export function __resetProviderBooksForTests(): void {
  for (const [key, entry] of bookEntries) {
    entry.unsubBroadcast?.();
    entry.book.destroy();
    bookEntries.delete(key);
  }
}

/**
 * One View onto a shared book — sparse SSRM v2 datasource.
 */
export class StompPerspectiveProvider implements IServerSideDatasourceV2<PositionRow> {
  readonly viewId: string;
  private readonly book: PerspectiveBook;
  private readonly bookKey: string;
  private readonly config: StompPerspectiveProviderConfig;
  private destroyed = false;
  private detachAttached: (() => void) | null = null;
  private attachedGrid: AttachableGrid | null = null;
  private unregFeed: (() => void) | null = null;
  private readonly onTick: TickHandler;

  constructor(config: StompPerspectiveProviderConfig = {}) {
    this.config = config;
    this.viewId = `view-${Math.random().toString(16).slice(2, 8)}`;
    const acquired = acquireBook(config);
    this.book = acquired.book;
    this.bookKey = acquired.key;

    this.onTick = (tick) => {
      if (tick.viewId !== this.viewId || !this.attachedGrid) return;
      if (tick.updates.length) {
        try { this.attachedGrid.applyServerSideTransaction({ update: tick.updates }); } catch { /* */ }
      }
      if (tick.refreshSsrm) {
        try { this.attachedGrid.refreshServerSide({ purge: false }); } catch { /* */ }
      }
    };
    bookEntries.get(this.bookKey)?.tickHandlers.add(this.onTick);

    void this.book.registerView({ id: this.viewId, label: config.label });
    this.book.connect();

    if (config.providerId) {
      this.unregFeed = registerDataProviderFeedControl(config.providerId, {
        stop: () => {
          broadcastProviderFeedStop(config.providerId!);
          this.book.stopFeed();
        },
        restart: () => {
          broadcastProviderFeedRestart(config.providerId!);
          this.book.restartFeed();
        },
      });
    }
  }

  get bookRef(): PerspectiveBook {
    return this.book;
  }

  gridOptions(): VelocityGridOptions<PositionRow> {
    return {
      getRowId: (r) => r.positionId,
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

  /** The book speaks `rows`; the grid's `LoadSuccessParams` reads `rowData`.
   *  Passing the book result straight through silently yields zero rows —
   *  `rowData` is simply undefined — so every read is mapped explicitly. */
  getRows(params: IServerSideGetRowsParams<PositionRow>): void {
    void this.book.getSsrmRows(this.viewId, params.request).then((r) => {
      params.success({ rowData: r.rows, rowCount: r.rowCount });
    }, (err) => this.failLoad('getRows', params, err));
  }

  getGroupSkeleton(params: IServerSideGetSkeletonParams): void {
    void this.book.getGroupSkeleton(this.viewId, params.request).then((r) => {
      params.success({ groups: r.groups });
    }, (err) => this.failLoad('getGroupSkeleton', params, err));
  }

  getLeafRows(params: IServerSideGetLeafRowsParams<PositionRow>): void {
    void this.book.getLeafRows(this.viewId, params.request).then((r) => {
      params.success({ rowData: r.rows });
    }, (err) => this.failLoad('getLeafRows', params, err));
  }

  getGroupLeafIds(params: IServerSideGetGroupLeafIdsParams): void {
    void this.book.getGroupLeafIds(this.viewId, params.request).then((r) => {
      params.success({ ids: r.ids });
    }, (err) => this.failLoad('getGroupLeafIds', params, err));
  }

  private failLoad(op: string, params: { fail(): void }, err: unknown): void {
    console.error(`[vg-new-perspective] ${op} failed`, err);
    params.fail();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try { this.detachAttached?.(); } catch { /* */ }
    this.detachAttached = null;
    this.attachedGrid = null;
    bookEntries.get(this.bookKey)?.tickHandlers.delete(this.onTick);
    this.unregFeed?.();
    void this.book.unregisterView(this.viewId);
    releaseBook(this.bookKey);
  }
}
