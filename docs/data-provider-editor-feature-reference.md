# DataProvider Editor Popout — Feature Reference

**Package:** `@wellsfargo-starui/velocity-grid-data` (`packages/data`)  
**Scope:** Every control in the shared catalog authoring popout opened from Customize → Data provider via **Edit…** / **Manage…**.  
**Source of truth:** `packages/data/src/editor/` + `packages/data/src/transports/` (not `packages/new`).  
**Companions:**  
- Grid engine features — [velocity-grid-feature-reference.md](./velocity-grid-feature-reference.md)  
- Architecture / implementation — [velocity-grid-architecture.md](./velocity-grid-architecture.md)  
- Ext Customize panel — [velocity-grid-ext-feature-reference.md](./velocity-grid-ext-feature-reference.md) (binds `providerId`; this doc authors the catalog)

Tables use: **UI label · Type · Setting / key · Default · Options / range · Hint · What it does**.

---

## 0. Shared defaults

**`PIPELINE_DEFAULTS`** (`ProviderEditor.ts`):

| Key | Default |
|-----|---------|
| `throttleEnabled` | `true` |
| `throttleMs` | `100` |
| `conflateEnabled` | `true` |
| `wireFormat` | `'json'` |
| `snapshotChunkSize` | `500` |

**Draft seed** (`startCreate` / `defaultConfig`): `name: "untitled"`, `description: ""`, `providerId: ""`, `rowModel: "clientSide"`, `blockSize: 100`, `public: false`, plus `PIPELINE_DEFAULTS`, plugin `keyColumn` (fallback `"positionId"`), and `plugin.defaultConfig()`.

**Popout:** window name `"vg-data-providers"`, title `"Data Providers"`, default **1180×760**.

---

## 1. Catalog shell

### 1.1 Sidebar header & list

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 1 | `Providers` | heading | — | — | — | — | Catalog title |
| 2 | `Import` | button | file import | — | `accept=application/json,.json` | title `Import a provider from JSON` | Parse JSON → save with new `provider-${…}` id → select |
| 3 | `+` | button | new provider | — | — | title `New provider` | Opens New Provider modal |
| 4 | (search) | search | local `search` | `""` | filters name / type / description | `Search…` | Filter sidebar |
| 5 | `Loading…` | empty | — | when loading | — | — | Loading state |
| 6 | (error message) | empty | — | backend error | — | — | Error state |
| 7 | `No providers yet.` | empty | — | filtered empty | — | — | Empty catalog |
| 8 | (row name) | text | `cfg.name` | — | — | — | Display name |
| 9 | (type subtitle) | text | `cfg.providerType` | plugin `label` or raw | — | — | Transport under name |
| 10 | `Unsaved` | badge | draft id `__draft__:*` | — | — | — | Create/clone drafts |
| 11 | `Public` | badge | `cfg.public` | — | when `true` | — | Public flag |
| 12 | `⧉` | button | clone | — | hidden on drafts | title `Duplicate` | Clone → `` `${base} (copy)` `` |
| 13 | `✕` | button | delete | — | hidden on drafts | title `Delete` | Opens delete confirm |

### 1.2 New Provider modal

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 14 | `New Provider` | modal title | — | — | — | — | Create dialog |
| 15 | (description) | copy | — | — | — | `Pick a transport. You can change details after.` | Explains picker |
| 16 | `Type` | select | `picked: TransportType` | `stomp` | `STOMP` / `REST` / `Mock` + other plugins by `label` | help under select | Chooses transport |
| 17 | (type help) | help | — | STOMP blurb | Updates on change | STOMP: `WebSocket streaming with snapshot + delta semantics.` · REST: `One-shot HTTP fetch — no live updates.` · Mock: `In-memory dummy stream — for dev/tests.` | Describes preset |
| 18 | `Cancel` | button | — | — | — | — | Closes modal |
| 19 | `Create` | button | — | — | — | — | Seeds draft → Connection tab |

### 1.3 Delete confirm modal

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 20 | `Delete provider?` | modal title | — | — | — | — | Confirm |
| 21 | (description) | copy | — | — | — | `` `${cfg.name} will be removed. Subscribers in other windows will fail to re-attach until a replacement is configured. This cannot be undone.` `` | Warning |
| 22 | (delete error) | error | — | — | on failure | — | Backend error |
| 23 | `Cancel` | button | — | — | disabled while deleting | — | Abort |
| 24 | `Delete` / `Deleting…` | danger button | — | `Delete` | disabled while deleting | — | `backend.remove(providerId)` |

### 1.4 Empty main pane

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 25 | `No provider selected` | heading | — | — | nothing selected | — | Empty right pane |
| 26 | (body) | paragraph | — | — | — | `Pick a provider on the left, or create a new one to get started.` | Guidance |
| 27 | `+ New STOMP Provider` | primary button | — | — | always STOMP | — | `startCreate('stomp')` |

Import failure: `window.alert` → `` `Could not import provider: ${message}` ``.

---

## 2. Form chrome

### 2.1 Header

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 1 | `Name *` | text | `cfg.name` | `untitled` | free text | `positions-live` | Catalog / display name |
| 2 | `Description` | textarea (1 row) | `cfg.description` | `""` | free text | `What this provider streams (optional)` | Optional description |
| 3 | `Public` | switch | `cfg.public` | `false` | on/off | — | Public catalog flag |

### 2.2 Tabs

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 4 | `Connection` | tab | local `tab` | active | always | — | Connection body |
| 5 | `Fields` | tab | local `tab` | — | always | — | Infer / select fields |
| 6 | `Columns` | tab | local `tab` | — | always | — | Column defs + key |
| 7 | `Behaviour` | tab | local `tab` | — | always | — | Pipeline (STOMP content) |
| 8 | `Diagnostics` | tab | local `tab` | — | **only if stable saved `providerId`** | — | Live worker stats; hidden for drafts |

### 2.3 Footer

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 9 | (status left) | text | — | unsaved copy | error / `Saved` / unsaved | `` `Unsaved changes are kept locally until you click ${saveLabel}.` `` | Save status |
| 10 | `Cancel` | secondary | — | — | only if `onCancel` (shell always) | — | Clears draft / may close popout |
| 11 | `Export` | secondary | — | — | — | title `Download this provider config (including unsaved edits) as a JSON file` | Download working config JSON |
| 12 | `Duplicate` | secondary | — | — | only saved providers | title `Copy this provider into a new draft you can edit and save separately` | Shell clone → new draft |
| 13 | `Update Columns` | secondary | pending Fields→Columns | disabled when no new fields | — | enabled: `Merge the Fields-tab selection into the Columns tab…` · disabled: `No new fields selected in the Fields tab.` | Merge inferred selection into `columnDefinitions` |
| 14 | `Create DataProvider` / `Update DataProvider` / `Saving…` | primary | save | Create if no stable id; Update if saved | disabled while saving | — | Persist; mint `provider-${…}` if needed |

---

## 3. Connection tab

### 3.0 Shared chrome

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 1 | `Transport` | select | `cfg.providerType` | draft type / `mock` | `Mock`, `STOMP`, `REST`, `Solace (stub)`, `AMPS (stub)`, `Socket.IO (stub)`, `WebSocket (stub)` (+ custom) | — | Switches transport; **resets** config to `PIPELINE_DEFAULTS` + plugin defaults + `keyColumn` |
| 2 | status pill | status | probe | `Not yet tested.` | `Connecting…` / `Connected` / `Connected — received ${n} row(s)` / error / `connection failed` | — | Test Connection result |
| 3 | `Test Connection` / `Connecting…` | button | probe | — | **visible only for `stomp` and `rest`** | — | Short-lived connection probe |

### 3.1 Mock — card `Mock stream`

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 4 | `Row count` | number | `config.rowCount` | `1000` | number | help `Initial snapshot size.` | Initial synthetic snapshot size |
| 5 | `Tick interval (ms)` | number | `config.tickMs` | `250` | number; `0` = no ticks | help `0 = snapshot only, no live ticks.` | Live update interval |
| 6 | `Shape` | select | `config.shape` | `positions` | `positions`, `trades`, `orders` | help `Synthetic row shape for local demos.` | Synthetic row schema |

**In `defaultConfig` but not in UI:** `updatesPerTick: 5`, `keyColumn: 'positionId'`.

### 3.2 STOMP — cards `Connection` · `Trigger` · `Heartbeat`

#### Connection

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 7 | `WebSocket URL *` | text mono | `config.websocketUrl` | `""` | free text | placeholder `ws://localhost:8080` · help `Supports {{appData.key}} (deterministic) and [name] (session-unique ID).` | Broker WebSocket URL |
| 8 | `Listener Topic *` | text mono | `config.listenerTopic` | `""` | free text | placeholder `/snapshot/positions/TRADER001` · help `Topic the worker SUBSCRIBEs to. Use [name] for a session-unique ID.` | STOMP SUBSCRIBE destination |

#### Trigger

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 9 | `Trigger Destination` | text mono | `config.requestMessage` | unset (`""`) | free text | placeholder `/snapshot/positions/TRADER001/1000` · help `SEND destination after subscribing. Supports [name] tokens.` | Post-subscribe SEND destination |
| 10 | `Trigger Body` | text mono | `config.requestBody` | unset (`""`) | free text | placeholder `(empty — rate in destination)` · help `Leave empty when destination encodes everything…` | Optional SEND body |
| 11 | `Snapshot End Token` | text mono | `config.snapshotEndToken` | `"Success"` | free text | placeholder `Success` · help `Case-insensitive substring that flips status: 'snapshot' → 'ready'.` | End-of-snapshot marker |
| 12 | `Snapshot rows` | number | `config.messageRate` | unset (UI `0`; help cites default **10000**) | number | help `Sent as the STOMP snapshot-rows header… Default 10000.` | `snapshot-rows` header |
| 13 | `Batch size` | number | `config.batchSize` | unset (UI `0`) | number | help `Rows per flush while loading the snapshot / live ticks.` | Batch size / flush |

#### Heartbeat

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 14 | `Outgoing (ms)` | number | `config.heartbeat.outgoing` | `4000` | number; `0` disables | help `STOMP heartbeat interval the client sends. 0 disables.` | Client→broker heartbeat |
| 15 | `Incoming (ms)` | number | `config.heartbeat.incoming` | `4000` | number; `0` disables | help `Expected broker heartbeat interval. 0 disables.` | Expected broker heartbeat |

**In `defaultConfig` but not in UI:** `autoStart: true`.

### 3.3 REST — card `Endpoint`

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 16 | `Base URL *` | text mono | `config.baseUrl` | `""` | free text | `https://api.example.com` | API origin |
| 17 | `Endpoint *` | text mono | `config.endpoint` | `""` | free text | `/v1/positions` | Path appended to base |
| 18 | `Rows Path` | text mono | `config.rowsPath` | unset (`""`) | free text | placeholder `data.results` · help `Dot path into the JSON response. Empty if response IS the array.` | JSON array locator |
| 19 | `Poll interval (ms)` | number | `config.pollInterval` | `0` | number | help `0 = one-shot fetch.` | Polling cadence |

**In `defaultConfig` but not in UI:** `method: 'GET'` (code also supports `POST` + `body`).

### 3.4 Stub transports (Solace / AMPS / Socket.IO / WebSocket)

Same fields for each stub plugin label (`Solace (stub)`, etc.):

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 20 | `url` | text | `config.url` | `""` | free text | — | Stub URL |
| 21 | `topic` | text | `config.topic` | `""` | free text | — | Stub topic |

### 3.5 Generic fallback (no `mountConnectionFields`)

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 22 | `config (JSON)` | textarea (8 rows) | remaining `config` keys | JSON of non-pipeline keys | skips pipeline/column keys listed in source | — | Free-form transport config blob |

---

## 4. Fields tab

### 4.1 Empty state (no inferred fields)

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 1 | `⬡` | icon | — | — | — | — | Empty glyph |
| 2 | `No fields inferred yet` | empty title | — | — | — | — | Before inference |
| 3 | (description) | empty copy | — | — | — | `Click Infer Fields to fetch a sample snapshot and analyze the row schema.` | CTA |
| 4 | `Sample size:` | label + select | local `sampleSize` | `200` | `50 rows`, `100 rows`, `200 rows`, `500 rows` | — | Rows to sample |
| 5 | `Infer Fields` / `Inferring…` | button | probe.infer | — | disabled while inferring | — | Fetch sample + infer schema |
| 6 | (inference error) | error | `probe.inferenceError` | — | when present | — | Probe failure |

### 4.2 After inference

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 7 | `INFERENCE` | badge | — | — | when summary present | — | Marks inference bar |
| 8 | (meta) | text | — | — | — | `` `${rowsUsed} rows used (of ${rowsFetched}) · ${fieldsDetected} fields detected` `` | Summary |
| 9 | (sample size) | select | local `sampleSize` | `200` | same as above | — | Size for re-sample |
| 10 | `Re-sample` / `Inferring…` | button | probe.infer | — | disabled while inferring | — | Re-run inference |
| 11 | (search) | search | local `fieldsSearch` | `""` | filters path + type | `Search fields…` | Filter field list |
| 12 | `Select All` | checkbox | selection set | — | indeterminate when partial; skips `object` types | — | Select/deselect visible non-object fields |
| 13 | `` `${n} selected` `` | muted text | — | — | — | — | Selection count |
| 14 | (field row) | checkbox + path + type | `selectedFieldPaths` | seeded from existing `columnDefinitions` | checkbox **disabled** if `inferredType === 'object'` | — | Pending column candidates (does **not** write `columnDefinitions` until **Update Columns**) |
| 15 | (inference error) | error | — | — | when present | — | Error under list |

---

## 5. Columns tab

### 5.1 Empty state

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 1 | `No columns selected` | empty title | — | — | — | — | No columns yet |
| 2 | (description) | empty copy | — | — | — | `Use the Fields tab to infer and pick columns, or Import JSON.` | Guidance |
| 3 | `Import JSON` | button | import file | — | `application/json,.json` | — | Replace columns from file |

### 5.2 Key column card (when columns exist)

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 4 | `Key Column *` / `Key Columns *` | card title | `config.keyColumn` | plugin default e.g. `positionId` | title switches when ≥2 keys | — | Row id key(s) |
| 5 | (MultiSelect) | multi-select | `config.keyColumn` (`string` \| `string[]`) | from config | options = column fields; hint = `cellDataType` | placeholder `Select column(s)…` · empty `No columns — add fields on the Fields tab` · search `Search columns…` · remove aria `Remove ${label}` | AG-Grid `getRowId` + worker cache key; multi = composite joined with `-` |
| 6 | (composite preview) | mono text | — | hidden if &lt;2 keys | — | `` `id = [a] + "-" + [b] + …` `` | Composite key formula |
| 7 | (help) | help | — | — | — | `Drives AG-Grid getRowId + the worker-side cache key…` | Key semantics |

### 5.3 Add Custom Column

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 8 | `Add Custom Column` | card | — | — | — | — | Manual column authoring |
| 9 | (field) | text | new `field` | — | unique/non-empty | `field` | Payload field path |
| 10 | (header) | text | new `headerName` | falls back to field | free text | `header` | Display header |
| 11 | (type) | select | new `cellDataType` | `text` | `text`, `number`, `boolean`, `date` | — | Cell data type |
| 12 | `Add` | button | appends to `columnDefinitions` | — | no-op if empty/duplicate | — | Append custom column |

### 5.4 Toolbar + table

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 13 | `` `Columns (${n})` `` | text | — | — | — | — | Column count |
| 14 | `Export JSON` | button | — | — | — | — | Download column defs JSON |
| 15 | `Import JSON` | button | — | — | file picker | — | Replace column defs; prune missing keys |
| 16 | `Clear all columns` | secondary | — | — | confirm | confirm `Clear all columns? You can re-select them from the Fields tab.` | Clears `columnDefinitions` + `keyColumn` |
| 17 | `Field` | table cell | `c.field` | — | read-only mono | — | Payload key |
| 18 | `Header` | text | `c.headerName` | `c.headerName ?? c.field` | free text | — | Editable header |
| 19 | `Type` | select | `c.cellDataType` | `text` | `text`, `number`, `boolean`, `date` | — | Editable cell type |
| 20 | `↑` | button | reorder | — | disabled on first | title `Move up` | Move up |
| 21 | `↓` | button | reorder | — | disabled on last | title `Move down` | Move down |
| 22 | `Remove` | button | delete row | — | — | — | Remove; prune key if needed |
| 23 | `` `Rows: ${n}` `` | footer | — | — | — | — | Column count footer |

---

## 6. Behaviour tab

### 6.1 Non-STOMP

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `` `No behaviour settings for ${PROVIDERTYPE} providers.` `` | card note | — | — | when `providerType !== 'stomp'` | — | Hides pipeline controls |

### 6.2 STOMP — Reconnect

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 2 | `Initial Delay (ms)` | number | `config.reconnect.initialDelayMs` | UI display **`5000`** if unset | number | help `Static delay between reconnect attempts. Full exponential backoff + jitter + max-attempts are reserved in the schema; not yet implemented.` | Static reconnect delay (`maxDelayMs` / `jitter` / `maxAttempts` not in UI) |

### 6.3 STOMP — Realtime updates

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 3 | `Throttle updates` | switch | `config.throttleEnabled` | `true` | on/off | — | Trailing-edge throttle |
| 4 | `Throttle (ms)` | number | `config.throttleMs` | `100` | number; disabled when throttle off; `0` clears | help `Coalesce live deltas into a trailing-edge burst every N ms. 0 = immediate…` | Throttle window |
| 5 | `Thin field-level deltas` | switch | `config.thinDeltas` | unset / off | on → `true`; off → `undefined` | help `Ship only the fields that changed per row… Requires a key column…` | Delta thinning |
| 6 | `Conflate updates` | switch | `config.conflateEnabled` | `true` | on/off | — | Per-key conflation in throttle window |
| 7 | `Conflate by key` | select | `config.conflateByKey` | unset → `(use key column)` (`__none__`) | `(use key column)` + fields from `columnDefinitions` (else `inferredFields`); disabled when conflate off | help `Within each throttle window, collapse repeated updates…` | Override conflation key |

### 6.4 STOMP — Snapshot

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 8 | `Chunk size (rows)` | number | `config.snapshotChunkSize` | `500` | number; ≤0 → `undefined` | help `Rows per worker→client frame when flushing the snapshot. Default 500.` | Snapshot frame size |
| 9 | `Wire format` | select | `config.wireFormat` | `json` | `JSON (default)`→`json`; `Columnar (typed arrays)`→`columnar` | help `Codec for worker→window frames. Changing this requires a provider Restart.` | Frame codec |

### 6.5 STOMP — Row fields

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 10 | `Keep only column fields` | switch | `config.projectFields` | unset / off | on → `true`; off → `undefined` | help `Prune each incoming row to the column definition fields (plus the key column)… Infer Fields always sees the full row.` | Field projection |

---

## 7. Diagnostics tab

### 7.1 Unsaved / draft

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 1 | (empty title) | empty | — | — | no stable `providerId` | `Save the provider first — diagnostics show live stats from the worker once the provider has a stable id.` | Blocks live session |

Tab omitted from tab bar for drafts.

### 7.2 Action bar (saved)

| # | UI label | Type | Setting / key | Default | Options / range | Hint / placeholder | What it does |
|---|----------|------|---------------|---------|-----------------|-------------------|--------------|
| 2 | (status badge) | badge | session `status` | `IDLE` etc. | uppercase: idle / connecting / snapshot / ready / error / disconnected… | — | Live provider status |
| 3 | (provider id) | mono text | `cfg.providerId` | — | — | — | Stable id |
| 4 | `Restart` | button | session.restart | — | disabled while `busy` | title `Re-attach + replay` | Re-attach + replay |
| 5 | `Stop` / `Stopping…` | danger | session.stop | `Stop` | disabled while busy | title `Tear down upstream connection` | Tear down upstream |
| 6 | (session error) | error strip | session `error` | hidden | when error set | — | ensure/restart/stop errors |

Opening Diagnostics on a saved id auto-`ensure`s (no Start button). Poll interval **500ms**.

### 7.3 Stat cards (values default `—`)

| # | UI label | Type | Setting / key | Default | Format | Card group | What it does |
|---|----------|------|---------------|---------|--------|------------|--------------|
| 7 | `Fetch time` | stat | `snapshotFetchMs` | `—` | duration; or `In progress…` while snapshot/connecting | Snapshot | Snapshot fetch duration |
| 8 | `Rows loaded` | stat | `rowCount` | `—` | locale int | Snapshot | Cached/loaded rows |
| 9 | `Cache size (serialized)` | stat | `cacheBytes` | `—` | B / KB / MB / GB | Snapshot | Serialized cache size |
| 10 | `Restart → request sent` | stat | `restartRequestMs` | `—` | duration | Connection latency | Latency to send restart |
| 11 | `Request → first message` | stat | `firstMessageMs` | `—` | duration | Connection latency | Time to first message |
| 12 | `Messages (upstream)` | stat | `msgCount` | `—` | locale int | Throughput | Upstream message count |
| 13 | `Upstream rate` | stat | `msgPerSec` | `0.0 msg/s` | `` `${n.toFixed(1)} msg/s` `` | Throughput | Upstream msg/s |
| 14 | `Bytes received` | stat | `byteCount` | `—` | B / KB / MB / GB | Throughput | Bytes received |
| 15 | `Published` | stat | `publishCount` | `—` | locale int | Client publishing | Client publish count |
| 16 | `Publish rate` | stat | `publishPerSec` | `0.0 msg/s` | `` `${n.toFixed(1)} msg/s` `` | Client publishing | Publish msg/s |
| 17 | `Publish rate (1m avg)` | stat | `publishPerMin` | `0.0 msg/min` | `` `${n.toFixed(1)} msg/min` `` | Client publishing | 1-minute average |
| 18 | `Subscribers` | stat | `subscriberCount` | `—` | locale int | Client publishing | Subscriber count |
| 19 | `Started` | stat | `startedAt` | `—` | `toLocaleTimeString()` | Lifecycle | Session start |
| 20 | `Last message` | stat | `lastMessageAt` | `—` | time or `—` | Lifecycle | Last message time |
| 21 | `Errors` | stat | `errorCount` | `—` | locale int | Lifecycle | Error count |
| 22 | `Last Error` | card + mono | `stats.lastError` | hidden until set | — | — | Last error string |

---

## 8. Opening / workflows

| Customize action | Opens with | Intent |
|------------------|------------|--------|
| **Edit…** | `providerId` = selected or active | Jump to that provider’s form |
| **Manage…** | `providerId: null` | Browse / create / delete catalog |

**API:** `openProviderEditorPopout({ backend, providerId, themeSource, hubOpts, onSaved, onClose })`  
Re-open focuses named window; pop-up blocked → Customize hint asks to allow pop-ups. Theme syncs from opener.

### Typical flows

1. **New STOMP:** `+` → Type STOMP → Create → Connection fields → Test → Fields Infer → Update Columns → key column → Behaviour → Create DataProvider → Diagnostics Restart.  
2. **Edit without rebind:** Edit… → change → Update DataProvider (grid keeps prior bind until Customize **Apply**).  
3. **Mock:** Type Mock → row count / tick / shape → Infer / Columns → Create.  
4. **Import/Export:** sidebar Import or footer Export JSON.

---

## 9. Source map

| Area | Path |
|------|------|
| Popout launcher | `packages/data/src/editor/openProviderEditorPopout.ts` |
| Catalog shell | `packages/data/src/editor/DataProviderEditor.ts` |
| Provider form / tabs | `packages/data/src/editor/ProviderEditor.ts` |
| Connection field mounts | `packages/data/src/editor/connectionFields.ts` |
| Transports / defaults | `packages/data/src/transports/builtinPlugins.ts` |
| Styles | `packages/data/src/editor/styles.ts` |
| MultiSelect | `packages/data/src/editor/MultiSelect.ts` |

---

*Document generated from the `main` branch implementation of `@wellsfargo-starui/velocity-grid-data`. Prefer source over this file if strings drift.*
