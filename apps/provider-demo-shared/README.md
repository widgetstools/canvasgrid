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

## The shared Perspective engine (SSRM only)

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
