# 05 — column-customization

> The central hub of the customizer. Per-column overrides + global baselines for headers, filters, styling, editors, row-grouping. Consumed by half the other modules.

## Purpose

Let users override almost any column setting (header name, filter type, editor, formatter, styling) without touching the developer-authored `columnDefs`. Also exposes global defaults that apply when a per-column value isn't set.

## Config schema

```ts
interface ColumnCustomizationState {
  assignments: { [colId: string]: ColumnAssignment };
  globalCellStyle?: ThemedCellStyleOverrides;       // dark + light
  globalHeaderStyle?: ThemedCellStyleOverrides;
  globalCellNumberFormatter?: ValueFormatterTemplate;
  globalCellDateFormatter?: ValueFormatterTemplate;
}

interface ColumnAssignment {
  colId: string;
  headerName?: string;
  cellStyleOverrides?: ThemedCellStyleOverrides;    // per-theme typography/colors/alignment/borders
  headerStyleOverrides?: ThemedCellStyleOverrides;
  filter?: ColumnFilterConfig;
  rowGrouping?: RowGroupingConfig;
  cellEditor?: ColumnCellEditorConfig;
  valueFormatterTemplate?: ValueFormatterTemplate;
  cellRendererName?: string;
  editable?: boolean;
  templateIds?: string[];                            // refs to column-templates
  // ... AG-Grid pass-throughs: sortable, resizable, pinned, etc.
}

interface ColumnFilterConfig {
  kind: FilterKind;                                  // text | number | date | set | multi | streamSafe...
  floatingFilter?: boolean;
  setFilterOptions?: { values?: string[]; refreshValuesOnOpen?: boolean };
  multiFilters?: FilterKind[];
}

interface RowGroupingConfig {
  enableRowGroup?: boolean;
  aggFunc?: string;                                  // 'sum' | 'avg' | custom name | 'expression'
  customAggExpression?: string;                      // when aggFunc === 'expression'
}

interface ColumnCellEditorConfig {
  kind: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'autocomplete';
  values?: string[];                                 // static dropdown values
  valuesSource?: string;                             // dynamic: '{{provider.key}}' resolved from platform.resources.appData
  params?: Record<string, unknown>;                  // editor-specific
}
```

## Runtime behavior

### Transform pipeline

`applyAssignments(baseColDefs, state, templates)` walks the colDef tree recursively, applying assignments per colId. Order matters: each colDef is the result of folding:

```
typeDefault template (if assignment.templateIds undefined)
  → templateIds chain (left to right)
    → globalCellStyle / globalHeaderStyle baselines
      → assignment (highest priority)
```

### Memoization

`COL_DEF_MEMO: WeakMap<ColumnAssignment, ColDef>` caches output by assignment-reference + templates-reference + globals-reference. If the signature hasn't changed, return the cached colDef. Critical because AG-Grid's `setColumnDefs` re-validates filters every time — without memoization, every state change re-creates `filterParams` objects and triggers an internal `SetFilterHandler` re-validation that can crash in v35.1.

### CSS injection

`reinjectCSS(state)` emits per-colId style rules into a single managed stylesheet keyed by colId. Theme-scoped (dark vs light selectors). Re-runs on every transform pass. Stale rules replaced cleanly via stable keys.

### Global formatter dispatch

Untyped columns (no per-column formatter, no cellDataType hint) get a safe runtime dispatcher:

```ts
function dispatchFormatter(value) {
  if (value instanceof Date) return dateFormatter(value);
  if (typeof value === 'number') return numberFormatter(value);
  return String(value ?? '');
}
```

Why: `Apple` formatted as a number → `NaN` → empty cell. The dispatcher sniffs the value, not the schema.

### Filter composition

`applyFilterConfigToColDef()` synthesizes the AG-Grid `filter` + `filterParams` + `floatingFilter`. Maps synthetic kinds (`streamSafeMultiColumnFilter`) to multi-filter compositions plus custom floating-filter components. The synthetic kinds exist to dodge specific AG-Grid bugs — won't apply to cgrid.

### Custom aggregation

`rowGrouping.customAggExpression` compiles through the expression engine. The aggregation function receives `[value]` as the array of child values and runs the user expression, e.g. `SUM([value]) * 1.1`.

## UI surface

None in engine. Host renders:
- Formatter toolbar: quick picks for typography/color/alignment/filter kind (one column at a time)
- Column settings panel: full assignment editor with tabs (header, style, filter, editor, grouping, formatter)
- Auto-format workflow: field-catalog driven (e.g. "apply currency to all `_usd` columns")

## Persistence

`assignments` keyed by colId; global slots at module root. Profile system handles the rest.

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/column-customization/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-customization/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/column-customization/transforms.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-customization/transforms.ts)
- [../starui/packages/shared/engine/src/customizer/modules/column-customization/formattingActions.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-customization/formattingActions.ts)

## Design decisions worth copying

- **Both-theme write on auto-format.** When the user picks an alignment or font, write to BOTH light AND dark slots, not just the active theme. Survives theme flips without re-emitting colDefs.
- **Per-column memo by signature.** Prevents O(n) filter re-validation on every state change.
- **Global formatter type dispatch.** A single safe formatter per type catches mixed-data columns; per-column formatters override.
- **Custom aggregation via expression engine.** Reuses the same DSL — `SUM([value]) * 1.1` style aggregation without a separate config schema.
- **ColId encoding for CSS class names.** `a.b.c` → `a_2eb_2ec` via `cssEscapeColId()`. Nested fields can't accidentally form CSS selector chains. Share this helper across modules.
- **Template chain folded left-to-right.** Predictable precedence; last wins per field except styles which merge per-field.

## cgrid translation

This is the largest module to port and the most cgrid-friendly — all the seams already exist:

| Concern | cgrid surface |
|---|---|
| Header name override | `colDef.headerName` |
| Per-cell style | `colDef.cellStyle` (function) |
| Filter type | `colDef.filter` + `filters/` registry |
| Cell renderer | `cellRendererRegistry` |
| Cell editor | `cellEditorRegistry` |
| Formatter | `colDef.valueFormatter` |
| Aggregation | `aggFuncs` worker bridge (already supports `Function.toString()`) |
| Row grouping toggle | `colDef.enableRowGroup` (verify) |
| CSS injection | New `CssHandle` utility (lightweight) |

Build order within this module: start with header + style overrides (visible immediately), then add formatter, then filter, then editor, then row-grouping last. Each is independently testable.

Don't replicate the `streamSafeMultiColumnFilter` synthetic kind — that exists for AG-Grid bug avoidance and has no cgrid equivalent.
