// @cgrid/renderers — the kernel bridge. §2.5.
//
// `wireRenderersIntoKernel(grid, opts?)` registers every painter in the
// RENDERER_NAMES table onto a CGrid instance via kernel's PUBLIC
// registration API (`registerCellRenderer`), mirroring
// packages/calc/src/bridge.ts / packages/format/src/bridge.ts / packages/rules/src/bridge.ts.

import type { CellPainter } from '@cgrid/kernel';
import { RENDERER_NAMES, type RendererName } from './types';
import {
  numberCell, priceCell, priceDirectionCell, pnlCell, deltaCell, bpsCell,
  pctChangeCell, fractionalPriceCell, abbreviatedNumberCell,
} from './numeric';
import {
  tickerCell, currencyPairCell, timestampCell, ageCell, relativeTimeCell,
} from './text';
import {
  statusDot, quoteQualityDot, staleFlag, directionArrow, structureIconStrip, trafficLightCell,
} from './indicators';
import {
  statusPill, ratingBadge, ratingClusterCell, tagCell, venueChip, sideChip, tifPill,
} from './badges';
import {
  progressBarCell, rangeBarCell, bidirectionalBarCell, heatCell, gaugeCell,
  spreadBarCell, volumeBar, maturityLadderBar,
} from './bars';
import {
  winLossSparkline, yieldCurveSparkline, krdBarChart, depthLadderCell,
  lineSparkline, columnSparkline, areaSparkline, barSparkline, pieSparkline,
} from './charts';
import {
  stackedValueCell, priceQuoteCell, nbboCell, benchmarkSpreadCell, priceChangeComposite,
} from './composite';
import {
  iconActionCluster, rowMenuCell, resolveHitRegion,
  clearRegionsForRow, defaultHitRegionRegistry,
} from './actions';
import type { IconActionClusterParams, RowMenuCellParams } from './types';
import { ColumnStats, type ColumnStatSnapshot } from './columnStats';
import { TickHistory } from './tickHistory';
import {
  createColDefBuilders,
  type RenderersColDef,
  type RenderersColDefBuilders,
} from './colDefBuilders';

const PAINTERS: Record<RendererName, CellPainter> = {
  number: numberCell,
  price: priceCell,
  'price-direction': priceDirectionCell,
  pnl: pnlCell,
  delta: deltaCell,
  bps: bpsCell,
  'pct-change': pctChangeCell,
  'fractional-price': fractionalPriceCell,
  'abbreviated-number': abbreviatedNumberCell,
  ticker: tickerCell,
  'currency-pair': currencyPairCell,
  timestamp: timestampCell,
  age: ageCell,
  'relative-time': relativeTimeCell,
  'status-dot': statusDot,
  'quote-quality-dot': quoteQualityDot,
  'stale-flag': staleFlag,
  'direction-arrow': directionArrow,
  'structure-icon-strip': structureIconStrip,
  'traffic-light': trafficLightCell,
  'status-pill': statusPill,
  'rating-badge': ratingBadge,
  'rating-cluster': ratingClusterCell,
  tag: tagCell,
  'venue-chip': venueChip,
  'side-chip': sideChip,
  'tif-pill': tifPill,
  'progress-bar': progressBarCell,
  'range-bar': rangeBarCell,
  'bidirectional-bar': bidirectionalBarCell,
  heat: heatCell,
  gauge: gaugeCell,
  'spread-bar': spreadBarCell,
  'volume-bar': volumeBar,
  'maturity-ladder': maturityLadderBar,
  'win-loss-sparkline': winLossSparkline,
  'yield-curve-sparkline': yieldCurveSparkline,
  'krd-bar-chart': krdBarChart,
  'depth-ladder': depthLadderCell,
  'stacked-value': stackedValueCell,
  'price-quote': priceQuoteCell,
  nbbo: nbboCell,
  'benchmark-spread': benchmarkSpreadCell,
  'price-change-composite': priceChangeComposite,
  'icon-action-cluster': iconActionCluster,
  'row-menu': rowMenuCell,
  'line-sparkline': lineSparkline,
  'column-sparkline': columnSparkline,
  'area-sparkline': areaSparkline,
  'bar-sparkline': barSparkline,
  'pie-sparkline': pieSparkline,
};

const EMPTY_STATS: Readonly<ColumnStatSnapshot> = Object.freeze({
  min: null, max: null, maxAbs: null, sum: null, count: 0,
});

interface CellClickedEvent {
  type: 'cellClicked';
  rowId: string;
  colId: string;
  value: unknown;
  mouse: MouseEvent;
}

interface RowsChangedEventLike {
  type: string;
  added?: Array<{ rowId: string; row: Record<string, unknown> }>;
  updated?: Array<{ rowId: string; row: Record<string, unknown> }>;
  removed?: Array<{ rowId: string; row: Record<string, unknown> }>;
}

interface KernelGridSurface {
  registerCellRenderer(name: string, painter: CellPainter): void;
  on?(type: string, handler: (event: unknown) => void): () => void;
  addEventListener?(type: string, handler: (event: unknown) => void): void;
  removeEventListener?(type: string, handler: (event: unknown) => void): void;
  forEachRow?(fn: (rowId: string, row: Record<string, unknown>) => void): void;
  refresh?: () => void;
  getGridOption?: (key: string) => unknown;
  openContextMenu?: (items: unknown[], x: number, y: number, hit: unknown) => void;
  /** Maps a DOM click to grid-canvas coordinates for hit-region resolution. */
  canvasCoordsFromEvent?: (mouse: MouseEvent) => { x: number; y: number } | undefined;
  __renderersBridgeWired?: RenderersBridgeHandle;
}

export interface RenderersBridgeOptions {
  statsColumns?: string[];
  historyColumns?: Record<string, { window?: number }>;
  now?: () => number;
}

export type { RenderersColDefBuilders, RenderersColDef } from './colDefBuilders';

export interface RenderersBridgeHandle {
  stats: Pick<ColumnStats, 'for' | 'destroy'>;
  history: Pick<TickHistory, 'get' | 'push' | 'destroy'>;
  colDef: RenderersColDefBuilders;
  destroy(): void;
}

function noopStatsFor(): Readonly<ColumnStatSnapshot> {
  return EMPTY_STATS;
}

function findLeafColDef(colDefs: unknown[], colId: string): Record<string, unknown> | undefined {
  for (const entry of colDefs) {
    const def = entry as Record<string, unknown>;
    const children = def.children as unknown[] | undefined;
    if (children?.length) {
      const nested = findLeafColDef(children, colId);
      if (nested) return nested;
      continue;
    }
    if (def.colId === colId || def.field === colId) return def;
  }
  return undefined;
}

function resolveRendererParams(
  grid: KernelGridSurface,
  colId: string,
): unknown {
  const colDefs = grid.getGridOption?.('columnDefs') as unknown[] | undefined;
  if (!colDefs) return undefined;
  const leaf = findLeafColDef(colDefs, colId);
  return leaf?.cellRendererParams;
}

function subscribe(
  grid: KernelGridSurface,
  type: string,
  handler: (event: unknown) => void,
): () => void {
  if (grid.on) return grid.on(type, handler);
  grid.addEventListener?.(type, handler);
  return () => grid.removeEventListener?.(type, handler);
}

/**
 * Wire `@cgrid/renderers` into a CGrid instance. Idempotent — re-calling on
 * an already-wired grid returns the SAME handle.
 */
export function wireRenderersIntoKernel(
  grid: unknown,
  opts?: RenderersBridgeOptions,
): RenderersBridgeHandle {
  const g = grid as KernelGridSurface;
  if (g.__renderersBridgeWired) return g.__renderersBridgeWired;

  const now = opts?.now ?? (() => Date.now());
  let stats: ColumnStats | null = null;
  let history: TickHistory | null = null;

  if (opts?.statsColumns?.length) {
    stats = new ColumnStats(g as never, opts.statsColumns);
  }
  if (opts?.historyColumns && Object.keys(opts.historyColumns).length > 0) {
    history = new TickHistory(g as never, opts.historyColumns);
  }

  // Kernel paint threading hands painters a VISIBLE-COLUMN snapshot keyed by
  // colId — not the raw row — so `params.<xxx>Field` lookups (e.g. `bidField:
  // 'bid'`) miss whenever the field isn't itself a visible column. Maintain a
  // main-side rowId → raw-row mirror (seeded from `forEachRow`, freshened by
  // `rowsChanged`) and swap the full row into `p.rowData` before delegating.
  const rowMirror = new Map<string, Record<string, unknown>>();
  const seedRowMirror = (): void => {
    rowMirror.clear();
    g.forEachRow?.((rowId, row) => rowMirror.set(rowId, row));
  };
  seedRowMirror();

  // `setRowData` does not emit `rowsChanged`; reseed on a miss, throttled so
  // a genuinely-absent rowId can't trigger an O(n) rescan every paint.
  let lastReseedMs = 0;
  const mirrorRow = (rowId: string): Record<string, unknown> | undefined => {
    let row = rowMirror.get(rowId);
    if (row === undefined && g.forEachRow) {
      const nowMs = now();
      if (nowMs - lastReseedMs > 250) {
        lastReseedMs = nowMs;
        seedRowMirror();
        row = rowMirror.get(rowId);
      }
    }
    return row;
  };

  // F4b — scratch objects reused across paints for spread-bar's history
  // injection. `SpreadBarCellParams`'s shape is fixed (bidField / askField /
  // history), so mutating known fields in place — rather than
  // `{...prevParams, history: {values: [...values], window}}` — avoids a
  // fresh params object + a redundant values-array copy per cell per frame
  // (`history.get()` already returns a freshly-materialized array; copying
  // it again was pure waste). Pattern precedent: charts.ts's
  // `sparklineAdapterParams`. Safe because the kernel consumes
  // `p.params` synchronously within the same paint call — nothing retains
  // the reference across cells.
  const spreadBarHistoryScratch: { values: readonly number[]; window: number } = {
    values: [],
    window: 0,
  };
  const spreadBarParamsScratch: Record<string, unknown> = {
    history: spreadBarHistoryScratch,
  };

  // The kernel invokes `cellRendererSelector` with `data: null`, so selectors
  // can't read per-row values either — history injection must happen HERE at
  // paint time, where `p.rowId` is threaded by the composite channel.
  const withBridgeThreading = (name: RendererName, painter: CellPainter): CellPainter => ({
    paint(gc, p) {
      const mutable = p as {
        rowData?: Record<string, unknown>;
        params?: unknown;
        rowId?: string;
        colId?: string;
      };
      const rowId = mutable.rowId;
      if (rowId === undefined) {
        painter.paint(gc, p);
        return;
      }
      const prevRowData = mutable.rowData;
      const prevParams = mutable.params;
      const full = mirrorRow(String(rowId));
      if (full !== undefined) mutable.rowData = full;
      if (name === 'spread-bar' && history !== null && mutable.colId !== undefined) {
        const values = history.get(String(rowId), mutable.colId);
        if (values.length > 0) {
          const base = prevParams as Record<string, unknown> | undefined;
          spreadBarParamsScratch.bidField = base?.bidField;
          spreadBarParamsScratch.askField = base?.askField;
          spreadBarHistoryScratch.values = values;
          spreadBarHistoryScratch.window = values.length;
          mutable.params = spreadBarParamsScratch;
        }
      }
      try {
        painter.paint(gc, p);
      } finally {
        mutable.rowData = prevRowData;
        mutable.params = prevParams;
      }
    },
  });

  for (const name of RENDERER_NAMES) {
    g.registerCellRenderer(name, withBridgeThreading(name, PAINTERS[name]));
  }

  let ageTimer: ReturnType<typeof setInterval> | null = null;
  let ageTimerUsers = 0;

  const ensureAgeTimer = (): void => {
    ageTimerUsers += 1;
    if (ageTimer !== null || !g.refresh) return;
    ageTimer = setInterval(() => g.refresh!(), 1000);
  };

  const colDef = createColDefBuilders({
    statsFor: (colId) => stats?.for(colId) ?? noopStatsFor(),
    historyValues: (rowId, colId) => history?.get(String(rowId), colId) ?? [],
    onTimeRendererUsed: ensureAgeTimer,
    nowMs: now,
  });

  const unsubscribers: Array<() => void> = [];

  const onRowsChanged = (raw: unknown): void => {
    const e = raw as RowsChangedEventLike;
    if (e.type !== 'rowsChanged') return;
    for (const { rowId, row } of e.added ?? []) rowMirror.set(rowId, row);
    for (const { rowId, row } of e.updated ?? []) rowMirror.set(rowId, row);
    for (const { rowId } of e.removed ?? []) {
      rowMirror.delete(rowId);
      // F3 — evict this row's action hit regions too; the module-global
      // defaultHitRegionRegistry otherwise never sheds removed rows.
      clearRegionsForRow(rowId);
    }
  };
  unsubscribers.push(subscribe(g, 'rowsChanged', onRowsChanged));

  // F2 — `setRowData` (a full row-set replace) emits `modelUpdated`, NOT
  // `rowsChanged` (see cgrid.ts's setRowData vs applyTransaction /
  // mirrorEditCommit). `mirrorRow` only reseeds the row mirror on a MISS,
  // so a `setRowData` call that replaces row objects for rowIds already in
  // the mirror leaves it permanently stale — painters keep seeing the old
  // row references forever. Clearing on `modelUpdated` forces the next
  // lookup for every rowId to be a miss, which the existing lazy-reseed
  // path in `mirrorRow` already handles; resetting `lastReseedMs` ensures
  // that first post-clear miss isn't swallowed by the 250ms throttle.
  const onModelUpdated = (raw: unknown): void => {
    const e = raw as { type: string };
    if (e.type !== 'modelUpdated') return;
    rowMirror.clear();
    lastReseedMs = 0;
  };
  unsubscribers.push(subscribe(g, 'modelUpdated', onModelUpdated));

  const onCellClicked = (raw: unknown): void => {
    const e = raw as CellClickedEvent;
    if (e.type !== 'cellClicked') return;
    const coords = g.canvasCoordsFromEvent?.(e.mouse);
    if (!coords) return;

    const hit = resolveHitRegion(e.rowId, e.colId, coords.x, coords.y);
    if (!hit) return;

    const params = resolveRendererParams(g, e.colId);
    if (!params || typeof params !== 'object') return;

    const leaf = findLeafColDef(
      (g.getGridOption?.('columnDefs') as unknown[] | undefined) ?? [],
      e.colId,
    );
    const renderer = leaf?.cellRenderer as string | undefined;

    if (renderer === 'icon-action-cluster') {
      const cluster = params as IconActionClusterParams;
      const action = cluster.actions?.[hit.actionIndex];
      action?.onAction(e.rowId, e.colId);
      return;
    }

    if (renderer === 'row-menu') {
      const menu = params as RowMenuCellParams;
      menu.onOpen?.(e.rowId, e.colId, {
        x: hit.bounds.x,
        y: hit.bounds.y,
        w: hit.bounds.w,
        h: hit.bounds.h,
      });
    }
  };

  unsubscribers.push(subscribe(g, 'cellClicked', onCellClicked));

  const destroy = (): void => {
    for (const unsub of unsubscribers) unsub();
    unsubscribers.length = 0;
    if (ageTimer !== null) {
      clearInterval(ageTimer);
      ageTimer = null;
    }
    ageTimerUsers = 0;
    stats?.destroy();
    history?.destroy();
    rowMirror.clear();
    // F3 — per-bridge registry instances are a logged follow-up; until
    // then, evict everything on destroy so a torn-down grid doesn't leak
    // hit regions the module-global registry would otherwise hold forever.
    defaultHitRegionRegistry.clearAll();
    delete g.__renderersBridgeWired;
  };

  unsubscribers.push(subscribe(g, 'gridPreDestroyed', destroy));

  const handle: RenderersBridgeHandle = {
    stats: stats ?? { for: noopStatsFor, destroy: () => {} },
    history: history ?? { get: () => [], push: () => {}, destroy: () => {} },
    colDef,
    destroy,
  };

  g.__renderersBridgeWired = handle;
  return handle;
}

/** @internal Test hook — painter table completeness. */
export function rendererPainterTableForTests(): Record<RendererName, CellPainter> {
  return PAINTERS;
}
