# 15 — Bulk Update Toolbar

> Inline toolbar row for setting all selected cells in a column to one value. Optional dropdown of distinct values.

Engine module: [bulk-update](../starui-customizer/13-bulk-update.md). See [10-bulk-update](10-bulk-update.md) for the settings panel.

## Purpose

Replace all values in a selection with a single value — non-arithmetic, for text/number/date columns. Complements [smart-edit toolbar](14-smart-edit-toolbar.md).

## Invocation

Optional row in the editing toolbar (visible when `BulkUpdateState.enabled`).

## Layout

```
[Bulk] [value: typed or dropdown ▼] [Apply ▶] ← {count} selected
```

Compact. The value input type adapts to the selection's column data type (text / number / date).

## Component tree

- **BulkUpdateToolbar** → thin wrapper
- **BulkUpdateToolbarBody**
  - EditingToolbarSegment (chrome shared with smart-edit toolbar)
  - Value `<input>` — `type` inferred from column dataType (text / number / date)
  - Conditional **Select** dropdown — distinct values (when `showDistinctValues` enabled AND values exist)
  - **EditingToolbarApplyButton** with tooltip
  - AlertDialog — threshold confirm

## Props

`BulkUpdateToolbarBody({ layout? })` — same `'standalone' | 'segment'` as smart-edit.

## Internal state

- `value`: pending replacement value (text / number / date string)
- `confirmOpen`: threshold dialog state

## Interaction flows

**Apply replacement:**
```
user selects cells in one column → distinct-values dropdown populates (if enabled) →
  user types new value OR picks from dropdown → clicks Apply →
  if count > threshold: AlertDialog → confirm → apply
  else: apply immediately →
  applyBulkUpdateEdits(api, targets, value, { journal, journalLabel })
```

**Type-inferred input:**
```
column data type (from first selected cell) →
  bulkUpdateValueKind() returns 'text' | 'number' | 'date' → input type adapts
```

## Engine wiring

- **State**: `BulkUpdateState` (settings)
- **Distinct values**: `resolveColumnDistinctValues(api, colId, maxDropdownValues)` — async fetch from worker
- **Value kind**: `bulkUpdateValueKind(cellDataType)` — inference helper
- **Commit**: `applyBulkUpdateEdits()` — atomic, optional journal

## Shared primitives used

- EditingToolbarSegment, EditingToolbarApplyButton
- Input, Select (base UI library)
- AlertDialog

## Design decisions worth copying

1. **Distinct-values opt-in.** Dropdown only appears if `showDistinctValues` is enabled AND there are values to show. Avoids cluttering with a disabled dropdown when column is new or sparse.

2. **Type-inferred input.** No caller configuration needed — toolbar auto-detects input type from the first selected cell. Falls back to text if inference fails.

3. **One-column constraint.** When `enforceSingleColumn`, multi-column selection disables Apply with tooltip. Bulk update assumes a single target column (otherwise "set all to 'Active'" doesn't make sense across heterogeneous columns).

4. **Async distinct-values fetch.** Doesn't block the toolbar render. Show a brief spinner; populate when ready.

## cgrid translation

1. **`<cgrid-bulk-update-toolbar>`** as a Lit element.
2. **Reuse `<cgrid-editing-toolbar-segment>`** from smart-edit toolbar.
3. **Distinct-values fetch via worker RPC.** Add a `workerClient.getDistinctValues(colId, limit)` method — also useful for set-filter, so it's a shared addition (see engine doc).
4. **Type-inferred input**: read column metadata from grid API; map to input type.

Build in Phase 5 alongside smart-edit toolbar.
