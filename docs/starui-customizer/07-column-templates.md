# 07 — column-templates

> Reusable bundles of column config that chain by ID. Type-defaults as fallback when no template explicitly assigned.

## Purpose

Stop users re-authoring the same currency format / right-align / set-filter combo for every numeric column. Define a "Currency" template once, apply it to N columns by ID. Compose multiple templates per column (e.g. "Currency" + "Highlight-on-negative" + per-column override).

## Config schema

```ts
interface ColumnTemplatesState {
  templates: { [templateId: string]: ColumnTemplate };
  typeDefaults: {                          // applied when assignment.templateIds === undefined
    numeric?: templateId;
    date?: templateId;
    string?: templateId;
    boolean?: templateId;
  };
}

interface ColumnTemplate {
  id: string;
  name: string;
  description?: string;

  // styling (per-theme)
  cellStyleOverrides?: ThemedCellStyleOverrides;
  headerStyleOverrides?: ThemedCellStyleOverrides;

  // behavior
  valueFormatterTemplate?: ValueFormatterTemplate;
  sortable?: boolean;
  filterable?: boolean;
  resizable?: boolean;
  editable?: boolean;
  cellEditorName?: string;
  cellEditorParams?: Record<string, unknown>;
  cellEditor?: ColumnCellEditorConfig;         // structured form (kind, values, valuesSource)
  cellRendererName?: string;
  filter?: ColumnFilterConfig;
  rowGrouping?: RowGroupingTemplate;           // capability only — no rowGroup/pivot live state

  createdAt: number;
  updatedAt: number;
}
```

Note what's **excluded** from templates: `colId`, `headerName`, `initialWidth`, `initialPinned`, `initialHide`. These are column-identity, not capability — they belong on the assignment.

## Runtime behavior

### Chain resolution

`resolveTemplates(assignment, state, dataType)` folds the chain left-to-right:

```
typeDefault (only if assignment.templateIds === undefined)
  → templateIds[0]
    → templateIds[1]
      → ...
        → templateIds[N]
          → assignment (highest priority)
```

### Merge semantics

- **Styles merge per-field per-theme.** Theme-aware: `cellStyleOverrides.light.color` from template 1 + `cellStyleOverrides.dark.backgroundColor` from template 2 both survive.
- **Everything else: last-writer-wins wholesale.** `filter`, `rowGrouping`, `cellEditorParams` are opaque blobs — later template's value replaces earlier wholesale, no deep merge.

### Fallback semantics

- `templateIds === undefined` → typeDefault applies
- `templateIds === []` (explicit empty array) → opt out of fallback, no template applied
- `templateIds === ['foo']` and `foo` doesn't exist → silently skip, keep going. Profile-portability matters more than strict error.

### Snapshot / restore

`snapshotTemplate(colId, api)` reads the column's current state and writes a new template. `createTemplateFromSnapshot()` is the "Save as template" flow.

### Lifecycle independence

Deleting a template does NOT cascade-delete assignments. Column-customization's `removeTemplateRefFromAssignmentsReducer()` prunes dangling references after the fact. Reason: users may want to delete a template without losing column overrides that referenced it.

## UI surface

None in engine. Host renders:
- Template library panel: list, edit, delete, set-as-type-default
- "Apply template" picker in column settings (multi-select for chaining)
- "Save as template" button in the formatter toolbar
- Auto-format flow: preset templates for common data types

## Persistence

```ts
{
  templates: { [id]: ColumnTemplate },
  typeDefaults: { numeric?, date?, string?, boolean? }
}
```

`INITIAL_COLUMN_TEMPLATES` is deep-frozen via `Object.freeze` so accidental mutations throw in strict mode.

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/column-templates/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-templates/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/column-templates/resolveTemplates.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-templates/resolveTemplates.ts)
- [../starui/packages/shared/engine/src/customizer/modules/column-templates/snapshotTemplate.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-templates/snapshotTemplate.ts)

## Design decisions worth copying

- **No identity fields in templates.** colId, headerName, width, pinned — all assignment-only. Keeps templates portable across columns.
- **Capability-only row-grouping.** Drop `rowGroup`, `rowGroupIndex`, `pivot`, `pivotIndex` from templates; keep only `enableRowGroup`, `aggFunc`, etc. Otherwise applying a grouping template would claim a slot in the grid's live group/pivot layout.
- **Per-field merge for styles, last-writer-wins for blobs.** Sensible mix — partial style merges feel natural; partial filter merges create undebuggable Frankenstein configs.
- **Type-default as escape hatch.** "All number columns get currency" without per-column authoring. Especially useful when colIds are dynamic (data-import scenarios).
- **Deep-frozen initial state.** Catches mutation bugs in dev. Cheap insurance.
- **Lifecycle independence + lazy prune.** Don't cascade-delete; prune dangling refs lazily. Lets users restore deleted templates without losing assignments.

## cgrid translation

Direct fit — column-templates is pure config logic. No grid-side machinery needed. Build alongside or just after column-customization.

One thing to verify in velocity-grid: the cell editor registration. Templates reference editors by name (`cellEditorName: 'currency'`). cgrid's `cellEditorRegistry` already supports this; just make sure the registry is exposed to the resolver.
