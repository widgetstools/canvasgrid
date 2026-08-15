# VelocityGrid Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every verified CRIT/MAJOR defect (plus batched MINORs) from the 2026-08-14 critical review so VelocityGrid's CSRM path, SSRM path, data plane, and ext shell are production-worthy: no silent wrong-data paths, no silent failures, working multi-tab lifecycle, bounded memory.

**Architecture:** Surgical fixes only — no structural refactors (tier-6 seams are explicitly out of scope; see spec). Each task is independently testable and committed separately. TDD: every behavioral fix lands with a failing test first where the harness permits.

**Tech Stack:** TypeScript monorepo (turborepo, npm workspaces), vitest (+ jsdom), packages: `@cgrid` kernel + `@wellsfargo-starui/velocity-grid-{data,ext,perspective}`.

**Spec:** `docs/superpowers/plans/2026-08-14-velocitygrid-production-hardening-spec.md` — READ IT FIRST. Every task cites finding IDs (e.g. A-C1) whose full defect traces + exact file:line anchors live there. Line numbers reference `main` @ f6da524.

## Global Constraints

- Branch: `fix/velocitygrid-production-hardening` (already created off latest main).
- Do NOT restructure files or extract subsystems — invariance-preserving fixes only.
- Never weaken `paintInvariance.spec.ts` or any existing passing test's assertions.
- Every task ends with: affected package's `npx vitest run` green (212+ ext / all kernel / all data tests), then commit.
- Worker protocol changes must stay append-only/versioned (existing convention in `worker/protocol.ts`).
- Hub protocol (`data/src/protocol/messages.ts`) is `v: 1` — additive optional fields only; old clients must keep working.
- Commit messages: conventional (`fix(kernel): …`, `fix(data): …`, `fix(ext): …`, `test(…): …`), each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Loud worker failures + green ext baseline

**Findings:** A-L1, spec "Baseline test-suite failures" (worker-terminated + drawImage unhandled rejections).

**Files:**
- Modify: `packages/kernel/src/worker/client.ts` (ctor/listen ~lines 30-120, `destroy` ~line 630)
- Modify: `packages/kernel/src/core/workerCoordinator.ts:115` region (destroy call site)
- Modify: `packages/kernel/src/renderer/` paint-present path (locate the async `drawImage` call rejecting in jsdom — trace via the ext test unhandled-rejection stack)
- Test: `packages/kernel/tests/workerClientErrors.test.ts` (new)

**Interfaces:**
- Produces: `WorkerClientHandlers.onError(err: Error, context: 'error' | 'messageerror' | 'init-timeout')` is now actually invoked; `WorkerClient.destroy()` no longer produces unhandled rejections.

- [ ] **Step 1: Failing tests.** In `workerClientErrors.test.ts`, with a stub Worker object (`{addEventListener, postMessage, terminate}`): (a) assert constructing `WorkerClient` registers `error` and `messageerror` listeners (record calls); (b) fire the recorded `error` listener → assert `handlers.onError` called and all pending request promises reject; (c) call `request()` then `destroy()` → attach `.catch` after — assert no `unhandledRejection` is emitted on `process` during a tick (install a temporary `process.on('unhandledRejection')` spy).
- [ ] **Step 2: Run; expect FAIL** (`no listener registered`, `onError never called`).
- [ ] **Step 3: Implement.** In `WorkerClient`: register both listeners in the constructor; on either event, invoke `handlers.onError`, reject every entry in `pending` with a descriptive Error, and clear `pending`. In `destroy()` (line ~636): before rejecting pending promises, mark each stored promise as handled (`p.catch(() => {})` on the internal reference) OR route rejection through a shared `settlePending(err)` that attaches a default catch — the public caller-facing promise still rejects, but the client-internal reference never becomes an unhandled rejection. Add an init timeout: if the `init` round-trip hasn't resolved within 10s, call `handlers.onError(new Error('VelocityGrid worker failed to initialize …'), 'init-timeout')` and log via `console.error` (the grid currently has no error event on this path — console.error is the loud-failure floor).
- [ ] **Step 4: Fix the drawImage rejection.** Reproduce with `cd packages/ext && npx vitest run 2>&1 | grep -B2 drawImage`; trace the async paint call (raster/paint-cache present path) and wrap the jsdom-incompatible call: feature-detect `typeof ctx.drawImage === 'function'` at layer init (disable the blit layer when absent) or catch-and-disable on first failure with a single console.warn. Must not change behavior in real browsers.
- [ ] **Step 5: Verify.** `cd packages/kernel && npx vitest run` green; `cd packages/ext && npx vitest run` → exit code 0, zero "Unhandled" lines in output.
- [ ] **Step 6: Commit** `fix(kernel): surface worker errors loudly, stop destroy/paint unhandled rejections`.

---

### Task 2: Shared grouped-index resolver in the worker

**Findings:** A-C1 (CRIT — wrong-row copy/fill/edit/scroll under grouping).

**Files:**
- Create: `packages/kernel/src/worker/visibleIndexResolver.ts`
- Modify: `packages/kernel/src/worker/handlers/viewport.ts` (cases `getRowIndexForId` :38-43, `getRowByIndex` :45-56, `getRowIndicesForIds` :58-88, autosize `textOf` :346-354)
- Modify: `packages/kernel/src/worker/handlers/clipboard.ts:33-45`
- Test: `packages/kernel/tests/visibleIndexResolver.test.ts` (new), extend existing worker/clipboard test files

**Interfaces:**
- Produces:
  ```ts
  export interface VisibleIndexResolver {
    length: number;
    leafIdAt(visibleIndex: number): string | null;   // null for group-header rows / out of range
    indexOfLeafId(rowId: string): number;            // -1 when absent/collapsed
  }
  export async function buildVisibleIndexResolver(ctx: HandlerCtx): Promise<VisibleIndexResolver>;
  ```
  Grouping active → built from `computeGroupVisibleOrder(state.groupOutput.flatOrder, helpers.effectiveExpandedKeys(), state.groupHideOpenParents)` + `state.groupInputIds` (exactly the translation `getRowIndicesForIds` already does at viewport.ts:62-75); otherwise → flat `helpers.visibleAsync()` array.

- [ ] **Step 1: Failing unit test.** Build a fake `HandlerCtx` (mirror the fixtures the existing worker handler tests use — find them via `grep -rl "HandlerCtx" packages/kernel/tests`). With grouping active (2 groups, first collapsed): assert `leafIdAt` skips the group-header slots and collapsed leaves, and `indexOfLeafId` returns the group-visible position; flat mode: assert passthrough.
- [ ] **Step 2: Run; expect FAIL** (module not found).
- [ ] **Step 3: Implement `visibleIndexResolver.ts`** per the interface above; internally build the id→index Map once (O(visible)).
- [ ] **Step 4: Failing integration tests.** In the worker handler tests: with grouping active, (a) `getRowByIndex` on a visible index *after* a group header returns that row's data, not the offset-by-header row; (b) `getRowIndexForId` returns the group-visible index; (c) `clipboardSerialize` over a range spanning a group header serializes the correct leaf rows; (d) autosize width computation reads the correct rows.
- [ ] **Step 5: Route all four endpoints through the resolver** whenever `helpers.isGroupingActive()`; refactor `getRowIndicesForIds` to consume it too (single source of truth). `getRowByIndex` on a group-header index → `{rowId: null, data: null}` (current not-found shape).
- [ ] **Step 6: Run kernel suite green; commit** `fix(kernel): resolve visible row indices through one grouping-aware resolver`.

---

### Task 3: CSRM worker correctness batch

**Findings:** A-C2 (queue survives setRowData), A-C3 (pipeline single-flight), A-C6 (grouped calc sort), A-C5 (dead seq + fetch-error range reset), A-D3 (swallowed init pushes).

**Files:**
- Modify: `packages/kernel/src/worker/handlers/dataPipeline.ts:79-119` (setRowData case; also reset-hydrate case)
- Modify: `packages/kernel/src/worker/worker.ts:320-326` + `buildVisibleAsync` entry (`visibleAsync` helper)
- Modify: `packages/kernel/src/worker/passes/sortPass.ts:376`
- Modify: `packages/kernel/src/core/viewportManager.ts:667-676, 710-714`; `packages/kernel/src/velocityGrid.ts:11349-11354` (seq guard), `:3338,3345,3352` (catches)
- Test: extend the existing worker pipeline/sort test files; add cases in `packages/kernel/tests/`

- [ ] **Step 1 (A-C2): Failing test** — enqueue `applyTransactionAsync({add:[X]})` (do not advance timers past the debounce), then `setRowData(newRows)`, then advance timers: assert store contents equal `newRows` exactly (X absent) and no late `modelUpdated` mentions X.
- [ ] **Step 2: Implement** — `setRowData` and reset-hydrate handlers call a new `TransactionQueue.discardPending()` (clears rows + timer) before `setAll`.
- [ ] **Step 3 (A-C3): Failing test** — configure `externalFilterPresent`; hold the main-thread reply; issue two concurrent `getViewport`s; assert `buildVisibleAsync` body ran once (spy/counter) and both got the same result.
- [ ] **Step 4: Implement single-flight** — replace the null-check pattern with `state.visibleCachePromise`: if present, await it; else create it (the whole `buildVisibleAsync` call), clear it on completion, null it in every invalidation site that currently nulls `visibleCache` (grep `visibleCache = null`).
- [ ] **Step 5 (A-C6): Failing test** — grouped grid + text calc column sort → assert leaf order actually sorted (currently unsorted). **Implement:** `if (!r.col) continue;` at sortPass.ts:376.
- [ ] **Step 6 (A-C5): Implement** — delete `viewportReqSeq` plumbing (guard is unreachable — verify by grep before deleting; keep the intersection check and add a comment naming it as the staleness mechanism). In `dispatchRequest`'s catch: clear `lastDispatchedRange`/`lastDispatchedCols` so a retry re-covers the window; add a test that a rejected fetch followed by the same-range request re-dispatches.
- [ ] **Step 7 (A-D3): Implement** — replace `.catch(() => {})` at velocityGrid.ts:3338/3345/3352 with `.catch((e) => console.error('[VelocityGrid] init model push failed:', e))`.
- [ ] **Step 8: Kernel suite green; commit** `fix(kernel): drain txn queue on reset, single-flight pipeline, grouped calc sort, fetch-error recovery`.

---

### Task 4: Escape group composite key separators (all three vocabularies)

**Findings:** A-C7, B-C7/spec A-C7 cross-refs (groupPass, ssrmRowMeta, perspective ssrmGroupTree).

**Files:**
- Modify: `packages/kernel/src/worker/passes/groupPass.ts:26-27`; `packages/kernel/src/core/ssrmRowMeta.ts:119-143`; `packages/kernel/src/velocityGrid.ts:5962` (depth via split)
- Modify: `packages/perspective/src/ssrmGroupTree.ts:13-28` (`parseCompositeGroupKey`)
- Test: new cases in the respective existing test files (groupPass tests, ssrm meta tests, perspective ssrmGroupTree tests)

**Interfaces:**
- Produces (kernel): `escapeGroupKeySegment(s: string): string` / `splitGroupKey(key: string): string[]` exported beside the key builders — `%` → `%25`, `:` → `%3A` per segment; join stays `::`. Depth/parse must use `splitGroupKey`, never `key.split('::')`.

- [ ] **Step 1: Failing tests** — group values `"AB::CD"` and `"X:Y"`: assert two distinct groups whose keys round-trip (build → split → original values), correct depth, expansion toggling targets the right group; same shape for ssrmRowMeta composite keys and perspective `parseCompositeGroupKey`.
- [ ] **Step 2: Implement** in all three places (kernel shares one helper; perspective gets a local copy — no new cross-package dependency).
- [ ] **Step 3: Grep for other `split('::')` / `split(':')` consumers of these keys** (`grep -rn "'::'" packages/kernel/src packages/perspective/src`) and route them through the split helper.
- [ ] **Step 4: Suites green (kernel + perspective); commit** `fix: escape group-key separators across csrm/ssrm/perspective key vocabularies`.

---

### Task 5: Hub push protocol add/update/remove + bind/adapter diffing

**Findings:** C-C3 (CRIT — invisible adds, restart truncation), C-m3 (no removes), A-P8 (mergeTicks Map rebuild).

**Files:**
- Modify: `packages/data/src/protocol/messages.ts` (HubPush)
- Modify: `packages/data/src/hub/DataServicesHub.ts` (`fanOutReplace` :337-361, live fan-out)
- Modify: `packages/data/src/client/ProviderClientAdapter.ts` (push mapping :55-96, cache)
- Modify: `packages/data/src/client/bind.ts`
- Modify: `packages/data/src/types/*` if `IDataProvider` tick callback shape must carry adds/removes
- Test: `packages/data/tests/hubPushSemantics.test.ts` (new), extend `data/tests/hub-csrm.test.ts`

**Interfaces:**
- Produces (protocol — additive, old fields keep working):
  ```ts
  | { v: 1; type: 'push'; providerId: string; subId?: string;
      rows: unknown[] | ColumnarBatch;
      replace?: boolean;
      /** NEW: replace continuation chunk — apply as append to the replace in progress, not as ticks. */
      seq?: number; final?: boolean;
      /** NEW: row ids removed upstream. */
      removes?: string[]; }
  ```
- Produces (client): `IDataProvider.onTick` continues to exist; new optional `onDelta?(d: { adds: T[]; updates: T[]; removes: string[] }): void` subscription on the adapter; `bindProviderToGrid` prefers `onDelta` when available.

- [ ] **Step 1: Failing test (restart truncation)** — in-process hub + mock transport with 1200 rows, `snapshotChunkSize: 500`, two clients attached; trigger `restart`; assert BOTH clients' bound grids end with 1200 rows (today the remote one has 500).
- [ ] **Step 2: Failing test (invisible adds)** — snapshot of 3 rows; tick containing 1 update + 1 brand-new id; assert bound grid received the new row as an `add` (4 rows total).
- [ ] **Step 3: Implement hub side** — `fanOutReplace` stamps `replace: true, seq, final` on every chunk of one replace sequence; live pipeline fan-out includes `removes` when the transport reported them (transports without removes just never set it).
- [ ] **Step 4: Implement adapter** — hold cache as a persistent `Map` (fixes A-P8: `mergeTicks` mutates the Map, no rebuild). Push handling: `replace && seq===0 (or undefined)` → cache.replace + emit snapshot; `replace && seq>0` → cache.append + emit delta `{adds: chunkRows}`; non-replace → diff against Map membership → `{adds, updates, removes}` → emit via `onDelta` (and keep legacy `onTick(updates.concat(adds))` for backward compat).
- [ ] **Step 5: Implement bind** — subscribe `onDelta` when present: `grid.applyTransactionAsync?.({ add: adds, update: updates, remove: removes })` (extend `CsrmBindableGrid.applyTransactionAsync` tx type to `{ add?; update?; remove? }`); verify the kernel worker transaction handler accepts add/update/remove in one async tx (it does for `applyTransaction` — confirm async path, extend if the async payload type is update-only).
- [ ] **Step 6: Both failing tests pass; whole data-package suite green; commit** `fix(data): add/append/remove push semantics — adds paint, restarts no longer truncate remote tabs`.

---

### Task 6: Shared-consumer lifecycle (hub ports, detach vs stop)

**Findings:** C-C2 (CRIT switch kills all tabs), C-M1 (detach leak), C-C1 (CRIT dead ports), C-m1 (hubConnection timer leak), C-m5 (uncancellable poll), C-m4 (ensure config overwrite).

**Files:**
- Modify: `packages/ext/src/modules/dataProviderController.ts:340-348` (stopCurrent) + `:245-257` (poll)
- Modify: `packages/data/src/client/ProviderClientAdapter.ts:105-108, 176-187`
- Modify: `packages/data/src/hub/DataServicesHub.ts` (`stopSlot` :244-254, `addPort`/`removePort` :54-67, `broadcast` :384-390, `ensureSlot` :167-171)
- Modify: `packages/data/src/client/hubConnection.ts:57-69` + connect path; `packages/data/src/worker.ts:10-14`
- Modify: `packages/data/src/protocol/messages.ts` (add `{type:'bye'}` request + heartbeat ping semantics)
- Test: `packages/data/tests/hubLifecycle.test.ts` (new two-client suite), extend `packages/ext/tests/dataProviderModule.test.ts`

**Interfaces:**
- Produces: `ProviderClientAdapter` tracks `attached` separately from `started`; `destroy()` always sends `detach` when attached. `DataServicesHub.stopSlot(providerId, opts?: { force?: boolean })` — transport actually stops only on explicit force (Diagnostics Stop) or when the last subscriber detaches after a 30s grace timer. Hub pings ports every 15s; a port missing 2 consecutive pongs (or throwing on post) is evicted via `removePort`.

- [ ] **Step 1: Failing test (switch keeps others alive)** — two clients on provider P; client A runs the controller switch path (detach); assert client B still receives subsequent ticks and slot status stays `ready`.
- [ ] **Step 2: Failing test (detach on destroy)** — attach, `stop()`, `destroy()`; assert hub subscriber count for the slot is 0 (expose via existing `getStats`).
- [ ] **Step 3: Failing test (dead port reaping)** — simulate a port whose `postMessage` throws (closed); after one broadcast + heartbeat cycle assert the port and its subscribers are pruned.
- [ ] **Step 4: Implement** — controller `stopCurrent` on switch: `provider.destroy()` only (detach), no `stop()`; explicit Diagnostics Stop keeps `stop()` → `stopSlot(id, {force:true})`. Adapter: `attached` flag; always detach in destroy. Hub: heartbeat interval + post-failure pruning + last-subscriber grace stop; `hubConnection` sends `bye` on `pagehide` and clears each request's 60s timer on settle (store timer handle beside the pending entry). `ensureSlot`: if the slot's transport is running and the incoming config differs, keep the running config and log — config changes require explicit restart.
- [ ] **Step 5: Cancelable poll** — `dataProviderController` gridReady poll stores its timer and clears on module dispose/controller destroy.
- [ ] **Step 6: data + ext suites green; commit** `fix(data): working multi-consumer lifecycle — detach-not-stop, always-detach, dead-port reaping`.

---

### Task 7: STOMP + REST transport hardening

**Findings:** C-M2 (end-token substring), C-M3 (reconnect wedge), C-m8 (unimplemented timeout/reconnect opts), C-M5 (REST stop/restart/stale).

**Files:**
- Modify: `packages/data/src/transports/stomp.ts` (whole file, 113 lines)
- Modify: `packages/data/src/transports/rest.ts` (whole file, 71 lines)
- Reference: `packages/perspective/src/book.ts:2072-2085` (correct end-token matcher — mirror it exactly)
- Test: `packages/data/tests/stompTransport.test.ts`, `packages/data/tests/restTransport.test.ts` (both new; inject fake stomp client / fake fetch)

- [ ] **Step 1: Failing tests (STOMP)** — (a) data frame whose body contains `"status":"SUCCESS"` mid-snapshot: assert rows are ingested and snapshot does NOT complete; exact token frame / `token:`-prefixed frame: assert completion; (b) simulate `onWebSocketClose` then `onConnect` again: assert status goes `snapshot` → (end token) → `ready` again and first re-snapshot batch is emitted with `replace: true`; (c) `snapshotTimeoutMs: 50` with no end token: assert status becomes `error` with a descriptive message after the timeout.
- [ ] **Step 2: Implement STOMP** — port book.ts matcher (exact match or `${token}:` prefix, trimmed frame); move `snapshotComplete`/`received` reset into `onConnect`; first batch after re-snapshot carries `replace: true`; honor `snapshotTimeoutMs` (timer from snapshot start → error status) and `reconnect.maxAttempts/maxDelayMs` (configure stompjs `reconnectDelay`, count attempts in `onWebSocketClose`, deactivate + `error` status past max).
- [ ] **Step 3: Failing tests (REST)** — (a) `stop()` mid-fetch: assert no status/rows emitted after stop (AbortController); (b) `restart()` on a polling config: assert polling resumes; (c) two overlapping polls where the older resolves last: assert newer data wins (generation counter).
- [ ] **Step 4: Implement REST** — per-activation generation counter + `AbortController` stored on the transport; `stop()` aborts + bumps generation; `restart()` re-arms the interval; responses check their generation before emitting. Populate `TransportContext.signal` while you're there.
- [ ] **Step 5: data suite green; commit** `fix(data): harden stomp/rest transports — exact end token, reconnect reset, abortable rest`.

---

### Task 8: Conflation merge + composite row keys

**Findings:** C-M4 (thin-delta × conflation loses fields), C-m2 (composite key '' collisions).

**Files:**
- Modify: `packages/data/src/hub/rowCache.ts` (`LivePipeline.push` :93-96, `composeRowId` :3-14)
- Test: `packages/data/tests/rowCache.test.ts` (new or extend)

- [ ] **Step 1: Failing tests** — (a) `LivePipeline` with conflation+throttle: push `{id:'r1', px: 2}` then `{id:'r1', qty: 5}` in one window; assert flush delivers one row containing BOTH `px` and `qty`; (b) `composeRowId` with composite key `['a','b']` and a row missing `b`: assert `null` (today `'x-'`); (c) rows `{a:'A-B', b:'C'}` vs `{a:'A', b:'B-C'}`: assert distinct ids.
- [ ] **Step 2: Implement** — conflation: `this.pending.set(id, { ...this.pending.get(id), ...row })`. `composeRowId` composite: `null` if any part is nullish; join with `''` (unit separator).
- [ ] **Step 3: Check key-format consumers** — grep for persisted/compared row ids that would break on the join change (`grep -rn "join('-')" packages/data/src`); hub row ids are runtime-only (cache + wire), so no migration expected — verify and note in the commit message.
- [ ] **Step 4: data suite green; commit** `fix(data): merge conflated partial ticks; unambiguous composite row keys`.

---

### Task 9: Perspective failure surfacing + shared-table identity

**Findings:** C-M7 (Apply lies), C-M6 (cross-provider table bleed), C-m9/m10 (book leaks), C-m12/m13 (popout hubOpts, onSaved rebind hint).

**Files:**
- Modify: `packages/perspective/src/controller.ts:248-302` (bindConfig), `provider.ts:292-303` (readyPromise), `bootstrap.ts:111-127` (tableNameForSchema), `book.ts:710-712` (feedLockName), `book.ts:598,933-944` (getRowsChains), `book.ts:636` (telemetry)
- Modify: `packages/ext/src/modules/perspectiveDataProvider.ts:226-260`
- Test: `packages/perspective/tests/controllerBind.test.ts` (new), `packages/perspective/tests/tableIdentity.test.ts` (new)

- [ ] **Step 1: Failing test (Apply honesty)** — fake provider whose `ready()` rejects: assert `bindConfig` reports failure through `onActiveChange` (error state) and the returned promise rejects with the cause; no unhandledRejection (readyPromise carries a default catch while still propagating to awaiters).
- [ ] **Step 2: Implement** — `bindConfig` awaits `provider.ready()` under a timeout (use the existing `withTimeout` helper in `bootstrap.ts`; 20s default); on failure: release refs, surface `{ phase: 'error', message }` via `onActiveChange`. In `perspectiveDataProvider.ts`: hint prints "bound" only on resolved success; failure → the error message. Add `hubOpts` passthrough to the popout (m12) and a "saved — re-Apply to rebind" hint when saving the active provider (m13).
- [ ] **Step 3: Failing test (table identity)** — two configs, identical columnDefinitions, different `websocketUrl`: assert distinct table names and lock names.
- [ ] **Step 4: Implement** — fold a short hash of `(providerId, websocketUrl, listenerTopic/clientId)` into `tableNameForSchema` and `feedLockName`.
- [ ] **Step 5: Book hygiene** — delete `getRowsChains` entry on view unregister; start the telemetry interval only while an `onTelemetry` handler is registered.
- [ ] **Step 6: perspective + ext suites green; commit** `fix(perspective): honest Apply, provider-scoped shared tables, book leak hygiene`.

---

### Task 10: SSRM v1 decommission + unknown rowCount + getRowId relaxation

**Findings:** B-v1-decommission (kills B-C1/C2/C5/L1), B-C3, B-A4, B-A6.

**Files:**
- Modify: `packages/kernel/src/velocityGrid.ts:3702-3714` (mount selection), `:403-413` (inferRowIdField), `:3850-3857` (controller opts)
- Modify: `packages/kernel/src/core/serverSideRowModelV2.ts:947-949` (rowCount inference)
- Delete: `packages/kernel/src/core/serverSideRowModel.ts` (after migration)
- Modify: `packages/kernel/src/types/options.ts` (add `serverSideMaxCachedLeafBlocks?: number`; deprecate `expandedGroupKeys` request fields)
- Test: migrate `packages/kernel/tests/ssrmBlockInvalidation.test.ts` (4 v1 tests) to drive the v2 flat path; new `packages/kernel/tests/ssrmUnknownRowCount.test.ts`

- [ ] **Step 1: Reachability check** — `grep -rn "serverSideRowModel'" packages apps` (exclude V2) to confirm only the mount site + tests reference v1. If any app consumer surfaces, STOP and report instead of deleting.
- [ ] **Step 2: Failing test (unknown rowCount)** — v2 flat datasource that never returns `rowCount` and serves 3 full blocks: scroll to the loaded edge; assert a request for the next block fires (over-allocation) and that a short final block clamps `rowCount` exactly and stops further requests.
- [ ] **Step 3: Implement** — v2 flat: when `success` omits `rowCount`, set `rowCount = startRow + rowData.length + blockSize` flagged `rowCountEstimated = true`; a short block (`rowData.length < requested`) sets exact count and clears the flag. Verify the flag isn't misread by the footer/status-bar row-count consumers (grep `rowCount` usages in status bar).
- [ ] **Step 4: Mount v2 always** — getRows-only datasources mount `ServerSideRowModelV2Controller` flat; datasource objects carrying the v1 grouped shape (`expandedGroupKeys` usage / no `getGroupSkeleton`) with grouping requested → `throw new Error('VelocityGrid SSRM: grouped server-side data requires getGroupSkeleton (v2). The v1 expandedGroupKeys protocol was removed.')`. Migrate the 4 `ssrmBlockInvalidation` tests to the v2 flat path (same scenarios, v2 controller); then delete `serverSideRowModel.ts` and prune its exports/types.
- [ ] **Step 5: getRowId relaxation (B-A4)** — `inferRowIdField` fallback: when pattern-match fails, don't throw; evaluate `getRowId(row)` per row during hydrate, inject as synthetic `__vgRowId` field, and use that as the id field. Test: datasource with `getRowId: r => r.a + ':' + r.b` mounts and hydrates.
- [ ] **Step 6: Expose `serverSideMaxCachedLeafBlocks`** in GridOptions → passed by `mountSsrmController`; test that a small cap evicts (assert controller block count bounded).
- [ ] **Step 7: Kernel suite green (all `ssrm*.test.ts`); commit** `feat(kernel)!: decommission SSRM v1 — v2 everywhere, unknown-rowCount scrolling, arbitrary getRowId`.

---

### Task 11: SSRM v2 robustness

**Findings:** B-C4 (off-chain reflow hydrate), B-C6 (detached cache write), B-C8 (retry backoff), B-L3 (refill timer), B-P5 (waitUntil polling).

**Files:**
- Modify: `packages/kernel/src/core/serverSideRowModelV2.ts` (`refreshExpansion` :252-261, `loadLeafBlock.success` :683-699, failed-block selection :603, `waitUntil`)
- Modify: `packages/kernel/src/velocityGrid.ts:9538-9545` (destroy timers)
- Test: extend `packages/kernel/tests/ssrmV2Reorder.test.ts` fake-worker harness + targeted unit tests

- [ ] **Step 1: Failing test (B-C6)** — group leaf fetch in flight; soft refresh changes leafCount → `dropGroupCache`; resolve the fetch; assert the block lands in the CURRENT cache map (visible on next ensureRange without a refetch).
- [ ] **Step 2: Implement** — success handler re-resolves `this.leafCaches.get(node.key)`; discard if the node is gone.
- [ ] **Step 3: Implement single hydrate dispatcher (B-C4)** — all `hydrateWindow` posts route through one method that captures the current index/generation token and no-ops if the token changed by send time; `refreshExpansion`'s fire-and-forget path uses it. Test: toggle expansion while a chain hydrate is in flight → assert no hydrate with the stale rowCount is posted (spy on posted messages).
- [ ] **Step 4: Retry backoff (B-C8)** — per-block `failCount` + `nextRetryAt` (exponential: 1s/4s/15s, cap 60s); `ensureRange` skips blocks whose retry window hasn't elapsed; success resets. Test with a datasource failing twice then succeeding: assert 3 total fetches, spaced (fake timers).
- [ ] **Step 5: Small fixes** — clear `ssrmColumnRefillTimer` in destroy; replace `waitUntil` 4ms polling with a promise the state-transition sites resolve.
- [ ] **Step 6: Kernel suite green; commit** `fix(kernel): ssrm v2 — serialized hydrates, live cache writes, block retry backoff`.

---

### Task 12: Memory bounds (eviction propagation, id maps, background flush, mirror gating)

**Findings:** B-L2 (eviction doesn't propagate), A-L3 (id maps), A-L4 (destroy mirror), A-L5 (O(k·n) remove), A-L2 (rAF stall), A-P5 (mirror gating).

**Files:**
- Modify: `packages/kernel/src/core/serverSideRowModelV2.ts` (evict path :729-758), `packages/kernel/src/worker/dataPipeline.ts` (RowStore :51-115), `packages/kernel/src/worker/client.ts:86-93`, `packages/kernel/src/velocityGrid.ts` (mirror sites :4180-4183, :4319-4378; destroy :9526-9658)
- Modify: `packages/kernel/src/worker/protocol.ts` (append-only: evict message)
- Test: new cases in kernel suites (fake timers for L2; store unit tests for L3/L5)

- [ ] **Step 1 (B-L2): Failing test** — v2 with `maxCachedLeafBlocks: 2`, scroll through 5 blocks: assert worker store row count and `rowDataById` size stay bounded to ~2 blocks + viewport, not 5.
- [ ] **Step 2: Implement** — eviction collects evicted row ids → posts a (new, append-only) `ssrmEvict {rowIds}` worker message that removes from the store WITHOUT touching `ssrmOrder` slots for rows still in-window (evicted rows are outside the loaded band by construction — assert in a debug check), and deletes the same ids from `rowDataById`.
- [ ] **Step 3 (A-L3/L5): Failing unit tests** — repeated `setAll` with disjoint id sets: assert `stringToNumeric.size` tracks live rows; `remove` of 10k ids from 100k: single compaction (assert order correctness; time-bound loosely).
- [ ] **Step 4: Implement** — `setAll` rebuilds the id maps from the new rows; `apply`'s remove branch collects removed ids into a Set and compacts `order` in one filter pass; drop id-map entries for removed ids.
- [ ] **Step 5 (A-L2): Implement** — `scheduleFlush`: rAF raced with 50ms `setTimeout` (first wins, cancel the other); when `document.visibilityState === 'hidden'`, skip rAF entirely. Test with fake rAF that never fires: assert flush still happens.
- [ ] **Step 6 (A-L4): Implement** — destroy clears `rowDataById`, `knownGroupKeys`, `groupDescendants`.
- [ ] **Step 7 (A-P5): Implement mirror gating** — compute `mirrorMode` at construction: full mirror iff any of `alwaysPassFilter`/`doesExternalFilterPass`/`postSortRows` configured, a rules engine registered that reads row data on main, or `options.mainRowMirror === true` (new option, default auto). Additionally flip to full (with a one-time worker snapshot backfill via the existing getSnapshot/export round-trip — check `worker/export` handlers for a bulk row fetch) when the first `rowsChanged` listener subscribes. When gated off, `getRowDataById` falls back to the async worker `getRowById` path — audit its ~6 call sites (grep `rowDataById.get`) and keep sync behavior wherever a sync consumer exists by keeping those features in the "needs mirror" set. Be conservative: if auditing shows a sync consumer that can't be gated, leave the mirror ON for that configuration and document.
- [ ] **Step 8: Full kernel + ext suites green; commit** `perf(kernel): bound memory — eviction propagation, id-map hygiene, background flush, gated row mirror`.

---

### Task 13: CSRM perf quick wins

**Findings:** A-P1 (agg per fetch), A-P2 (grouped walks per fetch), A-P4 (Fenwick realloc), A-P6 (alwaysPass per txn), A-P7 (write-only LRU).

**Files:**
- Modify: `packages/kernel/src/worker/handlers/viewport.ts:109-115, 239-282`, `packages/kernel/src/worker/worker.ts:475-501`
- Modify: `packages/kernel/src/velocityGrid.ts:3228-3229, 4230, 4274, 4411-4429, 11372-11381`
- Test: extend worker viewport handler tests; assertion-by-spy on recompute counts

- [ ] **Step 1 (A-P1): Failing test** — two consecutive `getViewport`s with no data change: assert `state.agg.apply` ran once (spy). **Implement:** cache `{totals, groupTotals}` keyed on the `visibleCache` array reference (WeakMap or identity field); nulled cache → recompute.
- [ ] **Step 2 (A-P2): Failing test** — same double-fetch under grouping: `computeGroupVisibleOrder` runs once. **Implement:** memoize visibleOrder + metaLookup keyed on (`groupOutput` reference, `expandedKeys` reference/revision); make `computeStickyAncestors` consume the cached order and start from the previous boundary when the scroll delta is small, else full walk (correctness first — cache only, incremental optional).
- [ ] **Step 3 (A-P4): Implement** — track `hasCustomRowHeights` (any non-fallback height seen via heights push or per-row height option); when false, skip `RowHeightIndex` construction entirely (uniform math: `index = y / rowHeight`); construct lazily on first custom height. Verify scroll math call sites handle the no-index path (grep `rowHeightIndex`).
- [ ] **Step 4 (A-P6): Implement** — debounce `recomputeAlwaysPass` (50ms trailing), and pass the transaction's touched rows to evaluate only those + diff against the current always-pass set; ship only on change.
- [ ] **Step 5 (A-P7): Implement** — delete `chunkLRU` + `estimateChunkBytes` write path (grep first to confirm no reader).
- [ ] **Step 6: Kernel suite + `paintInvariance.spec.ts` green; commit** `perf(kernel): cache per-generation aggregates/grouped order, uniform-height fast path`.

---

### Task 14: VelocityGridExt hardening

**Findings:** D-F1 (CRIT init isolation), D-F2 (bootstrap race), D-F3+F14+F5 (profiles seam), D-F4 (ConfigSession asymmetry), D-F6 (demo double-writer), D-F9 (theme class), D-F11 (bus isolation), D-F15 (restore semantics), D-F10 partial (registry id mismatch warn).

**Files:**
- Modify: `packages/ext/src/velocityGridExt.ts` (ctor :85-113, persist trio :191-229, destroy :255-268, theme :82-84)
- Modify: `packages/ext/src/extension/registry.ts:31-54`, `extension/context.ts:15-34`, `shell/shell.ts:334-343`
- Modify: `packages/ext/src/profiles/controller.ts` (bootstrap :153-218, dispose, exhaustive :144/177/199)
- Modify: `apps/cgrid-ext-demo/src/main.ts:234`
- Test: extend `packages/ext/tests/{velocityGridExt,registry,shell,configSession}.test.ts`; new `packages/ext/tests/profilesLifecycle.test.ts`

- [ ] **Step 1 (D-F1): Failing tests** — (a) extension whose `init` throws: assert remaining extensions still init, shell mounts, grid works, error logged; (b) make `shell` construction throw (mock): assert the kernel grid's `destroy()` was called (no leaked Worker) and the ctor rethrows.
- [ ] **Step 2: Implement** — per-extension try/catch in `initAll` and the shell mount loop (mirror `disposeAll`'s pattern + comment); ctor tail wrapped: `catch (e) { try { this._grid.destroy(); } catch {} throw e; }`.
- [ ] **Step 3 (D-F2): Failing test** — construct ext with a ConfigSession whose `loadWorkspace` resolves after `destroy()`: assert no grid method is called post-destroy and no unhandled rejection. **Implement:** `ProfilesController.dispose()` sets `disposed`; every continuation after an `await` in `runBootstrap`/`switchTo`/`save`/`saveAs` early-returns when disposed; `VelocityGridExt.destroy()` calls it first.
- [ ] **Step 4 (D-F3/F14/F5): Failing tests** — (a) module ctx: `for (const m of ['isDirty','activeId','saveAs','switchTo','rename','remove','list'])` assert `typeof moduleCtx.profiles[m] === 'function'`; (b) bootstrap with a stored doc whose `meta.id !== initialId`: assert active id adopts the stored id (and `discard()` actually reverts). **Implement:** replace the spread at shell.ts:334-343 with `Object.create(ctx.profiles, { markDirty: { value: () => { ctx.profiles.markDirty(); ctx.session.stage(id); } } })`; delete the monkey-patching in `createExtContext` (wrap the same way there for save/discard); bootstrap reads `store.getActiveProfileId()` (fallback `meta.id` from the loaded doc) before `syncActivePointer()`.
- [ ] **Step 5 (D-F4): Failing test** — custom in-memory async ConfigSession (no `loadWorkspaceSync`): `persistConfig()` then new ext instance `restorePersistedConfigAsync()` → state restored; `hasPersistedConfig`/`clearPersistedConfig` operate on the session. **Implement:** capability checks (`typeof session.loadWorkspaceSync === 'function'`) instead of `instanceof`; add `restorePersistedConfigAsync(): Promise<boolean>` awaiting `session.loadWorkspace()`; sync `restorePersistedConfig` keeps working for sync-capable sessions and returns false (with a one-time console.warn naming the async variant) otherwise.
- [ ] **Step 6 (smalls):** theme class remembered + removed in destroy (D-F9); event-bus emit wraps each listener in try/catch (D-F11); registry warns on `spec.id !== instance.id` (D-F10); unify plain-ProfileStore restore/switch on `setState(..., {exhaustive: true})` (D-F15) — check existing tests for non-exhaustive expectations first; demo drops `persistState: true` + ctor `console.warn` when both writers active (D-F6).
- [ ] **Step 7: ext suite green (all 212+ new, exit 0); commit** `fix(ext): isolated init, cancellable bootstrap, sound profiles seam, pluggable config sessions`.

---

### Task 15: Kernel boundary + engine DI slots

**Findings:** D-F7 (ext reads kernel private `columnDefsMap`), D-F8 (expando engine discovery → silent no-ops), D-F12 (docVersion downgrade).

**Files:**
- Modify: `packages/kernel/src/velocityGrid.ts` (public API near :1058 map + `types/api.ts`)
- Modify: `packages/ext/src/extension/types.ts` (context type), `extension/context.ts`
- Modify: `packages/ext/src/modules/calculatedColumns.ts:96-137`, `modules/editHandle.ts:5`, `modules/columnSettings.ts:56-118`, `modules/alerts.ts:106`, `modules/conditionalStyling.ts`, `modules/smartEdit.ts`, `modules/shortcuts.ts` (engine lookups only)
- Modify: `packages/ext/src/profiles/configSession.ts:217-247` (docVersion guard)
- Test: extend `packages/ext/tests/{columnSettings,configSession}.test.ts`; new kernel test for the column-defs API

**Interfaces:**
- Produces (kernel public API): `getColumnDefsSnapshot(): ColumnDef[]` (deep-ish copy of resolved defs) and `upsertColumnDefs(defs: ColumnDef[]): void` on `VelocityGrid` + `types/api.ts`.
- Produces (ext): `VelocityGridExtContext.engines: { edit?: unknown; calc?: unknown; rules?: unknown }` — populated by the `wire*` functions (each wire sets its slot when called with the grid that belongs to this ext context; the ext ctor exposes a registration hook the wires can reach via the existing wire options, or the ctx reads the current dunder markers ONCE at context creation as a bridge and modules consult only `ctx.engines`).

- [ ] **Step 1 (D-F7): Failing kernel test** — `getColumnDefsSnapshot()` returns current defs; `upsertColumnDefs([...])` adds/replaces by colId and triggers the same rebuild path as `setColumnDefs`. Implement both; then replace the private-map casts in `calculatedColumns.ts` with the public API (behavior identical — existing calculatedColumns tests stay green).
- [ ] **Step 2 (D-F8): Failing ext test** — with NO calc engine wired, `columnSettings` caption edit + Save: assert the panel surfaces a visible "Calc engine not wired" state (shared pattern) instead of silently succeeding. Implement `ctx.engines` as specified; convert the three strategies (dunder check / lazy wireRules / empty-state) to consult `ctx.engines` with one shared `engineMissingNotice(pane, engineName)` helper; keep lazy `wireRules` behavior but record it into `ctx.engines.rules`.
- [ ] **Step 3 (D-F12): Implement** — `normalizeInstanceDoc`: if `parsed.docVersion > INSTANCE_DOC_VERSION`, do NOT rewrite; load read-only with a console.warn (forward-compat guard). Test: future-version doc survives a load/save cycle unmodified.
- [ ] **Step 4: kernel + ext suites green; commit** `fix(ext): engine DI slots + kernel public column-defs API — no more silent no-ops`.

---

### Task 16: Closeout — full verification + batch review + PR

- [ ] **Step 1:** `npx turbo run test` (whole monorepo) — all green, exit 0.
- [ ] **Step 2:** `npx turbo run build typecheck lint` (whatever of these exist in turbo.json) — green.
- [ ] **Step 3:** Run existing E2E if present (`apps/cgrid-ext-demo/e2e` playwright specs) against the dev server; kill the automation browser afterwards.
- [ ] **Step 4:** ONE batch code review over the entire branch diff (user's convention: single closeout review + one fix wave, no per-task reviewers) — dispatch reviewer over `git diff main...HEAD`, fix confirmed findings, re-run affected suites.
- [ ] **Step 5:** Update `docs/velocity-grid-architecture.md` where behavior changed (SSRM v1 removal, hub push semantics, mirror gating option) — small surgical edits.
- [ ] **Step 6:** Push branch + open PR to main summarizing tiers fixed, with the spec linked.
