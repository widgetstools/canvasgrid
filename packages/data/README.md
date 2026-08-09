# `@wellsfargo-starui/velocity-grid-data`

Modular SharedWorker **data-provider hub** for VelocityGrid / OpenFin multi-window blotters.

- One upstream connection + one row cache per `providerId`
- Transport plugins: `mock`, `stomp`, `rest` (+ stubs for solace / amps / socketio / websocket)
- Throughput pipeline: throttle, conflate, thinDeltas, projectFields, wireFormat, snapshot chunks
- CSRM fan-out and SSRM `getRows` against the same hub cache
- Config catalog (IndexedDB / localStorage / REST / memory) + provider editor UI

The kernel package stays a **consumer** (`setRowData` / `applyTransaction` / SSRM datasource). Perspective WASM remains a separate optional path.

## Quick start (CSRM)

```ts
import {
  ProviderClientAdapter,
  bindProviderToGrid,
  type DataProviderConfig,
} from '@wellsfargo-starui/velocity-grid-data';

const cfg: DataProviderConfig = {
  providerId: 'positions',
  name: 'Positions',
  providerType: 'mock',
  rowModel: 'clientSide',
  config: { keyColumn: 'positionId', rowCount: 5_000, tickMs: 100 },
};

const provider = new ProviderClientAdapter(cfg);
const detach = bindProviderToGrid(provider, grid);
await provider.start();
```

## SSRM

```ts
import { bindProviderToSsrmGrid } from '@wellsfargo-starui/velocity-grid-data';

const cfg = { /* … */ rowModel: 'serverSide' as const, blockSize: 100 };
const provider = new ProviderClientAdapter(cfg);
bindProviderToSsrmGrid(provider, grid, { blockSize: cfg.blockSize });
await provider.start();
```

## SharedWorker

Pass a bundled worker URL when not using the in-process test fallback:

```ts
new ProviderClientAdapter(cfg, {
  workerUrl: new URL('@wellsfargo-starui/velocity-grid-data/worker', import.meta.url),
});
```

See [OPENFIN.md](./OPENFIN.md) for multi-window / OpenFin affinity notes.

## Editor

```ts
import { mountProviderEditor } from '@wellsfargo-starui/velocity-grid-data/editor';

mountProviderEditor({
  mount: document.getElementById('editor')!,
  onSave: async (cfg) => { /* restart hub slot */ },
});
```

## AppData tokens

```ts
import { resolveProviderConfig } from '@wellsfargo-starui/velocity-grid-data';
import { AppDataStore } from '@wellsfargo-starui/velocity-grid-appdata';

const store = new AppDataStore();
store.set('positions', { asOfDate: '2026-04-01' });
const resolved = resolveProviderConfig(cfg, store.lookup);
```

## Custom transports + Ext selection

See [PLUGINS.md](./PLUGINS.md): `defineTransportPlugin` / `registerTransportPlugin`, pluggable connection UI, and opt-in `dataProviderModule()` on VelocityGridExt (active `providerId` persisted in grid/profile state).
