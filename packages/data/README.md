# `@wellsfargo-starui/velocity-grid-data`

Modular SharedWorker **data-provider hub** for VelocityGrid / OpenFin multi-window blotters.

- One upstream connection + one row cache per `providerId`
- Transport plugins: `mock`, `stomp`, `rest` (+ stubs for solace / amps / socketio / websocket)
- Throughput pipeline: throttle, conflate, thinDeltas, projectFields, wireFormat, snapshot chunks
- CSRM fan-out against a shared hub cache
- Config catalog (IndexedDB / localStorage / REST / memory) + provider editor UI

The kernel package stays a **consumer** (`setRowData` / `applyTransaction`).
SSRM data providers live in `@wellsfargo-starui/velocity-grid-perspective`
(`StompPerspectiveProvider`).

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

## SharedWorker: which hub does an app get?

A SharedWorker is keyed on **`(origin, script URL, name)`** — all three — so
"which hub" is decided at three levels:

| Level | Axis | Effect |
|---|---|---|
| 1 | script URL | Unconfigured, each app's bundler emits its **own** copy, so two apps cannot converge whatever they are called. Deploy the artefact once per origin to give them something to agree on. |
| 2 | `name` (in practice the app name) | Same origin + same deployed URL + same name ⇒ **one hub**: one upstream connection per `providerId`, one cache. A different name partitions on purpose. |
| 3 | tabs | Not an axis. Every tab of an app lands on the hub that app resolves to. |

Deploy one copy per origin:

```sh
npm run build:hub-worker --workspace=@wellsfargo-starui/velocity-grid-data
# → dist/velocity-grid-data-hub.js
```

and point every app at it:

```ts
new ProviderClientAdapter(cfg, {
  workerUrl: '/vendor/velocity-grid/data-hub.js',  // resolved against the ORIGIN
  name: 'blotter-suite',                           // the partition key
  strict: true,                                    // no silent degrade
});
```

`strict` throws rather than quietly falling back to a **bundled** (per-app) or
**in-process** (per-page) hub. Both fallbacks used to be silent, and silence is
the wrong default once several apps share an origin. `getDataHubTarget(opts)`
answers "will these two apps share?" directly — `{ url, name, bundled }`, where
`bundled: true` means no, with a `null` URL because there is nothing another app
could match against.

Worth knowing before choosing a name: naming the hub per app also separates the
**cache**. Two names both subscribing to one `providerId` open two upstream
connections and hold two copies of that book.

Verified against real production builds — two apps on one origin, and two tabs
of one app:

```sh
npm run dev:stomp        # in another terminal — the fixture feed
npm run verify:data-hub  # builds /a1 + /a2, deploys one hub, asserts all three levels
```

See [OPENFIN.md](./OPENFIN.md) for multi-window / OpenFin affinity notes.

## Editor

Markets-shaped shell (list + form) modeled on
`widgets-react/.../provider-editor`:

- Sidebar: search, Import, + New, clone/delete, Public / Unsaved badges
- Form header: Name *, Description, Public
- Tabs: Connection (Test Connection) · Fields (Infer Fields) · Columns
  (key column, import/export) · Behaviour (STOMP knobs) · Diagnostics
- Footer: Cancel · Export · Duplicate · Update Columns · Create/Update DataProvider

The full editor runs as a **shared browser popout**; per-grid Customize
only selects the active `providerId`.

```ts
import {
  mountDataProviderEditor,
  openProviderEditorPopout,
} from '@wellsfargo-starui/velocity-grid-data/editor';

// Shared popout (named window — focuses on reopen)
openProviderEditorPopout({
  backend: catalog,
  providerId: 'positions',
});

// Or embed the shell (tests / dedicated admin page)
mountDataProviderEditor({
  mount: document.getElementById('editor')!,
  backend: catalog,
});
```

## AppData tokens

```ts
import { resolveProviderConfig } from '@wellsfargo-starui/velocity-grid-data';
import { AppDataStore } from '@wellsfargo-starui/velocity-grid-data/appdata';

const store = new AppDataStore();
store.set('positions', { asOfDate: '2026-04-01' });
const resolved = resolveProviderConfig(cfg, store.lookup);
```

## Custom transports + Ext selection

See [PLUGINS.md](./PLUGINS.md): `defineTransportPlugin` / `registerTransportPlugin`, pluggable connection UI, and opt-in `dataProviderModule()` on VelocityGridExt (active `providerId` persisted in grid/profile state).

## Persistence planes

Provider catalog (`ConfigBackend`) ≠ Ext/Markets Config Manager ≠ AppData.
See [docs/starui-platform/03-config-planes.md](../../docs/starui-platform/03-config-planes.md).

