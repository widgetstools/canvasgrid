# VelocityGrid Production Hardening — Findings Spec

**Source:** Four-agent critical review, 2026-08-14, verified against `main` @ f6da524 (all findings traced through actual code paths; line numbers from that tree).
**Companion plan:** `2026-08-14-velocitygrid-production-hardening.md`

Finding IDs are referenced by plan tasks. Severity: CRIT / MAJOR / MINOR.

---

## Area A — CSRM kernel path

### A-C1 (CRIT) Grouped index vocabulary split — wrong-row copy/edit/scroll
When grouping is active, main-thread row indices are the **group-visible order** (group header rows occupy slots, collapsed leaves excluded — see `computeGroupVisibleOrder`, `worker/viewportSlicer.ts:73-100`). Only `getRowIndicesForIds` (`worker/handlers/viewport.ts:58-88`) translates correctly. Still indexing the **flat leaf array** (`helpers.visibleAsync()`):
- `getRowIndexForId` — `worker/handlers/viewport.ts:38-43`
- `getRowByIndex` — `worker/handlers/viewport.ts:45-56`
- `clipboardSerialize` — `worker/handlers/clipboard.ts:33-45`
- autosize `textOf` — `worker/handlers/viewport.ts:346-354`

Consequences: `ensureRowVisible` scrolls to wrong index; fill-handle commit (`velocityGrid.ts:4737-4746`), editor commit (`velocityGrid.ts:3029`), and Ctrl+C (`velocityGrid.ts:6892-6896` special-cases pivot only) target/serialize the **wrong row** in any grouped grid.
**Fix:** one shared "visible index ↔ leaf rowId" resolver in the worker, used by all four endpoints whenever `isGroupingActive()`.

### A-C2 (MAJOR) Pending async transactions survive `setRowData`
`worker/handlers/dataPipeline.ts:79-119` (`setRowData` case) never touches `state.queue`; `TransactionQueue` (`worker/dataPipeline.ts:322-400`) timer keeps running. Queued tick replays onto the replacement dataset; main's `rowDataById` was wiped (`velocityGrid.ts:4180-4183`) → permanent mirror divergence. Same for `ssrmHydrate(reset:true)`.
**Fix:** drain-and-discard the queue (clear timer) in `setRowData` / reset-hydrate handlers.

### A-C3 (MAJOR) No pipeline single-flight with main-thread hooks
`worker/worker.ts:320-326` check-then-set of `visibleCache` across `await` (external filter round-trip suspends at `worker.ts:180-198`/`302-305`); a concurrent message starts a second `buildVisibleAsync`; both interleave writes to `groupOutput`/`pivotOut`/`groupInputIds`/`visibleCache`.
**Fix:** store the in-progress build promise (`state.visibleCachePromise`); concurrent callers await the same build; invalidation replaces the promise.

### A-C5 (MINOR) `viewportReqSeq` latest-wins guard is dead code
Seq bumped only in `dispatchRequest` (`core/viewportManager.ts:667-676`), which coalesces — the guard at `velocityGrid.ts:11349-11354` can never fire. Real protection is the intersection check at `:11355-11361`. Also `dispatchRequest`'s catch (`viewportManager.ts:710-714`) drops the queued follow-up and leaves `lastDispatchedRange` claiming coverage it doesn't have → blank rows persist after a failed fetch.
**Fix:** delete seq plumbing (document intersection+coalescing as the mechanism); on dispatch error clear `lastDispatchedRange`/`lastDispatchedCols`.

### A-C6 (MAJOR, narrow) Grouped sort ignores text calc columns
`worker/passes/sortPass.ts:340-344` caches calc values into `anyCaches`, but comparator guard `if (!r.col || !r.col.field) continue;` (line 376) skips fieldless calc columns. Flat sort handles them (`sortPass.ts:131-133`). **Fix:** guard becomes `if (!r.col) continue;`.

### A-C7 (MINOR) Group composite keys unescaped
`worker/passes/groupPass.ts:26-27` — `${colId}:${value}` joined with `::`. Value containing `::` collides with deeper path. Same class: SSRM `core/ssrmRowMeta.ts:119-143` + depth via `key.split('::').length` (`velocityGrid.ts:5962`), and perspective `ssrmGroupTree.ts:13-28`. **Fix:** escape separator chars in key segments in all three places (single shared escape helper per package is fine).

### A-L1 (MAJOR) Worker errors completely silent
`worker/client.ts` — `WorkerClientHandlers.onError` (line 18) never invoked; no `worker.addEventListener('error'|'messageerror')` anywhere (`velocityGrid.ts:3175` creates Worker bare). Worker load failure (CSP/bundler) → `gridReady` never fires, empty grid, zero console output; mid-session crash → all pending promises hang, grid frozen silently.
**Fix:** register both listeners in `WorkerClient`, funnel to `handlers.onError`, reject all `pending` on worker error; init timeout with loud error.

### A-L2 (MAJOR) rAF push coalescing stalls in background tabs
`worker/client.ts:86-93` — rAF suspended in hidden tabs; `pendingTxnResults`/`pendingHeights` grow unboundedly for hours; giant stale flush on refocus. **Fix:** rAF raced with `setTimeout(~50ms)` fallback, or immediate flush when `document.visibilityState === 'hidden'`.

### A-L3 (MAJOR on rotating data) RowStore id maps grow forever
`worker/dataPipeline.ts:51-71` — `setAll` clears `byId`/`order` but not `stringToNumeric`/`numericToString`; `remove` (`:104-115`) doesn't either. **Fix:** drop mappings for absent ids on remove/setAll.

### A-L4 (MINOR) destroy() doesn't release the dataset mirror
`velocityGrid.ts:9526-9658` never clears `rowDataById` / `knownGroupKeys` / `groupDescendants`. **Fix:** clear in destroy.

### A-L5 (MINOR) RowStore removal is O(k·n)
`worker/dataPipeline.ts:106-108` — `order.indexOf` + `splice` per removed id. **Fix:** batch mark + single compaction pass.

### A-P1 (MAJOR at scale) Aggregation recomputed per getViewport
`worker/handlers/viewport.ts:239-241` unconditional `state.agg.apply(visIds)` + `:270-282` `applyGroups` — full O(N) on every scroll fetch with zero data change. **Fix:** cache `{totals, groupTotals}` keyed on `visibleCache` array identity; invalidate where `visibleCache` is nulled.

### A-P2 (MAJOR at scale) Grouped getViewport O(N) walks per fetch
`handlers/viewport.ts:109-115` re-materializes `computeGroupVisibleOrder` + `buildGroupMetaLookup` per request; `worker.ts:475-501` `computeStickyAncestors` walks O(rowStart). **Fix:** cache visibleOrder+metaLookup keyed on (`groupOutput` identity × `expandedKeys` identity).

### A-P4 (MAJOR) Fenwick RowHeightIndex reallocated per modelUpdated
`velocityGrid.ts:3228-3229` — `new RowHeightIndex(rowCount,…)` (O(n), two Float32Arrays) on every modelUpdated even for uniform-height grids. **Fix:** uniform-height fast path (no index until a non-fallback height is seen).

### A-P5 (MAJOR, design) Main thread mirrors the whole dataset
`velocityGrid.ts:4180-4183` + `4319-4378` — `rowDataById` holds the entire book; needed only by `alwaysPassFilter`, `doesExternalFilterPass`, `postSortRows`, `rowsChanged` listeners, rule-fold paint lookups. **Fix:** gate mirror on those features.

### A-P6 (MINOR) recomputeAlwaysPass per transaction
`velocityGrid.ts:4230,4274,4411-4429` — O(dataset) scan + full id ship + pipeline rebuild + viewport fetch per tick when configured. **Fix:** debounce; evaluate only touched rows and diff.

### A-P7 (MINOR) Write-only chunk LRU
`velocityGrid.ts:11372-11381` — every chunk sized and stored, lookup never wired. **Fix:** remove.

### A-P8 (MINOR→MAJOR) mergeTicks rebuilds full Map per tick
`data/src/client/ProviderClientAdapter.ts:83-96`. **Fix:** keep the Map as the persistent cache representation.

### A-D3 (MINOR) Swallowed init pushes
`velocityGrid.ts:3338,3345,3352` — `.catch(() => {})` on `setSortModel` etc. at boot → silent model divergence. **Fix:** log via the grid's error/event channel.

### Baseline test-suite failures (pre-existing on main)
`packages/ext` vitest run exits 1 with 212/212 passing due to unhandled rejections:
1. `Error: worker terminated` — `kernel/src/worker/client.ts:636` destroy-rejects pending promises; nothing observes them (stack: `VelocityGridExt.destroy` → `velocityGrid.ts:9582` → `workerCoordinator.ts:115`).
2. `TypeError: i.drawImage is not a function` — async paint path in jsdom (no canvas impl).
Both must be fixed (destroy-rejection observed/expected; paint path guards or catches).

---

## Area B — SSRM kernel

### B-C1 (MAJOR) v1 empty-"loaded"-block reload is a no-op
`core/serverSideRowModel.ts:281-288` + `:315-317` — reload block pushed to `needed` but `loadBlock` without `force` early-returns on `'loaded'`. Initially-empty book stays empty forever.

### B-C2 (MAJOR) v1 transactions: remove resurrects, add invisible
`core/serverSideRowModel.ts:164-194` — remove leaves row in `block.rows` (re-hydrate resurrects); add gets no block slot/`ssrmOrder` index (grows scrollbar, never paints).

### B-C3 (MAJOR) Unknown rowCount stalls infinite scroll
v1 `serverSideRowModel.ts:367-371`; v2 flat `serverSideRowModelV2.ts:947-949` — omitted `rowCount` inferred as loaded edge; block N+1 never requested. **Fix:** over-allocate by one block and mark estimated (AG behavior), clamp on short result.

### B-C4 (MINOR) v2 same-frame reflow hydrate off the op chain
`serverSideRowModelV2.ts:252-261` fire-and-forget `hydrateRange` outside `enqueue` vs `hydrateRange` staleness check after `await` (`:1093-1127`); stale `hydrateWindow` posts with old rowCount → transient `ssrmOrder` wipe (`worker/dataPipeline.ts:126-128`) + rowCount flap during toggle. **Fix:** single serialized hydrate dispatcher with index/generation token checked at send time.

### B-C5 (MINOR, latent) v1 stale reply wedges block in 'loading'
`serverSideRowModel.ts:342-348, 399-404` — stale-gen reply never resets state; `waitUntil` (`:268-273`) polls forever. **Fix:** set `'failed'` (retryable) on stale reply. (Moot if v1 removed.)

### B-C6 (MINOR) v2 leaf reply written into detached cache map
`serverSideRowModelV2.ts:559-562` (`dropGroupCache` deletes the Map) vs `cache!` closure in `loadLeafBlock.success` (`:683-699`). **Fix:** re-resolve `this.leafCaches.get(node.key)` in the handler.

### B-C8 (MINOR) Failed blocks retried with zero backoff, no surfacing
`serverSideRowModel.ts:275`, `serverSideRowModelV2.ts:603`. **Fix:** per-block retry backoff; expose failure state.

### B-v1-decommission (MAJOR)
v1 mounted for any getRows-only datasource (`velocityGrid.ts:3702-3714`); only in-repo producers are unit tests; shipping perspective datasource is v2. v1 lacks purge-epoch cancellation, pacing, fetch tokens, LRU (B-L1: block cache unbounded, `serverSideRowModel.ts:49`). **Fix (design-doc phase 5):** always mount `ServerSideRowModelV2Controller` (v2 flat fallback speaks the same getRows contract); grouped v1 (`expandedGroupKeys`) has no v2 equivalent and zero in-repo consumers → loud error directing to `getGroupSkeleton`; delete v1 + migrate its tests.

### B-L2 (MAJOR) Eviction doesn't propagate
v2 LRU (`maxCachedLeafBlocks`, default 500) trims controller blocks only; worker store orphan sweep runs only on realloc/repoint (`worker/dataPipeline.ts:189-202`); `rowDataById` clears only on reset hydrate (`velocityGrid.ts:3781`). Long-lived blotters → whole-book residency ×2. **Fix:** eviction propagates removals to worker store and mirror.

### B-L3 (MINOR) `ssrmColumnRefillTimer` not cleared in destroy (`velocityGrid.ts:9538-9545` clears only `ssrmResortTimer`).

### B-A4 (MAJOR, fidelity) `inferRowIdField` throws unless `getRowId` is literally `row => row.<field>`
`velocityGrid.ts:403-413` — composite/derived ids crash v2 mount. **Fix:** fallback: evaluate `getRowId` per row at hydrate and inject a synthetic id field.

### B-A6 (MINOR) `maxCachedLeafBlocks` not exposed in GridOptions, not passed by `mountSsrmController` (`velocityGrid.ts:3850-3857`).

### B-P5 (MINOR) `waitUntil` is 4ms polling in both controllers — prefer promise-resolved wakeups.

---

## Area C — SSRM data plane (hub / transports / perspective)

### C-C1 (CRIT) Hub never cleans up dead ports
`data/src/worker.ts:10-14`, `hub/DataServicesHub.ts:54-67` — `removePort()` never called; closed tabs receive every push forever. **Fix:** heartbeat + eviction; `pagehide`-driven bye from `hubConnection`; prune on post failure.

### C-C2 (CRIT) Client `stop()` kills the shared transport for all tabs
`client/ProviderClientAdapter.ts:105-108` → `stopSlot` (`DataServicesHub.ts:244-254`), invoked from `ext/src/modules/dataProviderController.ts:340-348` (`stopCurrent`) on every switch/detach. Hub `detach` deliberately keeps transports running (`:209-211`); the controller bypasses that. **Fix:** switch path detaches only; `stopSlot` only from explicit Diagnostics Stop or last-subscriber-with-grace.

### C-C3 (CRIT) Update-only push semantics drop adds; restart truncates remote tabs
`client/bind.ts:47-52` ships every tick as `{update}`; kernel drops unknown-id updates (`worker/dataPipeline.ts:95-102`). Also `fanOutReplace` (`DataServicesHub.ts:337-361`) chunks at `snapshotChunkSize ?? 500`; adapter maps chunk 1 → replace/`setRowData`, chunks 2..N (`replace:false`) → tick path → dropped → remote tabs permanently truncated to 500 rows. **Fix:** protocol gains add/update/remove semantics (or chunk continuation marking); bind splits adds/updates; removes become expressible (C-m3).

### C-M1 (MAJOR) Detach never sent after stop → subscriber leak per switch
`ProviderClientAdapter.ts:176-187` — `destroy()` sends `detach` only if `this.started`; `stop()` set it false. Surviving grids process each tick N times after N switches. **Fix:** track attached separately; always detach in destroy.

### C-M2 (MAJOR) Hub STOMP end-token substring match swallows frames
`transports/stomp.ts:62-68`, `buildEndTokenMatcher :110-113` — case-insensitive substring; a data frame containing "success" ends the snapshot and its rows are swallowed. `perspective/src/book.ts:2072-2085` already fixed this (exact/`${token}:` prefix). **Fix:** mirror book.ts matching.

### C-M3 (MAJOR) Hub STOMP reconnect wedges status in 'snapshot'
`stomp.ts:26-56` — `snapshotComplete`/`received` reset only in `activate()`; stompjs auto-reconnects and re-snapshots without reset → `if (snapshotComplete) return` (`:63`) → `ready` never re-emitted; re-snapshot merges as upserts (server-deleted rows survive). **Fix:** reset closure state in `onConnect`; emit `replace` on re-snapshot first batch.

### C-M4 (MAJOR) Thin-delta × conflation loses field updates
`DataServicesHub.applyIngressProjection :312-335` (thin deltas vs cache at flush) + `LivePipeline.push` (`hub/rowCache.ts:84-111`) conflates by **replacement** (`pending.set(id, row)`). Two partial ticks in one throttle window → first tick's fields lost. **Fix:** merge on conflate: `pending.set(id, {...pending.get(id), ...row})`.

### C-M5 (MAJOR) REST transport stop/restart/stale handling broken
`transports/rest.ts:54-70` — (a) `restart()` never re-arms the poll timer; (b) no AbortController → in-flight fetch after stop resurrects status; (c) no sequence guard → older slow response overwrites newer. `TransportContext.signal` (`types/transport.ts:21`) declared, never populated. **Fix:** generation counter + AbortController wired to stop/restart; re-arm timer.

### C-M6 (MAJOR) Perspective shared table/lock keyed by schema only
`perspective/src/bootstrap.ts:111-127` (`tableNameForSchema`), `book.ts:710-712` (`feedLockName`), `book.ts:1809-1847` (`connectRouted` adopts any populated table). Two providers with identical columns but different brokers cross-wire: B renders A's rows. **Fix:** fold provider/connection identity (providerId or wsUrl+clientId) into table + lock names.

### C-M7 (MAJOR) Perspective Apply reports success on failed connection
`perspective/src/controller.ts:248-302` (`bindConfig` never awaits `provider.ready()`), `provider.ts:292-303` (readyPromise rejection unobserved), `ext/src/modules/perspectiveDataProvider.ts:241-260` (hint unconditionally "Perspective SSRM bound"). **Fix:** await ready with timeout; surface phase error/disconnected through `onActiveChange` + panel hint; default-catch readyPromise.

### C-M8 (MAJOR) Shared book ignores edited connection config while referenced
`provider.ts:192-263` — book key `dp:${providerId}|${schemaKey}`; wsUrl/topics captured at first construction. **Fix:** include connection-config hash in key, or detect drift and rebuild/reconnect.

### C-m1 (MINOR) `client/hubConnection.ts:57-69` — every post() leaks its 60s timeout (never cleared on settle); no SharedWorker `onerror` fast-fail.
### C-m2 (MINOR) `hub/rowCache.ts:3-14` `composeRowId` — composite: missing fields become `''` (collide); `'-'` join ambiguous. **Fix:** null if any part missing; `' '` join.
### C-m3 (MINOR) Protocol has no remove/delete semantics (see C-C3 fix).
### C-m4 (MINOR) `DataServicesHub.ensureSlot :167-171` — any tab's ensure overwrites slot.config and rekeys the live cache while the transport keeps old config. **Fix:** ignore config changes for running slots (require explicit restart), or restart transport on config change.
### C-m5 (MINOR) `dataProviderController.ts:245-257` — 16ms gridReady poll up to 15s, not cancellable.
### C-m8 (MINOR) `snapshotTimeoutMs`, `reconnect.maxAttempts/maxDelayMs/jitter` typed (`types/transport.ts:37-44`) but never implemented — never-arriving end token = `snapshot` status forever.
### C-m9 (MINOR) `book.ts:598, 933-944` — `getRowsChains` entries never deleted for unregistered views.
### C-m10 (MINOR) `book.ts:636` — telemetry interval 4Hz forever even with no handler.
### C-m12 (MINOR) `perspectiveDataProvider.ts:226-235` — popout omits `hubOpts` (hub module passes them, `dataProvider.ts:236`).
### C-m13 (MINOR) Both provider modules' `onSaved`: saving the active provider doesn't rebind (no `controller.saveDefinition`) and the hint doesn't say so.

---

## Area D — VelocityGridExt

### D-F1 (CRIT) No error isolation in init/mount; throwing module leaks kernel Worker
`ext/src/velocityGridExt.ts:104-108`, `extension/registry.ts:39` (`initAll` bare loop), `shell/shell.ts:157-162` (mount loop). Ctor has no try/catch after `new VelocityGrid` (line 85). `element.ts` `connectedCallback` throw leaves `_instance` null → `disconnectedCallback` cleanup skipped. Note `disposeAll` (registry.ts:44-54) IS isolated. **Fix:** per-extension try/catch in initAll/mount (log + skip); ctor tail `try/catch → this._grid.destroy(); throw`.

### D-F2 (MAJOR) Fire-and-forget bootstrap races destroy
`velocityGridExt.ts:113` (`void this.profiles.bootstrap()`), `profiles/controller.ts:153-209` — no dispose/cancel; continuation after `await store.loadWorkspace()` applies to destroyed grid; late load overwrites user state (`setDirty(false)` at :187). **Fix:** `disposed` flag checked after every await in `runBootstrap`/`switchTo`/`save`; `profiles.dispose()` from `destroy()`.

### D-F3 (MAJOR) Shell spreads a class instance — prototype methods vanish
`shell/shell.ts:334-343` — `{...ctx.profiles}` copies own-enumerable only; `ProfilesController` methods live on the prototype; only `save`/`discard` survive via context monkey-patch (D-F14). Any module calling `ctx.profiles.isDirty()` throws. **Fix:** delegating wrapper (`Object.create(ctx.profiles, {...})` or explicit object).

### D-F4 (MAJOR) persist/restore asymmetry for custom ConfigSessions
`velocityGridExt.ts:191-229` — persist writes through any session; restore/has/clear special-case `instanceof LocalStorageConfigSession` else fall through to a localStorage key the custom session never wrote. **Fix:** duck-type on `loadWorkspaceSync` presence; add async `restorePersistedConfigAsync()` awaiting `session.loadWorkspace()`.

### D-F5 (MAJOR) Bootstrap clobbers persisted active-profile id
`profiles/controller.ts:180-195, 214-218` — never reads `store.getActiveProfileId()`; `syncActivePointer()` writes ctor `initialId` over stored `meta.id`; `discard()` can silently no-op (single-slot facade answers only active meta id, `configSession.ts:433`). **Fix:** adopt persisted pointer in bootstrap before syncing.

### D-F6 (MAJOR) Demo enables forbidden double-writer
`apps/cgrid-ext-demo/src/main.ts:234` `persistState: true` + ConfigSession vs `docs/velocity-grid-architecture.md:174`. **Fix:** drop from demo; ctor `console.warn` when both active.

### D-F7 (MAJOR) Ext reads kernel private `columnDefsMap`
`ext/src/modules/calculatedColumns.ts:96-137` casts to reach `velocityGrid.ts:1058 private columnDefsMap`. **Fix:** kernel public `getColumnDefsSnapshot()` / `upsertColumnDefs()`; delete casts.

### D-F8 (MAJOR) Engine discovery via `__editBridgeWired`/`__calcBridgeWired` expandos
`modules/editHandle.ts:5`, `modules/columnSettings.ts:56-63,92,118` — silent no-op (caption Save appears to succeed, header never changes) when calc not wired; three different missing-engine strategies across modules. **Fix:** `ctx.engines` DI map (`edit`/`calc`/`rules`) populated by the wires; one shared "engine missing" pattern.

### D-F9 (MINOR) Theme class mirrored onto container never removed (`velocityGridExt.ts:82-84`; `shell.destroy()` removes only `vgext-root`).
### D-F10 (MINOR) Registry sharp edges: `{id,factory}` spec ignores its own id; `'remove' in s` misroutes; late registration never inits (registry.ts:31-37).
### D-F11 (MINOR) Event bus emit not isolated — one throwing listener aborts delivery (`extension/context.ts:15`).
### D-F12 (MINOR) `normalizeInstanceDoc` silently downgrades future docVersions (`profiles/configSession.ts:217-247, 326-334`).
### D-F14 (MINOR) `createExtContext` monkey-patches shared controller (`extension/context.ts:25-34`) — root of D-F3; double-wraps if called twice. **Fix:** delegating wrapper.
### D-F15 (MINOR) Restore semantics differ by store type: ConfigSession path uses `setState(..., {exhaustive:true})`, plain ProfileStore path bare `setState` (`profiles/controller.ts:144,177,199`). **Fix:** unify on exhaustive.

---

## Test coverage gaps (targets for the plan's test tasks)

- No two-client hub lifecycle test (would catch C-C2/C-M1/C-C3b mechanically).
- Zero tests: `transports/stomp.ts`, `transports/rest.ts`, `ProviderClientAdapter` lifecycle, thinDeltas×conflation, RowCache composite keys.
- `packages/perspective/book.ts` (2,227 lines) untested: table lock, leaf-offset fast path, feed leadership, reconnect.
- SSRM: no test for omitted `rowCount` scrolling, LRU eviction, destroy-mid-fetch, v1 purge-vs-queued-soft ordering.
- Ext: no persistConfig/restore tests with custom ConfigSession; no destroy-during-bootstrap; no initAll-throw isolation; shell tests mock profiles as plain object (masks D-F3); no disconnect→reconnect element test.

## Explicitly OUT of scope for this branch

- Tier-6 structural refactors: velocityGrid.ts god-file seam extractions (RowDataMirror, ChunkIngest, Flash, TransactionFacade, CsrmBootstrap), worker PipelineRunner extraction. These are invariance-preserving refactors for a follow-up cycle — do NOT restructure while fixing.
- A-P3 incremental pipeline rebuild (design-accepted full rebuild), B-P4 skeleton-answered sticky ancestors, C-M8 book config drift detection (documented limitation), Excel-pivot/export scaffolds.
- D1 (applyTransaction sync result shape) — document-only.
