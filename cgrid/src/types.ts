// Public types for cgrid. Re-exported from src/cgrid.ts.
// See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md §9.

import type { CellEditorCtor } from './interaction/editors/iCellEditor';
import type { GetContextMenuItemsCallback, GetMainMenuItemsCallback } from './interaction/contextMenu/types';
import type { ToolPanelComponent, SideBarDef, ToolPanel } from './interaction/toolPanels/types';
import type { StatusBarDef, StatusPanelComponent, IStatusPanelComp } from './interaction/statusBar/types';

export type { ICellEditor, ICellEditorParams, CellEditorCtor } from './interaction/editors/iCellEditor';
// Cycle 10 / Task 1 — public context-menu surface. Re-exported from cgrid's
// root index alongside the rest of the public API.
export type {
  MenuItem,
  GetContextMenuItemsParams,
  GetContextMenuItemsCallback,
  GetMainMenuItemsParams,
  GetMainMenuItemsCallback,
} from './interaction/contextMenu/types';
// Cycle 11 / Task 1 — public tool-panel + side-bar surface.
export type {
  ToolPanel,
  ToolPanelComponent,
  ToolPanelParams,
  ToolPanelDef,
  SideBarDef,
  IToolPanelColumnCompParams,
  IToolPanelFiltersCompParams,
} from './interaction/toolPanels/types';
// Cycle 13 / Task 1 — public status-bar + status-panel surface.
export type {
  IStatusPanel,
  IStatusPanelComp,
  StatusPanelComponent,
  StatusPanelParams,
  StatusPanelDef,
  StatusPanelAlign,
  StatusBarDef,
  StatusBarPosition,
} from './interaction/statusBar/types';
// Cycle 13 / Task 3 — `agAggregationComponent` public params + the
// `AggFunc` union. Apps that restrict the agg panel via
// `statusPanelParams.aggFuncs` or supply a custom `valueFormatter`
// import these. The panel implementation lives at
// `interaction/statusBar/panels/aggregation.ts`.
export type { IAggregationStatusPanelParams } from './interaction/statusBar/panels/aggregation';
export type { AggFunc } from './interaction/statusBar/aggMath';

/** Cycle 14 / Task 3 — params passed to a custom column aggFunc. Mirrors
 *  ag-grid's `IAggFuncParams` shape so apps porting over keep the same
 *  vocabulary. The `values` array carries the raw cell values for the
 *  column being aggregated (post-filter, in row order). `colId` lets one
 *  shared function dispatch between columns. `rowNode` is reserved for
 *  group-footer totals (Cycle 15); for grand totals it is `undefined`. */
export interface IAggFuncParams<TValue = unknown, TRow = any> {
  values: TValue[];
  colId: string;
  rowNode?: { data?: TRow; key?: string };
}

/** Cycle 14 / Task 3 — custom column aggregation function. Reduces a
 *  column's filtered values into a single totals-row entry. Runs on the
 *  worker (the function body string-serialises via
 *  `Function.prototype.toString()` and reconstructs via `new Function`),
 *  so it MUST be pure — no closures over external scope. Apps that need
 *  scope-bound state should pre-bake it into the values via a
 *  `valueGetter` instead. Closures are rejected at `setGridOption`
 *  /constructor time with a clear error that points at the failure mode.
 *  Built-in names (`'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' |
 *  'last'`) bypass serialisation entirely. */
export type IAggFunc<TValue = unknown, TResult = unknown, TRow = any> =
  (params: IAggFuncParams<TValue, TRow>) => TResult;

/** Cycle 27 / Task 1 — vertical alignment of cell content. */
export type VAlign = 'top' | 'middle' | 'bottom';

/** Cycle 27 / Task 1 — CSS font-weight values accepted in style overrides. */
export type FontWeight =
  | 'normal' | 'bold' | 'lighter' | 'bolder'
  | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

/** Cycle 27 / Task 1 — italic switch. */
export type FontStyle = 'normal' | 'italic';

/** Cycle 27 / Task 1 — text transform applied to `valueFormatted` before
 *  the painter reads it. */
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

/** Cycle 27 / Task 1 — per-side padding override for cell content area.
 *  Missing sides fall back to the painter's default (typically 6px). */
export interface Padding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Cycle 27 / Task 2 — line style of a cell border side. */
export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double';

/** Cycle 27 / Task 2 — per-side border definition. A side with no `width`
 *  (or `width: 0`) is invisible. `style` defaults to `'solid'`. */
export interface BorderSide {
  width?: number;
  color?: string;
  style?: BorderStyle;
}

/** Cycle 27 / Task 2 — per-cell border override. Each side can be set
 *  independently; `all` provides a fallback for sides not explicitly
 *  listed (explicit side wins). */
export interface BorderSpec {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
  /** Fallback for any side NOT explicitly set above. */
  all?: BorderSide;
}

/** Cycle 27 / Task 3 — cell content slot. When set on `cellStyle.content`,
 *  the painter renders this instead of `valueFormatted` (the default text
 *  path). Use `'text'` to override the rendered string, `'icon'` to render
 *  a registered icon, `'emoji'` to render a Unicode glyph at a custom
 *  size, or `'icon-text'` to render both. */
export type CellContent =
  | { kind: 'text'; value: string }
  | { kind: 'icon'; icon: string; color?: string; size?: number }
  | { kind: 'emoji'; value: string; size?: number }
  | {
      kind: 'icon-text';
      icon: string;
      text: string;
      /** Default `'before'` (icon left of text). */
      iconPosition?: 'before' | 'after';
      /** CSS-pixel gap between icon and text. Default `4`. */
      gap?: number;
      iconColor?: string;
      iconSize?: number;
    };

/** Cycle 27 / Task 3 — decorator anchor positions. */
export type DecoratorPosition =
  | 'tl' | 'tr' | 'bl' | 'br'   // four corners
  | 'ml' | 'mr';                 // middle-left, middle-right

/** Cycle 27 / Task 3 — small decorator (icon / emoji / dot / short text
 *  label) anchored to one of six positions inside a cell. Decorators
 *  overlay the cell content; they don't shrink the content area. */
export type CellDecorator =
  | {
      position: DecoratorPosition;
      kind: 'icon';
      icon: string;        // registered icon name
      color?: string;
      size?: number;       // CSS pixels, default 12
      inset?: number;      // distance from cell edge, default 2
      bg?: string;         // optional badge background (circle)
    }
  | {
      position: DecoratorPosition;
      kind: 'emoji' | 'text';
      value: string;
      color?: string;
      size?: number;       // CSS pixels (font size), default 12
      inset?: number;
      bg?: string;
    }
  | {
      position: DecoratorPosition;
      kind: 'dot';
      color: string;       // required for dot
      size?: number;       // diameter; default 6
      inset?: number;
      bg?: string;         // optional ring
    };

export interface ColCellOverrides {
  // ── Colors ────────────────────────────────────────────────────────────────
  fg?: string;
  bg?: string;

  // ── Alignment ─────────────────────────────────────────────────────────────
  halign?: 'left' | 'right' | 'center';
  /** Cycle 27 / Task 1 — `'middle'` (default) preserves the centered
   *  baseline; `'top'` / `'bottom'` shift the text baseline to the cell's
   *  top / bottom edge. */
  valign?: VAlign;

  // ── Font (shorthand kept for back-compat; breakouts compose into it) ──────
  font?: string;
  /** Cycle 27 / Task 1 — font family. Wins over the family in the fallback
   *  shorthand. */
  fontFamily?: string;
  /** Cycle 27 / Task 1 — font size in CSS pixels. Wins over the size in the
   *  fallback shorthand. */
  fontSize?: number;
  /** Cycle 27 / Task 1 — font weight. Numeric (100–900) or CSS keyword
   *  (`'normal'`, `'bold'`, `'lighter'`, `'bolder'`). */
  fontWeight?: FontWeight;
  /** Cycle 27 / Task 1 — italic / normal switch. */
  fontStyle?: FontStyle;

  // ── Text ──────────────────────────────────────────────────────────────────
  /** Cycle 27 / Task 1 — transform applied to `valueFormatted` before paint:
   *  `'uppercase'` / `'lowercase'` / `'capitalize'` / `'none'` (default). */
  textTransform?: TextTransform;
  /** Cycle 27 / Task 1 — extra spacing between characters in CSS pixels.
   *  Forwarded to `CanvasRenderingContext2D.letterSpacing` at paint time
   *  (Chromium 99+, Firefox 116+, Safari 16+). */
  letterSpacing?: number;
  /** Cycle 27 / Task 1 — line-height multiplier for wrap-text cells.
   *  Default `1.2`. Has no effect on single-line `textCell` / `numberCell`. */
  lineHeight?: number;
  /** Cycle 27 / Task 1 — content padding. Accepts a uniform number
   *  (applies to all four sides) or a per-side object. Missing sides
   *  fall back to the painter's default. */
  padding?: number | Padding;

  // ── Borders ───────────────────────────────────────────────────────────────
  /** Cycle 27 / Task 2 — per-side border override. Replaces any previous
   *  `border` patch wholesale (not deep-merged). Sides not listed in the
   *  patch are invisible unless `all` is set. */
  border?: BorderSpec;

  // ── Content + decorators ──────────────────────────────────────────────────
  /** Cycle 27 / Task 3 — override the cell's rendered content. When set,
   *  the painter renders this instead of `valueFormatted` (the default
   *  text path). Replaces wholesale on patch. */
  content?: CellContent;
  /** Cycle 27 / Task 3 — up to 6 decorators (one per position) overlaid
   *  on the cell after content paint. Each anchored to one of
   *  TL/TR/BL/BR/ML/MR. Replaces wholesale on patch. */
  decorators?: CellDecorator[];
}

/** Params passed to `cellClass`, `cellClassRules`, and `cellStyle` callbacks. */
export interface CellClassParams<TRow = any, TValue = any> {
  data: TRow;
  value: TValue;
  colId: string;
  rowIndex: number;
}

/**
 * Per-column cell class. Applied to the cell before `cellClassRules`.
 * Resolves to one or more variant names looked up from the theme's
 * `cellClassVariants` map. Cycle 6 / Task 7.
 */
export type CellClass<TRow = any, TValue = any> =
  | string
  | string[]
  | ((params: CellClassParams<TRow, TValue>) => string | string[] | undefined);

/**
 * Map of class-name → predicate. The predicate is called per cell at paint
 * time; when it returns `true`, the class name is resolved through the theme's
 * `cellClassVariants` map and the resulting `ColCellOverrides` patch is applied.
 * Pre-compiled once in `resolveColDef`; zero allocation per paint.
 * Cycle 6 / Task 7.
 */
export type CellClassRules<TRow = any, TValue = any> = Record<
  string,
  (params: CellClassParams<TRow, TValue>) => boolean
>;

/**
 * Function-form `cellStyle`. Called per cell; its return value is a raw
 * `ColCellOverrides` patch applied AFTER class-driven variants (highest
 * precedence). Return `null` / `undefined` to apply no override.
 * Cycle 6 / Task 7.
 */
export type CellStyleFunc<TRow = any, TValue = any> = (
  params: CellClassParams<TRow, TValue>,
) => ColCellOverrides | null | undefined;

/**
 * Per-column header class. Resolves to one or more variant names looked up
 * from the theme's `headerClassVariants` map. Cycle 6 / Task 7.
 */
export type HeaderClass =
  | string
  | string[]
  | ((params: { colId: string }) => string | string[] | undefined);

/**
 * Function-form `headerStyle`. Cycle 27 / Task 1. Applied per header paint;
 * return value layers AFTER any class-driven variants.
 */
export type HeaderStyleFunc = (
  params: { colId: string },
) => ColCellOverrides | null | undefined;

export interface CGridOptions<TRow = any> {
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
  selection?: import('./core/selectionConfig').SelectionConfig<TRow>;
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
  asyncTransactionWaitMillis?: number;
  theme?: string;
  /**
   * Cycle 22 / Task 2 — density-mode preset. Toggling the value swaps
   * one CSS class on the grid root (`.cg-density-compact` /
   * `.cg-density-normal` / `.cg-density-comfortable`); each class
   * overrides `--cg-row-height`, `--cg-header-height`, and
   * `--cg-cell-padding-x`. Omitting the option (`undefined`) skips
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
  initialState?: import('./core/stateSnapshot').GridState;
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
   *  Defaults to the engine's internal overscan (3) when unset. */
  rowBuffer?: number;
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
  /** Explicit loading-overlay toggle. Storage-only in Cycle 4; the overlay
   *  surface lands in a later cycle. */
  loading?: boolean;
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

  /** Grid-wide default for the floating-filter row. When `true`, every
   *  column with a default-resolved filter renders a floating-filter
   *  `<input>` beneath the leaf-header row. Per-column
   *  `CColDef.floatingFilter` wins over this. Cycle 7 / Task 1. */
  floatingFilter?: boolean;
  /** Pixel height of the floating-filter row. Defaults to `28`. Forwarded
   *  to `FloatingFilterSubgrid` + `FloatingFilterOverlay`. Cycle 7 / Task 1. */
  floatingFilterHeight?: number;
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
   *  `StatusBarDef` object or the boolean shorthand `true` (= empty bar
   *  at the default `'bottom'` position, panels supplied later via
   *  `setStatusBarDef`). `false` / omitted disables the status bar
   *  entirely (no DOM mount, no canvas inset). Built-in panel keys
   *  (`agTotalRowCountComponent`, `agFilteredRowCountComponent`,
   *  `agSelectedRowCountComponent`, `agTotalAndFilteredRowCountComponent`,
   *  `agAggregationComponent`) land in Cycle 13 Tasks 2 + 3; until then
   *  a bar with built-in keys renders the inert stubs. */
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
   *  globals. Closure capture is detected at registration time (the
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
   *    visible band) on top of a subtle `--cg-group-row-bg` shift.
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
   *  - `N` where `N >= 0` — expand groups whose `depth <= N`. So
   *    `N === 0` expands the top-level groups only (their immediate
   *    child groups render as collapsed rows); `N === 1` expands two
   *    levels; etc. Useful for "show the outline" defaults.
   *  - `N` where `N < 0` — every group starts collapsed. Use any
   *    negative integer (`-1` is the canonical "collapse all" form,
   *    matching how ag-grid documents the same flag in inverse).
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
   *  the grand-total row uses (`--cg-totals-*` / `--cg-group-footer-*`
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
   *  - `null` / omitted — no grand total from this option; use
   *    `totalsRowPosition` from Cycle 13 for a pinned grand total.
   *  Init-only this cycle. */
  grandTotalRow?: 'top' | 'bottom' | null;
}

/** Cycle 10 / Task 5 — params for `processCellForClipboard`. Mirrors
 *  ag-grid's shape (`value`, `node: { rowIndex, data }`, `column: { colId
 *  }`). The callback fires once per (range cell × visible row), in
 *  range-row-major order across the current `getCellRanges()` snapshot. */
export interface ProcessCellForClipboardParams<TRow = any> {
  /** Raw value read from the row's field. May be `null` / `undefined`
   *  when the row lacks the field; the callback decides how to render. */
  value: unknown;
  /** Row data + visible row index at copy time. `data` is a snapshot of
   *  the row's current values (the same object the `valueGetter` /
   *  `valueFormatter` callbacks see). */
  node: { rowIndex: number; data: TRow };
  /** Target column — only the `colId` is guaranteed, mirroring ag-grid. */
  column: { colId: string };
}

export type ProcessCellForClipboardCallback<TRow = any> =
  (params: ProcessCellForClipboardParams<TRow>) => unknown;

/** Cycle 10 / Task 5 — params for `processCellFromClipboard`. */
export interface ProcessCellFromClipboardParams<TRow = any> {
  /** Parsed cell value from the clipboard payload — always a string
   *  (RFC-4180 unwrapping happens upstream). Apps coerce to the
   *  column's domain type inside the callback. */
  value: string;
  /** Target row + its visible row index. `data` reflects the row's
   *  PRE-paste state so apps can reference current values. */
  node: { rowIndex: number; data: TRow };
  /** Target column — only `colId` is guaranteed, mirroring ag-grid. */
  column: { colId: string };
}

export type ProcessCellFromClipboardCallback<TRow = any> =
  (params: ProcessCellFromClipboardParams<TRow>) => unknown;

/** Suppression flags for the cell-range selection pathways. Each flag
 *  defaults to `false` when omitted — the matching gesture creates / updates
 *  ranges as usual. Cycle 9 / Task 6. */
export interface CCellSelectionOptions {
  /** When `true`, a click on a column header no longer selects the whole
   *  column. Sort cycling on the same click is unaffected. */
  suppressHeader?: boolean;
  /** When `true`, a click on the row-header column (Cycle 14) no longer
   *  selects the whole row range. Plumbed in Cycle 9 / Task 6; consumed
   *  when row-header click ships in Cycle 14. */
  suppressRow?: boolean;
  /** When `true`, mouse drag (and the plain-click + shift-click + ctrl-click
   *  pathways the drag feature owns) no longer creates or mutates ranges.
   *  Focus + row selection on the same press still happen. */
  suppressDrag?: boolean;
}

/** Params for `CGridOptions.fillOperation`. Mirrors ag-grid's `FillOperationParams`.
 *  Cycle 9 / Task 5. */
export interface FillOperationParams<TRow = any> {
  /** The values from the source rect (the original selection before the
   *  fill-handle drag), in source-row order, for the column being filled. */
  values: unknown[];
  /** The same as `values` — kept separate so a custom op that mutates the
   *  accumulator over multiple target cells doesn't trample the initial
   *  source list. */
  initialValues: unknown[];
  /** Index of the target cell within the target rect (0-based, in target-
   *  row order). For a vertical fill that extends 3 rows below the source
   *  this runs 0..2 for each column. */
  currentIndex: number;
  /** Best-effort partial of the target row. Synchronous read from the main-
   *  thread chunk — may not include every field when the row is outside the
   *  visible window. */
  rowNode: { data: Partial<TRow>; rowIndex: number };
  /** Resolved column definition for the cell being filled. */
  colDef: { colId: string; field?: string };
  /** Axis the fill extends along, decided by the drag's dominant delta. */
  direction: 'up' | 'down' | 'left' | 'right';
}

/** Params for `CGridOptions.getRowHeight`. The row is identified by its
 *  full data + the application-provided rowId; `rowIndex` is the row's
 *  current position in the visible (filter + sort) order at the time the
 *  callback runs. */
export interface GetRowHeightParams<TRow = any> {
  data: TRow;
  rowId: string;
  rowIndex: number;
}

/** Predicate that decides whether a single cell is editable. Receives the
 *  resolved cell context — matches ag-grid's `EditableCallback` shape. */
export type EditableCallback<TRow = any, TValue = any> = (
  params: { data: TRow; colId: string; rowIndex: number; value: TValue },
) => boolean;

/** Cycle 4 / Task 11 (cell-flash patch) — params for
 *  `CGridApi.flashCells`. Programmatic cell flash for app-driven
 *  highlights (validation success pulse, row-just-loaded). */
export interface FlashCellsParams {
  /** Row IDs to flash. Required; must be non-empty. */
  rowIds: string[];
  /** Column IDs to flash within each row. When omitted or empty,
   *  every column with a resolved field flashes. */
  colIds?: string[];
  /** Reserved for a follow-up patch — overrides the global
   *  `cellFlashDuration` for this batch. Cycle 4 ships the API
   *  surface; per-call overrides land when a use case lands. */
  flashDuration?: number;
  fadeDuration?: number;
}

/** Per-column key-event predicate. Return `true` to swallow the event before
 *  any grid handler (navigation, edit-trigger, paging) sees it. Receives
 *  whether an editor is currently open on the cell. */
export type SuppressKeyboardEventCallback<TRow = any> = (
  params: { event: KeyboardEvent; editing: boolean; data: TRow; colId: string },
) => boolean;

export interface CColDef<TRow = any, TValue = any> {
  colId?: string;
  field?: keyof TRow & string;
  headerName?: string;
  width?: number;
  flex?: number;
  minWidth?: number;
  maxWidth?: number;
  pinned?: 'left' | 'right';
  /**
   * Named column type(s) declared in `CGridOptions.columnTypes`. Each named
   * entry is a `Partial<CColDef>` bundle; the resolved column merges the
   * bundles left-to-right, then `defaultColDef`, then this column's own
   * fields — the column's own properties always win.
   *
   * Deprecation alias: when `type` is `'text'` or `'number'` AND
   * `columnTypes` carries no entry of that name, the value collapses into
   * `cellDataType`. New code should prefer `cellDataType` for the cell
   * data type and reserve `type` for shared property bundles.
   *
   * Cycle 6 / Task 6.
   */
  type?: string | string[];
  /**
   * Cell data type. Drives the default cell renderer + default halign when
   * `cellRenderer` is unset (`'text'` → left-align text; `'number'` →
   * right-align numeric). Replaces the old `type: 'text' | 'number'`
   * literal-union usage — that shape still works via a deprecation alias
   * (see `type`). Cycle 6 / Task 6.
   */
  cellDataType?: 'text' | 'number';
  valueGetter?: (params: CValueGetterParams<TRow>) => TValue;
  valueFormatter?: (params: CValueFormatterParams<TRow, TValue>) => string;
  cellRenderer?: string;
  /**
   * Static params forwarded to the resolved cell renderer as
   * `CellPaintConfig.params`. Apps choose the shape; the engine treats it
   * as opaque. Inherited from `defaultColDef.cellRendererParams` when not
   * set at column level.
   */
  cellRendererParams?: unknown;
  /**
   * Per-cell renderer selector. Invoked at paint time with the cell's
   * `value` and `colId`; returning `{ component, params? }` overrides
   * the static `cellRenderer` and (if `params` is set) the static
   * `cellRendererParams`. Return `undefined` to fall back to the static
   * pair.
   */
  cellRendererSelector?: CCellRendererSelector<TRow, TValue>;
  /** Custom comparator. Either the NAME of a comparator registered with
   *  the grid via `api.registerComparator(name, fn)` — preferred, because
   *  the sort runs worker-side and registered comparators string-serialise
   *  across the `postMessage` boundary — OR an inline closure. Inline
   *  closures cannot cross the worker boundary and throw at
   *  `setSortModel` time with a message that points at
   *  `registerComparator`. Cycle 8 / Task 3. */
  comparator?: string | ((a: TValue, b: TValue, ar: TRow, br: TRow) => number);
  /** Filter type for the column. `'text'` / `'number'` / `'date'` route
   *  the floating-filter input through the matching parser grammar.
   *  `'set'` is reserved for Task 9's checkbox popup. When unset, the
   *  overlay falls back to `cellDataType`. */
  filter?: 'text' | 'number' | 'date' | 'set';
  /** Per-column filter UI parameters. Tasks 3-6 + 9 each consume the
   *  relevant subset (`buttons` / `closeOnApply` are honored by every
   *  popup; type-specific knobs like `caseSensitive` arrive with Task
   *  5's text-filter popup). Widened to accept `CTextFilterParams` so
   *  text-filtered columns can pass `caseSensitive` / `trimInput` /
   *  `textFormatter` / `showCaseSensitiveToggle` without a cast. Cycle
   *  7 / Task 3 (+ Task 8 type widening). */
  filterParams?: CFilterParams | CTextFilterParams | CSetFilterParams;
  /** Per-column override of `CGridOptions.floatingFilter`. When set on a
   *  column, the column joins (or opts out of) the floating-filter row
   *  regardless of the grid-wide default. Cycle 7 / Task 1. */
  floatingFilter?: boolean;
  /** Hide the expand button that opens the full filter popup on the
   *  floating-filter input. Only meaningful when `floatingFilter: true`
   *  for this column. Task 1 reserves the field; popups land in Tasks
   *  3-6 + 9. Cycle 7 / Task 1. */
  suppressFloatingFilterButton?: boolean;
  /** Contributes a custom string to the row's quick-filter aggregate for
   *  this column. The return value replaces the default `String(value)`
   *  contribution. Useful when the cell value is an object / array whose
   *  default coercion (`[object Object]`) carries no signal. Cycle 7 ships
   *  the API surface; the callback runs on the main thread once per
   *  `quickFilterText` change and the resulting per-row aggregate ships
   *  to the worker as part of the column metadata. Arbitrary closures
   *  wait for Cycle 24's worker-module loader — Cycle 7 serializes the
   *  function via `Function.prototype.toString` and reconstructs on the
   *  worker via `new Function(...)`; CSP-restricted hosts fall back to
   *  `String(value)` with a `console.warn`. Cycle 7 / Task 7. */
  getQuickFilterText?: (params: { value: TValue; data: TRow; colId: string }) => string;
  /** Cycle 14 / Task 3 — name of the column's totals aggregation.
   *  Built-in names: `'sum' | 'avg' | 'min' | 'max' | 'count' | 'first'
   *  | 'last'`. Custom names resolve against the registry passed via
   *  `CGridOptions.aggFuncs` (or registered at runtime via
   *  `api.setGridOption('aggFuncs', …)`). Unknown names produce an
   *  `undefined` total for the column — the totals row paints the
   *  cell empty. An array form (`['sum', 'avg']`) uses the FIRST entry
   *  that resolves; subsequent entries serve as fallbacks. */
  aggFunc?: string | string[];
  /** Cycle 14 / Task 4 — per-column override of
   *  `CGridOptions.suppressAggFuncInHeader`. When set, this column's
   *  header decoration follows the column-level flag regardless of the
   *  grid-level value. Unset (`undefined`) defers to the grid-level
   *  option (default `false` → show `sum(Notional)`). Has no visible
   *  effect when the column declares no `aggFunc`. */
  suppressAggFuncInHeader?: boolean;
  /** Cycle 14 / Task 5 — override the cell renderer used for this
   *  column's cell on the totals row. Defaults to the built-in
   *  `'totals'` renderer (subtle muted em-dash for empty, value
   *  formatted via the column's `valueFormatter`). Set to any
   *  registered renderer name (e.g. `'text'`, `'number'`, or a custom
   *  renderer registered via `api.registerCellRenderer`) to opt the
   *  column out of the polished totals treatment for this single
   *  column. Has no effect when the grid has no totals row mounted
   *  (`CGridOptions.totalsRowPosition` is `null` / unset). */
  totalsCellRenderer?: string;
  sortable?: boolean;
  /** Diacritic-aware string sort. When `true`, `SortPass` orders this
   *  column's values via `Intl.Collator(undefined, { sensitivity:
   *  'variant' })` so accented characters slot between their unaccented
   *  neighbours (e.g. `Élise` lands between `Ele` and `Em` instead of
   *  after the entire ASCII alphabet). Honored only when `cellDataType`
   *  resolves to `'text'`; ignored for numeric columns or when a
   *  registered `comparator` runs instead. Cycle 8 / Task 5. */
  accentedSort?: boolean;
  /** When `true`, the header cell paints a faint up/down chevron pair
   *  (`chevrons-up-down`) any time this column is sortable but not
   *  currently in the sort model — a hint to the user that the column
   *  can be clicked to sort. Has no effect when `sortable === false`.
   *  The icon color resolves from the theme's `--cg-unsort-icon-color`
   *  custom property and falls back to a 40% alpha headerFg. Cycle 8 /
   *  Task 5. */
  unSortIcon?: boolean;
  /** Cycle 15 / Task 11 — when this column is one of the
   *  `rowGroupCols` AND the active `SortModel` targets the column,
   *  force the group-level sort to compare composite group keys
   *  (cheap, string-lexicographic) instead of running the column's
   *  registered `comparator` / accented collator over the raw group
   *  `.value`. Useful when the value-aware comparator is expensive
   *  (date parse, locale-aware fold) and the cheap key string
   *  produces the same order.
   *
   *  When `false` / unset, the group-level sort uses the column's
   *  registered `comparator` (or accented collator for text columns
   *  opted into `accentedSort`) over the raw `.value`. Falls back to
   *  the composite-key compare when neither is configured.
   *
   *  No effect on within-bucket (leaf-row) sorting — that always
   *  honours the row's data and the column's registered comparator. */
  sortGroupRowsByKey?: boolean;
  resizable?: boolean;
  /** Editable predicate. Pass `true` / `false` for a static answer, or a
   *  callback receiving `{ data, colId, rowIndex, value }`. */
  editable?: boolean | EditableCallback<TRow, TValue>;
  /** Per-column override of `CGridOptions.singleClickEdit`. When set, this
   *  wins over the grid-level value for this column. */
  singleClickEdit?: boolean;
  /** Per-column key-event short-circuit. Runs at the head of the input
   *  chain — return `true` to suppress every grid handler for the
   *  keystroke. */
  suppressKeyboardEvent?: SuppressKeyboardEventCallback<TRow>;
  /**
   * Render a row-select checkbox in this column's body cells. When
   * true, the column's cellRenderer is forced to
   * `'rowSelectCheckbox'` regardless of the resolved `cellDataType`,
   * and clicks on the cell toggle the row's membership in
   * `selectedRowIndices` (no focus move, no cell-range mutation —
   * pure row-selection gesture). Pair with `pinned: 'left'` for the
   * conventional blotter checkbox column.
   */
  checkboxSelection?: boolean;
  /**
   * Render a tri-state select-all checkbox in this column's header.
   * Click toggles between "select every row" and "clear selection";
   * the box reports `indeterminate` when some-but-not-all rows are
   * selected. Independent of `checkboxSelection` — apps can have the
   * header checkbox without the per-row body checkbox if they want
   * select-all + click-only row selection.
   */
  headerCheckboxSelection?: boolean;
  /**
   * Built-in key (`'text'`, `'number'`, `'date'`, `'dateString'`, `'select'`,
   * `'largeText'`, `'checkbox'`) or a custom constructor registered via
   * `api.registerCellEditor`. When omitted, editable columns default to
   * `'text'`. Per-editor param schemas live in
   * `docs/catalog/06-cell-editing.md` ("Built-in editor types").
   */
  cellEditor?: string | CellEditorCtor<TRow, TValue>;
  /**
   * Static params object — or a callback `(row) => params` — forwarded into
   * `ICellEditorParams.params` at edit-start time. The engine treats this as
   * opaque; the resolved editor interprets the shape.
   */
  cellEditorParams?: Record<string, unknown> | ((row: TRow) => Record<string, unknown>);
  /**
   * Force the editor into popup mode regardless of whether the editor's own
   * `isPopup()` returns true. Matches ag-grid's `cellEditorPopup`. When
   * unset, the editor's own `isPopup()` hook decides — built-in editors are
   * inline-by-default except `'largeText'`, which returns `isPopup(): true`.
   */
  cellEditorPopup?: boolean;
  /**
   * Position of the popup editor relative to the cell. Defaults to `'over'`
   * (popup hides the original cell value). `'under'` floats below so the
   * underlying value stays readable. Honored only when popup mode is active
   * (via `cellEditorPopup` OR `editor.isPopup()`). The editor's own
   * `getPopupPosition()` takes precedence over this col-def value.
   */
  cellEditorPopupPosition?: 'over' | 'under';
  /**
   * Static class name(s) or a callback returning class name(s). Each class
   * name is looked up in the theme's `cellClassVariants` map and the matching
   * `ColCellOverrides` patch is applied to the cell. Applied before
   * `cellClassRules`. Cycle 6 / Task 7.
   */
  cellClass?: CellClass<TRow, TValue>;
  /**
   * Map of class-name → predicate. The predicate is called per cell at paint
   * time; when it returns `true`, the matching `ColCellOverrides` patch from
   * the theme is applied. Rules are evaluated after `cellClass`.
   * Cycle 6 / Task 7.
   */
  cellClassRules?: CellClassRules<TRow, TValue>;
  /**
   * Static object or function-form per-cell style override. The object form
   * (static `ColCellOverrides`) is merged on top of class-driven variants.
   * The function form (`CellStyleFunc`) is called per cell and its return value
   * is applied last (highest precedence). Cycle 6 / Task 7.
   */
  cellStyle?: ColCellOverrides | CellStyleFunc<TRow, TValue>;
  /**
   * Cycle 27 / Task 1 — direct style override for this column's HEADER cell.
   * Static object or function form (called per header paint). Applied AFTER
   * `headerClass` variants — same precedence rules as `cellStyle` vs
   * `cellClass`. Doesn't leak into data cells.
   */
  headerStyle?: ColCellOverrides | HeaderStyleFunc;
  /**
   * Class name(s) applied to the header cell. Resolves through the theme's
   * `headerClassVariants` map. Cycle 6 / Task 7.
   */
  headerClass?: HeaderClass;
  /**
   * When true, the row's height grows to fit this cell's wrapped text. The
   * worker measures every visible row in this column via
   * `OffscreenCanvas.measureText` (with a main-thread fallback on Safari
   * 15.4–16.3 and Firefox 100–104), then aggregates the result into the
   * row's resolved height — `max(getRowHeight, max(autoHeight columns))`.
   * Typically paired with `wrapText: true` (Cycle 5 / Task 9) so the
   * renderer actually paints across multiple lines. Cycle 5 / Task 8.
   */
  autoHeight?: boolean;
  /**
   * When true, the cell renderer paints `valueFormatted` across multiple
   * lines using greedy word-wrap against the cell's inner width. Lines that
   * exceed the row height are truncated with `…` on the last visible line.
   * Pair with `autoHeight: true` so the row grows to fit; without
   * `autoHeight`, wrapped text truncates at the row boundary. Cycle 5 /
   * Task 9.
   */
  wrapText?: boolean;
  /**
   * Convert the editor's emitted value into the typed value to commit. Runs
   * before `valueSetter`. Receives the value already cast by the editor
   * (`Number()` for `type: 'number'`, raw string for text). Return the value
   * to commit. When omitted, the editor's value flows through unchanged.
   */
  valueParser?: (params: CValueParserParams<TRow, TValue>) => TValue;
  /**
   * Apply the committed value to the row. Default behavior is
   * `data[field] = newValue`. Provide this to customise the write — for
   * example, to split a `firstName lastName` string back into two columns,
   * or to keep a denormalised total in sync. The function should mutate
   * `data` in place; the returned value (if any) is ignored.
   */
  valueSetter?: (params: CValueSetterParams<TRow, TValue>) => boolean | void;
  /**
   * When the parent column group is open: visible only if `'open'`.
   * When the parent group is closed: visible only if `'closed'`.
   * `null` / undefined = always visible regardless of group state.
   * Honored once column groups land (Cycle 4 Task 3).
   */
  columnGroupShow?: 'open' | 'closed' | null;
  /**
   * When true, the user cannot drag this column to a new position. The
   * imperative `moveColumnByIndex` API still works — locks alone bind
   * UI-driven reorders. Pair with `lockPosition` to also reject API moves.
   * Cycle 6 / Task 1.
   */
  suppressMovable?: boolean;
  /**
   * Pin this column's index. `true` / `'left'` lock the column to index 0
   * of the flat visible-leaf order; `'right'` locks to the end. The lock
   * binds both drag-reorder and the imperative move API. Cycle 6 / Task 1.
   */
  lockPosition?: boolean | 'left' | 'right';
  /**
   * When true, the column is excluded from the flat visible-leaf order
   * (header + body + layout + hit-test). Hidden columns remain in
   * `columnDefsMap` so `getColumnState()` keeps reporting them — the
   * round-trip is symmetric. Cycle 6 / Task 2.
   */
  hide?: boolean;
  /**
   * Applied only on first construction. `applyColumnState` and the
   * imperative API ignore this field — they read `hide` instead. Cycle 6 /
   * Task 2.
   */
  initialHide?: boolean;
  /**
   * Applied only on first construction. The grid honors this when no
   * matching `pinned` value is provided. Cycle 6 / Task 2.
   */
  initialPinned?: boolean | 'left' | 'right';
  /**
   * Applied only on first construction. The grid honors this when no
   * matching `width` value is provided. Cycle 6 / Task 2.
   */
  initialWidth?: number;
  /** Construction-time seed for the sort direction on this column.
   *  Honored exactly once; subsequent `applyColumnState` reads `sort`
   *  instead. When omitted, the column is unsorted on first paint.
   *  Cycle 8 / Task 2. */
  initialSort?: 'asc' | 'desc';
  /** Construction-time seed for the column's position in a multi-column
   *  sort. Columns without an index sort to the tail in their
   *  declaration order. Honored exactly once alongside `initialSort`.
   *  Cycle 8 / Task 2. */
  initialSortIndex?: number;
  /**
   * When true, `applyColumnState` + `setColumnsVisible` (Task 5) silently
   * drop any mutation that would flip this column's `hide` state.
   * Cycle 6 / Task 2.
   */
  lockVisible?: boolean;
  /**
   * When true, `applyColumnState` + `setColumnsPinned` (Task 5) silently
   * drop any mutation that would change this column's `pinned` state.
   * Cycle 6 / Task 2.
   */
  lockPinned?: boolean;
  /**
   * When true, `sizeColumnsToFit` skips this column — its width is held
   * at the current value while the remaining columns absorb the container
   * width. Cycle 6 / Task 3.
   */
  suppressSizeToFit?: boolean;
  /**
   * When true, `autoSizeColumns` / `autoSizeAllColumns` skip this column.
   * Pair with a fixed `width` to opt a column out of any auto-fit pass.
   * Cycle 6 / Task 4.
   */
  suppressAutoSize?: boolean;
  /** Cycle 15 / Task 6 — when `true`, the column header can be dragged
   *  INTO the row group panel to append this column to `rowGroupCols`.
   *  When `false` (default — mirrors ag-grid), the panel REJECTS a
   *  drop of this column's header (the panel's drop indicator paints
   *  in a muted "rejected" variant during the hover). The column can
   *  still be added to `rowGroupCols` via the imperative
   *  `setGroupModel` API regardless of this flag — it gates only the
   *  UI drag-from-header gesture. Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 6. */
  enableRowGroup?: boolean;
  /** Cycle 18 / Task 3 — gates whether the user may drag this column's
   *  header into the Column Labels (pivot) drop zone. `false` (default,
   *  mirrors ag-grid) rejects the drop; the imperative
   *  `setPivotColumns` / `addPivotColumn` API works regardless — this
   *  flag gates only the UI gesture (Task 5 / 7 wire the surfaces). */
  enablePivot?: boolean;
  /** Cycle 18 / Task 3 — gates whether the user may drag this column's
   *  header into the Values drop zone (aggregated measure). `false`
   *  (default) rejects the drop; the imperative `addValueColumn` API
   *  works regardless. */
  enableValue?: boolean;
}

/**
 * Params passed to a `cellRendererSelector`. Foundation cycle: row `data` is
 * stored in the worker, so the selector receives the materialised `value`
 * and `colId` only. Row data will join this object when main-thread row
 * access lands in a later cycle.
 */
export interface CCellRendererSelectorParams<TValue = unknown> {
  value: TValue;
  colId: string;
}

export interface CCellRendererSelectorResult {
  /** Registered cell-renderer name to dispatch to. */
  component: string;
  /** Dynamic params forwarded to the painter. Override static
   *  `cellRendererParams` when defined; falls back to them when omitted. */
  params?: unknown;
}

export type CCellRendererSelector<TRow = any, TValue = any> = (
  params: CCellRendererSelectorParams<TValue> & { data?: TRow | null },
) => CCellRendererSelectorResult | undefined;

/**
 * Column group definition. `columnDefs` accepts a mix of `CColDef` (leaf
 * columns) and `CColGroupDef` (groups). Groups nest arbitrarily; the grid
 * builds a tree at construction time and flattens to a leaf-ordered render
 * list. `groupId` is auto-generated when omitted.
 */
export interface CColGroupDef<TRow = any> {
  /** Stable identifier. Auto-generated as `cg-grp-${n}` when omitted. */
  groupId?: string;
  /** Text shown in the group header cell. Empty string OK. */
  headerName?: string;
  /** Child columns or nested groups. Required; must be non-empty. */
  children: (CColDef<TRow> | CColGroupDef<TRow>)[];
  /** Group is expanded on first render. Default false (closed). */
  openByDefault?: boolean;
  /** Prevents user from dragging child columns outside this group. */
  marryChildren?: boolean;
  /**
   * Class name(s) applied to the group header cell. Resolves through the
   * theme's `headerClassVariants` map. Cycle 6 / Task 7 wires this (Cycle 4
   * was storage-only).
   */
  headerClass?: HeaderClass;
  /**
   * Cycle 27 / Task 1 — direct style override for this group's HEADER cell.
   * Static object or function form. Same precedence rules as the leaf
   * `headerStyle` field on `CColDef`.
   */
  headerStyle?: ColCellOverrides | HeaderStyleFunc;
}

export interface CValueGetterParams<TRow> { data: TRow; colId: string }
export interface CValueFormatterParams<TRow, TValue> {
  data: TRow; value: TValue; colId: string;
}

/** Params passed to `CColDef.valueParser`. */
export interface CValueParserParams<TRow = any, TValue = any> {
  /** Value emitted by the editor (already cast by `type` when applicable). */
  newValue: unknown;
  /** The row's previous value at `colDef.field`. */
  oldValue: TValue;
  /** The full row object as it currently lives in the worker. */
  data: TRow;
  colDef: CColDef<TRow, TValue>;
}

/** Params passed to `CColDef.valueSetter`. */
export interface CValueSetterParams<TRow = any, TValue = any> {
  /** Mutable row object. Mutate this in place to apply the commit. */
  data: TRow;
  /** The parsed value (output of `valueParser` if provided). */
  newValue: TValue;
  /** The row's previous value at `colDef.field`. */
  oldValue: TValue;
  colDef: CColDef<TRow, TValue>;
}

export interface SortModelEntry { colId: string; direction: 'asc' | 'desc' }
export type SortModel = SortModelEntry[];

/**
 * A contiguous cell-range selection. Mirrors ag-grid's range shape:
 * a rectangle spanning `rowStart..rowEnd` (inclusive, visible-order
 * indices) by `colIds[]` (ordered left → right in render order).
 *
 * Disjoint selections are represented as multiple `SelectionRange`
 * entries in `SelectionModel.state.ranges`. Column-band selections
 * (header click) span `rowStart=0 → rowEnd=rowCount-1` with a single
 * colId; full-row ranges span every visible colId. Cycle 9 / Task 1.
 */
export interface SelectionRange {
  /** First row in the range (inclusive, current visible-order index). */
  rowStart: number;
  /** Last row in the range (inclusive, current visible-order index). */
  rowEnd: number;
  /** ColIds involved, in render order (left → right). */
  colIds: string[];
}

/**
 * Serialisable per-leaf column state. Returned in current-visible-leaf
 * order from `getColumnState`, including hidden leaves so the round-trip
 * is symmetric. `undefined` on any optional slot is treated as
 * "don't change" by `applyColumnState`. Cycle 6 / Task 2.
 */
export interface CColumnState {
  colId: string;
  /** Resolved column width in pixels. `undefined` when the leaf is flex-only. */
  width?: number;
  /** Flex weight. `null` clears any flex; `undefined` leaves it untouched. */
  flex?: number | null;
  /** `true` / `false` (explicit). `undefined` round-trips as "don't change". */
  hide?: boolean;
  /** `'left'` / `'right'` / `null` (unpinned). `undefined` = "don't change". */
  pinned?: 'left' | 'right' | null;
  /** `'asc'` / `'desc'` / `null` (unsorted). `undefined` = "don't change". */
  sort?: 'asc' | 'desc' | null;
  /** Position in a multi-column sort. `null` = unsorted. */
  sortIndex?: number | null;
  /** Reserved for Cycle 14. Round-trips opaquely until then. */
  rowGroup?: boolean;
  rowGroupIndex?: number | null;
  /** Reserved for Cycle 17. Round-trips opaquely until then. */
  pivot?: boolean;
  pivotIndex?: number | null;
  /** Reserved for Cycle 13. Round-trips opaquely until then. */
  aggFunc?: string | null;
}

/**
 * Parameters for `CGridApi.applyColumnState`. Cycle 6 / Task 2.
 *
 * - `state` — per-leaf restore entries; matched by `colId`. Leaves not
 *   mentioned fall back to `defaultState` (if provided) or stay unchanged.
 * - `applyOrder` — when true, the column order from `state` defines the
 *   new flat-leaf order (Task 1's locks + `marryChildren` still bind).
 * - `defaultState` — applied to every leaf not mentioned in `state`. Pair
 *   with a sparse `state` to "reset everything else + restore these few"
 *   in a single call.
 */
export interface CApplyColumnStateParams {
  state?: CColumnState[];
  applyOrder?: boolean;
  defaultState?: Omit<CColumnState, 'colId'>;
}

/**
 * Parameters for `CGridApi.sizeColumnsToFit`. Cycle 6 / Task 3.
 *
 * - `width` — explicit width to fit to. Defaults to the canvas drawable
 *   width (already excludes the vertical-scrollbar gutter).
 * - `defaultMinWidth` / `defaultMaxWidth` — fallback bounds applied to
 *   leaves that don't carry per-column `minWidth` / `maxWidth`. The
 *   tighter of the two wins (per-column min beats default min only when
 *   it's larger; per-column max beats default max only when it's smaller).
 * - `columnLimits` — per-column min/max overrides keyed by `colId`. Wins
 *   over both the column's own bounds and the param-level defaults.
 */
export interface ISizeColumnsToFitParams {
  width?: number;
  defaultMinWidth?: number;
  defaultMaxWidth?: number;
  columnLimits?: Array<{ key: string; minWidth?: number; maxWidth?: number }>;
}

/** Legacy Cycle 4 / 5 filter entry shape. Continues to round-trip through
 *  `setFilterModel`; the worker's matcher accepts it directly. Task 2 of
 *  Cycle 7 widens the public type alias to the ag-grid-compatible v2 union
 *  ({ filterType, type, filter, ... }) while preserving this shape via a
 *  back-compat normaliser. */
export type FilterModelEntryLegacy =
  | { type: 'text'; op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { type: 'number'; op: 'eq' | 'gt' | 'lt' | 'between'; value: number; value2?: number };

/** Cycle 7 / Task 1 (parser enhancement) — ag-grid-compatible text
 *  operator names. The floating-filter input parser only emits
 *  `contains` today; Task 5's text-filter popup adds the rest. */
export type CTextFilterOp =
  | 'contains' | 'notContains'
  | 'equals'   | 'notEqual'
  | 'startsWith' | 'endsWith'
  | 'blank' | 'notBlank';

/** Cycle 7 / Task 1 (parser enhancement) — ag-grid-compatible number
 *  operator names. The floating-filter parser emits the comparison
 *  variants + `inRange`; `blank` / `notBlank` land with Task 3's popup. */
export type CNumberFilterOp =
  | 'equals' | 'notEqual'
  | 'lessThan' | 'lessThanOrEqual'
  | 'greaterThan' | 'greaterThanOrEqual'
  | 'inRange'
  | 'blank' | 'notBlank';

/** Cycle 7 / Task 1 (parser enhancement) — date filter operators mirror
 *  the number set; comparisons run on ISO date strings. */
export type CDateFilterOp = CNumberFilterOp;

/** Forward-compatible v2 text-filter entry. The floating-filter parser
 *  emits `contains` for bare text and combines via
 *  `CMultiConditionFilterModel` for CSV / AND / OR. Task 5's popup
 *  widens the operator usage to the full `CTextFilterOp` surface. */
export interface CTextFilterModel {
  filterType: 'text';
  type: CTextFilterOp;
  filter?: string;
  /** Case-sensitive comparison (defaults to false). Reserved by Task 1;
   *  honoured fully by Task 5's text-filter popup. */
  caseSensitive?: boolean;
}

/** v2 number-filter entry. `inRange` activates the `filterTo` upper
 *  bound (inclusive). The floating-filter parser emits these directly
 *  via the `> 100`, `100..200`, `>=100`, etc. syntaxes. */
export interface CNumberFilterModel {
  filterType: 'number';
  type: CNumberFilterOp;
  filter?: number;
  /** Required when `type === 'inRange'`; inclusive upper bound. */
  filterTo?: number;
}

/** v2 date-filter entry. `filter` / `filterTo` carry ISO strings
 *  (`YYYY-MM-DD` or full timestamp). Floating-filter parser supports
 *  comparison + CSV; range via `..` requires both sides to parse as
 *  dates. */
export interface CDateFilterModel {
  filterType: 'date';
  type: CDateFilterOp;
  filter?: string;
  filterTo?: string;
}

/** Cycle 7 / Task 1 (parser enhancement) — multi-condition entry. Used
 *  by the floating-filter parser to compose CSV / AND / OR expressions.
 *  Conditions evaluate left-to-right and short-circuit. Task 6's popup
 *  surfaces the same shape with a maxNumConditions=2 constraint; the
 *  parser-generated form is uncapped (a five-element CSV produces a
 *  five-element conditions array). */
export interface CMultiConditionFilterModel {
  filterType: 'multi';
  operator: 'AND' | 'OR';
  conditions: Array<CTextFilterModel | CNumberFilterModel | CDateFilterModel>;
}

/** Cycle 7 / Task 9 — set-filter entry. `values` is the user's
 *  checked subset of the column's distinct values; a row passes when
 *  `String(value)` is in the set. An empty `values` array means
 *  "deselect all" — every row drops (matches ag-grid). Apps that want
 *  to clear the filter entirely should ship `null` to
 *  `setColumnFilterModel` rather than an empty set. */
export interface CSetFilterModel {
  filterType: 'set';
  values: string[];
}

/** Cycle 7 type alias for a single column's filter entry. Discriminated
 *  by `filterType`; consumers should switch on that. */
export type CFilterModelEntry =
  | CTextFilterModel
  | CNumberFilterModel
  | CDateFilterModel
  | CMultiConditionFilterModel
  | CSetFilterModel;

export type FilterModelEntry = FilterModelEntryLegacy | CFilterModelEntry;
export type FilterModel = Record<string, FilterModelEntry>;

/** Shared filter-popup UI parameters. Tasks 3-9 each read the relevant
 *  subset; this base shape is the contract every per-type filter
 *  (number/date/text/multi/set) honours. Mirrors ag-grid's
 *  `IProvidedFilterParams`. Cycle 7 / Task 3.
 *
 *  - `buttons` — which action buttons render in the popup footer.
 *    Defaults to `['apply', 'clear', 'reset']`. `'cancel'` is opt-in;
 *    `'apply'` is required for the popup to commit anything when
 *    `closeOnApply` is also off (otherwise the user has no way to
 *    surface their model).
 *  - `closeOnApply` — when true (default for Task 3+) the popup closes
 *    after Apply. When false, the popup stays open so the user can
 *    tweak the filter without re-opening.
 *  - `debounceMs` — reserved for Task 5's text-filter popup that
 *    auto-applies as the user types. Tasks 3 / 4 commit only via
 *    Apply.
 *  - `readOnly` — reserved for Task 9; non-interactive popup. */
export interface CFilterParams {
  buttons?: Array<'apply' | 'clear' | 'reset' | 'cancel'>;
  closeOnApply?: boolean;
  debounceMs?: number;
  readOnly?: boolean;
  /** Cycle 7 / Task 6 — caps the total condition rows the popup will
   *  show. Defaults to 2. When set to 1 the popup keeps the existing
   *  single-condition behaviour (no join radio, no second row). */
  maxNumConditions?: number;
  /** How many condition rows are mounted on initial open. Defaults to
   *  1; the remaining rows reveal as the user fills the previous one. */
  numAlwaysVisibleConditions?: number;
  /** Seed value for the join-operator radio between condition rows.
   *  Defaults to `'AND'`. */
  defaultJoinOperator?: 'AND' | 'OR';
}

/** Cycle 7 / Task 5 — text-filter specific parameters. Extends the
 *  shared `CFilterParams` surface with the four ag-grid knobs the text
 *  filter exposes:
 *
 *  - `caseSensitive` — default state for the in-popup checkbox. The
 *    emitted `CTextFilterModel` carries the resolved per-entry value;
 *    this field only seeds the initial UI state.
 *  - `textFormatter` — column-level pre-comparison normaliser the
 *    worker runs on BOTH the cell value AND the filter value before
 *    the operator fires. Built-in formatters: `'lowercase'` /
 *    `'uppercase'` / `'trim'`. Arbitrary closures are out of scope
 *    until Cycle 24's worker-module loader.
 *  - `trimInput` — when true, the filter value is trimmed at
 *    `setColumnFilterModel` time (main-side, before the model reaches
 *    the worker). Distinct from the column-level `textFormatter: 'trim'`,
 *    which trims values on every row comparison.
 *  - `showCaseSensitiveToggle` — when false, the popup suppresses the
 *    caseSensitive checkbox. Defaults to true.
 */
export interface CTextFilterParams extends CFilterParams {
  caseSensitive?: boolean;
  textFormatter?: 'lowercase' | 'uppercase' | 'trim';
  trimInput?: boolean;
  showCaseSensitiveToggle?: boolean;
}

/** Cycle 7 / Task 9 — set-filter (`agSetColumnFilter` parity) params.
 *
 *  - `values` overrides the data-derived distinct-value list. Cycle 7
 *    only honours the data-derived path; the static-array variant is
 *    reserved for Cycle 18's SSRM, which needs server-provided values.
 *  - `caseSensitive` toggles the mini-search comparison (the on-popup
 *    text input that narrows the checkbox list). Distinct from any
 *    cell-level case handling — the checked values are stored
 *    verbatim from the distinct set, so case is preserved on commit
 *    regardless of this flag.
 *  - `suppressMiniFilter` hides the inline search box.
 *  - `suppressSelectAll` hides the tri-state "Select All" checkbox. */
export interface CSetFilterParams extends CFilterParams {
  values?: string[];
  caseSensitive?: boolean;
  suppressMiniFilter?: boolean;
  suppressSelectAll?: boolean;
}

export interface GroupModel { rowGroupCols: string[] }

/** Cycle 20 / Task 4 — value-transform callback fired during export.
 *  Same shape covers `processCellCallback`, `processHeaderCallback`,
 *  and `processRowGroupCallback` — apps switch on `colId` /
 *  `kind` to decide what to do. */
export type ExportCallback = (params: {
  value: unknown;
  colId: string;
  /** `'cell'` for data cells, `'header'` for column headers,
   *  `'rowGroup'` for group-row labels. */
  kind: 'cell' | 'header' | 'rowGroup';
  /** The row's full data object (cells only). Undefined for header /
   *  rowGroup invocations. */
  node?: Record<string, unknown>;
}) => unknown;

export interface Tx<TRow = any> {
  add?: TRow[];
  update?: TRow[];
  remove?: TRow[];
}
export interface TransactionResult {
  add: { rowId: string }[];
  update: { rowId: string }[];
  remove: { rowId: string }[];
}

/** Fires before the editor's DOM mounts. Cycle 5 wiring uses `rowIndex` as
 *  the primary positional identity; `rowId` is best-effort (synthetic
 *  `row-${idx}` until the worker→main rowId map lands). */
export interface CellEditingStartedEvent<TRow = unknown> {
  type: 'cellEditingStarted';
  rowIndex: number;
  rowId: string;
  colId: string;
  value: unknown;
  data: TRow;
}
/** Fires unconditionally when an editor closes (commit OR cancel).
 *  `valueChanged` is `true` only when the commit produced a real value
 *  change AND it was not cancelled. */
export interface CellEditingStoppedEvent<TRow = unknown> {
  type: 'cellEditingStopped';
  rowIndex: number;
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
  valueChanged: boolean;
  data: TRow;
}

/** Fires after every editor in the row's editable cells has mounted in
 *  full-row edit mode (`editType: 'fullRow'`). Single-cell edits do not
 *  fire this. Cycle 5 / Task 10. */
export interface RowEditingStartedEvent<TRow = unknown> {
  type: 'rowEditingStarted';
  rowIndex: number;
  rowId: string;
  data: TRow;
}

/** Fires unconditionally when full-row editing ends (commit OR cancel).
 *  Pair with `rowValueChanged` to know whether anything actually
 *  committed — `rowEditingStopped` always fires, `rowValueChanged` fires
 *  only when ≥ 1 cell changed. Cycle 5 / Task 10. */
export interface RowEditingStoppedEvent<TRow = unknown> {
  type: 'rowEditingStopped';
  rowIndex: number;
  rowId: string;
  data: TRow;
}

/** Fires once after a full-row commit that produced at least one changed
 *  cell. Per-cell `cellValueChanged` events still fire alongside; this is
 *  a single row-level signal apps can use to drive whole-row workflows
 *  (server-side write-back, validation banners). Cycle 5 / Task 10. */
export interface RowValueChangedEvent<TRow = unknown> {
  type: 'rowValueChanged';
  rowIndex: number;
  rowId: string;
  data: TRow;
}

/** Cycle 14 / Task 6 — discriminator on `aggregationChanged` events that
 *  identifies which mutation drove the recompute. Apps that listen for
 *  this event correlate the source tag to their own state (e.g. a toast
 *  that says "totals refreshed: filter applied" vs. "data updated"). The
 *  set is closed — new sources land here as the API surface grows. */
export type AggregationChangedSource =
  | 'rowDataChanged'
  | 'aggFuncChanged'
  | 'filterChanged'
  | 'columnAggFuncChanged'
  | 'api';

/** Cycle 14 / Task 6 — strongly-typed shape of the `aggregationChanged`
 *  event. Exported so apps can declare typed listeners without reaching
 *  into the `CGridEvent` union. */
export interface AggregationChangedEvent {
  type: 'aggregationChanged';
  totals: Record<string, unknown>;
  source: AggregationChangedSource;
}

export type CGridEvent =
  | { type: 'gridReady'; api: CGridApi }
  | { type: 'cellClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellDoubleClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  /** Cycle 23 / Task 2 — pointer crossed a cell boundary. Fires per
   *  transition only (never per pixel). The Out event is paired with
   *  the Over event for the next cell when the pointer moves from one
   *  cell to another; either fires alone when the pointer enters or
   *  leaves the body band entirely. */
  | { type: 'cellMouseOver'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellMouseOut'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  /** Cycle 23 / Task 2 — pointer crossed a row boundary. Coalesced
   *  per row: moving across multiple cells inside the same row fires
   *  zero `rowMouse*` events. */
  | { type: 'rowMouseOver'; rowId: string; mouse: MouseEvent }
  | { type: 'rowMouseOut'; rowId: string; mouse: MouseEvent }
  | { type: 'cellFocused'; rowId: string; colId: string }
  | {
      type: 'cellValueChanged';
      rowId: string;
      colId: string;
      oldValue: unknown;
      newValue: unknown;
      /** Raw value returned by the editor before `valueParser` ran. Same as
       *  `newValue` when no parser was configured. */
      newRawValue?: unknown;
      /** Origin of the change. `'edit'` for manual cell edits. Reserved
       *  values: `'paste'` / `'fill'` / `'api'` (later cycles). */
      source?: 'edit';
      /** Row index in the current visible order. */
      rowIndex?: number;
      /** Mutated row object as it lives in the worker after the commit. */
      data?: unknown;
    }
  | CellEditingStartedEvent
  | CellEditingStoppedEvent
  | RowEditingStartedEvent
  | RowEditingStoppedEvent
  | RowValueChangedEvent
  | { type: 'selectionChanged'; selectedRowIds: string[] }
  | { type: 'viewportChanged'; firstRow: number; lastRow: number }
  /** Cycle 23 / Task 3 — fires on every scroll tick. `direction`
   *  carries the dominant axis of THIS tick relative to the previous
   *  scroll position (`'vertical'` if `top` changed, `'horizontal'`
   *  if only `left` changed). Apps that watch scroll progress
   *  (mini-map cursors, custom virtualization) subscribe here.
   *  Pair with `bodyScrollEnd` (debounced) for "settled" handlers. */
  | { type: 'bodyScroll'; top: number; left: number; direction: 'vertical' | 'horizontal' }
  /** Cycle 23 / Task 3 — debounced companion to `bodyScroll`. Fires
   *  exactly once 200ms after the last scroll tick; subsequent
   *  scrolls within the window reset the debounce. Apps that
   *  persist scroll position to storage hook this instead of
   *  `bodyScroll` so they save once per gesture. */
  | { type: 'bodyScrollEnd'; top: number; left: number }
  /** Cycle 23 / Task 4 — focused cell sees a keydown BEFORE the grid's
   *  own key handler. Apps can call `event.preventDefault()` to
   *  suppress grid behavior (e.g., disable Enter-to-commit on a
   *  specific column). `rowId` / `colId` reflect the currently
   *  focused cell at the moment the key fired; `value` is the cell
   *  value via `cellAt`. */
  | { type: 'cellKeyDown'; rowId: string; colId: string; value: unknown; event: KeyboardEvent }
  /** Cycle 23 / Task 4 — fires alongside `cellKeyDown` when the key
   *  represents a single printable character (length-1 `event.key`
   *  with no Ctrl / Meta / Alt modifier). Modern browsers deprecated
   *  the native `keypress` event; the grid synthesizes this from
   *  keydown so apps that watched ag-grid's `cellKeyPress` still get
   *  the type-to-edit hook. `preventDefault` on the underlying
   *  KeyboardEvent suppresses the grid's printable-key behavior the
   *  same way. */
  | { type: 'cellKeyPress'; rowId: string; colId: string; value: unknown; event: KeyboardEvent }
  /** Cycle 23 / Task 7 — fires when any GridState component changes.
   *  Debounced per rAF: N changes within one frame collapse into one
   *  event. The payload carries the FULL state snapshot + a
   *  changedKeys array tagged with the GridState keys that mutated
   *  this frame. `source` distinguishes the trigger — `'api'` for an
   *  explicit `setState` call, `'init'` for the `initialState`
   *  constructor option, `'ui'` for everything else (user
   *  interaction, runtime option swap, drag, etc.). */
  | {
      type: 'stateUpdated';
      state: import('./core/stateSnapshot').GridState;
      changedKeys: (keyof import('./core/stateSnapshot').GridState)[];
      source: 'api' | 'ui' | 'init';
    }
  | { type: 'modelUpdated'; visibleRowCount: number }
  | { type: 'sortChanged'; sortModel: SortModel }
  | {
      type: 'filterChanged';
      filterModel: FilterModel;
      /** Labels the trigger so apps can correlate the event with the user
       *  action that drove it. `'api'` is the default (a `setFilterModel`
       *  call); `'columnFilter'` fires from a per-column model mutation;
       *  `'quickFilter'` fires from `setGridOption('quickFilterText', ...)`.
       *  `'externalFilter'` is reserved for Task 8. Optional for
       *  back-compat — Tasks 1-6 emit without it. Cycle 7 / Task 7. */
      source?: 'api' | 'quickFilter' | 'columnFilter' | 'externalFilter';
      /** Cycle 7 / Task 9 — true when the change was triggered by a
       *  data update (a transaction landed and the worker re-evaluated
       *  the model against new rows) rather than a model mutation.
       *  Apps that distinguish "user changed the filter" from "data
       *  changed under an existing filter" branch on this. Optional —
       *  unset is equivalent to `false`. */
      afterDataChange?: boolean;
      /** Cycle 7 / Task 9 — colIds whose per-column filter state
       *  actually changed in this event. Empty / unset when the event
       *  isn't column-driven (e.g. a quickFilter / externalFilter
       *  trigger). */
      columns?: string[];
    }
  /** Cycle 7 / Task 9 — fired every time a filter popup mounts. The
   *  payload is the colId whose popup is opening; an app can watch
   *  this to drive analytics or a sibling UI panel. Fires AFTER the
   *  popup DOM is in the document. */
  | { type: 'filterOpened'; colId: string }
  /** Cycle 7 / Task 9 — fired on every popup-internal mutation BEFORE
   *  Apply commits. Apps use this to power "filter dirty" indicators
   *  without polling the popup's UI state. */
  | { type: 'filterModified'; colId: string }
  | {
      type: 'columnResized';
      colId: string;
      width: number;
      /** False during a drag-resize tick. True on mouseup AND on every
       *  imperative width mutation (including `setColumnWidths` —
       *  Cycle 6 / Task 5, `sizeColumnsToFit` — Cycle 6 / Task 3, and
       *  `autoSizeColumns` — Cycle 6 / Task 4). Apps that persist on
       *  `finished: true` only fire one save per drag instead of one
       *  per pixel. */
      finished?: boolean;
      source?: 'columnState' | 'uiColumnResized' | 'api' | 'sizeColumnsToFit' | 'autosizeColumns';
    }
  /** Fires when one or more columns have changed visibility. `source`
   *  distinguishes a column-state restore (`'columnState'`) from a Task-5
   *  imperative `setColumnsVisible` call (`'api'`). Cycle 6 / Task 2
   *  (emit on `applyColumnState` / `resetColumnState`) + Task 5 (emit
   *  on `setColumnsVisible`). */
  | {
      type: 'columnVisible';
      visible: boolean;
      colIds: string[];
      source: 'columnState' | 'api';
    }
  /** Fires when one or more columns have changed pinning. `pinned: null`
   *  for unpinned columns. Cycle 6 / Task 2 (emit on `applyColumnState`
   *  / `resetColumnState`) + Task 5 (emit on `setColumnsPinned`). */
  | {
      type: 'columnPinned';
      pinned: 'left' | 'right' | null;
      colIds: string[];
      source: 'columnState' | 'api';
    }
  /** Fires once after `resetColumnState` restores the construction-time
   *  snapshot, BEFORE the per-slot change events fan out (`columnMoved`
   *  / `columnVisible` / `columnPinned` / `columnResized` / `sortChanged`).
   *  Cycle 6 / Task 2. */
  | { type: 'columnsReset' }
  /** Fires after a column changes its index in the flat visible-leaf order.
   *  `toIndex` is the resolved final index AFTER `lockPosition` /
   *  `marryChildren` clamping; it may differ from the drag's drop target
   *  or the imperative API's requested index. `source` distinguishes
   *  drag (`'uiColumnDragged'`) from API (`'api'`) and (Cycle 6 / Task 2)
   *  column-state apply (`'columnState'`). The `colIds` array shape is
   *  shared with the multi-column move API landing in Cycle 6 / Task 5. */
  | {
      type: 'columnMoved';
      toIndex: number;
      colIds: string[];
      source: 'uiColumnDragged' | 'api' | 'columnState';
    }
  | { type: 'asyncTransactionsFlushed'; results: TransactionResult[] }
  /** Fires when the aggregation totals have been recomputed against a
   *  change the user can correlate to a cause. `source` tags the
   *  triggering action — data mutation (`rowDataChanged`), filter pipeline
   *  re-evaluation (`filterChanged`), runtime `aggFuncs` swap
   *  (`aggFuncChanged`), per-column `aggFunc` change
   *  (`columnAggFuncChanged`), or an explicit imperative trigger (`api`).
   *  Cosmetic re-renders that don't change the totals — scroll, sort,
   *  theme, column visibility / move / resize — do NOT fire this event;
   *  apps that need the on-every-paint signal listen to `viewportChanged`
   *  instead. `totals` is the per-column map keyed by `colId`. Cycle 14
   *  / Task 6. */
  | {
      type: 'aggregationChanged';
      totals: Record<string, unknown>;
      source: AggregationChangedSource;
    }
  | { type: 'columnGroupOpened'; groupId: string; open: boolean }
  /** Cycle 15 / Task 7 — a single row-group's expanded state changed.
   *  `key` is the composite group key (`${col}:${value}` per level,
   *  joined by `::`); `expanded` is the new state. `source` tags the
   *  trigger — `'ui'` for a chevron click, `'api'` for an imperative
   *  `setExpanded(key, expanded)` call. The bulk `expandAll()` /
   *  `collapseAll()` API does NOT fan out per-group events; listen
   *  for `expandOrCollapseAll` for those. */
  | {
      type: 'rowGroupOpened';
      key: string;
      expanded: boolean;
      source: 'ui' | 'api';
    }
  /** Cycle 15 / Task 7 — fires after `expandAll()` / `collapseAll()`
   *  fans out the state. `expanded` is the target state every group
   *  was set to. */
  | { type: 'expandOrCollapseAll'; expanded: boolean }
  /** Cycle 15.5 / Task 2 — fires whenever the `rowGroupColumns` list
   *  or per-level sort entries mutate via the primitive API
   *  (`setRowGroupColumns` / `addRowGroupColumn` /
   *  `removeRowGroupColumn` / `moveRowGroupColumn` /
   *  `setRowGroupColumnSort`). Carries the full ordered list AND the
   *  verb that drove the change so subscribers (the columns tool
   *  panel's Row Groups drop zone, the header context menu's
   *  Group / Un-Group items, app-side analytics) can re-render or log
   *  without having to diff a snapshot against their own last-known
   *  copy. `source` mirrors the GroupingState verbs: `'set'` for the
   *  whole-list replace, `'add'` / `'remove'` / `'move'` for the
   *  single-column verbs, `'sort'` when only the per-level sort
   *  decoration changed (the ordered list didn't move). */
  | {
      type: 'columnRowGroupChanged';
      columns: string[];
      source: 'set' | 'add' | 'remove' | 'move' | 'sort' | 'restore';
    }
  /** Cycle 18 / Task 5 — fired whenever PivotState mutates: pivotMode flip,
   *  pivot/value column add/remove/move, value aggFunc change, or a
   *  `restore()` round-trip. Carries fresh snapshots so subscribers can
   *  diff against their last-known copy. The columns tool panel + pivot
   *  panel + context menu items all subscribe to keep the three views over
   *  PivotState in sync (the same "many views over one model" invariant
   *  GroupingState + `columnRowGroupChanged` already enforces for grouping). */
  | {
      type: 'pivotStateChanged';
      pivotMode: boolean;
      pivotColumns: string[];
      valueColumns: Array<{ colId: string; aggFunc: string }>;
      source: 'mode' | 'set' | 'add' | 'remove' | 'move' | 'aggFunc' | 'restore';
    }
  /** Cycle 18 / Task 8a — fires when a worker chunk reports that the
   *  pivot pass would have synthesized more than `pivotMaxGeneratedColumns`.
   *  The pivot output is empty on that chunk (primary columns render
   *  normally — no half-shaped matrix). Apps listen to raise the cap,
   *  narrow the filter, or show a banner. Mirrors AG-Grid's
   *  `pivotMaxColumnsReached`. The two-field payload is what AG-Grid
   *  carries verbatim. */
  | {
      type: 'pivotMaxColumnsReached';
      generatedColumns: number;
      cap: number;
    }
  /** Fires when the set / order of displayed columns changes for any reason.
   *  Cycle 4 wired the original `columnGroupOpened` + `columnDefsChanged`
   *  sources; Cycle 6 / Task 8 widens the source union so listeners can
   *  correlate this event with the specific column-mutation that drove it. */
  | {
      type: 'displayedColumnsChanged';
      source:
        | 'columnGroupOpened'
        | 'columnDefsChanged'
        | 'columnVisible'
        | 'columnPinned'
        | 'columnMoved'
        | 'columnsReset';
    }
  /** Fires when the slice of columns materialised by horizontal virtualisation
   *  changes — typically because the user scrolled horizontally and an
   *  off-screen column slid into the body (or vice versa). Distinct from
   *  `displayedColumnsChanged`, which fires when the SET of visible columns
   *  changes (hide/pin/move/reset). `afterScroll: true` for scroll-driven
   *  triggers; `false` for resize, layout, and column-mutation triggers that
   *  also happen to shift the materialised range. Cycle 6 / Task 8. */
  | { type: 'virtualColumnsChanged'; afterScroll: boolean }
  /** Fires synchronously inside `destroy()` BEFORE any DOM removal so apps
   *  can stash a state snapshot. `state` is `{}` until Cycle 22 wires the
   *  full state-snapshot API; the event surface is shipped now so apps can
   *  start wiring listeners against a stable shape. */
  | { type: 'gridPreDestroyed'; state: Record<string, unknown> }
  /** Fires when the host (canvas-drawable) bounds actually change. Skips
   *  the initial measurement and any repaint that doesn't change the size,
   *  so it's safe to listen for as a real layout trigger. */
  | { type: 'gridSizeChanged'; width: number; height: number }
  /** Fires exactly once per grid instance — the first non-empty viewport
   *  chunk has been received and a repaint scheduled. Use for analytics
   *  ("data was rendered"), autosize-on-mount, or to flip a loading flag. */
  | { type: 'firstDataRendered' }
  /** Cycle 9 / Task 7 — fires on every cell-range mutation: drag start,
   *  drag mid-tick, drag end, and programmatic mutation. The split
   *  between `started` / `finished` mirrors ag-grid so apps can branch
   *  on the gesture phase. `ranges` is a fresh snapshot (mutating it
   *  doesn't affect selection state). For the debounced sibling that
   *  only fires once per real change, listen for `cellSelectionChanged`
   *  instead. */
  | {
      type: 'rangeSelectionChanged';
      ranges: SelectionRange[];
      /** True for the initial mousedown that begins a drag, OR for a
       *  single-step programmatic / modifier-click mutation that both
       *  starts and finishes in the same instant. */
      started: boolean;
      /** True for the mouseup that finalizes a drag, OR for every
       *  programmatic mutation (each instantaneous change is finished
       *  by definition). False during the drag-in-progress ticks. */
      finished: boolean;
    }
  /** Cycle 9 / Task 7 — debounced sibling of `rangeSelectionChanged`.
   *  Fires only when a `finished: true` mutation actually changes the
   *  set of ranges (drag mid-ticks are skipped; a finished mutation
   *  that lands on the same ranges as before is also skipped). Useful
   *  for "save selection state on change" without firing 30 times per
   *  drag. */
  | { type: 'cellSelectionChanged'; ranges: SelectionRange[] }
  /** Cycle 11 / Task 7 — fires every time a tool panel opens or closes.
   *  Hiding the WHOLE side bar via `setSideBarVisible(false)` does NOT
   *  fire this — the panel state stays intact behind the hidden bar; use
   *  `sideBarVisibleChanged` for that. Switching panels emits TWO events
   *  in close→open order, both with the same `source` (e.g. clicking a
   *  different tab while one is open produces a `visible: false` for the
   *  old panel + `visible: true` for the new, both tagged
   *  `'sideBarButtonClicked'`).
   *
   *  `source` values:
   *  - `'api'` — programmatic `openToolPanel` / `closeToolPanel` calls.
   *  - `'sideBarButtonClicked'` — user clicked a tab button.
   *  - `'sideBarInitializing'` — mount-time auto-open driven by
   *    `SideBarDef.defaultToolPanel`. Fires at most once per grid
   *    construction (never when no `defaultToolPanel` is set or the bar
   *    started under `hiddenByDefault: true`). */
  | {
      type: 'toolPanelVisibleChanged';
      key: string | null;
      visible: boolean;
      source: 'api' | 'sideBarButtonClicked' | 'sideBarInitializing';
    }
  /** Cycle 11 / Task 7 — fires when the WHOLE side bar shows or hides
   *  (i.e. `display: none` flips). Setting visibility to the current
   *  state is a no-op and does not emit. `source` is `'api'` for
   *  `setSideBarVisible` calls; `'sideBarButtonClicked'` is reserved
   *  for a future toggle button on the tab strip — Cycle 11 ships only
   *  the API path. */
  | {
      type: 'sideBarVisibleChanged';
      visible: boolean;
      source: 'api' | 'sideBarButtonClicked';
    };

export interface CGridApi {
  setRowData(rows: any[]): void;
  applyTransaction(t: Tx): TransactionResult;
  applyTransactionAsync(t: Tx): void;
  flushAsyncTransactions(): void;

  setSortModel(s: SortModel): void;
  setFilterModel(f: FilterModel): void;
  setGroupModel(g: GroupModel): void;

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: replace the
   *  entire ordered row-group column list. Equivalent to
   *  `setGroupModel({ rowGroupCols })` but routes through the
   *  GroupingState primitive so all three grouping UIs
   *  (panel / tool panel / context menu) re-render live. */
  setRowGroupColumns(columns: string[]): void;
  /** Cycle 15.5 / Task 1 — primitive grouping mutation: append
   *  `colId` to the row-group column list. No-op when the column is
   *  already grouped. */
  addRowGroupColumn(colId: string): void;
  /** Cycle 15.5 / Task 1 — primitive grouping mutation: remove
   *  `colId` from the row-group column list. No-op when the column
   *  isn't currently grouped. */
  removeRowGroupColumn(colId: string): void;
  /** Cycle 15.5 / Task 1 — primitive grouping mutation: move the
   *  column at index `from` to index `to`. `to === length` slots
   *  the column at the end of the list. The per-level sort entry
   *  travels with the column. No-op when `from === to`. */
  moveRowGroupColumn(from: number, to: number): void;
  /** Cycle 15.5 / Task 1 — primitive grouping mutation: set the
   *  per-level sort for the row-group level holding `colId`.
   *  `direction: null` clears the sort. No-op when `colId` isn't
   *  in the row-group column list. */
  setRowGroupColumnSort(colId: string, direction: 'asc' | 'desc' | null): void;
  /** Cycle 15.5 / Task 1 — snapshot of the current row-group column
   *  list in nesting order. Returns a fresh array — callers may
   *  mutate it without affecting grid state. */
  getRowGroupColumns(): string[];

  // ─── Cycle 18 / Task 3 — pivot API (ag-grid parity) ───────────────────
  /** Whether pivot mode is on. */
  isPivotMode(): boolean;
  /** Turn pivot mode on / off. A pivot only produces a matrix when at
   *  least one pivot column AND one value column are also set. */
  setPivotMode(pivotMode: boolean): void;
  /** Snapshot of the ordered pivot (Column Label) columns. Fresh array. */
  getPivotColumns(): string[];
  /** Replace the ordered pivot column list wholesale. */
  setPivotColumns(colIds: string[]): void;
  /** Append a pivot column (idempotent). */
  addPivotColumn(colId: string): void;
  /** Remove a pivot column (idempotent). */
  removePivotColumn(colId: string): void;
  /** Move a pivot column from index `from` to index `to`. */
  movePivotColumn(from: number, to: number): void;
  /** Snapshot of the ordered value columns (`{ colId, aggFunc }`). Fresh. */
  getValueColumns(): Array<{ colId: string; aggFunc: string }>;
  /** Append a value column with its aggregation (idempotent by colId). */
  addValueColumn(colId: string, aggFunc: string): void;
  /** Remove a value column (idempotent). */
  removeValueColumn(colId: string): void;
  /** Change an existing value column's aggregation function. */
  setValueColumnAggFunc(colId: string, aggFunc: string): void;

  /** Cycle 15 / Task 7 — expand every row group. Fires
   *  `expandOrCollapseAll` with `expanded: true`. No-op when grouping
   *  is bypassed (`rowGroupCols.length === 0`). */
  expandAll(): void;
  /** Cycle 15 / Task 7 — collapse every row group. Fires
   *  `expandOrCollapseAll` with `expanded: false`. No-op when grouping
   *  is bypassed. */
  collapseAll(): void;
  /** Cycle 15 / Task 7 — set a specific group's expanded state by
   *  composite key (`${col}:${value}` per level, joined by `::`).
   *  Idempotent — calling with the current state is a no-op. Fires
   *  `rowGroupOpened` with `source: 'api'` when the state actually
   *  changes. Unknown keys (a stale key from a prior group model)
   *  silently no-op. */
  setExpanded(groupKey: string, expanded: boolean): void;
  /** Cycle 15 / Task 7 — snapshot of currently-expanded composite
   *  group keys. Returns a fresh `Set` (mutations don't affect grid
   *  state). Empty when grouping is bypassed. */
  getExpandedKeys(): Set<string>;
  /** Cycle 15.5 — scroll the row at `index` into view. `position`
   *  controls where the row lands: `'auto'` (default) scrolls only when
   *  out of view, `'top'` / `'middle'` / `'bottom'` always moves it. */
  ensureIndexVisible(index: number, position?: 'auto' | 'top' | 'middle' | 'bottom'): void;
  /** Cycle 15.5 / Task 1 — reset all row groups to collapsed. */
  resetRowGroupExpansion(): void;

  /** Cycle 7 / Task 9 — read the v2 per-column filter entry for
   *  `colId`. Returns `null` when the column is unfiltered or
   *  unknown. The generic parameter lets callers narrow to a
   *  specific entry shape — `getColumnFilterModel<CTextFilterModel>(
   *  'cusip')` — without an external cast. */
  getColumnFilterModel<TModel extends CFilterModelEntry = CFilterModelEntry>(
    colId: string,
  ): TModel | null;
  /** Cycle 7 / Task 9 — apply a per-column filter mutation. Updates
   *  the canonical v2 map and ships the composed `FilterModel` to the
   *  worker. Passing `model: null` clears the column. Returns a
   *  Promise that resolves once the worker round-trip lands and the
   *  resulting `filterChanged` event has fired. */
  setColumnFilterModel(
    colId: string,
    model: CFilterModelEntry | null,
  ): Promise<void>;
  /** Cycle 7 / Task 9 — `true` when ANY filter source is active:
   *  per-column filter, quick filter, external filter, or alwaysPass
   *  (which is technically inverse but is still "filter state
   *  diverging from raw rows"). */
  isAnyFilterPresent(): boolean;
  /** Cycle 7 / Task 9 — `true` when at least one per-column filter
   *  entry is set. Does NOT consider quick / external filters. */
  isColumnFilterPresent(): boolean;
  /** Cycle 7 / Task 9 — clear the column's filter and any cached
   *  popup state (closes the popup if it's open on `colId`).
   *  Idempotent. */
  destroyFilter(colId: string): void;

  /** Cycle 4 / Task 11 (cell-flash patch) — programmatic cell flash.
   *  Useful for app-driven highlights (validation success pulse,
   *  row-just-loaded). No-op when `enableCellChangeFlash: false` or
   *  `prefers-reduced-motion: reduce`. The flash actually paints on
   *  the next viewport reply (one frame of latency for the worker
   *  round-trip). */
  flashCells(params: FlashCellsParams): void;

  /** Open the filter popup for `colId`. No-op when the column has no
   *  resolved filter, the column isn't currently in the viewport, or
   *  the popup is already open for the same column. The popup mounts
   *  beneath the column's floating-filter cell anchored via
   *  `getHeaderBoundsAt`. Cycle 7 / Task 3. */
  showColumnFilter(colId: string): void;
  /** Close any open filter popup. Idempotent. Cycle 7 / Task 3. */
  hideColumnFilter(): void;

  /** Cycle 7 / Task 8 — re-run the filter pipeline. Use after mutating
   *  any state that `options.isExternalFilterPresent` /
   *  `options.doesExternalFilterPass` close over (e.g. a toolbar
   *  checkbox toggling "show only USD"). `source` rides through to the
   *  `filterChanged` event so apps can correlate the trigger:
   *  - `'api'` (default) — programmatic re-trigger
   *  - `'columnFilter'` — per-column model mutation
   *  - `'quickFilter'` — `quickFilterText` change
   *  - `'externalFilter'` — external-filter predicate state changed
   *  Returns once the worker round-trip lands; the `filterChanged`
   *  event fires with the resolved per-column model. */
  onFilterChanged(source?: 'api' | 'quickFilter' | 'columnFilter' | 'externalFilter'): void;

  /** Scroll the row with the given ID into view. Resolves once the worker
   *  has resolved the rowId → current index (filter + sort applied). Resolves
   *  immediately when the row is not in the visible model. */
  ensureRowVisible(rowId: string, position?: 'auto' | 'top' | 'middle' | 'bottom'): Promise<void>;
  /** Scroll the column with the given ID into view. No-op for pinned columns
   *  (always visible) or unknown IDs. `'auto'` scrolls just enough; the named
   *  positions force start/middle/end alignment. */
  ensureColumnVisible(colId: string, position?: 'auto' | 'start' | 'middle' | 'end'): void;
  /** Open every ancestor group + the target group, then scroll its first
   *  visible leaf into view. No-op for unknown groupIds. */
  ensureColumnGroupVisible(groupId: string, position?: 'auto' | 'start' | 'middle' | 'end'): void;
  getSelectedRowIds(): string[];
  setSelectedRowIds(ids: string[]): void;
  /** Cycle 15 / Task 8 — aggregate selection state for `groupKey`
   *  across every descendant leaf row:
   *  - `'none'` — no descendant selected (or `groupSelectsChildren`
   *    is off / the key is unknown).
   *  - `'partial'` — some but not all descendants selected.
   *  - `'all'` — every descendant selected.
   *
   *  Snapshot read; the value is recomputed on demand from the
   *  persistent selected-rowId set and the worker's descendant cache.
   *  Apps building custom group-row UIs can hide / show / disable
   *  bulk-action menus based on this state. */
  getGroupSelectionState(groupKey: string): 'none' | 'partial' | 'all';

  /** Cycle 13 / Task 2 — current displayed (post-filter) row count.
   *  Matches `getDisplayedRowCount()` on the underlying CGrid; exposed
   *  on the public API so status-bar count panels (and any custom
   *  panel that wants the same number) can call it without reaching
   *  into the grid instance. Equal to the `visibleRowCount` last
   *  shipped via `modelUpdated`. */
  getDisplayedRowCount(): number;
  /** Cycle 13 / Task 2 — total pre-filter row count (the size of the
   *  data the grid was last seeded with, plus any add / minus any
   *  remove from `applyTransaction`). Powers
   *  `agTotalRowCountComponent` + `agTotalAndFilteredRowCountComponent`.
   *  Reads off the main-thread `rowDataById` cache, NOT a worker
   *  round-trip, so it's cheap to call from a per-frame refresh. */
  getTotalRowCount(): number;

  /** Cycle 10 / Task 3 — serialise the current `getCellRanges()` to
   *  TSV (or CSV when `clipboardDelimiter` overrides the default `\t`)
   *  on the worker, then forward the encoded string to
   *  `navigator.clipboard.writeText`. Resolves once the clipboard
   *  write succeeds. Rejects when:
   *  - no range is selected (no-op result; rejects with `'no-ranges'`)
   *  - the Async Clipboard API is unavailable (e.g. insecure context
   *    without a polyfill — the keyboard handler runs inside the user
   *    gesture so this is the only realistic reject path)
   *  - the clipboard write rejects (browser permission denial, no user
   *    gesture stack — apps invoking this from a `setTimeout` should
   *    expect this)
   *
   *  Backs both the Ctrl+C shortcut and the default `Copy` context-menu
   *  item. Apps that ship their own clipboard layer set
   *  `suppressClipboardApi: true` (Task 6) so this becomes a no-op. */
  copySelectedRangesToClipboard(): Promise<void>;

  /** Cycle 10 / Task 4 — read the system clipboard, parse the payload
   *  (TSV by default; CSV when `clipboardDelimiter` overrides) on the
   *  worker, and apply via `applyTransaction({ update: [...] })`
   *  rooted at the focused cell. When the parsed grid extends past
   *  the focused cell's column band, it pastes into the next visible
   *  columns to the right and the next visible rows below.
   *
   *  No-op (resolves without writing) when:
   *  - no cell is currently focused
   *  - the clipboard payload is empty
   *  - `suppressClipboardPaste === true` (Task 6 wires this gate)
   *
   *  Rejects when `navigator.clipboard.readText` rejects (no user
   *  gesture / permission denial / insecure context). Backs both the
   *  Ctrl+V shortcut and the default `Paste` context-menu item. */
  pasteFromClipboard(): Promise<void>;

  /** Cycle 10 / Task 5 — combination of `copySelectedRangesToClipboard`
   *  and a clear-update over the source cells. The clipboard write
   *  fires first; only if it succeeds does the clear `applyTransaction`
   *  follow. Resolves once both legs complete. Rejects when:
   *  - no range is selected (`'no-ranges'`)
   *  - `copySelectedRangesToClipboard` rejects (the source cells stay
   *    untouched — no partial-cut state)
   *
   *  Cleared cells are written through `valueSetter` when the column
   *  defines one, falling back to direct field assignment of `''`.
   *  Backs both the Ctrl+X shortcut and the default `Cut` context-menu
   *  item. */
  cutSelectedRanges(): Promise<void>;

  /** Snapshot of the currently-selected cell ranges. Returns a fresh
   *  array; mutating it does NOT affect grid state. Empty when no
   *  range is active. Cycle 9 / Task 6. */
  getCellRanges(): SelectionRange[];
  /** Append a range to the current selection. Existing ranges stay —
   *  this is the disjoint-add path, mirroring ctrl/cmd-click semantics.
   *  Cycle 9 / Task 6. */
  addCellRange(range: SelectionRange): void;
  /** Drop every range. Row selection and the focused cell are
   *  unaffected. No-op when no range is active. Cycle 9 / Task 6. */
  clearCellRanges(): void;

  getFocusedCell(): { rowId: string; colId: string } | null;
  setFocusedCell(rowId: string, colId: string): void;

  refresh(): void;
  setTheme(themeClass: string): void;
  destroy(): void;

  getColumnGroupState(): { groupId: string; open: boolean }[];
  setColumnGroupState(state: { groupId: string; open: boolean }[]): void;
  resetColumnGroupState(): void;

  /** Cycle 11 / Task 5 — call `refresh()` on the live `ToolPanel`
   *  instance for `id`. Silent no-op when:
   *  - `id` is unknown (not registered in `CGridOptions.components` and
   *    not one of the built-in IDs);
   *  - no side bar is configured;
   *  - the matching panel is registered but not currently mounted
   *    (i.e. the user has not opened it via `openToolPanel(id)` or a
   *    tab click). Panels are only instantiated on open and destroyed
   *    on close, so a panel that has never been opened has no
   *    instance for `refresh()` to fire on.
   *
   *  Works for both built-in panels (`'agColumnsToolPanel'`,
   *  `'agFiltersToolPanel'`) and app-supplied custom panels keyed by
   *  the same `id` they registered under in `CGridOptions.components`. */
  refreshToolPanel(id: string): void;
  /** Cycle 11 / Task 5 — the live `ToolPanel` instance for `id`, or
   *  `null` when no instance is currently mounted (panel never opened,
   *  `id` unknown, or no side bar configured). Apps reach for this to
   *  invoke panel-specific methods that aren't part of the `ToolPanel`
   *  interface — e.g. a custom panel might expose `expandAll()` or
   *  `selectColumn(colId)`. Treat the returned instance as a borrowed
   *  reference: it stops being valid the moment the user closes the
   *  panel (the host calls `destroy()` and drops the reference). */
  getToolPanelInstance(id: string): ToolPanel | null;

  /** Cycle 11 / Task 6 — `true` when the side bar is currently
   *  visible (mounted AND not in `display: none`). Returns `false`
   *  when no side bar is configured, when `SideBarDef.hiddenByDefault`
   *  is `true`, or after `setSideBarVisible(false)`. */
  isSideBarVisible(): boolean;
  /** Cycle 11 / Task 6 — show or hide the whole side bar. Silent
   *  no-op when no side bar is configured. Triggers one canvas
   *  reflow on visibility change so the canvas region grows or
   *  shrinks to fill the released / reclaimed gutter. */
  setSideBarVisible(show: boolean): void;
  /** Cycle 11 / Task 6 — move the side bar to the left or right edge.
   *  Silent no-op when no side bar is configured. Releases the old
   *  edge reservation + claims the new one in one synchronous resize.
   *  The resolved position is observable through `getSideBar().position`. */
  setSideBarPosition(pos: 'left' | 'right'): void;
  /** Cycle 11 / Task 6 — open the tool panel with the given `id`.
   *  Silent no-op when no side bar is configured or when `id` is not
   *  one of the registered panels. Closes any previously-open panel
   *  first — only one panel is open at a time. Works for built-in ids
   *  (`agColumnsToolPanel`, `agFiltersToolPanel`) and app-supplied
   *  custom ids from `CGridOptions.components`. */
  openToolPanel(id: string): void;
  /** Cycle 11 / Task 6 — close the currently open tool panel. Silent
   *  no-op when no side bar is configured or no panel is open. The
   *  host destroys the live `ToolPanel` instance so panels can't leak
   *  listeners; `getToolPanelInstance(id)` returns `null` afterwards. */
  closeToolPanel(): void;
  /** Cycle 11 / Task 6 — the id of the currently open panel, or
   *  `null` when no panel is open / no side bar is configured. */
  getOpenedToolPanel(): string | null;
  /** Cycle 11 / Task 6 — the resolved `SideBarDef` (string shortcuts
   *  expanded into full `ToolPanelDef` objects, `position` defaulted
   *  to `'right'` when not specified), or `undefined` when no side
   *  bar was configured on this grid. The returned object reflects
   *  the LIVE def — `setSideBarPosition` mutations are observable
   *  via the `position` field on subsequent reads. */
  getSideBar(): SideBarDef | undefined;

  /** Cycle 13 / Task 4 — the live `IStatusPanelComp` instance for
   *  `key`, or `undefined` when no status bar is configured, `key`
   *  is unknown, or the matching panel never resolved a ctor (the
   *  `statusPanel` string referenced an unregistered component). The
   *  generic parameter `T` lets apps narrow the return to a custom
   *  panel's concrete class to call panel-specific methods that
   *  aren't on the `IStatusPanelComp` interface — e.g. a custom
   *  panel might expose `getSnapshot()` or `setRange(r)`. Treat the
   *  returned instance as a borrowed reference: it stops being valid
   *  the moment the status bar is destroyed or replaced via
   *  `setStatusBarDef` (the host calls `destroy()` and drops the
   *  reference).
   *
   *  Built-in keys (`'agTotalRowCountComponent'`,
   *  `'agFilteredRowCountComponent'`, `'agSelectedRowCountComponent'`,
   *  `'agTotalAndFilteredRowCountComponent'`, `'agAggregationComponent'`)
   *  and custom keys registered via `CGridOptions.components` are
   *  both reachable through this surface. */
  getStatusPanel<T extends IStatusPanelComp = IStatusPanelComp>(key: string): T | undefined;

  /** Read the current value of any grid option. */
  getGridOption<K extends keyof CGridOptions>(key: K): CGridOptions[K] | undefined;
  /** Update a single runtime-mutable option. Throws on initial-only keys
   *  (see `INITIAL_ONLY_OPTIONS` in `core/runtimeOptions.ts`). */
  setGridOption<K extends keyof CGridOptions>(key: K, value: CGridOptions[K]): void;
  /** Batch-update multiple runtime-mutable options. The `columnDefs` key is
   *  honored only via this batched entrypoint (not via `setGridOption`)
   *  because it rebuilds the column tree + worker column metadata. */
  updateGridOptions(partial: Partial<CGridOptions>): void;

  /** Register a custom cell renderer under `name`. Columns referencing the
   *  name via `cellRenderer` (or a `cellRendererSelector` return value)
   *  will dispatch to `painter` at paint time. Built-in names ('text',
   *  'number', 'checkbox', 'header') can be overridden by re-registering. */
  registerCellRenderer(name: string, painter: import('./renderer/cellRenderers/registry').CellPainter): void;

  /** Register a custom cell editor under `name`. Columns referencing it via
   *  `cellEditor: name` will mount this editor when edit starts. Built-in
   *  names ('text' shipped in Cycle 5 Task 1; 'number' / 'date' / 'select' /
   *  'largeText' / 'checkbox' / 'dateString' in Task 2) can be overridden. */
  registerCellEditor(name: string, ctor: CellEditorCtor): void;

  /** Register a custom comparator under `name`. Column defs reference the
   *  registered comparator via `comparator: name`. The function
   *  string-serialises through `Function.prototype.toString()` and
   *  reconstructs on the worker via `new Function(...)` so the sort
   *  stays off the main thread; the function MUST be pure and may not
   *  close over external scope (closures don't survive the
   *  reconstruction). Re-registering overwrites. Returns a Promise that
   *  resolves once the worker acknowledges the registration; awaiting
   *  it before the next `setSortModel` guarantees the sort uses the
   *  registered comparator instead of falling back to the default
   *  text/number compare. Cycle 8 / Task 3. */
  registerComparator<TValue = unknown>(
    name: string,
    fn: (a: TValue, b: TValue) => number,
  ): Promise<void>;

  /** Programmatically start editing the cell at `(rowIndex, colId)`.
   *  No-op when the cell is not editable or not in the current viewport. */
  startEditingCell(rowIndex: number, colId: string): void;
  /** Close any active editor. `cancel=true` discards the new value; default
   *  commits it through `valueParser → valueSetter` like Enter / Tab. */
  stopEditing(cancel?: boolean): void;

  /** Subscribe to a typed event. Returns an unsubscribe function. */
  on<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): () => void;
  /** Remove a previously-registered listener. */
  off<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): void;
  /** Alias for `on()`, present for ag-grid API parity. */
  addEventListener<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): () => void;
  /** Alias for `off()`, present for ag-grid API parity. */
  removeEventListener<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): void;

  /** Move the leaf at `fromIndex` to `toIndex` in the flat visible-leaf
   *  order. No-op when `fromIndex === toIndex` or either index is out of
   *  range. Honors `lockPosition` + `marryChildren` — illegal moves clamp
   *  to the nearest legal index, NOT throw. Fires `columnMoved` with
   *  `source: 'api'`. Cycle 6 / Task 1. */
  moveColumnByIndex(fromIndex: number, toIndex: number): void;

  /** Show or hide every listed column in one batch. Unknown keys + columns
   *  marked `lockVisible: true` are silently dropped. Mutates
   *  `columnDefsMap` in place through ONE re-layout + repaint and emits
   *  one `columnVisible` event whose `colIds` is the list that actually
   *  changed (`source: 'api'`). No-op when no column's `hide` state
   *  actually flips. Cycle 6 / Task 5. */
  setColumnsVisible(keys: string[], visible: boolean): void;

  /** Pin or unpin every listed column in one batch. Pass `null` to unpin.
   *  Unknown keys + columns marked `lockPinned: true` are silently
   *  dropped. Mutates `columnDefsMap` in place through ONE re-layout +
   *  repaint and emits one `columnPinned` event whose `colIds` is the
   *  list that actually changed (`source: 'api'`). Cycle 6 / Task 5. */
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;

  /** Set explicit pixel widths for the listed columns in one batch. Each
   *  width is clamped to the column's resolved `minWidth` / `maxWidth`.
   *  Unknown keys are silently dropped. Mutates `columnDefsMap` in place
   *  through ONE re-layout + repaint and fires one `columnResized` per
   *  changed column with `source: 'api'`. The `finished` flag defaults
   *  to `true` (one save per call) but app code can pass `false` for the
   *  in-progress tick of a custom resize gesture. Cycle 6 / Task 5. */
  setColumnWidths(
    columnWidths: Array<{ key: string; newWidth: number }>,
    finished?: boolean,
  ): void;

  /** Move every listed column to start at `toIndex` in the flat visible-
   *  leaf order, preserving their declaration order. `lockPosition` +
   *  `marryChildren` still apply — illegal targets clamp to the nearest
   *  legal index. Unknown keys are silently dropped. Fires one
   *  `columnMoved` event per moved column with `source: 'api'`. Cycle 6 /
   *  Task 5. */
  moveColumns(keys: string[], toIndex: number): void;

  /** Serialisable snapshot of every leaf's mutable state (width, hide,
   *  pinned, sort, sortIndex, flex, plus reserved rowGroup / pivot /
   *  aggFunc slots) in the current flat-leaf order — hidden leaves
   *  included. Pair with `applyColumnState` for layout persistence.
   *  Cycle 6 / Task 2. */
  getColumnState(): CColumnState[];
  /** Returns the resolved `headerName` for `colId`, or `undefined` when
   *  the column is unknown or has no `headerName` set. Mirrors ag-grid's
   *  `getDisplayNameForColumn` for the labelling needs of the side-bar
   *  tool panels (Cycle 11 / Task 3) without forcing them to crack open
   *  the internal `columnDefsMap`. Hidden leaves still resolve — the
   *  Columns panel lists hidden columns with their headerName intact. */
  getColumnHeaderName(colId: string): string | undefined;
  /** Cycle 15.5 / Task 2 — `true` when the column's resolved colDef
   *  carries `enableRowGroup: true`. Used by the columns tool panel's
   *  Row Groups drop zone (decides which column-list rows offer a
   *  drag-to-group affordance) AND by the header context menu (gates
   *  the "Group by `<col>`" item visibility). Returns `false` for
   *  unknown colIds. */
  isColumnRowGroupEnabled(colId: string): boolean;
  /** Cycle 18 / Task 5 — `true` when the column's resolved colDef carries
   *  `enablePivot: true`. Gates whether the columns tool panel + context
   *  menu let a user assign the column as a pivot (Column Label). Returns
   *  `false` for unknown colIds. */
  isColumnPivotEnabled(colId: string): boolean;
  /** Cycle 18 / Task 5 — `true` when the column's resolved colDef carries
   *  `enableValue: true`. Gates whether the columns tool panel + context
   *  menu let a user assign the column as a Values measure. Returns
   *  `false` for unknown colIds. */
  isColumnValueEnabled(colId: string): boolean;
  /** Cycle 15.5 / Task 2 (gap-fill) — `true` when the row group panel
   *  is mounted AND the viewport-coord point `(clientX, clientY)` falls
   *  inside its DOM rect.  Exposed on the public API so external drag
   *  sources (e.g. the columns tool panel column-list row drag) can route
   *  through the same row-group-panel acceptance path that column-header
   *  drags use via the `ColumnDrag` feature chain. */
  isPointInRowGroupPanel?(clientX: number, clientY: number): boolean;
  /** Cycle 15.5 / Task 2 (gap-fill) — inform the row group panel of an
   *  in-progress drag from an external source.  Pass `colId: null` to
   *  clear any hover state (e.g. on mouse-leave or drag-end). */
  setRowGroupPanelDragHover?(colId: string | null, clientX: number, clientY: number): void;
  /** Cycle 15.5 / Task 2 (gap-fill) — commit a column-list drag drop
   *  into the row group panel.  Returns `true` when the column was
   *  appended to `rowGroupColumns`, `false` when rejected (column
   *  already grouped or `enableRowGroup` not set). */
  commitRowGroupPanelDrop?(colId: string): boolean;
  /** Cycle 18 / Task 6 — `true` when the pivot panel is mounted AND
   *  the viewport-coord point `(clientX, clientY)` falls inside its
   *  DOM rect AND the panel currently accepts drops (`'always'` always
   *  accepts; `'onlyWhenPivoting'` accepts only when pivot is active).
   *  Exposed on the public API so external drag sources (column-header
   *  drags from the grid, columns tool panel column-list row drags)
   *  can route through the same pivot-panel acceptance path. */
  isPointInPivotPanel?(clientX: number, clientY: number): boolean;
  /** Cycle 18 / Task 6 — inform the pivot panel of an in-progress drag
   *  from an external source. Pass `colId: null` to clear any hover
   *  state (e.g. on mouse-leave or drag-end). */
  setPivotPanelDragHover?(colId: string | null, clientX: number, clientY: number): void;
  /** Cycle 18 / Task 6 — commit an external drag drop into the pivot
   *  panel. Returns `true` when the column was appended to
   *  `pivotColumns`, `false` when rejected (column already pivoted or
   *  `enablePivot` not set). */
  commitPivotPanelDrop?(colId: string): boolean;
  /** True when (clientX, clientY) is within the leaf column-header band.
   *  Used by external drag sources (e.g. Columns tool panel) to decide
   *  whether the cursor is hovering over the column-header strip. */
  isPointInColumnHeaderBand?(clientX: number, clientY: number): boolean;
  /** Inform the column-header area of an external drag hover.  Paints
   *  an insertion line at the nearest column gap.  Pass `colId=null`
   *  to clear (e.g. on drag-end or drag-leave). */
  setColumnHeaderDragHover?(colId: string | null, clientX: number, clientY: number): void;
  /** Commit an external drop onto the column-header area: moves `colId`
   *  to the nearest legal column position at `clientX`. */
  commitColumnHeaderDrop?(colId: string, clientX: number): void;
  /** Cycle 11 / Task 4 — the resolved popup-filter type for `colId`, or
   *  `null` when the column is unknown or has no filter. Used by the
   *  FiltersToolPanel to decide which columns get a collapsible row. */
  getColumnFilterType(colId: string): 'text' | 'number' | 'date' | 'set' | null;
  /** Cycle 11 / Task 4 — build the filter editor for `colId` for inline
   *  hosting (FiltersToolPanel). Returns a handle that owns the editor's
   *  GUI element + a `destroy` callback for teardown. The caller mounts
   *  the returned GUI element into its own DOM container. Resolves
   *  `null` when the column has no filter, is unknown, or the grid is
   *  destroyed before the async distinct-values fetch (set filter)
   *  completes. Mutations propagate via the same
   *  `setColumnFilterModel` path the popup uses. */
  buildColumnFilterEditor(colId: string): Promise<{
    gui: HTMLElement;
    destroy(): void;
  } | null>;
  /** Restore column state. Returns `true` when every `state[].colId`
   *  matched a known leaf; `false` when at least one entry was dropped.
   *  Mutates `columnDefsMap` in place through a single re-layout +
   *  repaint cycle. Honors `lockVisible` / `lockPinned` — locked
   *  mutations are silently dropped. Fires `columnMoved` /
   *  `columnVisible` / `columnPinned` / `columnResized` / `sortChanged`
   *  with `source: 'columnState'` for each changed slot. Cycle 6 /
   *  Task 2. */
  applyColumnState(params: CApplyColumnStateParams): boolean;
  /** Restore the construction-time column-state snapshot. Fires
   *  `columnsReset`, then the per-slot change events with
   *  `source: 'columnState'`. Cycle 6 / Task 2. */
  resetColumnState(): void;

  /** Distribute the container width across the visible non-suppressed
   *  leaves. Flex columns prefer their flex weight; non-flex columns
   *  prefer their current width as a starting share. Per-column min/max
   *  win over the param-level defaults; `columnLimits` overrides both.
   *  `suppressSizeToFit: true` columns hold their current width. Fires
   *  one `columnResized` per changed leaf with `finished: true` and
   *  `source: 'sizeColumnsToFit'`. Cycle 6 / Task 3. */
  sizeColumnsToFit(params?: ISizeColumnsToFitParams): void;

  /** Resize the named columns to fit their widest visible content. Awaits
   *  a worker round-trip — the worker walks the active chunk (sampling
   *  head 2,500 + tail 2,500 rows when the row count exceeds 5,000),
   *  measures every cell with the column's font, and returns the max
   *  text width + per-cell padding. Main clamps to `minWidth` / `maxWidth`,
   *  applies widths atomically, repaints once, and fires one
   *  `columnResized` per changed leaf with `finished: true` and
   *  `source: 'autosizeColumns'`. `suppressAutoSize: true` columns are
   *  excluded. `skipHeader` defaults to false (header label is included
   *  in the max). Cycle 6 / Task 4. */
  autoSizeColumns(keys: string[], skipHeader?: boolean): Promise<void>;
  /** Equivalent to `autoSizeColumns(allVisibleNonSuppressedColIds,
   *  skipHeader)`. Cycle 6 / Task 4. */
  autoSizeAllColumns(skipHeader?: boolean): Promise<void>;

  /** Returns the on-screen pixel bounds of the cell at (`rowIndex`, `colId`)
   *  in the canvas's coordinate space. Returns `null` when the cell is not
   *  in the current viewport. Used by E2E to position synthetic clicks. */
  getCellBoundsAt(rowIndex: number, colId: string): { x: number; y: number; w: number; h: number } | null;
  /** Returns the on-screen pixel bounds of the leaf header at `colId`,
   *  or `null` when the column is not currently in the viewport. The
   *  rectangle spans the column's full leaf-header band — y is the leaf
   *  header's top, h is the leaf header's height. Used by Cycle 6 E2Es
   *  to position synthetic drag gestures. */
  getHeaderBoundsAt(colId: string): { x: number; y: number; w: number; h: number } | null;
  /** Returns the vertical pixel bounds (top + height) of the data row at
   *  `rowIndex`. `null` when the row isn't currently visible. Useful for
   *  asserting variable-height row layouts in E2E without a per-column
   *  lookup. Cycle 5 / Task 6. */
  getRowBoundsAt(rowIndex: number): { y: number; h: number } | null;
  /** Returns the raw value of the cell at (`rowIndex`, `colId`) from the
   *  current viewport chunk, or `null` when the cell is not in the chunk. */
  getCellValue(rowIndex: number, colId: string): unknown;

  /**
   * Returns the resolved background color that would be painted for the cell
   * at (`rowIndex`, `colId`), accounting for `cellClass`, `cellClassRules`,
   * and the function-form `cellStyle`. Returns `null` when the column is
   * unknown or the row is not in the current viewport chunk.
   *
   * Used by E2E tests to assert visual differentiation without reading canvas
   * pixels. Cycle 6 / Task 7.
   */
  getCellPaintedBg(rowIndex: number, colId: string): string | null;
}
