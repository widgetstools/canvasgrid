# Canvasgrid Cycle 4 — Cell-flash patch (single-task addendum) — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`.
> This is a single-task addendum that closes a sequencing gap in the master
> plan: the cell-flash scaffolding shipped with Cycle 4 (types + CSS tokens
> + painter blend path) but the producer wiring (FlashRegistry,
> `flashMask` in transactions, `api.flashCells`) was never scheduled. The
> downstream cycles that *assume* flash already works — Cycle 23 / Task 7
> (reduced-motion opt-out) and Cycle 24 / Task 7 (GPU cell-flash overlay) —
> would otherwise have no flash to opt out of or optimize. Run this task
> before scheduling Cycle 23 or 24.

**Goal:** Wire cell-change flash end-to-end so the demo's STOMP live updates
visibly flash on receive. Adds the producer side (worker diffs row data and
ships `flashMask`; main feeds the mask into a `FlashRegistry`; rAF tick
drives per-frame `flashAlpha` into the existing painter blend path);
exposes `VelocityGridApi.flashCells({rowIds, colIds, ...})` for programmatic
flashing; flips the painter's hard-coded color to the theme variable so
light / dark themes both render correctly.

**Architecture:** The scaffolding from Cycle 4 stays — no API churn. The
producer side fits between two existing seams:

1. **Worker boundary:** `RowStore.apply(update)` already returns a
   `TransactionResult`. Extend it to also compute a per-row-per-column diff
   bitmap (rowId + colId pairs where the value changed). The worker
   maintains a small **pending-changes set** (`Set<rowId-colId>` keys) that
   it drains into the next `ViewportChunk.flashMask`. The mask is packed
   row-major, one bit per cell, matching the design at
   `foundation-design.md` §7.4.
2. **Main boundary:** `WorkerClient.onChunk` (or the existing
   `cgrid.applyViewportChunk` path) reads `chunk.flashMask`, walks the
   visible row/col indices, and calls `registry.flash(rowId, colId)` for
   each set bit. The registry stores `FlashEntry` records and exposes
   `getAlpha(rowId, colId, now)` returning `number | 0`. The byRows
   painter's `cellData` callback (already plumbed) reads from the registry
   per cell per paint, so flash adds zero allocation on the scroll path.
3. **rAF tick:** `FlashRegistry.tick(now)` runs once per rAF; it advances
   active entries, marks the union of their cell rects dirty via
   `dirtyRegions.add`, and prunes expired entries. The next paint
   re-evaluates `getAlpha` for those cells and the registry returns the
   fade value. When no entries are active the registry returns `0` and
   adds nothing to the dirty set — flash overhead is exactly proportional
   to the number of currently-flashing cells, not the row count.

The painter at [registry.ts:65-71](cgrid/src/renderer/cellRenderers/registry.ts#L65-L71)
currently hard-codes `'#fef3c7'`. Task replaces that with
`theme.flashFromColor` (read from `--vg-flash-from-color` at theme-resolve
time and cached on the resolved-theme record so the paint loop avoids a
per-cell `getComputedStyle`).

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E), single-canvas
2D paint, Web Worker data pipeline, CSS-variable theming. No new runtime
dependencies. No protocol breakage — `flashMask` is already in the
`ViewportChunk` slot and `collectViewportTransferables` already handles
its buffer.

**References (READ FIRST):**
- `docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md` §6.6 (Cell-flash animation) + §7.4 (Chunk format — `flashMask` shape)
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan; Cycle 23 / Task 7 (reduced motion) and Cycle 24 / Task 7 (GPU overlay) both depend on this patch landing first
- `docs/catalog/04-data-updates.md` — `enableCellChangeFlash`, `cellFlashDuration`, `cellFadeDuration`, `api.flashCells`
- `cgrid/src/renderer/cellRenderers/registry.ts:65-71` — existing painter blend (the consumer)
- `cgrid/src/renderer/painters/byRows.ts:236-288` — `flashAlpha` already threaded into `CellPaintConfig`
- `cgrid/src/core/propertyChain.ts:177,243` — `ApplyCellPropsInput.flashAlpha` already plumbed
- `cgrid/src/worker/protocol.ts` — `ViewportChunk.flashMask?: Uint8Array` slot + `collectViewportTransferables` already handles its buffer
- `cgrid/src/worker/dataPipeline.ts` — `RowStore.apply(update)` (extension point for the diff)
- `cgrid/src/theming/tokens.css:36-37,65-66` — `--vg-flash-from-color` / `--vg-flash-to-color` for both light + dark themes
- `cgrid/src/core/runtimeOptions.ts:125-146` — `enableCellChangeFlash` / `cellFlashDuration` / `cellFadeDuration` already runtime-mutable

## Global Constraints

Extend the Cycle 4 constraints. New ones marked **NEW**.

- **Additive API only.** `VelocityGridOptions` already carries
  `enableCellChangeFlash` / `cellFlashDuration` / `cellFadeDuration`; do not
  rename. The new `flashCells` method is the only `VelocityGridApi` addition.
- **No protocol breakage.** `ViewportChunk.flashMask` already exists as
  `Uint8Array?` and `collectViewportTransferables` already handles its
  buffer. Worker just starts populating it; main starts reading it.
- **Allocation discipline.** `FlashRegistry.getAlpha(rowId, colId, now)` is
  called once per visible cell per paint. Must be `O(active entries)` (a
  `Map<rowId-colId, entry>` lookup), zero alloc per call, no closures
  captured per cell. **NEW**
- **Zero overhead when disabled.** `enableCellChangeFlash: false` (or
  `undefined`) short-circuits both the worker diff (don't compute mask) and
  the main registry feed (don't iterate the bits). The painter
  short-circuit at `flashAlpha > 0` already exists. **NEW**
- **Theme variable, not hard-coded color.** `theme.flashFromColor` and
  `theme.flashToColor` resolve at `CssReader.read()` time, not per cell.
  The painter reads from the cached theme record. **NEW**
- **Reduced motion contract.** Honor `window.matchMedia('(prefers-reduced-motion: reduce)')`
  by short-circuiting the registry feed (worker still ships the mask;
  main drops it). Cycle 23 / Task 7 will refine; this task ships the
  matchMedia listener so the opt-out works from day one. **NEW**
- **TypeScript strict** + **Vitest + Playwright green** + **demo never
  breaks** — unchanged from Cycle 4.

---

## Task overview

Single task. The work is one focused commit + one exit-ritual commit (FM
flips for Area 04 + Area 23).

| # | Task | Primary user-visible win | Files touched |
|---|---|---|---|
| 11 | Cell flash — FlashRegistry + worker flashMask + `api.flashCells` + theme color | STOMP live updates visibly flash; `enableCellChangeFlash` works end-to-end | `core/flashRegistry.ts` (new), `worker/dataPipeline.ts`, `worker/worker.ts`, `worker/protocol.ts` (already has the slot), `velocityGrid.ts`, `theming/cssReader.ts`, `renderer/cellRenderers/registry.ts`, `renderer/cellRenderers/wrapText.ts`, `types.ts`, `apps/cgrid-positions/src/positionsGrid.ts`, tests + E2E |

---

## Task 11 — Cell flash: FlashRegistry + flashMask producer + `api.flashCells` + theme color

**Goal:** Land the full cell-flash pipeline. After this task:
- The demo's STOMP transaction stream visibly flashes updated cells
  (yellow in light theme, amber in dark) for `cellFlashDuration` ms
  before fading over `cellFadeDuration` ms.
- `api.flashCells({rowIds, colIds})` triggers a programmatic flash from
  app code (useful for "row-just-loaded" highlights, validation success
  pulses).
- `prefers-reduced-motion: reduce` suppresses the flash; Cycle 23 will
  refine the opt-out surface.

**Read first:**
- `docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md` §6.6
- `cgrid/src/renderer/cellRenderers/registry.ts:65-71` — paint-side
  consumer; pattern for the wrapText cell mirrors it
- `cgrid/src/worker/dataPipeline.ts` `RowStore.apply` — diff hook
- `cgrid/src/worker/dataPipeline.ts` `ViewportSlicer.slice` — chunk
  emit; flashMask packs alongside `rowIds`
- `cgrid/src/theming/cssReader.ts` — `--vg-flash-from-color` already
  read from CSS vars; just needs forwarding through `ResolvedTheme`

**Files:**
- Create: `cgrid/src/core/flashRegistry.ts` (~120 LOC)
- Create: `cgrid/tests/flashRegistry.test.ts`
- Modify: `cgrid/src/worker/dataPipeline.ts` — `RowStore.apply` returns
  a per-rowId set of changed-field names; `ViewportSlicer.slice` reads
  the pending set and packs `flashMask`
- Modify: `cgrid/src/worker/worker.ts` — drain pending diff set into
  next viewport response when `enableCellChangeFlash` is on (option
  forwarded via `init` payload or a setter)
- Modify: `cgrid/src/worker/protocol.ts` — add an `init` payload field
  `enableCellChangeFlash?: boolean` (worker only computes the mask when
  on; saves CPU for apps that don't use it)
- Modify: `cgrid/src/worker/client.ts` — surface a setter for the
  enable flag so runtime `setGridOption('enableCellChangeFlash', true)`
  flows through
- Modify: `cgrid/src/theming/cssReader.ts` — read `--vg-flash-from-color`
  / `--vg-flash-to-color` into `ResolvedTheme.flashFromColor` /
  `flashToColor`
- Modify: `cgrid/src/renderer/cellRenderers/registry.ts` — replace
  hard-coded `'#fef3c7'` with `theme.flashFromColor` (threaded via
  `CellPaintConfig`)
- Modify: `cgrid/src/renderer/cellRenderers/wrapText.ts` — same fix as
  registry.ts
- Modify: `cgrid/src/velocityGrid.ts` —
  - Instantiate `FlashRegistry`
  - On `setRowData` / `applyTransaction*`, no-op (worker handles diff)
  - On chunk receive: feed `chunk.flashMask` into the registry
  - rAF tick: `registry.tick(now)` + accumulate dirty rects + repaint
    request
  - byRows `cellData` callback reads `registry.getAlpha(rowId, colId, now)`
  - Add `api.flashCells(opts)` method that calls `registry.flashMany(...)`
  - Wire `matchMedia('(prefers-reduced-motion: reduce)')` to suppress
- Modify: `cgrid/src/types.ts` — add `VelocityGridApi.flashCells` signature +
  `FlashCellsParams` type
- Update: `apps/cgrid-positions/src/positionsGrid.ts` — set
  `enableCellChangeFlash: true` so the live STOMP stream flashes
- Create: `apps/cgrid-positions/e2e/cell-flash.spec.ts`
- Update: `docs/catalog/FEATURE_MATRIX.md` — flip Area 04 +
  Area 23 rows (see exit ritual)

**Interfaces produced (consumed by Cycle 23 reduced-motion + Cycle 24 GPU overlay):**

```ts
// cgrid/src/core/flashRegistry.ts

export interface FlashEntry {
  rowId: string;
  colId: string;
  startedAt: number;
  /** Resolved durations captured at flash() time so a later
   *  setGridOption('cellFlashDuration', N) doesn't retroactively
   *  reshape in-flight flashes. */
  flashDuration: number;
  fadeDuration: number;
}

export interface FlashRegistryDeps {
  /** Live read so `setGridOption` flips immediately. */
  getEnabled: () => boolean;
  /** Live read for both initial flashes and `flashCells` calls. */
  getFlashDuration: () => number;
  /** Live read; same rationale. */
  getFadeDuration: () => number;
  /** Honors `prefers-reduced-motion: reduce` — wired to
   *  `matchMedia` in velocityGrid.ts. When true, every `flash()` call is
   *  a no-op. */
  getReducedMotion: () => boolean;
  /** Schedule a repaint of the union of currently-flashing cells.
   *  Cgrid passes `cgridCanvas.requestRepaint`. */
  requestRepaint: () => void;
}

export class FlashRegistry {
  constructor(deps: FlashRegistryDeps);
  /** Mark one cell as flashing. Idempotent for the same cell within
   *  one rAF — repeated calls restart the timer (matches ag-grid). */
  flash(rowId: string, colId: string): void;
  /** Bulk variant — `api.flashCells({rowIds, colIds})` calls this. */
  flashMany(rowIds: readonly string[], colIds: readonly string[]): void;
  /** Drain the worker's flashMask. `chunkColIds` is the column list
   *  the chunk shipped in; the mask packs one bit per cell row-major. */
  ingestMask(chunk: { rowIds: readonly string[]; mask: Uint8Array; chunkColIds: readonly string[] }): void;
  /** Per-rAF tick. Prunes expired entries; no allocation when the
   *  active set is empty (the common case). */
  tick(now: number): void;
  /** Painter-side read. Returns 0 when the cell isn't flashing OR
   *  when the registry is disabled OR reduced motion is on. */
  getAlpha(rowId: string, colId: string, now: number): number;
  /** Number of currently-active entries — for tests. */
  size(): number;
  destroy(): void;
}

// cgrid/src/types.ts (VelocityGridApi addition)

export interface FlashCellsParams {
  /** Row IDs to flash. Required (must be non-empty). */
  rowIds: string[];
  /** Column IDs to flash within each row. When omitted, every
   *  visible column flashes for each row. */
  colIds?: string[];
  /** Override `cellFlashDuration` for this batch. */
  flashDuration?: number;
  /** Override `cellFadeDuration` for this batch. */
  fadeDuration?: number;
}

export interface VelocityGridApi<TRow = any> {
  // … existing methods …
  /** Programmatic cell flash. Useful for app-driven highlights
   *  (validation pulse, row-just-loaded). No-op when
   *  `enableCellChangeFlash: false` or `prefers-reduced-motion:
   *  reduce`. */
  flashCells(params: FlashCellsParams): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing `flashRegistry.test.ts`** — assertions:
      - `flash(rowId, colId)` then `getAlpha(..., startedAt + 0)` returns 1
      - `getAlpha` returns 1 throughout `[startedAt, startedAt + flashDuration]`
      - `getAlpha` linearly fades from 1 → 0 over
        `[startedAt + flashDuration, startedAt + flashDuration + fadeDuration]`
      - `getAlpha` returns 0 past the fade window
      - `tick(now)` past the fade window prunes the entry (`size()` drops)
      - `getEnabled() === false` ⇒ every `flash` is a no-op
      - `getReducedMotion() === true` ⇒ every `flash` is a no-op
      - `ingestMask` correctly unpacks bits and calls `flash` per set bit
      - Re-flashing the same cell restarts the timer
      - `flashMany` with empty `colIds` falls back to "every visible column"
        (test feeds the visible-col list via the bulk shape)
- [ ] **Step 2: Implement `FlashRegistry`** in `core/flashRegistry.ts`.
      Use a `Map<string, FlashEntry>` keyed by `${rowId} ${colId}`
      (NUL separator avoids ambiguity if rowId or colId contains hyphens).
      `tick` walks the map and removes expired entries — O(active), not
      O(rows). Early-out the entire pass when `size() === 0` (no rAF
      cost in the common case).
- [ ] **Step 3: Verify** — `npm test --workspace=cgrid -- flashRegistry` green.
- [ ] **Step 4: Worker diff producer** — extend `RowStore.apply` so
      `update` entries return `{ rowId, changedFields: string[] }`
      alongside the existing rowId-only result. Keep a small
      `pendingDiffs: Map<rowId, Set<field>>` on the worker state, drained
      into `ViewportSlicer.slice` when the next chunk is built.
- [ ] **Step 5: Pack `flashMask`** in `ViewportSlicer.slice`. For each
      visible row, for each requested colId, set bit
      `r * columns.length + c` when `pendingDiffs.get(rowId)?.has(col.field)`.
      Clear the entry after slicing. Skip the whole pass when the worker's
      `enableCellChangeFlash` flag is off (saves CPU + bandwidth).
- [ ] **Step 6: Worker init flag** — add
      `enableCellChangeFlash?: boolean` to `WorkerInitPayload` + a
      `'setEnableCellChangeFlash'` message so runtime
      `setGridOption('enableCellChangeFlash', true)` flips it
      mid-flight.
- [ ] **Step 7: Theme color forwarding** — extend `CssReader` to read
      `--vg-flash-from-color` + `--vg-flash-to-color` into
      `ResolvedTheme`. Replace the hard-coded `'#fef3c7'` in
      `registry.ts` + `wrapText.ts` with `p.theme.flashFromColor` (thread
      via the existing `CellPaintConfig` — `theme` reference is already
      there, just expose the new fields).
- [ ] **Step 8: Wire FlashRegistry in velocityGrid.ts** —
      - Instantiate at constructor with deps reading `options.*` live
        through the existing `getGridOption` getter
      - `matchMedia('(prefers-reduced-motion: reduce)').addEventListener`
        for live updates; `getReducedMotion` reads the cached value
      - On chunk receive (in the existing `applyViewportChunk` /
        `onMessage` viewport handler), call
        `registry.ingestMask({ rowIds, mask: chunk.flashMask, chunkColIds: req.columns })`
        when `chunk.flashMask` is present
      - rAF loop already exists; add `registry.tick(now)` at its head
        and `if (registry.size() > 0) requestRepaint()` so paints keep
        firing while flashes are active
      - `byRows.cellData` callback (the existing closure that builds
        `CellPaintConfig`) reads `registry.getAlpha(rowId, colId, now)`
        and writes it into `flashAlpha` (the painter blend path is
        already in place)
      - `api.flashCells` calls `registry.flashMany(...)`
- [ ] **Step 9: Demo wiring** — add `enableCellChangeFlash: true` to
      `apps/cgrid-positions/src/positionsGrid.ts`. The STOMP stream
      currently does `~100 row updates per 143ms tick` — that's the
      target workload from the foundation spec, perfect for showing the
      flash off.
- [ ] **Step 10: E2E** — `cell-flash.spec.ts`. Use the existing
      `getCellPaintedBg(rowIndex, colId)` test helper to assert the
      flash color appears post-update. Pattern:
      1. Wait for STOMP `phase: live`
      2. Programmatically `flashCells` against a known visible row+col
      3. Poll `getCellPaintedBg` for the flash color (with alpha-aware
         comparison)
      4. Wait `flashDuration + fadeDuration + buffer`
      5. Assert the cell painted the baseline background again
      Also assert `prefers-reduced-motion: reduce` (via
      `page.emulateMedia({ reducedMotion: 'reduce' })`) suppresses the
      flash.
- [ ] **Step 11: Typecheck + full unit suite + cycle7 E2E + new
      cell-flash E2E green.**
- [ ] **Step 12: Commit the implementation** before the exit ritual:

```bash
git commit -m "$(cat <<'EOF'
feat(cgrid): FlashRegistry + worker flashMask producer + api.flashCells + theme flash color

Wires the cell-flash pipeline end-to-end. Cycle 4 shipped the
scaffolding (option types, painter blend path, theme tokens) but the
producer wiring was never scheduled — Cycles 23 + 24 both presume
flash works, this closes the gap.

Worker diffs row data on applyTransaction.update and packs a per-cell
flashMask bitmap into the next ViewportChunk (existing slot;
collectViewportTransferables already handles the buffer). When
options.enableCellChangeFlash is false, the worker skips the diff +
mask emit entirely.

Main feeds the mask into FlashRegistry, which exposes
getAlpha(rowId, colId, now) for the painter's existing flashAlpha
slot. Per-rAF tick prunes expired entries; the registry adds zero
allocation per paint when no flashes are active. Honors
prefers-reduced-motion via matchMedia. Theme color reads from
--vg-flash-from-color (was hard-coded #fef3c7).

VelocityGridApi.flashCells({rowIds, colIds, flashDuration?, fadeDuration?})
lets apps trigger programmatic flashes (validation pulses, row-just-
loaded highlights).

Demo enables enableCellChangeFlash: true so the live STOMP stream
visibly flashes updated cells.

Cycle 4 / Task 11 (cell-flash patch).
EOF
)"
```

**Exit ritual (after the commit):**

- [ ] Update FM rows in `docs/catalog/FEATURE_MATRIX.md` to ✅:
      - **Area 04:** `enableCellChangeFlash`, `cellFlashDuration`,
        `cellFadeDuration`.
      - **Area 23:** `flashCells`.
      - **Area 21 (theming):** `--vg-flash-from-color` /
        `--vg-flash-to-color` rows (if present in the matrix; otherwise
        skip).

- [ ] Append to this worklog under "Shipped":
      - `FlashRegistry` (`core/flashRegistry.ts`)
      - Worker `flashMask` producer (diff + per-chunk pack)
      - `api.flashCells({rowIds, colIds, ...})`
      - Theme-driven flash color (replaces hard-coded `#fef3c7`)
      - `prefers-reduced-motion: reduce` opt-out

- [ ] Commit the exit-ritual changes:

```bash
git commit -m "docs(cgrid): Cycle 4 cell-flash patch exit ritual — FM flips + Shipped list

Flips the cell-flash rows in FM areas 04 + 23 to ✅. Adds the
Shipped section to the cell-flash patch worklog.

Cycle 4 / cell-flash patch / exit ritual."
```

**Acceptance criteria:**
- [ ] `enableCellChangeFlash: true` produces visible flashes on STOMP
      updates in the demo (visual smoke via Chrome DevTools MCP).
- [ ] `enableCellChangeFlash: false` (default) ships zero overhead —
      worker doesn't emit the mask, main doesn't iterate bits,
      registry is empty.
- [ ] `cellFlashDuration` and `cellFadeDuration` are runtime-mutable
      (already true via Cycle 4 / Task 4; verify no regression).
- [ ] `api.flashCells({rowIds, colIds})` flashes the named cells
      programmatically.
- [ ] `prefers-reduced-motion: reduce` suppresses every flash.
- [ ] Light + dark themes both flash in their declared colors.
- [ ] FM Area 04 cell-flash rows + Area 23 `flashCells` flipped.
- [ ] All cgrid + cgrid-positions tests + the new `cell-flash` E2E
      green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-04-cell-flash-patch.md
"Task 11" and execute it. Confirm Cycle 7 is on main (git log should
show "Cycle 7 / Task 9 + exit" at the tip). Branch the new work off
main: batch/cycle-4-cell-flash-patch-<YYYY-MM-DD>. Open a single PR
to main when the task + exit ritual commits land.

Operational gotchas from the Cycle 7 sessions that apply here:
- cgrid/dist/velocity-grid.d.ts is stale unless you `npm --workspace=cgrid run
  build` after editing types.ts. The cgrid-positions typecheck reads
  from dist, not src.
- Vite dev server caches worker.js. If your E2E doesn't reflect a
  worker.ts change, hard-reload and run `npm --workspace=cgrid run
  build` to refresh dist/worker.js.
- For the unit tests, happy-dom ships ResizeObserver + matchMedia so
  the prefers-reduced-motion assertion path runs end-to-end in vitest.
- The painter's existing `flashAlpha > 0` short-circuit means a
  registry returning 0 for every cell costs nothing per paint — keep
  the registry's `getAlpha` fast path zero-alloc.
```

---

## Shipped

- `FlashRegistry` in `core/flashRegistry.ts` — numeric-keyed per-cell
  flash tracker; tri-state lifecycle (active / fading / pruned); honors
  live `enabled` + `reducedMotion` deps; per-rAF tick prunes entries
  + requests repaint when any remain (zero-cost when empty).
- `diffRowFields(old, new)` helper in `worker/dataPipeline.ts` — shallow
  per-field diff used by `applyTransaction.update` to populate the
  worker's `pendingFlashes` map.
- `ViewportSlicer.slice` extended — packs `flashMask: Uint8Array` (one
  bit per cell, row-major) from `pendingFlashes`; caller drains after.
- Worker hooks: `enableCellChangeFlash` init flag, `setEnableCellChangeFlash`
  + `flashCells` request envelopes, `pendingFlashes` state, sync +
  async `applyTransaction` diff producer, `setRowData` reset.
- `VelocityGridApi.flashCells({rowIds, colIds, ...})` — programmatic flash;
  routes through the worker so the worker's string→numeric rowId map
  resolves authoritatively; flash actually lands on the next viewport
  chunk reply.
- `setGridOption('enableCellChangeFlash', N)` runtime mutation —
  forwards to the worker via `setEnableCellChangeFlash` (off wipes
  pendingFlashes so a stale entry doesn't paint).
- Theme-driven flash color — `theme.flashFromColor` resolved at
  `CssReader.read()` time + threaded through `CellPaintConfig.flashFromColor`;
  painter blend uses it instead of hard-coded `#fef3c7`. Light + dark
  themes both flash in their declared colors.
- `prefers-reduced-motion: reduce` opt-out — `matchMedia` listener in
  cgrid; FlashRegistry short-circuits every `flash()` and `getAlpha()`
  call. Cycle 23 / Task 7 can layer additional opt-out surfaces.
- Demo wiring — `apps/cgrid-positions` already had
  `enableCellChangeFlash: true` in its options; STOMP live updates now
  visibly flash updated cells (visual smoke at
  `.playwright-mcp/cycle4-task11-01-live-flash.png`).
- Tests:
  - `tests/flashRegistry.test.ts` — 13 unit assertions.
  - `tests/dataPipelineFlash.test.ts` — 11 unit assertions (diff +
    slicer mask packing).
  - `apps/cgrid-positions/e2e/cell-flash.spec.ts` — 4 E2E specs
    (programmatic flash, runtime disable, re-enable, reduced-motion).

---

## Cell-flash patch status: COMPLETE

Acceptance criteria:
- [x] `enableCellChangeFlash: true` produces visible flashes on STOMP
      updates in the demo (visual smoke captured).
- [x] `enableCellChangeFlash: false` ships zero overhead — worker
      doesn't compute diff, slicer doesn't pack mask, registry is
      empty.
- [x] `cellFlashDuration` and `cellFadeDuration` are runtime-mutable
      via `setGridOption` (no regression from Cycle 4 / Task 4 wiring).
- [x] `api.flashCells({rowIds, colIds})` flashes the named cells
      programmatically (E2E green).
- [x] `prefers-reduced-motion: reduce` suppresses every flash (E2E
      green).
- [x] Light + dark themes both flash in their declared colors
      (resolved from `--vg-flash-from-color`).
- [x] FM Area 01 (`cellFlashDuration` / `cellFadeDuration`), Area 02
      (`enableCellChangeFlash`), Area 04 (`enableCellChangeFlash` /
      `cellFlashDuration` / `cellFadeDuration` / `flashCells` /
      auto-trigger behavior), Area 05 (`flashCells`), Area 23 (Cells
      API `flashCells`) rows flipped.
- [x] All cgrid (714) + cgrid-positions tests + Cycle 7 E2E (46) +
      new cell-flash E2E (4) green.

Next sessions can now schedule **Cycle 23 / Task 7** (reduced-motion
opt-out, which can layer additional surfaces on top of the
`matchMedia` listener this patch wires) and **Cycle 24 / Task 7** (GPU
cell-flash overlay, a perf optimization that replaces the per-cell
repaint with a single offscreen alpha-mask canvas).
