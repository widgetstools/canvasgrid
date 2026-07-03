# Cycle 21g — `@cgrid/edit` (Editing Ops: Journal, Smart-Edit, Bulk-Update, Plus/Minus, Shortcuts) — Design

**Date:** 2026-07-02
**Parent brief:** [Cycle 21 decision doc](../plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md) §4.7
**Recon:** [`docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md`](../plans/notes/2026-07-02-cycle-21g-recon.md) (committed; StarUI digest + kernel seam inventory with file:line evidence)
**StarUI sources:** `docs/starui-customizer/{01,11,12,13,14,15}` + `docs/starui-customizer-ui/{06,07,09,10,14,15,16}`
**Depends on:** kernel (events, transactions, selection, distinct values — all landed), `@cgrid/expression` (nudge gates). **HARD DEP: kernel PR #98 must merge before bridge/E2E tasks** (real rowIds in `cellKeyDown`/`getFocusedCell`; lucide fix for demo icons).
**Baselines (main @ `4bfe5b9`):** kernel 2568 (→2574 post-#98) · calc 215 · rules 144 · format 171 · expression 185 · renderers 277 · showcase E2E 148 (+6 visual) · typecheck 21/21 · build 13/13.

---

## §1 Scope & non-goals

### 1.1 In scope — the full editing-ops feature set, one cycle (no deferral)

1. **Journal core** (`EditJournal`): dual-stack undo/redo, bounded (`maxEntries`, default 50); cascade `undoEntry(id)`; separate monitor/audit list (default 100, decoupled from undo cap); `subscribe()`; per-source record filtering (`shouldRecord`).
2. **Patch primitives**: `CellPatch`, `dedupePatches` (last-write-wins by rowId+colId), `buildRowUpdatesFromPatches`, `applyPatches(direction)`, `previewPatches` + `combineValidators`, `assertSingleColumnSelection`.
3. **Smart-edit**: target collection (ranges → focused-cell fallback; numeric + editable filter), `applyNumericOp` (× ÷ + − =, null-on-failure), `buildSmartEditPatches`, preview/confirm pipeline hooks.
4. **K/M/B magnitude parsing**: `parseMagnitudeSuffix` (K/k 1e3, M/m 1e6, B/b 1e9, invalid → null) + `applyMagnitudeColDefTransforms` wrapping numeric columns' `valueParser` (layers onto existing editors; no custom editor).
5. **Bulk-update**: text/number/date targets, `parseBulkUpdateValue` (type-aware, ISO date normalize, null-on-failure), `Object.is` no-op guard, distinct-values feed via kernel `getDistinctValues(colId, limit)` (stringified → parsed back type-aware).
6. **Plus/minus nudges**: `PlusMinusNudge` rules (column scope by colId OR field, empty = all numeric; optional expression gate via `@cgrid/expression`; asymmetric ± steps), first-enabled-match, `buildNudgePatches` on shared `applyNumericOp`.
7. **Shortcuts**: single-letter a–z (stored lowercase, matched case-insensitively), add/subtract/multiply/divide only (no `set`), first-enabled-match, `Set`-based key lookup built at config time, `detectShortcutConflicts()` helper (engine-side; warning UI is 21i).
8. **Settings models**: `SmartEditSettings`, `BulkUpdateSettings`, `DataChangeHistorySettings` (the trio), plus `PlusMinusSettings`/`ShortcutsSettings` (`{enabled, recordHistory}`); JSON-clean, partials merged over defaults, unknown record-sources skipped.
9. **Bridge** `wireEditIntoKernel(grid, opts): EditBridgeHandle` (renderers-bridge pattern; §4).
10. **Showcase demo page + E2E**; README; gates.

### 1.2 Non-goals

- **Kernel changes: ONE approved seam only** (§3.6a — public `getRowsByIndex` accessor; genuine intrinsic need, settled per the no-retroactive-layering rule). Gate: `git diff main...HEAD -- packages/kernel` shows ONLY the §3.6a addition + its tests; `packages/{expression,format,rules,calc}` EMPTY. If an implementer discovers any OTHER kernel need, STOP and escalate (no-retroactive-layering: the kernel gets the real feature, coordinator decision — not a task-level bolt-on).
- **Customizer panels/toolbars** (plus-minus editor, shortcuts editor, smart-edit/bulk-update/history toolbars) — 21i. The showcase demo uses plain harness controls, not 21i surfaces. The engine API is shaped so 21i consumes it black-box (recon Part B).
- **StarUI's `unifyUndo` flag** — dropped; kernel has no competing built-in undo (recon C.8).
- **Journal persistence** — session-only in-memory (StarUI parity); settings persistence is host/21i territory.
- **Id-based selection-range re-anchoring** after re-sort (§3.3 caveat) — deferred unless the showcase demonstrates a real bite.
- **Clipboard/fill-handle edit sources** — `source` union is extensible; only the six recon sources ship.

---

## §2 Architecture

### 2.1 Package layout

```
packages/edit/src/
  types.ts            — CellPatch, EditJournalEntry, EditSource, settings trio, PlusMinusNudge, ShortcutDefinition, validation types
  journal.ts          — EditJournal (dual stacks + monitor + subscribe + shouldRecord)
  patches.ts          — dedupePatches, buildRowUpdatesFromPatches, applyPatches, buildPatchesFromTargets, assertSingleColumnSelection
  preview.ts          — previewPatches, combineValidators
  numericOps.ts       — applyNumericOp (shared by smart-edit / plus-minus / shortcuts)
  magnitude.ts        — parseMagnitudeSuffix + applyMagnitudeColDefTransforms
  smartEdit.ts        — collectTargetCells, buildSmartEditPatches
  bulkUpdate.ts       — collectBulkUpdateTargets, parseBulkUpdateValue, buildBulkUpdatePatches, bulkUpdateValueKind
  plusMinus.ts        — resolveNudgeForCell, buildNudgePatches
  shortcuts.ts        — collectShortcutKeys, matchShortcutForCell, buildShortcutPatches, detectShortcutConflicts
  bridge.ts           — wireEditIntoKernel(grid, opts) (§4)
  index.ts
```

Deps: `@cgrid/kernel` peer (type-only imports + bridge attachment — renderers precedent; engine modules import NOTHING from kernel at runtime). `@cgrid/expression` dependency (nudge gates; engine functions take an injectable `evaluate` so tests run without it — the bridge binds the real engine). No format/rules/calc dependency.

### 2.2 Core models (locked; worklog-confirmed)

```ts
export interface CellPatch {
  rowId: string; colId: string; field: string;
  oldValue: unknown; newValue: unknown;
}
export interface EditJournalEntry {
  id: string;                 // journal-assigned, monotonic per session
  timestamp: number;          // HOST-STAMPED via injectable now() — engine stays Date-free
  source: EditSource;
  label: string;              // "× 1.1", "Set Status = Approved", "Qty +1"
  patches: CellPatch[];       // atomic batch
}
export type EditSource =
  | 'smart-edit' | 'bulk-update' | 'plus-minus' | 'shortcut' | 'cell-editor' | 'stream';

export interface DataChangeHistorySettings {
  enabled: boolean;             // default true
  maxEntries: number;           // default 50 (undo depth); monitor list separately capped (100)
  suspended: boolean;           // pause recording, KEEP past entries (≠ disabled)
  recordSources: { smartEdit: boolean; bulkUpdate: boolean; plusMinus: boolean;
                   shortcuts: boolean; cellEditor: boolean; stream: boolean };  // stream default FALSE
}
export interface SmartEditSettings {
  enabled: boolean; incrementStep: number;            // default 1
  magnitudeShortcutsEnabled: boolean;                 // K/M/B valueParser wrap
  enabledOps: SmartEditOp[];                          // default all five
  confirmThreshold: number;                           // 0 = never
  enforceSingleColumn: boolean;                       // default true
  previewBeforeApply: boolean; recordHistory: boolean;
}
export type SmartEditOp = 'multiply' | 'divide' | 'add' | 'subtract' | 'set';
export interface BulkUpdateSettings {
  enabled: boolean; confirmThreshold: number;
  showDistinctValues: boolean; maxDropdownValues: number;   // default 20
  enforceSingleColumn: boolean; recordHistory: boolean;
}
export interface PlusMinusNudge {
  id: string; name: string; enabled: boolean;
  scope: { columnIds: string[] };      // empty = all numeric editable; matches colId OR field
  expression?: string;                 // optional row gate; ctx {data, x, value}; falsy/throw = skip
  incrementStep: number; decrementStep?: number;      // defaults to incrementStep
}
export interface ShortcutDefinition {
  id: string; name: string; enabled: boolean;
  shortcutKey: string;                 // /^[a-z]$/ stored; matched case-insensitively
  operation: 'add' | 'subtract' | 'multiply' | 'divide';
  shortcutValue: number;               // negative/fractional allowed
  scope: { columnIds: string[] };
}
```

`field` on `CellPatch`: derived at patch-build time from the resolved colDef (`colId === field` for field-backed columns); NOT read from `cellValueChanged` (payload has no `field` — recon C.1).

### 2.3 Engine discipline (binds every task)

- Date-free: `EditJournal` takes `now?: () => number` (host-stamped timestamps); ids from an injected counter/LCG-safe generator, never `Math.random`.
- Pure functions over injected surfaces: engine modules never import kernel; grid access only via the bridge's structural surface (§4.1) and the writer contract (§3.2).
- Null-on-failure everywhere (`applyNumericOp`, `parseMagnitudeSuffix`, `parseBulkUpdateValue`): null → patch skipped silently, never a throw on the keystroke path.
- No-op guard: patches where `Object.is(oldValue, newValue)` are never created (clean undo, no wasted writes).
- Editability honored at patch build: every target passes `isCellEditable(rowIndex, colId)` before a patch is generated (recon C.9).
- Expression grammar (nudge gates): `&&`/`||`, `==`/`!=` — standing constraint.
- Tests: engine-style (calc/rules precedent) — seeded LCG, injectable now, structural fakes for the grid surface (format's bridge.test.ts precedent, NOT kernel imports).

---

## §3 Settled design decisions (the open questions)

### 3.1 Plus/minus & shortcuts interception → `cellKeyDown` + `preventDefault()` (NOT suppressKeyboardEvent transforms)

The kernel's head-of-chain `CellKeyboardEvents` emits public, cancelable `cellKeyDown` before ANY grid handler; `event.preventDefault()` short-circuits the whole pipeline — the editor never opens (recon C.3, `cellKeyboardEvents.ts:57-62`). The bridge subscribes once and routes:

```
on('cellKeyDown', ({rowId, colId, event}) => {
  if editing → return                                  // editor owns keys
  if key ∈ {'+','=','-'} and plusMinus.enabled →
      resolve nudge for focused cell (scope + expression gate) →
      if matched: event.preventDefault(); build patch; commit + record('plus-minus')
  else if key ∈ shortcutKeySet and shortcuts.enabled →
      match shortcut → if matched: event.preventDefault(); build patch; commit + record('shortcut')
})
```

- Strictly better than StarUI's colDef-wrapping: no colDef mutation, rules change dynamically without re-resolving colDefs, one subscription instead of N wrapped callbacks. **Zero kernel diff.**
- Precedence is correct by construction: an app-supplied `suppressKeyboardEvent` is consulted BEFORE `cellKeyDown` is emitted (recon C.3) — app colDef wins over addon.
- Unmatched keys are NOT prevented — `+` on a non-nudge column still type-to-edits as today.
- Targets: nudges/shortcuts apply to the **focused cell** (StarUI parity); range-wide nudging is out of scope (smart-edit covers multi-cell arithmetic).
- Requires PR #98 for real `rowId` in the event payload (else journal keys are synthetic) — hard dependency, tripwire test in E2E.

### 3.2 Commit pipeline & cascade-undo atomicity → one `applyTransaction` per journal entry

The writer contract (StarUI's `EditGridWriter`, adapted):

```ts
interface EditGridWriter {                       // implemented by the bridge over public API
  applyUpdates(rows: object[]): void;            // ONE applyTransaction({update: rows}) — one worker round-trip, one re-render
  getRow(rowId: string): object | undefined;     // bridge's row mirror (§4.2)
}
```

Forward commit of an entry: `dedupePatches` → group by rowId → clone the mirror row → apply each patch through the column's `valueParser`→`valueSetter` contract (replicated addon-side; the kernel only runs these in the editor path — recon C.9, correctness requirement) → one `applyTransaction({update})`. Kernel `update` REPLACES the row (recon C.5), so update rows are always built from the freshest mirror row at commit time; the residual tick-race (worker row moved between mirror read and apply) is the same exposure the kernel's own editor commit has — documented, not solved here.

**Undo/redo**: exactly one Tx each (reversed / re-applied patches). **Cascade `undoEntry(id)`**: pop entries newest→oldest, ONE Tx PER ENTRY in reverse order. Per-entry application is trivially correct when entries touch overlapping cells (later entry's oldValue restores the earlier's newValue); coalescing into one Tx would need last-write-wins dedupe in reverse patch order — easy to get wrong, saves little at cascade depths bounded by `maxEntries` (50). Rows missing from the mirror at undo time (removed since recording) are skipped and counted in the entry's undo result.

### 3.3 Selection preservation across preview/commit → preview never mutates; commit = snapshot/restore

- **Preview** (`previewPatches`) computes projected values + validation classification purely from patches + the row mirror — the grid is untouched, nothing to preserve.
- **Commit**: snapshot `{ranges: getCellRanges(), focused: getFocusedCell(), selectedRowIds: getSelectedRowIds()}` → apply the Tx → restore via `clearCellRanges()` + `addCellRange()` loop + `setFocusedCell()` + `setSelectedRowIds()` (all public — recon C.7).
- Documented caveat: `SelectionRange` is index-based (visible order); a commit that triggers re-sort/re-filter can shift what the restored range covers. Verbatim restore ships; id-based re-anchoring is deferred (non-goal 1.2) unless the showcase bites.

### 3.4 `getRowById` accessor → NOT needed; bridge-owned row mirror

The bridge maintains its own `Map<rowId, row>`: seeded from `forEachRow()`, freshened on `rowsChanged`, **cleared + reseeded on `modelUpdated`** (the 21f-hardened pattern — same-rowId `setRowData` emits `modelUpdated` only; a mirror without that clear goes permanently stale; recon C.4). All patch building and preview read current values from the mirror. A kernel `getRowById` would be pure convenience — fails the intrinsic-need bar, so no kernel change (and no partial hook either: the mirror is fully addon-owned, honoring no-retroactive-layering in both directions).

### 3.5 Journal feed split (who records what)

- `cell-editor`: recorded from the bridge's `cellValueChanged` listener — payload already carries `oldValue`/`newValue`/real `rowId` (recon C.1). One event = one single-patch entry (full-row editor commits arrive as N events → N entries; acceptable, StarUI-equivalent).
- Programmatic sources (`smart-edit`/`bulk-update`/`plus-minus`/`shortcut`): recorded at patch-build time by the op that built them. Their transactions do NOT emit `cellValueChanged` (kernel emits it only from the editor path) — no double-record by construction.
- **Replay guard**: undo/redo/cascade transactions set an internal `replaying` flag; the `cellValueChanged`/`rowsChanged` listeners skip recording while set (belt-and-braces — see above for why cellValueChanged can't fire anyway).
- `stream`: `rowsChanged` with `source: 'transaction'|'transactionAsync'` (host live feeds) — recordable only when `recordSources.stream` (default OFF; floods the journal otherwise). Entries built from the event's `updated[].oldRow` snapshots.
- `shouldRecord(source, settings)` consulted on every `record()`; suspended ≠ disabled (suspended keeps `past[]` intact).

### 3.6 Kernel-diff verdict: near-zero — ONE genuine seam

Everything EXCEPT range→row expansion rides on landed public API: `cellKeyDown` / `cellValueChanged` / `rowsChanged` / `modelUpdated`; `applyTransaction(Async)`; `forEachRow`; `getDistinctValues(colId, limit)` (21d); selection get/set; `isCellEditable`; colDef `valueParser`/`valueSetter`/`editable`/`suppressKeyboardEvent`. Two nice-to-haves noted for the escalation log, NOT taken: (a) `field` on the `cellValueChanged` payload (derivable from colDef), (b) real rowIds in event payloads (already fixed by PR #98). Neither crosses the "genuinely needs intrinsic support" bar.

#### 3.6a Approved kernel seam: public `getRowsByIndex` (range→row expansion)

**Discovered at plan time (2026-07-02, S2).** `SelectionRange` is `{rowStart, rowEnd, colIds}` in **visible-order indices**, and visible order (post-filter/sort) is worker-owned state. There is NO public visible-index→row surface: `getCellValue(rowIndex, colId)` is viewport-chunk-only (`api.ts:711-713`, null outside the chunk — a header-click column range spans all rows), and the kernel's OWN range-writing features resolve rows via the private `workerCoord.getRowByIndex` batch pattern (fill handle `cgrid.ts:2387-2425` `commitFill`; clipboard `cgrid.ts:4424-4438` `serializeRangesMainSide`). An addon cannot reconstruct visible order without reimplementing worker filter/sort main-side — wrong by design. Smart-edit and bulk-update target collection over ranges is core 21g scope, so this is a genuine intrinsic need, not a convenience: per the no-retroactive-layering rule, **the kernel gets the real feature**:

```ts
/** Fetch full rows by current visible-order index (batched worker
 *  round-trip). One entry per requested index, order preserved;
 *  null for out-of-range indexes. */
getRowsByIndex(rowIndexes: number[]): Promise<Array<{ rowIndex: number; rowId: string; data: TRow } | null>>;
```

Thin public promotion of the existing internal mechanism (Promise.all over `workerCoord.getRowByIndex`, dedupe input indexes, destroyed-guard → resolve an ALL-NULL array of input length, preserving the 1:1 alignment pin; corrected at plan time — an empty-array guard would contradict the alignment contract), generically useful to any addon that consumes `getCellRanges()` — NOT an edit-shaped hook. Lands as its own reviewed kernel task inside the 21g branch, with kernel-side tests. Consequence for the engine: `collectTargetCells`/`collectBulkUpdateTargets` are **async** (they await the fetch); plus/minus and shortcuts stay sync (focused-cell only — `cellKeyDown` already carries `rowId`/`value`, and the bridge mirror has the row).

---

## §4 Bridge — `wireEditIntoKernel(grid, opts): EditBridgeHandle`

### 4.1 Shape (renderers-bridge template, recon C.10)

- Structural `KernelGridSurface` interface over public API only: `on/addEventListener`, `applyTransaction`, `forEachRow`, `getRowsByIndex` (§3.6a), `getCellRanges`/`addCellRange`/`clearCellRanges`, `getFocusedCell`/`setFocusedCell`, `getSelectedRowIds`/`setSelectedRowIds`, `getDistinctValues`, colDef resolution for `valueParser`/`valueSetter`/`editable`/`cellDataType` (via `getGridOption('columnDefs')`, renderers leaf-walk precedent). Plan-time corrections (code-verified): `isCellEditable` and `isEditing` are NOT public — the bridge replicates editability addon-side from resolved colDefs (static bool / callback with `{data, colId, rowIndex, value}` from the mirror; throw/unknown-col → false) and derives its editing flag from the public `cellEditingStarted`/`cellEditingStopped` events; focused-cell rowIndex is synthesized from the focus-collapsed 1×1 range in `getCellRanges()`.
- Idempotency guard (`grid.__editBridgeWired` handle, return on re-call); `subscribe()` with `on` → `addEventListener` fallback; `destroy()` tears down listeners + journal subscription.
- `opts`: settings trio + `nudges[]` + `shortcuts[]` + `validators?` + `now?` + `evaluate?` (expression engine override; defaults to `@cgrid/expression`).

### 4.2 Responsibilities

1. Row mirror (§3.4).
2. Key router (§3.1) on `cellKeyDown`.
3. Journal feeds (§3.5) on `cellValueChanged` (+ optional `stream` from `rowsChanged`).
4. Commit pipeline (§3.2) incl. valueParser/valueSetter replication and selection snapshot/restore (§3.3).
5. `applyMagnitudeColDefTransforms` helper exposed for hosts to wrap their numeric colDefs' `valueParser` before grid construction (K/M/B applies to interactive typing; opt-in via `magnitudeShortcutsEnabled`).
6. Handle surface for 21i and the showcase: `{journal, smartEdit: {collectTargets, preview, apply}, bulkUpdate: {collectTargets, distinctValues, preview, apply}, settings accessors, destroy}` — journal consumed black-box (`canUndo/canRedo/undo/redo/undoEntry/entries/subscribe`).

## §5 Showcase demo + E2E (PR-#98-gated)

One `edit-blotter` showcase page (plain harness controls — NOT 21i surfaces): editable numeric/text/date columns, smart-edit op buttons + operand input, bulk-update input + distinct dropdown, undo/redo buttons + entry count, 2 seeded nudges (one expression-gated), 2 shortcuts. E2E probes (showcase E2E precedent, `window.__cgridEdit` handle): journal record/undo/redo round-trip through a real editor commit; smart-edit ×2 over a range then undo restores; bulk-update with distinct pick; `+` nudge on gated vs non-gated rows; shortcut key on scoped column; `+` on non-nudge column still opens editor (non-interception proof); selection restored after commit; real-rowId tripwire (asserts journal keys are NOT `row-N` — meaningful only post-#98).

## §6 Testing strategy

- Engine units per module (journal semantics incl. cascade + monitor + record-after-undo clears future; dedupe order; parser edge cases: `1.5M`, `-2k`, `1e3B`-invalid, divide-by-zero, `Object.is` NaN/-0 guards; nudge first-match + expression gate + throw-skips; shortcut conflicts) — structural fakes, seeded LCG, injected now.
- Bridge tests against a fake grid surface (renderers `wire.test.ts` precedent): key routing + preventDefault discipline, mirror freshening incl. `modelUpdated` clear, replay guard, valueParser/valueSetter replication parity with an editor-path fixture, selection snapshot/restore.
- Gates: package suite green; typecheck; root eslint; showcase E2E baseline 148 (+6 visual) preserved + new specs; **kernel-diff proof** `git diff main...HEAD -- packages/kernel` contains ONLY the §3.6a `getRowsByIndex` addition + tests, `packages/{expression,format,rules,calc}` EMPTY; NUL scan.

## §7 Task decomposition sketch (~12 tasks; final split in the 21g plan, worklog S2–S6)

1. Scaffold + `types.ts` + settings defaults/merge + `shouldRecord`.
2. Journal core (stacks, limits, monitor, subscribe, record-clears-future).
3. Cascade undo + patch primitives (`dedupePatches`, `buildRowUpdatesFromPatches`, `applyPatches`).
4. `previewPatches` + `combineValidators` + `assertSingleColumnSelection`.
5. `applyNumericOp` + smart-edit (targets, patches).
6. Magnitude parser + colDef `valueParser` transform.
7. Bulk-update (targets, type-aware parse, patches, distinct feed adapter).
8. Plus/minus (resolve + patches, expression gate via injectable evaluate).
9. Shortcuts (match, patches, conflict detection).
10. Kernel seam (§3.6a): public `getRowsByIndex` + kernel tests (own review gate; the cycle's ONLY kernel diff).
11. Bridge (mirror, key router, journal feeds, commit pipeline, selection restore, handle).
12. Showcase page + E2E; README; gates + final whole-branch review.
