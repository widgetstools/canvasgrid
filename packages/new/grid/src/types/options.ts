// VelocityGridOptions — the kitchen-sink constructor option bag plus the small
// option-shaped helper types that only appear inside it
// (CCellSelectionOptions). Depends on column.ts (CColDef, CColGroupDef,
// GetRowHeightParams, FillOperationParams), group.ts (IAggFunc),
// clipboard.ts (the three clipboard/export callbacks), and the external
// interaction/* modules for context menu / tool panels / status bar / etc.

import type { GetContextMenuItemsCallback, GetMainMenuItemsCallback } from '../interaction/contextMenu/types';
import type { ToolPanelComponent, SideBarDef } from '../interaction/toolPanels/types';
import type { StatusBarDef, StatusPanelComponent } from '../interaction/statusBar/types';
import type {
  CColDef,
  CColGroupDef,
  FillOperationParams,
  GetRowHeightParams,
} from './column';
import type { IAggFunc } from './group';
import type { CgTheme } from '../theming/theme/themeObject';
import type {
  ExportCallback,
  ProcessCellForClipboardCallback,
  ProcessCellFromClipboardCallback,
} from './clipboard';

/**
 * Hard floor for data-row height (CSS px). Values below this make partial
 * scroll paints look like uneven / squashed rows (clipped glyphs between
 * irregular gridlines). Compact density token is 24 — match that floor.
 */
export const MIN_ROW_HEIGHT_PX = 24;

/** Clamp a requested row height to {@link MIN_ROW_HEIGHT_PX}. */
export function clampRowHeight(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return MIN_ROW_HEIGHT_PX;
  return h < MIN_ROW_HEIGHT_PX ? MIN_ROW_HEIGHT_PX : h;
}

/** Suppression flags for the cell-range selection pathways. Each flag
 *  defaults to `false` when omitted — the matching gesture creates / updates
 *  ranges as usual. Cycle 9 / Task 6. */
export interface CCellSelectionOptions {
  /** When `true`, a click on a column header no longer selects the whole
   *  column. Sort cycling on the same click is unaffected. */
  suppressHeader?: boolean;
  /** When `true`, mouse drag (and the plain-click + shift-click + ctrl-click
   *  pathways the drag feature owns) no longer creates or mutates ranges.
   *  Focus + row selection on the same press still happen. */
  suppressDrag?: boolean;
}

export interface VelocityGridOptions<TRow = any> {
  columnDefs: (CColDef<TRow> | CColGroupDef<TRow>)[];
  defaultColDef?: Partial<CColDef<TRow>>;
  /**
   * Named `Partial<CColDef>` bundles. Reference by `CColDef.type` (single
   * string or string array). The merge order applied at resolve time is
   * `{ ...columnTypes[name1], ...columnTypes[name2], ...defaultColDef,
   *    ...colDef }` — types merge left-to-right, then defaultColDef, then
   * the column itself (column always wins).
   *
   * Deprecation alias: a column whose `type` is `'text'` or `'number'` and
   * for which `columnTypes` carries no entry of that name collapses the
   * value into `cellDataType` so legacy callers keep working.
   *
   * Cycle 6 / Task 6.
   */
  columnTypes?: Record<string, Partial<CColDef<TRow>>>;
  rowData?: TRow[];
  getRowId: (row: TRow) => string;
  /**
   * Row model. Default `'clientSide'` (full in-memory store). `'serverSide'`
   * activates the SSRM block-cache path: the app supplies
   * {@link serverSideDatasource}; the worker only hydrates viewport windows.
   * Initial-only for the first cut.
   */
  rowModelType?: 'clientSide' | 'serverSide';
  /**
   * SSRM datasource — main-thread `getRows` implementation. Required when
   * `rowModelType === 'serverSide'`. Runtime-mutable via
   * `api.setServerSideDatasource`.
   */
  serverSideDatasource?: import('./ssrm').AnyServerSideDatasource<TRow>;
  /** Rows per SSRM block fetch. Default `100`. Initial-only. */
  cacheBlockSize?: number;
  /** Max parallel `getRows` calls. Default `2`. Initial-only. */
  maxConcurrentDatasourceRequests?: number;
  /**
   * SSRM CSRM feature parity bridge.
   *
   * - `true` — fully hydrate the book and run the worker CSRM pipeline
   *   (filter / sort / group / pivot / totals) for the life of the grid.
   * - `false` — lean sparse path; the datasource owns filter/sort/group/agg
   *   and may attach {@link SSRM_ROW_META_KEY} on rows for group paint.
   * - `undefined` (default) — auto: enable the client pipeline when
   *   CSRM-shaping options are configured (`rowGroupPanelShow`, group/grand
   *   totals, pivot mode, …). Grouping / pivot also force-enable at runtime.
   */
  serverSideEnableClientSidePipeline?: boolean;
  /**
   * Default data-row height in CSS px. Clamped to at least
   * {@link MIN_ROW_HEIGHT_PX} (24) — shorter rows make scroll-blit seams
   * look like squashed / uneven row heights under HiDPI.
   */
  rowHeight?: number;
  headerHeight?: number;
  rowSelection?: 'none' | 'single' | 'multiple';
  /**
   * Unified selection configuration. Mirrors ag-grid v33+'s `selection`
   * API: pick a `mode` (`'singleRow'` / `'multiRow'` / `'cell'`) and
   * configure its specifics in one place. When set, this OVERRIDES the
   * legacy `rowSelection`, `suppressRowClickSelection`,
   * `rowMultiSelectWithClick`, and per-column `checkboxSelection` /
   * `headerCheckboxSelection`. When omitted, the legacy surface
   * remains the source of truth.
   *
   * Auto-injection: when `selection.checkboxes` is `true`, a pinned-
   * left checkbox column with `colId: '__cg_select__'` is prepended
   * to `columnDefs` automatically. Set `headerCheckbox: true` to add
   * the tri-state header checkbox on that column.
   */
  selection?: import('../core/selectionConfig').SelectionConfig<TRow>;
  /**
   * When `true`, clicking on a body cell does NOT toggle the row's
   * membership in the selection set. Focus still moves to the
   * clicked cell. Pair with `checkboxSelection: true` on a pinned
   * column to enforce checkbox-only row selection — the canonical
   * "blotter with a select column" pattern.
   */
  suppressRowClickSelection?: boolean;
  /**
   * When `true`, plain (no-modifier) clicks on body cells TOGGLE the
   * row's selection set membership instead of replacing it. Mirrors
   * checkbox-list semantics from email clients / file managers; only
   * meaningful with `rowSelection: 'multiple'`.
   */
  rowMultiSelectWithClick?: boolean;
  enableCellChangeFlash?: boolean;
  cellFlashDuration?: number;
  cellFadeDuration?: number;
  /**
   * Debounce window (ms) for `applyTransactionAsync` before the worker
   * flushes the pending batch. Default `50` when omitted. Pair with
   * `asyncTransactionConflate` / `asyncTransactionThrottleMillis`.
   * Runtime-mutable via `setGridOption`.
   */
  asyncTransactionWaitMillis?: number;
  /**
   * When `true` (default), the worker coalesces pending
   * `applyTransactionAsync` payloads by row id before applying them —
   * last write wins within the batch window. Set `false` to apply every
   * queued transaction in arrival order (no drop). Runtime-mutable.
   */
  asyncTransactionConflate?: boolean;
  /**
   * Minimum milliseconds between async transaction flushes under a
   * continuous update stream — the grid's live-update rate cap.
   *
   * Default `200` (at most 5 grid updates per second). Isolated updates
   * are NOT delayed by the throttle: after a quiet period the first
   * flush still lands as soon as `asyncTransactionWaitMillis` elapses —
   * only sustained streams are spaced. Values are clamped to
   * `[100, 1000]`; an explicit `0` disables throttling entirely (the
   * programmatic escape hatch for tests / apps that need every flush
   * immediately — the Grid Options editor offers only the clamped
   * range). Runtime-mutable via `setGridOption`.
   */
  asyncTransactionThrottleMillis?: number;
  /**
   * When `true` (the default), `applyTransactionAsync` calls that arrive
   * during an active body scroll are buffered on the main thread and
   * flushed once on `bodyScrollEnd` (conflated by row id). Cell-flash
   * fade rAF is also paused for the gesture. Matches Deephaven-style
   * "paint scroll first; apply live ticks when settled" so 20k+ live
   * feeds do not contend with scroll paints / viewport fetches.
   * Set `false` to apply every async transaction immediately even while
   * scrolling.
   */
  deferAsyncTransactionsWhileScrolling?: boolean;
  /**
   * A CSS class name (`'vg-theme-quartz'`, the default) OR a programmatic
   * `CgTheme` object (`themeQuartz.withParams({ accentColor: '#2f7bc4' })`).
   * The object form compiles to an inline `--vg-*` var patch on the grid
   * root PLUS its structural base class, resolved light/dark per
   * `pickMode()`; the string form is unchanged (adds the class verbatim).
   * Always in `NON_PERSISTABLE_RUNTIME_OPTIONS` — object themes aren't
   * serializable and app chrome owns the toggle either way.
   */
  theme?: string | CgTheme;
  /**
   * Cycle 22 / Task 2 — density-mode preset. Toggling the value swaps
   * one CSS class on the grid root (`.vg-density-compact` /
   * `.vg-density-normal` / `.vg-density-comfortable`); each class
   * overrides `--vg-row-height`, `--vg-header-height`, and
   * `--vg-cell-padding-x`. Omitting the option (`undefined`) skips
   * the class entirely so the active theme's native row/header
   * dimensions apply.
   *
   * Runtime-mutable via `setGridOption('density', …)` — single class
   * flip + one viewport recompute, no worker round-trip.
   */
  density?: 'compact' | 'normal' | 'comfortable';
  /**
   * Cycle 22 / Task 5 — encapsulate the grid inside a shadow root. When
   * `true`, the grid attaches an open shadow root to the supplied
   * container and mounts ALL of its DOM (canvas, scroller, editors,
   * tool panels, etc.) inside it. The package's tokens.css is also
   * inlined as a `<style>` element inside the shadow root so the
   * grid keeps its theme even when the host page ships an
   * aggressive global reset (Bootstrap, Tailwind preflight, etc.).
   *
   * Initial-only — flip it through the constructor, not via
   * `setGridOption`. The default (`false` / omitted) keeps cgrid in
   * the light DOM where developer tooling + global CSS inspection
   * are easiest.
   *
   * Known limitation: DOM overlays that mount on `document.body`
   * (browser-level dialogs) do not inherit shadow-root styles.
   * Apps using shadow-root mode AND those overlays should declare
   * a duplicate token block on `body` or use the
   * `setThemeParams` API on the relevant element.
   */
  shadowRoot?: boolean;
  /**
   * Cycle 23 / Task 6 — restore a saved state snapshot at
   * construction time. Applied AFTER initial options resolve but
   * BEFORE the first paint, so apps that persist `getState()` to
   * localStorage (or any other store) hand the saved snapshot back
   * here and the grid lights up in the user's last layout.
   *
   * Equivalent to calling `setState(initialState)` immediately after
   * construction; bundling it as a constructor option avoids the
   * one-frame flash where the grid renders with defaults before the
   * restore lands.
   *
   * Older snapshots forward-migrate through `STATE_MIGRATIONS`; newer
   * snapshots (from a future grid version) throw with a clear error.
   */
  initialState?: import('../core/stateSnapshot').GridState;
  /**
   * Cycle 21i / Phase 1 — unique identity for this grid instance.
   * Namespaces persisted state (`velocity-grid:state:<gridId>` under the default
   * localStorage adapter) so several grids on one page — or one grid
   * across sessions — keep their configuration separate. Required for
   * `persistState`; has no effect on its own.
   */
  gridId?: string;
  /**
   * Cycle 21i / Phase 1 — native state persistence. When enabled (and
   * `gridId` is set), the grid restores its saved `GridState` snapshot at
   * construction (applied AFTER `initialState`, so a user's last session
   * wins over the app-provided default) and autosaves the full snapshot,
   * debounced (default 500ms), on every coalesced `stateUpdated` emit.
   *
   * `true` uses the built-in localStorage adapter; the object form swaps
   * in a custom `StateStorageAdapter` (config service, IndexedDB, …) and
   * tunes the debounce. Failures degrade to console warnings — the grid
   * never breaks because storage did. Last-write-wins; multi-tab
   * coordination belongs in the host's adapter.
   */
  persistState?: boolean | import('../core/statePersistence').PersistStateOptions;
  /**
   * Grid Layouts (Phase A) — seed the layout registry with named layouts.
   * A reserved `'default'` layout is synthesized from the construction
   * baseline when the list omits one. (Persistence of layouts lands in a
   * later unit; these are the app-provided seeds.)
   */
  layouts?: import('./layout').GridLayout[];
  /**
   * Grid Layouts — id of the initially-active layout. Falls back to
   * `'default'` when it does not name a supplied layout.
   */
  activeLayoutId?: string;
  /**
   * Grid Layouts — module ids treated as GRID-tier (shared across every
   * layout rather than captured per-layout). Defaults to
   * `['editSettings', 'templates', 'alerts', 'data-provider']` (see `DEFAULT_GRID_LEVEL_MODULES`).
   */
  layoutGridLevelModules?: string[];
  /**
   * Cycle 24 / Task 3 — `aria-label` applied to the grid's
   * role="grid" element in the a11y overlay. Screen readers read this
   * as the grid's name. Defaults to no label (the overlay has no
   * `aria-label` attribute when omitted).
   */
  ariaLabel?: string;
  /**
   * Cycle 24 / Task 6 — Tab-out callbacks. Fired when the user presses
   * Tab at the LAST tabbable cell (or Shift+Tab at the first). Return
   * `true` to keep focus inside the grid (wrap to the opposite end);
   * return `false` to release focus so the browser's native Tab takes
   * the user out to the next / previous focusable element on the
   * page. Omitting either keeps the original wrap-to-next-row
   * behavior.
   */
  tabToNextHeader?: (params: { event: KeyboardEvent }) => boolean;
  tabToPreviousHeader?: (params: { event: KeyboardEvent }) => boolean;
  worker?: { url?: string };

  /** Hint to skip CSS-animated row transitions. Runtime-mutable; storage-only
   *  in Cycle 4 (no read site yet; downstream cycles consume). */
  animateRows?: boolean;
  /**
   * Cycle 21i / Phase 1 — when `true`, disables the row-hover highlight
   * (the `--vg-row-hover-bg` band the painter draws under the pointer's
   * data row). Default `false` (hover highlight ON). Runtime-mutable.
   * AG-Grid parity name.
   */
  suppressRowHoverHighlight?: boolean;
  /**
   * Damage-region rendering — when `true`, forces every paint through the
   * full-surface path regardless of what's queued on the internal damage
   * ledger; the `repaintFull`/`repaintRows`/`repaintCells` helpers also
   * degrade to a full repaint. Escape hatch for apps that hit a damage-
   * resolution bug, or for screenshot/print paths that always want the
   * whole canvas repainted. Default `false` (partial repaints enabled once
   * a source records damage — no source does yet in this task).
   * Runtime-mutable.
   */
  suppressPartialRepaint?: boolean;
  /** Render every center column regardless of horizontal scroll position.
   *  Useful for screenshot tests and CSV-style exports where the painter
   *  needs every column visible at once. Pinned columns are unaffected. */
  suppressColumnVirtualisation?: boolean;
  /** Render every data row regardless of vertical scroll position. Trades
   *  scroll-FPS for guaranteed full-grid materialisation. */
  suppressRowVirtualisation?: boolean;
  /** Cycle 20 / Task 6 — DOM layout mode. `'normal'` (default) is the
   *  scroll-virtualised grid. `'print'` grows the host element to
   *  content height + materialises every row so `window.print()`
   *  captures the entire grid (not just the visible viewport). Acts
   *  as if `suppressRowVirtualisation: true` AND
   *  `suppressColumnVirtualisation: true` were set. Runtime-mutable
   *  — flip to `'print'`, call `window.print()`, flip back to
   *  `'normal'` to restore the virtualised layout. */
  domLayout?: 'normal' | 'print';
  /** Number of extra rows to materialise above and below the visible window.
   *  Defaults to the engine's internal overscan (3) when unset. On the lean
   *  path (`paintCache: false` / `qualityMode: 'performance'`), apps should
   *  set this explicitly for Deephaven-style snappy scrolling (ext demo uses
   *  32) — the escape hatch does not invent a larger default. */
  rowBuffer?: number;
  /** Cycle 25 / Task 4 — opt into the worker-side painter.
   *   `'auto'` (default) selects `'offscreen'` when the platform
   *  supports `OffscreenCanvas` + `Worker`, else `'main'`.
   *   `'main'` forces the historic main-thread painter (useful
   *  when the worker painter has a known regression).
   *   `'offscreen'` requests the worker painter but still falls
   *  back to `'main'` when the platform can't support it (no
   *  surprise crashes).
   *  NOTE: This commit ships the option + detection; the worker
   *  painter itself is the follow-up that closes Task 4. */
  paintMode?: 'auto' | 'main' | 'offscreen';
  /**
   * Paint-quality profile for low-end / no-GPU hosts.
   *
   * - `'auto'` (default) — disable the retained paint-cache layer when
   *   the WebGL renderer is a known software rasterizer (SwiftShader,
   *   llvmpipe, …). Hardware GL keeps the layer.
   * - `'performance'` — always disable `paintCache` (and default
   *   `paintCacheOverscan` to `0`). Keep `rasterCache` on — cell/strip
   *   bitmaps still help on software Canvas2D.
   * - `'quality'` — keep the retained layer (ignore software detection).
   *
   * Explicit `paintCache: true | false` always wins over this field.
   */
  qualityMode?: 'auto' | 'quality' | 'performance';
  /** Retained paint-cache layer (Phase C of the damage-region system) —
   *  when `true` (the default on hardware GL), scroll frames present via
   *  a single `drawImage` of an offscreen layer instead of re-rastering
   *  every visible row each tick; text only rasters when content actually
   *  changes or the layer's coverage needs to extend. `false` is the
   *  field escape hatch: reproduces the exact pre-paint-cache damage
   *  pipeline (same as `suppressPartialRepaint` for the base damage
   *  system). Under `qualityMode: 'auto'`, software-GL hosts resolve
   *  this to `false` at construction. Runtime-mutable via
   *  `updateGridOptions` — flipping it tears down / rebuilds the layer.
   *  See docs/superpowers/specs/2026-07-11-paint-cache-layer-design.md.
   *
   *  Note: even when the layer is on, `damage.full` frames paint through
   *  the legacy path (hybrid routing) so continuous scroll does not pay
   *  a double offscreen+present cost on software raster. */
  paintCache?: boolean;
  /** Coverage margin banked on each side of the visible body for the
   *  paint-cache layer, as a multiple of body height — e.g. `1` (the
   *  default, matching Deephaven `ROW_BUFFER_PAGES = 1`) banks a full
   *  screen of rows above AND below the visible range so ordinary scroll
   *  velocity and modest thumb drags stay within loaded data. Clamped to
   *  `[0, 2]`. Widens the worker's row-fetch window (`rowBuffer`) to match
   *  so the fetched data always covers the layer's coverage. Ignored when
   *  `paintCache: false`. */
  paintCacheOverscan?: number;
  /** Cycle 22 raster cache — Tier-1 content-keyed cell bitmaps (the
   *  Tier-2 row-strip store is constructed alongside it, consuming in a
   *  later task): when `true` (the default), a cell whose full
   *  style+content signature has been painted before blits from a cached
   *  bitmap instead of re-running its cell painter. `false` is the field
   *  escape hatch: reproduces the exact shipped cell-paint pipeline
   *  (mirrors `paintCache`'s framing). Runtime-mutable via
   *  `updateGridOptions` — flipping it disposes / rebuilds both tiers. */
  rasterCache?: boolean;
  /** Byte budget shared by BOTH raster-cache tiers (cell bitmaps + row
   *  strips) as ONE global cross-tier LRU, in MB. Default 48. Ignored
   *  when `rasterCache: false`. Runtime-mutable — a change rebuilds both
   *  tiers under a fresh budget.
   *
   *  Retained-memory envelope (closeout M-1): this budget caps the LIVE
   *  entries; each tier additionally keeps an OFF-ledger canvas reuse
   *  pool (evicted backing stores held for recycling, capped at half
   *  this budget per pool), so worst-case total retention is ≈ 2× this
   *  value. Both figures are observable: `PaintStats.rasterCacheBytes`
   *  (ledger) + `PaintStats.rasterCachePooledBytes` (pools). */
  rasterCacheBudgetMB?: number;
  /** Cycle 25 / Task 10 — soft cap on the cumulative byte size of
   *  cached viewport chunks the grid holds across requests. When
   *  exceeded, older chunks are evicted from the LRU (which itself
   *  holds them via `WeakRef`, so V8/JSC can collect them ahead of
   *  our eviction under real memory pressure). Undefined / `0`
   *  disables the cap (caching disabled — every viewport request
   *  goes to the worker). Typical: 32. */
  memoryBudgetMB?: number;
  /** Opaque application data forwarded to callbacks (matches ag-grid).
   *  Storage-only in Cycle 4. */
  context?: unknown;
  /** Explicit loading-overlay toggle. When `true`, the grid paints a busy
   *  spinner over the viewport and sets `aria-busy`. Flip via
   *  `setGridOption('loading', …)` during async loads. */
  loading?: boolean;
  /** Primary label on the busy overlay (under the spinner). Defaults to
   *  “Loading…”. Update live via `setGridOption('loadingMessage', …)`. */
  loadingMessage?: string;
  /** Enables verbose console logging from the engine. Storage-only. */
  debug?: boolean;

  /** Start editing on a single click instead of double-click. Per-column
   *  override via `CColDef.singleClickEdit` (column wins). */
  singleClickEdit?: boolean;
  /** Disable click-to-edit (single AND double click). Editing then only
   *  starts via keyboard (F2 / Enter) or programmatic API. */
  suppressClickEdit?: boolean;
  /** Commit any open editor when the grid host loses focus. `@initial` — the
   *  blur listener is wired at construction time. */
  stopEditingWhenCellsLoseFocus?: boolean;
  /** Excel-style: Enter (without editing) moves the focused cell down by
   *  one row instead of opening the editor. */
  enterNavigatesVertically?: boolean;
  /** When a cell edit commits via Enter, also move the focus down by one
   *  row. Combine with `enterNavigatesVertically` for full Excel parity. */
  enterNavigatesVerticallyAfterEdit?: boolean;
  /** macOS convenience: start editing on Backspace key press. */
  enableCellEditingOnBackspace?: boolean;
  /** Prevent Tab from opening the editor on the next editable cell after
   *  a commit. Tab still moves focus. */
  suppressStartEditOnTab?: boolean;
  /** Excel-style editing. Each open edit carries a `mode` of `'enter'` or
   *  `'edit'`:
   *  - Type-to-edit (printable key) starts in `'enter'` — arrow keys then
   *    commit + move focus to the adjacent cell.
   *  - F2, double-click, single-click (when `singleClickEdit`) and
   *    `api.startEditingCell` start in `'edit'` — arrow keys move the
   *    caret inside the input.
   *  - Mousedown inside the open editor flips `'enter'` → `'edit'`.
   *
   *  When `false` (default) the mode is inert and arrow keys always
   *  behave like the input's native handler. */
  enableExcelEditing?: boolean;
  /** Modifier key that turns a header click into a multi-column sort
   *  append (Shift-click → append to the existing sort model instead of
   *  replacing it). Defaults to `'Shift'`. Set to `null` to disable
   *  multi-sort entirely (every header click replaces). Cycle 8 / Task 1. */
  multiSortKey?: 'Shift' | 'Ctrl' | 'Alt' | null;
  /** Cycle order for `cycleSort`. Defaults to `['asc', 'desc', null]` —
   *  unsorted → asc → desc → unsorted. Setting `['asc', 'desc']` keeps the
   *  column always sorted (no unsorted stage; the third cycle wraps back
   *  to asc). Any permutation of `'asc' | 'desc' | null` is honored;
   *  values outside the cycle are treated as "start at index 0". Applies
   *  to both plain-click (replace) and append (Shift+click) modes.
   *  Cycle 8 / Task 2. */
  sortingOrder?: Array<'asc' | 'desc' | null>;

  /** Grid-wide default for the floating-filter row. Defaults to `true`
   *  (visible). When `false`, hides the floating-filter row entirely.
   *  When `true` or `undefined`, every column renders a floating-filter
   *  `<input>` beneath the leaf-header row unless the column explicitly
   *  sets `floatingFilter: false`. Per-column `CColDef.floatingFilter`
   *  wins over this. Cycle 7 / Task 1. */
  floatingFilter?: boolean;
  /** Pixel height of the floating-filter row. Defaults to `28`. Forwarded
   *  to `FloatingFilterSubgrid` + `FloatingFilterOverlay`. Cycle 7 / Task 1. */
  floatingFilterHeight?: number;
  /** Top/bottom inset (CSS px) of each floating-filter `<input>` inside its
   *  row — the input's height is `floatingFilterHeight - 2 × this`. Larger
   *  values give the inputs more vertical margin. Defaults to `4`. */
  floatingFilterInsetY?: number;
  /** Cross-column quick filter text. When non-empty, the grid evaluates a
   *  worker-side `QuickFilterPass` BEFORE the per-column `FilterPass`: the
   *  text is split into terms by `quickFilterParser` (defaults to
   *  whitespace) and a row passes only when every term is `includes`-matched
   *  against the row's aggregate column text. Mutating this option at
   *  runtime (`setGridOption('quickFilterText', value)`) re-runs the pass
   *  and fires `filterChanged` with `source: 'quickFilter'`. Pass `''` or
   *  `undefined` to clear. Cycle 7 / Task 7. */
  quickFilterText?: string;
  /** When `true`, the worker caches each row's aggregate quick-filter text
   *  and reuses it across subsequent `quickFilterText` changes, so a hot
   *  type-as-you-search loop reads from the cache instead of re-coercing
   *  every cell value per keystroke. Invalidated when the column set
   *  changes or when a transaction lands. Defaults to `false`. Cycle 7 /
   *  Task 7. */
  cacheQuickFilter?: boolean;
  /** When `true`, hidden columns contribute to each row's aggregate
   *  quick-filter text. When `false` (default) only visible columns
   *  contribute. Cycle 7 / Task 7. */
  includeHiddenColumnsInQuickFilter?: boolean;
  /** Splits the quick-filter text into search terms. Runs on the main
   *  thread once per `quickFilterText` change; the resulting `string[]`
   *  ships to the worker. Defaults to
   *  `text.split(/\s+/).filter(t => t.length > 0)`. Cycle 7 / Task 7. */
  quickFilterParser?: (text: string) => string[];
  /** Overrides the default match. The default — case-insensitive
   *  `parts.every(p => agg.includes(p))` — runs on the worker, which lets
   *  the per-row aggregate text never cross the main↔worker boundary.
   *  Cycle 7 ships the API surface; arbitrary closures wait for Cycle
   *  24's worker-module loader. When this is supplied in Cycle 7 the
   *  function source is serialized via `Function.prototype.toString` and
   *  reconstructed on the worker via `new Function(...)`; CSP-restricted
   *  hosts that disallow `new Function` fall back to the default with a
   *  `console.warn`. The matcher must be a PURE function — it must not
   *  close over external scope. Cycle 7 / Task 7. */
  quickFilterMatcher?: (parts: string[], rowAggregateText: string) => boolean;
  /** Cycle 7 / Task 8 — app-provided gate for external filtering. Called
   *  before every filter pass; when it returns `true`, the worker pauses
   *  the pipeline mid-flight and pushes the candidate rowIds to main, then
   *  awaits the survivor subset before completing. When this returns
   *  `false` (or is undefined) the round-trip is skipped entirely and
   *  `doesExternalFilterPass` is never called. Apps re-trigger by calling
   *  `api.onFilterChanged('externalFilter')` after mutating any state the
   *  predicate closes over. */
  isExternalFilterPresent?: () => boolean;
  /** Cycle 7 / Task 8 — per-row predicate that runs on the main thread
   *  for each rowId in the worker's candidate set. Return `true` to keep
   *  the row in the visible set, `false` to drop it. Called once per
   *  candidate row per `onFilterChanged` trigger; runs in addition to
   *  (and after) column + quick filters. Rows where `alwaysPassFilter`
   *  returns `true` bypass this predicate. */
  doesExternalFilterPass?: (params: { data: TRow; rowId: string }) => boolean;
  /** Cycle 7 / Task 8 — per-row "always include" predicate. Rows for
   *  which this returns `true` bypass every filter (column / quick /
   *  external) and are unconditionally part of the visible set, even
   *  when their data would otherwise be filtered out. Useful for pinned
   *  summary rows or locked reference rows that must always be visible
   *  regardless of filter state. Main runs the predicate against its
   *  row-data cache on every `setRowData` / `applyTransaction` and ships
   *  the resolved rowId set to the worker. */
  alwaysPassFilter?: (params: { data: TRow; rowId: string }) => boolean;
  /** Cycle 8 / Task 4 — post-sort re-order hook. Runs on the main thread
   *  after the worker's `SortPass.apply` and before `ViewportSlicer.slice`.
   *  Receives the post-sort rowId array and a `getData(rowId)` accessor that
   *  resolves the live row record from the grid's main-thread cache (so the
   *  app can read full row data without ferrying the map across postMessage).
   *  Return the (possibly re-ordered) rowId array. The worker resumes with
   *  the returned order before slicing.
   *
   *  Use cases: pin selected rows to top regardless of sort, group siblings
   *  together post-sort, stable secondary ordering rules that can't be
   *  expressed as a comparator over a single column, etc.
   *
   *  No round-trip overhead when the hook isn't set — the worker pipeline
   *  runs end-to-end synchronously. Apps re-trigger by calling
   *  `setSortModel(getSortModel())` (or any other pipeline-invalidating
   *  setter) after mutating any state the hook closes over (e.g. flipping
   *  a "pin selected" toolbar toggle). */
  postSortRows?: (params: {
    rowIds: string[];
    getData: (rowId: string) => TRow | undefined;
  }) => string[];
  /**
   * Full-row edit mode. When `'fullRow'`, triggering an edit on any cell in
   * a row opens an editor for every editable column in that row
   * simultaneously. Tab/Shift+Tab cycle between editors within the row;
   * Enter commits all values together; Escape cancels the entire row.
   * Fires `rowEditingStarted` / `rowEditingStopped` / `rowValueChanged`
   * (catalog 22) in addition to the per-cell events. Cycle 5 / Task 10.
   */
  editType?: 'fullRow';

  /**
   * Per-row height in CSS px. Called by the main thread on `setRowData`,
   * `applyTransaction(add|update)`, and any row whose underlying data
   * mutates. Returning `null` / `undefined` falls back to the grid-level
   * `rowHeight`. The resolved height is shipped to the worker
   * (`heightsByRowId` on the matching message) and rides each viewport
   * chunk back as a `Float32Array`. Cycle 5 / Task 6.
   */
  getRowHeight?: (params: GetRowHeightParams<TRow>) => number | null | undefined;

  /** Show the 6×6 fill-handle at the bottom-right of the focused range.
   *  When `false` (default) the handle is suppressed and the bottom-right
   *  corner of a range is treated as a regular cell — the next mousedown
   *  there starts a new range drag instead of a fill-extend. Cycle 9 / Task 5. */
  enableFillHandle?: boolean;
  /** Axes the fill handle can extend along. `'y'` (default) extends
   *  downward only; `'x'` extends rightward only; `'xy'` allows whichever
   *  axis has the larger pointer delta from the source bottom-right.
   *  Cycle 9 / Task 5. */
  fillHandleDirection?: 'x' | 'y' | 'xy';
  /** Per-target-cell override for the default extrapolation. Called once
   *  per cell that the fill-handle commit will write. Return the new value
   *  to commit (any type), or `false` to fall back to the built-in default
   *  (linear extrapolation for numeric source values, repeat for text).
   *  Cycle 9 / Task 5. */
  fillOperation?: (params: FillOperationParams<TRow>) => unknown | false;

  /** Cell-range selection knobs. When omitted, ranges work with the
   *  Cycle 9 defaults (drag enabled, shift extend, ctrl disjoint,
   *  header-click column band). Read at event time, so a runtime
   *  `setGridOption('cellSelection', …)` takes effect on the next
   *  pointer event without re-wiring the feature chain.
   *  Cycle 9 / Task 6. */
  cellSelection?: CCellSelectionOptions;

  /** Cycle 10 / Task 1 — resolve the right-click menu items for the
   *  hit under the cursor. Receives the row / column the right-click
   *  landed on (`null` for non-cell hits like the header or scrollbar),
   *  the current cell-range snapshot, and the built-in `defaultItems`
   *  list (populated by Task 2's `buildDefaultMenuItems`). Return an
   *  empty array to suppress the menu without showing the native
   *  browser menu (the feature already called `preventDefault`).
   *  Read at event time so a runtime `setGridOption('getContextMenuItems',
   *  …)` takes effect on the next right-click. */
  getContextMenuItems?: GetContextMenuItemsCallback;

  /** Cycle 10 (post-cycle patch) — resolve the right-click menu items for
   *  a column HEADER hit. ag-grid calls this the "main menu" — distinct
   *  from `getContextMenuItems`, which only fires for body-cell right-
   *  clicks. Receives the colId under the cursor and the built-in
   *  `defaultItems` list (populated by `buildDefaultMainMenuItems`).
   *  Return an empty array to suppress the header menu without showing
   *  the native browser menu. Read at event time so a runtime
   *  `setGridOption('getMainMenuItems', …)` takes effect on the next
   *  header right-click. */
  getMainMenuItems?: GetMainMenuItemsCallback;

  /** Cycle 10 / Task 3 — character placed between cells when serialising
   *  a cell-range to the system clipboard. Defaults to `'\t'` (TSV,
   *  which Excel / Sheets / Numbers paste as a grid). Common override
   *  is `','` for CSV, but any single character is legal. Read at copy
   *  time so a runtime `setGridOption('clipboardDelimiter', ',')` takes
   *  effect on the next Ctrl+C / menu Copy. */
  clipboardDelimiter?: string;

  /** Cycle 10 / Task 5 — per-cell transform applied on copy / cut BEFORE
   *  serialisation. Receives the raw value, the row's `data` + visible
   *  `rowIndex`, and the target `colId`. Return the value to ship to the
   *  clipboard (any type — `String(...)` coercion happens after). Runs
   *  on the main thread so apps can reference DOM / domain state from
   *  the callback. Read at copy time so a runtime `setGridOption(
   *  'processCellForClipboard', …)` takes effect on the next Ctrl+C /
   *  Ctrl+X / menu Copy / menu Cut. */
  processCellForClipboard?: ProcessCellForClipboardCallback<TRow>;

  /** Cycle 10 / Task 5 — per-cell transform applied on paste BEFORE the
   *  pasted value is written into the row. Receives the parsed string
   *  from the clipboard payload (RFC-4180 already unwrapped), the row's
   *  `data` + visible `rowIndex`, and the target `colId`. Return the
   *  value to assign (any type). Runs on the main thread between the
   *  worker's TSV parse and `applyTransaction({ update })`. Read at
   *  paste time so a runtime `setGridOption('processCellFromClipboard',
   *  …)` takes effect on the next Ctrl+V / menu Paste. */
  processCellFromClipboard?: ProcessCellFromClipboardCallback<TRow>;

  /** Cycle 10 / Task 6 — when `true`, the `RightClick` feature swallows
   *  every `contextmenu` event on the canvas. `event.preventDefault()`
   *  still fires (so the native browser menu does NOT appear) but no
   *  cgrid menu mounts — apps that ship their own menu surface use this
   *  to take over the right-click without competing with the cgrid
   *  popup. Read at event time so a runtime
   *  `setGridOption('suppressContextMenu', true)` takes effect on the
   *  next right-click. */
  suppressContextMenu?: boolean;

  /** Cycle 10 / Task 6 — when `true`, every clipboard API entry point
   *  (`copySelectedRangesToClipboard`, `pasteFromClipboard`,
   *  `cutSelectedRanges`) rejects with `Error('clipboard-suppressed')`
   *  and logs a one-time `console.warn`. The `KeyboardShortcuts`
   *  feature short-circuits Ctrl+C / Ctrl+V / Ctrl+X (forwards via the
   *  chain instead of preventing default), so apps that ship their own
   *  clipboard layer can register `addEventListener('copy', …)` /
   *  `('paste', …)` / `('cut', …)` on the document and own the surface.
   *  Read at event / call time so a runtime flip lights up on the next
   *  invocation. */
  suppressClipboardApi?: boolean;

  /** Cycle 10 / Task 6 — when `true`, `pasteFromClipboard` resolves
   *  without reading or writing anything (silent no-op), Ctrl+V short-
   *  circuits at the keyboard handler, and the default `Paste`
   *  context-menu item renders disabled. Copy and Cut are unaffected
   *  (use `suppressClipboardApi` to gate every direction). Read at
   *  event / call time so a runtime flip lights up on the next
   *  invocation. */
  suppressClipboardPaste?: boolean;

  /** Cycle 11 / Task 1 + Cycle 13 / Task 4 — registry of custom
   *  components, keyed by string id. Feeds BOTH the tool-panel registry
   *  (entries referenced via `SideBarDef.toolPanels[].toolPanel`) AND
   *  the status-panel registry (entries referenced via
   *  `StatusBarDef.statusPanels[].statusPanel`). Built-in ids
   *  (`'agColumnsToolPanel'`, `'agFiltersToolPanel'`,
   *  `'agTotalRowCountComponent'`, `'agFilteredRowCountComponent'`,
   *  `'agSelectedRowCountComponent'`,
   *  `'agTotalAndFilteredRowCountComponent'`, `'agAggregationComponent'`)
   *  are pre-registered at construction; entries here override them
   *  or add new ids. The two registries share this channel because
   *  the `ToolPanel` and `IStatusPanelComp` lifecycles are
   *  structurally identical (`init` / `getGui` / `refresh` / `destroy`),
   *  so a single id can serve either surface — whichever def
   *  (`SideBarDef` vs `StatusBarDef`) references the id wins at mount. */
  components?: Record<string, ToolPanelComponent | StatusPanelComponent>;

  /** Cycle 11 / Task 2 — side bar configuration. Accepts the canonical
   *  `SideBarDef` object, the boolean shorthand `true` (= both built-in
   *  panels at the default position), a single panel id string (`'columns'`
   *  / `'filters'`), or an array of ids. Mirrors ag-grid's
   *  `gridOptions.sideBar` acceptance shape. `false` / omitted disables
   *  the side bar entirely (no DOM mount, no canvas gutter). */
  sideBar?: SideBarDef | string | string[] | boolean;

  /** Cycle 13 / Task 1 — status bar configuration. Accepts the canonical
   *  `StatusBarDef` object or a boolean.
   *
   *  Cycle 21i Phase 2 — the status bar is an intrinsic part of every
   *  cgrid instance: omitted (or `true`) resolves to the default def —
   *  total/filtered row counts on the left, selected count + range
   *  aggregates on the right, pinned to the bottom edge. Set `false`
   *  to opt OUT (no DOM mount, no canvas inset). Built-in panel keys:
   *  `agTotalRowCountComponent`, `agFilteredRowCountComponent`,
   *  `agSelectedRowCountComponent`, `agTotalAndFilteredRowCountComponent`,
   *  `agAggregationComponent`. Runtime-settable via
   *  `setGridOption('statusBar', …)`. */
  statusBar?: StatusBarDef | boolean;


  /** Cycle 20 / Task 4 — named callback registry for export transforms.
   *  Functions can't cross the worker postMessage boundary, so apps
   *  register callbacks at construction time keyed by name. The
   *  export params (`processCellCallback`, `processHeaderCallback`,
   *  etc.) reference callbacks by name; cgrid runs the matching
   *  callback main-side over the rows the worker hands back. */
  exportCallbacks?: Record<string, ExportCallback>;

  /** Cycle 14 / Task 1 — pinned grand-totals row. When set, a single
   *  non-scrolling row mounts at the grid body's `'top'` or `'bottom'`
   *  edge and displays the worker-computed `chunk.totals` for every
   *  column with an `aggFunc` declared on its column def. `null` or
   *  omitted suppresses the row entirely (no subgrid mounted, no
   *  body-region inset).
   *
   *  The row reads totals from the chunk that the existing data pass
   *  emits — it triggers ZERO additional worker round-trips on scroll.
   *  Per-column row-height override + the polished `'totals'` cell
   *  renderer ship in Tasks 5 (`docs/superpowers/plans/2026-06-27-canvasgrid-cycle-14-aggregation-ui.md`).
   *  Cycle 14 / Task 1. */
  totalsRowPosition?: 'top' | 'bottom' | null;

  /** Cycle 14 / Task 2 — pinned-top static rows. Each array entry mounts
   *  as a non-scrolling row at the TOP of the grid body (between the
   *  header band and the scrollable data). Unlike `totalsRowPosition`
   *  the values are CALLER-OWNED, not worker-computed — typical use is
   *  reference rows ("Index Benchmark", "Trader Target") that should
   *  stay visible while the user scrolls the data. The grid reads each
   *  cell via `row[col.field ?? colId]` and runs the column's
   *  `valueFormatter` so apps get the same rendering as a data row.
   *  `null` / omitted / empty array suppresses the subgrid.
   *
   *  Runtime mutation via `setGridOption('pinnedTopRowData', …)` re-
   *  mounts the subgrid cleanly. Design plan:
   *  `docs/superpowers/plans/notes/cycle-14-aggregation-design.md`. */
  pinnedTopRowData?: TRow[] | null;

  /** Cycle 14 / Task 2 — pinned-bottom static rows. Mirrors
   *  `pinnedTopRowData` but mounts at the BOTTOM of the grid body
   *  (between the scrollable data and any totals / status bar below).
   *  When both `pinnedBottomRowData` AND `totalsRowPosition: 'bottom'`
   *  are set, the pinned rows sit ABOVE the totals row — the order is
   *  data → pinned-bottom → totals → status bar. The design plan's
   *  chrome decisions make the two row types visually distinguishable
   *  (warm tint vs slate tint). */
  pinnedBottomRowData?: TRow[] | null;

  /** Cycle 14 / Task 3 — custom column-aggregation functions, keyed by
   *  the name a column's `aggFunc` references. Built-in names (`'sum' |
   *  'avg' | 'min' | 'max' | 'count' | 'first' | 'last'`) are
   *  pre-registered on the worker; entries here ADD to or OVERRIDE
   *  those built-ins.
   *
   *  Functions string-serialise via `Function.prototype.toString()` and
   *  reconstruct on the worker via `new Function(...)`, so they MUST be
   *  pure: no closures over external scope, no calls to main-thread
   *  globals. **Trust boundary:** treat aggFunc sources as trusted
   *  application code — never feed untrusted / user-authored function
   *  strings into this map (use `@wellsfargo-starui/velocity-grid-expression` for sandboxed
   *  formulas). Closure capture is detected at registration time (the
   *  function is rebuilt + invoked against a probe input on the main
   *  thread; a mismatch / throw rejects the registration with an error
   *  that points at this constraint).
   *
   *  Runtime-mutable via `setGridOption('aggFuncs', …)` — the new map
   *  replaces the previous one wholesale and the worker re-runs the
   *  aggregation pass.
   *
   *  Reading: the column's `aggFunc` field carries the lookup name; the
   *  worker resolves the function and applies it to the per-column
   *  filtered values, producing one entry in `chunk.totals[colId]`. */
  aggFuncs?: Record<string, IAggFunc>;

  /** Cycle 14 / Task 4 — hide the `aggFuncName(headerName)` decoration
   *  on column headers. Default `false` (decoration shows). When `true`,
   *  every header reads its raw `headerName` and the aggregated context
   *  lives only in the bottom totals row (see `totalsRowPosition`).
   *
   *  Per-column override: `CColDef.suppressAggFuncInHeader` (when set)
   *  wins over this grid-level value, so apps can keep the prefix on
   *  most columns while suppressing it on noisy ones (or the inverse).
   *
   *  Runtime-mutable via `setGridOption('suppressAggFuncInHeader', …)`
   *  — the painter reads the option per paint, so a flip lights up on
   *  the next rAF without re-resolving the column tree.
   *
   *  Decoration format (per the design plan): lowercase verb + parens,
   *  no spaces — `sum(Notional)`, `avg(Price)`. Same weight and color
   *  as the column name. Array-form `aggFunc: ['sum', 'avg']` uses the
   *  FIRST entry as the visible prefix. Design plan:
   *  `docs/superpowers/plans/notes/cycle-14-aggregation-design.md` §
   *  Task 4. */
  suppressAggFuncInHeader?: boolean;
  /** Cycle 15 / Task 4 — partial column-def patch applied to the
   *  synthesized auto-group column. When grouping is active AND
   *  `groupDisplayType` resolves to `'singleColumn'` (the default),
   *  cgrid inserts a single auto-group column at index 0 of the visible
   *  leaf order. The synthesized def picks up `headerName: 'Group'`,
   *  `width: 200`, `cellRenderer: 'group'`, `sortable: false` by
   *  default; this option overlays those — set `width`, `headerName`,
   *  `pinned`, `cellRendererParams`, etc. to taste. The `colId` field
   *  is forced to `'ag-Grid-AutoColumn'` regardless of any override.
   *  Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   *  § Task 4. */
  autoGroupColumnDef?: Partial<CColDef<TRow>>;
  /** Cycle 15 / Task 4 + Task 5 — how grouped rows render in the body.
   *  - `'singleColumn'` (default): one auto-group column at index 0
   *    that shows chevron + indent + value + (count).
   *  - `'multipleColumns'`: one auto-group column per `rowGroupCols`
   *    entry. Each column carries its own chevron + value + (count) for
   *    rows whose depth matches the column's slot; other rows show
   *    blank cells in that column.
   *  - `'groupRows'`: NO auto-group columns. Group rows render as a
   *    full-row strip (chevron + indent + value + count spanning every
   *    visible band) on top of a subtle `--vg-group-row-bg` shift.
   *  - `'custom'`: same full-row strip allocation as `'groupRows'` but
   *    the strip's painter is the renderer named in
   *    `groupRowRenderer`. The app owns every pixel inside the strip
   *    (no cgrid-imposed bg shift).
   *  Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 5. */
  groupDisplayType?: 'singleColumn' | 'multipleColumns' | 'groupRows' | 'custom';
  /** Cycle 18 / Task 3 — master pivot switch. When `true`, the grid
   *  enters pivot mode: the configured pivot (Column Label) columns'
   *  distinct values become secondary column groups, the value columns
   *  become aggregated measures, and the primary data columns are
   *  hidden (the auto-group column stays as the row-dim axis). Pivot
   *  only PRODUCES a matrix when at least one pivot column AND one value
   *  column are also configured (`api.isPivotMode()` reflects the mode;
   *  the matrix is "active" only when both lists are non-empty). Pivot
   *  config is set via the imperative API (`setPivotColumns` /
   *  `addValueColumn`) or the tool-panel surfaces (Task 5-7). Persisted
   *  separately from column state (ag-grid parity). Default `false`. */
  pivotMode?: boolean;
  /** Cycle 18 / Task 4 — expand pivot column groups down to this depth by
   *  default. `0` (default) leaves every BRANCH pivot group closed so the
   *  grid initially shows only the top-level group-total columns;
   *  expanding a group reveals its child pivot columns. LEAF pivot groups
   *  (no further pivot nesting below them) are always open — there's
   *  nothing to expand within them — so a 2-level pivot with
   *  `pivotDefaultExpanded: 1` displays the full value-column matrix.
   *  Mirrors AG-Grid's `pivotDefaultExpanded` grid option. Design note:
   *  `docs/superpowers/plans/notes/cycle-18-pivoting-design.md` (Task 4). */
  pivotDefaultExpanded?: number;
  /** Cycle 15 / Task 5 — registered cell-renderer name used to paint
   *  group rows when `groupDisplayType === 'custom'`. The renderer is
   *  invoked once per group row with bounds spanning every visible
   *  band (left-pinned + center + right-pinned) and the row's
   *  `GroupCellValue` payload threaded onto `CellPaintConfig.value`.
   *  Falls back to `'group'` (the built-in groupRows full-row painter)
   *  when undefined OR when the named renderer isn't registered —
   *  apps get a sensible default without explicit wiring. Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 5. */
  groupRowRenderer?: string;
  /** Cycle 15 / Task 6 — controls when the row group panel (the
   *  horizontal drop strip above the column headers) mounts.
   *  - `'never'` (default): the panel never mounts.
   *  - `'always'`: the panel mounts on construction and stays visible
   *    even when `rowGroupCols.length === 0` (the empty state's
   *    `Drag here to set row groups` placeholder replaces the chips).
   *  - `'onlyWhenGrouping'`: the panel mounts only while
   *    `rowGroupCols.length > 0`; it disappears (and releases its
   *    top inset) the moment the last chip is removed.
   *  Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 6. */
  rowGroupPanelShow?: 'always' | 'onlyWhenGrouping' | 'never';
  /** Cycle 18 / Task 6 — controls when the pivot panel (the horizontal
   *  drop strip above the row group panel) mounts.
   *  - `'never'` (default): the panel never mounts.
   *  - `'always'`: the panel mounts on construction and stays visible
   *    even when `pivotColumns.length === 0` (the empty state's
   *    `Drag here to set column labels` placeholder replaces the pills).
   *  - `'onlyWhenPivoting'`: the strip RESERVES height at construction
   *    so a later `setPivotMode(true)` doesn't trigger a layout reflow,
   *    but the strip content (pills + empty placeholder) is paint-
   *    suppressed until pivot is active OR pivot columns are present.
   *  When both this AND `rowGroupPanelShow` mount, the pivot panel sits
   *  ABOVE the row group panel (pivot is the matrix-definition layer
   *  that wraps the row dimension). Mirrors AG-Grid's `pivotPanelShow`.
   *  AG-Grid parity: `pivot-behaviors-prompts.md` Prompt 6. */
  pivotPanelShow?: 'always' | 'onlyWhenPivoting' | 'never';
  /** Cycle 18 / Task 8a — maximum number of synthesized pivot result
   *  columns the worker will produce per `PivotPass`. Default `5000`
   *  (mirrors AG-Grid's `pivotMaxGeneratedColumns`). When a configured
   *  pivot model would produce more, `PivotPass` stops early, the chunk
   *  carries no pivot output (primary columns render normally), and the
   *  grid fires the `pivotMaxColumnsReached` event with the would-be
   *  count + the active cap so the app can raise the limit, narrow the
   *  filter, or warn the user. Negative / non-finite values are
   *  rejected and the default is used — a buggy app's misconfigured
   *  option must not accidentally disable pivot. AG-Grid parity:
   *  `pivot-behaviors-prompts.md` Prompt 8 / Task 8a. */
  pivotMaxGeneratedColumns?: number;
  /** Cycle 18 / Task 8c — when `true`, the pivot result columns are
   *  re-sorted at every pivot run (alphanumeric — `pivotComparator`
   *  integration is a follow-up). When `false` (the default per AG
   *  parity), brand-new pivot key values land at the END of the
   *  previously-known order; the prior column positions are preserved
   *  across data updates. The first apply always sorts alphanumeric
   *  (no prior knowledge), so the initial visible order is
   *  deterministic.
   *
   *  Apps that want the stable Excel-like layout under tick traffic
   *  leave this off (the default). Apps that want a strict
   *  always-sorted matrix opt in by setting `true`. AG-Grid parity:
   *  `pivot-behaviors-prompts.md` Prompt 8. */
  enableStrictPivotColumnOrder?: boolean;
  /** Cycle 18 / Task 8e — adds a totals column group with ONE leaf per
   *  value column at the start or end of the synthesized pivot output.
   *  Each totals cell reads `chunk.groupTotals[valueColId]` — i.e. the
   *  per-row-group aggregate ACROSS all pivot values (AggPass output,
   *  not PivotPass). `null` / `undefined` (default) shows no totals.
   *  AG-Grid parity: `pivotRowTotals`. */
  pivotRowTotals?: 'before' | 'after' | null;
  /** Cycle 18 / Task 8e — for multi-level pivots, controls whether the
   *  per-prefix subtotal leaves (the per-pivot-group aggregate Task 4
   *  already emits with `columnGroupShow: 'closed'`) show when the
   *  group is OPEN too. `'before'` places the subtotal as the first
   *  child of each non-leaf pivot group; `'after'` places it last;
   *  `null` / `undefined` (default) keeps Task 4's behaviour (subtotal
   *  visible only when the group is collapsed). AG-Grid parity:
   *  `pivotColumnGroupTotals`. */
  pivotColumnGroupTotals?: 'before' | 'after' | null;
  /** Excel-style grand totals (cgrid-only superpower; AG-Grid pivot
   *  does not provide this). When `true` and pivot mode is active:
   *  - A "Grand Total" row appears at the bottom (sticky — does not
   *    scroll vertically; reuses the TotalsSubgrid that lives outside
   *    the data subgrid's vertical scroll). The cells in this row
   *    read the worker's existing `aggregateNode('', inputIds)` output
   *    (`chunk.pivotValues` keyed by `groupKey: ''`) — no new
   *    aggregation required.
   *  - The right-edge "Total" column (i.e. `pivotRowTotals: 'after'`)
   *    is implicitly enabled when the caller didn't set
   *    `pivotRowTotals`, and its leaves get `pinned: 'right'` so the
   *    existing pinned-column layout machinery keeps them sticky
   *    during horizontal scroll. If the caller explicitly set
   *    `pivotRowTotals: 'before'`, the leaves pin to the LEFT.
   *  - The corner cell ("Grand Total" row × right "Total" column)
   *    shows the grand-of-grands aggregate per value column —
   *    `chunk.totals[valueColId]`, already computed by AggPass.
   *
   *  No-op when pivot mode is inactive. Use `grandTotalRow` for the
   *  non-pivot case (the two options coexist — `pivotGrandTotals`
   *  takes precedence under pivot mode). Runtime-mutable. */
  pivotGrandTotals?: boolean;
  /** Cycle 18 / Task 8f — app callback fired once per synthesized pivot
   *  result leaf colDef BEFORE the column-tree resolver sees it. Apps
   *  mutate the def in place (override `headerName`, add
   *  `valueFormatter` / `cellStyle` / `cellClassRules`, etc.). Pivot
   *  result columns AND row-total leaves both flow through this hook.
   *  AG-Grid parity: `processPivotResultColDef`. */
  processPivotResultColDef?: (colDef: CColDef<TRow>) => void;
  /** Cycle 18 / Task 8f — app callback fired once per synthesized pivot
   *  column GROUP (the per-pivot-key wrapper groups; NOT the row-totals
   *  wrapper which is layout chrome). Mutate the group in place
   *  (override `headerName`, `headerClass`, …). AG-Grid parity:
   *  `processPivotResultColGroupDef`. */
  processPivotResultColGroupDef?: (groupDef: CColGroupDef<TRow>) => void;
  /** Cycle 15 / Task 6 — when `true`, the row group panel's chips do
   *  not render a sort indicator (Cycle 15 ships chips without a sort
   *  glyph today; this flag is plumbed for forward compatibility so
   *  apps opting into chip sorting in a later cycle can suppress it
   *  per-grid). Default `false`. */
  rowGroupPanelSuppressSort?: boolean;
  /** Cycle 15.5 / Task 1 — when `true`, dragging a column header
   *  OUT of the grid body (past the row-group-panel or beyond the
   *  header band) does NOT hide the column. The default
   *  drag-leaves-grid behaviour (a column dragged outside its
   *  natural bounds gets `hide: true` applied) is the ag-grid
   *  parity behaviour; some apps (especially those with a fixed
   *  column set) prefer the column to stay visible.
   *
   *  Plumbed here in Task 1; the actual drag-leaves-grid wiring
   *  lands in Cycle 15.5 / Task 7 alongside the other column-
   *  visibility-on-group/ungroup flags
   *  (`suppressGroupChangesColumnVisibility`). Default `false`. */
  suppressDragLeaveHidesColumns?: boolean;
  /** Cycle 15.5 / Task 2 — governs whether a column-list row in the
   *  Columns tool panel (`agColumnsToolPanel`) can act as a drag
   *  source. When `true` (default), a drag started on the column
   *  list's drag handle (or row body) can land in the Row Groups
   *  drop zone in the same panel — `enableRowGroup` columns become
   *  group levels, mirroring the ag-grid Enterprise behaviour. When
   *  `false`, the column-list rows are static (visibility checkbox
   *  only). The full drag-onto-grid-body path (e.g. drag a column
   *  from the tool panel directly onto the grid) is a Cycle 16
   *  follow-up; Cycle 15.5 ships only the in-panel
   *  list-to-drop-zone path covered by this flag. */
  allowDragFromColumnsToolPanel?: boolean;
  /** Cycle 15 / Task 8 — when `true` AND `rowSelection: 'multiple'`,
   *  each group row in the auto-group column paints a tri-state
   *  checkbox alongside the chevron + indent + value + (count).
   *  Clicking the checkbox cascade-selects every descendant leaf row;
   *  the group's checkbox renders empty / dash / check based on the
   *  aggregate state of its descendants.
   *
   *  Default `false`. Has no effect when `rowSelection !== 'multiple'`
   *  — cascading would violate the single-selection contract; the
   *  renderer omits the checkbox entirely under `'single'` / `'none'`.
   *
   *  Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   *  § Task 8. */
  groupSelectsChildren?: boolean;
  /** Cycle 15 / Task 9 — controls which groups are expanded the first
   *  time `setGroupModel` produces a tree (and on every subsequent
   *  `setGroupModel` swap that resets expansion state). Read once at
   *  the worker init handshake AND on every model swap:
   *
   *  - `'all'` (default when the option is absent) — every group at
   *    every depth starts expanded. Equivalent to the Task 7 / Task 8
   *    behaviour shipped before this option existed.
   *  AG-Grid levels-open semantics (BEHAVIOR CHANGE 2026-07 — see the
   *  migration warning in velocityGrid.ts):
   *  - `N` where `N >= 0` — the NUMBER of levels open. `0` starts
   *    everything collapsed; `1` opens the first level (depth 0); `2`
   *    opens two levels; etc. (Previously `depth <= N`, so `0` opened
   *    the top level — every `N` now opens one fewer level.)
   *  - `-1` — expand EVERY group (AG parity; equivalent to the `'all'`
   *    sentinel). Previously `-1` collapsed everything.
   *  - any other `N < 0` — every group starts collapsed.
   *
   *  `groupDefaultExpandedKeys` (below), when supplied, takes
   *  precedence over the depth-based rule — the explicit list is the
   *  exact starting set. */
  groupDefaultExpanded?: number | 'all';
  /** Cycle 15 / Task 9 — explicit list of composite group keys to
   *  start expanded. When supplied (including the empty array), this
   *  OVERRIDES `groupDefaultExpanded` — the explicit list is the
   *  starting expansion set verbatim. Composite keys use the
   *  `GroupNode.key` format: `colId:value` at the top level,
   *  `colId:value::colId:value` for nested levels (see
   *  `cgrid/src/worker/passes/groupPass.ts` for the exact form).
   *
   *  An empty array `[]` is the canonical "start with everything
   *  collapsed" form when paired with an unset
   *  `groupDefaultExpanded`. Keys that don't match any composite key
   *  in the current tree silently fall out (they neither error nor
   *  expand a missing group); this keeps a stale option harmless
   *  across columnDef changes. */
  groupDefaultExpandedKeys?: string[];
  /** Cycle 15 / Task 10 — when `true`, the worker elides any group
   *  whose recursive `childCount === 1` from the visible row order.
   *  Chains that funnel down to a single row collapse entirely (a
   *  multi-level group whose deepest leaf has one row drops the
   *  entire chain in favour of just the row).
   *
   *  No visual change in the renderer — elided rows paint as normal
   *  data rows; only the spine shortens. Tree shape stays intact so
   *  the per-group meta lookup keeps working for every non-elided
   *  group.
   *
   *  Default `false`. Init-only — runtime mutation isn't supported
   *  this cycle (matches the `groupDefaultExpanded` pattern; apps
   *  that need it can rebuild the grid). */
  groupRemoveSingleChildren?: boolean;
  /** AG v33 name for single-child group elision — supersedes the
   *  deprecated `groupRemoveSingleChildren`. `true` replaces any group
   *  with a single descendant leaf by that leaf; `'leafGroupsOnly'`
   *  applies the rule only at the lowest (leaf) group level, leaving
   *  higher levels intact (AG `groupRemoveLowestSingleChildren`
   *  equivalent). Wins over the deprecated flag when both are set.
   *  Init-only, matching `groupRemoveSingleChildren`. */
  groupHideParentOfSingleChild?: boolean | 'leafGroupsOnly';
  /** AG parity (`agGroupCellRenderer` param `suppressDoubleClickExpand`)
   *  — when `true`, double-clicking a group row no longer toggles its
   *  expanded state. Chevron clicks and keyboard toggles are
   *  unaffected. Default `false` (double-click toggles, matching AG). */
  suppressDoubleClickExpand?: boolean;
  /** Cycle 15 / Task 10 — when `true` AND `groupDisplayType` resolves
   *  to `'singleColumn'`, every data row's auto-group cell paints a
   *  MUTED echo of its leaf-parent group's value (no chevron, no
   *  checkbox, no count — just the label at the leaf group's indent).
   *  Keeps the user oriented while scrolling inside a long expanded
   *  group: row 482 of `APAC → Rates` still shows `Rates` in the
   *  column spine.
   *
   *  Has no effect in `'multipleColumns'` / `'groupRows'` / `'custom'`
   *  modes — each per-level column in `'multipleColumns'` already
   *  owns one depth (echoing on data rows would conflict with
   *  ownership); the strip modes don't paint per-cell on data rows.
   *
   *  Default `false`. Init-only this cycle. Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 10. */
  showOpenedGroup?: boolean;
  /** Cycle 15 / Task 12 — when `true` AND grouping is active, the
   *  worker emits a per-group footer row at the bottom of every
   *  expanded group. Each footer row renders the same totals signature
   *  the grand-total row uses (`--vg-totals-*` / `--vg-group-footer-*`
   *  tokens — see the design notes for the override family) and shows
   *  `Total ${groupValue}` in the auto-group cell aligned to the parent
   *  group's depth indent. Per-group totals come from the same
   *  `AggPass` + `AggFuncRegistry` the grand-total uses — single source
   *  of truth for aggregation.
   *
   *  Default `false`. Init-only this cycle. Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 12. */
  groupIncludeFooter?: boolean;
  /** Cycle 15 / Task 12 — when `true` AND `groupIncludeFooter` is on,
   *  the worker appends ONE grand-total footer row at the bottom of
   *  all per-group footers (using `chunk.totals` for the column values
   *  and a plain `Total` label in the auto-group cell). Gives a grouped
   *  grid its grand total in the same visual rhythm as the per-group
   *  footers without having to also mount a separate `totalsRowPosition:
   *  'bottom'` subgrid.
   *
   *  Has no effect when `groupIncludeFooter` is off — apps that want a
   *  standalone grand total use `totalsRowPosition: 'bottom'` instead.
   *
   *  Default `false`. Init-only this cycle. Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 12. */
  groupIncludeTotalFooter?: boolean;
  /** Cycle 15.5 / Task 4 — when `true` AND grouping is active, an
   *  EXPANDED parent group row is NOT emitted into the visible row list.
   *  Children of the hidden parent appear directly in the parent's slot,
   *  preserving continuity. AG Grid parity: `groupHideOpenParents`.
   *
   *  The sticky group-row band auto-disables in this mode (a hidden
   *  parent can't be pinned). `suppressGroupRowsSticky` fires
   *  automatically — no extra option needed.
   *
   *  Default `false`. Init-only this cycle. */
  groupHideOpenParents?: boolean;
  /** Cycle 15.5 / Task 5 — controls which rows the group checkbox
   *  cascade selects. Supersedes the boolean `groupSelectsChildren`
   *  (which is kept as a shorthand for `'descendants'`).
   *  - `'descendants'` — every descendant leaf row.
   *  - `'self'` — the group row only (no cascade; the checkbox tracks
   *    whether the group row id itself is selected).
   *  - `'filteredDescendants'` — only descendants that survive the
   *    current filter. Default `'descendants'` when
   *    `groupSelectsChildren: true` is set. Has no effect when
   *    `rowSelection !== 'multiple'`. */
  groupSelects?: 'descendants' | 'self' | 'filteredDescendants';
  /** Cycle 15.5 / Task 5 — where the selection checkbox appears in the
   *  grid.
   *  - `'autoGroupColumn'` (default) — inside the auto-group cell, as
   *    already implemented in Cycle 15 / Task 8.
   *  - `'selectionColumn'` — a synthesized leftmost column (≤ 32 px)
   *    hosting only the checkbox + tri-state header checkbox.
   *  - `'none'` — no checkbox rendered; programmatic selection only.
   *  Has no effect when `groupSelectsChildren` is off. */
  checkboxLocation?: 'autoGroupColumn' | 'selectionColumn' | 'none';
  /** Cycle 15.5 / Task 5 — scope for the header checkbox's "select all"
   *  gesture.
   *  - `'all'` — all rows regardless of filter.
   *  - `'filtered'` — only filtered-in rows.
   *  - `'currentPage'` — only rows on the visible page (pagination).
   *  Default `'all'`. */
  selectAll?: 'all' | 'filtered' | 'currentPage';
  /** Cycle 15.5 / Task 6 — per-group-node callback evaluated at
   *  tree-build time to decide the starting expansion state. When
   *  provided, overrides `groupDefaultExpanded` for the specific node.
   *  The callback receives the node's composite `key` (the full
   *  `colId:value::…` path) and the array of per-level values forming
   *  the route from root to this node. */
  isGroupOpenByDefault?: (params: { key: string; route: string[] }) => boolean;
  /** Cycle 15.5 / Task 7 — when `true`, the `(N)` descendant count
   *  suffix is suppressed in every group row cell. Default `false`. */
  suppressCount?: boolean;
  /** Cycle 15.5 / Task 7 — params forwarded to the group-row renderer.
   *  Currently supports `innerRenderer` — a registered cell-renderer
   *  name used in place of the built-in value-text paint (chevron +
   *  indent + checkbox still paint natively; only the value portion is
   *  delegated). */
  groupRowRendererParams?: {
    /** Registered cell-renderer name for the value portion of a group
     *  row cell. Receives the `GroupCellValue` payload. */
    innerRenderer?: string;
    /** When present, overrides the grid-level `suppressCount` just for
     *  the inner renderer's own count suffix. */
    suppressCount?: boolean;
  };
  /** Cycle 15.5 / Task 7 — controls whether adding/removing a column
   *  from `rowGroupColumns` auto-hides/shows that column.
   *  - `true` — always suppress (no visibility change on group/ungroup).
   *  - `'suppressHideOnGroup'` — adding to rowGroupColumns does not
   *    hide the column (but removing still shows it).
   *  - `'suppressShowOnUngroup'` — removing from rowGroupColumns does
   *    not show the column (but adding still hides it).
   *  - `false` / omitted (default) — mirrors AG Grid: adding hides,
   *    removing shows. */
  suppressGroupChangesColumnVisibility?: boolean | 'suppressHideOnGroup' | 'suppressShowOnUngroup';
  /** Cycle 15.5 / Task 8 — where per-group total rows appear.
   *  - `'top'` — before the group's first child row.
   *  - `'bottom'` — after the group's last child row (same slot as
   *    `groupIncludeFooter`; prefer `groupIncludeFooter` which shipped
   *    in Cycle 15 / Task 12).
   *  - `null` / omitted — no per-group totals (default).
   *  Init-only this cycle. */
  groupTotalRow?: 'top' | 'bottom' | null;
  /** Cycle 15.5 / Task 8 — where the grand-total row appears.
   *  - `'top'` — before all group rows (just below the headers).
   *  - `'bottom'` — after all group rows (last row in the body).
   *  - `'pinnedTop'` / `'pinnedBottom'` — AG parity (2026-07-21): the
   *    grand-total row is PINNED outside the scroll area (maps onto the
   *    `totalsRowPosition` totals subgrid — always visible while the
   *    body scrolls). Works on both CSRM (AggPass root totals) and
   *    sparse SSRM v2 (skeleton root aggregates).
   *  - `null` / omitted — no grand total from this option.
   *  Init-only this cycle. */
  grandTotalRow?: 'top' | 'bottom' | 'pinnedTop' | 'pinnedBottom' | null;
  /** AG parity (2026-07-21) — filters evaluate GROUP rows on their
   *  aggregated values instead of leaf rows: a group whose aggregates
   *  pass includes ALL of its descendants; non-passing groups keep only
   *  subtrees containing passing groups. Only filter entries on columns
   *  carrying an `aggFunc` constrain groups (other entries are ignored
   *  while this is on). Boolean only — AG's per-node callback form is
   *  not yet supported. CSRM only (sparse SSRM filtering is host-owned).
   *  Implies AG's `suppressAggFilteredOnly` (aggregates cover all rows). */
  groupAggFiltering?: boolean;
  /** AG parity (2026-07-21) — when `true`, applying or changing sorts
   *  never re-orders GROUP rows: only leaf rows sort within their
   *  groups. Group order stays as produced by the group pass (CSRM) or
   *  as delivered by the skeleton (sparse SSRM v2, where refetched
   *  skeletons additionally keep the previous sibling order for
   *  surviving groups). Default `false`. Init-only. */
  groupMaintainOrder?: boolean;
}
