# Provider demos — CSRM and SSRM

Two minimal apps showing the **same catalog DataProvider** driving each row
model, with the **real DataProvider editor** authoring the config.

| App | Port | Row model | Data path |
|-----|------|-----------|-----------|
| `velocitygrid-csrm-provider-demo` | 5210 | `clientSide` | hub → Ext `DataProviderController` → `bindProviderToGrid` |
| `velocitygrid-ssrm-provider-demo` | 5211 | `serverSide` | Ext `PerspectiveDataProviderController` → `StompPerspectiveProvider` → `serverSideDatasource` |

```bash
npm run dev:stomp            # required — the feed both apps read (ws://localhost:8082)
npm run dev:csrm-provider    # :5210
npm run dev:ssrm-provider    # :5211
npm run test:e2e             # smoke both (servers must be running)
```

Both apps share **one catalog** (`LocalStorageConfigBackend` over `LocalStore`),
so a provider authored in either editor is visible in the other. The `rowModel` field decides which
app can drive a config: each app's data controller only binds providers
matching its own row model.

Both apps run **VelocityGridExt** (title bar, ribbon, Customize drawer) on the
kernel dark theme `vg-theme-cursor-dark`. Provider wiring is Ext's own data
module: **Customize → Data** lists the catalog, **Apply** binds the selected
provider, and **Edit…** opens the real DataProvider editor in a popout. Column
defs come from the provider config, so editing the Columns tab and applying is
visible in the grid — no hard-coded colDefs.

## Notes

- **Two throttle stages.** The hub's pipeline (`throttleMs` / `conflateEnabled`,
  Pipeline tab) and the grid's `asyncTransaction*` options are independent. Tune
  the first for wire volume, the second for paint cadence.
- **Provider lifetime is the app's.** `grid.destroy()` unsubscribes but never
  destroys a provider — they're designed to be shared across grids — so these
  apps dispose theirs explicitly when re-applying a config.
- **Pivot on SSRM** is computed by Perspective (`split_by`) and pushed to the
  grid, so it works without hydrating the book. `serverSideEnableClientSidePipeline`
  stays `false`.
- Without the STOMP fixture running, both apps render their columns and an empty
  grid with a `disconnected` status — that is the expected no-broker state.

## The shared Perspective engine (SSRM)

The SSRM app's Perspective engine runs in a **SharedWorker**, so every blotter
sharing it gets one WASM engine, one physical table and one feed — each with
its own View (own group / sort / filter), and exactly one tab leading the
feed while the rest read the shared book. `e2e/ssrm-engine-sharing.spec.ts`
asserts that end to end.

**What "shared" is keyed on.** A SharedWorker's identity is
`(origin, script URL, name)` — all three. Tabs of one app agree on the URL for
free because they load the same bundle. **Two apps do not**: each bundler
emits its own content-hashed copy of the worker script, so `…:4000/a1` and
`…:4000/a2` get two engines, two copies of the table and two feeds even with
the same `providerId`.

That is worse than duplication. Feed leadership is a **Web Lock**, and Web
Locks are scoped to the *origin* while the engine is not — so both apps
contend for one lock while owning two separately-empty tables. The app that
loses polls its own table for a snapshot that can never arrive there, and
only falls back after a 30s timeout. Measured: **35s to live unshared, ~10s
shared**.

**The model to aim for is `(origin, instance name)` with `bundled: false`** —
an app joins the engine *named* `name` on its origin, and nothing else enters
into it. Getting there takes one deployment step, because the URL cannot be
opted out of; fix it to a constant and the name becomes the only axis that
still varies. Build the artefact:

```bash
npm run build:shared-worker --workspace=@wellsfargo-starui/velocity-grid-perspective
# → packages/perspective/dist/perspective-shared-worker.js  (self-contained)
```

serve it at a fixed path, and say the same thing from **every** app before
the first `getPerspectiveClient()`:

```ts
configurePerspectiveSharedWorker({
  url: '/vendor/velocity-grid/psp-shared-worker.js',
  name: 'positions-engine',   // (origin, name) now decides sharing
  strict: true,               // and a silent per-app engine is an error
});
```

`strict` matters more than it looks. Both fallbacks — using the bundled copy,
and dropping to a dedicated worker when the SharedWorker will not start — are
silent, and silence is the wrong default once several apps share an origin:
everything still works, just with N engines, N tables and N feeds. Under
`strict` each throws at `getPerspectiveClient()` instead, before the
multi-megabyte WASM fetch.

Leave `name` alone to put every blotter on the origin's one engine, which is
the usual intent (one engine hosts many providers' tables, each keyed by
`providerId` + schema). Set it to deliberately partition — say, to keep a
heavyweight book off the engine everything else shares.

`__demo.workerTarget()` reports what this tab is keyed on: apps meant to
share must all report `bundled: false` and the same `url` and `name`. The
demo takes `?swurl=`, `?swname=` and `?swstrict` so it can be tried directly,
and `npm run verify:shared-engine` builds the whole two-app scenario and
asserts it end to end.

### The feed inside the worker (`?feed=worker`)

By default the SSRM engine is shared but the **transport** is not: rows arrive
on one elected tab's main thread and are pushed into the shared table. That tab
is throttled when it is backgrounded, competes with paint when it is busy, and
the feed is down for the moment between it closing and a follower winning the
Web Lock.

`?feed=worker` moves the STOMP client into the SharedWorker that already hosts
the engine. There is then one feed because there is one worker — nothing to
elect, no takeover gap, and no cross-thread hop per update, because the rows are
already on the side of the wire the table lives on. In an app:

```ts
new PerspectiveDataProviderController({ catalog, workerFeed: true });
```

It applies only where there is a shared engine to delegate to and the deployed
worker is new enough to understand the `feed:*` commands (protocol ≥ 2).
Anything else falls back to the main-thread feed, deliberately and silently — a
page that cannot delegate its feed still has to have one. Watch which path ran:

```js
__demo.workerFeed()        // { requested, available } — why, if it fell back
await __demo.engineFeeds() // one entry per table; `subscribers` = tabs on it
```

and `feedRole` in telemetry says what happened: `worker` means it moved,
`leader`/`follower` means the election path is still running it. Two knock-on
effects worth knowing:

- **Diagnostics Stop now stops the feed for every tab**, because there is one
  feed. `feedBroadcast.ts` exists only to emulate that on the default path.
- **`engineStats().sessions` still counts pages only.** The worker's own
  Perspective client is a real engine session and is reported separately as
  `hostSessions`, so "sessions should equal open blotters" keeps meaning what it
  meant.

Two things to know when debugging a feed you can no longer see from a tab:

- **A quiet feed reports zero, not its last rate.** `liveUpdatesPerSec` is a
  one-second window, and the worker only pushes state when rows arrive — so it
  sends one trailing update after the window empties. Without it a stopped or
  disconnected feed would go on claiming 40 rows/s indefinitely.
- **Reconnect is the worker's problem now, not a tab's.** `@stomp/stompjs`
  retries on its own timer inside the worker; no tab needs to notice or act.
  `npm run verify:worker-feed-reconnect` stages it by putting a severable relay
  (`scripts/ws-relay.mjs`) in front of the broker, cutting it, and asserting
  both tabs see the drop and both recover.

### Rolling out a new worker

The script is deployed **once per origin** while the apps using it ship on
their own cycles, so a rollout genuinely puts an older page and a newer
worker on the same port. That is a supported state, not an error:

- Page and worker exchange versions on connect (`hello`). A mismatch is
  reported, not assumed away — `__demo.workerProtocol()` gives
  `{ expected, deployed }`, and `engineStats().clientProtocols` shows every
  version currently connected, so a rollout in flight is visible directly
  instead of being inferred from symptoms.
- **A client that predates the handshake is never reaped.** The idle reaper
  judges liveness by heartbeat, and an older page does not send one — it goes
  quiet when idle and always did. Reaping it would close a *live* blotter's
  session after five minutes, so the reaper only ever considers clients that
  announced themselves.

Deploy to one unversioned path and mixed clients simply coexist on one
engine. Use a versioned path (`psp-shared-worker.v1.js`) only to keep
versions deliberately apart — the cost is one engine, one table copy and one
feed *per live version* for the duration of the rollout.

Two more consequences worth knowing when debugging:

- **It outlives your page.** Reloading does not reset it. It is torn down only
  when the *last* tab on that origin disconnects — so with one tab open a
  reload silently restarts everything, and with two it does not. That
  asymmetry is why a session leak here was invisible in single-tab testing
  and fatal with several blotters open (it ended in `Aw, Snap! Out of
  Memory`). Sessions are now released on `pagehide`, with an idle reaper
  behind it for renderers that crash without running any script.
- **You can measure it.** In the console:
  - `await __demo.engineStats()` → `{ heapBytes, sessions, engineUp }`.
    `sessions` should equal the number of open blotters; if it climbs as you
    reload, something is stranding sessions again
    (`e2e/ssrm-shared-engine.spec.ts` asserts exactly that).
  - `await __demo.hostedTables()` → the engine's tables. Several blotters on
    one origin sharing a `providerId` should show **one**, not one per tab.
  - `__demo.workerTarget()` → the `(url, name)` this tab's engine is keyed on.

## The shared data hub (CSRM)

The CSRM app's hub is the same story with a different worker. It is keyed on
`(origin, script URL, name)` too, so the same three levels decide who shares
what:

| Level | Axis | Effect |
|---|---|---|
| 1 | script URL | Unconfigured, each app bundles its **own** copy — two apps cannot converge whatever they are called. |
| 2 | `name` (the app name) | Once the URL is a deployed constant, the name is the only axis left: same name ⇒ one hub, one upstream connection per `providerId`, one cache. |
| 3 | tabs | Not an axis. Every tab of an app lands on the hub that app resolves to. |

Deploy once per origin and name it from every app:

```bash
npm run build:hub-worker --workspace=@wellsfargo-starui/velocity-grid-data
# → packages/data/dist/velocity-grid-data-hub.js  (self-contained)
```

```ts
new DataProviderController({
  catalog,
  workerUrl: '/vendor/velocity-grid/data-hub.js',
  name: 'blotter-suite',
  strict: true,
});
```

Two differences from the engine worth keeping straight:

- **The name partitions the CACHE, not just the worker.** Two names both
  subscribing to one `providerId` open two upstream connections and hold two
  copies of that book. For the engine, one shared worker hosts many tables
  keyed by `providerId` + schema, so leaving `name` alone is the usual intent.
  Here the name *is* the partition, so choose it at the granularity you want
  the data shared at.
- **The app name rides in the URL as `?app=<name>`**, not in the SharedWorker
  options. Vite `eval`s the worker options object to decide the worker type,
  so anything non-literal in there skips the worker transform entirely — and
  for a `.ts` entry that means the raw TypeScript gets inlined as a `data:`
  URL that no browser will run. Identical partitioning either way, since the
  URL is part of the key regardless.

The demo takes `?huburl=`, `?hubapp=` and `?hubstrict` so it can be tried
directly. In the console:

```js
__demo.hubTarget()        // { url, name, bundled } — bundled:true ⇒ per-app hub
await __demo.hubStats()   // subscriberCount = tabs on THIS hub for this provider
```

`npm run verify:data-hub` builds the demo under `/a1/` and `/a2/`, deploys one
hub artefact at the origin root, and asserts every level of the table above
from `subscriberCount` — including the negative cases, since only the contrast
is convincing.
