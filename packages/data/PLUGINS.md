# Host transport plugins

Implement only the transport + config + connection UI. The hub, `IDataProvider`, and grid bind path stay the same.

## 1. Define a plugin

```ts
import {
  defineTransportPlugin,
  registerTransportPlugin,
  mountFieldDescriptors,
} from '@wellsfargo-starui/velocity-grid-data';

export const myKafkaPlugin = defineTransportPlugin({
  id: 'my-kafka',
  label: 'Kafka',
  defaultKeyFields: 'id',
  defaultConfig: () => ({ brokers: '', topic: '' }),
  create(cfg, emit, ctx) {
    // connect upstream…
    // emit({ status: 'snapshot' }); emit({ rows, replace: true }); emit({ status: 'ready' });
    // emit({ rows }) for live ticks
    return {
      stop() { /* disconnect */ emit({ status: 'disconnected' }); },
      restart(overlay) { /* reconnect with overlay */ },
    };
  },
  mountConnectionFields(host, { value, onChange }) {
    return mountFieldDescriptors(host, [
      { kind: 'text', key: 'brokers', label: 'brokers' },
      { kind: 'text', key: 'topic', label: 'topic' },
    ], { value, onChange });
  },
});

registerTransportPlugin(myKafkaPlugin);
```

Register the **same** plugin module from:

- the app (main thread — editor + client)
- the SharedWorker entry (or a host worker that imports your register call)

Factories cannot be sent across `postMessage`; both sides must import the plugin.

## 2. Configure via code or catalog

```ts
await catalog.save({
  providerId: 'positions',
  name: 'Positions',
  providerType: 'my-kafka',
  rowModel: 'clientSide',
  config: { ...myKafkaPlugin.defaultConfig(), keyColumn: 'id', brokers: '…' },
});
```

Or open the shared editor popout (`openProviderEditorPopout`) / Save from the form.

## 3. Ext: select provider at runtime

```ts
import { VelocityGridExt, dataProviderModule } from '@wellsfargo-starui/velocity-grid-ext';

new VelocityGridExt(el, {
  /* grid options */,
  ext: {
    extensions: [
      dataProviderModule({ /* catalog?, workerUrl?, inProcess? */ }),
    ],
  },
});
```

- Definitions live in `ConfigBackend` (localStorage by default; IndexedDB preferred for multi-window).
- Active selection `{ activeProviderId }` is a StateModule slice `data-provider` and rides profiles / `getConfig` / `persistConfig`.
- Customize / settings shows **selection + Apply** only; **Edit… / Manage…** opens the shared browser popout for authoring.
- Apply binds CSRM or SSRM via the hub.

## Event → grid mapping

| Transport emit | Provider / grid |
|----------------|-----------------|
| `{ rows, replace: true }` | snapshot → `setRowData` (CSRM) |
| `{ rows }` | tick → `applyTransaction` |
| `{ status: 'ready' }` | status ready |
| authored `columnDefinitions` | `setColumnDefs` on bind |

## Catalog vs Config Manager

`ConfigBackend` / `ProviderCatalogBackend` stores **data-provider definitions**
only. It is not Markets Config Manager (profile bundles, identity, sync).

- Persist provider **bodies** here.
- Persist `{ activeProviderId }` on the grid via StateModule `data-provider`
  (and optionally `gridLevelData` on Ext `ConfigSession`).
- See `docs/starui-platform/03-config-planes.md`.

