# Rust hub vs Perspective — the SSRM read path

Measured 2026-09-12, in one browser page, both engines live at once.

## The question

Whether the Rust hub's **JSON-string wasm boundary** costs enough to disqualify
it against Perspective's columnar path. This was the open item behind every
"should we keep Perspective" conversation, and it could not be answered until
the hub had a traceable build and a working datasource.

## Method

- SSRM demo page (`:5211`), Perspective already booted with a 10,000-row book
  under a live STOMP feed at ~40,000 rows/s.
- The Rust hub instantiated **in the same page** from the vendored wasm, with
  10,000 synthetic rows of the same shape, driven at a matched ~40,000 rows/s
  (400-row batches every 10ms).
- Identical call shape both sides: a window of N rows from a flat view.
- n = 120 per cell, after a warm-up read. Medians and tails both recorded,
  because a blotter feels the tail.

## Results (ms)

Unfiltered, live feed:

| block | engine | median | p90 | p99 | max | >10ms |
|-------|--------|--------|-----|-----|-----|-------|
| 20 | Perspective | 0.3 | 0.4 | 2.6 | 14.6 | 1 |
| 20 | Rust hub | **0.1** | **0.2** | **0.2** | **0.4** | **0** |
| 1000 | Perspective | **0.2** | **1.3** | 12.1 | 13.8 | 3 |
| 1000 | Rust hub | 3.7 | 3.8 | **3.9** | **3.9** | **0** |

Filtered to one desk (~1,250 / ~2,000 rows), live feed:

| block | engine | median | p90 | p99 | max | >10ms |
|-------|--------|--------|-----|-----|-----|-------|
| 20 | Perspective | 0.3 | 0.5 | 9.2 | 15.3 | 1 |
| 20 | Rust hub | **0.1** | **0.2** | **0.2** | **2.8** | **0** |
| 1000 | Perspective | **0.2** | **0.3** | **2.4** | 10.1 | 1 |
| 1000 | Rust hub | 3.6 | 3.7 | 3.8 | **3.8** | **0** |

## What it says

**The JSON boundary is real, and small.** The Rust hub scales linearly with
block size — 0.1ms at 20 rows, 3.7ms at 1000 — which is the per-row
serialization cost, visible exactly where predicted. Perspective is nearly
flat (0.2ms at 1000 rows), because it hands back a columnar slice whose cost
barely depends on row count. At a 1000-row block that is a ~18x difference in
the median.

It is still not disqualifying. 3.7ms to serve a 1000-row block, on a viewport
that needs maybe 50 rows, is not a number a trader can feel.

**The Rust hub is the more predictable of the two.** Zero excursions over 10ms
in 480 samples, against Perspective's six, and a max of 3.9ms against 15.3ms.
Perspective's tail is small and rare, but it is there and the hub's is not.

**Neither is the bottleneck at this scale.** Both serve a viewport block in
single-digit milliseconds under a 40,000 rows/s feed, filtered or not.

## Grouping — where the two actually diverge

Group skeleton built from scratch, 10,000 rows, n=12. Perspective via
`getGroupSkeleton`; the hub via `watchGroups`.

| levels | Perspective | Rust hub |
|--------|-------------|----------|
| 1 | **0.1** | 2.0 |
| 2 | 112.5 | **3.9** |
| 3 | 137.2 | **6.2** |

One level, Perspective wins outright. Two or more, it is 25-30x slower and in
territory a user feels — 137ms is a visible stall when someone adds a grouping
level. This is the divergence the flat-read benchmark missed entirely.

Caveat on the comparison: the group cardinalities are not identical (the demo's
book groups on `instrumentType` where the synthetic set uses `tenor`, giving
Perspective 33/513 groups against the hub's 20/80). The gap is far larger than
that difference accounts for, but it is not a clean like-for-like.

## Rust hub at scale

The hub alone, because the demo's Perspective book is pinned at 10,000 rows by
its feed and there is no cheap way to grow it.

| rows | ingest | rows/s | read 20 | read 1000 |
|------|--------|--------|---------|-----------|
| 10,000 | 53ms | 190,000 | 0.1 | 4.7 |
| 50,000 | 281ms | 178,000 | 0.1 | 4.9 |
| 100,000 | 614ms | 163,000 | 0.2 | 5.0 |
| 500,000 | 7,496ms | 67,000 | 0.5 | 5.3 |

**Reads are flat in book size** — 0.1ms to 0.5ms across a 50x range. Cost
tracks the BLOCK, not the book, which is the property a viewport needs.

**Ingest degrades above 100k**: 190k rows/s at 10k against 67k at 500k. A
500k-row snapshot takes 7.5 seconds, which is a real cold-start cost.

Group skeleton at 100,000 rows: 20.7ms (1 level), 40.0ms (2), 58.4ms (3) —
against 2.0/3.9/6.2 at 10,000. **The build is O(rows) per level, not
O(groups)**: it scans the table once per level, so a 1M-row book would spend
roughly 600ms on a 3-level skeleton. The incremental updates after it are
diffs, which is the design, but the first build is a full scan.

View open with sort or filter, hub only:

| operation | 10,000 rows | 100,000 rows |
|-----------|-------------|--------------|
| sort, numeric | 3.9 | 44.5 |
| sort, string | 2.9 | 39.4 |
| filter, equals | 3.0 | 25.0 |
| filter, range | 1.4 | 9.9 |
| sort + filter | 3.8 | 37.1 |

Roughly linear in rows, as expected for a scan-and-sort over a columnar store.

## What could not be measured, and why

Recorded because the absences shape the conclusion as much as the numbers.

**Perspective sort and filter.** Its datasource `fail()`s on a per-request
`sortModel` and never calls back at all on a per-request `filterModel` — it
expects those to arrive through GRID state, which remounts the view. Driving
it that way hung the probe too. So the table above has no Perspective column,
and the hub's sort/filter numbers stand alone. Measuring this properly needs
the grid's own instrumentation rather than ad-hoc datasource calls.

**Perspective beyond 10,000 rows.** The demo's book is fixed by its feed.

**Memory per book.** The wasm module reserves ~1.28GB of linear memory at
init, so `WebAssembly.Memory.buffer.byteLength` does not move until that
reservation is exceeded — it read 1284.2MB at 10k, 100k and 500k rows alike.
JS-heap deltas are worse than useless here (one reading came back NEGATIVE,
GC having run mid-measurement) because the engine's cache is not on the JS
heap at all. A real number needs an engine-side byte counter.

**A methodology note.** Running both engines in one page for fairness
backfired once: after several large hub instances the Perspective datasource
stopped responding entirely, and a plain read that had worked minutes earlier
timed out. Reloading fixed it. Cross-contamination is a real hazard in this
setup, and every number above was taken either before that point or after a
reload — but it is a reason to treat one-page comparisons with suspicion.

## The read path does not decide this

Grouping does, though, and it points the other way from the flat reads. The
decision therefore rests on grouping plus what was already known:

- **Multi-level grouping.** 4-6ms against 112-137ms at two and three levels.
  On a blotter that groups by desk then region then tenor, this is the
  difference between instant and a visible stall.

- **Composable aggregates.** The hub does `SUM([spread] * [dv01]) / SUM([dv01])`
  as computed columns with agg nodes. Perspective has ten fixed aggregates and
  no composition. That is the fixed-income weighted-average case, and it is the
  strongest single argument either way.
- **ExprTK's limits** on the Perspective side: no string `+`, `contains` on a
  float aborts the whole view, one global `filter_op` so AND-of-ORs is
  inexpressible.
- **One engine for both row models.** The hub serves CSRM and SSRM; today those
  are two separate paths.
- **Ownership.** Adding `WAvg` to the hub is a PR in a repo we own.

## What this does NOT measure

Stated plainly, because the numbers above look more decisive than they are:

1. **The write paths differ.** The Rust hub was driven with in-process
   `apply_message_json`; Perspective took a real STOMP WebSocket including
   network and parse. The hub's "under load" is cheaper by construction, so
   its tail advantage is overstated by an unknown margin.
2. **Different data.** Same row count and column shape, but synthetic rows
   against the demo's actual book.
3. **Flat reads only.** No grouped or pivot windows, which is where engines
   usually diverge most — and where `watchGroups` vs a Perspective group view
   is the interesting comparison.
4. **One machine**, with dev servers and a browser running.

## A correction worth recording

Earlier in this work Perspective was measured at **36ms for a 20-row block and
40ms for 1000** under a feed, which is where "the JSON boundary might be a
problem" came from. Those numbers no longer reproduce — median 0.3ms now.

They were real, but they were the cost of a `num_rows` rescan and a grand-total
recompute per read on a filtered view, and both were fixed in this repo
(a 250ms row-count TTL and 500ms grand-total coalescing). The benchmark above
is measuring a Perspective path that has since been repaired. It would have
been easy, and wrong, to present these results as vindicating a suspicion that
had already been addressed by other means.
