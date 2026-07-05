# Cycle 21j Phase A — `@cgrid/data` shared data-provider layer (plan)

Spec: `docs/superpowers/specs/2026-07-04-cycle-21j-platform-layers-design.md` §1
Branch: `cycle21j/platform-layers` (base `efb3c4f`)
Reference: `/Users/develop/wfh/starui/packages/data/host-data` — port the
SHAPE (contracts, free-function transports, hub semantics), not the code
(React/AG-Grid-free, cgrid-native binding, v1-simple scope).

Baselines to hold green: kernel 2778, edit 164, customizer 9,
customizer-demo E2E 13, positions visual 31.

---

## T1 — Package scaffold + contracts
1. `packages/data` (`@cgrid/data`): source-direct package like siblings
   (src-direct exports, vitest + happy-dom, tsconfig per repo pattern);
   dep: `@cgrid/kernel` peer; `@stomp/stompjs` as dependency (lazy
   dynamic import inside the transport only).
2. `src/provider.ts`: `DataProvider<T>` interface, `ProviderHandle`,
   `ProviderEmit` + the 5 emit shapes, `ProviderStatus`
   (`disconnected|connecting|loading|ready|error`), `Unsubscribe`,
   `ProviderCapabilities`.
3. `src/types.ts`: `ProviderConfig` union — `MockProviderConfig`,
   `StompProviderConfig` (trimmed core per spec §1.4; v2 keys reserved
   as optional), `RestProviderConfig` (shape only until T7).
   `keyColumn: string | readonly string[]` + `composeRowId` helper
   (composite join with `-`).

## T2 — AppData registry + template resolution
1. `src/appData.ts`: `registerAppDataProvider(name, lookup)` /
   `unregisterAppDataProvider(name)`; lookups may be sync or async.
2. `src/template.ts`: `resolveConfigTemplates(cfg, overlay?)` — deep-walk
   string fields, replace `{{Name.key}}` via the registry with
   `overlay` winning for matching keys (restart `{asOfDate}` pattern);
   `validateResolved(cfg)` → descriptive error listing every unresolved
   token (pre-wire gate, never dial with `{{` in a destination).
3. Unit tests: sync + async lookups, overlay precedence, unknown
   provider name error, nested config fields, `{{` left in
   non-destination fields also caught.

## T3 — Transport primitive + mock transport
1. `src/transports/registry.ts`: `providerType → (cfg, emit) =>
   ProviderHandle` map + `startTransport(cfg, emit, opts)`.
2. `src/transports/mock.ts`: deterministic snapshot (N rows, seeded) +
   interval ticks (rate, mutating keyed rows), honors
   `snapshotChunkSize`, emits the full lifecycle
   (`rowsReceived → {rows, replace} chunks → {status:'ready'} → ticks`).
   This transport IS the test double for everything above it.
3. Unit tests: lifecycle order, chunking, stop/restart semantics.

## T4 — The hub (shared cache + ref-counting)
1. `src/hub.ts`: `ProviderHub` — `getProvider(id): DataProvider` over a
   registered config catalog (`registerProviderConfig(id, cfg)`);
   per-id slot: transport handle + row cache (Map by rowId) + status +
   subscriber set.
   - first `start()` → resolve templates → validate → start transport;
   - subsequent `start()` on a live slot → immediate cache replay to
     THAT subscriber (`onSnapshotData(cachedRows)` + current status);
   - `{rows, replace}` merges into the cache then fans out;
   - `stop()` detaches one subscriber; last detach stops the transport
     and clears the slot (configurable `keepAliveMs` grace, default 0);
   - `refresh()` = per-subscriber cache replay; `restart(extra)` =
     transport restart with overlay (all subscribers see the new
     snapshot).
2. Unit tests (mock transport): two subscribers one transport start;
   late subscriber replay without upstream restart; ref-count teardown;
   restart fan-out; conflation of cache by key.

## T5 — STOMP transport
1. `src/transports/stomp.ts`: port of the StarUI lifecycle at v1 scope —
   lazy `@stomp/stompjs` import (ctor interop resolver), connect →
   subscribe(listenerTopic) → publish(requestMessage, requestBody);
   snapshot buffer until case-insensitive `snapshotEndToken`, emit
   `{rowsReceived}` per batch, flush chunked `{rows, replace}` +
   `{status:'ready'}`; live keyed deltas through conflation
   (latest-wins by `conflateByKey ?? keyColumn`, `conflateEnabled`
   master) + trailing-edge throttle (`throttleMs`,
   `throttleEnabled` master); `restart(extra)` with generation fencing
   (stale frames dropped; new dial doesn't await old `deactivate()`)
   and overlay merged into the trigger body; no-end-token passthrough
   mode.
2. Injectable client factory + timers for tests (StarUI's `StompOpts`
   pattern). Unit tests with a scripted fake client: snapshot/live
   phases, end-token casing, conflation window, restart fencing,
   template re-resolution on restart.

## T6 — cgrid binding + demo + E2E
1. `src/connectGrid.ts`: `connectGrid(grid, provider, opts?)` —
   `onSnapshotData → setRowData`; `onTick → applyTransactionAsync`
   (add vs update split via the provider's rowId against the grid's
   row mirror); status → loading overlay hooks; returns `disconnect()`;
   auto-detach on `gridPreDestroyed`.
2. customizer-demo migration: replace `src/stomp.ts` direct wiring with
   `@cgrid/data` (register the STOMP config, `connectGrid`), register a
   demo AppData provider (`{{AppData.userId}}`-style token exercised in
   `requestBody`).
3. NEW demo surface: second grid on the same page sharing the SAME
   provider id (split view) — the acceptance: one WebSocket, both grids
   live, closing one keeps the other streaming.
4. E2E: shared-socket assertion (count WS connections via CDP or
   server-side counter), late-subscriber replay, restart({asOfDate})
   overlay reaching the trigger body (mock echo), template resolution
   failure surfaces a readable error.

## T7 — REST transport (snapshot + poll)
`src/transports/rest.ts`: fetch → rowsPath extraction → `{rows,
replace}` + ready; optional `pollInterval` re-fetch as replace frames;
same template resolution. Unit tests with fetch stub.

## T8 — Closeout
Docs (`packages/data/README.md` with the 3-layer diagram + examples),
ledger, ONE batched review + fix wave, full invariance sweep
(positions functional suite SERIAL per standing note).

## Sequencing
T1 → T2 → T3 → T4 (hub on mock) → T5 (stomp) → T6 (demo/E2E gate —
user hands-on) → T7 → T8.
