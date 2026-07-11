# cgrid — Damage-Region Rendering (partial repaints + scroll blit)

- **Status:** Approved approach (user 2026-07-11); ready for implementation planning.
- **Why now:** Under OpenFin/Electron-class runtimes the Canvas2D pipeline is
  3–10× slower than branded Chrome (measured 2026-07-11, see
  `apps/cgrid-ext-demo/openfin/PERF-NOTES.md`). cgrid repaints the FULL
  viewport on every dirty event, so a repaint that costs <8ms in Chrome costs
  50–100ms there — visible jank on every tick batch, flash decay, hover, and
  scroll. This design makes repaint cost proportional to what changed, which
  also banks the headroom Cycle 20's 60Hz×50k ticking target needs.

## 1. Goal

Repaint only what changed. A tick batch touching 8 cells repaints ~8 cells.
A hover change repaints two row bands. A scroll repaints one newly exposed
band plus the sticky strip, moving the rest with a canvas self-blit. A theme
change still repaints everything. Cumulative pixels must be IDENTICAL to
what a full repaint would produce — partial painting changes when/where we
paint, never what.

## 2. Current state (audited 2026-07-11)

One global boolean (`CGridCanvas.dirty`, core/canvas.ts:103). Every event
funnels into `requestRepaint()` (≈40 call sites), and `Renderer.paint`
(renderer/renderer.ts:153) repaints the full surface in six phases:
full-canvas background fill (:187), `paintCellsByRows`, `paintGridLines`,
`paintStickyGroups`, focus `paintOverlay`, `paintRangeOverlay`. Cell borders
and decorators run per-cell inside the cell renderers.

Ready-made seams:
- Every pass iterates `vs.visibleRows` / `vs.visibleColumns`; byRows already
  clips per-subgrid bands (byRows.ts:331–378). Rects intersect naturally.
- `ViewportRow.top/bottom` gives exact row bands (core/viewport.ts).
- `FlashRegistry` holds exact `rowId␀colId` keys with expiry
  (core/flashRegistry.ts:88) — today it triggers FULL repaints per frame.
- The worker computes the per-transaction `touched` rowId set
  (worker/worker.ts:428–452) and discards it; `ViewportChunk.flashMask`
  (protocol.ts:177) is the only per-cell change signal shipped today.
- No paint instrumentation exists anywhere.

Retrofit hazards (each gets an explicit rule in §4):
- The unconditional full-surface background fill.
- Passes that draw OUTSIDE cell rects: sticky-group drop shadow
  (stickyGroups.ts:151–158), full-span gridlines, the range fill handle
  (rangeOverlayPainter.ts:108–117), decorator/border bleed at cell edges.
- Editor overlay is DOM (never canvas-damaged); floating filters are DOM.

## 3. Architecture

Three units, one invariant.

### 3a. `DamageLedger` (new, `core/damageLedger.ts`)

Accumulates SEMANTIC damage between paints; resolves to clip rects at paint
time against the CURRENT `ViewportState` (semantic entries survive scroll —
geometry is computed at paint, not at enqueue). Entry kinds:

```ts
type Damage =
  | { kind: 'full' }
  | { kind: 'rows'; rowIndices: number[] }          // display indices
  | { kind: 'cells'; cells: Array<{ rowId: number; colId: string }> }
  | { kind: 'band'; top: number; bottom: number }   // CSS-px, body space
  | { kind: 'rect'; x: number; y: number; w: number; h: number };
```

API: `add(d: Damage)`, `takeResolved(vs: ViewportState): ResolvedDamage`.
`ResolvedDamage` = `{ full: boolean; rects: Rect[] }` where rects are
merged/deduped, expanded per §4 rules, and CAPPED: more than 12 rects or
union area > 60% of the canvas collapses to `full` (clip bookkeeping must
never cost more than it saves). Cells whose rowId is not in the current
viewport resolve to nothing (they're off-screen). Unknown ⇒ full.

### 3b. Damage-aware paint (`Renderer.paint(gc, damage)`)

`CGridCanvas` keeps its boolean dirty + RAF gating exactly as today; the
ledger rides beside it. `paintNow()` passes `ledger.takeResolved(vs)` into
`Renderer.paint`. When `damage.full`, behavior is byte-identical to today.
Otherwise:

1. `gc.save(); path = union of damage rects; gc.clip(path)`.
2. Background fill runs per damage rect instead of `(0,0,w,h)`.
3. All six phases run as today under the clip — correctness comes from the
   clip; SPEED comes from culling: `paintCellsByRows` skips rows whose band
   does not intersect the damage bounds (cheap `row.bottom < minY ||
   row.top > maxY` test in the existing row loops), and skips columns
   outside `[minX, maxX]`. gridlines/sticky/overlays run unculled (they are
   cheap; the clip prunes their raster).
4. `gc.restore()`.

### 3c. Damage sources (rewiring the ≈40 `requestRepaint()` sites)

`CGrid` gains three private helpers that both add damage and call
`requestRepaint()`: `repaintFull()`, `repaintRows(indices)`,
`repaintCells(cells)`. Call sites migrate by category; **anything not
explicitly migrated keeps full-damage semantics** (correctness default —
a stale full repaint is never wrong, only slow).

| Source | Today | Becomes |
|---|---|---|
| Worker chunk after tick (`handleViewportChunk`, cgrid.ts:7615) | full | `rows(touchedRows)` from the chunk (§3d); full when chunk is a fresh window (scroll fetch/first load) |
| Flash tick loop (flashRegistry.ts:177, cgrid.ts:7725) | full/frame | `cells(active flash keys)` + group-flash cells |
| Hover move/reset (onHover.ts:39,74) | full | `rows([oldHovered, newHovered])` |
| Selection/focus change (cgrid.ts:2324) | full | `rows(affected)` for row selection; `cells`/`rect` for focus + cell ranges (old ∪ new range rects; fill handle rides the range rect + bleed) |
| Scroll (cgrid.ts:1332) | full | Phase B blit (§5); Phase A keeps full |
| Theme/resize/state/column ops/pivot/group/quick filter/editor/etc. | full | full (unchanged) |

### 3d. Worker: ship the touched set (protocol addition)

`ViewportChunk` gains `touchedRows?: Uint32Array` — indices INTO the
chunk's row window whose underlying row was touched by transactions since
the previous chunk for this window (the worker already computes the rowId
set at worker.ts:428–452; this intersects it with the outgoing window).
Rules: absent ⇒ caller treats the whole chunk as changed (full damage —
old-worker/new-main mismatch stays correct); present-but-empty ⇒ no data
damage. `flashMask` stays as-is (flash ≠ changed: flash is opt-in per
column). Row granularity is deliberate — a row band repaint is ~1–3% of
the viewport and avoids per-cell bookkeeping on the hot path.

## 4. Correctness rules (the bleed contract)

Resolved rects are EXPANDED before clipping so passes that draw beyond cell
rects stay correct:

1. Every rect inflates by `BLEED = 2px` (cell borders paint inside, but
   focus ring, fill handle, and decorator icons may straddle edges).
2. A rect intersecting the sticky-group band extends to cover the band plus
   `SHADOW_HEIGHT` below it.
3. Row-band rects span the full body width (gridline horizontals, row
   backgrounds, and selection tints are row-atomic anyway); cell rects stay
   cell-scoped horizontally but their row's gridline row-bottom line is
   inside the +2px bleed. **Amended (closeout fix wave) — I1:** T6's
   discovery that a clip edge landing mid-glyph produces Skia AA
   divergence (fixed for horizontal/row edges via `rowBoundsAtY`
   row-atomic snapping) applies identically to the vertical/column axis —
   cell renderers don't clip per cell, so a bled vertical edge can still
   land mid-glyph at a column boundary. `colBoundsAtX` mirrors
   `rowBoundsAtY`: a cell rect's bled x-edges snap OUT to the full bounds
   of whichever column they land inside, same as rows do.
4. If the totals/pinned band or header band intersects damage, extend to
   that band's full rect (their painters assume band-atomic draws).
5. DPR: rects snap OUT to device-pixel boundaries
   (`floor(x*dpr)/dpr`, `ceil(...)`) so clip edges never land mid-pixel.

**The invariance test (§7) is the enforcement mechanism, not code review.**

## 5. Phase B — scroll blit

On a pure vertical scroll of `dy` CSS px (no horizontal delta, no zoom/DPR
change, `|dy| <` body height):

1. `gc.drawImage(canvas, 0, bodyTop*dpr, w*dpr, bodyH*dpr, 0, (bodyTop-dy)*dpr, w*dpr, bodyH*dpr)`
   — self-copy of the body region (GPU-side move; fast even in OpenFin).
2. Damage = newly exposed band (`dy` tall) ∪ sticky-group band(+shadow) ∪
   any active flash/hover/focus rects (they were blitted correctly since
   they scroll with content, but the sticky strip and the exposed band must
   repaint) ∪ pinned/totals bands (they don't scroll).
3. Horizontal scroll mirrors with pinned-column bands excluded from the
   copy (pinned columns don't move horizontally).
4. Bail to full damage when: both axes moved, `|dy| ≥` body height, DPR or
   bounds changed since last paint, or the previous frame was itself
   partial-failed. The blit is an optimization with a full-paint fallback,
   never a correctness dependency.

Chunk fetch keeps its own damage: when scrolling exposes rows whose data
hasn't arrived, the exposed band paints from the (stale/empty) store as
today, and the chunk's arrival re-damages those rows — no new blank-cell
behavior is introduced.

## 6. Instrumentation (`getPaintStats()`)

New public API surface (kernel):

```ts
interface PaintStats {
  paints: number; fullPaints: number; partialPaints: number; blits: number;
  lastRects: number; lastAreaPct: number;   // damage area / canvas area
  avgPaintMs: number; worstPaintMs: number; // EMA + high-water since reset
}
api.getPaintStats(): PaintStats; api.resetPaintStats(): void;
```

Collected in `paintNow` (first real paint timing in the kernel). This is
how E2E asserts the feature (tick paints must report `areaPct < 25` — see
the §7 amendment below for why the bar moved from the original `< 5`),
how PERF-NOTES probes verify OpenFin, and how regressions get caught.

## 7. Testing

- **Unit (kernel):** DamageLedger — merge/dedupe, cap-collapse to full,
  semantic→rect resolution against a synthetic ViewportState, bleed/sticky/
  band expansion rules, DPR snapping.
- **Invariance harness (the crown jewel):** run a scripted sequence
  (transactions, flash, hover, selection, scroll) twice — once with partial
  repaint, once with `suppressPartialRepaint` — and assert the canvas
  backing stores are pixel-identical after every step (`getImageData` hash
  per step). Requires real rasterization, which the happy-dom unit harness
  cannot do: implement as a Playwright test against the ext demo (a
  `?paintHarness` page hook exposing the step script), falling back to a
  node-canvas-injected 2D context in kernel tests only if that proves
  equivalent. Any bleed-contract violation fails here, not in a screenshot
  review.
- **Integration:** paint stats after `applyTransactionAsync` show partial
  paints with `areaPct` proportional to touched rows; scroll produces
  blit+band; theme change produces full.
- **E2E (ext demo):** live-tick steady state reports `partialPaints ≫
  fullPaints` and `lastAreaPct < 25` (see amendment below); visual
  behavior suites unchanged. Sample `lastAreaPct` repeatedly across the
  observation window (not a single snapshot) and assert both a max and a
  median bound — a single lucky small paint must not be able to mask a
  regression drifting toward the 60% full-repaint cap.
- **OpenFin verification (manual gate):** `openfin/perf-probe.mjs` on the
  hosted demo — success bar: **zero frames > 50ms over 30s** at default
  tick load at rest, and scroll p99 ≤ 34ms (two 60Hz frames).

**Amendment (closeout fix wave, 2026-07-11) — `areaPct` bar relaxed from
`< 5` to `< 25`.** The original `< 5` bound was geometrically
unattainable, not a masked inefficiency: one full-width single-row band
is `rowHeight / canvasHeight` ≈ 32px / ~450px ≈ 7% at the demo's test
viewport — already over the original bar for the SMALLEST possible
non-empty tick damage. More generally, steady-state `areaPct` ≈ (rows
touched per batch / visible rows) × (visible rows × rowHeight /
canvasHeight) ≈ batchSize / totalRows — a function of the tick batch
size relative to the dataset, not of viewport height (a taller viewport
doesn't help: more visible rows to touch scales the fraction back up).
`< 25` keeps the assertion meaningful (a regression toward the 60%
`DAMAGE_MAX_AREA_FRACTION` full-repaint cap still fails it) without
penalizing correct, already-minimal per-row damage. The harness hardens
this with the multi-sample max/median check above so the relaxed
single-sample-friendly bound can't quietly hide a drift upward — measured
envelope at closeout: 0–17%, `fullPaints: 0`.

## 8. Rollout / escape hatch

Grid option `suppressPartialRepaint?: boolean` (default false) forces full
damage everywhere — one flag to bisect any suspected damage bug in the
field. The ledger and stats stay active either way (stats are useful even
for full paints).

## 9. Out of scope (recorded triggers, not commitments)

- Row-strip bitmap caching — only if Phase B measurement misses the scroll
  bar above.
- Worker-side OffscreenCanvas rendering, glyph-atlas GPU text — endgame
  options; not needed for the current bar.
- Per-cell (sub-row) tick damage — row granularity chosen deliberately (§3d).
- The `cgrid.ts` NUL-byte anomaly (~offset 127773) that makes plain grep
  treat the file as binary — worth fixing opportunistically, tracked here
  so the implementer greps with `rg -a` / `grep -a`.
