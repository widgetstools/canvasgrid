/**
 * Cycle 21i / Phase 1 (T4) — declarative Grid Options schema.
 *
 * The single source of truth for which runtime-mutable grid options appear
 * in the native Grid Options tool panel, band by band, with control types
 * and defaults. Lives NEXT TO `runtimeOptions.ts` deliberately: the drift
 * guard test asserts every `RUNTIME_OPTION_SET` key is either covered here
 * or explicitly excluded with a reason — new runtime options surface in the
 * panel (or in the exclusion list) the same PR they land.
 *
 * Modified-state baseline: each field's `defaultValue` is the option value
 * observed when the schema is built (normally: panel first open) falling
 * back to the kernel default — so the diff rail reads "changed from what
 * the app configured", not "changed from factory settings".
 */

import type { RuntimeOption } from './runtimeOptions';
import type {
  SettingsField,
  SettingsSection,
  SettingsSelectOption,
} from '../types/settingsSchema';

/** Minimal option surface the schema needs (subset of CGridApi). */
export interface GridOptionsAccessor {
  getGridOption(key: string): unknown;
  setGridOption(key: string, value: unknown): void;
  /** Theme/density-resolved fallbacks — when present, the Row height /
   *  Header height fields display the live effective default instead of
   *  an empty "auto" input, with a dynamic baseline that tracks density. */
  getDefaultRowHeight?(): number;
  getDefaultHeaderHeight?(): number;
  /** Theme-token accessors for the data-colour fields (row selection,
   *  cell range, flash). `resolveThemeColor` returns the effective value
   *  (override or computed default); `setThemeColor` applies an override;
   *  `getThemeColorOverride` returns only an explicit override (for the
   *  modified diff-rail baseline). When absent, the Colours band is
   *  omitted. */
  resolveThemeColor?(token: string): string;
  setThemeColor?(token: string, value: string): void;
  getThemeColorOverride?(token: string): string | undefined;
}

interface ColorFieldSpec {
  token: string;
  label: string;
  hint?: string;
}

/** Data-colour fields — these keep colour (unlike the monochrome chrome)
 *  and are user-configurable via the native color picker. Each maps to a
 *  `--cg-*` theme token applied live through `setThemeParams`. */
const COLOR_FIELDS: ColorFieldSpec[] = [
  { token: '--cg-row-hover-bg', label: 'Row hover', hint: 'Hovered row background' },
  { token: '--cg-row-selected-bg', label: 'Row selection', hint: 'Selected row background' },
  { token: '--cg-range-fill-color', label: 'Cell range fill', hint: 'Range selection interior' },
  { token: '--cg-range-border-color', label: 'Cell range border' },
  { token: '--cg-flash-from-color', label: 'Cell flash', hint: 'Change-flash colour' },
];

/** Runtime options that deliberately do NOT appear in the panel. The drift
 *  guard asserts RUNTIME_OPTION_SET == schema keys ∪ this list. */
export const GRID_OPTIONS_SCHEMA_EXCLUDED: ReadonlyMap<RuntimeOption, string> = new Map([
  ['theme', 'theme class swap is app chrome (demo/host owns the toggle)'],
  ['context', 'opaque app object, not a setting'],
  ['loading', 'transient UI state, not configuration'],
  ['debug', 'developer flag, not end-user configuration'],
  ['rowData', 'data input, not a setting'],
  ['quickFilterText', 'live filter content, belongs to a search box'],
  ['cacheQuickFilter', 'token-cache toggle with no visible effect; surfacing invites cargo-cult flips'],
  ['fillOperation', 'callback'],
  ['getContextMenuItems', 'callback'],
  ['processCellForClipboard', 'callback'],
  ['processCellFromClipboard', 'callback'],
  ['pinnedTopRowData', 'data input, not a setting'],
  ['pinnedBottomRowData', 'data input, not a setting'],
  ['aggFuncs', 'function registry, not a scalar setting'],
  ['cellSelection', 'object option; revisit when a dedicated control exists'],
  ['defaultColDef', 'covered — fanned out into the Default column band'],
  ['enableExcelEditing', 'covered — surfaced as the Excel-style option of the Edit trigger select'],
] as Array<[RuntimeOption, string]>);

const opts = (...pairs: Array<[string, string]>): SettingsSelectOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

interface FieldSpec {
  key: string;
  label: string;
  type: SettingsField['type'];
  hint?: string;
  options?: SettingsSelectOption[];
  min?: number;
  max?: number;
  step?: number;
  /** Kernel default when the option is unset. `undefined` = auto. */
  kernelDefault?: unknown;
  /** Map option value → control value (e.g. null → 'off'). */
  toControl?: (v: unknown) => unknown;
  /** Map control value → option value. */
  fromControl?: (v: unknown) => unknown;
  /** Escape hatch for a control that spans MORE than one grid option (e.g.
   *  the Edit trigger select, which reflects `singleClickEdit` +
   *  `enableExcelEditing` as one 3-way choice). When present these replace
   *  the key-based get/set; the extra option keys must be listed in
   *  GRID_OPTIONS_SCHEMA_EXCLUDED so the drift guard stays balanced. */
  getRaw?: (api: GridOptionsAccessor) => unknown;
  setRaw?: (api: GridOptionsAccessor, value: unknown) => void;
}

interface BandSpec {
  id: string;
  title: string;
  fields: FieldSpec[];
}

/** Option-key bands (everything except the defaultColDef fan-out). */
const OPTION_BANDS: BandSpec[] = [
  {
    id: 'appearance',
    title: 'Appearance',
    fields: [
      {
        key: 'density', label: 'Density', type: 'select', kernelDefault: 'normal',
        options: opts(['compact', 'Compact'], ['normal', 'Normal'], ['comfortable', 'Comfortable']),
        toControl: (v) => v ?? 'normal',
        fromControl: (v) => (v === 'normal' ? undefined : v),
      },
      { key: 'rowHeight', label: 'Row height', type: 'number', min: 16, max: 80, step: 1, hint: 'px · follows density until changed' },
      { key: 'headerHeight', label: 'Header height', type: 'number', min: 20, max: 80, step: 1, hint: 'px · follows density until changed' },
      { key: 'animateRows', label: 'Animate rows', type: 'switch', kernelDefault: false },
      { key: 'suppressRowHoverHighlight', label: 'Row hover highlight', type: 'switch', kernelDefault: false, hint: 'On = highlight the row under the pointer', toControl: (v) => v !== true, fromControl: (v) => v !== true },
      {
        key: 'domLayout', label: 'Layout', type: 'select', kernelDefault: 'normal',
        options: opts(['normal', 'Normal'], ['print', 'Print']),
        toControl: (v) => v ?? 'normal',
      },
    ],
  },
  {
    id: 'selection',
    title: 'Selection',
    fields: [
      {
        key: 'rowSelection', label: 'Row selection', type: 'select', kernelDefault: 'none',
        options: opts(['none', 'Off'], ['single', 'Single row'], ['multiple', 'Multiple rows']),
        toControl: (v) => v ?? 'none',
      },
      { key: 'suppressRowClickSelection', label: 'Ignore row clicks', type: 'switch', kernelDefault: false, hint: 'Select via checkboxes only' },
      { key: 'rowMultiSelectWithClick', label: 'Multi-select on click', type: 'switch', kernelDefault: false, hint: 'No Ctrl/Cmd needed' },
      { key: 'groupSelectsChildren', label: 'Group selects children', type: 'switch', kernelDefault: false },
    ],
  },
  {
    id: 'changeFlash',
    title: 'Change flash',
    fields: [
      { key: 'enableCellChangeFlash', label: 'Flash on change', type: 'switch', kernelDefault: false },
      { key: 'cellFlashDuration', label: 'Flash duration', type: 'number', kernelDefault: 500, min: 0, max: 5000, step: 50, hint: 'ms' },
      { key: 'cellFadeDuration', label: 'Fade duration', type: 'number', kernelDefault: 1000, min: 0, max: 10000, step: 50, hint: 'ms' },
    ],
  },
  {
    id: 'editing',
    title: 'Editing',
    fields: [
      {
        // Spans two options: `enableExcelEditing` (Excel-style) takes
        // priority, otherwise `singleClickEdit` picks single vs double.
        // `enableExcelEditing` is listed in GRID_OPTIONS_SCHEMA_EXCLUDED
        // because it is surfaced here rather than as its own control.
        key: 'singleClickEdit', label: 'Edit trigger', type: 'select', kernelDefault: 'double',
        hint: 'How a cell enters edit mode',
        options: opts(
          ['double', 'Double click'],
          ['single', 'Single click'],
          ['excel', 'Excel-style'],
        ),
        getRaw: (api) => {
          if (api.getGridOption('enableExcelEditing') === true) return 'excel';
          return api.getGridOption('singleClickEdit') === true ? 'single' : 'double';
        },
        setRaw: (api, value) => {
          const excel = value === 'excel';
          api.setGridOption('enableExcelEditing', excel);
          // Excel entry is double-click / F2 / type-to-edit, so single-click
          // edit is turned off when Excel-style is selected.
          api.setGridOption('singleClickEdit', value === 'single');
        },
      },
      { key: 'suppressClickEdit', label: 'Disable click editing', type: 'switch', kernelDefault: false, hint: 'Edit only via F2 / Enter' },
    ],
  },
  {
    id: 'clipboardFill',
    title: 'Clipboard & fill',
    fields: [
      {
        key: 'clipboardDelimiter', label: 'Copy delimiter', type: 'select', kernelDefault: '\t',
        options: opts(['\t', 'Tab (TSV)'], [',', 'Comma (CSV)'], [';', 'Semicolon'], ['|', 'Pipe']),
        toControl: (v) => v ?? '\t',
      },
      { key: 'suppressClipboardApi', label: 'Disable clipboard API', type: 'switch', kernelDefault: false },
      { key: 'suppressClipboardPaste', label: 'Block paste', type: 'switch', kernelDefault: false },
      { key: 'suppressContextMenu', label: 'Disable context menu', type: 'switch', kernelDefault: false },
      { key: 'enableFillHandle', label: 'Fill handle', type: 'switch', kernelDefault: false },
      {
        key: 'fillHandleDirection', label: 'Fill direction', type: 'select', kernelDefault: 'y',
        options: opts(['y', 'Vertical'], ['x', 'Horizontal'], ['xy', 'Both']),
        toControl: (v) => v ?? 'y',
      },
    ],
  },
  {
    id: 'grouping',
    title: 'Grouping',
    fields: [
      {
        key: 'rowGroupPanelShow', label: 'Group panel', type: 'select', kernelDefault: 'never',
        options: opts(['never', 'Hidden'], ['onlyWhenGrouping', 'When grouping'], ['always', 'Always']),
        toControl: (v) => v ?? 'never',
      },
      { key: 'rowGroupPanelSuppressSort', label: 'No sort from panel', type: 'switch', kernelDefault: false, hint: 'Panel chips stop cycling sort' },
      { key: 'suppressCount', label: 'Hide group counts', type: 'switch', kernelDefault: false },
      { key: 'suppressAggFuncInHeader', label: 'Hide agg in header', type: 'switch', kernelDefault: false, hint: 'P&L, not sum(P&L)' },
    ],
  },
  {
    id: 'pivot',
    title: 'Pivot',
    fields: [
      {
        key: 'pivotPanelShow', label: 'Pivot panel', type: 'select', kernelDefault: 'never',
        options: opts(['never', 'Hidden'], ['onlyWhenPivoting', 'When pivoting'], ['always', 'Always']),
        toControl: (v) => v ?? 'never',
      },
      {
        key: 'pivotRowTotals', label: 'Row totals', type: 'select', kernelDefault: 'off',
        options: opts(['off', 'Off'], ['before', 'Before'], ['after', 'After']),
        toControl: (v) => v ?? 'off',
        fromControl: (v) => (v === 'off' ? null : v),
      },
      {
        key: 'pivotColumnGroupTotals', label: 'Column group totals', type: 'select', kernelDefault: 'off',
        options: opts(['off', 'Off'], ['before', 'Before'], ['after', 'After']),
        toControl: (v) => v ?? 'off',
        fromControl: (v) => (v === 'off' ? null : v),
      },
      { key: 'pivotDefaultExpanded', label: 'Expand to depth', type: 'number', kernelDefault: 0, min: 0, max: 10, step: 1 },
      { key: 'pivotGrandTotals', label: 'Grand totals', type: 'switch', kernelDefault: false, hint: 'Excel-style pinned totals' },
      { key: 'enableStrictPivotColumnOrder', label: 'Strict column order', type: 'switch', kernelDefault: false, hint: 'Re-sort keys every update' },
      { key: 'pivotMaxGeneratedColumns', label: 'Max generated columns', type: 'number', kernelDefault: 5000, min: 0, step: 100 },
    ],
  },
  {
    id: 'quickFilter',
    title: 'Quick filter',
    fields: [
      { key: 'includeHiddenColumnsInQuickFilter', label: 'Search hidden columns', type: 'switch', kernelDefault: false },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    fields: [
      { key: 'rowBuffer', label: 'Row buffer', type: 'number', min: 0, max: 100, step: 1, hint: 'Overscan rows (empty = auto)' },
      { key: 'asyncTransactionWaitMillis', label: 'Async txn wait', type: 'number', min: 0, max: 5000, step: 10, hint: 'ms (empty = auto)' },
      { key: 'suppressColumnVirtualisation', label: 'No column virtualisation', type: 'switch', kernelDefault: false },
      { key: 'suppressRowVirtualisation', label: 'No row virtualisation', type: 'switch', kernelDefault: false },
    ],
  },
];

// `cacheQuickFilter` intentionally lives in the exclusion map (its effect —
// token caching — is invisible; surfacing it invites cargo-cult toggling).
// `includeHiddenColumnsInQuickFilter` IS user-visible, so it stays.

/** Default-column band: each field reads/writes ONE property of the single
 *  `defaultColDef` runtime option (fan-out per decision D-A). */
const DEFAULT_COL_DEF_FIELDS: Array<{
  prop: string;
  label: string;
  type: SettingsField['type'];
  hint?: string;
  min?: number;
  max?: number;
}> = [
  { prop: 'resizable', label: 'Resizable', type: 'checkbox' },
  { prop: 'sortable', label: 'Sortable', type: 'checkbox' },
  { prop: 'editable', label: 'Editable', type: 'checkbox' },
  { prop: 'suppressMovable', label: 'Lock position', type: 'checkbox' },
  { prop: 'wrapText', label: 'Wrap text', type: 'checkbox' },
  { prop: 'wrapHeaderText', label: 'Wrap header text', type: 'checkbox', hint: 'Multi-line column headers' },
  { prop: 'autoHeaderHeight', label: 'Auto header height', type: 'checkbox', hint: 'Header row fits wrapped text' },
  { prop: 'enableRowGroup', label: 'Groupable', type: 'checkbox', hint: 'Drag into row groups' },
  { prop: 'enablePivot', label: 'Pivotable', type: 'checkbox', hint: 'Drag into column labels' },
  { prop: 'enableValue', label: 'Aggregatable', type: 'checkbox', hint: 'Drag into values' },
  { prop: 'width', label: 'Width', type: 'number', min: 20, max: 1000 },
  { prop: 'minWidth', label: 'Min width', type: 'number', min: 10, max: 500 },
  { prop: 'maxWidth', label: 'Max width', type: 'number', min: 20, max: 2000 },
  { prop: 'flex', label: 'Flex', type: 'number', min: 0, max: 10 },
];

/** Every RuntimeOption key the schema covers (drift-guard counterpart of
 *  GRID_OPTIONS_SCHEMA_EXCLUDED). */
export const GRID_OPTIONS_SCHEMA_KEYS: ReadonlySet<string> = new Set(
  OPTION_BANDS.flatMap((b) => b.fields.map((f) => f.key)),
);

/**
 * Build the live Grid Options section over an accessor. `defaultValue`
 * baselines are captured NOW (see module doc) — build once per panel
 * instance, not per render.
 */
export function buildGridOptionsSchema(api: GridOptionsAccessor): SettingsSection {
  const bands = OPTION_BANDS.map((band) => ({
    id: band.id,
    title: band.title,
    fields: band.fields.map((spec): SettingsField => {
      // Row/header height show the LIVE theme/density-resolved value and
      // baseline against it dynamically — the diff rail marks only an
      // explicit override, and the shown default follows density swaps.
      const themeDefault =
        spec.key === 'rowHeight' && api.getDefaultRowHeight
          ? () => api.getDefaultRowHeight!()
          : spec.key === 'headerHeight' && api.getDefaultHeaderHeight
            ? () => api.getDefaultHeaderHeight!()
            : null;
      if (themeDefault) {
        return {
          key: spec.key,
          label: spec.label,
          type: spec.type,
          hint: spec.hint,
          min: spec.min,
          max: spec.max,
          step: spec.step,
          defaultValue: themeDefault,
          get: () => (api.getGridOption(spec.key) as number | undefined) ?? themeDefault(),
          set: (value) => api.setGridOption(spec.key, value),
        };
      }
      // Multi-option controls (getRaw/setRaw) bypass the single-key path
      // and read/write several grid options as one composite control value.
      if (spec.getRaw && spec.setRaw) {
        const getRaw = spec.getRaw;
        const setRaw = spec.setRaw;
        return {
          key: spec.key,
          label: spec.label,
          type: spec.type,
          hint: spec.hint,
          options: spec.options,
          min: spec.min,
          max: spec.max,
          step: spec.step,
          defaultValue: getRaw(api),
          get: () => getRaw(api),
          set: (value) => setRaw(api, value),
        };
      }
      const toControl = spec.toControl ?? ((v: unknown) => v ?? spec.kernelDefault);
      const fromControl = spec.fromControl ?? ((v: unknown) => v);
      const baseline = toControl(api.getGridOption(spec.key));
      return {
        key: spec.key,
        label: spec.label,
        type: spec.type,
        hint: spec.hint,
        options: spec.options,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        defaultValue: baseline,
        get: () => toControl(api.getGridOption(spec.key)),
        set: (value) => api.setGridOption(spec.key, fromControl(value)),
      };
    }),
  }));

  const dcd = () => (api.getGridOption('defaultColDef') ?? {}) as Record<string, unknown>;
  bands.push({
    id: 'defaultColDef',
    title: 'Default column',
    fields: DEFAULT_COL_DEF_FIELDS.map((spec): SettingsField => {
      const baseline = dcd()[spec.prop];
      return {
        key: `defaultColDef.${spec.prop}`,
        label: spec.label,
        type: spec.type,
        hint: spec.hint,
        min: spec.min,
        max: spec.max,
        defaultValue: spec.type === 'checkbox' ? (baseline ?? false) : baseline,
        get: () => {
          const v = dcd()[spec.prop];
          return spec.type === 'checkbox' ? v === true : v;
        },
        set: (value) => {
          const next = { ...dcd() };
          if (value === undefined) delete next[spec.prop];
          else next[spec.prop] = value;
          api.setGridOption('defaultColDef', next);
        },
      };
    }),
  });

  // Colours band — data colours via the native color picker (theme
  // tokens). Only when the accessor exposes the theme-colour surface.
  if (api.resolveThemeColor && api.setThemeColor) {
    const resolve = api.resolveThemeColor.bind(api);
    const setColor = api.setThemeColor.bind(api);
    const getOverride = api.getThemeColorOverride?.bind(api);
    bands.push({
      id: 'colors',
      title: 'Colours',
      fields: COLOR_FIELDS.map((spec): SettingsField => ({
        key: spec.token,
        label: spec.label,
        type: 'color',
        hint: spec.hint,
        // Baseline = explicit override if present, else the resolved
        // theme default — so the diff rail marks only user-set colours.
        defaultValue: () => getOverride?.(spec.token) ?? resolve(spec.token),
        get: () => resolve(spec.token),
        set: (value) => setColor(spec.token, String(value)),
      })),
    });
  }

  return { id: 'gridOptions', title: 'Grid Options', bands };
}
