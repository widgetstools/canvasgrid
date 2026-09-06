# SSRM multi-blotter / Perspective — work so far

**Branch:** `feat/ssrm-multi-blotter-stomp`  
**Date:** 2026-07-20  
**Status:** In progress (uncommitted kernel + demo work)

---

## Goal

Sparse SSRM for velocity-grid: host/Perspective owns filter/sort/group/agg; kernel owns block cache, hydrate, and paint — same read paths as CSRM (`getRows` → hydrate → `cellAt` / `totalsCellLookup`). No client-side pipeline on this path (`serverSideEnableClientSidePipeline: false`).

---

## Kernel (`packages/kernel`)

| Area | Files | What landed |
|------|--------|-------------|
| SSRM controller | `src/core/serverSideRowModel.ts` | Block cache, `getRows` fan-in, soft refresh, hydrate |
| Types | `src/types/ssrm.ts` | `IServerSideDatasource`, request/result shapes |
| Row meta | `src/core/ssrmRowMeta.ts` | `__ssrm` metadata, `materializeSsrmGroupTotals`, sticky ancestors |
| Grid wiring | `src/velocityGrid.ts` | SSRM mount, expand keys, scroll clamp, defer refresh while scrolling |
| Viewport | `src/worker/handlers/viewport.ts` | Sparse path: group totals + sticky band |

### Fixes worth noting

1. **Group totals on groups** — sparse rows ship `chunk.groupTotals` so agg columns paint (and tick after soft refresh).
2. **Soft refresh** — viewport-scoped block invalidation (not full purge every tick).
3. **Sticky expanded groups** — CSRM-parity sticky ancestor band + totals for keys above the viewport.
4. **Scroll deferral** — queue `refreshServerSide` / transactions during scroll; flush on `bodyScrollEnd`.
5. **Expand click bug** — with `groupDefaultExpanded: 0`, `expandedKeys === null` was treated as CSRM “expand all”; first chevron click expanded every *other* desk. Now null means all-collapsed for sparse SSRM.
6. **Stale blocks after expand/collapse** (2026-07-20) — a toggle shifts every flattened index below it, but the soft refresh only invalidated viewport-band blocks; scrolling later rehydrated pre-toggle rows at post-toggle indices (rows under the wrong groups). `refreshExpansion` now drops the whole block cache on toggles, and any fetch reporting a changed `rowCount` invalidates other loaded blocks (safety net for live drift).
7. **Sticky band regression** (2026-07-20) — the worker-side sticky gate read `state.group.getModel().rowGroupCols`, but the sparse path never ships `setGroupModel` (GroupPass stays off), so the band was unreachable. Now gated on `ssrmGroupMetaSeen` (hydrate carried `__ssrm` group rows); ancestor colIds fall back to composite-key segments.
8. **Soft-refresh queue death spiral** (2026-07-21) — every live tick queued one refresh op on the SSRM controller chain; with multi-level grouping the per-refresh Perspective work (skeleton `to_json` + per-group leaf view churn) exceeds the tick cadence, so the backlog grew without bound — refreshes lagged minutes behind (numbers "stop ticking") and a group-reorder purge queued at the tail never visibly landed (hierarchy "doesn't change"). Both controllers now **conflate soft refreshes** (at most one queued; ticks arriving meanwhile ride it), so refresh cadence self-paces to op duration and purges/toggles land within ~2 ops. Repro + drain-bound regression: `tests/ssrmV2Reorder.test.ts`.
9. **Permanent blank leaf rows** (2026-07-21) — a leaf fetch returning fewer rows than the skeleton's window (server still settling, count drift mid-snapshot) was cached as `'loaded'` and never refetched, so those slots painted blank forever. Short/empty results now cache as `'failed'` (retryable on the next ensureRange / soft-refresh tick) while whatever rows did arrive still paint. Regression: `ssrmV2Controller.test.ts` "short/empty leaf results stay retryable".
10. **Perspective WASM wedge under v2 op rate** (2026-07-21, demo) — `table.update` (seed snapshot + live flush), `num_rows` reads, and the leaf view's create→count→read→delete steps ran outside (or between acquisitions of) the table lock. Concurrent WASM ops occasionally hang (the file's own warning), poisoning the per-view chain: leaf fetches never resolve → controller inflight pegs → toggles/refreshes queue forever → erratic expand/collapse, frozen ticks, stale totals. All table/view ops are now serialized under `withTableLock`, with leaf fetches holding the lock once across all four steps.
11. **Grand-total pinned row zeros + missing label** (2026-07-20, demo) — `totalsView` had `aggregates` but no `group_by` (Perspective ignores aggregates on ungrouped views), the pinned row only refreshed on live ticks (wire-time fetch raced the first remount), and the label lived on `desk` (hidden while grouped by Desk). Fixed: totalsView groups by `desk` and reads the root `__ROW_PATH__: []` aggregate row, `fetchGrandTotal` serializes behind the view chain, every remount schedules a totals tick, and the Position column renders “Grand Total” for the synthetic id.

### SSRM v2 — client-owned group skeleton (2026-07-20)

Phases 1–3 of `docs/ssrm-group-skeleton-design.md` implemented:

| Piece | File |
|---|---|
| Flatten index + display-order normalize | `src/core/ssrmFlattenIndex.ts` |
| v2 controller (per-group leaf blocks, LRU, local reflow) | `src/core/serverSideRowModelV2.ts` |
| v2 datasource contract + duck-typed detection | `src/types/ssrm.ts` (`IServerSideDatasourceV2`, `isServerSideDatasourceV2`) |
| cgrid mount/kind-switch + sparse gates | `src/velocityGrid.ts` (`mountSsrmController`, `isSparseSsrm`) |
| Demo port (skeleton + leaf + flat queries) | `apps/velocitygrid-ssrm-demo/src/perspective/book.ts`, `ssrmDatasource.ts` |

Expansion toggles now reflow locally (rowCount updates before any datasource
call; collapse needs zero calls), leaf caches are per-group and survive
toggles, and with a v2 datasource grouping-shaped options no longer trigger
the client-pipeline full-book download. Demo runs the v2 contract
(`npm run dev:ssrm-demo`); showcase remains on v1.

### AG-parity first wave (2026-07-21)

Per `docs/row-grouping-parity-audit.md` §5 items 8–13: kernel-native
`grandTotalRow: 'pinnedBottom'` on both paths (demo's hand-rolled pinned
row deleted), AG levels-open `groupDefaultExpanded` semantics (**behavior
change**: `N` = levels open, `0` = none; defaults re-seed when data arrives
after the group model), full expansion defaults on sparse, sparse
group/grand-total footers via FlattenIndex, `groupMaintainOrder`
(CSRM + sparse order pinning), and sparse selection cascade via the new
optional datasource `getGroupLeafIds`. Browser e2e:
`apps/velocitygrid-positions/e2e/agParityFirstWave.spec.ts` (8/8; run with
`playwright.alt-port.config.ts` when 5175 is occupied).

### AG-parity second wave (2026-07-21)

Audit §5 items 14–17: `totalValueGetter`
(autoGroupColumnDef.cellRendererParams), `keyCreator` (worker-serialized,
GroupPass-derived keys), `groupAggFiltering` (filters prune the group tree
by aggregates; leaves bypass the column filter), and
`autoGroupColumnDef.filter: 'agGroupColumnFilter'` (auto column inherits
the grouped column's field + filter type). Tests:
`groupParitySecondWave.test.ts` + e2e `agParitySecondWave.spec.ts`.

### Tests

- `packages/kernel/tests/ssrmRowMeta.test.ts`
- `packages/kernel/tests/ssrmExpandToggle.test.ts`
- `packages/kernel/tests/ssrmBlockInvalidation.test.ts` — toggle-then-scroll staleness, band-scoped soft refresh, rowCount-change safety net
- `packages/kernel/tests/ssrmStickyWorker.test.ts` — worker-level sticky band with no group model shipped
- `packages/kernel/tests/ssrmFlattenIndex.test.ts` — display-order normalize, visibility, leaf runs, ancestors
- `packages/kernel/tests/ssrmV2Controller.test.ts` — local reflow ordering, cache survival across toggles, soft-refresh cache diffing, sticky hydration, flat fallback
- `packages/kernel/tests/ssrmV2Reorder.test.ts` — full-VelocityGrid integration (working fake worker): group-column reorder refetches the skeleton in the new order, and a live-tick flood cannot grow the refresh queue unbounded (conflation drain bound)

---

## Apps

### Standalone demo — `apps/velocitygrid-ssrm-demo/`

Perspective WASM book + windowed grouped `getRows`:

- `src/perspective/book.ts` — table/views, seed/STOMP feed
- `src/perspective/ssrmDatasource.ts` — `IServerSideDatasource`
- `src/perspective/ssrmGroupTree.ts` — grouped window materialization
- `src/ui/blotterHost.ts` — mounts SSRM `VelocityGrid`
- `src/main.ts` — multi-blotter UI

**Run:** `npm run build:kernel` then `npm run dev:ssrm-demo` → http://localhost:5191  
(`?feed=seed` default; `?feed=stomp` optional)

### Showcase — `apps/velocitygrid-showcase/`

- `src/data/stompSsrmDataProvider.ts` — `StompSsrmDataProvider`
- `src/features/multiBlotterSsrm.ts` — multi-blotter feature entry

---

## Architecture (current)

```
seed / STOMP → Perspective Table + Views
                    ↓ windowed getRows (+ __ssrm on group rows)
              IServerSideDatasource
                    ↓
              ServerSideRowModelV2Controller (blocks)
                    ↓ ssrmHydrate
              worker store / viewport chunk
                    ↓
              canvas paint (cellAt, totalsCellLookup, sticky band)
```

(v1's `ServerSideRowModelController` — named here when this journal entry
was written — was fully decommissioned; the diagram now names the surviving
`ServerSideRowModelV2Controller`, see `core/serverSideRowModelV2.ts`.)

---

## Still open / next

- Manual verify: sticky band + correct single-group expand after rebuild
- **Sparse SSRM v2 — client-owned group skeleton** (`docs/ssrm-group-skeleton-design.md`): CSRM-parity direction — kernel owns all group rows + flatten index, toggles reflow same-frame, datasource shrinks to `getGroupSkeleton` + `getLeafRows`. Supersedes “keep group header rows pinned in store”.
- Commit / PR when ready

## Worklog: `feat/engine-row-model` smoothness batch (2026-07)

Branched from `feat/ssrm-multi-blotter-stomp` (commit 5478183) after the
viewer-datagrid study; see the unification addendum in
`docs/ssrm-group-skeleton-design.md` for the staged plan. Landed:

- Kernel v2 controller: window-identity hydrate suppression
  (`cacheEpoch` + last-hydrate signature) and adaptive soft-refresh
  pacing (5-sample moving average of refresh cost). 27 controller tests,
  50 across the SSRM set, all green.
- Demo `book.ts`: persistent sorted leaf view per bound view, leaf
  windows read by offset from prefix-summed `leafRanges` with a
  contiguity spot-check + filtered-view fallback; `getGroupLeafIds`
  prefix-scan fast path; all bulk reads via `to_columns_string`.
- Live-verified on the demo (drive scripts, channel:'chrome'):
  10,000 flat → 3 collapsed → 674 expanded → 8 recollapsed, ticking
  aggregates, pinned grand total, sticky band under deep scroll, and no
  leaf-offset-mismatch warnings — the offset fast path held throughout.

---

## Worklog: Phase 5 — SharedWorker multi-tab (2026-07-25)

One Perspective engine per origin: `sharedServer.worker.ts` hosts the server
WASM in a SharedWorker with a session per connected tab (the stock client's
inline worker has `connect` wiring but a single global session — concurrent
tabs clobber each other, hence the custom host). Every tab binds the fixed
`positions-shared` table (`open_table` attach, <1s, no reseed); exactly one
tab feeds (Web Locks leader election, queued takeover on leader close);
follower flat views paint remote ticks via conflated soft refresh. Dedicated
fallback via `?worker=dedicated` or automatic on init failure/timeout.
Verified: `scripts/phase5-smoke.mjs` (11/11) + `phase1-smoke.mjs` regression.

## Worklog: hub identity + the feed inside the worker (2026-09-05)

Started from a reported OOM crash in `velocitygrid-ssrm-provider-demo` and
ended with the SSRM transport living inside the SharedWorker. Six commits,
`0ab86521..2ec7b639`. Read
[ssrm-shared-engine-architecture.md](./ssrm-shared-engine-architecture.md)
first — it is the reference; this is the state-of-play.

### What landed

| # | Commit | What |
|---|---|---|
| 1 | `0ab86521` | The CSRM hub SharedWorker **never started in a production build** — `connectHub` assigned the URL to a variable, so Vite inlined the raw TypeScript as `data:video/mp2t;base64,…`. Every request hung until the 60s timeout; dev servers hid it entirely. Plus `name` / `strict` / `getDataHubTarget()` and a deployable `velocity-grid-data-hub.js`. |
| 2 | `f9d2ff99` | `npm run verify:data-hub` — the hub's three-level identity against real builds. |
| 3 | `f5acb95a` | The SSRM feed runs **inside the SharedWorker**. Protocol → 2. |
| 4 | `4d6f227b` | Resilience tests for it; found two defects (below). |
| 5 | `8ac5469e` | Worker feed becomes the **default**; config-mismatch reporting; the `{ name, type }` fix that unblocked 11 `ext` suites. |
| 6 | `2ec7b639` | Correction: that fix was a *test*-pipeline hazard, not a production one. |

### Current state

- **Worker feed is the default.** `workerFeed: false` on the controller, or
  `?feed=main` on the demo, forces the main-thread path — which is also the
  automatic fallback with no shared engine or a protocol-1 deployed worker.
  `BookTelemetry.feedRole` says which ran: `worker` | `leader` | `follower`.
- **Election is still there** and still the whole story on the fallback path.
- **`SHARED_ENGINE_PROTOCOL = 2`**; `WORKER_FEED_PROTOCOL = 2` is a separate
  *floor* that must stay at 2 as the engine protocol moves on.
- Instance names ride in the worker URL (`?engine=` for the engine, `?app=`
  for the hub), never in the `SharedWorker` options.

### Measured

```
3 tabs, one build      feedRole=worker ×3, 1 feed, subscribers=3, sessions=3, hostSessions=1
2 apps, deployed worker 1 engine, 1 table, 1 feed, subscribers=2
2 apps, unconfigured    ?feed=main → 34.9s to live;  default → 3.5s
ext suites              70/70, 746 tests (was 59/70, 696)
```

That 34.9 → 3.5 is the origin-scoped Web Lock stall disappearing: it was a
property of the main-thread feed, not of being unshared.

### Traps found (the expensive part of this work)

1. **`new URL(...)` must be literal + inline** in `new SharedWorker(...)` or
   the bundler emits raw source. Silent, production-only. Guarded.
2. **Worker options must be a static literal.** Vite `eval`s them. `vite build`
   *tolerates* a variable (verified, same content hash) — the **serve/test**
   transform throws, which is what made 11 `ext` suites unloadable. Different
   severity from (1); do not conflate them.
3. **No import may reach a module that builds a worker of its own**, or the
   "one deployable file" grows a sibling asset nobody deploys. Hence
   `@wellsfargo-starui/velocity-grid-data/rowid`. Guarded by an import walk.
4. **`getCompiledClientWasm()` does not work** for building a client in a
   worker — `init_client` dispatches on argument type and has no
   `WebAssembly.Module` branch. Send the wasm URL instead.
5. **`customElements` does not exist in a worker** and the Perspective client
   probes it on every wasm lookup. Shimmed.
6. **Playwright `waitForFunction` does not await an async predicate** — a
   pending Promise is truthy, so the wait succeeds on tick one. Use
   `expect.poll`. Cost two debugging rounds.
7. **A rate is a window and only falls when recomputed.** The worker sends one
   trailing state ~1.1s after its window empties, or every tab reports the last
   rate forever over a dead feed.
8. **`onConnected` fires on reconnect** and re-requests the snapshot, so it
   must clear `snapshotComplete` — otherwise the book sits in `snapshot`
   indefinitely while rows arrive. `book.ts` had this bug first;
   `packages/data/src/transports/stomp.ts` always got it right.

### Still open

- **Deleting the election layer.** Blocked, not forgotten: the main-thread feed
  is the fallback for a protocol-1 deployed worker and genuinely needs
  election. It can go when no protocol-1 workers remain in the field — a
  rollout gate, not a refactor.
- **Table identity vs resolved config.** Identity folds in `providerId` but not
  the resolved config, so two apps resolving one provider to different topics
  share a feed and the first caller wins. Now *reported*
  (`WorkerFeedState.configMismatch` + a one-time warning), not resolved. The
  real fix changes table names, which splits books meant to be shared.
- **Credentials.** Nothing in the STOMP path carries them, on any feed path or
  in CSRM's hub transport. Missing feature project-wide, not a regression.
- **Kernel suite is not green on a clean tree** (perf-flavoured tests). Verify
  by stashing before blaming a change.

### Verifying any of it

```bash
npm run dev:stomp                                     # required for everything
npm run dev:ssrm-provider                             # :5211

npx playwright test e2e/ssrm-worker-feed.spec.ts      # feed paths + both fallbacks
npx playwright test e2e/ssrm-engine-sharing.spec.ts   # N tabs, one build
npx playwright test e2e/ssrm-shared-engine.spec.ts    # sessions across reloads
npm run verify:shared-engine                          # 2 built apps, 1 origin
npm run verify:data-hub                               # the CSRM hub, same question
npm run verify:worker-feed-reconnect                  # sever the broker, heal it
```

From any SSRM blotter's console:

```js
__demo.workerFeed()        // { requested, available } — why, if it fell back
await __demo.engineFeeds() // per table; `subscribers` = tabs on that feed
await __demo.engineStats() // sessions (pages) vs hostSessions (the worker's own)
__demo.workerTarget()      // { url, name, bundled }
__demo.stopFeed() / .restartFeed()
```

## Related docs

- [ssrm-shared-engine-architecture.md](./ssrm-shared-engine-architecture.md) —
  the reference for everything in the 2026-09-05 worklog above
- `docs/superpowers/plans/notes/perspective-ssrm-phased-plan.md` — phased plan
- `docs/catalog/15-server-side-row-model.md` — catalog SSRM notes
