# 13 — bulk-update

> Set all selected cells in one column to a single value (text/number/date), optionally picked from a dropdown of distinct values in that column. Built on [editing-core](01-editing-core.md).

## Purpose

"Change all 47 `Status = Pending` rows to `Status = Approved`." Faster than per-cell editing; safer than find-replace.

## Config schema

```ts
interface BulkUpdateState {
  settings: BulkUpdateSettings;
}

interface BulkUpdateSettings {
  enabled: boolean;
  confirmThreshold: number;            // confirmation if > N cells (0 = never)
  showDistinctValues: boolean;         // populate dropdown
  maxDropdownValues: number;           // cap distinct fetch (default 20)
  enforceSingleColumn: boolean;        // one column only
  recordHistory: boolean;              // log to edit journal
}
```

## Runtime behavior

### Target collection

`collectBulkUpdateTargets(api, getRowId)` — same range-first / focused-fallback pattern as smart-edit, but filters for **text, number, or date** cell types (not just numeric). Boolean is excluded; checkboxes have their own bulk flow.

### Distinct values

```ts
function resolveColumnDistinctValues(api, colId, limit): unknown[] {
  const seen = new Set<unknown>();
  api.forEachNodeAfterFilterAndSort(node => {
    const v = node.data[colId];
    if (v != null && !seen.has(v)) seen.add(v);
    if (seen.size >= limit) return false;   // stop iteration
  });
  return [...seen].sort(naturalCompare);    // numbers first, then strings
}
```

Scans the **currently-displayed** row set (respects filter + sort). Fresh on each open — no cache.

### Value parsing

```ts
function parseBulkUpdateValue(raw: string, cellDataType: ColumnDataType): unknown | null {
  switch (cellDataType) {
    case 'number':   return parseFloat(raw) || null;
    case 'date':     return parseISODate(raw);      // → ISO 8601 string
    case 'dateTime': return parseISODateTime(raw);
    default:         return raw;                     // text passes through
  }
}
```

Returns `null` on parse failure; downstream skips. Dates normalized to ISO format (`YYYY-MM-DD`) for consistency.

### Patch generation

```ts
function buildBulkUpdatePatches(targets, newValue): CellPatch[] {
  return targets
    .filter(t => !Object.is(t.value, newValue))     // skip no-op
    .map(t => ({ rowId: t.rowId, colId: t.colId, field: t.field, oldValue: t.value, newValue }));
}
```

`Object.is()` guards against creating patches for cells already equal to the new value.

## UI surface

Host renders:
- "Bulk Update" toolbar button (active when a range is selected on a single column)
- Dialog: column name (read-only), input field (text/number/date appropriate to column type), optional dropdown of distinct values
- Confirmation if > `confirmThreshold` cells

## Persistence

Settings only. Schema version 1.

## Dependencies

- [editing-core](01-editing-core.md): `CellPatch` type

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/bulk-update/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/bulk-update/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/bulk-update/collectBulkUpdateTargets.ts](../../../starui/packages/shared/engine/src/customizer/modules/bulk-update/collectBulkUpdateTargets.ts)
- [../starui/packages/shared/engine/src/customizer/modules/bulk-update/applyBulkUpdate.ts](../../../starui/packages/shared/engine/src/customizer/modules/bulk-update/applyBulkUpdate.ts)
- [../starui/packages/shared/engine/src/customizer/modules/bulk-update/resolveColumnDistinctValues.ts](../../../starui/packages/shared/engine/src/customizer/modules/bulk-update/resolveColumnDistinctValues.ts)

## Design decisions worth copying

- **Type-aware parsing.** Cell `cellDataType` determines parsing strategy. Bad input rejected silently (returns null, no patches, no error noise).
- **Display-time distinct fetching, not cached.** Always reflects current filtered/grouped data. Avoids stale dropdowns.
- **Same-value skip via `Object.is()`.** No-op patches never reach the journal. Keeps undo clean and avoids unnecessary writes.
- **Bounded distinct fetch (`maxDropdownValues`).** 20 is the right default — covers most enum-style columns without scanning the whole dataset on every open. UI should label "20 of N values" if truncated.
- **Date normalization.** Always ISO 8601 in the stored value, regardless of how the user typed it. One source of truth.

## cgrid translation

Same pattern as [smart-edit](12-smart-edit.md). Additional concern:

**Distinct values fetch on a worker dataset.** cgrid holds row data in the worker. The main thread can't `forEachNodeAfterFilterAndSort` synchronously. Options:

1. **Async fetch via worker RPC.** Add `workerClient.getDistinctValues(colId, limit)` that scans the worker's filtered/sorted dataset. Returns within ~50ms for 100K rows. Block the dropdown with a brief spinner while loading.
2. **Reuse the existing set-filter values fetch.** cgrid's set filter already needs this; reuse that path.

Option 2 is preferred — distinct-values fetch is a generic worker capability, not a bulk-update concern.
