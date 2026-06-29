import type {
  CColDef, CValueGetterParams, CValueFormatterParams, ColCellOverrides,
  CCellRendererSelector, CValueParserParams, CValueSetterParams,
  CellEditorCtor, EditableCallback, SuppressKeyboardEventCallback,
  CellClass, CellClassRules, CellStyleFunc, HeaderClass,
} from '../types';
import type { CellPaintConfig } from '../renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../theming/cssReader';

export type { ColCellOverrides };

/** Pre-compiled entry for one `cellClassRules` predicate. Allocated once in
 *  `resolveColDef`; zero allocation per paint call. Cycle 6 / Task 7. */
interface CompiledClassRule {
  className: string;
  predicate: (params: { data: unknown; value: unknown; colId: string; rowIndex: number }) => boolean;
}

export interface ResolvedColDef<TRow = any> {
  colId: string;
  field?: keyof TRow & string;
  headerName: string;
  width?: number;
  flex?: number;
  minWidth: number;
  maxWidth: number;
  pinned?: 'left' | 'right';
  /**
   * Resolved cell data type — `'text'` or `'number'`. Drives the default
   * `cellRenderer` + the default halign. Cycle 6 / Task 6 replaces the
   * previous `type: 'text' | 'number'` slot with this canonical field;
   * `CColDef.type` is now `string | string[]` referring to
   * `CGridOptions.columnTypes` bundle names.
   */
  cellDataType: 'text' | 'number';
  valueGetter?: (params: CValueGetterParams<TRow>) => unknown;
  valueFormatter?: (params: CValueFormatterParams<TRow, unknown>) => string;
  cellRenderer: string;
  /** Static params forwarded to the painter as `CellPaintConfig.params`. */
  cellRendererParams?: unknown;
  /** Per-cell renderer selector (see `CCellRendererSelector`). */
  cellRendererSelector?: CCellRendererSelector<TRow>;
  /** Either a registered comparator name (string — preferred, runs
   *  worker-side) or an inline closure (throws at `setSortModel` time
   *  because closures don't cross `postMessage`). Cycle 8 / Task 3
   *  widened the field; the original closure shape is preserved so the
   *  surface only widens, never narrows. */
  comparator?: string | ((a: unknown, b: unknown, ar: TRow, br: TRow) => number);
  filter?: 'text' | 'number' | 'date' | 'set';
  /** Per-column override of `CGridOptions.floatingFilter`. `undefined` means
   *  inherit the grid-level value at `rebuildSubgridStack` time. The
   *  floating-filter overlay reads this on every `repositionAll`; explicit
   *  `false` collapses to "no input for this column". Cycle 7 / Task 1. */
  floatingFilter?: boolean;
  /** Filter popup UI params (buttons / closeOnApply / debounceMs /
   *  readOnly). Tasks 3-9 each consume the relevant subset. Cycle 7 /
   *  Task 3. */
  filterParams?: import('../types').CFilterParams;
  /** See `CColDef.suppressFloatingFilterButton`. Cycle 7 / Task 1
   *  reserved the field; Task 3 starts honouring it to suppress the
   *  expand button on the floating-filter cell. */
  suppressFloatingFilterButton: boolean;
  /** See `CColDef.aggFunc`. Cycle 14 / Task 3 widened from the built-in
   *  union to `string | string[]` so custom registry names (and the
   *  array fallback form) flow through to the worker. */
  aggFunc?: string | string[];
  /** See `CColDef.suppressAggFuncInHeader`. `undefined` means inherit the
   *  grid-level `CGridOptions.suppressAggFuncInHeader`; explicit `true`
   *  / `false` wins regardless of the grid-level value. Cycle 14 / Task 4. */
  suppressAggFuncInHeader?: boolean;
  /** See `CColDef.totalsCellRenderer`. Per-column override of the cell
   *  renderer used for this column's cell on the totals row. `undefined`
   *  falls through to the built-in `'totals'` renderer. Cycle 14 / Task 5. */
  totalsCellRenderer?: string;
  sortable: boolean;
  /** See `CColDef.accentedSort`. When `true`, the worker's `SortPass`
   *  routes this column's text compares through `Intl.Collator`.
   *  Cycle 8 / Task 5. */
  accentedSort?: boolean;
  /** See `CColDef.unSortIcon`. When `true`, the header painter draws a
   *  faint up/down chevron pair on sortable columns that aren't
   *  currently sorted. Cycle 8 / Task 5. */
  unSortIcon?: boolean;
  /** See `CColDef.sortGroupRowsByKey`. When `true` AND this column is
   *  one of the `rowGroupCols`, the group-level sort uses the cheap
   *  composite-key string compare even when the column has a
   *  registered `comparator` / `accentedSort`. Has no effect on
   *  within-bucket (leaf-row) sorting. Cycle 15 / Task 11. */
  sortGroupRowsByKey?: boolean;
  resizable: boolean;
  editable: boolean | EditableCallback<TRow, unknown>;
  /** Per-column override of grid-level `singleClickEdit`. Undefined =
   *  inherit from grid options. */
  singleClickEdit?: boolean;
  /** Per-column key-event short-circuit. Mirrors
   *  `CColDef.suppressKeyboardEvent`. */
  suppressKeyboardEvent?: SuppressKeyboardEventCallback<TRow>;
  /** Built-in editor key or a custom `ICellEditor` constructor. See
   *  `CColDef.cellEditor` in `types.ts` for full semantics. */
  cellEditor?: string | CellEditorCtor<TRow, unknown>;
  /** Static params or callback forwarded into `ICellEditorParams.params`. */
  cellEditorParams?: Record<string, unknown> | ((row: TRow) => Record<string, unknown>);
  /** Object-form cell style override. Applied after class-driven variants;
   *  `cellStyleFn` (function form) takes even higher precedence. Cycle 6 / Task 7. */
  cellStyle?: ColCellOverrides;
  /**
   * Compiled static cell class names. Resolved from `CColDef.cellClass` at
   * `resolveColDef` time when it is a static string or string[]. Stored as a
   * pre-allocated array so the hot paint path pays zero allocation. When
   * `CColDef.cellClass` is a function, `cellClassFn` is used instead.
   * Cycle 6 / Task 7.
   */
  cellClassStatic?: string[];
  /**
   * Function-form `CColDef.cellClass`. Called per cell to return class names.
   * Mutually exclusive with `cellClassStatic` (the resolver stores one or the
   * other). Cycle 6 / Task 7.
   */
  cellClassFn?: (params: { data: unknown; value: unknown; colId: string; rowIndex: number }) => string | string[] | undefined;
  /**
   * Pre-compiled `cellClassRules` entries. Each entry is a `{ className,
   * predicate }` pair; at paint time we iterate this array, call the
   * predicate, and collect matched class names. Allocated once in
   * `resolveColDef`; zero allocation per paint. Cycle 6 / Task 7.
   */
  cellClassRules?: CompiledClassRule[];
  /**
   * Function-form `cellStyle`. Applied after class-driven variants; highest
   * precedence among all style mechanisms. Cycle 6 / Task 7.
   */
  cellStyleFn?: CellStyleFunc;
  /**
   * Pre-compiled header class resolver. Parallel to `cellClassStatic` /
   * `cellClassFn` but for header cells. Applied through
   * `theme.headerClassVariants`. Cycle 6 / Task 7.
   */
  headerClassStatic?: string[];
  /**
   * Function-form `headerClass`. Called once per header cell paint.
   * Cycle 6 / Task 7.
   */
  headerClassFn?: (params: { colId: string }) => string | string[] | undefined;
  /** See `CColDef.autoHeight`. When true, the worker measures wrapped-text
   *  height for every visible row in this column and contributes the result
   *  into the row's resolved height. Cycle 5 / Task 8. */
  autoHeight?: boolean;
  /** See `CColDef.wrapText`. When true, the cell renderer paints multi-line
   *  wrapped text. Auto-selects the `'text-wrap'` renderer when no
   *  `cellRenderer` is set explicitly. Cycle 5 / Task 9. */
  wrapText?: boolean;
  /** See `CColDef.valueParser`. Invoked at editor-commit time before the
   *  worker transaction is queued. */
  valueParser?: (params: CValueParserParams<TRow, unknown>) => unknown;
  /** See `CColDef.valueSetter`. Mutates `data` in place. */
  valueSetter?: (params: CValueSetterParams<TRow, unknown>) => boolean | void;
  /** `null` when the leaf is always visible; `'open'` / `'closed'` only when
   *  the parent column group is in that state. Resolved by
   *  `resolveVisibleLeaves` in `core/columnGroupState.ts`. */
  columnGroupShow: 'open' | 'closed' | null;
  /** See `CColDef.suppressMovable`. Resolved to `false` when unset. */
  suppressMovable: boolean;
  /** See `CColDef.lockPosition`. `null` for free; `'left'` / `'right'`
   *  pin the leaf to the start / end of the flat visible-leaf order. */
  lockPosition: 'left' | 'right' | null;
  /** See `CColDef.hide`. `true` excludes the leaf from the visible-leaf
   *  order. `false` (default) keeps it visible. Mutated in place by
   *  `applyColumnState`. Cycle 6 / Task 2. */
  hide: boolean;
  /** See `CColDef.lockVisible`. When true, `applyColumnState` +
   *  `setColumnsVisible` silently drop any mutation that would flip
   *  `hide`. Cycle 6 / Task 2. */
  lockVisible: boolean;
  /** See `CColDef.lockPinned`. When true, `applyColumnState` +
   *  `setColumnsPinned` silently drop any mutation that would change
   *  `pinned`. Cycle 6 / Task 2. */
  lockPinned: boolean;
  /** See `CColDef.suppressSizeToFit`. When true, the column's width is
   *  held during `sizeColumnsToFit` and the remaining columns absorb the
   *  container width. Cycle 6 / Task 3. */
  suppressSizeToFit: boolean;
  /** See `CColDef.suppressAutoSize`. When true, `autoSizeColumns` /
   *  `autoSizeAllColumns` skip this column. Cycle 6 / Task 4. */
  suppressAutoSize: boolean;
  /** See `CColDef.enableRowGroup`. When `true`, the column header
   *  can be dragged into the row group panel to append this column
   *  to `rowGroupCols`. `false` (default) rejects the panel drop;
   *  the imperative `setGroupModel` API still works regardless.
   *  Cycle 15 / Task 6. */
  enableRowGroup: boolean;
  /** See `CColDef.enablePivot`. When `true`, the column header
   *  can be dragged into the Column Labels drop zone (or the pivot
   *  panel, when wired) to add the column to `pivotColumns`. `false`
   *  (default) rejects the drop; the imperative `setPivotColumns` /
   *  `addPivotColumn` API still works regardless. Cycle 18 / Task 5. */
  enablePivot: boolean;
  /** See `CColDef.enableValue`. When `true`, the column header can
   *  be dragged into the Values drop zone to add the column as a
   *  measure under pivot. `false` (default) rejects the drop; the
   *  imperative `addValueColumn` API still works regardless.
   *  Cycle 18 / Task 5. */
  enableValue: boolean;
  /** See `CColDef.initialSort`. Resolved value is the column's
   *  construction-time seed; the cgrid layer reads it once to build the
   *  initial sort model and never re-reads it. Cycle 8 / Task 2. */
  initialSort?: 'asc' | 'desc';
  /** See `CColDef.initialSortIndex`. Read once at construction alongside
   *  `initialSort`. Cycle 8 / Task 2. */
  initialSortIndex?: number;
  /** Reserved Cycle-13/14/17 slots. Round-trip opaquely through
   *  `getColumnState` / `applyColumnState` until those cycles wire the
   *  model logic. */
  rowGroup?: boolean;
  rowGroupIndex?: number | null;
  pivot?: boolean;
  pivotIndex?: number | null;
}

export interface ApplyCellPropsInput {
  theme: ResolvedTheme;
  colDef: ResolvedColDef;
  value: unknown;
  valueFormatted: string;
  x: number; y: number; w: number; h: number;
  rowBg: string;
  prefillColor: string;
  isFocused: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isHeader: boolean;
  /** Cycle 14 / Task 1 — set to `true` when this cell sits on the
   *  pinned totals row. Triggers the design-pass "lift" treatment:
   *  fg = `theme.totalsFg`, font weight bumped to
   *  `theme.totalsFontWeight` (default 500). Defaults to `false`.
   *  Optional so legacy callers don't have to be updated. */
  isTotals?: boolean;
  /** Cycle 15 / Task 12 — set to `true` when this cell sits on a
   *  per-group footer row (`chunk.rowKinds[i] === 3`). Same lift
   *  treatment as `isTotals` but reads from the `--cg-group-footer-*`
   *  token family, so apps can dial the per-group footer chrome down
   *  independently of the grand-total row. Defaults to `false`.
   *  Mutually exclusive with `isTotals` — a row is either a footer
   *  inside the DataSubgrid (this flag) OR a grand total in
   *  `TotalsSubgrid` (the existing flag), never both. */
  isGroupFooter?: boolean;
  iconColor?: string;
  sortDirection?: 'asc' | 'desc';
  /** Cycle 8 / Task 1 — 1-indexed sort position; threaded into the
   *  resulting `CellPaintConfig.sortIndex` so the header painter can
   *  draw a multi-sort order badge. */
  sortIndex?: number;
  /** Cycle 8 / Task 1 — total entries in the current sort model. The
   *  header painter skips the badge entirely when this is `<= 1`. */
  sortTotal?: number;
  /** Cycle 8 / Task 5 — opt-in marker that the column wants a faint
   *  up/down chevron pair painted in the header when no active sort
   *  direction is set. Mirrors `CColDef.unSortIcon`. Threaded straight
   *  into `CellPaintConfig.unSortIcon`. */
  unSortIcon?: boolean;
  /** Cycle 8 / Task 5 — resolved color for the faint `unSortIcon`
   *  chevron pair (from `ResolvedTheme.unsortIconColor`). Threaded
   *  straight into `CellPaintConfig.unSortIconColor`. */
  unSortIconColor?: string;
  flashAlpha?: number;
  /** Resolved per-cell renderer params (see `CellPaintConfig.params`). */
  params?: unknown;
  /**
   * Row data snapshot for this row. Used by `cellClassRules` predicates and
   * the function-form `cellStyle` / `cellClass` callbacks. Resolved once per
   * row in the painter (not per cell) via `rowDataSnapshotAt`. Pass
   * `undefined` for header rows. Cycle 6 / Task 7.
   */
  rowData?: Record<string, unknown>;
  /**
   * Row index in the data subgrid. Required for `cellClassRules` predicate
   * params; defaults to `0` when omitted (header use). Cycle 6 / Task 7.
   */
  rowIndex?: number;
  /**
   * Pre-resolved class names from the *group*'s `headerClass` field. When
   * present and `isHeader === true`, these are looked up in
   * `theme.headerClassVariants` instead of the leaf col's
   * `headerClassStatic` / `headerClassFn`. Lets the group-header paint path
   * carry group styling without touching the leaf col's header class.
   * Cycle 6 / Task 7 (fix-pass).
   */
  groupHeaderClassNames?: string[];
  /**
   * Cycle 18 / Task 4 — set to `'open'` / `'closed'` when this group-header
   * cell belongs to a pivot result group that owns a
   * `columnGroupShow:'closed'` totals leaf (a branch pivot group). The
   * header painter draws a chevron-down / chevron-right at the left of
   * the cell so the user can see the group is collapsible. Plumbed
   * through to `CellPaintConfig.pivotGroupExpand`. Threaded by
   * `renderer/painters/byRows.ts` once per group header per paint.
   */
  pivotGroupExpand?: 'open' | 'closed';
}

/** Apply a `ColCellOverrides` patch onto the mutable slots of `target`.
 *  Only defined fields in `patch` are applied; `undefined` fields are
 *  silently skipped, which is what "later wins" stacking requires. */
function applyOverridePatch(target: CellPaintConfig, patch: ColCellOverrides): void {
  if (patch.font !== undefined) target.font = patch.font;
  if (patch.fg !== undefined) target.fg = patch.fg;
  if (patch.bg !== undefined) target.bg = patch.bg;
  if (patch.halign !== undefined) target.halign = patch.halign;
}

/** Cycle 14 / Task 1 — prepend a font-weight to a CSS font shorthand.
 *  CanvasRenderingContext2D.font accepts the same shorthand as CSS, so
 *  `"500 13px JetBrains Mono"` paints a +1 weight stop without the
 *  caller having to know the body weight. When `font` already carries a
 *  weight token (e.g. `"600 13px Inter"`) we REPLACE it; otherwise we
 *  prepend the weight. Defensive against custom theme fonts that ship
 *  weights inline. The weight is a numeric (100–900) per CSS spec. */
function withFontWeight(font: string, weight: number): string {
  const cssWeight = String(Math.max(100, Math.min(900, Math.round(weight))));
  // Detect a leading weight token: 100..900 (numeric) or one of the
  // CSS keywords. Body face strings shipped by tokens.css are NEVER
  // pre-weighted, so the common path replaces nothing and prepends.
  const KEYWORDS = /^(normal|bold|bolder|lighter|[1-9]00)\s+/;
  if (KEYWORDS.test(font)) return font.replace(KEYWORDS, `${cssWeight} `);
  return `${cssWeight} ${font}`;
}

/** Repopulate `target` in place. The caller reuses a single config object
 * across the whole frame to keep paint allocation-free.
 *
 * Styling precedence (lowest → highest):
 *  1. Theme defaults (font, fg, headerFg, rowBg, halign from cellDataType).
 *  2. Static `cellStyle` object overrides.
 *  3. Class-driven variants (`cellClass` / `cellClassRules` → `cellClassVariants`
 *     or `headerClass` → `headerClassVariants`). Later class names win.
 *  4. Function-form `cellStyle` (highest; called per cell, return value wins).
 *
 * Cycle 6 / Task 7.
 */
export function applyCellProps(target: CellPaintConfig, ctx: ApplyCellPropsInput): void {
  const { colDef, theme } = ctx;

  // ── 1. Base values ──────────────────────────────────────────────────────
  target.value = ctx.value;
  target.valueFormatted = ctx.valueFormatted;
  target.bounds.x = ctx.x;
  target.bounds.y = ctx.y;
  target.bounds.w = ctx.w;
  target.bounds.h = ctx.h;
  target.borderColor = theme.gridLineColor;
  target.prefillColor = ctx.prefillColor;
  target.isFocused = ctx.isFocused;
  target.isSelected = ctx.isSelected;
  target.isHovered = ctx.isHovered;
  target.isHeader = ctx.isHeader;
  target.iconColor = ctx.iconColor;
  target.sortDirection = ctx.sortDirection;
  target.sortIndex = ctx.sortIndex;
  target.sortTotal = ctx.sortTotal;
  target.unSortIcon = ctx.unSortIcon;
  target.unSortIconColor = ctx.unSortIconColor;
  target.pivotGroupExpand = ctx.pivotGroupExpand;
  target.flashAlpha = ctx.flashAlpha;
  // Cycle 4 / Task 11 — pipe the theme's resolved flash color through
  // so painters don't hard-code it. Read once per cell (constant per
  // theme); no perf hit.
  target.flashFromColor = theme.flashFromColor;
  // Cycle 15 / Task 4 — auto-group column tokens, threaded onto every
  // cell config so the `'group'` cell renderer can read chevron color
  // + count suffix color + indent unit without reaching into the
  // theme directly. Other renderers ignore these fields.
  target.groupChevronColor = theme.groupChevronColor;
  target.groupCountColor = theme.groupCountColor;
  target.groupIndent = theme.groupIndent;
  // Cycle 15 / Task 8 — tri-state checkbox tokens for the auto-group
  // column's group rows. Defaults match the existing `checkboxCell`
  // painter (body fg) so the box reads as one checkbox vocabulary
  // across the grid.
  target.groupCheckboxBorderColor = theme.groupCheckboxBorderColor;
  target.groupCheckboxCheckColor = theme.groupCheckboxCheckColor;
  target.groupCheckboxIndeterminateColor = theme.groupCheckboxIndeterminateColor;
  target.groupCheckboxFill = theme.groupCheckboxFill;
  target.params = ctx.params;

  // Theme defaults.
  target.font = theme.font;
  target.fg = ctx.isHeader ? theme.headerFg : theme.fg;
  target.bg = ctx.rowBg;
  target.halign = colDef.cellDataType === 'number' ? 'right' : 'left';

  // Cycle 14 / Task 1 — totals-row "lift" treatment. Bumps the font
  // weight by +1 stop (body 400 → totals 500 by default) and swaps
  // fg to a one-stop-stronger colour so the lift carries on a glance.
  // The bg is already painted via the row-bg bundle (theme.totalsBg)
  // — we don't re-apply it here so per-cell cellStyle / cellClass
  // overrides further down the chain can still tint individual cells.
  // The polished `'totals'` renderer in Task 5 will add the em-dash
  // placeholder + per-column halign-from-data overrides on top.
  if (ctx.isTotals === true) {
    target.fg = theme.totalsFg;
    target.font = withFontWeight(theme.font, theme.totalsFontWeight);
    // Cycle 14 / Task 5 — thread the muted fg through to the polished
    // `'totals'` renderer so its em-dash placeholder paints in a muted
    // tone without the renderer reaching into the theme directly.
    target.emptyFg = theme.totalsFgMuted;
  }
  // Cycle 15 / Task 12 — per-group footer lift. Same shape as totals
  // (fg + weight + emptyFg) but routed through the
  // `--cg-group-footer-*` tokens so apps can dial them independently.
  // The row bg is laid down by the row-bg bundle in `byRows.ts` reading
  // `theme.groupFooterBg`; this branch only handles the per-cell
  // typography lift. `isTotals` and `isGroupFooter` are mutually
  // exclusive per the input contract — the `else if` enforces it.
  else if (ctx.isGroupFooter === true) {
    target.fg = theme.groupFooterFg;
    target.font = withFontWeight(theme.font, theme.groupFooterFontWeight);
    target.emptyFg = theme.totalsFgMuted;
  }

  // ── 2. Static cellStyle object ─────────────────────────────────────────
  const staticCellStyle = colDef.cellStyle;
  if (staticCellStyle !== undefined && typeof staticCellStyle === 'object') {
    applyOverridePatch(target, staticCellStyle as ColCellOverrides);
  }

  // ── 3. Class-driven variants ───────────────────────────────────────────
  // Build the params object for callbacks (shared shape).
  const callbackParams = {
    data: (ctx.rowData ?? {}) as Record<string, unknown>,
    value: ctx.value,
    colId: colDef.colId,
    rowIndex: ctx.rowIndex ?? 0,
  };

  if (ctx.isHeader) {
    // Header path: group-header cells supply groupHeaderClassNames (from the
    // group's pre-resolved headerClass); leaf header cells fall back to the
    // leaf colDef's headerClassStatic / headerClassFn. Group wins; leaf is skipped
    // when groupHeaderClassNames is provided. Cycle 6 / Task 7 (fix-pass).
    let headerClassNames: string[] | undefined;
    if (ctx.groupHeaderClassNames !== undefined) {
      // Group-header paint path: use the group's pre-resolved class names.
      headerClassNames = ctx.groupHeaderClassNames.length > 0 ? ctx.groupHeaderClassNames : undefined;
    } else if (colDef.headerClassStatic) {
      headerClassNames = colDef.headerClassStatic;
    } else if (colDef.headerClassFn) {
      const result = colDef.headerClassFn({ colId: colDef.colId });
      headerClassNames = result === undefined ? undefined
        : Array.isArray(result) ? result : [result];
    }
    if (headerClassNames) {
      for (const name of headerClassNames) {
        const patch = theme.headerClassVariants.get(name);
        if (patch) applyOverridePatch(target, patch);
      }
    }
  } else {
    // Data-cell path: resolve cellClass + cellClassRules → cellClassVariants.
    const variantMap = theme.cellClassVariants;

    // 3a. Static / function cellClass names.
    let staticClassNames: string[] | undefined;
    if (colDef.cellClassStatic) {
      staticClassNames = colDef.cellClassStatic;
    } else if (colDef.cellClassFn) {
      const result = colDef.cellClassFn(callbackParams);
      staticClassNames = result === undefined ? undefined
        : Array.isArray(result) ? result : [result];
    }
    if (staticClassNames) {
      for (const name of staticClassNames) {
        const patch = variantMap.get(name);
        if (patch) applyOverridePatch(target, patch);
      }
    }

    // 3b. cellClassRules — pre-compiled predicates, evaluated in order.
    if (colDef.cellClassRules) {
      for (const rule of colDef.cellClassRules) {
        let matched: boolean;
        try {
          matched = rule.predicate(callbackParams);
        } catch {
          matched = false;
        }
        if (matched) {
          const patch = variantMap.get(rule.className);
          if (patch) applyOverridePatch(target, patch);
        }
      }
    }
  }

  // ── 4. Function-form cellStyle (highest precedence) ────────────────────
  if (colDef.cellStyleFn) {
    let patch: ColCellOverrides | null | undefined;
    try {
      patch = colDef.cellStyleFn(callbackParams);
    } catch {
      patch = undefined;
    }
    if (patch) applyOverridePatch(target, patch);
  }
}

/**
 * Normalize a `CellClass` value (from the merged colDef) into either a
 * static string array or a compiled function. Returns `{ static, fn }` with
 * at most one set. Allocation happens here once (at resolve time), not per
 * paint. Cycle 6 / Task 7.
 */
function compileCellClass(
  cellClass: CellClass | undefined,
): { cellClassStatic?: string[]; cellClassFn?: ResolvedColDef['cellClassFn'] } {
  if (cellClass === undefined) return {};
  if (typeof cellClass === 'string') return { cellClassStatic: [cellClass] };
  if (Array.isArray(cellClass)) return { cellClassStatic: cellClass.slice() };
  // Function form.
  return { cellClassFn: cellClass as ResolvedColDef['cellClassFn'] };
}

/**
 * Normalize a `HeaderClass` value into either a static string array or a
 * compiled function. Cycle 6 / Task 7.
 */
function compileHeaderClass(
  headerClass: HeaderClass | undefined,
): { headerClassStatic?: string[]; headerClassFn?: ResolvedColDef['headerClassFn'] } {
  if (headerClass === undefined) return {};
  if (typeof headerClass === 'string') return { headerClassStatic: [headerClass] };
  if (Array.isArray(headerClass)) return { headerClassStatic: headerClass.slice() };
  return { headerClassFn: headerClass as ResolvedColDef['headerClassFn'] };
}

/**
 * Pre-compile `CellClassRules` into an ordered array of `{ className,
 * predicate }` pairs. The array is allocated once at resolve time; paint
 * loops iterate it at zero per-frame allocation cost. Cycle 6 / Task 7.
 */
function compileCellClassRules(
  rules: CellClassRules | undefined,
): CompiledClassRule[] | undefined {
  if (!rules) return undefined;
  const entries = Object.entries(rules);
  if (entries.length === 0) return undefined;
  return entries.map(([className, predicate]) => ({ className, predicate: predicate as CompiledClassRule['predicate'] }));
}

export function resolveColDef<TRow>(
  colDef: CColDef<TRow>,
  defaultColDef: Partial<CColDef<TRow>> = {},
  columnTypes: Record<string, Partial<CColDef<TRow>>> = {},
): ResolvedColDef<TRow> {
  // Cycle 6 / Task 6 — apply columnTypes bundles in order, then defaultColDef,
  // then the column itself. Spread order matters: later objects overwrite
  // earlier keys, so the column always wins, defaultColDef beats any type
  // bundle, and types resolve left-to-right (the last bundle named in a
  // `type: [a, b]` array beats earlier ones).
  let typeBundle: Partial<CColDef<TRow>> = {};
  const typeNames: string[] = Array.isArray(colDef.type)
    ? colDef.type
    : typeof colDef.type === 'string' ? [colDef.type] : [];
  for (const name of typeNames) {
    const bundle = columnTypes[name];
    if (bundle) {
      typeBundle = { ...typeBundle, ...bundle };
      continue;
    }
    // Deprecation alias: a legacy `type: 'text' | 'number'` value that does
    // not match any `columnTypes` entry collapses into `cellDataType`. Any
    // other unknown name is a typo or stale reference — fail loudly.
    if (name === 'text' || name === 'number') {
      typeBundle = { ...typeBundle, cellDataType: name };
      continue;
    }
    throw new Error(`[cgrid] unknown column type '${name}' (not declared in CGridOptions.columnTypes)`);
  }

  const merged: CColDef<TRow> = { ...typeBundle, ...defaultColDef, ...colDef };

  const colId = merged.colId ?? merged.field;
  if (!colId) {
    throw new Error('[cgrid] ColDef must have colId or field');
  }

  const cellDataType: 'text' | 'number' = merged.cellDataType ?? 'text';

  // initial* fields apply only when the non-initial counterpart is unset.
  // `applyColumnState` / `setColumnsVisible` / `setColumnsPinned` then read
  // the resolved `width` / `pinned` / `hide` slots — they never re-read the
  // `initial*` keys, so we collapse them here at resolve time.
  const resolvedWidth = merged.width ?? merged.initialWidth;
  const initialPinned = merged.initialPinned;
  const initialPinnedResolved: 'left' | 'right' | undefined =
    initialPinned === true || initialPinned === 'left' ? 'left'
    : initialPinned === 'right' ? 'right' : undefined;
  const resolvedPinned = merged.pinned ?? initialPinnedResolved;
  const resolvedHide = merged.hide ?? merged.initialHide ?? false;

  return {
    colId,
    field: merged.field,
    headerName: merged.headerName ?? String(merged.field ?? colId),
    width: resolvedWidth,
    flex: merged.flex,
    minWidth: merged.minWidth ?? 30,
    maxWidth: merged.maxWidth ?? Number.POSITIVE_INFINITY,
    pinned: resolvedPinned,
    cellDataType,
    valueGetter: merged.valueGetter as ResolvedColDef<TRow>['valueGetter'],
    valueFormatter: merged.valueFormatter as ResolvedColDef<TRow>['valueFormatter'],
    valueParser: merged.valueParser as ResolvedColDef<TRow>['valueParser'],
    valueSetter: merged.valueSetter as ResolvedColDef<TRow>['valueSetter'],
    cellRenderer: merged.cellRenderer ?? (merged.wrapText ? 'text-wrap' : cellDataType),
    cellRendererParams: merged.cellRendererParams,
    cellRendererSelector: merged.cellRendererSelector as ResolvedColDef<TRow>['cellRendererSelector'],
    comparator: merged.comparator as ResolvedColDef<TRow>['comparator'],
    filter: merged.filter,
    floatingFilter: merged.floatingFilter,
    filterParams: merged.filterParams,
    suppressFloatingFilterButton: merged.suppressFloatingFilterButton ?? false,
    aggFunc: merged.aggFunc,
    suppressAggFuncInHeader: merged.suppressAggFuncInHeader,
    totalsCellRenderer: merged.totalsCellRenderer,
    sortable: merged.sortable ?? true,
    accentedSort: merged.accentedSort,
    unSortIcon: merged.unSortIcon,
    sortGroupRowsByKey: merged.sortGroupRowsByKey,
    resizable: merged.resizable ?? true,
    editable: (merged.editable ?? false) as ResolvedColDef<TRow>['editable'],
    singleClickEdit: merged.singleClickEdit,
    suppressKeyboardEvent: merged.suppressKeyboardEvent as ResolvedColDef<TRow>['suppressKeyboardEvent'],
    cellEditor: merged.cellEditor as ResolvedColDef<TRow>['cellEditor'],
    cellEditorParams: merged.cellEditorParams as ResolvedColDef<TRow>['cellEditorParams'],
    // Split cellStyle into object form vs function form.
    cellStyle: typeof merged.cellStyle === 'object' && merged.cellStyle !== null
      ? merged.cellStyle as ColCellOverrides
      : undefined,
    cellStyleFn: typeof merged.cellStyle === 'function'
      ? merged.cellStyle as CellStyleFunc
      : undefined,
    // Pre-compile cellClass, cellClassRules, headerClass. Cycle 6 / Task 7.
    ...compileCellClass(merged.cellClass as CellClass | undefined),
    cellClassRules: compileCellClassRules(merged.cellClassRules as CellClassRules | undefined),
    ...compileHeaderClass(merged.headerClass as HeaderClass | undefined),
    autoHeight: merged.autoHeight,
    wrapText: merged.wrapText,
    columnGroupShow: merged.columnGroupShow ?? null,
    suppressMovable: merged.suppressMovable ?? false,
    lockPosition: merged.lockPosition === true || merged.lockPosition === 'left'
      ? 'left'
      : merged.lockPosition === 'right'
        ? 'right'
        : null,
    hide: resolvedHide,
    lockVisible: merged.lockVisible ?? false,
    lockPinned: merged.lockPinned ?? false,
    suppressSizeToFit: merged.suppressSizeToFit ?? false,
    suppressAutoSize: merged.suppressAutoSize ?? false,
    enableRowGroup: merged.enableRowGroup ?? false,
    enablePivot: merged.enablePivot ?? false,
    enableValue: merged.enableValue ?? false,
    initialSort: merged.initialSort,
    initialSortIndex: merged.initialSortIndex,
  };
}
