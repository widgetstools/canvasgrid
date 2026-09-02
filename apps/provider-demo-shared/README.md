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
emits its own content-hashed copy of the worker script, so two blotter apps on
one origin would silently get two engines, two copies of the table and two
feeds. Point them at one deployed copy instead, from every app, before the
first `getPerspectiveClient()`:

```ts
configurePerspectiveSharedWorker({ url: '/vendor/velocity-grid/psp-shared-worker.js' });
```

`__demo.workerTarget()` reports the `(url, name)` pair this tab is keyed on —
two apps meant to share must print the same one. The demo also takes
`?swurl=<path>` so the behaviour can be seen directly: two tabs on different
values provably get separate engines.

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
