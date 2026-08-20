// @wellsfargo-starui/velocity-grid-ext/renderers — typed ColDef builders for wireRenderersIntoKernel. §2.3 / §2.5.

import type { ColumnStatSnapshot } from './columnStats';
import type { RendererName } from './types';
import { RENDERER_NAMES } from './types';
import type {
  AgeCellParams,
  IconActionClusterParams,
  PriceCellParams,
  RowMenuCellParams,
} from './types';

/** Minimal Tier-2 composite program — threads rowData without painting composite fragments. */
export const THREADING_PROGRAM = {
  formatText: () => '',
  resolveStyle: () => null,
  resolveIcon: () => null,
  resolveFragments: () => null,
  source: 'renderers-bridge-threading',
  tiers: { tier0: false, tier1: false, tier2: true },
} as const;

export type RenderersColDef = Record<string, unknown>;

/** Renderers that only read `p.value` / formatted value — no rowData threading stub. */
const VALUE_ONLY_RENDERERS = new Set<RendererName>([
  'number',
  'abbreviated-number',
  'fractional-price',
  'line-sparkline',
  'column-sparkline',
  'area-sparkline',
  'bar-sparkline',
  'pie-sparkline',
]);

const STATS_RENDERERS = new Set<RendererName>(['heat', 'bidirectional-bar', 'volume-bar']);

const TIME_RENDERERS = new Set<RendererName>(['age', 'relative-time', 'stale-flag']);

export interface ColDefBuilderDeps {
  statsFor(colId: string): Readonly<ColumnStatSnapshot>;
  historyValues(rowId: string | number, colId: string): readonly number[];
  onTimeRendererUsed(): void;
  nowMs(): number;
}

function needsRowDataThreading(name: RendererName, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return !VALUE_ONLY_RENDERERS.has(name);
}

function baseColDef(
  name: RendererName,
  field: string,
  params: unknown,
  opts?: { colId?: string; threadRowData?: boolean },
): RenderersColDef {
  const colId = opts?.colId ?? field;
  const def: RenderersColDef = {
    colId,
    field,
    cellRenderer: name,
    cellRendererParams: params,
  };
  if (needsRowDataThreading(name, opts?.threadRowData)) {
    def._compositeProgram = THREADING_PROGRAM;
  }
  return def;
}

function withStatsSelector(
  name: RendererName,
  field: string,
  params: Record<string, unknown> | undefined,
  deps: ColDefBuilderDeps,
  opts?: { colId?: string },
): RenderersColDef {
  const colId = opts?.colId ?? field;
  const def = baseColDef(name, field, params, { colId });
  // F4c — scratch reused across paints. `params`'s non-`stats` fields are
  // fixed at colDef-build time (only `stats` varies per frame), so copy
  // them into a scratch object ONCE here and mutate just `.stats` per
  // call, instead of allocating a fresh `{component, params: {...}}` pair
  // every cell every frame. The kernel consumes the returned object
  // synchronously per cell (see byRows.ts), so reusing/mutating it in
  // place is safe.
  const liveParamsScratch: Record<string, unknown> = { ...params };
  const selectorResult: { component: string; params?: unknown } = { component: name, params };
  def.cellRendererSelector = () => {
    // Prefer live ColumnStats; keep any static params.stats fallback when
    // the column isn't wired (count 0 means "no data seen").
    const live = deps.statsFor(colId);
    if (live.count > 0) {
      liveParamsScratch.stats = live;
      selectorResult.params = liveParamsScratch;
    } else {
      selectorResult.params = params;
    }
    return selectorResult;
  };
  return def;
}

function withNowMs(
  name: RendererName,
  field: string,
  params: Record<string, unknown> | undefined,
  deps: ColDefBuilderDeps,
  opts?: { colId?: string },
): RenderersColDef {
  deps.onTimeRendererUsed();
  const merged = { ...params, nowMs: deps.nowMs() };
  const def = baseColDef(name, field, merged, opts);
  // F4c — scratch reused across paints; see withStatsSelector's comment.
  // Only `nowMs` varies per frame here.
  const nowParamsScratch: Record<string, unknown> = { ...params };
  const selectorResult: { component: string; params: unknown } = { component: name, params: nowParamsScratch };
  def.cellRendererSelector = () => {
    nowParamsScratch.nowMs = deps.nowMs();
    return selectorResult;
  };
  return def;
}

export interface RenderersColDefBuilders {
  renderer(
    name: RendererName,
    field: string,
    params?: unknown,
    opts?: { colId?: string; threadRowData?: boolean },
  ): RenderersColDef;
  price(field: string, params?: PriceCellParams): RenderersColDef;
  heat(field: string, params?: Record<string, unknown>): RenderersColDef;
  age(field: string, params?: AgeCellParams): RenderersColDef;
  relativeTime(field: string, params?: Record<string, unknown>): RenderersColDef;
  priceQuote(field: string, params?: Record<string, unknown>): RenderersColDef;
  iconActionCluster(colId: string, params: IconActionClusterParams): RenderersColDef;
  rowMenu(colId: string, params: RowMenuCellParams): RenderersColDef;
}

export function createColDefBuilders(deps: ColDefBuilderDeps): RenderersColDefBuilders {
  const renderer = (
    name: RendererName,
    field: string,
    params?: unknown,
    opts?: { colId?: string; threadRowData?: boolean },
  ): RenderersColDef => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (TIME_RENDERERS.has(name)) return withNowMs(name, field, p, deps, opts);
    if (STATS_RENDERERS.has(name)) return withStatsSelector(name, field, p, deps, opts);
    // spread-bar history is injected at paint time by the bridge wrapper
    // (kernel selectors receive data: null, so per-row lookup is impossible there).
    return baseColDef(name, field, params, opts);
  };

  return {
    renderer,
    price: (field, params) => renderer('price', field, params),
    heat: (field, params) => renderer('heat', field, params),
    age: (field, params) => renderer('age', field, params),
    relativeTime: (field, params) => renderer('relative-time', field, params),
    priceQuote: (field, params) => renderer('price-quote', field, params),
    iconActionCluster: (colId, params) => baseColDef('icon-action-cluster', colId, params, { colId }),
    rowMenu: (colId, params) => baseColDef('row-menu', colId, params, { colId }),
  };
}

/** Every canonical name is reachable via `colDef.renderer(name, …)`. */
export function assertBuilderNameCoverage(): void {
  for (const name of RENDERER_NAMES) {
    if (!name) throw new Error('empty renderer name');
  }
}

assertBuilderNameCoverage();
