# Paint-Cache Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retained offscreen layer for the data region — scroll frames become one `drawImage`; raster happens only for real content changes and layer maintenance.

**Architecture:** See spec `docs/superpowers/specs/2026-07-11-paint-cache-layer-design.md` (binding, incl. §2 two-domain damage and §3 frame algorithm). Recon anchors (verified 2026-07-11): `computeViewport` pure fn `core/viewport.ts:90` (`ViewportInput` :60–88, overscan :91, bodyTop :132–150, center x-range :272–276); painters partition regions via `subgrid.isData/isHeader/isTotals/isPinned` flags and `col.pinned` (`byRows.ts:179–202, 247–254, 339–361`; `gridLinesPainter.ts:55–63, 150–152`); `attachGcCache` (`renderer/gc.ts:67`) is HTMLCanvasElement-typed but 2D-context-pure — widen types for OffscreenCanvas; dpr transform set in `canvas.ts:208–214`; `Renderer.paint(gc, damage?)` at `renderer.ts:199` (blit branch :249–263, clip/fill :265–289); paint closure + lastPainted* snapshots `velocityGrid.ts:1641–1697`; `buildDamageResolveCtx` `velocityGrid.ts:5598–5666`; fetch window `viewportManager.ts:393–424` (+ `prefetchRange.ts`); scroll geometry getters `viewportManager.ts:130–134`, totals `viewport.ts:43–48`. `offscreenSupport.ts` has `isOffscreenCanvasSupported()`.

**Tech Stack:** TypeScript, vitest, Playwright (ext demo).

## Global Constraints

- Pixel invariance: cache-on vs cache-off (and vs suppressPartialRepaint) must produce identical pixels per harness step — the extended invariance harness is the enforcement mechanism; never weaken hashes/steps.
- Every ambiguous/unhandled path resets the layer and/or degrades to FULL — never to a stale blit.
- `paintCache: false` must reproduce the exact shipped damage-system pipeline (it remains the field escape hatch alongside `suppressPartialRepaint`).
- velocityGrid.ts NUL byte: `grep -a` / `sed | tr -d '\000'`; Edit tool fine.
- Per task: new tests → FULL kernel suite → `tsc --noEmit` → build → commit to `cgridext/cursor-theme`. Batch review: NO per-task reviewers; ONE fable closeout + one fix wave.
- The damage-system invariants shipped this week (empty ledger = full; positional-diff window guard; touchedRows semantics) must not regress — the existing 3198 kernel tests + 22 E2E are the floor.

---

### Task 1: PaintCacheLayer core (pure geometry + lifecycle)

**Files:** Create `packages/kernel/src/core/paintCache.ts`, `packages/kernel/tests/paintCache.test.ts`.

**Produces:**
```ts
export interface LayerGeometry { layerTop: number; layerHeight: number }
export type LayerPlan =
  | { kind: 'keep' }
  | { kind: 'shift'; dy: number; newTop: number; rasterBands: Array<{ top: number; bottom: number }> } // content px
  | { kind: 'reset'; newTop: number };
export function planLayer(args: {
  current: LayerGeometry | null; scrollTop: number; bodyHeight: number;
  overscanPx: number; contentHeight: number;
}): LayerPlan;
export class PaintCacheLayer {
  // owns the offscreen canvas + CachedContext2D; geometry fields; ensureSize(widthCss, layerHeightCss, dpr)
  // shift(dy) self-blits; contentToLayerY(y): number; visibleSrcRect(scrollTop, bodyH, dpr): {sy, sh}
  // reset(newTop); dispose(); available: boolean (OffscreenCanvas or detached canvas creation succeeded)
}
```
Behavioral contracts (tests): plan keeps while visible range stays ≥25%-of-overscan inside coverage; shifts by the delta that re-centers, rasterBands = newly covered band(s) only; resets on jumps > coverage or `current === null`; clamps to `[0, contentHeight]` (top of data space); shift near content edges never produces negative-height bands; `planLayer` is pure (no Date/DOM). `ensureSize` reallocates only on size/dpr change (test via fake canvas factory injection). TDD; commit `feat(kernel): PaintCacheLayer — layer geometry planning + offscreen lifecycle`.

### Task 2: Two-domain damage resolution

**Files:** Modify `core/damageLedger.ts` (+`tests/damageLedger.test.ts` extension), `velocityGrid.ts` `buildDamageResolveCtx`.

**Produces:** `ResolvedDamage` becomes `{ full: boolean; chromeRects: Rect[]; dataRects: Rect[]; blit: { dy: number } | null }` — `rects` REMOVED; all consumers updated in this task (renderer temporarily treats `chromeRects.concat(dataRects mapped to screen)` exactly like old `rects` so behavior is unchanged until Task 4 — provide `dataRectToScreen(rect, scrollTop, bodyTop)` helper). `DamageResolveCtx` gains `layerTop/layerHeight/scrollTop` + row resolution against the WIDENED layout (`rowBand` etc. must resolve rows beyond the visible screen when inside `[layerTop, layerTop+layerHeight]`, output CONTENT-space bands in `dataRects`; chrome damage stays screen-space in `chromeRects`). Data-domain caps use LAYER area. When no layer is active (`layerTop === null` semantics: pass `layerTop = scrollTop - 0`, `layerHeight = bodyHeight`), resolution must reproduce today's output exactly — the full kernel suite (with expectation updates ONLY for the rects→two-array rename) is the no-regression proof. Commit `feat(kernel): two-domain damage resolution — content-space data rects + screen-space chrome rects`.

### Task 3: Widened viewport + fetch window

**Files:** Modify `velocityGrid.ts` (layerVs computation), `core/viewportManager.ts` / call path that sets `rowBuffer`/`overscanRows`; test `tests/paintCacheViewport.test.ts`.

**Produces:** `buildLayerViewport(): ViewportState` on VelocityGrid — the synthetic `computeViewport` call per spec §1 (scrollTop=layerTop, containerHeight=bodyTop+layerHeight, overscanRows:0), memoized per (layerTop, layerHeight, viewport recompute generation). Row overscan for the REAL viewport widens to `ceil(overscanPx / rowHeightFallback)` when paintCache enabled (drives worker fetch window per recon; velocity prefetch unchanged). Tests: layerVs rows span layer coverage with content-consistent tops; fetch request range (spy on dispatchViewportRequest or inspect firstRow/lastRow) covers layer range; disabled cache keeps today's overscan. Commit `feat(kernel): layer viewport layout + fetch window coupling`.

### Task 4: Renderer integration — layer raster + present + chrome passes

**Files:** Modify `renderer/renderer.ts`, `renderer/painters/byRows.ts` + `gridLinesPainter.ts` (region filters), `core/canvas.ts`/`renderer/gc.ts` (OffscreenCanvas typing), `velocityGrid.ts` (paint closure, options `paintCache`/`paintCacheOverscan`, stats fields `presents/layerShifts/layerResets/layerRasterMs`); tests `tests/rendererPaintCache.test.ts` (recorded-gc: layer pass skips non-data bands; present drawImage src rect math incl. dpr; chrome pass clips exclude the data body; cache-off path byte-identical call sequence to the shipped pipeline).

Implements spec §3 frame algorithm exactly. Key rules: layer pass runs data-region passes ONLY (skip header/floatingFilter/totals/pinned bands + sticky; overlays/focus/range/hover/flash BAKE into the layer via layerVs); `ctx.translate(0, -bodyTop)`; band clips take layerVs bodyTop/bodyBottom naturally. Present uses device-px src / CSS-px dest (the C1 lesson — dest in CSS px under the dpr CTM). Sticky band always repaints on-screen after present when ancestors exist. Old screen self-blit branch is REMOVED (superseded by present; `decideScrollDamage`'s scroll output feeds planLayer via the paint closure). Full damage ⇒ reset + full layer raster + full chrome. `paintCache:false` short-circuits to the legacy path (keep the code path intact, not re-derived). Commit `feat(kernel): retained paint-cache layer — raster-to-layer, present-by-blit, chrome passes`.

### Task 5: Invariance harness arms + demo E2E + stats assertions

**Files:** Modify `apps/cgrid-ext-demo/src/main.ts` (`?noCache` param → `paintCache:false`), `e2e/paintInvariance.spec.ts` (cache-on vs cache-off comparison for the full step script + NEW steps: scroll-beyond-overscan (shift), horizontal scroll (reset), a resize step via viewport resize; run across existing arms), extend live-tick stats spec (pure-scroll phase: `presents` grows, `layerResets` ≈ 0, fullPaints ≈ 0).

Gate: full demo E2E green. A hash mismatch = kernel bug — fix kernel, never the test. Commit `test(e2e): paint-cache invariance arms + scroll stats assertions`.

### Task 6: Gates + OpenFin measurement + docs

Kernel/ext/calc suites, builds; full demo E2E; OpenFin probe (runtime copy launch idiom in PERF-NOTES.md, `env -u ELECTRON_RUN_AS_NODE`, warm-up discarded) — bar: steady zero >50ms frames; scroll worst <50ms with `layerResets≈0`; append results to `openfin/PERF-NOTES.md`; kill all processes. If the bar is missed: capture stats + report for closeout adjudication (no blind tuning). Commit `docs(demo): OpenFin re-measured with paint-cache layer`.

### Batch closeout (after Task 6)

Single fable closeout + one fix wave. Lenses: pixel invariance across cache arms; every reset path (horizontal scroll/resize/dpr/theme/option flip); two-domain cap math; fetch-window regression (data traffic growth); stats semantics; the C1-class device-px/CSS-px seams in present + layer shift; memory (layer allocation churn on resize storms); legacy-path integrity (`paintCache:false`).
