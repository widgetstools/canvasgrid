# cgrid — Retained Paint-Cache Layer (row-strip bitmap caching, Phase C)

- **Status:** Approved (user 2026-07-11, "go ahead straight with implementation"); approach A from the damage-region spec §9 trigger.
- **Goal:** eliminate the remaining raster work on scroll: the on-screen frame becomes ONE `drawImage` of a retained offscreen layer; text rasters only when content actually changes or the layer extends. Attacks OpenFin's residual >50ms scroll frames and banks Cycle 20's 60Hz×50k headroom.

## 1. Architecture (v1 commitments)

**The layer** (`core/paintCache.ts`): one offscreen canvas (OffscreenCanvas when
available, detached HTMLCanvasElement fallback — `renderer/offscreenSupport.ts`
has the detection), full canvas WIDTH (pinned column bands scroll vertically
with data, so they belong in it), covering the DATA-row region only, extended
vertically by `overscan = paintCacheOverscan (default 0.5) × bodyHeight` each
side, anchored at `layerTop` in CONTENT px (scroll space), device-px backing
with the same dpr transform discipline as `CGridCanvas`.

**Vertical-only.** Horizontal scroll, resize, DPR change, theme change, and
`suppressPartialRepaint` all RESET the layer (anchor to current scroll, full
layer re-raster) — same conservatism the damage system applies to those events.

**Layer layout & painting.** Rows are laid out for the layer via a second
`computeViewport` call (`core/viewport.ts:90` — pure) with synthetic
`scrollTop = layerTop` and `containerHeight = bodyTop + layerHeight`
(`overscanRows: 0`); painters then run against that `layerVs` with
`ctx.translate(0, -bodyTop)` so data rows land at `contentY - layerTop`.
The layer pass paints ONLY data-subgrid rows (skip `isHeader` /
`isFloatingFilter` / `isTotals` / `isPinned` bands — they are screen-anchored
chrome). All state stays BAKED (selection/hover/flash/focus/ranges paint into
the layer through the existing passes) — no base/overlay split, so pixel
invariance holds by construction.

**Present.** Each frame: `drawImage(layer, src=(scrollTop - layerTop)·dpr,
bodyH·dpr → dest bodyTop..bodyBottom)` then the CHROME passes on-screen from
the real `vs`: header/floating-filter/totals/pinned-row bands, gridlines
clipped to those bands, sticky group band (draws OVER the blit), scrollbars
stay DOM. Editor overlay is DOM — unaffected.

**Layer maintenance.** When the visible range approaches a layer edge
(within 25% of overscan): SHIFT — self-blit the layer by the delta, re-anchor,
and damage the newly covered band (content coords). A jump beyond coverage →
reset. Rows whose data isn't in the fetched window paint from the store as-is
(possibly empty) and repaint when their chunk arrives — identical to current
behavior for exposed bands.

**Fetch window coupling.** The worker fetch window must cover the layer:
`ViewportManager`'s row overscan (`rowBuffer`, viewport.ts:91) widens to
`ceil(overscanPx / rowHeightFallback)` so `firstRow..lastRow` (which already
drive the fetch, viewportManager.ts:406) span layer coverage. Velocity
prefetch (`prefetchRange.ts`) stacks on top unchanged.

## 2. Damage integration — two resolution domains

`ResolvedDamage` gains a domain split: `{ full, chromeRects: Rect[] (screen
px), dataRects: Rect[] (CONTENT px), blit }`. `DamageResolveCtx.rowBand` /
`rowBoundsAtY` resolve against the WIDENED layout (layerVs), returning
content-space bands — so `touchedRows` for rows above/below the visible
screen (but inside the layer) damage the layer instead of resolving to
nothing. Chrome damage (header/sticky/totals/pinned-band rects) stays screen
space. Caps apply per-domain (data-domain area cap against LAYER area).
The old `blit` field (screen self-copy) is REPLACED by the present path —
`decideScrollDamage`'s vertical-scroll output becomes "present from new
scrollTop" (plus shift/reset decisions); its bail conditions map to layer
reset. Empty ledger still means full (layer reset + full chrome).

## 3. Frame algorithm (renderer)

```
paint(gc, damage):
  if suppressPaintCache or layer unavailable → legacy Renderer.paint path (damage system as shipped)
  1. maintain layer (reset/shift per damage + scroll position)
  2. raster damage.dataRects into layer (layerVs, translate, clip)
  3. present: blit visible slice to screen body region
  4. raster damage.chromeRects on-screen (chrome bands only, clip)
  5. sticky band pass (always when present, over the blit)
```

Full damage = layer reset + full chrome raster (still ONE frame; the layer
raster covers ~2× viewport — bounded, and rare by the damage system's design).

## 4. Options, API, stats

- `paintCache?: boolean` (default `true`), `paintCacheOverscan?: number`
  (default `0.5`, clamped 0..2), runtime-flippable via `updateGridOptions`
  (flip = reset/teardown).
- `suppressPaintCache` alias honored inside `paintCache:false` semantics —
  ONE option only: `paintCache:false` IS the escape hatch.
- `PaintStats` gains: `presents`, `layerShifts`, `layerResets`,
  `layerRasterMs` (EMA). Existing fields keep their semantics (a present-only
  frame counts as a partial paint with `lastAreaPct` of the rastered damage,
  0 when present-only).

## 5. Testing

- Unit: layer anchor/shift/reset decisions (pure helper), content↔screen
  rect mapping, fetch-window widening math.
- Integration (kernel): stats show `presents` > 0 and near-zero raster on
  pure scroll; layer reset on resize/theme/horizontal scroll; chunk arrival
  for off-screen in-layer rows rasters the layer (stats), not the screen.
- **Invariance harness**: new arm `?paintHarness&noCache` (cache off) hashed
  against the cache-on run for the SAME step script — every existing step
  plus: scroll beyond overscan (forces shift), horizontal scroll (forces
  reset), resize step. Bar unchanged: pixel-identical per step, all arms
  (dpr1, dpr2, sorted, grouped, noFlash) × (cache on/off).
- OpenFin gate: steady bar as before; scroll now expected flat — worst frame
  < 50ms sustained, `fullPaints`+layer resets ≈ 0 during pure scroll.

## 6. Out of scope (recorded)

- Horizontal-scroll retention (content-space column layout) — future.
- Worker-side layer rendering (OffscreenCanvas in worker) — future; the
  layer object is deliberately transferable-friendly.
- Per-strip LRU pools — superseded by the single-layer design.
