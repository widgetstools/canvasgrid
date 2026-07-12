# FINOS Perspective as cgrid's Compute Engine — Decision Doc

**Date:** 2026-07-12
**Status:** Discussion — options + tradeoffs, no decision taken
**Question (user):** can we use the FINOS engine (Perspective) as our compute engine for cgrid?

## What Perspective actually is (verified against current docs 2026-07-12)

- A C++ streaming-analytics core compiled to WASM, run in a web worker (server
  bindings for Python/Node/Rust also exist). Apache-2.0, FINOS-hosted —
  bank-procurement friendly.
- Data model: indexed `Table` (columnar; `update()` does keyed partial upserts,
  `remove()` by primary key) + incrementally-maintained `View`s
  (`group_by`/`split_by`/`aggregates`/`filter`/`sort`/`expressions`), tree
  `expand`/`collapse`, and `on_update(cb, {mode:'row'})` delivering **changed-row
  deltas as Arrow** — incremental pivot maintenance under streaming updates is
  its core competence (built for exactly the ticking-blotter workload).
- Rendering is plugin-based and irrelevant here (its datagrid is
  `regular-table`, DOM — we would use cgrid's canvas kernel regardless).

## What's actually driving the question (three different questions)

1. **Cycle 20 risk** — Excel-pivot parity at 60Hz × 50k ticking: can cgrid's
   own pipeline maintain a live pivot cube at that rate, or should a proven
   incremental engine do it?
2. **Build-vs-buy generally** — is maintaining our worker pipeline
   (sort/filter/group/pivot/agg/calc) worth it when an Apache-2.0 engine exists?
3. **Data-layer standardization** — Arrow in/out, server-side Perspective as a
   feed aggregator.

The answer differs per driver; the options below map onto them.

## Options

### A. No — keep cgrid's own worker pipeline; build the Cycle 20 cube in-house
The locked Cycle 20/21 baseline. Full semantic control (Excel-NATIVE pivot
semantics are a **locked decision** — show-values-as, calculated fields/items,
value filters, subtotal placement, date/number binning), no new dependency, no
second data model, keeps the kernel↔worker protocol (viewport slicing,
`touchedRows` diffs, stable rowIds, flashMask — which Cycle 22's raster-cache
patch seam now also depends on) fully co-designed.
**Cost:** we must build incremental cube maintenance ourselves (Cycle 18
shipped pivoting, but re-agg-on-tick at 60Hz × 50k is unproven); that is the
single hardest piece of Cycle 20.

### B. Scoped — Perspective as the pivot-cube engine INSIDE `@cgrid/excel-pivot`
Flat-grid pipeline stays cgrid end-to-end (it is already fast — Cycle 22
measured kernel-attributed scroll cost in single-digit ms; the flat path's
bottlenecks are paint-side, now solved). Perspective owns ONLY the cube:
`group_by`/`split_by`/aggregate views, `on_update` row deltas mapped into
cgrid's chunk/damage protocol; an Excel-semantics layer on top computes
whatever Excel features the engine can't express natively (show-values-as
variants, calculated items, value filters) as post-processing over the view.
**Fit:** consistent with [[feedback_wrapper_native_semantics]] — Perspective as
neutral substrate behind a bridge, target semantics owned by us. Composition
matches the locked "composition, `@cgrid/excel-pivot` package" decision.
**Risks:** (1) semantic impedance — if too much of the Excel matrix ends up in
the post-processing layer, we're re-implementing the cube anyway with an extra
dependency underneath (the exact wrapper-shaped-by-base failure the memory
warns about); (2) two data models in memory (Perspective columnar store +
cgrid's rowDataById mirror) — budget it; (3) delta→chunk mapping (Arrow row
deltas → stable rowIds + touchedRows + flashMask) is real engineering; (4)
WASM bundle (~3–8MB) in the pivot package only; (5) expand/collapse is
row-index-addressed — persistence across updates needs verification.

### C. Wholesale — Perspective replaces the kernel's worker pipeline
Rejected on analysis. It would discard co-designed machinery the whole grid
stack now depends on (viewport slicing + positional diff windows, custom
comparators, groupHideOpenParents/sticky groups/footers, quick-filter hooks,
calc DSL, format-eval integration, the flash/damage seam) and re-derive it on
view deltas — enormous surface, high regression risk, and the flat-grid
payoff is ~nil since compute was never the flat path's bottleneck.
Contradicts [[feedback_no_retroactive_layering]] in spirit: the kernel's
intrinsic behaviors would become emergent properties of an external engine.

### D. Server-side only — Perspective as feed aggregator
Orthogonal/complementary: perspective-server (Node/Python) pre-aggregating on
the feed side, Arrow/STOMP into cgrid unchanged. No in-browser marriage, no
kernel impact. Doesn't answer Cycle 20 (client-side interactive pivoting), but
worth remembering for very large upstream datasets.

## Recommendation

**Yes, it's viable — but only as Option B, and only after a task-zero spike
settles the two make-or-break unknowns** (same measure-before-committing
pattern that served Cycle 22's grain benchmark):

1. **Semantics probe:** enumerate the locked Excel-pivot feature matrix
   (Cycle 20 brief) against Perspective views — for each: native / cheap
   post-processing / fights-the-engine. Verify specifically: show-values-as
   (% of parent, % of grand total, running total, rank — some may exist as
   built-in aggregates; verify, don't assume), calculated fields/items, value
   filters (top-N by aggregate), subtotal placement, stable expand/collapse
   state across streaming updates. **Kill rule:** if a majority of Tier-0
   Excel features land in "fights-the-engine", choose Option A.
2. **Throughput probe:** 50k-row indexed table, 60Hz keyed update batches,
   live 2×2 pivot view with deltas consumed and mapped to a fake chunk
   protocol — measure end-to-end (update → delta → chunk) latency and GC
   behavior in the worker, on the OpenFin runtime. **Kill rule:** sustained
   p95 over one frame budget → Option A (or D for the upstream half).

Option A stays the default per the locked Cycle 20 decisions until the spike
passes both gates; the spike's cost is small (~2–3 days) against the risk it
retires on the hardest part of the capstone.

## Related

[[cgrid-cycle-20-excel-pivot]] (locked decisions this must honor),
[[cgrid-perspective-compute-evaluation]] (the standing interest),
[[feedback_wrapper_native_semantics]], [[feedback_no_retroactive_layering]],
[[cgrid-cycle-22-raster-cache]] (flash/damage seam the delta mapping must feed).
