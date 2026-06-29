# 12 — smart-edit

> Multi-cell numeric ops (×, ÷, +, −, =) on ranges or focused cells. Plus K/M/B suffix parsing in cell editors. Built on [editing-core](01-editing-core.md).

## Purpose

Trader-friendly bulk arithmetic. Select a range of "Price" cells, click ×, enter `1.1`, every cell gets multiplied by 1.1. Plus inline magnitude parsing: typing `1.5M` in a cell editor parses as 1,500,000.

## Config schema

```ts
interface SmartEditState {
  settings: SmartEditSettings;
}

interface SmartEditSettings {
  enabled: boolean;
  incrementStep: number;                       // default +/- step
  magnitudeShortcutsEnabled: boolean;          // parse K/M/B in editors
  enabledOps: SmartEditOp[];                   // which buttons appear in toolbar
  confirmThreshold: number;                    // confirmation if > N cells (0 = never)
  enforceSingleColumn: boolean;                // one column per apply
  previewBeforeApply: boolean;                 // show preview table first
  recordHistory: boolean;                      // log to edit journal
}

type SmartEditOp = 'multiply' | 'divide' | 'add' | 'subtract' | 'set';
```

## Runtime behavior

### Target collection

```ts
function collectTargetCells(api, getRowId): CellTarget[] {
  const ranges = api.getCellRanges();
  if (ranges.length === 0) {
    return collectFocusedCell(api, getRowId);  // fallback
  }
  return rangesToTargets(ranges)
    .filter(c => isNumericCellDataType(c))
    .filter(c => isEditable(c))
    .filter(dedupeByRowAndCol);
}
```

Range first; focused cell as fallback. Filters out non-numeric, non-editable, and dedups.

### Operation

```ts
function applyNumericOp(current: number, op: SmartEditOp, operand: number): number | null {
  if (current == null || !isFinite(current)) return null;
  switch (op) {
    case 'multiply': return current * operand;
    case 'divide':   return operand === 0 ? null : current / operand;
    case 'add':      return current + operand;
    case 'subtract': return current - operand;
    case 'set':      return operand;
  }
}
```

`null` return = skip (e.g., divide by zero, non-numeric current). Patches filter out nulls so no-op cells silently skipped.

### Magnitude parsing

`parseMagnitudeSuffix('1.5M')` returns `1500000`. Cases: `K`/`k` = 1e3, `M`/`m` = 1e6, `B`/`b` = 1e9. Plain numbers pass through unchanged. Invalid strings return `null`.

Wired into column defs via `applySmartEditColDefTransforms()` which wraps each numeric column's `valueParser`:

```ts
colDef.valueParser = (params) => {
  const original = colDef.valueParser?.(params) ?? params.newValue;
  if (typeof params.newValue !== 'string') return original;
  const parsed = parseMagnitudeSuffix(params.newValue);
  return parsed ?? original;
};
```

### Workflow

```
User selects range → clicks "×" button → operand dialog opens →
  if previewBeforeApply: show preview table (old → new), warnings if invalid
  if cells > confirmThreshold: confirmation dialog
  apply: buildPatchesFromTargets(targets, cell => applyNumericOp(cell.value, op, operand))
  journal.record({ source: 'smart-edit', label: '× 1.1', patches })
```

## UI surface

Host renders:
- Toolbar buttons for each enabled op (× ÷ + − =)
- Operand input dialog (numeric input)
- Preview table (if `previewBeforeApply`)
- Confirmation dialog (if > `confirmThreshold`)
- (No UI in engine layer — magnitude parsing is invisible, just appears in the editor)

## Persistence

Settings only. Schema version 2.

## Dependencies

- [editing-core](01-editing-core.md): `buildPatchesFromTargets`, `CellPatch`, journal

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/smart-edit/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/smart-edit/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/smart-edit/collectTargetCells.ts](../../../starui/packages/shared/engine/src/customizer/modules/smart-edit/collectTargetCells.ts)
- [../starui/packages/shared/engine/src/customizer/modules/smart-edit/operations.ts](../../../starui/packages/shared/engine/src/customizer/modules/smart-edit/operations.ts)
- [../starui/packages/shared/engine/src/customizer/modules/smart-edit/parseMagnitudeSuffix.ts](../../../starui/packages/shared/engine/src/customizer/modules/smart-edit/parseMagnitudeSuffix.ts)
- [../starui/packages/shared/engine/src/customizer/modules/smart-edit/transforms.ts](../../../starui/packages/shared/engine/src/customizer/modules/smart-edit/transforms.ts)

## Design decisions worth copying

- **Magnitude parsing as a `valueParser` transform.** Doesn't require a custom editor; layers onto whatever editor the column already uses. Reusable.
- **Dual-mode target collection.** Range first, focused cell fallback. Don't block if there's no selection.
- **Null-on-failure semantics.** `applyNumericOp` returns `null` for divide-by-zero / non-numeric. Patches filter nulls. No silent corruption, no error dialogs for trivial cases.
- **Reusable `applyNumericOp`.** Same function consumed by plus-minus and shortcuts. Centralized arithmetic.
- **`enforceSingleColumn` flag.** Trader workflow prefers one-column ops to prevent accidental multi-column writes. Optional but on by default.

## cgrid translation

Build after [editing-core](01-editing-core.md). Needs:

1. **Range selection API.** cgrid has a `rangeSelection` feature already. Verify `getCellRanges()` equivalent returns `{ startRow, endRow, columnIds }` style.
2. **`valueParser` on column def.** Verify cgrid passes user-typed strings through `valueParser` before commit. If not, add the hook.
3. **`getCellEditable()` predicate.** Need a way to ask the grid whether a cell is editable — column-customization's `editable` + per-cell predicates. cgrid's editor coordinator probably already exposes this.

Magnitude parsing is the biggest UX win. Most numeric editors today force `1500000` typed manually. K/M/B parsing is ~20 LOC, saves real time.
