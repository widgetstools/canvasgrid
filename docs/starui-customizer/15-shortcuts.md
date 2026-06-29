# 15 — shortcuts

> Single-letter keyboard shortcuts for numeric ops, scoped by column. Simpler sibling to [plus-minus](14-plus-minus.md) — no expression gating.

## Purpose

Press `m` on a numeric cell, multiply by the rule's operand. Press `d`, divide. Letter-key bindings for fast numeric ops without leaving the keyboard.

## Config schema

```ts
interface ShortcutsState {
  settings: { enabled: boolean; recordHistory: boolean };
  shortcuts: ShortcutDefinition[];
}

interface ShortcutDefinition {
  id: string;
  name: string;                // display name (e.g. "Multiply by 100")
  enabled: boolean;
  shortcutKey: string;         // single letter (case-insensitive, stored lowercase)
  operation: ShortcutOperation;
  shortcutValue: number;       // operand (can be negative or fractional)
  scope: { columnIds: string[] };   // empty = all numeric columns
}

type ShortcutOperation = 'add' | 'subtract' | 'multiply' | 'divide';
```

Restricted to `add | subtract | multiply | divide` — no `set` (that's a destructive op better handled via [bulk-update](13-bulk-update.md) or [smart-edit](12-smart-edit.md)).

## Runtime behavior

### Keyboard interception

`applyShortcutsColDefTransforms(colDefs, shortcuts)` wraps numeric columns' `suppressKeyboardEvent` to swallow active shortcut keys when not in edit mode:

```ts
const activeKeys = collectShortcutKeys(shortcuts);   // Set<string> of lowercase letters
colDef.suppressKeyboardEvent = (params) => {
  if (params.editing) return false;
  return activeKeys.has(params.event.key.toLowerCase());
};
```

### Match resolution

```ts
function matchShortcutForCell(cell, key, shortcuts): ShortcutDefinition | null {
  const normalized = key.toLowerCase();
  for (const s of shortcuts) {
    if (!s.enabled) continue;
    if (s.shortcutKey !== normalized) continue;
    if (s.scope.columnIds.length > 0
        && !s.scope.columnIds.includes(cell.colId)
        && !s.scope.columnIds.includes(cell.field)) continue;
    return s;
  }
  return null;
}
```

First enabled match wins. No expression evaluation — pure key + column matching.

### Patch building

```ts
function buildShortcutPatches({ targets, key, shortcuts }) {
  return targets.flatMap(cell => {
    const s = matchShortcutForCell(cell, key, shortcuts);
    if (!s) return [];
    const newValue = applyNumericOp(cell.value, s.operation, s.shortcutValue);
    if (newValue == null) return [];
    return [{ rowId: cell.rowId, colId: cell.colId, field: cell.field, oldValue: cell.value, newValue }];
  });
}
```

## UI surface

Host renders:
- Shortcut rules editor: list, add/edit/delete
- Per-rule editor: name, enabled, key picker (single letter validation), operation dropdown, operand input, column scope multi-select
- Help dropdown showing active shortcuts (so users know what's available)

## Persistence

Schema version 1.

## Dependencies

- [editing-core](01-editing-core.md): `buildPatchesFromTargets`, `CellPatch`
- [smart-edit](12-smart-edit.md): `applyNumericOp()` and `isNumericCellDataType()`

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/shortcuts/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/shortcuts/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/shortcuts/buildShortcutPatches.ts](../../../starui/packages/shared/engine/src/customizer/modules/shortcuts/buildShortcutPatches.ts)
- [../starui/packages/shared/engine/src/customizer/modules/shortcuts/matchShortcut.ts](../../../starui/packages/shared/engine/src/customizer/modules/shortcuts/matchShortcut.ts)
- [../starui/packages/shared/engine/src/customizer/modules/shortcuts/transforms.ts](../../../starui/packages/shared/engine/src/customizer/modules/shortcuts/transforms.ts)

## Design decisions worth copying

- **Letter-key only.** Restricted to `a–z`. Avoids conflicts with browser/OS shortcuts (`Ctrl+S`, `Alt+F4`, etc.) and avoids ambiguity (`+` already taken by plus-minus). Single-letter scope keeps the mental model simple.
- **Case-insensitive matching.** Keys stored lowercase, input normalized. `Shift+M` and `m` both trigger.
- **First-enabled-match.** Rule order is priority. Allows fallbacks (general rules later, specific column rules first).
- **No expression evaluation.** Trade-off vs. plus-minus: less flexible but more predictable. Letter keys should always do the same thing on the same column.
- **Negative and fractional operands.** `Multiply by 0.5` (= divide by 2) and `Add -5` (= subtract 5) work. Lets users be creative with two-key combinations.
- **`collectShortcutKeys()` once at config time.** Set membership check in the hot path, not array iteration per keystroke.

## cgrid translation

Same gap as plus-minus: cgrid needs a `colDef.suppressKeyboardEvent` hook so per-column config can claim keys before the keyboard feature chain processes them.

Once that hook exists, shortcuts is ~200 LOC of pure logic. The UI is the harder part — single-letter validation, conflict detection (two rules on the same key + same column scope), help dropdown rendering.

**Conflict detection** is a UX concern worth getting right: if two rules bind the same key on overlapping column scopes, only the first fires. The editor should warn the user when they create a shadow rule.
