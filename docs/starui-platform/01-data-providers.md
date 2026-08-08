# 01 — Data Providers

> How starui delivers data from upstream sources (STOMP, REST, mock, etc.) into the grid. cgrid is a *consumer* of this kind of system, not an implementer — but its public API must support the patterns documented here.

Reference: `/Users/develop/wfh/starui/packages/data/host-data/` and `host-data-react/`, `host-data-angular/` adapters.

## 1. Architectural overview

Starui uses a **hub-and-spoke architecture** with a SharedWorker as the central data hub. All data transport (STOMP WebSockets, REST polling, mock generators) runs in the worker; the grid (main thread) subscribes via MessagePort and receives binary-encoded row deltas.

```
┌──────────────────────────────────────────────────────────────┐
│  Main Thread (Grid)                                          │
│  • ProviderClientAdapter wraps IDataProvider                 │
│  • Calls grid.applyTransactionAsync({ update: rows })        │
│  • Subscribes via SharedWorkerDataServicesClient             │
└──────────────────────┬───────────────────────────────────────┘
                       │ MessagePort (attach/detach/ping)
       ┌───────────────┴───────────────┐
       │                               │
┌──────▼──────────────────────┐  ┌────▼─────────────────────┐
│  SharedWorker Hub           │  │  AppData Mirror          │
│  (DataServicesHub)          │  │  (in-memory cache)       │
│  • RowCache keyed by id     │  │                          │
│  • Provider slots (running) │  │  Template vars:          │
│  • Fan-out to subscribers   │  │  positions.asOfDate      │
│  • Catalog preload          │  │  (for live/historical)   │
└──────┬──────────────────────┘  └──────────────────────────┘
       │ ProviderEmit events
┌──────▼──────────────────────────────────────────────────────┐
│  Provider Layer (in Worker)                                 │
│  • STOMP (WebSocket + FIX messaging)                        │
│  • REST (HTTP polling)                                      │
│  • Mock (in-process synthetic data)                         │
│  • WebSocket / Socket.IO (generic streaming)                │
│  • AppData (key-value variable store)                       │
└─────────────────────────────────────────────────────────────┘
```

**Push model with keyed upserts.** Providers emit rows; the hub caches by `keyColumn` and broadcasts deltas. The grid never pulls — it subscribes and receives two event shapes:

- `{ replace: true, rows }` — full snapshot or restart (clear grid, load new data)
- `{ rows }` — incremental upsert (only changed rows)

Two key reasons for the SharedWorker:
1. **Main-thread isolation** — transport I/O, snapshot parsing, throttling all happen off the UI thread
2. **Tab fan-out** — multiple browser tabs sharing one upstream connection (one STOMP subscription serves N tabs)

---

## 2. Provider interface

Providers are **free functions**, not classes. The hub calls a factory that returns a `ProviderHandle`:

```ts
// In the worker
type ProviderEmit = (event: ProviderEmitEvent) => void;

type ProviderEmitEvent =
  | { rows: readonly unknown[]; replace?: boolean }    // upsert or replace
  | { status: ProviderStatus; error?: string }          // loading | ready | error
  | { byteSize: number }                                // raw frame size
  | { rowsReceived: number }                            // progressive snapshot count
  | { timing: ProviderTimingSample };                   // connection latency

interface ProviderHandle {
  stop(): void | Promise<void>;
  restart(extra?: Record<string, unknown>): void | Promise<void>;
}

// Each transport exports a factory like this:
function createStompProvider(
  config: StompProviderConfig,
  emit: ProviderEmit
): ProviderHandle { /* ... */ }
```

On the **consumer side** (main thread), the adapter wraps this into an `IDataProvider`:

```ts
interface IDataProvider<T = Record<string, unknown>> {
  start(): Promise<void>;
  stop(): Promise<void>;
  refresh(): Promise<void>;                                  // replay hub cache, no upstream hit
  restart(extra?: Record<string, unknown>): Promise<void>;   // re-fetch with overlay

  getData(): readonly T[];
  getConfig(): ProviderConfig;
  getColumnDefs(): readonly ColumnDefinition[];

  onRowsReceived(handler: (count: number) => void): Unsubscribe;
  onSnapshotData(handler: (rows: readonly T[]) => void): Unsubscribe;
  onTick(handler: (rows: readonly T[]) => void): Unsubscribe;
  onError(handler: (error: Error) => void): Unsubscribe;
  onStatus(handler: (status: ProviderStatus, error?: string) => void): Unsubscribe;
}
```

**Key design points:**

- **Subscribe/unsubscribe model** — subscribers tracked by `subId`; hub stops upstream when the last subscriber detaches
- **Snapshot-then-tick semantics** — first attach receives `{ replace: true, rows }` with the hub's current cache; live updates deliver incremental deltas
- **Schema declaration** — `columnDefinitions` persisted in config; optional field projection (`projectFields: true`) shrinks wire payloads
- **Errors & reconnect** — provider emits `{ status: 'error', error }`; reconnect policy is per-provider (`reconnect: { initialDelayMs }`)
- **Backpressure** — snapshot chunking (`snapshotChunkSize: 500`) prevents main-thread long tasks; live updates throttled (`throttleMs: 100`) with field-level conflation (`conflateByKey`)

---

## 3. Concrete provider types

| Provider | File | What it does |
|---|---|---|
| **STOMP** | [providers/transports/stomp.ts](../../starui/packages/data/host-data/src/runtime/providers/transports/stomp.ts) | WebSocket + FIX STOMP. Snapshot request → live topic subscription tail. Used in production for positions, trades, orders. |
| **REST** | [providers/transports/rest.ts](../../starui/packages/data/host-data/src/runtime/providers/transports/rest.ts) | HTTP GET/POST polling. No live stream — full refresh every `pollInterval`. Pagination + auth modes. |
| **Mock** | [providers/transports/mock.ts](../../starui/packages/data/host-data/src/runtime/providers/transports/mock.ts) | In-process synthetic data generator. Pre-built shapes (positions, trades, orders) or custom. Live ticking via random mutations. Demos + tests. |
| **WebSocket / Socket.IO** | [providers/transports/](../../starui/packages/data/host-data/src/runtime/providers/transports/) | Generic streaming. Config types exist; implementations partial. |
| **AppData** | [providers/appdata/](../../starui/packages/data/host-data/src/runtime/providers/appdata/) | Key-value variable store (not row stream). Durability `volatile` or `persisted`. Used for template resolution like `{{positions.asOfDate}}`. |

All transports emit through the same `ProviderEmit` contract — pluggable without grid changes.

---

## 4. Hub / Port / Runtime

`createDataPort(mirror)` is the main entry — it wraps an in-memory `AppDataMirror` snapshot and exposes:

```ts
interface DataPort {
  ready: Promise<void>;
  getSnapshot(): AppDataSnapshot | null;
  subscribe(fn: (snapshot: AppDataSnapshot) => void): Unsubscribe;
}
```

The **hub** does the heavy lifting:

- **Central cache** — `RowCache` keyed by `(providerId, rowId derived from keyColumn)`. Upserts on each emit; assumes keyColumn uniqueness. Dedupe: two updates for the same key collapse to the latest before fan-out.
- **Throttle & conflate** — sliding window (`throttleMs`) + top-level field diff (`thinDeltas`). Trailing-edge burst so the grid renders one batch per frame. Field-level deltas shrink wire when rows have 200 fields but only 5 update.
- **Catalog cache** — preloads provider configs from IndexedDB at worker boot. Catalog available in <500ms.
- **Fan-out** — broadcasts deltas to all `subId`s on a provider. Binary encoding (`columnarCodec`) reduces clone cost across N subscribers. Late-join handling: chunked snapshots (~500 rows/chunk) so joining windows don't block.

---

## 5. Grid integration (the contract)

AG Grid uses `applyTransactionAsync({ update })` for live ticks — never replaces `rowData` after the initial snapshot:

```ts
// React adapter wires this automatically:
useEffect(() => {
  const stop = provider.onTick((rows) => {
    gridApi.applyTransactionAsync({ update: rows });
  });
  return stop;
}, [provider]);
```

The four-event contract between provider and grid:

1. **Snapshot** — `onSnapshotData(rows)` → replace full `rowData`
2. **Live ticks** — `onTick(rows)` → `applyTransactionAsync({ update: rows })`. Only changed rows; grid only repaints dirty cells
3. **Errors** — `onError(err)` → show toast/banner; user can `restart()` to reconnect
4. **Status** — `onStatus(status)` → drives spinner overlay (`loading` → `ready` → `error`)

**Critical:** never replace `rowData` after snapshot. Transaction API is essential for live performance — replacing breaks selection, scroll position, flash animations, edit state.

---

## 6. Live vs Historical mode

Two providers, one container that switches between them. Used heavily in trading apps where users toggle between live market data and historical end-of-day snapshots.

```ts
// Two configs, same shape, different destinations:
const stompLive: StompProviderConfig = {
  listenerTopic: `/snapshot/positions/${TAG}`,
  keyColumn: 'positionId',
  conflateByKey: 'positionId',
  throttleMs: 100,
};

const stompHistorical: StompProviderConfig = {
  ...stompLive,
  listenerTopic: `/snapshot/positions/${TAG}/{{positions.asOfDate}}`,   // template token
  // no live tail — snapshot only
};
```

Switching flow:

1. User picks date in toolbar → container calls `handleToolbarDateChange(date)`
2. Container switches active provider ID from live → historical
3. Container writes date to AppData: `appData.set('positions', 'asOfDate', '2026-06-28')`
4. Container calls `historicalProvider.restart({ asOfDate: '2026-06-28' })`
5. In the worker, STOMP resolver substitutes `{{positions.asOfDate}}` → `2026-06-28`
6. Broker returns date-specific snapshot (no live tail)
7. Grid replaces data via the snapshot path

**Key patterns to copy:**
- Two provider rows in the catalog with same shape but different templates/behavior
- Container holds `defaultHistoricalProviderId` and switches on date pick
- Template tokens resolved client-side BEFORE attach
- Restart overlay pushed to worker, substituted at destination resolution time

---

## 7. Bootstrap & lifecycle

```
1. ensureDataServicesHub({ appName, userId })
   → returns { client, ready, appDataReady, catalogReady }

2. AppDataMirror.attach() — watches IndexedDB-backed AppData

3. catalogReady — provider configs loaded from IDB

4. Grid mounts → useDataProvider(providerId) → provider.start()
   → attaches to hub → hub creates provider slot on first attach
   → runs provider connect (STOMP dial, REST first fetch)
   → returns { replace: true, rows } with current cache (initially empty)
   → emits { status: 'ready' } when snapshot loaded

5. Grid receives snapshot → replaces rowData
   Grid receives ticks → applyTransactionAsync

Error/disconnect → onError + onStatus → user can restart()
```

Dependency injection in starui happens via React Context (`<DataServicesProvider>`); for cgrid (vanilla TS), the equivalent is constructor injection or a setter on the grid instance.

---

## 8. React/Angular adapters

| Hook / Service | Purpose |
|---|---|
| `<DataHubProvider platform userId>` | Wraps hub into React context |
| `useDataProvider(providerId, opts)` | Lifecycle (start/stop/refresh/restart); returns `{ provider, status, error }` |
| `useDataServices()` | Escape hatch to raw client |
| `useAppDataStore()` | Reactive AppData snapshot with version counter |
| `useResolvedCfg(cfg)` | Apply `{{positions.asOfDate}}` template substitution |
| `useProviderStats(id, listener)` | 1 Hz stats (rows/sec, msgCount) |

Angular has analogous services. Both adapters are thin wrappers around the same underlying client protocol.

For velocity-grid: build a `<cgrid-data-provider-binding>` Lit element (or just a controller class) that wires `provider.onSnapshotData()` / `provider.onTick()` to `grid.applyTransaction()`. Same shape, no React.

---

## 9. Key types

| Type | File | Purpose |
|---|---|---|
| `IDataProvider<T>` | [provider/IDataProvider.ts](../../starui/packages/data/host-data/src/provider/IDataProvider.ts) | Consumer contract (start/stop/refresh/restart, event handlers) |
| `DataServicesHubBundle` | same | Hub entry point (client, ready promises, stopProvider) |
| `ProviderConfig` | `@starui/types` | Union of all transport configs (Stomp, Rest, Mock, WebSocket, SocketIO, AppData) |
| `ProviderEmit` / `ProviderHandle` | [runtime/providers/Provider.ts](../../starui/packages/data/host-data/src/runtime/providers/Provider.ts) | Provider free-function contract |
| `DeltaEvent` / `DeltaBinEvent` / `DeltaPatchEvent` | [runtime/protocol.ts](../../starui/packages/data/host-data/src/runtime/protocol.ts) | Hub → client wire formats |
| `AttachRequest` / `DetachRequest` / `RefreshProviderRequest` | same | Client → hub requests |
| `AppDataMirror` | [runtime/mirror/AppDataMirror.ts](../../starui/packages/data/host-data/src/runtime/mirror/AppDataMirror.ts) | Main-thread cache of AppData |
| `SharedWorkerDataServicesClient` | [runtime/client/SharedWorkerDataServicesClient.ts](../../starui/packages/data/host-data/src/runtime/client/SharedWorkerDataServicesClient.ts) | MessagePort wrapper |
| `ProviderClientAdapter` | [provider/ProviderClientAdapter.ts](../../starui/packages/data/host-data/src/provider/ProviderClientAdapter.ts) | Main-thread bridge (IDataProvider backed by client) |
| `ColumnDefinition` | `@starui/types` (`types/src/dataProvider.ts`) | Schema shape providers expose |

---

## 10. cgrid integration: the API surface

cgrid should NOT ship its own data provider system. It should expose surfaces that any data port (starui's or other) can drive efficiently.

### What cgrid must expose in `api.ts`

```ts
// cgrid/src/api.ts

// 1. Row identity
export interface RowKeySpec {
  /** Single field name, or array for composite keys, or a function */
  field: string | string[] | ((row: unknown) => string);
}

// 2. Transaction-style row updates (the critical one)
export interface RowTransaction<T = Record<string, unknown>> {
  add?: T[];
  update?: T[];     // upsert by key — only changed rows
  remove?: string[]; // row ids
}

// 3. Snapshot replacement (rare — initial load + provider restart)
export type RowData<T = Record<string, unknown>> = readonly T[];

// 4. Column schema (re-exposed for the customizer to read)
export interface ColumnSchema {
  colId: string;
  field: string;       // dot-path supported
  headerName?: string;
  cellDataType?: 'number' | 'string' | 'date' | 'datetime' | 'boolean' | 'currency' | 'percent';
  width?: number;
  sortable?: boolean;
  filter?: string;
  valueGetter?: string;  // optional DSL expression
}
```

### What cgrid grid instance must support

```ts
class VelocityGrid<T> {
  // Identity
  setRowKey(spec: RowKeySpec): void;

  // Schema
  setColumnSchema(columns: ColumnSchema[]): void;
  getColumnSchema(): ColumnSchema[];

  // Data ingress — the critical API
  setRowData(rows: RowData<T>): void;                    // full replace (snapshot, restart)
  applyRowTransaction(tx: RowTransaction<T>): void;       // incremental upsert (live ticks)

  // Async variant for batching
  applyRowTransactionAsync(tx: RowTransaction<T>): Promise<void>;

  // Lifecycle events the provider binding listens to
  onRowDataChanged(cb: () => void): () => void;          // fires after any data change
  onCellValueChanged(cb: (e: CellChangeEvent<T>) => void): () => void;
}
```

### Recommended provider binding (in the host, not in cgrid)

```ts
// In the host app, not in cgrid library:
import type { IDataProvider } from '@host/data';
import type { VelocityGrid } from '@wellsfargo-starui/velocity-grid';

function bindProviderToGrid<T>(provider: IDataProvider<T>, grid: VelocityGrid<T>) {
  const stops: Array<() => void> = [];

  stops.push(provider.onSnapshotData((rows) => {
    grid.setRowData(rows);
  }));

  stops.push(provider.onTick((rows) => {
    grid.applyRowTransactionAsync({ update: rows });
  }));

  stops.push(provider.onStatus((status, error) => {
    // host UI: spinner overlay, error banner
  }));

  stops.push(provider.onError((err) => {
    // host UI: toast/banner
  }));

  return () => stops.forEach(fn => fn());
}
```

### Gaps cgrid likely has today

1. **Row identity keying** — cgrid probably doesn't have a `rowKey` concept beyond `getRowId`. Needs composite key support (`['symbol', 'exchange']` → `'AAPL-NYSE'`) so the same key resolves on both sides.
2. **`applyRowTransaction` semantics** — if cgrid only supports `setRowData(rows)`, it will thrash on every tick. Must support keyed upserts that preserve selection + scroll position + edit state + flash animations.
3. **Async batching** — `applyRowTransactionAsync` should coalesce multiple calls within a frame so 100 individual ticks render as one paint.
4. **`onCellValueChanged` with old + new values** — already flagged in the customizer engine docs (conditional-styling + alerts both need this). Provider binding emits new values; the diff against old (cached in cgrid) must be exposed.
5. **Column schema exchange** — `getColumnSchema()` so the customizer can read what columns exist; `setColumnSchema()` so the host can update when the provider's schema changes (e.g. after `restart()` with a new shape).

### What cgrid should NOT do

- Implement SharedWorker / hub / transport plumbing — host concern
- Implement template token resolution (`{{positions.asOfDate}}`) — host concern
- Manage live/historical switching — host concern (host swaps providers, cgrid just re-binds)
- Cache row data internally beyond what's needed for rendering — the host's hub already has the canonical cache
