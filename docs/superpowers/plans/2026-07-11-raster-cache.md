# Raster Cache Implementation Plan (Cycle 22)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-tier rendered-content bitmap cache (content-keyed cell bitmaps + row-strip retention) so band paints become mostly `drawImage` blits — closing the OpenFin sustained-scroll <50ms bar and making the grid fast under true software raster.

**Architecture:** See spec `docs/superpowers/specs/2026-07-11-raster-cache-design.md` (binding — incl. locked decisions 1–3 and the two-tier design). Recon anchors (verified 2026-07-11): data-cell paint seam `byRows.ts:979` `cellRenderers.get(rendererName).paint(gc, config)` (header seam :625, group-strip :443); final per-cell config built by `applyCellProps` at `byRows.ts:764–821` + quick-filter bg :840–847 + pending icon resolution :856–899; `CellPaintConfig` fields `cellRenderers/registry.ts:9–…` (`registry.get` :233 returns `CellPainter`); layer raster/present/chrome split `renderer.ts:403–498` (`paintLayer` paints cells→gridlines→overlays :418–421, present :445–458); retained layer + pending-band ledger `core/paintCache.ts` (`takePendingNearest` :405, `takePendingIntersecting` :368; injected `PaintCacheCanvasFactory` pattern :134–154); paint closure + planLayer wiring `cgrid.ts:1661–1924`; sync-fill :8541, drain `BUDGET_MS = 3` :8568–8574; `PaintStats` `types/api.ts:44` (counters seeded `cgrid.ts:850–854`); damage cells carry `{rowId, colId}` `damageLedger.ts:16`; options + schema `types/options.ts:279–288`, `optionSchema.ts:87–88`; demo harness params `apps/cgrid-ext-demo/src/main.ts:34–48` (`&suppressPartial`, `&noCache`), invariance arms `e2e/paintInvariance.spec.ts:295–393`; OpenFin probes `apps/cgrid-ext-demo/openfin/{perf-probe.mjs,baseline-probe.mjs,app.json}`, measurement history `PERF-NOTES.md`.

**Tech Stack:** TypeScript, vitest, Playwright (ext demo), OpenFin runtime 41.134.102.3 via CDP :9223.

## Global Constraints

- Pixel invariance: rasterCache-on vs -off must produce identical pixels per harness step; the invariance harness is the enforcement mechanism — never weaken hashes/steps. A hash mismatch = kernel bug; fix kernel, never the test.
- Correctness-by-key, never by-invalidation-scan: any state a cached bitmap depends on is either IN its key/signature or the paint BYPASSES the cache. Every ambiguous case bypasses (paints live) — a bypass is a perf miss, a stale blit is a bug.
- `rasterCache: false` must reproduce the exact shipped paint-cache pipeline (escape hatch alongside `paintCache`/`suppressPartialRepaint`).
- Both tiers share ONE byte budget (`rasterCacheBudgetMB`, default 48) with LRU reclamation; allocation failures degrade to `available=false` no-ops (the `PaintCacheLayer` construction discipline).
- Task zero's decision matrix is BINDING for which fill path ships (per locked decision 2): row-strip/cell-bitmap presentation is the committed architecture; the per-glyph/digit-atlas fill path (Task 3b) is built only if the matrix shows software-raster needs it.
- cgrid.ts NUL byte: `grep -a` / `tr -d '\000'`; Edit tool fine.
- Per task: new tests → FULL kernel suite → `tsc --noEmit` → build → commit to `cycle22/raster-cache`. NO per-task reviewers; ONE fable closeout + one fix wave after Task 6.
- Existing kernel tests + 22+ E2E are the floor; damage-system + paint-cache invariants (empty ledger = full; backlog converges to 0; cache-off byte-identical) must not regress.
- Kill every automation browser/OpenFin process when browser-driven verification finishes.

---

### Task 0: Grain benchmark — three modes × three regimes (decision gate)

**Files:** Create `apps/cgrid-ext-demo/bench/raster-grain.html` + `apps/cgrid-ext-demo/bench/raster-grain.ts` (self-contained page, built by the demo's vite config — add the input to `vite.config` if multi-page isn't already on), `apps/cgrid-ext-demo/openfin/grain-probe.mjs`, `apps/cgrid-ext-demo/openfin/app-bench.json` (copy of app.json pointed at `/bench/raster-grain.html`), `app-bench-swraster.json` (same + `"arguments": "--disable-gpu"` runtime args).

**Produces:** A page that renders a synthetic 40-col × visible-rows financial window (fixed-seed strings: prices, sizes, symbols, ±deltas — deterministic PRNG seeded from a constant, no `Date`/`Math.random` in the paint loop) at one-row-per-frame scroll plus a 10%-cells-per-frame tick phase, in a mode chosen by `?mode=`:
- `fillText` — one `ctx.fillText` per cell (current-kernel shape: set font/fill per style change, not per cell).
- `glyphAtlas` — pre-rasterized per-character atlas (digits + `.,-+$%` + A–Z), one `drawImage` per glyph.
- `cellBlit` — per-cell content bitmaps (LRU keyed by string+style, rasterized on miss via fillText into a scratch canvas), one `drawImage` per cell; `&strips=1` additionally composes rows into strip canvases and presents one `drawImage` per ROW.
Page exposes `window.__bench = { runScroll(frames), runTicks(frames) }` returning `{ mode, frames, paintMsP50, paintMsP95, paintMsWorst, frameMsWorst, longFrames }`. `grain-probe.mjs` drives all modes over CDP and prints a markdown matrix.

Run matrix: stock Chrome, Chrome `--disable-gpu`, OpenFin (app-bench.json, `env -u ELECTRON_RUN_AS_NODE`, warm-up run discarded), OpenFin `--disable-gpu` (app-bench-swraster.json). Append the matrix + a **Grain decision** section to `PERF-NOTES.md`: per regime, which mode wins; whether Task 3b (digit-atlas fill) is IN or OUT; the finalized software-raster bar numbers (spec bars section — steady zero >50ms; scroll ≥2x better than the fillText baseline worst AND <50ms, adjusted here only if the fillText baseline makes 50ms unmeetable on principle, with reasoning recorded). Kill all launched processes. Commit `bench(demo): raster-grain benchmark — fillText vs glyph-atlas vs cell/strip blit across GPU regimes`.

### Task 1: RasterCache core — keys, budget, epochs, stores (pure)

**Files:** Create `packages/kernel/src/renderer/rasterCache/cellCache.ts`, `stripCache.ts`, `budget.ts`, `index.ts`; tests `packages/kernel/tests/rasterCacheCore.test.ts`.

**Produces:**
```ts
// budget.ts — shared LRU byte ledger (both tiers charge it)
export class RasterBudget {
  constructor(maxBytes: number);
  charge(bytes: number, evict: () => number): boolean; // evict() frees LRU entries, returns bytes freed
  spent(): number;
}
// cellCache.ts — Tier 1
export function cellStyleSignature(rendererName: string, config: CellPaintConfig): string;
  // covers EVERY pixel-affecting field a built-in painter reads: valueFormatted,
  // String(value), font, fg, bg, borderColor, halign, valign, letterSpacing,
  // lineHeight, padding, border, textDecoration, ruleIndicator, prefillColor,
  // isFocused/isSelected/isHovered/isHeader (totals/footer lifts already
  // resolve into fg/bg/font upstream, but include the four state booleans
  // that exist on CellPaintConfig anyway, belt-and-braces),
  // sortDirection/sortIndex/sortTotal/unSortIcon/unSortIconColor/iconColor,
  // wrapHeader, headerCheckboxState. Excludes bounds x/y (position-independent);
  // includes w×h.
export function cellCacheBypass(rendererName: string, config: CellPaintConfig, cacheable: boolean): boolean;
  // true (bypass) when: !cacheable (custom renderer not opted in), flashAlpha
  // !== undefined, content !== undefined, decorators non-empty, params !==
  // undefined, or a pending cell icon will draw (caller passes that as
  // `cacheable=false` for the call).
export class CellBitmapCache {
  constructor(budget: RasterBudget, factory: PaintCacheCanvasFactory); // reuse paintCache.ts factory type
  readonly available: boolean;
  epochBump(): void;                       // theme/dpr/option epoch — invalidates ALL (key prefix)
  get(key: string): PaintCacheCanvasLike | null;        // LRU-touches
  render(key: string, wCss: number, hCss: number, dpr: number,
         paint: (gc: CachedContext2D) => void): PaintCacheCanvasLike | null;
  // scratch discipline: canvas sized round(w*dpr)×round(h*dpr), setTransform
  // (dpr,0,0,dpr,0,0); `paint` draws the cell at bounds (0,0,w,h). null when
  // over-budget after eviction or !available → caller paints live.
  stats(): { entries: number; bytes: number };
  dispose(): void;
}
// stripCache.ts — Tier 2
export interface StripKey { rowId: string; rowVersion: number; layoutEpoch: number }
export class RowStripCache {
  constructor(budget: RasterBudget, factory: PaintCacheCanvasFactory);
  readonly available: boolean;
  get(rowId: string, rowVersion: number, layoutEpoch: number): PaintCacheCanvasLike | null;
  capture(key: StripKey, source: CanvasImageSource, srcYDevicePx: number,
          widthDevicePx: number, heightDevicePx: number): void; // copy-out of a just-rastered layer row
  patch(rowId: string, newVersion: number, xCss: number, wCss: number,
        paint: (gc: CachedContext2D) => void): boolean; // repaint one cell span in the strip, advance stored version; false = no entry
  invalidateRow(rowId: string): void;
  layoutEpochBump(): void; // drops everything (column geometry/order/width/theme/dpr/canvas width)
  stats(): { entries: number; bytes: number };
  dispose(): void;
}
```
Behavioral contracts (tests, injected fake canvas factory — no DOM): signature changes whenever any covered field changes and is stable across irrelevant field changes (bounds.x/y); bypass matrix exact; LRU evicts oldest-touched across BOTH tiers through the shared budget until `charge` fits; `render` returns null (never throws) at budget exhaustion with a too-large single entry; `epochBump`/`layoutEpochBump` make every prior key a miss; `patch` on a missing row returns false and on a present row advances the version so the NEXT `get(rowId, newVersion, …)` hits; construction with a null factory → `available=false`, all methods safe no-ops. Pure module — no `Date`, no direct DOM. TDD. Commit `feat(kernel): RasterCache core — content-keyed cell bitmaps + row-strip store under one LRU byte budget`.

### Task 2: Tier 1 integration — cell-bitmap blits at the byRows seam + options + stats

**Files:** Modify `packages/kernel/src/renderer/painters/byRows.ts` (seam :979 and :625), `renderer/cellRenderers/registry.ts` (built-in registrations gain `cacheable: true`; `register()` keeps custom default `false` with an opt-in flag), `renderer/painters/types.ts` (`PainterCtx` gains optional `rasterCells?: { cache: CellBitmapCache; dpr: number }`), `renderer/renderer.ts` (thread `rasterCells` through `buildPctx` + legacy `paint`), `types/options.ts` + `core/optionSchema.ts` (`rasterCache?: boolean` default true, `rasterCacheBudgetMB?: number` default 48 — schema comment lines mirroring paintCache's :87–88 framing), `cgrid.ts` (construct caches when `rasterCache` enabled; wire epochs: theme change → `epochBump`, dpr change → `epochBump`, `setGridOption('rasterCache', false)` → dispose both tiers; extend `PaintStats` in `types/api.ts` + seeds `cgrid.ts:850/9064` with `cellCacheHits/cellCacheMisses/cellCacheBypasses/rasterCacheBytes`); tests `packages/kernel/tests/rasterCacheCells.test.ts` (recorded-gc).

Seam contract (both `:979` data/totals/pinned path and `:625` header path — one shared helper, not two copies): when `p.rasterCells` present AND `!cellCacheBypass(...)` AND no `pendingIcon` for the cell → `key = cellStyleSignature(...)`; hit → `gc.drawImage(bitmap, col.left, cellTop, w, h)` (CSS-px dest under the dpr CTM — the C1 lesson; src is the whole bitmap, no src-rect math) and the painter is NOT called; miss → `cache.render(key, …, (sgc) => painter.paint(sgc, configRebased))` then the same drawImage; `render` returning null → live paint exactly as today. `configRebased` is the SAME shared config object with `bounds` temporarily set to `(0,0,w,h)` and restored after; the scratch is pre-filled with `config.prefillColor` so the painter's own `bg !== prefillColor` skip-fill logic runs unchanged and cached pixels are byte-identical to live-painted ones (prefillColor is also in the signature, so a different underlying row bg is a different key, never a reused bitmap). Tests: hit path performs zero painter calls and one drawImage at the right CSS-px dest; miss→hit round trip; bypass matrix (flashAlpha, custom renderer, params, decorators, icon) paints live; `rasterCache:false` → `rasterCells` absent → recorded call sequence byte-identical to the shipped pipeline (the no-regression proof); stats counters move. FULL kernel suite green. Commit `feat(kernel): Tier-1 cell-bitmap cache at the cell paint seam — content-keyed blits, conservative bypasses`.

### Task 3: Tier 2 integration — strip capture/blit in the layer band raster + patch-on-tick

**Files:** Modify `renderer/renderer.ts` (`paintLayer` splits into cells+gridlines pass → strip consume/capture → overlays bake, all inside the existing clip; new optional `RendererOpts.rasterStrips?: { cache: RowStripCache; rowVersionOf(rowIndex: number): number | null; stringRowIdAt(rowIndex: number): string | null; eligible(rowIndex: number): boolean; layoutEpoch(): number }`), `cgrid.ts` (wire `rasterStrips`; maintain `rowVersionByRowId: Map<string, number>` bumped in the SAME code paths that record `cells`/`rows` damage + on any row-level data apply; `layoutEpoch` counter bumped on column width/order/visibility/pin change, theme, dpr, canvas width change, quick-filter term change, sort/rule/format option change — enumerate each site with a comment naming this contract; strip `patch` driven from the cell-damage path BEFORE the layer raster consumes the resolved rects, using the Tier-1/live paint of just that cell span; extend `PaintStats` with `stripHits/stripMisses/stripCaptures/stripPatches`); tests `packages/kernel/tests/rasterCacheStrips.test.ts`.

Eligibility contract (`eligible(rowIndex)`): a row is strip-cacheable for BOTH capture and consume only when it is a plain data row — not hovered, not selected, not containing the focused cell, no live flash on any of its cells, no active quick-filter terms, not a group/footer/totals/pinned/sticky row. Anything else paints live (bypass, never a stale strip). Consume: inside the band raster, before painting a row's cells, `get(rowId, version, epoch)` hit → one untransformed device-px self-blit-style `drawImage` of the strip into the layer at the row's layer-local y (the `PaintCacheLayer.shift` :256–286 transform discipline) and skip that row's cell loop; gridlines for blitted rows come WITH the strip (capture happens after the band's `paintGridLines`), so the cells+gridlines pass must skip blitted rows in both painters — thread a `skipRows: Set<number>` through `PainterCtx` consumed by `byRows` row loop and `gridLinesPainter` row strokes. Capture: after cells+gridlines and BEFORE `paintOverlay`/`paintRangeOverlay` bake (overlays must never enter a strip), copy-out each fully-rastered eligible row via `capture(...)` — device-px src from the layer canvas. Overlays then paint over blitted and fresh rows alike. Tests (recorded-gc + fake factories): capture-then-consume round trip skips the painter row; overlay pixels never captured (paint order asserted); hovered/selected/flashing rows bypass both ways; patch advances version and a subsequent consume hits; `layoutEpochBump` forces full re-raster; cache-off (`rasterStrips` absent) call sequence byte-identical. FULL kernel suite. Commit `feat(kernel): Tier-2 row-strip cache — capture/consume in the layer band raster, patch-on-tick`.

### Task 3b (CONDITIONAL — only if Task 0's matrix says software raster needs it): digit-atlas fill path

**Files:** Create `packages/kernel/src/renderer/rasterCache/digitAtlas.ts`; modify `cellCache.ts` (`render` accepts an optional glyph-compose fill fn); tests extend `rasterCacheCore.test.ts`.

**Produces:** `class DigitAtlas { constructor(factory); ensure(font: string, fg: string, dpr: number): void; compose(gc: CachedContext2D, text: string, x: number, y: number): boolean }` — pre-rasters `0-9 . , - + %` per (font, fg, dpr) into one atlas canvas; `compose` blits glyph runs for PURELY numeric `valueFormatted` (returns false → caller falls back to fillText) INTO the Tier-1 scratch during a miss render. Presented op count stays one drawImage per cell; only the miss-path rasterization cost changes. Gated by the same `rasterCache` option; no new public option. Contract: pixel output within the invariance harness's tolerance (it isn't — glyph metrics differ — so `compose` must draw with IDENTICAL font/baseline via measured advances from the atlas's own `measureText` capture; the invariance harness is the arbiter and MUST stay green, else this task ships disabled and the closeout adjudicates). Commit `feat(kernel): digit-atlas fill path for Tier-1 miss renders (software-raster regime)`.

### Task 4: Drain-budget closure + demo param + invariance arms + E2E

**Files:** Modify `apps/cgrid-ext-demo/src/main.ts` (`&noRaster` → `rasterCache: false`, alongside :34–48's params), `e2e/paintInvariance.spec.ts` (new arms: raster-on vs raster-off across the FULL existing step script — boot pair `paintHarness` vs `paintHarness&noRaster` mirroring the :295–393 cache-arm pattern; plus a tick-then-scroll-back step that forces strip patch→consume), extend the live-tick stats spec (scroll phase: `stripHits` grows once warmed, `cellCacheHits/(hits+misses)` reported), `cgrid.ts` drain re-eval (measure `BUDGET_MS: 3` vs strip-warmed drain on the OpenFin box in Task 5 — code change here ONLY if kernel tests can lock it deterministically; otherwise record the decision in PERF-NOTES in Task 5 and leave 3).

Gate: full demo E2E suite green (hard gate per repo practice — not just the new arms). Kill the automation browser after. Commit `test(e2e): raster-cache invariance arms + strip/cell stats assertions`.

### Task 5: Gates + OpenFin + software-raster measurement + docs

Kernel/ext/calc suites, `tsc --noEmit`, builds, full demo E2E. OpenFin measurement (PERF-NOTES launch idiom, warm-up discarded, quiet machine — note `vm_stat` if not): steady + sustained-scroll phases with rasterCache on vs off. **Bars (spec §Acceptance):** (1) OpenFin sustained-scroll worst <50ms with cache on; (2) the software-raster bar finalized in Task 0 (run the same probe against Chrome/OpenFin `--disable-gpu`); (3) stats attribution — strip/cell hit counters demonstrate the mechanism (not just wall clock). Record the drain-budget decision (keep `BUDGET_MS: 3` or retune, with strip-warmed measurements). Append everything to `PERF-NOTES.md`; if a bar is missed: capture stats + report for closeout adjudication, no blind tuning. Kill all processes. Update memory/spec status lines. Commit `docs(demo): OpenFin + software-raster re-measure with raster cache — bars adjudicated`.

### Batch closeout (after Task 5)

Single fable closeout + one fix wave. Lenses: staleness-by-design audit (every field a painter reads vs `cellStyleSignature` coverage — grep each built-in painter's `config.` reads); strip eligibility vs every row-presentation input (hover/selection/focus/flash/quick-filter/zebra/group/footer/pinned/sticky); epoch-bump completeness (theme/dpr/column-geometry/option sites); shared-budget math + eviction under pressure (resize storms, 100k-row scroll marathon); C1-class device-px/CSS-px seams (Tier-1 dest, strip capture src, strip consume blit); `rasterCache:false` + `paintCache:false` composition integrity; memory (scratch/strip canvas churn, dispose paths); invariance-harness honesty (no tolerance widening); Task 3b (if built) glyph-metric fidelity.
