# 14 — plus-minus

> +/− keyboard nudges on numeric cells, with per-column expression-gated rules. Built on [editing-core](01-editing-core.md) and the [expression engine](README.md#1-expression-engine).

## Purpose

Press `+` on a numeric cell, value goes up by the rule's step. Press `−`, down. Rules can be scoped by column and optionally gated by an expression — e.g., "nudge `Quantity` only when `Status = 'active'`".

## Config schema

```ts
interface PlusMinusState {
  settings: PlusMinusSettings;
  nudges: PlusMinusNudge[];
}

interface PlusMinusSettings {
  enabled: boolean;
  recordHistory: boolean;
}

interface PlusMinusNudge {
  id: string;
  name: string;                // display name, e.g. "Qty +1"
  enabled: boolean;
  scope: PlusMinusNudgeScope;
  expression?: string;         // optional row-condition; falsy = nudge skipped
  incrementStep: number;       // + key value
  decrementStep?: number;      // − key value (defaults to incrementStep)
}

interface PlusMinusNudgeScope {
  columnIds: string[];         // empty = all numeric columns
}
```

## Runtime behavior

### Keyboard interception

`applyPlusMinusColDefTransforms(colDefs)` wraps each numeric column's `suppressKeyboardEvent`:

```ts
const originalSuppress = colDef.suppressKeyboardEvent;
colDef.suppressKeyboardEvent = (params) => {
  if (originalSuppress?.(params)) return true;
  if (params.editing) return false;             // let edit mode handle keys
  const key = params.event.key;
  if (key === '+' || key === '=' || key === '-') return true;   // we handle it
  return false;
};
```

Without this, the grid would start inline edit on `+`/`-` keypress. We claim them first.

### Nudge resolution

```ts
function resolveNudgeForCell(cell, rowData, nudges, engine): PlusMinusNudge | null {
  for (const nudge of nudges) {
    if (!nudge.enabled) continue;
    if (nudge.scope.columnIds.length > 0
        && !nudge.scope.columnIds.includes(cell.colId)
        && !nudge.scope.columnIds.includes(cell.field)) {
      continue;
    }
    if (nudge.expression) {
      try {
        const matched = engine.parseAndEvaluate(nudge.expression, {
          data: rowData,
          x: cell.value,
          value: cell.value,
        });
        if (!matched) continue;
      } catch { continue; }
    }
    return nudge;       // first match wins
  }
  return null;
}
```

First enabled match wins. List order = rule priority.

### Patch building

```ts
function buildNudgePatches(opts) {
  const patches: CellPatch[] = [];
  for (const cell of opts.targets) {
    const nudge = resolveNudgeForCell(cell, cell.rowData, opts.nudges, opts.engine);
    if (!nudge) continue;
    const step = opts.direction === '+' ? nudge.incrementStep : (nudge.decrementStep ?? nudge.incrementStep);
    const op = opts.direction === '+' ? 'add' : 'subtract';
    const newValue = applyNumericOp(cell.value, op, step);    // from smart-edit
    if (newValue == null) continue;
    patches.push({ rowId: cell.rowId, colId: cell.colId, field: cell.field, oldValue: cell.value, newValue });
  }
  return patches;
}
```

## UI surface

Host renders:
- Nudge rules editor: list, add, edit, delete
- Per-rule editor: name, enabled toggle, column multi-select, expression input, increment/decrement step inputs
- (No inline UI — nudges happen on keypress; user sees the cell update)

## Persistence

```ts
{
  settings: { enabled, recordHistory },
  nudges: PlusMinusNudge[]
}
```

Schema version 1.

## Dependencies

- [editing-core](01-editing-core.md): `buildPatchesFromTargets`, `CellPatch`
- [smart-edit](12-smart-edit.md): `applyNumericOp()` (shared arithmetic)
- [expression engine](README.md#1-expression-engine): for the optional condition

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/plus-minus/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/plus-minus/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/plus-minus/buildNudgePatches.ts](../../../starui/packages/shared/engine/src/customizer/modules/plus-minus/buildNudgePatches.ts)
- [../starui/packages/shared/engine/src/customizer/modules/plus-minus/resolveNudgeForCell.ts](../../../starui/packages/shared/engine/src/customizer/modules/plus-minus/resolveNudgeForCell.ts)
- [../starui/packages/shared/engine/src/customizer/modules/plus-minus/transforms.ts](../../../starui/packages/shared/engine/src/customizer/modules/plus-minus/transforms.ts)

## Design decisions worth copying

- **Expression-gated rules.** Distinguishes plus-minus from shortcuts. The condition runs per cell with row context — flexible for "only nudge when the row qualifies" rules.
- **First-match wins.** Ordered list. Allows specific rules first, fallback rules last. No score-based resolution complexity.
- **Asymmetric +/− steps.** Rules can have different up vs down (e.g., +10, −5). Asymmetric nudging is real in trading workflows.
- **Empty scope = all numeric columns.** Sensible default. Per-column scoping is the override.
- **Column-id OR field match.** Scope matches by either, so the rule survives renames if the user references the field.

## cgrid translation

Same `suppressKeyboardEvent` gap as [shortcuts](15-shortcuts.md):

1. **Per-column key suppression hook.** cgrid's keyboard feature chain needs a way for column-level config to claim specific keys. Add a `colDef.suppressKeyboardEvent(params)` field; the keyboard feature consults it before invoking its handlers.
2. **Keyboard handler for + / − keys.** Add a new feature class in the keyboard chain that watches for `+` and `-`, resolves the nudge, builds patches, journals them.
3. **Expression engine in main thread.** Per-cell condition eval happens on main thread; cheap closures. No worker round-trip needed unless aggregate refs are used (rare for nudge conditions).
