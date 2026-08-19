# VelocityGrid SSRM · Angular 16.1

Standalone Angular **16.1** host demonstrating:

- **Perspective SSRM** (`rowModelType: 'serverSide'`) via `VelocityGridExt`
- **Programmatic DataProvider** — build catalog config in code, resolve AppData tokens, persist with `LocalStorageConfigBackend`
- **Shared config store** — one `LocalStore` backs provider catalog, AppData (`PersistedAppDataStore`), and Ext `ConfigSession`
- **Grid export/import** — `exportDataAsCsv` / `getDataAsCsv` and CSV → `applyServerSideTransaction({ update })`

Uses seed feed (no STOMP broker required).

## Setup

From the repo root:

```bash
npm run build:kernel    # or npm run examples:install
npm run examples:install
```

SSRM hosts must install Perspective at the **app** level (peer deps of
`@wellsfargo-starui/velocity-grid-perspective`). This example already includes:

```json
"@perspective-dev/client": "^4.5.2",
"@perspective-dev/server": "^4.5.2"
```

## Run

```bash
npm run dev:ext-angular-ssrm    # http://localhost:5204
```

Optional query: `?worker=dedicated` skips SharedWorker (useful in some CI/browser profiles).

## Key files

| File | Role |
|------|------|
| `src/app/provider-catalog.ts` | `buildSsrmProviderTemplate()` with `{{runtime.*}}` AppData tokens |
| `src/app/ssrm-host.ts` | Grid + catalog + AppData bootstrap (runs **before** Zone.js) |
| `src/app/velocity-ssrm-grid.ts` | Angular toolbar wired to `window.__angularSsrm` |
| `src/app/csv-io.ts` | CSV parse helper for import |
| `src/main.ts` | Pre-zone grid mount, then Angular bootstrap |
| `vite.config.ts` | WASM/worker-friendly aliases to monorepo packages |

## AppData + ConfigBackend (code-first provider)

```ts
const storage = new LocalStore();
const catalog = new LocalStorageConfigBackend({ storage });
const appData = new PersistedAppDataStore('angular-ssrm', { storage });

appData.set('runtime', 'snapshotRows', 3000);
const resolved = resolveProviderConfig(buildSsrmProviderTemplate(), appData.lookup);
await catalog.save(resolved);

const dataController = new PerspectiveDataProviderController({ catalog });
await dataController.setActiveProvider('angular-ssrm-seed-positions', { force: true });
```

See `src/app/ssrm-host.ts` for the full Ext + SSRM wiring.

## Export / import (grid API)

- **Export CSV** — `grid.exportDataAsCsv({ fileName: 'ssrm-positions.csv' })`
- **Copy CSV** — `grid.getDataAsCsv()` (visible/filtered rows)
- **Import CSV** — parse client-side, then `grid.applyServerSideTransaction({ update: rows })`

There is no separate `importData` API; SSRM hosts apply imported rows as server-side transactions.

## Angular + Zone.js note

Perspective WASM/worker initialization conflicts with Zone.js patching native constructors. This example **mounts the grid before importing `zone.js`** (`src/main.ts`), then bootstraps Angular for the toolbar chrome. Production hosts can use the same pattern or a dedicated non-Angular bundle for the grid surface.

## Vite / tarball consumption

`package.json` lists `file:../../dist/tarballs/*.tgz` for `@wellsfargo-starui/*` plus
direct npm deps for `@perspective-dev/client` and `@perspective-dev/server` (required
peer deps — one hoisted copy avoids nested WASM/worker resolution issues).

For local dev inside this monorepo, `vite.config.ts` also aliases `@wellsfargo-starui/*`
to `packages/*/src` (and kernel `dist`).

## Console helpers

After load, `window.__angularSsrm` exposes `grid`, `catalog`, `appData`, `dataController`, and `exportCsv()` / `copyCsv()` / `rebindFromAppData()`.
