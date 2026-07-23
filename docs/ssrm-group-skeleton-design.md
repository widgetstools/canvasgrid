# Sparse SSRM v2 — client-owned group skeleton

**Status:** Phases 1–3 implemented 2026-07-20 (kernel + demo port; parity
features of phase 4 and v1 removal of phase 5 outstanding)
**Date:** 2026-07-20
**Goal:** AG-Grid **CSRM**-parity grouping UX on sparse server data. Deliberately
NOT AG's SSRM interface (no per-group stores in the public API, no
route-based `groupKeys` fetching) — that interface's limitations are the
reason this project exists.

---

## Why the current contract can't reach CSRM parity

Today (`feat/ssrm-multi-blotter-stomp`) the datasource owns the *shape* of
the tree: every `getRows` ships `expandedGroupKeys`, the server materializes
the full flattened visible tree, and the kernel windows over it by global
flattened index.

CSRM feels right because the client owns the tree shape. With the server
owning it, every structural interaction degrades:

| CSRM behavior | Sparse-v1 behavior | Root cause |
|---|---|---|
| Toggle reflows same-frame | Round trip (refresh → getRows → tree walk → hydrate) + off-viewport blank | shape lives server-side |
| Toggle never corrupts rows | Fixed 2026-07-20 by dropping the whole block cache (`refreshExpansion`) — correct but pays full refetch | flattened indices shift under an index-keyed cache |
| Sticky band always exact | Derived from *hydrated* slots; dies on eviction / order wipe | group rows are transient window content |
| `expandAll` exact | Limited to accreted `knownGroupKeys` (never shrinks, can hold dead keys) | client never sees the whole tree |
| `groupDefaultExpanded: -1 / N / keys / callback` | Only `0` supported | defaults need the key universe client-side |
| Footer after children, only when expanded | Demo emits footer before children, even collapsed | server-side flatten reimplements GroupPass, imperfectly |
| Group checkbox cascades | Can't — descendant ids unknown client-side | leaves exist only server-side |

Server cost is also wrong: `countMaterializedGroupedRows` +
`materializeGroupedWindow` re-walk the whole tree per block fetch
(O(groups²) in the demo), and `expandedGroupKeys` grows unboundedly on the
wire.

---

## Proposal

Split the tree into **skeleton** (all group rows, client-owned) and
**leaves** (server-windowed). Group rows are few and small relative to
leaves — a 1M-row book with 5k groups has a ~5k-row skeleton.

```
                 ┌───────────────────────────────────────────┐
   datasource    │ kernel (main thread)                      │      worker
                 │                                           │
 getGroupSkeleton│  SkeletonStore                            │
 ──────────────► │   all group rows + per-group leafCount    │
                 │   + aggregates (plain fields, like today) │
                 │                                           │
                 │  FlattenIndex (prefix sums over skeleton  │
                 │   × expandedKeys) — rowCount, row→        │
                 │   (groupKey, leafOffset), toggle = local  │
                 │   splice, same frame                      │
                 │                                           │
 getLeafRows     │  LeafBlockCache — per-(groupKey, block),  │  ssrmHydrate
 (key, start,    │   invalidation per group, not per global  │  (unchanged
  end) ────────► │   index                                   │──► sparse paint)
                 └───────────────────────────────────────────┘
```

### Datasource contract v2

```ts
interface IServerSideDatasource<TRow> {
  /** Ungrouped fallback — unchanged flat windowing. */
  getRows(params: IServerSideGetRowsParams<TRow>): void;

  /** All group rows for the current sort/filter/groupBy, display order,
   *  every depth, with per-group leafCount + aggregate fields.
   *  No expansion state in the request — expansion is client business. */
  getGroupSkeleton(params: {
    request: { sortModel; filterModel; rowGroupCols: string[] };
    success(result: { groups: SkeletonGroup[] }): void;
    fail(): void;
  }): void;

  /** Leaf window under ONE deepest-level group. */
  getLeafRows(params: {
    request: {
      groupPath: string[];          // raw values, NOT encoded keys
      startRow: number; endRow: number;
      sortModel; filterModel;
    };
    success(result: { rowData: TRow[] }): void;
    fail(): void;
  }): void;
}

interface SkeletonGroup {
  path: string[];                   // ['FX', 'EMEA'] — raw values
  leafCount: number;                // leaves under this subtree
  aggregates?: Record<string, unknown>;  // field → value (paints via totalsCellLookup)
}
```

What leaves the wire: `expandedGroupKeys`, `groupKeys` (was always `[]` —
dead AG-parity theater), server-computed `rowCount`, the `childCount`
smuggled through `positionId`.

**Composite keys become internal.** The `colId:value::colId:value` string
survives only as the kernel's map key / expansion-state vocabulary, built
via an encoding that escapes `:` and `::` in values (fix before freezing —
today a group value containing `::` corrupts the tree). The wire uses
`path: string[]`, so datasources never see or build encoded keys.

### Kernel changes

- **`SsrmSkeletonStore`** (new, main thread): holds `SkeletonGroup[]` in
  display order; rebuilt on `getGroupSkeleton` (sort/filter/groupBy change,
  soft refresh tick); patched in place when a refresh returns the same
  group set (aggregate ticks don't reflow).
- **`FlattenIndex`** (new): prefix-sum array over (skeleton × expandedKeys)
  → `rowCount`, `indexOf(groupKey)`, `rowAt(index) → group | (groupKey,
  leafOffset) | footer`. Toggle = local recompute (O(groups)), same frame,
  then `ssrmHydrate` of the already-known band (group rows from skeleton,
  cached leaves from the block cache) — blanks only where leaf blocks are
  genuinely missing.
- **`ServerSideRowModelController`** keeps its role but blocks become
  per-`(groupKey, leafBlock)`. Expansion changes stop invalidating
  anything — leaf caches are index-stable within their group (this
  dissolves `refreshExpansion`; the 2026-07-20 rowCount-change safety net
  stays for live server drift). Add LRU eviction (`maxBlocksInCache`
  equivalent) while touching this layer.
- **Worker**: unchanged. `ssrmHydrate` + `__ssrm` meta + flat slicer +
  `ssrmGroupMetaSeen` sticky gate all keep working — the main thread just
  becomes a much better hydrator. Sticky ancestors can later read the
  skeleton directly (exact even when nothing above the viewport is
  hydrated), replacing the O(rowStart) prefix scan.

### CSRM parity features this unlocks (client-side, no server changes)

- `groupDefaultExpanded: -1 | N`, `groupDefaultExpandedKeys`,
  `isGroupOpenByDefault` — evaluated against the skeleton.
- `expandAll`/`collapseAll` exact; `knownGroupKeys` accretion deleted.
- Group footers + grand total synthesized in the flatten (after children,
  only when expanded — GroupPass semantics, one implementation).
- Group column autosize from skeleton nodes.
- Filter-panel group counts, `getDisplayedRowCount`, `ensureIndexVisible`
  for group rows — all exact.
- Selection: skeleton supplies real group nodes; leaf-descendant cascade
  still needs server ids → keep symbolic "group selected" state + resolve
  ids lazily per expanded window; document the limit for collapsed groups.

### Live updates

- Aggregate ticks: `getGroupSkeleton` soft refresh (cheap — group rows
  only), patch by group key, no reflow, damage-paint agg cells.
- Leaf ticks: unchanged `applyServerSideTransaction` update path.
- Structural ticks (group appears/disappears, leafCount changes): skeleton
  refresh returns a different group set → FlattenIndex rebuild + scroll
  clamp — the one case that still reflows, and the server tells us exactly
  when.

### Demo/Perspective mapping

`getGroupedRaw` already fetches exactly the skeleton (grouped view
`to_json`) — it becomes `getGroupSkeleton` almost verbatim (plus
`__ROW_PATH__` → `path`, count agg → `leafCount`). `fetchLeafWindow` is
already `getLeafRows`. The O(groups²) walk, `countMaterializedGroupedRows`,
and `materializeGroupedWindow` are deleted, not ported.

---

## Migration plan

1. ✅ **Kernel** (2026-07-20): `core/ssrmFlattenIndex.ts` (`toDisplayOrder` +
   `FlattenIndex`) and v2 datasource types in `types/ssrm.ts`. Version
   detection is duck-typed on `getGroupSkeleton` presence
   (`isServerSideDatasourceV2`) — no version flag. v1 path untouched.
2. ✅ **Controller** (2026-07-20): `core/serverSideRowModelV2.ts` —
   per-group leaf blocks with global LRU (`maxCachedLeafBlocks`, default
   500), local-reflow `refreshExpansion` (rowCount lands before any fetch),
   expansion-drift rebuild on `ensureRange`, soft refresh that preserves
   caches for groups with unchanged leafCount, sticky-ancestor hydration
   from the skeleton, flat `getRows` fallback. cgrid mounts v1 or v2 per
   datasource shape and remounts on kind change; group rows are stamped via
   `inferRowIdField`.
3. ✅ **Demo** (2026-07-20): `book.ts` gained `getGroupSkeleton` /
   `getLeafRows` / `getFlatRows` (shared `syncQuery` remount);
   `ssrmDatasource.ts` is now v2. `ssrmGroupTree`'s window/count walks are
   no longer on the datasource path (kept only for the v1 `getSsrmRows`
   shim). STOMP/live ticks reuse the existing
   `refreshServerSide({purge:false})` + update-transaction flow.
4. **Parity features** (open): `groupDefaultExpanded: -1 | N` + keys +
   callback, group footers (after children), group column autosize from
   skeleton nodes, selection cascade.
5. **Remove v1** (open): drop `expandedGroupKeys` from
   `IServerSideGetRowsRequest`, dedupe `parseCompositeGroupKey` (kernel
   copy only), delete the demo v1 shim + showcase provider port.
6. ✅ Partially: with a v2 datasource, `ssrmWantsClientPipeline` only honors
   an explicit `serverSideEnableClientSidePipeline: true` — grouping-shaped
   options no longer trigger the full-book download. v1 keeps the legacy
   auto behavior until phase 5.

## Test plan

- FlattenIndex unit tests: counts/mapping across toggles, footers, defaults.
- Toggle-then-scroll integration (extends `ssrmBlockInvalidation.test.ts`):
  no refetch of unaffected groups, correct rows at shifted indices.
- Same-frame toggle: hydrate called with cached data before any datasource
  round trip.
- Sticky-from-skeleton (extends `ssrmStickyWorker.test.ts`).
- Live-tick: aggregate patch without reflow; structural tick with reflow +
  scroll clamp.

## Fixed ahead of this design (2026-07-20)

- `refreshExpansion` — expand/collapse drops the whole block cache (was:
  viewport band only → stale rows at shifted indices after scroll), plus a
  safety net: any fetch reporting a changed total invalidates other loaded
  blocks. `tests/ssrmBlockInvalidation.test.ts`.
- Sparse sticky band revived — gate on hydrated `__ssrm` group rows
  (`ssrmGroupMetaSeen`) instead of the worker group model, which is never
  shipped on the sparse path. `tests/ssrmStickyWorker.test.ts`.

## Addendum: engine-local unification (`feat/engine-row-model`, 2026-07)

Direction agreed after studying Perspective's viewer-datagrid: cgrid's
engine is always local (WASM in the same page), so the CSRM/SSRM split is
an artifact, not a requirement. Target: **one engine row model** — the v2
client-owned skeleton becomes *the* row model, with FlattenIndex as the
single flatten layer and the worker demoted to an optional prep stage.
Keyed (not index-addressed) expansion stays client-owned: it is what
survives engine rebuilds, unlike Perspective's ephemeral
`view.expand(rowIndex)` tree.

Staged plan:

1. **Smoothness batch** (✅ this branch):
   - *Window-identity suppression* — `hydrateRange` skips when
     (start, end, FlattenIndex identity, dataGen, cacheEpoch) all match the
     last hydrate; `cacheEpoch` bumps on any cache mutation (purge, LRU
     evict, block load/fail, transaction patch). Kills redundant repaints
     during tick storms. `tests/ssrmV2Controller.test.ts`.
   - *Adaptive soft-refresh pacing* — viewer-datagrid-style moving average
     (last 5 refresh durations, capped 2 s) spaces conflated soft
     refreshes so the queue can never outgrow its drain rate.
   - *Persistent sorted leaf view + offset windowing* (demo `book.ts`) —
     one long-lived Perspective view sorted by (group cols, then user
     sort) replaces per-fetch filtered views; leaf windows are read by
     row offset from prefix-summed `leafRanges` (built from the skeleton
     dump's leaf counts), with a contiguity spot-check that falls back to
     the old filtered-view path if the offset model ever disagrees.
     `getGroupLeafIds` rides the same ranges. Transport is
     `to_columns_string` + JSON.parse (columnar, one string copy) instead
     of `to_json`.
2. **FlattenIndex feature parity** (next): port GroupPass-only features to
   the skeleton path — `groupHideOpenParents`, `showOpenedGroup`,
   single-child elision on sparse; skeleton-fed group-column autosize.
3. **Worker's fate**: measure direct-path (main-thread FlattenIndex over
   engine reads) vs thin worker prep; consider `rowData` becoming an
   internal Perspective table so the flat path and the grouped path share
   one engine.
