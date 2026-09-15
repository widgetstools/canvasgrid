# CSRM keeps three copies of the book, and the one that binds is the one nobody notices

Measured 2026-09-15 at `3ed0b38e`, Node 24.20, V8 default
heap. Subject: the lab's 56-field fixed-income credit blotter row
(`apps/velocitygrid-lab-csrm/src/data/domain.ts`), which is a real row shape
rather than a synthetic one.

> **Outcome: no fix yet — a finding.** A client-side grid fed by the data hub
> retains **~4.5 KB per row across three V8 isolates** at 56 columns, and
> **~21 KB per row** at the ~300 columns production actually runs. At
> 100,000 x 300 that is **~2.1 GB of duplicated book**, plus 603 MB of
> structured clone crossing a `postMessage` twice per snapshot.
>
> A single columnar store holds the same book in **263 MB**. Getting there
> needs both halves: route the book through wasm (it is duplicated three times
> today) *and* type-pack the engine's cell, which is a 24-byte tagged union
> whose cost is the dominant term once column count is high. At 300 columns
> neither half is sufficient alone.
>
> Separately, the main-thread copy — the one in the isolate that can least
> afford it — turns out not to be held for the paint path at all.

## The question

Whether the client-side row model earns its keep, given that the same rows are
materialised more than once on the way to the screen. The suspicion was
two copies. It is three, and the third is the interesting one.

## Method

Each tier is measured **in its own process**. Measuring several in one process
reports heap fragmentation and whatever the previous representation failed to
release, not the thing under test.

- Settle the heap (`global.gc()` eight times — one pass does not always finish
  a large young-generation evacuation, and a half-collected heap reads as
  retained bytes), take a baseline.
- Build the representation. Drop every other reference, including the
  generator's output where the mode under test is not that array itself.
- Settle again; subtract. A cheap non-allocating probe reads from the held
  value afterwards so nothing can be elided as dead.
- `RowCache` is imported from `packages/data/src/hub/rowCache.ts` — the real
  class, not a stand-in.

Run at 5k / 50k / 100k. The object representations were stable across all
three (≤1.5% spread), so those are linear rather than a single reading.
The columnar figure improves with N as the low-cardinality dictionaries
amortise, settling near 706 B/row at 56 columns.

**Corrected 2026-09-15 (same day):** the first version of this document
reported columnar as 324 B/row. That was wrong. `process.memoryUsage().heapUsed`
does not count TypedArray backing stores — those are external to the V8 heap
and reported separately as `arrayBuffers` — so every columnar figure counted
the dictionary strings while ignoring every `Float64Array` of actual data. The
row-object tiers hold no typed arrays and were unaffected. The harness now
sums `heapUsed + arrayBuffers`.

Harness: `apps/velocitygrid-lab-csrm/bench/rowMemory.ts`. One mode per
process, `--expose-gc` required:

```
node --expose-gc --import tsx apps/velocitygrid-lab-csrm/bench/rowMemory.ts rowCache 100000
```

## What CSRM retains

At 100,000 rows:

| Tier | Isolate | Bytes/row | @100k |
| --- | --- | --- | --- |
| `RowCache.byId` — the hub's cache | data worker | 1,343 | 134 MB |
| structured clone + `rowDataById` | **main thread** | 1,600 | 160 MB |
| `DataStore.byId` + `order` | grid worker | ~1,600 | ~160 MB |
| **total** | | **~4,540** | **~454 MB** |

The hub runs in its own worker (`packages/data/src/worker.ts`), so these are
three separate V8 isolates. That is a point in CSRM's favour — they do not
compete for one heap limit — and it is also what makes the main-thread tier
the binding constraint, because that isolate is also where the renderer lives.
At 1M rows that tier alone is 1.6 GB.

**Transport.** `v8.serialize` of the 100k snapshot is 114 MB, and it crosses a
`postMessage` twice — hub→main, then main→grid worker. Roughly 228 MB of
serialise/deserialise per full replace, on top of the retained cost.

**Not a fourth copy.** `stampSyntheticRowIds` spreads every row to add the
synthetic id field when the app supplies no `getRowId`, which looks like it
should double main-thread retention. It does not: the pre-stamp array falls out
as garbage, and the stamped variant measures identically (1,600 B/row either
way). It is GC churn, not footprint.

## Why the numbers are what they are

A V8 object with 56 fields stores its 36 doubles as boxed `HeapNumber`s
(8-byte pointer + 16-byte box) plus 20 string pointers, which lands near
1,200 bytes before the Map overhead that the mirror adds. The measurement agrees, so the
model is sound and these figures should extrapolate to other row shapes by
field count and type mix.

## The wasm comparison, corrected

The obvious move is to point CSRM at the Rust engine's client-side primitives
— `snapshot_columns` and `poll_shared_delta` in `hub-rust/src/wasm.rs`, both of
which exist, are built, and are called by nothing in this repo. `TableCache` is
genuinely columnar (`cols: Vec<Vec<Value>>`) with an `Arc<str>` interner
deduplicating repeated string cells.

But columnar **organisation** is not columnar **density**. `Value` is a tagged
union:

```rust
enum Value { Null, Bool(bool), Int(i64), Float(f64), Str(Arc<str>) }
// size_of::<Value>() == 24   →   56 cells/row == 1344 bytes
```

At 24 bytes per cell regardless of type, a row costs ~1,344 bytes of cells plus
keys and revision tracking — **about one JS copy, not a fraction of one.**

So the honest accounting for routing CSRM through wasm:

| | Bytes/row | @100k |
| --- | --- | --- |
| CSRM today, three tiers | ~4,540 | ~454 MB |
| One wasm store, `Value` as-is | ~1,400 | ~140 MB |
| One wasm store, type-packed columns | 706 | 71 MB |

The middle row is the ~3× that is available today, and it comes entirely from
holding the book once instead of three times. The bottom row — measured as
`Float64Array` per numeric column plus dictionary-encoded strings, and an
*upper* bound for a real wasm store since it still pays V8 string headers that
UTF-8 bytes in linear memory would not — needs `Value` to change. At 56
columns that is a ~6.4x total, not the 14x the uncorrected figure implied.

## At production shape: 100,000 rows x 300 columns

The figures above are for a 56-column row. Production is ~300 columns, and V8's
per-object cost is **not** linear in field count. Measured, not extrapolated
(`rowMemory.ts` takes a column count as its third argument):

| Tier | Bytes/row | @100k x 300 |
| --- | --- | --- |
| `RowCache.byId` | 8,162 | 816 MB |
| main thread (clone + `rowDataById`) | 6,472 | 647 MB |
| grid worker `DataStore` | ~6,500-7,600 | ~650-760 MB |
| **three tiers** | | **~2.1 GB** |
| one columnar store | 2,634 | **263 MB** |

Structured-clone wire cost is **603 MB per snapshot**, crossed twice.

Two effects appear at this width that do not exist at 56 columns:

**Row-object cost is representation-dependent, with a 3.4x spread.** The same
300-column row measures 6,472 B/row after `structuredClone` and iteration,
8,162 after a `{...row}` spread, and **22,028 after `JSON.parse`** — V8 builds
wide parsed objects in dictionary mode with a heavily over-allocated backing
store. All three construction paths occur in the real pipeline. A representation
whose footprint swings 3.4x on how the object happened to be built is not
something you can capacity-plan against. The columnar figure does not move,
because it is just data.

**A 100k x 300 book is not expressible as one JSON document.** Serialising it
throws `RangeError: Invalid string length` — it exceeds V8's maximum string
length (~512 MB). Any JSON snapshot of this book must be chunked, at any layer
that tries it.

### What this does to the wasm recommendation

At 56 columns, type-packing `Value` was a nice-to-have. At 300 it is
**required**, because the tagged union's cost scales with column count:

| | Bytes/row | @100k x 300 |
| --- | --- | --- |
| three JS tiers, today | ~21,100 | ~2.1 GB |
| one wasm store, `Value` as-is (300 x 24B) | 7,200 | 720 MB |
| one wasm store, type-packed | 2,634 | 263 MB |

`TableCache` as it stands would hold a 300-column book at ~720 MB — better than
2.1 GB, but nowhere near what the shape allows. The 24-byte cell that was
merely unhelpful at 56 columns is the dominant term at 300.

### Column windowing is the other half

At 300 columns a viewport shows perhaps 25. Row-oriented storage carries all 300
fields on every row regardless — there is no way not to. Columnar storage makes
the displayed subset the transferred and resident subset, and the SSRM path
already does exactly this (`wireSsrmColumnWindowRefill`,
`ssrmColumnKeysNeedFetch`, the Perspective column windows). That is roughly
another 12x on the wire, on top of the memory figures above, and it is
structurally unavailable to a row-object pipeline.

300 columns is the case where row-oriented storage is worst and columnar is
best. It is not a marginal preference at this shape.

## The main-thread mirror is not a paint cache

This is the part worth acting on. `rowDataById` reads as a render-path
structure, and the comment at the horizontal-scroll fallback reinforces it: a
column entering the viewport before its worker chunk lands is served from the
mirror so it paints real content immediately. That use is real — and it needs
only the **visible** rows.

Narrowing by *field* is a dead end: fourteen read sites hand a whole row to
open-ended user code — the `getRowData` accessor, the rules engine's row
binding, the visible-set hook, cell renderer params. Any column may be read, so
no static subset is safe.

Narrowing by *row* is a different story, because **the sparse mode already
exists and already ships.** `rowDataById` "holds the whole book for a CSRM grid
and every hydrated row for an SSRM one"; `getTotalRowCount` calls it "a sparse
hydrate cache, not the book" and routes SSRM to the datasource's declared count
instead. `distinctValuesFromMirror` is explicitly the SSRM hydrate mirror. The
mechanism is proven in production on the other row model.

What pins CSRM to the whole book is four consumers in
`packages/kernel/src/velocityGrid.ts` — three of them whole-book evaluations of
user-supplied functions that cannot cross a `postMessage`, plus one bare count:

| Consumer | Needs | Opt-in? |
| --- | --- | --- |
| `recomputeAlwaysPass` | every row, `options.alwaysPassFilter` | yes — early-outs when unset |
| `masterDetail.applyOpenByDefault` | every id, `isMasterOpenByDefault` | yes — early-outs when unset |
| `forEachRow` | every row; seeds `columnStats` / `tickHistory` and the edit bridge's mirror | yes — per feature |
| `getTotalRowCount` | `rowDataById.size` | **no** — always live |

So the mirror is whole-book not because the renderer needs it, but because
these predicates live on the main thread while the book lives in the worker.
The rows are there to be scanned by functions that cannot cross a
`postMessage`.

## What follows

Three options. None is started. **At 300 columns the ordering below is wrong
for production** — (2) and (3) are one piece of work and both are needed; (1)
is a smaller, independent win. The ordering is kept as written because it is
correct for a 56-column book, and the difference between the two cases is
itself the point.

1. **Gate the mirror on the features that need it.** Every pin above except
   `getTotalRowCount` already early-outs when its feature is unconfigured, and
   that last one is answerable from the worker, which knows the count. A CSRM
   grid using none of those features could then run the mirror sparse — the
   same code path SSRM exercises today — and drop the binding tier from
   160 MB to the visible window. The caveat is that the edit bridge seeds from
   `forEachRow`, so the drawer-enabled demo grids would *not* qualify as they
   stand; how much real deployment this reaches is the thing to establish
   before building it.

2. **Wire CSRM to `snapshot_columns` / `poll_shared_delta`.** Collapses the hub
   cache and the grid-worker store into the one that already exists in wasm.
   ~3×, and it retires a whole `postMessage` hop (114 MB per snapshot) along
   with it.

3. **Type-pack `Value`.** The remaining ~2×. At 56 columns. A change to the engine's core
   cell representation, with reach far beyond this question.

Worth noting that (1) and (2) are independent and compose: (1) shrinks the
main-thread tier, (2) merges the other two.
