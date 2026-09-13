# The group watch does not scale to the target book — and now does

Measured 2026-09-12 against `dshub-hub` 0.5.0; re-measured after the fix
against 0.6.0.

> **Outcome: fixed.** The scan is now incremental. 500k rows at two levels with
> computed columns went from **228.3ms to 1.5ms per tick**, and the cost is
> near-flat in book size. The measurement below is what motivated it; the
> after-numbers are at the end.

## The question

Whether `watchGroups` — the verb that keeps a grouped blotter's captions live —
holds a 100ms tick budget at the **500,000-row books** the design targets.

The suspicion came from the shape of the code, not from a number.
`GroupWatch::poll()` rebuilds the entire snapshot on every tick:
`filtered_slots` scans the whole cache, then `collect` rescans the surviving
members once per grouping level. The diff that follows decides only what to
**push**, never what to **compute**. If that reading is right the cost is
O(rows × levels) with no incrementality, and it stops closing the loop
somewhere well below 500k.

## Method

- Node, the vendored wasm engine, driven through `SsrmWasmPlane` — the real
  production path, not a Rust-native harness that would skip the JSON boundary.
- **A fresh hub and plane per data point.** An earlier one-page benchmark in
  this project was contaminated by engine state accumulating across runs; each
  point here re-imports the module so `initSync` gives it a new wasm memory.
- Ingest excluded from the timing. 400 rows moved between polls, matching the
  demo's feed.
- n = 9 per cell, median reported, min/max recorded.
- Four aggregates (`sum` ×3, `avg` ×1). The "computed" arm adds the two columns
  behind a DV01-weighted spread: `wprod = spread × dv01` and
  `wSpread = SUM(wprod) / SUM(dv01)`.

## Results (ms per tick)

| rows | 1 level | 1L + computed | 2 levels | 2L + computed |
|------|---------|---------------|----------|---------------|
| 50k | 8.8 | 14.1 | 16.5 | 23.9 |
| 100k | 16.6 | 27.8 | 32.0 | 46.9 |
| 250k | 40.0 | 67.5 | 79.0 | 115.2 |
| 500k | 79.3 | 132.7 | **156.5** | **228.3** |

Min-to-max spread is under 2% in every cell. This is a clean measurement, not
noise.

## What it says

**It is O(rows × levels), exactly as the code shape predicted.** The constant
is **15.7ms per 100k rows per level**, and it holds to within 1% across a 10×
range — 15.86ms at one level, 15.65ms at two. Computed columns add a further
~10.7ms per 100k rows for the row-scoped pass, plus ~3.7ms per 100k per extra
level for the per-node folds.

**The loop stops closing well before 500k.** Against a 100ms tick:

| configuration | breaks at |
|---------------|-----------|
| 2 levels + computed columns | **~220k rows** |
| 2 levels, plain | ~320k rows |
| 1 level + computed columns | ~375k rows |
| 1 level, plain | ~630k rows |

The 500k target at two levels is **1.6× over budget plain, 2.3× over with
computed columns**. It does not degrade gracefully: at 228ms per tick against a
100ms interval the engine is permanently behind, and the backlog grows for as
long as the feed runs.

**Treat these as a floor.** The same measurement in a browser under a live grid
read 30.8ms where Node reads 16.5ms (50k, 2 levels) — **~1.9× higher**,
presumably contention with paint. Real break points are likely nearer
120k–170k rows at two levels with computed columns.

**A quieter feed buys nothing.** The cost is the scan, not the changes, which
is what the linearity proves. 400 moved rows out of 500,000 is 0.08% of the
work actually done.

## What it does not say

**It is not an argument against the engine choice.** Perspective measured
112–137ms on multi-level grouping at far smaller books, and its grouped-view
creation cost ~300ms and degraded with live view count. The hub is faster at
the same task and, unlike Perspective, is ours to fix — four defects in this
one verb were found and closed in a day.

## The fix, and what it bought

The cache's touch log names the slots that moved since the last poll, and only
those are subtracted from their old group node and added to their new one.

The load-bearing piece is **storing each slot's contribution**. The touch log
says *which* slots changed, but the cache holds only their new values — a
departing row's old contribution cannot be read back out of it. Re-reading on
removal subtracts the wrong number, and the totals drift from the truth on the
very first tick. That is how the first attempt failed, and it is the case the
equivalence tests are built around.

Only folds that can be undone qualify: `sum`, `avg`, `count`. `min`, `max`,
`median` and `distinct_count` cannot be subtracted from without the members
back, and keep the full-rescan path — correct, and exactly as fast as before.
Drift is bounded by a full rebuild every 250k single-row mutations, since
adding and subtracting `f64` does not return to where it started.

### After (0.6.0), same methodology

| rows | 1 level | 1L + computed | 2 levels | 2L + computed |
|------|---------|---------------|----------|---------------|
| 50k | 0.9 | 1.0 | 1.0 | 1.1 |
| 100k | 1.0 | 1.0 | 1.1 | 1.2 |
| 250k | 1.0 | 1.1 | 1.1 | 1.3 |
| 500k | 1.1 | 1.3 | 1.3 | **1.5** |

**152× at the worst point, and the linearity is gone** — 1.1ms at 50k against
1.5ms at 500k for the same configuration. The cost is now proportional to what
moved, not to what exists. In a browser under the live demo, the per-tick poll
went from 30.8ms to 5.6ms median — and then to 2.5ms, for the reason below.

Registering a watch still pays one full build. That is unchanged and correct —
it is the price of a new grouping, not a per-tick cost.

### Correctness

Equivalence is treated as a property, not a set of examples. Four tests drive a
pseudo-random feed — value ticks, regroups, deletes, and cells that stop being
numeric — and compare the incremental snapshot against a fresh full fold after
every tick. Reintroducing the re-read bug fails all four.

## Where the tick went next, and a recommendation withdrawn

With the scan fixed, the residual cost had to be found rather than guessed. The
tick was split at the four seams it actually has, 500k rows, 400 moving:

| seam | time | bytes |
|------|------|-------|
| `hub.tick()` — group deltas | 0.414ms | 4,298 |
| `JSON.parse` | 0.012ms | |
| `poll_shared_delta` — row deltas | **0.946ms** | **60,871** |
| `JSON.parse` | 0.118ms | |
| residual plane JS | ~0ms | |
| **total** | **1.486ms** | |

**This withdrew a recommendation.** The plan had been a columnar/binary wasm
boundary, on the theory that JSON was the cost. It is not: `JSON.parse` is
0.13ms of 1.49ms. That rewrite would have optimised 9% of a tick while moving
object construction to the client, where hand-built objects generally lose to
native parse — a likely net loss. The objection that killed it was that the
grid needs row objects either way, so the cost only moves.

**What the split found instead was work with no reader.** `poll_shared_delta`
is the CSRM streaming path: one JSON object per changed row, ~60KB a tick,
fourteen times the group delta. `DshubServerSideDatasource#drain` keeps
`groupDelta` and drops `rowDelta` on the floor — a server-side grid folds group
aggregates and re-reads the windows it shows. Every byte was discarded.

So the fix is not to build it. `setRowDeltaEnabled(providerId, false)` skips the
call, and the stream is created lazily on first poll, so a provider switched off
before its first tick never allocates one. It is opt-**out**, not opt-in: a
consumer that needs streaming rows and silently stops getting them looks broken
in a way nobody attributes to a missing call, while one that forgets to opt out
merely pays what it paid before.

| configuration | before | after | |
|---------------|--------|-------|-|
| 500k rows, 400 moved | 1.486ms | 0.449ms | 3.3× |
| 500k rows, 4000 moved | 15.486ms | 4.702ms | 3.3× |
| 50k rows, 400 moved | 1.226ms | 0.437ms | 2.8× |
| browser, live demo | 5.6ms | 2.5ms | 2.2× |

What remains is `hub.tick()` — the incremental group watch, doing work someone
reads. Cell flashing, repaint rate and every aggregate are unchanged, verified
in the demo rather than reasoned about.

## Reproducing

The benchmark script is not checked in; it is ~120 lines building a synthetic
fixed-income book and driving `SsrmWasmPlane.pollAllTicks()`. The load-bearing
details are above: fresh engine per point, ingest excluded, 400 rows moved
between polls, median of 9.
