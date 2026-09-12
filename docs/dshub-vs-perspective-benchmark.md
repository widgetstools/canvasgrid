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

## The read path does not decide this

Which means the decision rests on what was already known, and none of it is
throughput:

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
