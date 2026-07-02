// @cgrid/renderers — typed ColDef builders for wireRenderersIntoKernel. §2.3 / §2.5.

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

const TIME_RENDERERS = new Set<RendererName>(['age', 'relative-time']);

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
    def.type = 'composite';
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
  def.cellRendererSelector = () => ({
    component: name,
    params: { ...params, stats: deps.statsFor(colId) },
  });
  return def;
}

function withHistorySelector(
  name: RendererName,
  field: string,
  params: Record<string, unknown> | undefined,
  deps: ColDefBuilderDeps,
  opts?: { colId?: string; rowIdField?: string },
): RenderersColDef {
  const colId = opts?.colId ?? field;
  const rowIdField = opts?.rowIdField ?? 'id';
  const def = baseColDef(name, field, params, { colId });
  def.cellRendererSelector = ({ data, colId: cid }: { data?: unknown; colId?: string }) => {
    const row = data as Record<string, unknown> | null | undefined;
    const rowId = row?.[rowIdField] ?? row?.rowId;
    const historyCol = typeof cid === 'string' ? cid : colId;
    const values = rowId != null ? deps.historyValues(String(rowId), historyCol) : [];
    return {
      component: name,
      params: { ...params, history: { values: [...values] } },
    };
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
  def.cellRendererSelector = () => ({
    component: name,
    params: { ...params, nowMs: deps.nowMs() },
  });
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
    if (name === 'spread-bar') return withHistorySelector(name, field, p, deps, opts);
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
