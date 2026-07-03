# Cycle 21g — `@cgrid/edit` Recon Notes

**Date:** 2026-07-02 (redo of the recon lost in the 2026-07-02 session restart; committed per durability rule — no scratchpad artifacts)
**Feeds:** `docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md`
**Sources read:** `docs/starui-customizer/{01-editing-core,11-data-change-history,12-smart-edit,13-bulk-update,14-plus-minus,15-shortcuts}.md`; `docs/starui-customizer-ui/{06-plus-minus,07-shortcuts,09-smart-edit,10-bulk-update,14-smart-edit-toolbar,15-bulk-update-toolbar,16-edit-history-toolbar}.md`; kernel seam sweep over `packages/kernel/src` (cgrid.ts, core/editController.ts, interaction/features/{editTrigger,cellKeyboardEvents}.ts, types/{api,column,event}.ts); `packages/renderers/src/bridge.ts` (addon-attachment precedent); PR #98 diff.

---

## Part A — StarUI engine modules (what we're porting)

### A.1 editing-core (doc 01) — the foundation, build first

Transactional write primitives every editing feature reuses. **Patch-first design**: features generate `CellPatch[]`, never talk to the grid directly — that one decision makes every feature undoable/validatable/auditable with zero per-module wiring.

Core models (verbatim from StarUI, adopted for cgrid):

```ts
interface CellPatch {
  rowId: string; colId: string; field: string;
  oldValue: unknown; newValue: unknown;
}
interface EditJournalEntry {
  id: string;
  timestamp: number;          // HOST-STAMPED (Date-free engine rule: injectable now)
  source: EditSource;
  label: string;              // human-readable, e.g. "× 1.1"
  patches: CellPatch[];       // atomic batch
}
type EditSource = 'smart-edit' | 'bulk-update' | 'plus-minus' | 'shortcut' | 'cell-editor' | 'stream';
type EditValidationResult = 'valid' | 'invalid' | 'warning';
```

Journal: dual stacks `past[]`/`future[]` bounded by `limit` (default 50); `record()` clears `future`; **cascade undo** `undoEntry(id)` pops past-entries until target id pops, applying reversed patches (≈20 LOC, big UX win); separate **monitor list** (default 100) = audit trail decoupled from undo cap; `subscribe(listener)` for UI. Grid writer is a tiny interface (`applyTransactionAsync(RowUpdate[])` + `getRowNode(rowId)`) — patches aggregate into row-shaped updates, ONE transaction per journal entry, not one per patch. `previewPatches(api, patches, validator?)` → `{total, valid, invalid, warnings, rows}` for confirm dialogs; `combineValidators` fail-fast on invalid, worst-of for warning. Helpers: `buildPatchesFromTargets`, `dedupePatches` (last-write-wins by rowId+colId), `buildRowUpdatesFromPatches`, `applyPatches(direction: 'forward'|'undo')` (undo flips old/new), `assertSingleColumnSelection`. **No persistence** — journal is session-only in-memory.

### A.2 data-change-history (doc 11) — settings-only consumer (~70 LOC)

```ts
interface DataChangeHistorySettings {
  enabled: boolean; maxEntries: number;          // default 50
  suspended: boolean;                             // pause recording, KEEP past entries (≠ disabled)
  unifyUndo: boolean;                             // moot for cgrid — no built-in undo to compete with (drop, per doc's own advice)
  recordSources: { smartEdit; bulkUpdate; plusMinus; shortcuts; cellEditor; stream: boolean };
}
```

`shouldRecord(source, settings)` consulted on every `record()`; `recordSourceKey()` maps kebab EditSource → camel config keys. **stream off by default** (live ticks flood the journal). Defensive deserialization: unknown sources skipped, partials merged over defaults. cgrid's 'stream' equivalent = transaction-driven live-feed updates.

### A.3 smart-edit (doc 12) — multi-cell arithmetic + K/M/B parsing

```ts
interface SmartEditSettings {
  enabled: boolean; incrementStep: number;
  magnitudeShortcutsEnabled: boolean;           // K/M/B in editors
  enabledOps: SmartEditOp[];                    // which toolbar buttons
  confirmThreshold: number;                     // 0 = never
  enforceSingleColumn: boolean; previewBeforeApply: boolean; recordHistory: boolean;
}
type SmartEditOp = 'multiply' | 'divide' | 'add' | 'subtract' | 'set';
```

- **Target collection**: ranges first (`getCellRanges()`), focused-cell fallback; filter numeric + editable, dedupe by row+col.
- **`applyNumericOp(current, op, operand)`**: null-on-failure semantics (divide-by-zero, non-numeric current → null → patch skipped silently). SHARED by plus-minus and shortcuts — centralized arithmetic.
- **`parseMagnitudeSuffix('1.5M') → 1500000`**: K/k=1e3, M/m=1e6, B/b=1e9; plain numbers pass through; invalid → null. Wired as a **`valueParser` wrapper transform** on numeric columns (layers onto whatever editor exists — no custom editor needed).
- Workflow: select → op button → operand dialog → optional preview table → optional confirm (> threshold) → `buildPatchesFromTargets` → `journal.record({source:'smart-edit', label:'× 1.1', patches})`.

### A.4 bulk-update (doc 13) — set-one-value over a selection

```ts
interface BulkUpdateSettings {
  enabled: boolean; confirmThreshold: number;
  showDistinctValues: boolean; maxDropdownValues: number;   // default 20 (UI doc says 100)
  enforceSingleColumn: boolean; recordHistory: boolean;
}
```

- Targets: same range-first/focused-fallback, but **text|number|date** types (boolean excluded).
- Distinct values: scan **currently-displayed** rows (filter+sort respected), bounded, fresh per open, natural-sorted. → cgrid: kernel already ships `getDistinctValues(colId, limit)` (see C.6) — the doc's "reuse the set-filter path" option is ALREADY the landed answer.
- `parseBulkUpdateValue(raw, cellDataType)`: number → parseFloat, date → ISO 8601 normalize, text passthrough; null on failure → skipped.
- `buildBulkUpdatePatches`: `Object.is()` no-op guard — same-value cells never produce patches (keeps undo clean).

### A.5 plus-minus (doc 14) — +/− nudges with expression-gated rules

```ts
interface PlusMinusNudge {
  id: string; name: string; enabled: boolean;
  scope: { columnIds: string[] };     // empty = all numeric columns; matches colId OR field
  expression?: string;                // optional row gate; falsy/throw = skip
  incrementStep: number; decrementStep?: number;   // defaults to incrementStep (asymmetric allowed)
}
interface PlusMinusSettings { enabled: boolean; recordHistory: boolean; }
```

- StarUI intercepts by wrapping numeric columns' `suppressKeyboardEvent` to claim `+`/`=`/`-` when not editing (else the grid starts inline edit on the keypress). **cgrid has a better seam — see C.3/D.1.**
- `resolveNudgeForCell`: first enabled match wins (list order = priority); expression evaluated per cell with `{data: rowData, x: value, value}` context; eval errors → rule skipped.
- Patches via shared `applyNumericOp` with op add/subtract.

### A.6 shortcuts (doc 15) — letter keys → arithmetic, no expression gate

```ts
interface ShortcutDefinition {
  id: string; name: string; enabled: boolean;
  shortcutKey: string;                 // single letter a-z, stored lowercase, matched case-insensitively
  operation: 'add' | 'subtract' | 'multiply' | 'divide';   // NO 'set' (destructive; use bulk-update)
  shortcutValue: number;               // negative/fractional allowed
  scope: { columnIds: string[] };
}
interface ShortcutsSettings { enabled: boolean; recordHistory: boolean; }
```

- Letter-only by design (avoids browser/OS chords; `+`/`-` owned by plus-minus). First-enabled-match; no expressions (predictability over flexibility).
- `collectShortcutKeys()` builds a `Set<string>` ONCE at config time — set membership in the hot keydown path.
- **Conflict detection is a UX requirement**: two rules on same key + overlapping scope → only first fires; editor should warn (shadow-rule chip). Engine can expose a `detectShortcutConflicts()` helper; UI is 21i.

## Part B — StarUI UI docs (surfaces; engine-API implications only — panels/toolbars are 21i)

- **06 plus-minus panel / 07 shortcuts panel**: master-detail list+editor; module settings as a draft item (`itemId='settings'`); comma-separated column-scope input; meta lines (`on/off · ±step · scope`). Engine implication: nudges/shortcuts are plain arrays in state; per-item commit by id; live expression validation binds to `@cgrid/expression`.
- **09 smart-edit panel / 10 bulk-update panel**: pure settings forms over the settings trio; op set held as `Set`, persisted as array. Engine implication: settings objects must serialize cleanly to JSON and merge partials over defaults.
- **14 smart-edit toolbar**: operand input + op buttons + Set… dialog + preview table + threshold confirm. Engine surface consumed: `resolveTargetCells(api)`, `buildSmartEditPatches(targets, op, value)`, `previewPatches(patches)`, `applyEdits(api, targets, op, value, {journal, patches})` (async, atomic), `enforceSingleColumn` checked upfront. **Toolbar never mutates the grid — patches only.** Operand draft survives selection changes.
- **15 bulk-update toolbar**: type-inferred input (from first selected cell's dataType), async distinct-values dropdown (opt-in, only when values exist), single-column guard disables Apply with tooltip. Engine surface: `resolveColumnDistinctValues(api, colId, limit)` (async), `bulkUpdateValueKind(cellDataType)`, `applyBulkUpdateEdits()`.
- **16 edit-history toolbar**: Undo/Redo buttons + entry count; journal as a black box — `canUndo`/`canRedo`/`undo()`/`redo()`/`subscribe()` is the full contract it consumes. Great end-to-end smoke test for the journal.

Net engine API the UI layer will need later (21i): journal `{canUndo, canRedo, undo, redo, undoEntry, entries, subscribe}`; ops `{collectTargets, buildPatches, preview, apply}` per feature; settings trio + nudges/shortcuts arrays; `detectShortcutConflicts`.

## Part C — cgrid kernel seam inventory (verified 2026-07-02, main @ 871181c)

### C.1 Editing pipeline

Owner `EditController` (`packages/kernel/src/core/editController.ts`); CGrid delegates. Triggers: single/double click via `EditTrigger` (`interaction/features/editTrigger.ts:18/36`, gated by `suppressClickEdit` + `isCellEditable`); F2/Enter/type-to-edit via KeyPaging; public `startEditingCell(rowIndex, colId)` (`types/api.ts:486`). Commit path (`editController.ts:289-329`): fetch canonical row from worker → `valueParser` (`:303`) → `valueSetter` or `rowData[field] = parsed` (`:307-312`) → emit `cellValueChanged` + `cellEditingStopped` → `applyTransaction({update:[rowData], async:false})` (`:326`). Full-row commit batches: one `cellValueChanged` per changed cell + `rowValueChanged` + ONE transaction (`:550,:593`).

**`cellValueChanged` payload** (`types/event.ts:108-124`): `{rowId, colId, oldValue, newValue, newRawValue?, source?: 'edit', rowIndex?, data?}` — `rowId` is the REAL worker string id (`editController.ts:316`). Carries oldValue → journal-ready. **No `field`** — derive from colDef (colId===field for field-backed columns).

### C.2 suppressKeyboardEvent — EXISTS (confirms 21e recon)

`SuppressKeyboardEventCallback` (`types/column.ts:65-67`): `({event, editing, data, colId}) => boolean`. ColDef field `:279`, resolved `propertyChain.ts:121/1140`. Consulted head-of-chain in BOTH `CellKeyboardEvents.handleKeyDown` (`cellKeyboardEvents.ts:37-46`) and `EditTrigger.handleKeyDown` (`editTrigger.ts:47-61`). Returning true skips the grid's ENTIRE keyboard pipeline (editor never opens) — browser still sees the native key. Intercepting `+`/`-` before edit: **yes**.

### C.3 Keyboard flow — the better seam: `cellKeyDown` / `cellKeyPress` (Cycle 23/24 landed)

`CellKeyboardEvents` sits at the HEAD of the feature chain (`interaction/features/cellKeyboardEvents.ts`). On every keydown with a focused cell it emits **public, cancelable** events BEFORE any grid handler:
- `cellKeyDown` (`types/event.ts:160-166`): `{rowId, colId, value, event: KeyboardEvent}`
- `cellKeyPress` (`:167-175`): same, printable single chars only (no Ctrl/Meta/Alt)

`event.preventDefault()` from a listener short-circuits the whole downstream chain (`cellKeyboardEvents.ts:57-62`) — EditTrigger/type-to-edit never see the key, editor does not open. **An addon can claim `+`/`-`/letter keys with a plain event subscription — no colDef transform, no kernel change.** Ordering note: per-column `suppressKeyboardEvent` is checked BEFORE `cellKeyDown` is emitted (`:37-46`) — if an app suppresses a key, addon listeners won't see it (correct precedence: app colDef wins).

No public grid-root DOM getter (`this.root` private, `cgrid.ts:792`) — not needed; the app owns the container it passed to `new CGrid(container, options)`, and `cellKeyDown` covers focused-cell keys.

Caveat (pre-#98): `cellKeyDown.rowId` comes from `rowIdAt(rowIndex)` which is the synthetic `row-${index}` stub (`cgrid.ts:6861`). **PR #98 fixes this at the source** — `rowIdAt` delegates to `stringRowIdAt` for all ~12 call sites (verified in the PR diff; synthetic only as out-of-chunk fallback). → 21g takes PR #98 as a hard dependency.

### C.4 Data access & rowIds

- `forEachRow((rowId, row) => void)` — public (`types/api.ts:425`, impl `cgrid.ts:3105`), iterates the main-thread `rowDataById` mirror.
- `rowDataById` — private Map, synced by `setRowData` + all transaction paths. **No public `getRowById`** single-row accessor.
- `getCellValue(rowIndex, colId)` (`types/api.ts:713`) — viewport-chunk only.
- `options.getRowId` required (`cgrid.ts:778`); `inferRowIdField` derives the id field (`cgrid.ts:227-234`), same derivation worker-side.
- Addon answer (renderers-bridge precedent, `packages/renderers/src/bridge.ts:219-238`): own rowId→row mirror seeded from `forEachRow()`, freshened on `rowsChanged`, **cleared+reseeded on `modelUpdated`** (21f final-review lesson: same-rowId `setRowData` emits `modelUpdated`, NOT `rowsChanged` — a mirror without that clear goes permanently stale).

### C.5 Mutation / transactions

- `applyTransaction(t): TransactionResult` (`types/api.ts:36`, impl `cgrid.ts:1979`), `applyTransactionAsync` (`:37`), `flushAsyncTransactions` (`:38`). `Tx = {add?, update?, remove?}` — **`update` REPLACES the row** (worker RowStore.apply, `cgrid.ts:2378`). Result carries `{add/update/remove: [{rowId}]}`.
- **No per-cell `setDataValue`** — the editor itself commits via `applyTransaction({update:[row]})`.
- One transaction = one worker round-trip = one re-render; `update` arrays batch freely (full-row commit precedent).
- Events after mutation: worker recompute → `modelUpdated` (`cgrid.ts:1697/1966`); `rowsChanged` (`types/event.ts:133-139`) once per mirror-mutating transaction, **listener-gated**, `source: 'transaction'|'transactionAsync'|'edit'`, `updated[]` includes **`oldRow` snapshots**.

### C.6 Distinct values (landed 21d)

`getDistinctValues(colId, limit?): Promise<string[]>` — public (`types/api.ts:418-421`, impl `cgrid.ts:2959`, worker scan). Note: returns **stringified** values → bulk-update must parse back type-aware (`parseBulkUpdateValue`).

### C.7 Selection model

Public (`types/api.ts`): `getCellRanges(): SelectionRange[]` (`:280`; `{rowStart, rowEnd, colIds}` in **visible-order indices**, mutation-safe snapshot), `addCellRange` (`:284`), `clearCellRanges` (`:287`), `getFocusedCell()/setFocusedCell(rowId, colId)` (`:289-290`), `getSelectedRowIds()/setSelectedRowIds` (`:198-199`). Events: `rangeSelectionChanged`/`cellSelectionChanged`/`selectionChanged`. Programmatic restore: snapshot + `clearCellRanges` + `addCellRange` loop + `setFocusedCell` + `setSelectedRowIds`. Ranges are index-based → a mutation that resorts rows can shift what the restored range covers (documented limitation; id-based re-anchor would need extra machinery).

### C.8 Undo/redo in kernel

**None.** Grep confirms no undo/redo/edit-stack anywhere in `packages/kernel/src` (hits are icon path data + unrelated comments). The cycle-21 master spec assigns EditJournal to `@cgrid/edit` (master doc §4.7, `2026-07-01-...-intrinsic-features.md:231-242`). Journal is greenfield addon territory — no `unifyUndo` conflict, drop that flag.

### C.9 Editable / value hooks

- `editable?: boolean | ({data, colId, rowIndex, value}) => boolean` (`types/column.ts:272/34-36`); resolved by `EditController.isCellEditable` (`editController.ts:411-428`). ~~public bridge `cgrid.ts:1423`~~ **CORRECTION (plan-time code check, 21g-S2): `cgrid.ts:1423` is the internal feature-deps object, NOT an api bridge — `isCellEditable` is private (`cgrid.ts:7649`) and absent from `types/api.ts`. Same for `isEditing()` (private `isAnyEditOpen`, `cgrid.ts:7672`). The edit bridge replicates editability addon-side from resolved colDefs and derives its editing flag from `cellEditingStarted`/`cellEditingStopped` events.**
- `valueParser({newValue, oldValue, data, colDef})` (`types/column.ts:386/561-569`); `valueSetter({data, newValue, oldValue, colDef})` (`:394/571+`).
- **Kernel runs valueParser/valueSetter ONLY inside the editor commit path** (`editController.ts:303-312`). Programmatic patches (smart-edit/bulk-update/nudges) bypass the editor → `@cgrid/edit` must apply the same parser→setter contract itself before building transaction payloads, or programmatic edits diverge from interactive ones. Correctness requirement for the spec.

### C.10 Addon-attachment pattern (canonical template)

`wireRenderersIntoKernel(grid, opts)` (`packages/renderers/src/bridge.ts:196`): structural `KernelGridSurface` interface over public API only (`:120-137`); idempotency handle stashed on the grid (`:201`); `subscribe()` prefers `on` else `addEventListener` (`:182-190`); row mirror (`:219-238`); returns handle with `destroy()`. Peer bridges: `packages/{calc,format,rules}/src/bridge.ts`. Event subscription API: `on/off/addEventListener/removeEventListener` (`types/api.ts:492-507`), `on` returns unsubscribe.

## Part D — Conclusions feeding the spec (the four open questions)

**D.1 Plus/minus & shortcuts interception → `cellKeyDown` + `preventDefault()`, NOT colDef suppressKeyboardEvent transforms.** The kernel's head-of-chain `cellKeyDown` is public, focused-cell-aware, carries the KeyboardEvent, and cancels the entire downstream pipeline — strictly better than StarUI's transform approach (no colDef mutation, rules can change dynamically without re-resolving colDefs, one subscription instead of N wrapped callbacks). `suppressKeyboardEvent` remains the app-level escape hatch and correctly outranks addon listeners. **Zero kernel diff.** Post-#98 the event carries real rowIds.

**D.2 Cascade-undo atomicity → one transaction per journal entry (worklog recommendation confirmed).** `undoEntry(id)` pops N entries newest→oldest, applying each entry's reversed patches as its own `applyTransaction({update})`. Per-entry reverse-order application is trivially correct when entries touch overlapping cells (later entry's oldValue restores the earlier entry's newValue); coalescing N entries into one Tx would require last-write-wins dedupe in REVERSE patch order — easy to get wrong, saves little (cascade depth is small in practice, bounded by limit=50). Plain `undo()`/`redo()` = exactly one Tx each.

**D.3 Selection preservation across preview/commit → snapshot/restore via public API; preview never touches the grid.** Preview computes projected values from the edit package's own row mirror — no grid mutation, so nothing to preserve at preview time. Commit: snapshot `{getCellRanges(), getFocusedCell(), getSelectedRowIds()}` → one batched Tx → restore. Document the index-based-range caveat (re-sort may shift coverage); id-based re-anchoring deferred unless it bites in the showcase.

**D.4 `getRowById` accessor → NOT needed in kernel.** The addon keeps its own rowId→row mirror (forEachRow seed; `rowsChanged` freshen; `modelUpdated` clear+reseed — the 21f-hardened pattern). All patch building reads current values from the mirror; `cellValueChanged.data` gives the post-commit row for the cell-editor journal feed. Adding a kernel accessor would be pure convenience, fails the no-retroactive-layering bar in reverse (kernel change without kernel need).

**Journal feed split (design point discovered in recon):** interactive editor commits emit `cellValueChanged` (with oldValue) — the journal's `cell-editor` source records from that listener. Programmatic ops (smart-edit/bulk-update/plus-minus/shortcuts) record at patch-build time with their own source — their transactions do NOT emit `cellValueChanged` (kernel only emits it from the editor path), so no double-record. Undo/redo replay transactions likewise never re-record. `stream` source = `rowsChanged` with source `'transaction*'` from host live feeds — recordable only when opted in (default off).

**Kernel-diff verdict: ZERO kernel changes needed.** Everything rides on landed public API: `cellKeyDown`/`cellValueChanged`/`rowsChanged`/`modelUpdated`, `applyTransaction(Async)`, `forEachRow`, `getDistinctValues`, selection get/set, `isCellEditable`, colDef `valueParser`/`valueSetter`/`editable`. Two nice-to-haves surfaced (add `field` to `cellValueChanged`; that's it — the rowId one is already PR #98) — neither crosses the "genuinely needs intrinsic support" bar; both avoidable addon-side. **Hard dependency: PR #98 must merge before 21g's bridge/E2E tasks** (real rowIds in `cellKeyDown`/`getFocusedCell`; lucide icons for the history-toolbar demo).

**Dependencies:** `@cgrid/kernel` (peer, type-only imports + bridge registration — renderers precedent); `@cgrid/expression` (nudge expression gates, main-side `parseAndEvaluate`; grammar `&&`/`||`, `==`/`!=`). No format/rules/calc dependency. Engines Date-free (host-stamped timestamps, injectable now); seeded LCG in tests.
