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
  comparator?: (a: unknown, b: unknown, ar: TRow, br: TRow) => number;
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
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  sortable: boolean;
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
  iconColor?: string;
  sortDirection?: 'asc' | 'desc';
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
  target.flashAlpha = ctx.flashAlpha;
  // Cycle 4 / Task 11 — pipe the theme's resolved flash color through
  // so painters don't hard-code it. Read once per cell (constant per
  // theme); no perf hit.
  target.flashFromColor = theme.flashFromColor;
  target.params = ctx.params;

  // Theme defaults.
  target.font = theme.font;
  target.fg = ctx.isHeader ? theme.headerFg : theme.fg;
  target.bg = ctx.rowBg;
  target.halign = colDef.cellDataType === 'number' ? 'right' : 'left';

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
    sortable: merged.sortable ?? true,
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
  };
}
