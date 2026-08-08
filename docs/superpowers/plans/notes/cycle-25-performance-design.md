# Cycle 25 — Performance hardening — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 25
**FM coverage:** Area 26 — ~36 of 38 rows
**Depends on:** Cycle 24 (a11y must NOT regress)

---

## Mental model: the "many times faster than ag-grid" cycle

By Cycle 24, cgrid has full feature parity. Cycle 25 is the
performance investment that JUSTIFIES the rewrite. The Performance
Budget table at the top of the master plan is the contract:

| Metric | Target |
|---|---|
| Cold start (1k × 10) | < 50 ms |
| Cold start (1M × 50) | < 200 ms |
| Scroll FPS (1M × 50) | ≥ 120 fps |
| Streaming throughput | ≥ 50k updates/sec |
| Sort 1M × 1 | < 80 ms |
| Filter 1M | < 50 ms |
| Aggregate 1M × 5 × 3 | < 200 ms |
| Memory (1M × 50) | < 250 MB |
| Bundle (core gz) | < 150 KB |
| FID during scroll | < 16 ms |
| Flash overhead (1k cells) | < 4 ms |

Every task in this cycle MOVES one or more of these numbers toward
or past target. The benchmark harness (Task 1) is the
referee — PRs cannot regress past published numbers.

---

## Task 1 — Benchmark harness

**Goal:** A Vitest bench suite covering every Performance Budget
metric. Outputs JSON; published baselines committed to git.

**File:** `cgrid/bench/*.ts` (new directory).

**Bench shape:**

```typescript
bench('cold start: 1k × 10', () => {
  const host = makeOffscreenContainer();
  new VelocityGrid(host, { columnDefs: cols10, rowData: rows1k });
  // bench tool measures wall-clock
}, { iterations: 20, warmup: 5 });

bench('scroll: 1M × 50 @ 60 fps target', async () => {
  // Set up grid; simulate scroll at 1000 px/frame for 1 s;
  // measure per-frame paint time p95.
});
```

**Output:** `bench/baselines.json` checked into git. CI job (or
local `npm run bench`) diffs current results against baselines;
fails if any metric regresses by > 5 %.

---

## Task 2 — Dictionary-coded text columns

**Goal:** Text columns with low cardinality (< 256 distinct values)
ship as `Uint8Array` indices + a small string table.

**Memory win:** A `region` column with 5 distinct values across 1M
rows → 1 MB (UTF-8 strings) → 1 MB (object headers) → < 100 KB
(Uint8 indices + 5 strings).

**Detection:** During the worker's initial data load, the
`ChunkProducer` scans each text column. If distinct values < 256,
flip the column's chunk encoding to `'dict'`.

**Decode-on-read:** The cell-data lookup path reads
`stringTable[indices[rowIndex]]` — same complexity as the
direct-string path, no per-cell allocation.

**File:** `worker/chunkFormat.ts` (extended).

---

## Task 3 — Varint + delta-coded numeric columns

**Goal:** Monotonically-increasing or low-magnitude integer columns
encode as varint + delta.

**Example:** A `timestamp` column where consecutive rows are spaced
~1 second apart. Deltas in milliseconds fit in 2 bytes — 4× shrink
vs. `Float64Array`.

**Decode:** At viewport time, decode the visible slice into a
`Float64Array` (the painter wants doubles). Decode is O(N) in the
viewport size, not the full chunk — irrelevant cost.

**File:** `worker/chunkFormat.ts` (extended).

---

## Task 4 — OffscreenCanvas paint mode (opt-in)

**Goal:** `VelocityGridOptions.useOffscreenCanvas: true` mounts the canvas
as an `OffscreenCanvas` transferred to a paint worker. Main thread
sends `ViewportState` via `postMessage`; paint worker does the
entire `byRows + gridLines + overlays` paint.

**Architecture:**

```
Main thread:           Paint worker (NEW):
─────────────────      ──────────────────────
Input handler          Receives ViewportState
  ↓                    Paints to OffscreenCanvas
ViewportState ─────→   (rAF inside worker)
  ↓
Hit test (still
main — input
latency critical)
```

**Trade-off:** Worker paint frees the main thread from paint
contention BUT adds a `postMessage` per frame. Win when paint cost
> postMessage cost — true for large grids on slower machines.

**Opt-in only.** Default stays main-thread paint (zero risk).

**File:** `core/canvasOffscreen.ts` (new), `renderer/paintWorker.ts` (new).

---

## Task 5 — Allocation audit

**Goal:** Profile hot paths (paint loop, hit test, scroll handler,
worker dispatch). Remove EVERY `.map / .filter / .slice / spread /
{...rest}` in those paths.

**Method:**

1. Chrome DevTools allocation profiler — record 5 s of scroll.
2. Identify `JSArray` allocations > 1k/sec in the hot path.
3. Refactor: prefer pre-sized typed arrays, `for` loops, `length =
   0` re-use over `[].push`.

**Common patterns to kill:**

| Wrong | Right |
|---|---|
| `cols.map(c => c.id)` per frame | Pre-cached `colIds: string[]`, invalidated on column change |
| `{ ...defaultColDef, ...col }` per cell paint | Pre-resolved `ResolvedColDef`, looked up by id |
| `Array.from(set)` per scroll | Iterate the Set directly |

---

## Task 6 — Direct typed-array views into chunk

**Goal:** Cell-data lookup returns the RAW typed-array slot, NOT a
`{ value, valueFormatted }` object.

**Current (Cycle 4–14):**

```typescript
function cellAt(rowIndex, colId) {
  return { value: chunk[colId].values[rowIndex], valueFormatted: format(...) };
}
```

**New:**

```typescript
function cellRawAt(rowIndex, colId, out: { value: unknown; valueFormatted: string }) {
  out.value = chunk[colId].values[rowIndex];
  // formatter applied LAZILY by the painter, only when actually painting text
}
```

**The single `out` object is reused per row.** Zero allocation
per cell. Painters call `formatValue(out.value)` themselves; cells
that don't need formatted text (sparkline, checkbox) skip the
format step entirely.

**File:** `worker/chunkFormat.ts` (extended), `renderer/painters/byRows.ts` (extended).

---

## Task 7 — GPU cell-flash overlay

**Goal:** Replace the per-cell flash repaint with a single offscreen
alpha-mask canvas redrawn on the flash schedule; composited over
the body via `globalAlpha`.

**Current:** Each flashing cell triggers a per-cell repaint. 1k
flashing cells → 1k repaints per frame.

**New:** A single `flashMask: HTMLCanvasElement` the size of the
viewport. Active flashes rasterize as alpha-only rects into the
mask. Each frame, the body painter does ONE
`drawImage(flashMask, 0, 0)` over the entire viewport with
`globalAlpha = decayingAlpha`.

**Cost model:** 1k flashes → 1 draw call. Even with 10k flashes,
the cost is bounded by mask raster + 1 composite, not 10k repaints.

**File:** `renderer/flashOverlay.ts` (new).

---

## Task 8 — Pre-emptive viewport fetch

**Goal:** When scroll velocity exceeds a threshold, fetch the next
N chunks AHEAD of the viewport.

**Heuristic:** Track scroll deltas; when smoothed velocity > 1000
px/s, prefetch 5 chunks in the scroll direction. Already-cached
chunks are no-op.

**Edge case:** Direction reversal — cancel pending prefetches in
the OPPOSITE direction.

**File:** `velocityGrid.ts` (extended scroll handler).

---

## Task 9 — Worker message coalescing

**Goal:** Multiple `getViewport` requests within one frame collapse
to a single dispatch.

**Pattern:**

```typescript
let pendingViewportRequest: ViewportState | null = null;
function requestViewport(state) {
  pendingViewportRequest = state;
  if (!pendingViewportRequest) {
    queueMicrotask(() => {
      worker.postMessage({ type: 'getViewport', state: pendingViewportRequest });
      pendingViewportRequest = null;
    });
  }
}
```

**Effect:** A burst of column-visibility / scroll / sort changes
in the same frame triggers ONE worker round-trip, not N.

**File:** `worker/client.ts` (extended).

---

## Task 10 — Memory-pressure release

**Goal:** `WeakRef`-based chunk eviction when memory budget exceeded.

**Budget:** `VelocityGridOptions.memoryBudgetMB?: number` — when total
worker chunk memory exceeds this, evict the LRU chunks (held via
`WeakRef` so they're collected at the next GC).

**Detection:** A worker-side `MemoryWatcher` polls
`performance.memory.usedJSHeapSize` (Chrome) and triggers eviction
proactively when within 10 % of budget.

**File:** `worker/chunkCache.ts` (new).

---

## Performance gates (the contract)

Every metric in the Performance Budget table is met OR exceeded.
Benchmark suite is green at all target numbers. Published
comparison vs. AG Grid 35.x in `docs/PERFORMANCE.md`.

---

## Exit criteria recap

- FM Area 26 ≥ 95 % ✅.
- `npm run bench` green at all targets.
- `docs/PERFORMANCE.md` published with comparison numbers.
- Allocation audit complete: hot paths show zero per-frame
  `JSArray` allocations in DevTools profiler.
- OffscreenCanvas demo: a 10M-row grid scrolls visibly faster on a
  mid-tier laptop with `useOffscreenCanvas: true`.
- Bundle size confirmed: < 150 KB gz core + < 80 KB gz worker.
