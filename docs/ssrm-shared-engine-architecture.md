# SSRM shared engine — what is shared, what is not, and what hub parity would take

**Scope:** the Perspective-backed SSRM data path (`packages/perspective`) and how
it compares to the CSRM data hub (`packages/data`).
**Status:** analysis. No decision has been taken on the design in §5.
**Related:** [velocity-grid-architecture.md §6.3](./velocity-grid-architecture.md),
[velocity-grid-feature-reference.md §5.7](./velocity-grid-feature-reference.md)

---

## 0. Why this document exists

The question that prompted it was whether the same web app on the same origin
ends up with a copy of the same Perspective table per tab — defeating the point
of having a hub at all.

Half of that is measurably untrue, and half of it points at something real. The
two halves have completely different remedies, so it is worth separating them
before anyone acts on either:

- **Tables are not duplicated across tabs of one build.** Measured, §2.
- **The feed is not hub-like.** SSRM shares the *engine* but runs its
  *transport* on the main thread of an elected leader tab, where CSRM runs its
  transport inside the SharedWorker. That asymmetry is real and has costs (§4).

Every "cannot happen" claim below names either a measurement or the code path
that guarantees it. Reasoning alone is what produced the original confusion.

---

## 1. What is shared today

| Layer | Scope | Mechanism |
|-------|-------|-----------|
| WASM engine | per `(origin, worker script URL, name)` | `SharedWorker` in `bootstrap.ts`; dedicated-worker fallback |
| Physical table | per `(schema, identity)` within an engine | `tableNameForSchema()`; `open_table` when the name already exists |
| Book (page-local) | per `providerId` + schema, per page | `entryFor()` in `provider.ts` — several grids on one page share one book |
| View | per blotter | each `StompPerspectiveProvider` registers its own |
| Feed | one leader per table, per origin | Web Lock `cgrid-ssrm:feed:<tableName>` |

**Table identity** folds provider identity in, not just schema shape:
`bookIdentityFor(config)` is `providerId`, else `wsUrl` + `snapshotTopic`/`clientId`
(`provider.ts`). Without it, two catalog entries with identical
`columnDefinitions` pointed at different brokers resolved to the same physical
table and one grid could render the other's rows.

**Two tabs, same provider** therefore converge on one table by name: the second
tab's `openOrCreatePositionsTable` finds the name in `get_hosted_table_names()`
and opens it rather than creating a second.

---

## 2. The duplication matrix

The question actually asked, answered case by case.

| Scenario | Engines | Tables | Feeds | Basis |
|----------|---------|--------|-------|-------|
| N tabs, one build, one origin | 1 | 1 | 1 | **measured** — `e2e/ssrm-engine-sharing.spec.ts` |
| 2 builds, one origin, unconfigured | 2 | 2 | 2 | **measured** — `verify:shared-engine`, default case |
| 2 builds, one origin, configured `url` + `name` | 1 | 1 | 1 | **measured** — `verify:shared-engine`, configured case |
| Dedicated-worker fallback | per tab | per tab | per tab | code path — `wantSharedWorker()` false, or init failure |
| Different `providerId` / schema | 1 | N | N | by design — `tableNameForSchema` |

Measured, three tabs of one build:

```
tab 0: role=leader    book=10000 views=1 rows/s=39
tab 1: role=follower  book=10000 views=1 rows/s=0
tab 2: role=follower  book=10000 views=1 rows/s=0
tables: ["positions-shared-48a5d19d"]   ← the same single table in all three
engine: sessions=3
```

### The two cases where duplication is real

**Two separate builds on one origin.** A SharedWorker's identity is
`(origin, script URL, name)` — all three. Each bundler emits its own
content-hashed copy of `sharedServer.worker.ts`, so `/a1` and `/a2` resolve to
different URLs and get different engines. Remedy: deploy the worker once per
origin and point every app at it with
`configurePerspectiveSharedWorker({ url, name, strict: true })`. Verified end to
end by `npm run verify:shared-engine`.

**Dedicated-worker fallback.** Taken when `SharedWorker` is undefined, when
`?worker=dedicated` is set, or when construction/init fails or times out (10s).
Each tab then has its own engine, table and feed. `strict: true` converts the
fallback into a throw so it cannot happen silently.

Neither case is "the same app duplicating per tab" — but both are easy to reach
by accident, which is why the second one is now enforceable rather than merely
observable.

---

## 3. Where SSRM diverges from the CSRM hub

| | Transport runs | Election |
|---|---|---|
| CSRM `DataServicesHub` | **inside the SharedWorker** — `transports/stomp.ts`, hosted by `packages/data/src/worker.ts` | none needed |
| SSRM Perspective | **main thread of a leader tab** — `book.ts:2406`, `new Client({ brokerURL })` | Web Lock + `BroadcastChannel` |

CSRM's hub owns one slot per `providerId`, holds the transport handle and a
`RowCache`, and fans out to subscriber ports. Tabs are pure consumers.

SSRM inverted that: the engine is shared, the transport is not. Rows arrive on
the leader tab's main thread and are pushed across into the shared table.

**Why it ended up this way.** `sharedServer.worker.ts` is a low-level protobuf
server — it owns the WASM engine and routes byte messages per session. The JS
`Table` / `View` API lives in `@perspective-dev/client`, which historically only
ran on the page. With no `Table` handle inside the worker, there was nowhere for
an in-worker feed to write. §5 shows that constraint no longer holds.

---

## 4. What the current design costs

1. **The feed is hostage to one tab's main thread.** A backgrounded leader has
   its timers throttled by the browser; a busy leader competes with grid paint
   and interaction. Every other tab's data freshness depends on the health of a
   tab its user may not even be looking at.
2. **Takeover gap.** When the leader closes, the Web Lock releases and a
   follower promotes (`queueFeedTakeover`), but the feed is down in between.
3. **A workaround exists solely because of this.** `feedBroadcast.ts` is a
   `BroadcastChannel` whose entire job is making Diagnostics Stop/Restart reach
   the tab that happens to be leading. In a hub design there is one feed to stop.
4. **A 30s stall in the unshared case.** Feed leadership is a Web Lock, and Web
   Locks are scoped to the **origin** while the engine is not. Two apps with
   separate engines derive the *same* lock name (from schema + `providerId` —
   exactly what they share) and contend over two separately-empty tables. The
   loser polls its own table for a snapshot that can never arrive there and only
   falls back after `waitForSharedSnapshot`'s 30s timeout.

   Measured: second app reached live in **35.1s** unshared vs **~10s** shared.

5. **Duplicated parse/buffer cost.** The leader pays snapshot assembly and
   update buffering on behalf of every tab, on the thread that also paints.

Point 4 is worth emphasising: it means the unshared multi-app configuration is
not merely wasteful, it is *user-visibly broken*.

---

## 5. What hub parity would involve

### Feasibility is settled

`@perspective-dev/client` exposes `getCompiledClientWasm()`, documented as
returning a structured-cloneable `WebAssembly.Module` *specifically* so a worker
can build its own `Client` without refetching or recompiling. Combined with
`perspective.worker(Promise<MessagePort>)`, the SharedWorker can hold a full
`Table`/`View` API against its own in-process engine:

1. a page ships the compiled client wasm to the worker;
2. the worker calls `init_client(mod)`;
3. the worker creates an internal `MessageChannel`, attaches one end as an
   engine session (exactly as `attachPort` already does), and calls
   `perspective.worker(Promise.resolve(otherEnd))`;
4. the worker now writes rows into the table **with no cross-thread hop at all**
   — today every update crosses main thread → worker.

That last point is a throughput win on top of the architectural one.

### What moves, what stays, what goes

| | |
|---|---|
| **Moves into the worker** | STOMP client, snapshot assembly, `updateBuffer`, `flushUpdates` |
| **Stays on the page** | Views, SSRM datasource, group skeleton, telemetry rendering |
| **Deleted outright** | Web-Lock leader election, takeover queue, `waitForSharedSnapshot`'s 30s fallback, `feedBroadcast.ts` |

### Recommendation on the dedicated-worker path

**Keep the main-thread feed for dedicated-worker mode — but delete the
leader-election layer in both modes.**

- Dedicated mode is not exotic. It is the fallback for init failure and
  `?worker=dedicated`, and `SharedWorker` support is not universal (notably
  absent on Chrome for Android — worth re-checking against current support
  tables before relying on it either way). Removing the main-thread feed
  outright would leave those environments unable to feed at all, making
  `strict` effectively mandatory. Too aggressive.
- But dedicated mode is **single-tab by construction**. It never needed election
  either — it is the trivial case, not a competing design.
- So the complexity that actually hurts — election, takeover, broadcast, the 30s
  fallback — disappears regardless of which mode is running. What remains common
  is transport wiring, the same `@stomp/stompjs` code, which should be factored
  into one module instantiated in either context.

This is better than either "keep both fully" (retains the machinery) or "replace
outright" (breaks environments without SharedWorker).

### Open questions before committing

- **Config into the worker.** AppData `{{token}}` resolution currently happens on
  the page (`resolveProviderConfig`). The worker needs fully-resolved config, so
  the page must resolve then ship — and two apps could ship *different* resolved
  config for the same `providerId`. First writer wins? Reject mismatches?
- **Telemetry.** `BookTelemetry` is assembled where the feed runs. Moving the
  feed means pushing phase/rate/counters back out to every tab.
- **Feed control.** Stop/Restart becomes a worker command — simpler, but the
  Diagnostics UI and `feedControlRegistry` wiring change shape.
- **Credentials.** Anything the transport needs (auth headers, tokens) has to
  cross into the worker and be refreshable there.
- **Protocol version.** This is a wire-protocol change to the deployed worker;
  it must bump `SHARED_ENGINE_PROTOCOL` and interoperate with older pages under
  the existing `hello` handshake.

---

## 6. Reproducing any of this

```bash
npm run dev:stomp                                   # required — the feed
npm run dev:ssrm-provider                           # :5211

npx playwright test e2e/ssrm-engine-sharing.spec.ts # N tabs, one build
npx playwright test e2e/ssrm-shared-engine.spec.ts  # sessions across reloads
npm run verify:shared-engine                        # two builds, one origin
```

From any blotter's console:

```js
await __demo.hostedTables()    // ["positions-shared-48a5d19d"] — one, not one per tab
await __demo.engineStats()     // { heapBytes, sessions, engineUp, protocol, clientProtocols }
__demo.workerTarget()          // { url, name, bundled } — bundled:true ⇒ per-app engine
__demo.workerProtocol()        // { expected, deployed }
```

`sessions` should equal the number of open blotters. If it climbs as you reload,
sessions are being stranded again — see `e2e/ssrm-shared-engine.spec.ts`.
