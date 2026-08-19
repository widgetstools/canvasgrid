# `@wellsfargo-starui/velocity-grid-edit`

Editing-ops feature set for financial blotters — an undo/redo journal,
smart-edit (×÷+−= over a selected range), bulk-update (free text or a
distinct-values pick), expression-gated plus/minus nudges, and letter-key
shortcuts, all wired onto a `VelocityGrid` via one bridge call.

**Status:** Cycle 21g — full feature set landed. Zero kernel changes except
the one approved seam (spec §3.6a): a public `VelocityGrid.getRowsByIndex(indexes)`
batched row fetch, needed because `SelectionRange` is visible-order-index
based and there was no public index→row surface for range→row expansion.
Everything else rides on landed public API (`cellKeyDown` /
`cellValueChanged` / `rowsChanged` / `modelUpdated`, `applyTransaction`,
`forEachRow`, selection get/set, `getDistinctValues`, colDef
`valueParser`/`valueSetter`/`editable`).

Design spec: `docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md`

## Quickstart

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { wireEditIntoKernel, applyMagnitudeColDefTransforms } from '@wellsfargo-starui/velocity-grid-edit';

// Wrap numeric colDefs' valueParser BEFORE construction so a typed "1.5M"
// commits as 1500000 (K/M/B magnitude suffixes) — no-op on non-numeric
// columns, never mutates the input array.
const columnDefs = applyMagnitudeColDefTransforms([
  { colId: 'qty', field: 'qty', cellDataType: 'number', editable: true },
  { colId: 'price', field: 'price', cellDataType: 'number', editable: true },
  { colId: 'trader', field: 'trader', cellDataType: 'text', editable: true },
]);

const grid = new VelocityGrid(host, { columnDefs, getRowId: (r) => r.id });
grid.setRowData(rows);

const handle = wireEditIntoKernel(grid, {
  nudges: [
    { id: 'qty', name: 'Qty ±1', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1 },
    {
      id: 'price-active', name: 'Price ±0.25 (active only)', enabled: true,
      scope: { columnIds: ['price'] }, expression: '[status] == "active"',
      incrementStep: 0.25,
    },
  ],
  shortcuts: [
    { id: 'q10', name: 'Qty +10', enabled: true, shortcutKey: 'q', operation: 'add', shortcutValue: 10, scope: { columnIds: ['qty'] } },
  ],
});
```

`wireEditIntoKernel` is idempotent — re-calling on the same grid returns the
same handle (`grid.__editBridgeWired` marker). Nudge/shortcut `expression`
strings use the real `@wellsfargo-starui/velocity-grid-expression` grammar — bracket field access
(`[status]`, not bare `status`) — because the bridge's default `evaluate`
is the real expression engine, not a test fake.

## Bridge handle

| Member | Purpose |
|---|---|
| `journal` | `EditJournal` — `undo()/redo()/undoEntry(id)`, `canUndo()/canRedo()`, `entries()/monitorEntries()`, `subscribe(fn)` |
| `smartEdit.collectTargets()` | Async — ranges-first cell collection over `getCellRanges()`, batched through `getRowsByIndex` |
| `smartEdit.preview(targets, op, operand)` / `.apply(...)` | ×÷+−= over numeric editable targets; one journal entry per apply (N patches) |
| `bulkUpdate.collectTargets()` / `.distinctValues(colId, cellDataType?)` / `.preview(...)` / `.apply(targets, newValue)` | Type-aware free-text or distinct-value set across text/number/date targets |
| `getSettings()` / `updateSettings(partial)` | Defensive per-slice merge over `DEFAULT_EDIT_SETTINGS` |
| `setNudges(nudges)` / `setShortcuts(shortcuts)` | Replace the active rule lists at runtime |
| `destroy()` | Unwires listeners, clears the row mirror, drops `__editBridgeWired` |

## Journal — undo/redo

Dual `past`/`future` stacks plus a decoupled, uncapped-relative-to-undo
`monitor` list (default cap 100, independent of `history.maxEntries`).
`record()` is gated by `shouldRecord(source, settings)` — disabled or
suspended history records nothing (`suspended` KEEPS past entries;
`enabled: false` does not). `undoEntry(id)` cascades: pops `past` back
through (and including) the target entry, applying + pushing each onto
`future` as its OWN `applyPatches` call — one transaction per entry, so
overlapping-cell cascades stay trivially correct. All patch application
funnels through ONE injected applier (`applyDirection` inside the bridge) —
the journal itself never touches a grid.

## Smart-edit

Collects candidate cells ranges-first: the union of every selected range
(deduped rowIndexes, ONE batched `getRowsByIndex` call), falling back to
the focused cell only when there are zero ranges. Filters to
numeric + editable cells. `enforceSingleColumn` (default `true`) rejects a
multi-column target set (`applied: 0, entry: null`) rather than silently
partial-applying. One `apply()` call = one journal entry covering every
resulting patch.

## Bulk-update

Same ranges-first collection, widened to text/number/date/dateTime cells
(undefined cellDataType → treated as text; boolean excluded).
`distinctValues(colId, cellDataType)` adapts the kernel's
`getDistinctValues` (which returns **stringified** values) back through
type-aware parsing, dropping parse failures — a fresh fetch on every call,
reflecting currently-displayed rows at open time (no caching).

## Plus/minus nudges

`+`/`=` and `-` on a focused, in-scope cell are the trigger keys
(`cellKeyDown`, gated by `settings.plusMinus.enabled`). First **enabled**
rule whose `scope.columnIds` matches (empty scope = all numeric editable
columns) AND whose optional `expression` evaluates strictly `=== true`
against the row wins; a false/throwing expression is a **gate**, not a
hard stop — resolution continues to the next rule in list order. No match
→ the key is **not** intercepted (no `preventDefault()`), so it falls
through to the kernel's own type-to-edit handling.

## Letter shortcuts

Single-letter (`/^[a-z]$/`, case-insensitive) keys mapped to
`add`/`subtract`/`multiply`/`divide` by a fixed `shortcutValue`, scoped to
`columnIds`. Same non-interception discipline as nudges: an out-of-scope
letter is never swallowed.

## Magnitude (K/M/B) typing

`applyMagnitudeColDefTransforms(colDefs)` wraps every `cellDataType:
'number'` column's `valueParser` (running any original parser first) so a
typed string ending in `k`/`m`/`b` (case-insensitive) — `"1.5M"`,
`"-2k"` — parses to the multiplied number; malformed suffixes (double
suffixes, a second decimal point, an exponent before the suffix) fail the
whole match rather than silently truncating. **This only matters for
editors whose `getValue()` returns a raw string** (the kernel's default
text editor, used whenever a column doesn't set `cellEditor`) — the
built-in `number` editor's `getValue()` already returns a parsed
`number`, so the string-typed magnitude branch never fires against it.

## Settings

One slice per feature family (`history`, `smartEdit`, `bulkUpdate`,
`plusMinus`, `shortcuts`) — see `DEFAULT_EDIT_SETTINGS` / `mergeEditSettings`
in `src/settings.ts` for the full shape and the defensive per-slice merge
rules (`history.recordSources` merges key-by-key against six known keys;
`smartEdit.enabledOps` replaces wholesale but falls back to the default
five ops if filtering an invalid input would leave it empty).

## Caller-owns-dialogs contract

`SmartEditSettings.confirmThreshold` / `BulkUpdateSettings.confirmThreshold`
are **counts returned to the caller**, not engine-enforced gates — the
engine (and the bridge's `apply()`) always applies; a host UI that wants a
"you're about to change 500 cells — continue?" dialog reads the target
count from `collectTargets()` (or the `applied` count on a completed
`apply()`) and decides whether to prompt BEFORE calling `apply()`. The
engine never blocks on a threshold and never owns any dialog/confirm UI.

## Selection-restore caveat (index-based)

Every programmatic commit (`smart-edit`/`bulk-update`/nudge/shortcut/undo/
redo) snapshots `{getCellRanges(), getFocusedCell(), getSelectedRowIds()}`
before `applyTransaction` and restores it after. `SelectionRange` is
**index-based** (visible order) — a commit that triggers a re-sort or
re-filter mid-flight can shift what the restored range visually covers,
since the indices are replayed verbatim rather than re-anchored to the
original row/column identities. This ships as documented behavior (spec
§3.3); id-based re-anchoring is an explicit non-goal unless a real
consumer needs it.

## The one kernel seam — `getRowsByIndex` (spec §3.6a)

`SelectionRange` is `{rowStart, rowEnd, colIds}` in visible-order indices,
and visible order (post-filter/sort) is worker-owned state with no prior
public index→row surface (`getCellValue` is viewport-chunk-only). Smart-edit
and bulk-update's range→row expansion is core scope, so the kernel gained
one thin, generically-useful promotion of its existing internal
`workerCoord.getRowByIndex` batch pattern:

```ts
getRowsByIndex(rowIndexes: number[]): Promise<Array<{ rowIndex: number; rowId: string; data: TRow } | null>>;
```

Batched (`Promise.all`, deduped input indexes), order-preserving, null for
out-of-range indexes, all-null-aligned on a destroyed grid mid-flight.
This is the ONLY `packages/kernel` diff in this cycle;
`packages/{expression,format,rules,calc}` are untouched.

## Known kernel-integration gap — `cellKeyDown` rowId (blocks nudges/shortcuts until PR #98)

Plus/minus nudges and letter shortcuts route through the kernel's
`cellKeyDown` event. That event's `rowId` is stamped by the kernel's
private `rowIdAt(rowIndex)` — a documented "Foundation" stub that always
returns a synthetic `row-${rowIndex}` (see `packages/kernel/src/velocityGrid.ts`;
`stringRowIdAt`, a few lines below it, holds the real per-chunk string id
but isn't yet threaded into pointer/keyboard event payloads). This
package's bridge looks the event's `rowId` up in its own row mirror, keyed
by REAL string ids (`forEachRow`/`rowsChanged`) — the synthetic id never
matches, so nudges and shortcuts silently never intercept a keypress
against a **real** kernel today; the key always falls through to
type-to-edit. This is the SAME defect already documented against
`@wellsfargo-starui/velocity-grid-renderers`' row-menu click routing (`cellClicked`, a sibling
event) — `apps/velocitygrid-showcase/e2e/rendererBlotter.spec.ts`'s F5 test.
`cell-editor` (editController's own worker-fetched rowId) and
`smart-edit`/`bulk-update` (this cycle's `getRowsByIndex` seam, also
worker-fetched) are UNAFFECTED — both already carry real rowIds today.
The engine-level unit tests (`tests/bridge.test.ts`, a fake grid surface)
prove the bridge's own key-routing logic is correct; three showcase E2E
tests are authored as `test.fail()` documented-red-kept-CI-green tripwires
(`apps/velocitygrid-showcase/e2e/editBlotter.spec.ts`) pending the kernel fix
(`rowIdAt()` reading `stringRowIdAt()` when available) — tracked as PR #98.

## Showcase demo

- `/?feature=edit-blotter` — 12-row blotter: editable `qty`/`price`
  (K/M/B magnitude), `trader` (text), `settleDate` (date), non-editable
  `ticker`/`status`; smart-edit op buttons + operand; bulk-update input +
  distinct picker; undo/redo + live entry count; 2 nudges (one
  expression-gated), 2 shortcuts (`q`, `h`).

E2E probes: `window.__cgridEdit` (the bridge handle) + `window.__cgrid`
for geometry/values. Canvas cells are painted, not DOM — edits round-trip
through the kernel's real `.vg-editor-overlay input` overlay.

## Dependencies

- **peer:** `@wellsfargo-starui/velocity-grid`
- **runtime:** `@wellsfargo-starui/velocity-grid-expression` (the bridge's default nudge-gate evaluator)

## Verification gates (cycle 21g)

```bash
cd packages/edit && npm test               # vitest run
cd packages/kernel && npm test             # baseline + Task 10's getRowsByIndex suite
npm run typecheck                          # root — turbo run typecheck
npm run lint                               # root eslint
cd apps/velocitygrid-showcase && npx playwright test   # baseline + new editBlotter specs (3 test.fail() tripwires)
git diff main...HEAD -- packages/kernel                                  # ONLY getRowsByIndex (+ tests)
git diff main...HEAD -- packages/expression packages/format packages/rules packages/calc  # must be empty
```
