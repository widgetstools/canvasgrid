# VelocityGrid — Developer Usage Guide

**Scope:** A practical, example-first walkthrough of the core grid, VelocityGridExt, server-side data (SSRM),
live DataProviders, and the storage/config layers underneath. Every snippet in this guide is pulled from real,
working code in the repo — nothing here is invented.

**This is a companion to, not a replacement for:**
- [velocity-grid-feature-reference.md](./velocity-grid-feature-reference.md) — the exhaustive feature catalog
- [velocity-grid-ext-feature-reference.md](./velocity-grid-ext-feature-reference.md) — every UI control in VelocityGridExt
- [velocity-grid-architecture.md](./velocity-grid-architecture.md) — internals, topology, design principles
- [data-provider-editor-feature-reference.md](./data-provider-editor-feature-reference.md) — the DataProvider catalog popout in detail

If a signature or field drifts, prefer source over this file.

**Package baseline:** post package-consolidation — 14 packages down to 4 (`@wellsfargo-starui/velocity-grid`,
`velocity-grid-ext`, `velocity-grid-data`, `velocity-grid-perspective`). If you're holding an older example that
imports from something like `@wellsfargo-starui/velocity-grid-calc` directly, it's stale — see the
[Import Map](#import-map) at the end of this guide.

---

## Table of contents

- [Install & Quickstart](#install--quickstart)
- Core Grid
  - [Creating a Grid](#creating-a-grid)
  - [Column Definitions](#column-definitions)
  - [CSRM — Client-Side Row Model](#csrm--client-side-row-model)
  - [Grid API](#grid-api)
  - [Theming](#theming)
  - [Sort, Filter, Group](#sort-filter-group)
- VelocityGridExt
  - [Wiring It Up](#wiring-it-up)
  - [Modules](#modules)
  - [Ribbon Toolbar](#ribbon-toolbar)
  - [Cell Renderers](#cell-renderers)
  - [Edit Engine](#edit-engine)
  - [Teardown](#teardown)
- SSRM & Data Providers
  - [Switching to SSRM](#switching-to-ssrm)
  - [The DataProvider Contract](#the-dataprovider-contract)
  - [STOMP Live Feeds](#stomp-live-feeds)
  - [Connecting to Perspective](#connecting-to-perspective)
- Storage, AppData & Config
  - [Storage](#storage)
  - [AppData](#appdata)
  - [Provider Config Editor](#provider-config-editor)
  - [Grid Runtime Options](#grid-runtime-options)
- [Import Map](#import-map)

---

## Install & Quickstart

```bash
npm install @wellsfargo-starui/velocity-grid
```

A complete, working grid:

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import '@wellsfargo-starui/velocity-grid/style.css';

const grid = new VelocityGrid<{ id: string; name: string; value: number }>(
  document.getElementById('grid')!,
  {
    columnDefs: [
      { field: 'id',    headerName: 'ID',    pinned: 'left', width: 100 },
      { field: 'name',  headerName: 'Name',  flex: 1 },
      { field: 'value', headerName: 'Value', type: 'number', width: 120, aggFunc: 'sum' },
    ],
    getRowId: (row) => row.id,
    rowSelection: 'multiple',
    theme: 'vg-theme-quartz',
  },
);

grid.setRowData([{ id: 'a', name: 'Apple', value: 12.5 }]);
```

> **The one required field.** Beyond a container element and `columnDefs`, `getRowId` is the one option the
> constructor actually enforces — the grid throws if it's missing. Everything else has a sane default.

---

## Core Grid

### Creating a Grid

The `VelocityGrid` class is the engine every other layer in this guide builds on top of.

```ts
new VelocityGrid<TRow>(container: HTMLElement, options: VelocityGridOptions<TRow>)
```

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';

const grid = new VelocityGrid<Position>(gridHost, {
  getRowId: (r) => r.id,
  columnDefs: COLUMNS,
  theme: 'vg-theme-cursor-dark',
  density: 'normal',
});

grid.on('gridReady', () => {
  grid.setRowData(makeRows(60));
});
grid.on('cellClicked', (e) => console.log(e));
```

### Column Definitions

Column defs are plain objects. The fields you'll reach for most:

| Field | What it does |
|---|---|
| `field` | Which row property this column reads |
| `headerName` | Display label |
| `width` / `flex` / `minWidth` / `maxWidth` | Sizing — fixed vs. proportional |
| `pinned` | `'left'` or `'right'` |
| `cellDataType` | `'text'` or `'number'` — drives default formatting/filtering |
| `valueGetter` / `valueFormatter` | Derive or format a display value |
| `cellRenderer` / `cellRendererParams` | Custom cell painting — see [Cell Renderers](#cell-renderers) |
| `filter` / `filterParams` | `'text'` · `'number'` · `'date'` · `'set'` |
| `sortable` / `resizable` | Column-level toggles |
| `editable` / `cellEditor` | Inline editing |
| `aggFunc` | Aggregate function when grouped — `'sum'`, `'avg'`, an array, or custom |

Real examples, from a live positions blotter:

```ts
{
  field: 'cusip', headerName: 'CUSIP', width: 110,
  editable: true,
  filter: 'text',
  filterParams: { caseSensitive: false, trimInput: true },
},
{
  field: 'ticker', headerName: 'Ticker', width: 100, editable: true,
  cellEditor: 'select',
  cellEditorParams: { values: ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA'] },
  filter: 'set',
},
{
  field: 'notionalAmount', headerName: 'Notional', type: 'money',
  width: 130, aggFunc: 'sum', editable: true,
  cellEditor: 'number',
  cellEditorParams: { min: 0, precision: 2 },
  filter: 'number',
},
```

`type: 'money'` above resolves through a named `columnTypes` entry declared once on the grid's own options
(`columnTypes: { money: { cellDataType: 'number', valueFormatter: ... } }`) — define a shape once, reuse it on
every column that needs it.

### CSRM — Client-Side Row Model

CSRM is the default. You don't opt into it — you opt *out* of it by switching to
[SSRM](#switching-to-ssrm). If you pass `rowData` (at construction or later via `grid.setRowData()`) and don't
set `rowModelType: 'serverSide'`, you're on CSRM: the full dataset lives in memory and the grid's worker
handles sort/filter/group over it.

| | CSRM (default) | SSRM |
|---|---|---|
| Trigger | `rowModelType: 'clientSide'` (default) | `rowModelType: 'serverSide'` |
| Data flow | You hand the grid the full row set up front | The grid asks *you* for windows of rows as needed |
| Compute | Sort/filter/group run entirely in-browser, off the main thread, in a worker | You (or a DataProvider) decide what rows to return |
| Best for | Anything that comfortably fits in memory — simplest mental model | Datasets too large for memory, or genuinely live/server-driven data |

> **Good to know.** `setRowData()` is a CSRM-only call — it's a no-op with a console warning once the grid is
> in SSRM mode. Feed SSRM grids through the datasource callback instead, never `setRowData`.

### Grid API

The instance you get back from `new VelocityGrid(...)` is the API surface you'll use for everything after
construction. The methods you'll reach for most:

| Method | Purpose |
|---|---|
| `setRowData(rows)` | Full CSRM data replace |
| `applyTransaction(tx)` | Sync add / update / remove |
| `applyTransactionAsync(tx)` | Batched, throttled add / update / remove — for high-frequency ticks |
| `getSelectedRowIds()` / `setSelectedRowIds(ids)` | Selection |
| `updateGridOptions(partial)` | Patch multiple options at once (e.g. new `columnDefs`) |
| `setGridOption(key, value)` / `getGridOption(key)` | Patch or read a single runtime option — see [Grid Runtime Options](#grid-runtime-options) |
| `sizeColumnsToFit()` / `autoSizeAllColumns()` | Distribute or autosize column widths |
| `setColumnsVisible(keys, visible)` / `setColumnsPinned(keys, side)` | Column visibility & pinning |
| `getColumnState()` / `applyColumnState(state)` / `resetColumnState()` | Save & restore the whole column layout |
| `setSortModel(model)` / `getSortModel()` | Sort state |
| `setFilterModel(model)` / `getFilterModel()` | Filter state |
| `setGroupModel({ rowGroupCols })` | Row grouping — one or more levels |
| `exportDataAsCsv(params)` / `getDataAsCsv(params)` | CSV export — download or return a string |
| `on(type, handler)` / `off(...)` | Events — `gridReady`, `firstDataRendered`, `cellClicked`, `modelUpdated`, `selectionChanged`, … |
| `getDisplayedRowCount()` | Row count after the current filter/sort |
| `destroy()` | Tear down the grid, listeners, and worker |

### Theming

Import the stylesheet once, then pick a theme via the `theme` option — the grid stamps the corresponding class
on its own root element, so there's nothing to add to your container by hand.

```ts
import '@wellsfargo-starui/velocity-grid/style.css';

const grid = new VelocityGrid(host, {
  theme: 'vg-theme-cursor-dark',
  // ...
});

// swap it later at runtime:
grid.setTheme('vg-theme-quartz-dark');
grid.setDensity('compact'); // 'compact' | 'normal' | 'comfortable'

// per-token overrides, on top of whichever theme is active:
grid.setThemeParams({ '--vg-row-height': '32px' });
```

Built-in themes: `vg-theme-quartz` / `-dark` (the default light theme), `vg-theme-starui` / `-dark`,
`vg-theme-cursor` / `-dark`, and `vg-theme-auto`, which follows the OS color scheme automatically.

### Sort, Filter, Group

Per-column, these are just fields on the column def:

```ts
{ field: 'cusip', sortable: true, filter: 'text', filterParams: { caseSensitive: false } },
{ field: 'notionalAmount', filter: 'number', filterParams: { maxNumConditions: 2 } },
{ field: 'ticker', filter: 'set' },
```

A floating filter row across the whole grid: `floatingFilter: true` on the grid options (or on
`defaultColDef` to apply it everywhere at once). Grouping is enabled per column with `enableRowGroup: true`,
then activated on demand:

```ts
grid.setGroupModel({ rowGroupCols: ['ticker', 'sector'] }); // multi-level
grid.setGridOption('groupDisplayType', 'multipleColumns'); // one auto-group column per level
```

---

## VelocityGridExt

VelocityGridExt is the spreadsheet-power-user layer — a ribbon toolbar, alerts, bulk editing, conditional
styling, calculated columns, and more, all on top of a core grid it manages for you.

### Wiring It Up

> **You don't construct `VelocityGrid` yourself.** `VelocityGridExt` builds and owns its own `VelocityGrid`
> internally. You get at it afterward via `ext.grid` — that's what you pass to feature engines like the calc or
> rules wiring functions below.

A complete, working setup:

```ts
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
} from '@wellsfargo-starui/velocity-grid-ext';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import { wireIntoKernel as wireCalc }   from '@wellsfargo-starui/velocity-grid/calc';
import { wireIntoKernel as wireRules }  from '@wellsfargo-starui/velocity-grid/rules';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';
import '@wellsfargo-starui/velocity-grid/style.css';

let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

const ext = new VelocityGridExt<PositionRow>(host, {
  gridId: 'positions',
  getRowId: (row) => row.id,
  columnDefs: COLUMN_DEFS,
  defaultColDef: { resizable: true, sortable: true, editable: true, minWidth: 80 },
  theme: 'vg-theme-quartz',
  sideBar: { toolPanels: ['columns', 'filters'] },
  rowData: seedRows(),
  ext: {
    extensions: [
      ...titleBarExtensions({ name: 'Positions' }),
      ...ribbonExtensions({ edit: () => editHandle }),
    ],
  },
});

// feature engines are wired in AFTER construction, against ext.grid:
wireFormat(ext.grid);
editHandle = wireEditIntoKernel(ext.grid);
wireCalc(ext.grid);
wireRules(ext.grid);
```

### Modules

Unlike feature engines, the settings-sheet modules below are **on by default** — there's no per-module boolean
flag. They register automatically and show up as entries behind the `⋯` launcher. The only lever is
`ext.extensions`, which lets you remove or replace any of them by id (e.g. `{ remove: 'settings-launcher' }`).

| Module | What it does |
|---|---|
| `alertsModule` | Trigger / severity / message / channel rule editor for row-level alerts |
| `bulkUpdateModule` | Settings for the Bulk Update edit operation, linked to change history |
| `calculatedColumnsModule` | A CodeMirror expression editor for defining calculated columns |
| `columnSettingsModule` | Per-column overrides — aggregation, flags — with draft/Save/Reset |
| `conditionalStylingModule` | Rule-based conditional cell styling with an expression editor |
| `dataChangeHistoryModule` | Settings plus a live journal of every edit made to the grid |
| `plusMinusModule` | Configurable ± quick-adjust buttons and their nudge amounts |
| `smartEditModule` | Global / Operations / Safety settings for ×, ÷, +, − and set-value edits |
| `shortcutsModule` | Letter-key shortcuts for numeric ops, editable per shortcut |

`expressionLab` exists but is *not* in the default bundle — add it explicitly via `ext.extensions` if you want it.

### Ribbon Toolbar

The ribbon host exists in the DOM either way, but stays empty and hidden until you opt in with
`ribbonExtensions()`, as shown in the setup example above. No separate container is required — it composes
straight into `ext.extensions`.

```ts
ext: {
  extensions: [
    ...ribbonExtensions({ edit: () => editHandle }),
  ],
}
```

The `edit` field is a lazy getter because `wireEditIntoKernel` typically runs right after the
`VelocityGridExt` constructor, not before it — see [Edit Engine](#edit-engine).

### Cell Renderers

Around 40 named cell renderers — sparklines, bars, badges, tick-flash numeric cells, and more — ship under the
`/renderers` subpath. Wire them in once, then reference them by name from any column def, or use the bundled
builder helper:

```ts
import { wireRenderersIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/renderers';

const renderers = wireRenderersIntoKernel(grid);

// via the builder:
cols.push({
  ...renderers.colDef.renderer('price', 'price', { prevField: 'prevPrice' }, { colId: 'price' }),
  headerName: 'Price',
  width: 110,
});

// or write the plain column def directly, once wireRenderersIntoKernel has run:
{ field: 'price', cellRenderer: 'price', cellRendererParams: { prevField: 'prevPrice' } }
```

### Edit Engine

Smart Edit, Bulk Update, and the ± nudge buttons are all wired in with one call:

```ts
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';

const editHandle = wireEditIntoKernel(ext.grid, {
  nudges: [{ label: '+1bp', delta: 0.0001 }],
  shortcuts: [{ key: 'x', op: 'multiply', amount: 2 }],
});

// later:
editHandle.smartEdit.preview(...);
editHandle.smartEdit.apply(...);
editHandle.journal;          // change history
editHandle.getSettings();    // current settings snapshot
```

History, Smart Edit, Bulk Update, ± nudges, and shortcuts are all `enabled: true` by default — pass a
`settings` override only for the ones you want to change.

### Teardown

```ts
ext.destroy();
```

One call cascades all the way down: extensions, the ribbon shell, and the underlying grid are all disposed.
The edit engine specifically listens for the grid's own `gridPreDestroyed` event, so you don't need to
separately call `editHandle.destroy()` — it happens automatically.

---

## SSRM & Data Providers

### Switching to SSRM

Server-Side Row Model trades "the grid holds everything in memory" for "the grid asks you for windows of rows
as needed" — the right call once a dataset is too large to hold client-side, or is genuinely live and
server-driven.

```ts
rowModelType: 'serverSide',
serverSideDatasource: myDatasource,   // an object implementing getRows(params)
cacheBlockSize: 100,                  // rows fetched per block, default 100
```

A minimal datasource just needs a `getRows` method that calls back with a page of rows:

```ts
interface IServerSideDatasource<TRow> {
  getRows(params: IServerSideGetRowsParams<TRow>): void;
  destroy?(): void;
}
// inside getRows:
params.success({ rowData: page, rowCount: totalIfKnown });
// or, on failure:
params.fail();
```

In practice, you won't usually hand-write one of these — you'll get a ready-made datasource from a
DataProvider, as below.

A complete, working SSRM grid backed by a live feed:

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { StompPerspectiveProvider } from '@wellsfargo-starui/velocity-grid-perspective';
import '@wellsfargo-starui/velocity-grid/style.css';

const provider = new StompPerspectiveProvider({
  feed: 'stomp',
  wsUrl: 'ws://localhost:8082',
  snapshotRows: 5000,
  rate: 40,
  batchSize: 200,
});

const grid = new VelocityGrid(document.getElementById('grid')!, {
  theme: 'vg-theme-cursor-dark',
  rowSelection: 'multiple',
  ...provider.gridOptions(),   // spread FIRST — brings rowModelType, serverSideDatasource, etc.
});

const detach = provider.attach(grid);  // live ticks + sort/filter/group sync, going forward
```

`provider.gridOptions()` hands back the whole SSRM bundle in one object — `getRowId`, `columnDefs`,
`rowModelType: 'serverSide'`, `serverSideDatasource: this`, sensible cache-block and concurrency defaults, and
a pinned grand total row. Spread it first so any options you pass afterward can still override it.

### The DataProvider Contract

Every DataProvider in `@wellsfargo-starui/velocity-grid-data` implements the same interface, regardless of
transport:

```ts
interface IDataProvider<T = Record<string, unknown>> {
  readonly providerId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  refresh(): Promise<void>;
  getData(): readonly T[];
  getConfig(): DataProviderConfig;
  getStatus(): ProviderStatus;
  onRowsReceived(handler): Unsubscribe;
  onTick(handler): Unsubscribe;
  onError(handler): Unsubscribe;
  onStatus(handler): Unsubscribe;
  destroy(): void;
}
```

> **A real gotcha, worth knowing up front.** The DataProvider layer's own `rowModel: 'serverSide'` flag is
> documented as effectively ignored — that path feeds `setRowData`/`applyTransaction` like CSRM regardless of
> what you set it to. For genuine SSRM, go through [the Perspective bridge](#connecting-to-perspective) below,
> not the DataProvider's own row model flag.

### STOMP Live Feeds

The catalog-level transport config — what you'd hand to the [provider config editor](#provider-config-editor)
or store in a saved connection — looks like this:

```ts
{
  providerType: 'stomp',
  config: {
    websocketUrl: 'ws://localhost:8082',
    listenerTopic: '/snapshot/positions/TRADER001',
    requestMessage: '/snapshot/positions/TRADER001/40/200',
    snapshotEndToken: 'Success',
    keyColumn: 'positionId',
    heartbeat: { outgoing: 4000, incoming: 4000 },
    columnDefinitions: EDITOR_COLUMNS,
  },
}
```

> **Two different field-name sets, by design.** The catalog/transport config above uses `websocketUrl` /
> `listenerTopic` / `requestMessage`. `StompPerspectiveProvider`'s own constructor — shown in the SSRM example
> above — uses `wsUrl` / `snapshotTopic` / `triggerTopic` instead, because it runs an independent STOMP client.
> The bridge function below performs that rename for you automatically; you shouldn't need to hand-translate
> between them.

### Connecting to Perspective

To drive SSRM from a catalog-shaped provider config rather than hand-building a `StompPerspectiveProvider`
config yourself, convert it first:

```ts
import { dataProviderConfigToPerspective } from '@wellsfargo-starui/velocity-grid-perspective';

const mapped = dataProviderConfigToPerspective(catalogEntry); // field-renamed, ready to use
const provider = new StompPerspectiveProvider(mapped);
const gridOptions = provider.gridOptions();
```

For an app managing multiple saved connections, `PerspectiveDataProviderController` wraps this whole flow —
catalog, active-provider switching, and telemetry — behind a few calls:

```ts
import { LocalStorageConfigBackend, registerDefaultTransports } from '@wellsfargo-starui/velocity-grid-data';
import { PerspectiveDataProviderController } from '@wellsfargo-starui/velocity-grid-perspective';

registerDefaultTransports();
const catalog = new LocalStorageConfigBackend({ storage });
const dataController = new PerspectiveDataProviderController({ catalog, onTelemetry, onActiveChange });

await catalog.save(providerConfig);
await dataController.setActiveProvider(providerConfig.providerId);
```

---

## Storage, AppData & Config

### Storage

The lowest layer — a small, swappable key/value transport that everything above it persists through.

```ts
interface IStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
```

Three implementations ship out of the box — pick whichever matches where you want data to live:

| Class | Backs onto |
|---|---|
| `LocalStore` | Browser `localStorage` |
| `MemoryStore` | An in-memory `Map` — gone on reload |
| `RestStore` | An HTTP key/value API (`{baseUrl}/kv/{key}`) |

```ts
import { LocalStore, storageGet, storageSet } from '@wellsfargo-starui/velocity-grid-data/storage';

const store = new LocalStore({ onError: (op, err, key) => console.warn(op, key, err) });
await storageSet(store, 'my-key', JSON.stringify({ foo: 1 }));
const raw = await storageGet(store, 'my-key'); // string | null
```

### AppData

A named key/value bag, one layer up from raw Storage — built for resolving `{{providerName.key}}` template
tokens inside grid/provider configs.

```ts
import { PersistedAppDataStore } from '@wellsfargo-starui/velocity-grid-data/appdata';

const appData = new PersistedAppDataStore('default'); // backed by LocalStore() by default
appData.set('user', 'theme', 'dark');
const theme = appData.get('user', 'theme'); // 'dark'
```

Swap the backend the same way you would for Storage on its own:

```ts
import { RestStore } from '@wellsfargo-starui/velocity-grid-data/storage';

const remote = new PersistedAppDataStore('default', { storage: new RestStore({ baseUrl: '/api' }) });
```

**How the layers relate:**

```
┌─────────────┐   ┌────────────────────┐
│   AppData   │   │  Provider Config   │
│ {{n.k}} res │   │  saved connections │
└──────┬──────┘   └──────────┬─────────┘
       │   both persist through   │
       └───────────┬─────────────┘
                    ▼
       ┌─────────────────────────┐
       │  Storage (IStorage)     │
       │ LocalStore · MemoryStore│
       │       · RestStore       │
       └─────────────────────────┘
```

AppData and the provider config catalog are independent domain layers that both happen to sit on Storage
directly — AppData isn't built *on top of* the provider catalog, or vice versa.

### Provider Config Editor

A full catalog UI ships with the data package — list, form, JSON import/export, diagnostics. The way most
apps actually use it is a single call that opens it in a detached popout:

```ts
import { openProviderEditorPopout } from '@wellsfargo-starui/velocity-grid-data/editor';

const handle = openProviderEditorPopout({
  backend: catalog,
  providerId,           // focus a specific saved provider, or null
  themeSource,           // an element carrying your .vg-theme-* class, for popout theming
  onSaved: () => refresh(),
  onClose: () => refresh(),
});
if (!handle) { /* popup was blocked */ }
```

Or mount it directly in your own layout:

```ts
import { mountDataProviderEditor } from '@wellsfargo-starui/velocity-grid-data/editor';

const shell = mountDataProviderEditor({ mount: containerEl, backend, initialProviderId: 'stomp-1' });
// shell.destroy() to unmount
```

> **Import validation.** Importing a saved config file is validated before anything touches the catalog: an
> unrecognized `providerType` is rejected, required fields for that transport must be present (e.g.
> `websocketUrl` + `listenerTopic` for STOMP), and a STOMP `websocketUrl` specifically must parse as a real
> `ws://`/`wss://` URL. Nothing gets auto-saved on import either way — a bad or unreviewed import just loads
> into the form for you to check before hitting Save.

### Grid Runtime Options

Separate from provider config — this is changing the grid's own options after it's already built.

```ts
grid.setGridOption('enableCellChangeFlash', false);
// ...
grid.setGridOption('enableCellChangeFlash', true);

grid.updateGridOptions({ columnDefs: nextColumnDefs }); // batched, for multi-option or columnDefs changes
```

`setGridOption` throws if the key is one of a handful of options that can only be set at construction time —
`columnDefs`, `getRowId`, and `worker` among them. Route those through `updateGridOptions` instead.

---

## Import Map

Fourteen packages were recently consolidated into four. Every import path below is current — if you're
holding onto an example that imports from something like `@wellsfargo-starui/velocity-grid-calc` directly,
it's stale; that's now a subpath.

| I want to use… | Import from |
|---|---|
| The core grid | `@wellsfargo-starui/velocity-grid` |
| Calculated columns / aggregation engine | `@wellsfargo-starui/velocity-grid/calc` |
| Expression parser / editor | `@wellsfargo-starui/velocity-grid/expression`, `/expression/editor` |
| Cell/number formatting DSL | `@wellsfargo-starui/velocity-grid/format` |
| Alerts & conditional rules engine | `@wellsfargo-starui/velocity-grid/rules` |
| VelocityGridExt itself (ribbon, modules) | `@wellsfargo-starui/velocity-grid-ext` |
| Smart Edit / Bulk Update / ± nudges | `@wellsfargo-starui/velocity-grid-ext/edit` |
| The ~40 cell renderers | `@wellsfargo-starui/velocity-grid-ext/renderers` |
| CSV / export helpers | `@wellsfargo-starui/velocity-grid-ext/export` |
| The customizer web components | `@wellsfargo-starui/velocity-grid-ext/customizer` |
| DataProviders, provider config editor | `@wellsfargo-starui/velocity-grid-data`, `/editor` |
| Storage (LocalStore / RestStore / MemoryStore) | `@wellsfargo-starui/velocity-grid-data/storage` |
| AppData | `@wellsfargo-starui/velocity-grid-data/appdata` |
| Perspective / SSRM bridge | `@wellsfargo-starui/velocity-grid-perspective` |
| All of the above, one dependency | `@wellsfargo-starui/velocity-grid-all` (meta-package — see note below) |

> **About the meta-package.** `velocity-grid-all` is ready to use the moment these packages are published
> somewhere npm can fetch from — it isn't installable on its own from a local tarball today. For a one-command
> local install straight from packed tarballs, use `scripts/install-tarballs-into.mjs` in the repo instead.

---

*Every code sample in this guide was pulled from real source in the repo — demo apps, package READMEs, and
the actual TypeScript types — verified against the current state of the codebase, not written from memory.*

*A styled, navigable HTML version of this guide is also available: `docs/velocity-grid-usage-guide.pdf`.*
