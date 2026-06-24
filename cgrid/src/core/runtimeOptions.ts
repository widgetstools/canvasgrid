// Runtime-vs-initial option taxonomy + per-option apply functions.
//
// `setGridOption` and `updateGridOptions` route through `applyRuntimeOption`
// below; initial-only keys (`INITIAL_ONLY_OPTIONS`) throw instead. The aim is
// a single canonical list — downstream cycles (theming, state snapshot) read
// from this module so the taxonomy can't drift between docs/catalog and code.
//
// See docs/catalog/01-grid-options.md "Lifecycle — initial vs runtime
// options" for the source of truth on which keys belong in which bucket.

import type { CGridOptions } from '../types';

/**
 * Keys that the grid reads exactly once at construction. Attempts to mutate
 * them via `setGridOption` / `updateGridOptions` throw. `columnDefs` is
 * intentionally listed here because it has its own swap path inside
 * `updateGridOptions` that handles tree rebuild + worker column sync — the
 * `setGridOption` single-key entrypoint cannot perform those side-effects
 * coherently, so it rejects with a clear pointer to the batched API.
 */
export const INITIAL_ONLY_OPTIONS: ReadonlySet<keyof CGridOptions<any>> = new Set<
  keyof CGridOptions<any>
>([
  'columnDefs',
  'getRowId',
  'worker',
]);

/** Keys handled by the runtime apply table. Anything not here AND not in
 *  `INITIAL_ONLY_OPTIONS` is rejected as unknown — keeps the gate tight. */
export type RuntimeOption =
  | 'theme'
  | 'rowHeight'
  | 'headerHeight'
  | 'defaultColDef'
  | 'animateRows'
  | 'rowSelection'
  | 'suppressColumnVirtualisation'
  | 'suppressRowVirtualisation'
  | 'enableCellChangeFlash'
  | 'cellFlashDuration'
  | 'cellFadeDuration'
  | 'asyncTransactionWaitMillis'
  | 'rowBuffer'
  | 'context'
  | 'loading'
  | 'debug'
  | 'rowData';

/** Minimal grid surface the apply table needs. Lives here to avoid a circular
 *  import on `CGrid` (cgrid.ts imports this module). */
export interface RuntimeOptionTarget<TRow = any> {
  options: CGridOptions<TRow>;
  setTheme(themeClass: string): void;
  /** Re-resolve the column tree using the current `options.columnDefs` +
   *  the supplied (or current) `defaultColDef`. Triggers viewport + worker
   *  refresh. Used by both the `defaultColDef` runtime apply and the
   *  `columnDefs` swap path in `updateGridOptions`. */
  rebuildColumns(opts: { defaultColDef?: Partial<any> }): void;
  /** Repaint + viewport invalidation hook. Cheap; safe to call repeatedly. */
  refreshLayout(): void;
  /** SelectionModel mode swap (rowSelection runtime option). */
  setSelectionMode(mode: 'none' | 'single' | 'multiple'): void;
  /** Replace the row data set (mirrors `api.setRowData`). */
  applyRowData(rows: unknown[]): void;
}

/**
 * Apply a single runtime option. The caller has already stored
 * `target.options[key] = value`, so per-option handlers only need to perform
 * downstream side-effects (recompute viewport, update SelectionModel, etc.).
 * Storage-only keys (e.g. `animateRows`, `debug`) fall through to a no-op.
 */
export function applyRuntimeOption<TRow>(
  target: RuntimeOptionTarget<TRow>,
  key: RuntimeOption,
  value: unknown,
): void {
  switch (key) {
    case 'theme':
      if (typeof value === 'string') target.setTheme(value);
      return;
    case 'rowHeight':
    case 'headerHeight':
      target.refreshLayout();
      return;
    case 'defaultColDef':
      // Re-resolve with the new defaults; existing columnDefs stay the same.
      target.rebuildColumns({ defaultColDef: value as Partial<any> | undefined });
      return;
    case 'rowSelection':
      if (value === 'none' || value === 'single' || value === 'multiple') {
        target.setSelectionMode(value);
      }
      return;
    case 'suppressColumnVirtualisation':
    case 'suppressRowVirtualisation':
    case 'rowBuffer':
      // Task 5 reads these in computeViewport; for now just re-run the
      // viewport pass so future Task 5 changes light up without a refactor.
      target.refreshLayout();
      return;
    case 'rowData':
      if (Array.isArray(value)) target.applyRowData(value);
      return;
    case 'animateRows':
    case 'enableCellChangeFlash':
    case 'cellFlashDuration':
    case 'cellFadeDuration':
    case 'asyncTransactionWaitMillis':
    case 'context':
    case 'loading':
    case 'debug':
      // Storage-only: downstream cycles read directly from `options[key]`.
      return;
  }
}

/** True when `key` is a known runtime-mutable option. */
export function isRuntimeOption(key: string): key is RuntimeOption {
  return RUNTIME_OPTION_SET.has(key as RuntimeOption);
}

const RUNTIME_OPTION_SET: ReadonlySet<RuntimeOption> = new Set<RuntimeOption>([
  'theme', 'rowHeight', 'headerHeight', 'defaultColDef',
  'animateRows', 'rowSelection',
  'suppressColumnVirtualisation', 'suppressRowVirtualisation',
  'enableCellChangeFlash', 'cellFlashDuration', 'cellFadeDuration',
  'asyncTransactionWaitMillis', 'rowBuffer',
  'context', 'loading', 'debug', 'rowData',
]);
