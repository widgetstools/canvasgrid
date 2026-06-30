# Performance — Cycle 25 hardening

This document summarises what landed in Cycle 25 (the performance
hardening cycle) and how to measure regressions going forward.
Each section maps to one task in
`docs/superpowers/plans/notes/cycle-25-performance-design.md`.

## Running the benches

```bash
cd cgrid
npm run bench
```

The harness uses `vitest bench`. Baseline numbers captured on
Apple Silicon (macOS, Node 24.2) live in
[`cgrid/bench/baselines.json`](../cgrid/bench/baselines.json) along
with regression thresholds (`hz_min` per bench). A bench whose hz
drops more than ~30 % below the threshold should fail review.

## What landed

| Task | What it shipped | Where to look |
|---|---|---|
| 1 — Bench harness | `npm run bench`, `bench/chunkFormat.bench.ts`, baselines + thresholds | `cgrid/bench/` |
| 2 — Dict-coded text | `encodeTextDict` / `decodeTextDict`; chooses Uint8/16/32 indices by dict size | `cgrid/src/worker/chunkFormat.ts` |
| 3 — Varint + delta numeric | `encodeVarintI32` / `encodeDeltaInts` (zigzag, 1–5 bytes per int) | `cgrid/src/worker/chunkFormat.ts` |
| 4 — OffscreenCanvas option | `CGridOptions.paintMode`, `resolvePaintMode`, support detection | `cgrid/src/renderer/offscreenSupport.ts` |
| 5 — Paint allocation audit | Removed `.map`+spread and triple `.filter` per paint in `byRows` and `gridLinesPainter` | `cgrid/src/renderer/painters/` |
| 6 — Raw cell access | `rawNumericAt` / `rawTextAt` / `rawRowKindAt` + `RawTextDecoder` cache | `cgrid/src/core/rawCellAccess.ts` |
| 7 — Flash alpha mask | `buildFlashAlphaMask` (flat `Float32Array(rows × cols)`, reusable buffer) | `cgrid/src/core/flashAlphaMask.ts` |
| 8 — Velocity prefetch | `expandRangeForVelocity` + scroll-velocity sampling in `onScrollerScroll` | `cgrid/src/core/prefetchRange.ts`, `cgrid/src/cgrid.ts` |
| 9 — Worker message coalesce | Per-RAF collapse of `modelUpdated` / `heightsChanged` / `asyncTransactionsFlushed` | `cgrid/src/worker/client.ts` |
| 10 — Memory budget | `CGridOptions.memoryBudgetMB`, `ChunkLRU` (WeakRef-backed) | `cgrid/src/core/memoryBudget.ts` |

### What's "foundation" vs "wired"

The following deliver tested helpers but are intentionally **not**
yet routed through the main paint / decode path. They are the
foundation for the follow-up that finishes routing each one:

- **Dict-coded text / varint numeric encoders (Tasks 2 + 3)** —
  pure helpers; `serializeChunk` still emits the inline
  `{ offsets, bytes }` shape and `Float64Array` columns.
- **Flash alpha mask (Task 7)** — `buildFlashAlphaMask` exists and
  is tested; the painter still calls `registry.getAlpha` per cell.
- **Raw cell access (Task 6)** — `rawNumericAt` / `rawTextAt` /
  `rawRowKindAt` exist and are tested; `cgrid.cellAt` is unchanged.
- **Memory budget (Task 10)** — the LRU stores fresh chunks but
  cache-hit lookup on subsequent requests is deferred (it needs
  keying on sort / filter / group / pivot model versions).
- **OffscreenCanvas (Task 4)** — option + detection + resolution
  are wired; the worker-side painter is the follow-up.

The wins that DO land at runtime:

- **Worker message coalescing** (Task 9) — fewer repaints per
  bursty worker run, no API change.
- **Velocity prefetch** (Task 8) — fast scrolls fetch a wider
  chunk so the next paint reads from the existing chunk.
- **Paint allocation audit** (Task 5) — fewer GC pauses on a
  frame's hottest paint paths.

## Regressing the benches

`bench/baselines.json` carries an `hz_min` per critical bench.
Run `npm run bench` and compare each `hz` against the table. If a
bench is 30 % below the floor, investigate before merging the change
that introduced the regression.

The numbers are platform-sensitive; baselines were captured on
Apple Silicon. Linux / x86_64 numbers will differ. Treat the
thresholds as *relative* — re-baseline when CI hardware changes.

## Where to extend next

In rough priority for the next perf-focused cycle:

1. Rewire `serializeChunk` to emit dict-coded text columns and
   varint-coded numeric columns under a new chunk format version.
   Both encoders have round-trip tests; the slicer + deserializer
   need to learn the new flags.
2. Wire `buildFlashAlphaMask` into the renderer's paint loop so
   the per-cell `getAlpha` lookup goes away.
3. Wire `ChunkLRU` lookups on the request path. Key on the
   composite model version (sort / filter / group / pivot
   snapshots) so a stale chunk never paints.
4. Build the worker painter. The `paintMode` option already
   resolves correctly; transferControlToOffscreen on the canvas
   and ship a `PaintWorker` that mirrors `byRows.ts`.
