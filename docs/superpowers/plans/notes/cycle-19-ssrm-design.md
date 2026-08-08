# Cycle 19 — Server-Side Row Model (SSRM) — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 19
**FM coverage:** Area 15 — ~28 of 28 rows + Area 03 SSRM-specific rows
**Depends on:** Cycle 15 (row grouping — SSRM groups expand on demand)

---

## Mental model: row model is pluggable; SSRM is a caching layer

The existing `ClientSideRowModel` (Cycles 4–18) assumes all rows are
loaded at construction time and the worker processes them through
`FilterPass → GroupPass → SortPass → AggPass`. SSRM replaces this:
the SERVER is now the authoritative pipeline. The worker becomes a
BLOCK CACHE in front of the server datasource.

**Three rowModelType options:**

| Mode | Source of truth | When to use |
|---|---|---|
| `'clientSide'` (default) | All rows in memory | < 1M rows, full client filtering/sorting |
| `'serverSide'` | Server | 1M–100M+ rows, server has the data + the pipeline |
| `'infinite'` | Server | Flat datasets without grouping (SSRM's simpler cousin) |

**The architectural bet:** the existing chunk format + viewport
slicer + paint pipeline are UNCHANGED. SSRM substitutes only the
"who fills the chunk" question.

```
ClientSide:  rowData[] ─→ Worker pipeline ─→ ChunkProducer ─→ Viewport
Serverside:  Server ────→ Block cache ─────→ ChunkProducer ─→ Viewport
                          ↑
                          └─ getRows(params) — app implements
```

---

## Task 1 — `SSRMDataSource` interface

```typescript
interface SSRMDataSource {
  getRows(params: SSRMGetRowsParams): Promise<SSRMGetRowsResult>;
}

interface SSRMGetRowsParams {
  startRow: number;
  endRow: number;
  sortModel: SortModel;
  filterModel: FilterModel;
  groupKeys: string[];     // path into the row-group tree, [] for root
  rowGroupCols: ColumnVO[];
  pivotCols: ColumnVO[];
  pivotMode: boolean;
  valueCols: ColumnVO[];   // agg cols
}

interface SSRMGetRowsResult {
  rowData: TRow[];
  rowCount?: number;       // exact total (server knows); undefined = "infinite"
  groupLevelInfo?: unknown; // opaque blob round-tripped to descendants
}
```

**Worker file:** `worker/ssrm/dataSource.ts` (new). The datasource
runs on the MAIN THREAD (not worker) because apps typically have a
`fetch` / WebSocket client in the main thread. Worker dispatches a
"need rows" message; main thread calls the datasource; result is
shipped back to worker via the existing protocol.

---

## Task 2 — Block cache on worker

```typescript
interface SSRMBlock {
  startRow: number;
  endRow: number;
  rowData: TRow[];
  state: 'loading' | 'loaded' | 'failed';
  loadedAt: number;
  lastTouchedAt: number;
}

class SSRMBlockCache {
  // LRU: blocksByGroupPath keyed `${groupKeys.join('/')}::${blockIndex}`
  // Eviction: when blocks > maxBlocksInCache, evict LRU.
}
```

**Config:**
- `cacheBlockSize` (default 100).
- `maxBlocksInCache` (default 100).
- `maxConcurrentDatasourceRequests` (default 2 — avoid stampede).
- `blockLoadDebounceMillis` (default 0).

**Worker file:** `worker/ssrm/blockCache.ts` (new).

---

## Task 3 — `rowModelType: 'serverSide'`

**Goal:** Single switch flips the worker pipeline from
`ClientSidePipeline` to `SSRMPipeline`. After the switch:

- `rowData` initial option is IGNORED.
- `applyTransaction` becomes `applyServerSideTransaction` (different
  shape).
- Filter / sort / pivot UI continues to fire the same model-change
  events, but the worker now forwards the new model to `getRows`
  instead of running the pipeline locally.

**File:** `worker/dataPipeline.ts` — dispatches to one of two
sub-pipelines based on `options.rowModelType`.

---

## Task 4 — Placeholder rows + loading cell renderer

**Goal:** Cells in not-yet-loaded blocks render a loading placeholder
without blocking paint.

**Implementation:** Chunk format gains `rowState: Uint8Array` per
row (0=loaded, 1=loading, 2=failed). The `'loading'` cell renderer
paints a soft 60% shimmer rectangle filling the cell minus 8px
padding. Pattern: ag-grid loading state for SSRM blocks.

**Tokens:**
| Token | Light | Dark | Why |
|---|---|---|---|
| `--vg-loading-shimmer-bg` | `#e5e7eb` | `#1a2742` | Inert gray that disappears once data lands |
| `--vg-loading-shimmer-highlight` | `#f3f4f6` | `#26314f` | Animated sweep highlight |

No animation by default (static shimmer rect); reduced-motion users
already covered.

---

## Task 5 — Lazy group expansion

**Goal:** Expanding a server-side group row triggers
`getRows({ groupKeys: ['EMEA', 'London'] })`. The result becomes a
sub-block keyed under that group path.

**Pipeline:** The existing Cycle 15 expand-toggle interaction fires
`setRowGroupExpanded(rowId, true)`. SSRM intercepts this in
`SSRMBlockCache.ensureBlock(groupKeys, startRow, endRow)` — if no
block exists for that path, it issues a `getRows` request; otherwise
returns cached rows.

**Group-level info:** `groupLevelInfo` round-trips between parent +
descendant requests — apps can pin opaque metadata (e.g.,
`{ continuationToken: '...' }`) that flows back on the next
descendant request.

---

## Task 6 — Server-side sort + filter

**Goal:** When the user sorts or filters via the existing UI, the
new model flows into the next `getRows` request. The cache is
invalidated at the appropriate level.

**Cache invalidation rules:**

| Change | Effect |
|---|---|
| Sort model changes | Invalidate ALL blocks at ALL group levels |
| Filter model changes | Invalidate ALL blocks at ALL group levels |
| Column visibility / order change | Cache STAYS valid (display-only) |
| Pivot mode change | Invalidate ALL blocks |
| Group expand / collapse | Cache STAYS valid for non-expanded paths |

---

## Task 7 — Server-side pivot mode

**Goal:** Pivot mode under SSRM works in two stages:

1. **Pivot result column synthesis** — Server returns the distinct
   pivot keys (one extra `getRows` call with `pivotMode: true` and
   `startRow: 0, endRow: 0`). cgrid synthesizes the column tree
   (same machinery as Cycle 18 Task 2).
2. **Cell value fetch** — Each visible (groupKey × pivotKey × aggCol)
   intersection is requested as a regular SSRM block; the server
   returns the aggregated value per cell.

**File:** `worker/ssrm/pivot.ts` (new).

---

## Task 8 — Cache control API

```typescript
interface VelocityGridApi {
  // SSRM-specific
  refreshServerSide(params?: {
    route?: string[];        // groupKeys path; default = root
    purge?: boolean;         // drop cached blocks before reload
  }): void;
  purgeServerSideCache(route?: string[]): void;
  getServerSideStoreState(): SSRMStoreInfo[];
  applyServerSideTransaction(tx: SSRMTransaction): void;
  retryServerSideLoads(): void;  // retry failed blocks
}
```

---

## Task 9 — `rowModelType: 'infinite'`

**Goal:** A simpler cousin: flat datasets (no grouping) lazily fetched
from a server. Reuses `SSRMBlockCache` with `groupKeys: []` always.

**Why ship both:** Some apps don't need grouping or pivot — the
infinite model has a thinner API (no `groupKeys`, no `pivotMode`,
just `startRow / endRow / sortModel / filterModel`).

**Datasource interface:**

```typescript
interface InfiniteDataSource {
  getRows(params: {
    startRow: number;
    endRow: number;
    sortModel: SortModel;
    filterModel: FilterModel;
  }): Promise<{ rowData: TRow[]; rowCount?: number }>;
}
```

---

## Task 10 — SSRM events

- `storeRefreshed` — fires after a `getRows` resolves; carries
  `{ route, rowCount }`.
- `storeUpdated` — fires after `applyServerSideTransaction`.
- `modelUpdated` (existing) — fires per chunk shipped to viewport.
- `rowDataLoaded` — fires when a block transitions `loading → loaded`.

---

## Performance gates

- 10M-row server-side dataset scrolls at target FPS.
- Pre-fetch ahead of viewport completes before user reaches the
  boundary at typical scroll speeds (1 chunk ahead in scroll
  direction, fetched when scroll velocity > threshold — design is
  reused from Cycle 25 Task 8 with a stub here).
- LRU eviction keeps memory bounded regardless of scroll history.
- `getRows` calls are coalesced: simultaneous requests for adjacent
  blocks merge into one request with `endRow` extended.

---

## Exit criteria recap

- FM Area 15 ≥ 95 % ✅.
- Demo: a tab in `apps/cgrid-positions` connects to a mock
  WebSocket / REST endpoint serving 10M rows; scroll, sort,
  filter all round-trip; group expand fetches sub-blocks.
- Infinite-mode demo: flat 5M-row dataset with sort/filter via
  REST datasource.
- Failed blocks render the failed-state cell; `retryServerSideLoads`
  re-fetches them.
