# SSRM shared engine — what is shared, what is not, and what hub parity would take

**Scope:** the Perspective-backed SSRM data path (`packages/perspective`) and how
it compares to the CSRM data hub (`packages/data`).
**Status:** the design in §5 is **built, measured, and now the default**.
`workerFeed: false` (or `?feed=main` on the demo) forces the main-thread feed,
which also remains the automatic fallback wherever there is no shared engine or
the deployed worker predates `feed:*`. §5 records what was actually built,
including the one load-bearing thing this document previously got wrong.
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

The second half has since been addressed: `workerFeed` runs the transport inside
the worker, and §5 records what that took.

Every "cannot happen" claim below names either a measurement or the code path
that guarantees it. Reasoning alone is what produced the original confusion —
and, in §5, one confident claim about a library API that turned out to be wrong.

---

## 1. What is shared today

| Layer | Scope | Mechanism |
|-------|-------|-----------|
| WASM engine | per `(origin, worker script URL, name)` | `SharedWorker` in `bootstrap.ts`; dedicated-worker fallback |
| Physical table | per `(schema, identity)` within an engine | `tableNameForSchema()`; `open_table` when the name already exists |
| Book (page-local) | per `providerId` + schema, per page | `entryFor()` in `provider.ts` — several grids on one page share one book |
| View | per blotter | each `StompPerspectiveProvider` registers its own |
| Feed (default) | one leader tab per table, per origin | Web Lock `cgrid-ssrm:feed:<tableName>` |
| Feed (`workerFeed`) | one per table, **inside the worker** | `WorkerFeedRegistry` keyed on table name — start-or-join, no lock |

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

> **Note (2026-09-05).** Until recently the CSRM hub did not work in
> *production builds at all*. `connectHub` assigned the worker URL to a
> variable before the `new SharedWorker(...)` call, which defeats the pattern
> bundlers match to compile a worker entry; Vite fell back to asset handling
> and inlined the raw TypeScript as `data:video/mp2t;base64,…`. Browsers
> refuse it, `new SharedWorker` does not throw for a bad script, and every hub
> request hung until the 60s timeout. Dev servers hid it entirely. Fixed, with
> `packages/data/tests/hubWorkerBundling.test.ts` as the regression lock and
> `npm run verify:data-hub` asserting the whole identity model against real
> production builds (§6). Worth knowing when reading any claim about what
> CSRM "shares" in a deployed app before that date.

CSRM's hub is keyed the same way the engine is — `(origin, script URL, name)` —
and now carries the same three options (`workerUrl`, `name`, `strict`) and the
same "will these two share?" reporter (`getDataHubTarget()`). Measured, against
built apps on one origin:

| Scenario | Hubs | `subscriberCount` |
|---|---|---|
| 2 tabs, one app, unconfigured | 1 | 2 |
| 2 apps, unconfigured (each bundles its own) | 2 | 1, 1 |
| 2 apps, one deployed URL + one name | 1 | 2 |
| 2 apps, one deployed URL + different names | 2 | 1, 1 |

The default is still `bundled: true`. An app that configures nothing gets its
own hub, which is fine for one app and is precisely the thing `strict: true`
exists to refuse once several share an origin.

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

## 5. Hub parity, as built

On by default. `workerFeed: false` on the controller (or `?feed=main` on the
demo) forces the old path. `BookTelemetry.feedRole` reports what actually
happened: `worker` means the transport moved, `leader`/`follower` means it fell
back.

### What flipping the default changed, measured

Point 4 of §4 — the origin-scoped Web Lock stalling an unshared second app —
turns out to be a property of the MAIN-THREAD feed specifically, not of being
unshared. Two unconfigured apps each feeding from their own worker share no
lock, so there is nothing to contend over and nothing to time out. Same two
apps, same origin, same build:

```
[feed=main] second app reached live in 34.9s
[default]   second app reached live in  3.5s
```

That does not make deploying one worker unnecessary — two engines and two
copies of the book are still two of each — but the unshared configuration is no
longer *user-visibly broken*, only wasteful. Asserted by
`e2e/ssrm-two-apps-one-origin.spec.ts`, which keeps both regimes.

### Correction: `getCompiledClientWasm()` is not the way in

This section previously said feasibility was "settled" on the strength of
`getCompiledClientWasm()`, whose documentation offers exactly this use — a
structured-cloneable `WebAssembly.Module` so a worker can build its own `Client`
without refetching. **It does not work in this build**, and the reasoning that
said it would is a good example of why a documented API is not a measurement:

- `init_client` dispatches on argument **type**: `Uint8Array` and `ArrayBuffer` /
  `Response` / `Promise` each route to the compile path, and anything else that
  is an `Object` is treated as an **already-initialised module namespace**. A
  `WebAssembly.Module` is an `Object`, so it lands in that last branch and the
  client comes out `undefined`. The plumbing underneath handles a Module fine;
  the entry point has no branch that reaches it.
- The published type signature agrees with the code, not the doc comment:
  `PerspectiveWasm = ArrayBuffer | Response | typeof psp | Promise<…>` — no
  `WebAssembly.Module`.

So the page sends the client wasm **URL** and the worker fetches it, served from
the HTTP cache the page has just filled. One fetch per **origin**, where the old
arrangement paid one per tab. Verified against the deployed artefact, where the
worker is at the origin root and the wasm is under `/a1/assets/…` — a shape no
dev server produces.

One more thing the library forces: `@perspective-dev/client` probes
`customElements.get('perspective-viewer')` on every wasm lookup, and
`customElements` does not exist in a worker, so the probe throws a
`ReferenceError` before reaching the branch that would read what we initialised.
`workerFeedHost.ts` installs a `{ get: () => undefined }` shim — truthful rather
than a workaround, since a worker genuinely has no such element.

### How the worker holds a `Table`

The part that *was* right, and is what makes the whole thing cheap:

1. the worker makes an internal `MessageChannel`;
2. attaches one end as an engine session — the identical `attachPort` call a
   page's port goes through, flagged `internal`;
3. points a `Client` at the other end via
   `perspective.worker(Promise.resolve(port))`.

No second engine, no socket, no copy of the data. Rows are written on the side
of the wire the table already lives on, so the main-thread → worker hop every
update used to make is gone.

The internal session is a real engine session and is kept **out of**
`SharedEngineStats.sessions` and `clientProtocols`. Both are read as facts about
pages: `sessions` should equal the number of open blotters (a count that climbs
across reloads is the leak §2 is about), and a `0` in `clientProtocols` reads as
a pre-`hello` page, i.e. a rollout in flight. It is reported as `hostSessions`
instead.

### What moved, what stayed

| | |
|---|---|
| **Moved into the worker** | STOMP client, snapshot assembly, update buffer, flush loop |
| **Stayed on the page** | Views, SSRM datasource, group skeleton, telemetry rendering |
| **Not yet deleted** | Web-Lock election, takeover queue, `waitForSharedSnapshot`, `feedBroadcast.ts` — unreachable on the worker path, still the whole story on the default one |

Election is not *handled better* on the worker path; it does not exist there.
`WorkerFeedRegistry` is keyed on table name and `feed:start` is **start-or-join**:
the second caller gets the running feed's state back rather than racing for a
lock. One broker connection, no takeover gap, nothing to elect.

### The dedicated-worker path stays

Unchanged from the earlier recommendation, and still right: dedicated mode is
the fallback for init failure, for `?worker=dedicated`, and for browsers without
`SharedWorker`. Removing the main-thread feed outright would leave those unable
to feed at all. It is also **single-tab by construction**, so its election was
always the trivial case rather than a competing design.

`canUseWorkerFeed()` is the gate, and it is deliberately conservative: no shared
worker, or a deployed worker older than `feed:*`, means the page feeds itself.
That last case is why the check exists at all — unknown commands have always
been ignored silently, so asking a protocol-1 worker for a feed would strand a
blotter waiting for a snapshot nobody is going to send. Asserted by
`e2e/ssrm-worker-feed.spec.ts`.

### Open questions, updated

Resolved by building it:

- **Telemetry.** The worker pushes `WorkerFeedState` to each subscribed control
  port (throttled, phase changes immediate); `buildTelemetry` takes the feed half
  from it and keeps the view half local. Views are this page's own reads and the
  worker cannot see them.
- **Feed control.** Stop/Restart are worker commands and therefore act on the ONE
  feed — which is what `feedBroadcast.ts` was emulating with a `BroadcastChannel`.
- **Protocol version.** `SHARED_ENGINE_PROTOCOL` is now `2`;
  `WORKER_FEED_PROTOCOL` is a separate **floor** that must stay at 2 as the
  engine protocol moves on.
- **Subscriber lifetime.** Refcounted per control port, released on `pagehide`,
  with a 5-minute idle reaper for a page that crashed. The last release stops the
  feed — otherwise a closed blotter would hold a broker connection for the life
  of a per-origin worker.

- **Config disagreement.** Two apps *can* resolve one `providerId` to different
  topics — table identity folds in the provider id but not the resolved config —
  and they then land on one table and one feed, with the first caller's config
  deciding. Joining is still right (two feeds writing one table would be worse),
  so this now **reports** rather than resolves: `workerFeedConfigMismatch`
  compares effective values, `WorkerFeedState.configMismatch` carries the
  differing fields to *every* subscriber, and `PerspectiveBook` warns once. The
  real fix is table identity that folds in the resolved config, which is a
  separate decision — a changed table name splits books meant to be shared.
- **Credentials — not a worker-feed gap.** Checked: nothing in the STOMP path
  carries credentials, on either feed path or in CSRM's hub transport
  (`new Client({ brokerURL, reconnectDelay, heartbeat* })` and nothing else).
  It is a missing feature project-wide, not something moving the feed took
  away, and adding it is a `connectHeaders` field on the config rather than a
  design problem.

Still open:

- **Deleting the election layer.** Not possible yet, and the reason is worth
  stating plainly: the main-thread feed is the automatic fallback for a
  protocol-1 deployed worker, and *that* path genuinely needs election — two
  tabs feeding one shared table without it would both snapshot. Election can go
  when no protocol-1 workers remain in the field, which is a rollout gate, not
  a refactor.
- **Table identity vs resolved config**, per the first bullet above.

---

## 6. Reproducing any of this

```bash
npm run dev:stomp                                   # required — the feed
npm run dev:ssrm-provider                           # :5211

npx playwright test e2e/ssrm-engine-sharing.spec.ts # N tabs, one build
npx playwright test e2e/ssrm-shared-engine.spec.ts  # sessions across reloads
npx playwright test e2e/ssrm-worker-feed.spec.ts    # the feed inside the worker
npm run verify:worker-feed-reconnect                # take the broker away
npm run verify:shared-engine                        # two builds, one origin
npm run verify:data-hub                             # the CSRM hub, same question
```

`ssrm-worker-feed.spec.ts` asserts all three regimes, because the two that do
NOT delegate are what make the option safe: `?feed=worker` puts one feed in the
worker with every tab subscribed to it and no tab leading; the default leaves
the election path untouched and builds no host client at all; and asking for a
worker feed without a shared worker falls back to feeding locally rather than
hanging. `verify:shared-engine` adds the case only the deployed artefact can
answer — two separately-built apps on one origin, one worker, one feed.

`verify:worker-feed-reconnect` puts a severable relay (`scripts/ws-relay.mjs`)
between the app and the broker, so a test can take the connection away and give
it back. That case earns its harness: once the socket is in the worker, no tab
can see or repair it, and both of the bugs in §7 were found this way.

### 7. Three defects this found, and what they have in common

Each was invisible to reasoning and obvious to measurement — and two of them
were about state that only *looks* right while data is flowing. The third was
sitting in a red test suite that had been written off as unrelated.

**A rate that never falls.** `liveRowsPerSec` is a one-second window, and state
is pushed when rows arrive — so the last push before a feed goes quiet reports
whatever the rate was at that instant, and every subscribed tab keeps showing it.
A feed stopped from Diagnostics sat there claiming 40 rows/s; so did one whose
broker had dropped. The worker now sends one trailing state ~1.1s after its
window empties. Any real push reschedules it, so a running feed never pays for it.

**The worker options were not a static literal** — and this one had been
breaking something else entirely. `newSharedEngineWorker` passed
`{ name, type: 'module' }`, and Vite `eval`s that object to decide the worker
type. Depending on the Vite version that is a silently skipped worker transform
(the bare-`.ts` bug this package already has a guard for) or a hard throw at
import — and vitest ships its own, stricter Vite, so it was throwing: **11
suites in `packages/ext` could not load at all**, hiding 50 tests. They had been
red long enough to be filed as "pre-existing, unrelated". `packages/data` hit
exactly this and moved its name into the URL; this did not follow until the ext
failures were traced back. The name now rides in the deployed URL as `?engine=`,
the options are `{ type: 'module' }`, and both halves are pinned.

**A snapshot latch that survives a reconnect** — and this one is older than the
worker feed. `onConnected` fires on reconnect as well as first connect, and
either way it publishes a fresh snapshot request; but the end-token handler
returns early when `snapshotComplete` is already set, so the token was ignored
and the book sat in `snapshot` indefinitely while rows arrived perfectly well.
`book.ts` had it first and still had it; the worker path inherited it by being a
faithful port. Fixed in both. Nothing before this exercised a reconnect, which is
why a bug on the *default* path survived until an opt-in path's harness went
looking.

`verify:data-hub` builds the CSRM demo under `/a1/` and `/a2/`, deploys one
`velocity-grid-data-hub.js` at the origin root, and asserts each level of the
table above from the hub's own `subscriberCount`. From a CSRM blotter's
console:

```js
__demo.hubTarget()        // { url, name, bundled } — bundled:true ⇒ per-app hub
await __demo.hubStats()   // subscriberCount is the count of tabs on THIS hub
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
