# Cycle 21j — Platform layers over cgrid: data + config + customization (2026-07-04)

Branch: `cycle21j/platform-layers` (base: `efb3c4f`, main after Phase 2
merge #102). Reference implementation:
`/Users/develop/wfh/starui/packages/data/host-data` (see the survey in
`.superpowers/sdd/progress.md` and the StarUI STOMP investigation
2026-07-04).

## 0. Decision revision

Cycle 21's original decision dropped `@cgrid/platform` ("host-app code —
data providers, config storage, alert channels — stays in host"). USER
DIRECTION 2026-07-04 revises this: cgrid ships three layers above the
kernel, mirroring the StarUI marketsgrid platform:

1. **Data layer (`@cgrid/data`)** — shared data providers: one upstream
   connection feeding N grids; a new subscriber replays the cached
   snapshot instead of re-fetching. AppData key/value providers
   (entitlements, userId, business date, …) resolvable inside provider
   config strings via `{{AppDataProvider.key}}`.
2. **Config layer (`@cgrid/config`)** — named grid configurations
   ("profiles"/layouts) persisted through pluggable storage, riding the
   kernel's `getState()`/`setState()` + module-state registry (Phase 2).
3. **Customization layer (`@cgrid/customizer`)** — the StarUI-shaped
   tooling (SettingsSheet + PrimaryToolbar, per the Phase 3 pivot
   direction) that gives users UI over kernel features AND connects to
   the config layer (profile lifecycle) and the data layer (provider
   selection/editing).

Dependency direction: `customizer → config → data → kernel`. Lower
layers never import higher ones. All three are lockstep monorepo
packages (intrinsic, not host add-ons — no-retroactive-layering holds).

## 1. Data layer — `@cgrid/data`

### 1.1 Contract (port of StarUI's proven shape)

```ts
interface DataProvider<T = Record<string, unknown>> {
  readonly id: string;
  readonly capabilities: { providerType; streaming; realtime; supportsRefresh; supportsRestart };
  start(): Promise<void>;                 // attach; starts transport if not running
  stop(): Promise<void>;                  // detach; provider stays up for other subscribers
  refresh(): Promise<void>;               // replay shared cache — NO upstream I/O
  restart(extra?: Record<string, unknown>): Promise<void>;  // full re-acquire (e.g. { asOfDate })
  getData(): readonly T[];
  getConfig(): ProviderConfig;
  onRowsReceived(h: (count: number) => void): Unsubscribe;   // progressive snapshot count
  onSnapshotData(h: (rows: readonly T[]) => void): Unsubscribe;
  onTick(h: (rows: readonly T[]) => void): Unsubscribe;
  onStatus(h: (status, error?) => void): Unsubscribe;
  onError(h: (e: Error) => void): Unsubscribe;
}
```

Transports are FREE FUNCTIONS `(cfg, emit) => ProviderHandle` (no class
hierarchy) with the 5-shape emit contract (`{rows, replace?}`,
`{status, error?}`, `{rowsReceived}`, `{byteSize}`, `{timing}`) and a
`providerType → factory` registry — StarUI's Provider.ts/registry.ts
pattern verbatim, because it keeps "add a transport" to one file + one
line.

### 1.2 The shared hub — "simple" scope for v1

- **v1 = in-page hub**: a module-level `ProviderHub` keyed by provider
  id. First `getProvider(id).start()` starts the transport; the hub
  owns the row cache (keyed by `keyColumn`, composite keys joined with
  `-`); later subscribers get a **cache replay** (`onSnapshotData` with
  current rows) with zero upstream I/O; ref-counted — the upstream
  connection stops when the last subscriber detaches.
- Cross-window sharing (SharedWorker, OpenFin) is explicitly **v2**:
  the emit-based transport contract and hub API are already
  worker-shaped (StarUI runs the identical contract inside a
  SharedWorker), so v2 relocates the hub without touching
  `DataProvider` consumers.
- Snapshot → live lifecycle per StarUI: buffer until
  `snapshotEndToken`, chunked replace flush, then keyed deltas with
  optional conflation (`conflateByKey`, latest-wins) + trailing-edge
  throttle (`throttleMs`).

### 1.3 AppData providers + `{{AppDataProvider.key}}`

- `registerAppDataProvider(name, lookup)` where
  `lookup: (key: string) => string | undefined | Promise<string | undefined>`
  — apps register entitlements/userId/business-date/env sources under a
  name.
- Any STRING field of a provider config may contain
  `{{ProviderName.key}}` tokens. Resolution runs on every
  connect/restart (values like business date change between restarts);
  unresolved tokens are a hard, descriptive error BEFORE the wire is
  touched (StarUI's `validateStompWireReady` gate).
- `restart(extra)` overlay wins over AppData for matching keys (the
  toolbar's historical `{ asOfDate }` pattern).

### 1.4 Transports in v1

- `mock` — deterministic rows + tick generator (tests, demos, E2E).
- `stomp` — `@stomp/stompjs` lazy-imported; config shape ported from
  StarUI's `StompProviderConfig` TRIMMED to the simple core:
  `websocketUrl, listenerTopic, requestMessage, requestBody,
  snapshotEndToken, keyColumn, heartbeat, conflateByKey/-Enabled,
  throttleMs/-Enabled, snapshotChunkSize, reconnect.initialDelayMs`.
  (Field projection, thin deltas, columnar codec = v2, config keys
  reserved.)
- `rest` — polling snapshot transport, second release of v1 (task-listed).

### 1.5 Grid binding

`connectGrid(grid, provider)` in `@cgrid/data`: snapshot →
`setRowData`, ticks → `applyTransactionAsync` split into add/update via
the provider's key column (which also supplies `getRowId` when the app
didn't), status → grid loading overlay, returns detach fn wired to
grid destroy. Two grids + one provider = one socket — the headline
acceptance test.

## 2. Config layer — `@cgrid/config`

- **ProfileStore per gridId**: named configurations ("layouts") where a
  profile = `{ name, version, state: GridState }` — the COMPLETE grid
  document (kernel slices + module slices from the Phase 2 registry).
- API: `listProfiles / saveProfile(name) / loadProfile(name) /
  cloneProfile / renameProfile / deleteProfile / exportProfile /
  importProfile / activeProfile / isDirty / onDirtyChange` — the
  StarUI ProfileSelector lifecycle, headless.
- **Storage adapters**: `ConfigStorageAdapter { list/load/save/remove }`
  — localStorage default, in-memory for tests, REST adapter interface
  documented for hosts (implementation host-side).
- Relationship to Phase-1 `persistState`: persistState remains the
  "unnamed autosave" (Default profile); the config layer adds named
  profiles on top of the same snapshot machinery — no second
  serialization path.
- Provider configs (datasources) are ALSO config-layer documents
  (StarUI stores them as `componentType='datasource'`), so the
  customizer's future Data module reads/writes them through the same
  adapters.

## 3. Customization layer — wiring (design pointer, built in the sheet pivot)

The SettingsSheet/PrimaryToolbar pivot (recorded 2026-07-04) consumes
both layers: ProfileSelector + save-all + date chip in the toolbar
(config layer + `restart({asOfDate})`), a Data module in the sheet
(provider picker + editor + Test Connection/Infer Fields via a `probe`
transport mode), and DIRTY tracking fed by `onDirtyChange`. This spec
only fixes the CONTRACTS those UIs consume; the sheet itself is the
next spec.

## 4. Phasing

- **Phase A (this plan): `@cgrid/data` v1** — contract, mock + stomp
  transports, in-page hub with cache replay + ref-counting, AppData
  registry + `{{name.key}}` resolution, `connectGrid`, demo (two grids
  one provider) + E2E, REST transport task.
- **Phase B: `@cgrid/config`** — ProfileStore + adapters + dirty
  tracking, demo profile switcher.
- **Phase C: customization layer** — SettingsSheet pivot spec (separate,
  already directed) consuming A + B.

## 5. Invariance

Kernel untouched in Phase A except (if needed) public API additions per
the two-tier contract. The customizer-demo keeps working with its
current direct `connectStomp` until the demo migrates to
`@cgrid/data` inside Phase A's demo task.
