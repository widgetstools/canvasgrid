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

The SSRM app's Perspective engine runs in a **per-origin SharedWorker**, so
every blotter on `localhost:5211` shares one WASM engine, one table and one
feed. Two consequences worth knowing when debugging:

- **It outlives your page.** Reloading does not reset it. It is torn down only
  when the *last* tab on that origin disconnects — so with one tab open a
  reload silently restarts everything, and with two it does not. That
  asymmetry is why a session leak here was invisible in single-tab testing
  and fatal with several blotters open (it ended in `Aw, Snap! Out of
  Memory`). Sessions are now released on `pagehide`, with an idle reaper
  behind it for renderers that crash without running any script.
- **You can measure it.** `await __demo.engineStats()` in the console returns
  `{ heapBytes, sessions, engineUp }` for the shared engine. `sessions` should
  equal the number of open blotters — if it climbs as you reload, something
  is stranding sessions again. `e2e/ssrm-shared-engine.spec.ts` asserts
  exactly that.
