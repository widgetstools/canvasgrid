import type {
  CColDef, CValueGetterParams, CValueFormatterParams, ColCellOverrides,
  CCellRendererSelector, CValueParserParams, CValueSetterParams,
  CellEditorCtor, EditableCallback, SuppressKeyboardEventCallback,
  CellClass, CellClassRules, CellStyleFunc, HeaderClass,
  BorderSpec, BorderSide, CellContent, CellDecorator,
} from '../types';
import type { CellPaintConfig } from '../renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../theming/cssReader';
import { getFormatCompiler, type CompositeColDefShape } from './formatCompilerSlot';
import { getRuleEngine } from './ruleEngineSlot';
import { evalFormatProgram } from './formatEvalMemo';

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
  /** Narrowed to function form only — string is compiled by compileFormatSlots. */
  valueFormatter?: (params: CValueFormatterParams<TRow, unknown>) => string;
  /** Icon resolver derived from the format string by compileFormatSlots. */
  cellIcon?: (params: CValueFormatterParams<TRow, unknown>) => import('@cgrid/format').IconRef | null;
  /** Cycle 28 — leaf-header prefix/suffix icon. Always a fn after resolve —
   *  static IconRef forms are wrapped by `normalizeHeaderIcon`. */
  headerIcon?: (params: { colId: string }) => import('@cgrid/format').IconRef | null;
  /** @internal — populated by compileFormatSlots for composite ColDefs. */
  _compositeProgram?: import('../types/formatProgramShape').FormatProgramShape;
  /** Composite fragment-run alignment (`CColDef.align`). Only meaningful
   *  when `_compositeProgram` is set. Cycle 21c / Task 13. */
  compositeAlign?: 'left' | 'center' | 'right';
  /** Composite overflow behavior (`CColDef.overflow`). Only meaningful
   *  when `_compositeProgram` is set. Cycle 21c / Task 13. */
  compositeOverflow?: 'ellipsis' | 'clip';
  cellRenderer: string;
  /** Static params forwarded to the painter as `CellPaintConfig.params`. */
  cellRendererParams?: unknown;
  /** Mirrors `CColDef.checkboxSelection`. When true the resolver
   *  forces `cellRenderer` to `'rowSelectCheckbox'` and a chain
   *  feature claims clicks on cells in this column for the row-
   *  toggle gesture. */
  checkboxSelection?: boolean;
  /** Mirrors `CColDef.headerCheckboxSelection`. When true the header
   *  painter draws a tri-state checkbox in this column's header and
   *  `HeaderClick` routes clicks on the box to the select-all /
   *  clear-all toggle. */
  headerCheckboxSelection?: boolean;
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
  /**
   * Cycle 27 / Task 1 — static object form of `CColDef.headerStyle`. Applied
   * AFTER header class variants. Skipped for data cells.
   */
  headerStyle?: ColCellOverrides;
  /**
   * Cycle 27 / Task 1 — function form of `CColDef.headerStyle`. Highest
   * precedence header override. Skipped for data cells.
   */
  headerStyleFn?: (params: { colId: string }) => ColCellOverrides | null | undefined;
  /** See `CColDef.autoHeight`. When true, the worker measures wrapped-text
   *  height for every visible row in this column and contributes the result
   *  into the row's resolved height. Cycle 5 / Task 8. */
  autoHeight?: boolean;
  /** See `CColDef.wrapHeaderText` (Cycle 21i / Phase 1). Header cell
   *  wraps its text to the column width. */
  wrapHeaderText?: boolean;
  /** See `CColDef.autoHeaderHeight` (Cycle 21i / Phase 1). Leaf header
   *  row grows to fit this column's wrapped header. */
  autoHeaderHeight?: boolean;
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
  /** Cycle 21i / Phase 1 — header cell wraps its text to the column
   *  width (colDef.wrapHeaderText). Header rows only. */
  wrapHeader?: boolean;
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
   * Cycle 27 / Task 1 — static `headerStyle` patch from the GROUP definition.
   * Applied after `groupHeaderClassNames` variants. Skipped when undefined.
   */
  groupHeaderStyle?: ColCellOverrides;
  /**
   * Cycle 27 / Task 1 — function-form `headerStyle` from the GROUP
   * definition. Highest precedence for the group header cell. Skipped when
   * undefined.
   */
  groupHeaderStyleFn?: (params: { colId: string }) => ColCellOverrides | null | undefined;
  /**
   * Cycle 18 / Task 4; broadened Task 10 — set to `'open'` / `'closed'`
   * when this group-header cell belongs to a column group whose collapse
   * has a visible effect: EITHER a pivot result group that owns a
   * `columnGroupShow:'closed'` totals leaf (a branch pivot group), OR
   * (Task 10) any REGULAR column group with a sub-group child or a direct
   * `columnGroupShow:'open'`/`'closed'` leaf — see `groupHasToggleEffect`
   * in `renderer/painters/byRows.ts`. Despite the name, this field is NOT
   * pivot-only; it's the shared expand/collapse-caret signal for any
   * column-group header. The header painter draws a leading caret at the
   * left of the cell so the user can see the group is collapsible. Plumbed
   * through to `CellPaintConfig.pivotGroupExpand`. Threaded by
   * `renderer/painters/byRows.ts` once per group header per paint.
   */
  pivotGroupExpand?: 'open' | 'closed';
  /** Row-select header checkbox state — `'none' | 'partial' | 'all'`
   *  when the cell is a header on a column with
   *  `headerCheckboxSelection: true`. `undefined` for every other
   *  cell. The header painter renders a centered tri-state checkbox
   *  in place of the column's headerName text. */
  headerCheckboxState?: 'none' | 'partial' | 'all';
  /** Cycle 21e / Task 11 — string rowId of the data row. Undefined on
   *  header / totals / pinned / group / footer cells — exactly the cells
   *  the rule fold must skip. */
  rowId?: string;
  /** Cycle 21e / Task 11 — full row for rule-condition evaluation
   *  (rowDataById mirror; falls back to the visible-column snapshot). */
  ruleRow?: Record<string, unknown>;
  /** Cycle 21e / Task 11 — active theme kind for the rule eval ctx. */
  themeKind?: 'light' | 'dark';
}

/** Workstream C (2026-07-06 CSS styling model) — resolve `var(--cg-…)`
 *  color refs on each declared border side (`all`/`top`/`right`/`bottom`/
 *  `left`) before the spec lands on the paint config. Only touches
 *  `.color`; `width`/`style` pass through untouched — this pass is scoped
 *  to color-bearing fields only. Returns a shallow clone so the caller's
 *  original `BorderSpec` object (which may be a shared cellStyle literal)
 *  is never mutated. */
function resolveBorderSpecColors(
  spec: BorderSpec,
  resolveVarRef: (value: string) => string,
): BorderSpec {
  const resolveSide = (side: BorderSide): BorderSide =>
    side.color !== undefined ? { ...side, color: resolveVarRef(side.color) } : side;
  const out: BorderSpec = {};
  if (spec.all !== undefined) out.all = resolveSide(spec.all);
  if (spec.top !== undefined) out.top = resolveSide(spec.top);
  if (spec.right !== undefined) out.right = resolveSide(spec.right);
  if (spec.bottom !== undefined) out.bottom = resolveSide(spec.bottom);
  if (spec.left !== undefined) out.left = resolveSide(spec.left);
  return out;
}

/** Workstream C (completion) — resolve `var(--cg-…)` refs in a cell-content
 *  slot's color fields (`icon.color`, `icon-text.iconColor`). Returns a shallow
 *  clone; other kinds (text/emoji) pass through untouched. */
function resolveContentColors(
  content: CellContent,
  resolveVarRef: (value: string) => string,
): CellContent {
  if (content.kind === 'icon' && content.color !== undefined) {
    return { ...content, color: resolveVarRef(content.color) };
  }
  if (content.kind === 'icon-text' && content.iconColor !== undefined) {
    return { ...content, iconColor: resolveVarRef(content.iconColor) };
  }
  return content;
}

/** Workstream C (completion) — resolve `var(--cg-…)` refs in each decorator's
 *  `color` / `bg` fields so token-referenced decorator colors track the theme
 *  (mode-aware). Returns a new array of shallow clones. */
function resolveDecoratorColors(
  decorators: readonly CellDecorator[],
  resolveVarRef: (value: string) => string,
): CellDecorator[] {
  return decorators.map((d) => {
    let out = d;
    if (d.color !== undefined) out = { ...out, color: resolveVarRef(d.color) };
    if (d.bg !== undefined) out = { ...out, bg: resolveVarRef(d.bg) };
    return out;
  });
}

/** Apply a `ColCellOverrides` patch onto the mutable slots of `target`.
 *  Only defined fields in `patch` are applied; `undefined` fields are
 *  silently skipped, which is what "later wins" stacking requires.
 *
 *  Cycle 27 / Task 1 — font is now composed via `composeFont(patch,
 *  target.font)` so breakout fields (`fontFamily` / `fontSize` /
 *  `fontWeight` / `fontStyle`) layer onto whatever was already in
 *  `target.font` (theme default or prior patch). Each layer adds its own
 *  fields, prior layers' fields survive. An explicit `patch.font`
 *  shorthand replaces wholesale. `valign` also passes through here.
 *
 *  Workstream C (2026-07-06 CSS styling model) — `resolveVarRef`, when
 *  supplied, resolves `var(--cg-…)` token references on `fg`/`bg`/border
 *  side colors before they land on `target` (`cellStyle`/`headerStyle`
 *  callers pass `theme.resolveVarRef`; CSS-class-variant and rule-engine
 *  callers omit it — those patches are handled by their own mechanisms
 *  and are out of scope for this pass). Omitted (`undefined`) means a
 *  literal passthrough, identical to pre-Workstream-C behavior. */
function applyOverridePatch(
  target: CellPaintConfig,
  patch: ColCellOverrides,
  resolveVarRef?: (value: string) => string,
): void {
  if (patch.font !== undefined
      || patch.fontFamily !== undefined
      || patch.fontSize !== undefined
      || patch.fontWeight !== undefined
      || patch.fontStyle !== undefined) {
    target.font = composeFont(patch, target.font);
  }
  if (patch.fg !== undefined) target.fg = resolveVarRef ? resolveVarRef(patch.fg) : patch.fg;
  if (patch.bg !== undefined) target.bg = resolveVarRef ? resolveVarRef(patch.bg) : patch.bg;
  if (patch.halign !== undefined) target.halign = patch.halign;
  if (patch.valign !== undefined) target.valign = patch.valign;
  if (patch.textTransform !== undefined) target.textTransform = patch.textTransform;
  // Cycle 21e / Task 11 — see ColCellOverrides.textDecoration.
  if (patch.textDecoration !== undefined) target.textDecoration = patch.textDecoration;
  if (patch.letterSpacing !== undefined) target.letterSpacing = patch.letterSpacing;
  if (patch.lineHeight !== undefined) target.lineHeight = patch.lineHeight;
  if (patch.padding !== undefined) {
    target.padding = typeof patch.padding === 'number'
      ? { top: patch.padding, right: patch.padding, bottom: patch.padding, left: patch.padding }
      : { ...patch.padding };
  }
  // Cycle 27 / Task 2 — border override. Replaces wholesale (no per-side
  // merge): a later patch with `border: { top: ... }` discards prior
  // sides. The shape is small enough that callers can supply the full
  // spec in their `cellStyle` patch; deep-merge would surprise more than
  // help.
  if (patch.border !== undefined) {
    target.border = resolveVarRef ? resolveBorderSpecColors(patch.border, resolveVarRef) : patch.border;
  }
  // Cycle 27 / Task 3 — content + decorators replace wholesale. Workstream C
  // (completion) — their color fields resolve var(--cg-…) refs when a resolver
  // is supplied (cellStyle/headerStyle callers), so token-referenced icon /
  // decorator colors are mode-aware like fg/bg/border.
  if (patch.content !== undefined) {
    target.content = resolveVarRef ? resolveContentColors(patch.content, resolveVarRef) : patch.content;
  }
  if (patch.decorators !== undefined) {
    target.decorators = resolveVarRef ? resolveDecoratorColors(patch.decorators, resolveVarRef) : patch.decorators;
  }
}

/** Cycle 27 / Task 1 — apply `textTransform` to a string. Cheap one-shot
 *  helper; no-op for `'none'` / undefined. */
function applyTextTransform(s: string, transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize' | undefined): string {
  if (!transform || transform === 'none') return s;
  if (transform === 'uppercase') return s.toUpperCase();
  if (transform === 'lowercase') return s.toLowerCase();
  // 'capitalize': uppercase first letter of each whitespace-separated word
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

/** Cycle 27 / Task 1 — compose a CSS font shorthand from a
 *  `ColCellOverrides` patch and a fallback shorthand (typically the
 *  resolved theme font). Behavior:
 *
 *  - `overrides.font` (explicit shorthand) wins — returned verbatim.
 *  - When no breakouts are set AND no `font`, returns the fallback as-is.
 *  - When ANY breakout (`fontFamily` / `fontSize` / `fontWeight` /
 *    `fontStyle`) is set, the fallback is parsed for its existing
 *    family/size/weight/style and any breakout overrides the parsed
 *    field. Output is `[style] [weight] <size>px <family>` with
 *    style/weight only emitted when explicitly set or already present
 *    in the fallback.
 *
 *  Pure function — no side effects, safe to call per cell. */
export function composeFont(overrides: ColCellOverrides, fallback: string): string {
  if (overrides.font !== undefined) return overrides.font;
  const hasBreakout =
    overrides.fontFamily !== undefined ||
    overrides.fontSize !== undefined ||
    overrides.fontWeight !== undefined ||
    overrides.fontStyle !== undefined;
  if (!hasBreakout) return fallback;

  const parsed = parseFontShorthand(fallback);
  const style  = overrides.fontStyle  ?? parsed.style;
  const weight = overrides.fontWeight ?? parsed.weight;
  const size   = overrides.fontSize   ?? parsed.size;
  const family = overrides.fontFamily ?? parsed.family;

  const parts: string[] = [];
  if (style !== undefined && style !== 'normal') parts.push(style);
  if (weight !== undefined && weight !== 'normal') parts.push(String(weight));
  parts.push(`${size}px`);
  parts.push(family);
  return parts.join(' ');
}

interface ParsedFont {
  style?: 'normal' | 'italic';
  weight?: string | number;
  size: number;
  family: string;
}

/** Cycle 27 / Task 1 — parse a CSS font shorthand into its component
 *  fields. Tolerant of the common shapes our tokens emit:
 *  `13px Inter`, `600 13px Inter`, `italic 600 13px Inter`. Returns
 *  sane defaults (`size: 13`, `family: 'sans-serif'`) when the string
 *  doesn't match. */
function parseFontShorthand(font: string): ParsedFont {
  const sizeMatch = font.match(/(\d+(?:\.\d+)?)px\s+(.+)$/);
  if (!sizeMatch) return { size: 13, family: 'sans-serif' };
  const size = Number(sizeMatch[1]);
  const family = sizeMatch[2]!.trim();
  const head = font.slice(0, font.indexOf(`${sizeMatch[1]}px`)).trim();
  if (!head) return { size, family };

  const tokens = head.split(/\s+/);
  let style: ParsedFont['style'] | undefined;
  let weight: ParsedFont['weight'] | undefined;
  for (const t of tokens) {
    if (t === 'italic' || t === 'normal') {
      if (style === undefined) style = t === 'italic' ? 'italic' : 'normal';
    } else if (/^\d{3}$/.test(t) || ['bold', 'lighter', 'bolder'].includes(t)) {
      if (weight === undefined) weight = /^\d{3}$/.test(t) ? Number(t) : t;
    }
  }
  return { style, weight, size, family };
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
  target.wrapHeader = ctx.wrapHeader;
  target.sortDirection = ctx.sortDirection;
  target.sortIndex = ctx.sortIndex;
  target.sortTotal = ctx.sortTotal;
  target.unSortIcon = ctx.unSortIcon;
  target.unSortIconColor = ctx.unSortIconColor;
  target.pivotGroupExpand = ctx.pivotGroupExpand;
  target.headerCheckboxState = ctx.headerCheckboxState;
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
  // Cycle 22 / Task 1 — body checkbox accent. Threaded onto every cell
  // config so the `'checkbox'` renderer reads from `p.checkboxCheckedBg`
  // (with `'transparent'` defaulting to the outlined-only look).
  target.checkboxCheckedBg = theme.checkboxCheckedBg;
  target.checkboxCheckedFg = theme.checkboxCheckedFg;
  target.params = ctx.params;
  // Workstream A (2026-07-06 CSS styling model) — thread the resolved
  // renderer-palette bundle onto every cell so @cgrid/renderers painters
  // can resolve data-viz colors/geometry from theme tokens instead of
  // hardcoded constants. Constant per theme (not per-cell computed).
  target.palette = theme.rendererPalette;
  // Cycle 21c / Task 13 — composite program threading. Populated only
  // for columns carrying a compiled composite program; explicitly reset
  // to undefined otherwise (the config object is reused across cells).
  if (colDef._compositeProgram !== undefined && !ctx.isHeader) {
    target.compositeProgram = colDef._compositeProgram;
    target.compositeAlign = colDef.compositeAlign;
    target.compositeOverflow = colDef.compositeOverflow;
    target.rowData = ctx.rowData;
    target.colId = colDef.colId;
    // Cycle 21e / final-review fix — cell identity + theme so the
    // composite painter can attach resolveRuleRef to its fragments ctx.
    target.rowId = ctx.rowId;
    target.themeKind = ctx.themeKind;
  } else {
    target.compositeProgram = undefined;
    target.compositeAlign = undefined;
    target.compositeOverflow = undefined;
    target.rowData = undefined;
    target.colId = undefined;
    target.rowId = undefined;
    target.themeKind = undefined;
  }

  // Theme defaults. Headers paint with the chrome font (Inter by
  // default); body cells paint with the cell font (monospace by
  // default) so numbers, CUSIPs, tickers stay column-aligned.
  // Legacy theme fixtures without `cellFont` fall back to `font`.
  target.font = ctx.isHeader ? theme.font : (theme.cellFont ?? theme.font);
  target.fg = ctx.isHeader ? theme.headerFg : theme.fg;
  target.bg = ctx.rowBg;
  target.halign = colDef.cellDataType === 'number' ? 'right' : 'left';

  // Cycle 27 / Task 1+2+3 — reset opt-in fields with no theme default so
  // they don't bleed across cells when the target config is reused
  // across the paint loop. A field that was set by a prior cell's
  // `cellStyle` patch would otherwise carry into the next cell that
  // doesn't override it (the original bug surfaced via Task 3's
  // function-form content-slot leaking into adjacent columns).
  target.valign = undefined;
  target.textTransform = undefined;
  target.letterSpacing = undefined;
  target.lineHeight = undefined;
  target.padding = undefined;
  target.border = undefined;
  target.content = undefined;
  target.decorators = undefined;
  target.textDecoration = undefined;
  // Cycle 21e / Task 11 — rule-fold outputs, reset per cell (the config
  // object is reused across the paint loop).
  target.ruleIndicator = undefined;

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
    target.font = withFontWeight(theme.cellFont ?? theme.font, theme.totalsFontWeight);
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
    target.font = withFontWeight(theme.cellFont ?? theme.font, theme.groupFooterFontWeight);
    target.emptyFg = theme.totalsFgMuted;
  }

  // ── 2. Static cellStyle object ─────────────────────────────────────────
  // Workstream C — token-referenceable values: fg/bg/border colors of the
  // form `var(--cg-…)` resolve through `theme.resolveVarRef`.
  const staticCellStyle = colDef.cellStyle;
  if (staticCellStyle !== undefined && typeof staticCellStyle === 'object') {
    applyOverridePatch(target, staticCellStyle as ColCellOverrides, theme.resolveVarRef);
  }

  // ── 3. Class-driven variants ───────────────────────────────────────────
  // The shared `callbackParams` literal is allocated lazily — header cells
  // never read it (the header branch passes `{ colId }` instead), and
  // static-only data columns (no cellClassFn / cellClassRules / cellStyleFn)
  // don't need it either. Skipping the literal when no resolver consumes
  // it removes a per-cell allocation in the paint hot loop.
  const needsCallbackParams =
    (!ctx.isHeader && (colDef.cellClassFn !== undefined || colDef.cellClassRules !== undefined))
    || colDef.cellStyleFn !== undefined;
  const callbackParams = needsCallbackParams
    ? {
        data: (ctx.rowData ?? {}) as Record<string, unknown>,
        value: ctx.value,
        colId: colDef.colId,
        rowIndex: ctx.rowIndex ?? 0,
        // Cycle 21e / Task 14 — cell identity for the format-eval memo +
        // rule:<ruleId> accessor. Undefined off the data paint path.
        rowId: ctx.rowId,
        themeKind: ctx.themeKind,
      }
    : undefined;

  if (ctx.isHeader) {
    // Header caption alignment: an EXPLICIT cell alignment (static
    // `cellStyle.halign` — authored or set via the formatting toolbar's Cell
    // target) carries onto the header, so aligning a column's cells aligns
    // its caption too. Without one, headers stay LEFT regardless of the
    // cellDataType-derived data alignment set above (numbers right-align
    // their CELLS, not their captions — the painter's historical behavior).
    // An explicit `headerStyle.halign` / headerClass variant below overrides
    // either, letting the user split header alignment from the cells'.
    target.halign = (colDef.cellStyle as ColCellOverrides | undefined)?.halign ?? 'left';
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

    // Cycle 27 / Task 1 — direct `headerStyle` overrides on the leaf colDef.
    // Static object, then function form. Applied AFTER class variants so
    // an explicit `headerStyle` wins over a class variant of the same field.
    // Workstream C — token-referenceable values, same as static cellStyle.
    if (colDef.headerStyle) {
      applyOverridePatch(target, colDef.headerStyle, theme.resolveVarRef);
    }
    if (colDef.headerStyleFn) {
      let patch: ColCellOverrides | null | undefined;
      try {
        patch = colDef.headerStyleFn({ colId: colDef.colId });
      } catch {
        patch = undefined;
      }
      if (patch) applyOverridePatch(target, patch, theme.resolveVarRef);
    }
    // Group-level `headerStyle` (from the column tree) — applies only on
    // group-header rows. Static then function. Highest precedence inside the
    // header branch (group def wins over the leaf colDef when both are set).
    if (ctx.groupHeaderStyle) {
      applyOverridePatch(target, ctx.groupHeaderStyle, theme.resolveVarRef);
    }
    if (ctx.groupHeaderStyleFn) {
      let patch: ColCellOverrides | null | undefined;
      try {
        patch = ctx.groupHeaderStyleFn({ colId: colDef.colId });
      } catch {
        patch = undefined;
      }
      if (patch) applyOverridePatch(target, patch, theme.resolveVarRef);
    }
  } else {
    // Data-cell path: resolve cellClass + cellClassRules → cellClassVariants.
    const variantMap = theme.cellClassVariants;

    // 3a. Static / function cellClass names.
    let staticClassNames: string[] | undefined;
    if (colDef.cellClassStatic) {
      staticClassNames = colDef.cellClassStatic;
    } else if (colDef.cellClassFn) {
      const result = colDef.cellClassFn(callbackParams!);
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
          matched = rule.predicate(callbackParams!);
        } catch {
          matched = false;
        }
        if (matched) {
          const patch = variantMap.get(rule.className);
          if (patch) applyOverridePatch(target, patch);
        }
      }
    }

    // ── 3.5. Cycle 21e / Task 11 — rule-engine fold ──────────────────────
    // DATA cells only: ctx.rowId is populated exclusively for data-leaf
    // rows (byRows threads '' → undefined for group/footer chunk entries;
    // header / totals / pinned / group-footer paths never set it), so the
    // single guard below is the data-cell discriminator. Slot empty or
    // `matched` empty → zero-diff behavior (spec §5.2).
    // Fold position per spec §3.5: AFTER cellClassRules variants, BEFORE
    // function-form cellStyle — rules beat declarative class styling; an
    // explicit per-cell cellStyle function stays the app's last word.
    const ruleEngine = getRuleEngine();
    if (ruleEngine !== null && ctx.rowId !== undefined) {
      let ruleResult: ReturnType<typeof ruleEngine.evaluateCell> | null = null;
      try {
        ruleResult = ruleEngine.evaluateCell({
          row: ctx.ruleRow ?? ctx.rowData ?? {},
          rowId: ctx.rowId,
          colId: colDef.colId,
          theme: ctx.themeKind ?? 'light',
        });
      } catch {
        ruleResult = null; // engine errors never break paint
      }
      if (ruleResult !== null && ruleResult.matched.length > 0) {
        const s = ruleResult.style;
        if (s !== null) {
          const patch: ColCellOverrides = {};
          if (s.color !== undefined) patch.fg = s.color;
          if (s.backgroundColor !== undefined) patch.bg = s.backgroundColor;
          // fontWeight / fontStyle ride composeFont via applyOverridePatch
          // — the same breakout-composition path Cycle 27 built; no manual
          // font-string rebuild needed.
          if (s.fontWeight !== undefined) patch.fontWeight = s.fontWeight as ColCellOverrides['fontWeight'];
          if (s.fontStyle !== undefined) patch.fontStyle = s.fontStyle;
          if (s.textDecoration !== undefined) {
            patch.textDecoration = s.textDecoration as ColCellOverrides['textDecoration'];
          }
          // borderColor/borderStyle → BorderSpec on all four sides.
          // borderStyle 'none' (or color absent) → no border patch.
          if (s.borderColor !== undefined && s.borderStyle !== 'none') {
            patch.border = {
              all: {
                width: 1,
                color: s.borderColor,
                style: (s.borderStyle ?? 'solid') as import('../types').BorderStyle,
              },
            };
          }
          applyOverridePatch(target, patch);
        }
        // Indicator + formatProgram are stored for the byRows paint path
        // (Cycle 21e / Task 14) — one evaluateCell per cell, consumed twice.
        target.ruleIndicator = ruleResult.indicator;
        // Cycle 21e / Task 14 — per-rule valueFormatter: the winning
        // rule's compiled program replaces the column's formatted text.
        // Lives here (not in the compileFormatSlots wrappers) so it works
        // on columns with NO format string of their own. Runs before the
        // textTransform step, matching the normal formatted-text flow.
        if (ruleResult.formatProgram !== null && ruleResult.formatProgram !== undefined) {
          try {
            const prog = ruleResult.formatProgram as import('./formatCompilerSlot').FormatProgramShape;
            target.valueFormatted = String(prog.formatText({
              value: ctx.value,
              row: ctx.ruleRow ?? ctx.rowData ?? {},
              colId: colDef.colId,
            }));
          } catch { /* formatter errors never break paint */ }
        }
      }
    }
  }

  // ── 4. Function-form cellStyle (highest precedence) ────────────────────
  // Workstream C — token-referenceable values, same as static cellStyle.
  if (colDef.cellStyleFn) {
    let patch: ColCellOverrides | null | undefined;
    try {
      patch = colDef.cellStyleFn(callbackParams!);
    } catch {
      patch = undefined;
    }
    if (patch) applyOverridePatch(target, patch, theme.resolveVarRef);
  }

  // ── 5. Cycle 27 / Task 1 — apply textTransform after all overrides ─────
  // Last step so the final accumulated `target.textTransform` wins. Cheap
  // string transform; no-op for `'none'` / undefined.
  if (target.textTransform !== undefined && target.textTransform !== 'none') {
    target.valueFormatted = applyTextTransform(target.valueFormatted, target.textTransform);
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

/** Adapt an authored `cellStyle` (function OR static object) into the
 *  function form `mergeCellStyle` folds. Static objects — including the
 *  calc engine's folded `editColumn`/template `cellStyle` patches — become
 *  constant functions so they survive the format-compile pass instead of
 *  being silently dropped (the "styling never paints on a column with a
 *  string valueFormatter" bug: both `mergeCellStyle` call sites passed
 *  `undefined` for anything that wasn't already a function). */
function userStyleFnFrom<TRow>(
  cellStyle: unknown,
): ((params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined) | undefined {
  if (typeof cellStyle === 'function') {
    return cellStyle as (params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined;
  }
  if (cellStyle !== null && typeof cellStyle === 'object') {
    const staticStyle = cellStyle as Record<string, string | number>;
    return () => staticStyle;
  }
  return undefined;
}

/** Merge kernel's `cellStyle` with format's derived style function.
 *  Format's style is applied first; user's cellStyle overlays and wins
 *  on any explicit non-undefined field. Only wired from compileFormatSlots;
 *  not used by the paint path. */
function mergeCellStyle<TRow>(
  userFn: ((params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined) | undefined,
  formatFn: (params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined,
): (params: CValueFormatterParams<TRow, unknown>) => Record<string, string | number> | undefined {
  return (params) => {
    const fromFormat = formatFn(params) ?? {};
    if (!userFn) return Object.keys(fromFormat).length > 0 ? fromFormat : undefined;
    const fromUser = userFn(params) ?? {};
    const merged: Record<string, string | number> = { ...fromFormat, ...fromUser };
    return Object.keys(merged).length > 0 ? merged : undefined;
  };
}

const _warnedMessages = new Set<string>();
function warnOnce(msg: string): void {
  if (_warnedMessages.has(msg)) return;
  _warnedMessages.add(msg);
  console.warn(msg);
}

/** Convert a resolveStyle result object into a `ColCellOverrides`-shaped
 *  Record for cellStyle. Keys map onto the kernel's canonical override
 *  vocabulary (`fg` / `bg` / `fontWeight` / `fontStyle`) so
 *  `applyOverridePatch` actually applies them at paint time
 *  (Cycle 21c / Task 13 fix — the earlier `color` / `background` keys
 *  were silently ignored by the patch applier). */
function styleObjToRecord(s: {
  color?: string; background?: string; weight?: string | number; italic?: boolean;
}): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (s.color !== undefined) out['fg'] = s.color;
  if (s.background !== undefined) out['bg'] = s.background;
  if (s.weight !== undefined) out['fontWeight'] = s.weight;
  if (s.italic) out['fontStyle'] = 'italic';
  return out;
}

/** ColDef-resolve pass: compile string-form `valueFormatter` and
 *  `type: 'composite'` ColDefs via the registered format compiler.
 *  When no compiler is registered (getFormatCompiler() → null), this
 *  is a pure pass-through — behaviour is byte-identical to pre-task-11.
 *  Cycle 21c / Task 11. */
function compileFormatSlots<TRow>(
  merged: CColDef<TRow>,
  resolvedColId: string,
): CColDef<TRow> {
  const compiler = getFormatCompiler();
  if (!compiler) return merged;

  // Composite path
  if (merged.type === 'composite') {
    const composite = merged as unknown as CompositeColDefShape;
    const res = compiler({ ...composite, colId: resolvedColId });
    if (!res.ok) {
      warnOnce(`[cgrid.format] composite ColDef ${resolvedColId} failed to compile: ${res.error.message}`);
      return merged;
    }
    const program = res.program;
    return {
      ...merged,
      _compositeProgram: program,
      valueFormatter: (p: CValueFormatterParams<TRow, unknown>) =>
        evalFormatProgram(program, p).text,
      cellStyle: mergeCellStyle(
        userStyleFnFrom<TRow>(merged.cellStyle),
        (p: CValueFormatterParams<TRow, unknown>) => {
          const s = evalFormatProgram(program, p).style;
          if (!s) return undefined;
          return styleObjToRecord(s);
        },
      ),
    } as CColDef<TRow>;
  }

  // Tier 0/1 path — string valueFormatter
  if (typeof merged.valueFormatter === 'string') {
    const src = merged.valueFormatter;
    const res = compiler(src);
    if (!res.ok) {
      warnOnce(`[cgrid.format] valueFormatter for ${resolvedColId} failed to compile: ${res.error.message}`);
      return merged;
    }
    const program = res.program;
    return {
      ...merged,
      valueFormatter: (p: CValueFormatterParams<TRow, unknown>) =>
        evalFormatProgram(program, p).text,
      cellStyle: mergeCellStyle(
        userStyleFnFrom<TRow>(merged.cellStyle),
        (p: CValueFormatterParams<TRow, unknown>) => {
          const s = evalFormatProgram(program, p).style;
          if (!s) return undefined;
          return styleObjToRecord(s);
        },
      ),
      cellIcon: (() => {
        const staticRef: import('@cgrid/format').IconRef | null =
          typeof merged.cellIcon === 'string' ? { name: merged.cellIcon }
          : (merged.cellIcon !== undefined && typeof merged.cellIcon === 'object') ? merged.cellIcon
          : null;
        return (p: CValueFormatterParams<TRow, unknown>) =>
          (evalFormatProgram(program, p).icon as import('@cgrid/format').IconRef | null) ?? staticRef;
      })(),
    } as CColDef<TRow>;
  }

  return merged;
}

/** Convenience wrapper — resolves an array of ColDefs with no defaults.
 *  Used primarily in tests. Cycle 21c / Task 11. */
export function resolveColDefs<TRow>(
  colDefs: CColDef<TRow>[],
  defaultColDef: Partial<CColDef<TRow>> = {},
  columnTypes: Record<string, Partial<CColDef<TRow>>> = {},
): ResolvedColDef<TRow>[] {
  return colDefs.map(cd => resolveColDef(cd, defaultColDef, columnTypes));
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
    // Reserved keyword — 'composite' is handled by compileFormatSlots, not
    // the columnTypes bundle lookup. Skip without throwing.
    if (name === 'composite') {
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

  // Cycle 21c / Task 11 — run format compilation pass on the merged ColDef.
  // When no compiler is registered this is a pass-through. The result may
  // update valueFormatter (string → function), cellStyle (user fn merged with
  // format-derived fn), cellIcon (derived fn), and _compositeProgram.
  const compiledMerged = compileFormatSlots(merged, colId);

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
    // Use compiledMerged.valueFormatter — may have been compiled from a DSL string.
    valueFormatter: compiledMerged.valueFormatter as ResolvedColDef<TRow>['valueFormatter'],
    // Icon slot — derived by compileFormatSlots when format string has {icon:...},
    // else the static string/IconRef form normalized to a constant fn.
    cellIcon: normalizeCellIcon<TRow>(compiledMerged.cellIcon),
    // Cycle 28 — leaf-header prefix/suffix icon, normalized to a fn.
    headerIcon: normalizeHeaderIcon(merged.headerIcon),
    // @internal composite program — populated by compileFormatSlots.
    _compositeProgram: (compiledMerged as unknown as { _compositeProgram?: ResolvedColDef<TRow>['_compositeProgram'] })._compositeProgram,
    // Composite alignment + overflow (Cycle 21c / Task 13) — carried
    // through so the 'composite' renderer can read them off the config.
    compositeAlign: merged.align,
    compositeOverflow: merged.overflow,
    valueParser: merged.valueParser as ResolvedColDef<TRow>['valueParser'],
    valueSetter: merged.valueSetter as ResolvedColDef<TRow>['valueSetter'],
    // Row-select checkbox columns FORCE the renderer regardless of
    // cellDataType — the checkbox state is the entire visual + the
    // column's data field is irrelevant.
    //
    // Smart default for boolean columns: when a column opts into the
    // `'checkbox'` cell editor without setting an explicit `cellRenderer`,
    // pair it with the `'checkbox'` renderer so the same three-state
    // vocabulary (true → outlined box + check, false → outlined empty
    // box, null → muted em-dash) displays without the app having to
    // wire both sides. Apps that want a boolean field to display as
    // text (e.g. rendering "yes/no" strings) can still set
    // `cellRenderer: 'text'` explicitly to opt out.
    cellRenderer: merged.checkboxSelection === true
      ? 'rowSelectCheckbox'
      : (
        merged.cellRenderer
        // Cycle 21c / Task 13 — a successfully compiled composite ColDef
        // routes to the 'composite' renderer unless the app set an
        // explicit cellRenderer. Compile failure (no _compositeProgram)
        // falls through to the plain text path so the cell still paints.
        ?? ((compiledMerged as unknown as { _compositeProgram?: unknown })._compositeProgram !== undefined ? 'composite' : null)
        ?? (merged.wrapText ? 'text-wrap' : null)
        ?? (merged.cellEditor === 'checkbox' ? 'checkbox' : cellDataType)
      ),
    cellRendererParams: merged.cellRendererParams,
    checkboxSelection: merged.checkboxSelection,
    headerCheckboxSelection: merged.headerCheckboxSelection,
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
    // compiledMerged.cellStyle may be a merged function from compileFormatSlots;
    // it goes into cellStyleFn (function form). The STATIC object slot reads
    // from the PRE-compile merged def, so an authored/override static
    // cellStyle stays visible on the resolved def even when a string
    // valueFormatter wrapped it into the merged fn — the header fold reads
    // `cellStyle.halign` to let headers follow an explicit cell alignment,
    // and the merged fn re-applies the same static keys at paint time (user
    // overlays format), so paint output is unchanged.
    cellStyle: typeof merged.cellStyle === 'object' && merged.cellStyle !== null
      ? merged.cellStyle as ColCellOverrides
      : undefined,
    cellStyleFn: typeof compiledMerged.cellStyle === 'function'
      ? compiledMerged.cellStyle as CellStyleFunc
      : undefined,
    // Cycle 27 / Task 1 — split headerStyle into object form vs function form.
    headerStyle: typeof merged.headerStyle === 'object' && merged.headerStyle !== null
      ? merged.headerStyle as ColCellOverrides
      : undefined,
    headerStyleFn: typeof merged.headerStyle === 'function'
      ? merged.headerStyle as ResolvedColDef['headerStyleFn']
      : undefined,
    // Pre-compile cellClass, cellClassRules, headerClass. Cycle 6 / Task 7.
    ...compileCellClass(merged.cellClass as CellClass | undefined),
    cellClassRules: compileCellClassRules(merged.cellClassRules as CellClassRules | undefined),
    ...compileHeaderClass(merged.headerClass as HeaderClass | undefined),
    autoHeight: merged.autoHeight,
    wrapText: merged.wrapText,
    wrapHeaderText: merged.wrapHeaderText,
    autoHeaderHeight: merged.autoHeaderHeight,
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

/** Cycle 28 — static string/IconRef cellIcon forms wrap to constant fns so
 *  byRows keeps a single call shape. */
function normalizeCellIcon<TRow>(
  v: CColDef<TRow>['cellIcon'],
): ResolvedColDef<TRow>['cellIcon'] {
  if (v === undefined) return undefined;
  if (typeof v === 'function') return v as ResolvedColDef<TRow>['cellIcon'];
  const ref = typeof v === 'string' ? { name: v } : v;
  return () => ref;
}

function normalizeHeaderIcon(
  v: import('@cgrid/format').IconRef | ((params: { colId: string }) => import('@cgrid/format').IconRef | null) | undefined,
): ((params: { colId: string }) => import('@cgrid/format').IconRef | null) | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'function') return v;
  return () => v;
}
