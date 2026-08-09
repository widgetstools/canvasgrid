# OpenFin / multi-window SharedWorker sharing

The data hub is designed for **same-origin** OpenFin windows (or browser tabs) that share one `@wellsfargo-starui/velocity-grid-data` SharedWorker.

## Why SharedWorker

| Concern | Behavior |
|--------|----------|
| Upstream I/O | One STOMP/REST/mock connection per `providerId` |
| Row cache | Canonical book in the worker |
| Fan-out | CSRM pushes / SSRM pages to each attached window |
| UI thread | Transport + pipeline off the renderer |

## Affinity / partition checklist

1. **Same origin** — windows must share scheme + host + port. Different OpenFin app UUIDs that load different origins will **not** share a SharedWorker.
2. **Same partition** (if using Chromium partitions) — `SharedWorker` scope follows the browsing context partition. Keep blotter windows in the same partition as the hub consumer.
3. **Worker URL** — bundle the worker module once and pass a stable absolute URL (`new URL(..., import.meta.url)`). Avoid per-window blob URLs that create separate worker identities.
4. **Catalog** — prefer `IndexedDbConfigBackend` so provider configs saved in window A appear in window B (same origin).
5. **Web Locks** — not required for the hub itself (the SharedWorker is already singular). Use locks only if a host transport needs a main-thread leader (e.g. Perspective path).

## Smoke test (two windows)

1. Serve a small page that:
   - constructs `ProviderClientAdapter` with `providerId: 'smoke-positions'`, `providerType: 'mock'`, `rowModel: 'clientSide'`
   - calls `start()` and displays `getData().length` + `getStatus()`
2. Open the page in **window A**, wait until status is `ready` and row count > 0.
3. Open the **same URL** in **window B** (OpenFin child window or second tab).
4. Expect:
   - Window B reaches `ready` without a second mock “connect storm”
   - Both windows show the same row count after attach (cache replay)
   - With `tickMs > 0`, both windows receive live updates
5. Optional SSRM: set `rowModel: 'serverSide'`, bind via `bindProviderToSsrmGrid`, confirm `getRows({ startRow: 0, endRow: 25 })` returns 25 rows and `rowCount` matches the book.

### Minimal harness sketch

```ts
import { ProviderClientAdapter } from '@wellsfargo-starui/velocity-grid-data';

const provider = new ProviderClientAdapter({
  providerId: 'smoke-positions',
  name: 'Smoke',
  providerType: 'mock',
  rowModel: 'clientSide',
  config: { keyColumn: 'positionId', rowCount: 500, tickMs: 200 },
}, {
  workerUrl: new URL('@wellsfargo-starui/velocity-grid-data/worker', import.meta.url),
});

provider.onStatus((s) => { document.title = s; });
provider.onSnapshotData((rows) => {
  document.body.textContent = `rows=${rows.length}`;
});
await provider.start();
```

Run under OpenFin with your app manifest pointing both windows at that page. Confirm DevTools → Shared workers shows a single `vg-data-hub` worker with multiple connected ports.

## Fallback

When `SharedWorker` is unavailable (some test runners / restricted contexts), pass `{ inProcess: true }` to `ProviderClientAdapter` / `connectHub`. That uses an in-page `DataServicesHub` — **not** shared across windows.

## Pitfalls

- Creating a **new** `providerId` per window duplicates upstream feeds — attach every blotter to the same id.
- Hot-reload of Vite worker URLs can spawn a second worker during dev; hard-refresh all windows after worker code changes.
- Cross-domain child windows cannot share the hub; proxy through the parent or unify origins.
