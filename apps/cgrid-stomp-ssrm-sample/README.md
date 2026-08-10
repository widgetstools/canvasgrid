# SSRM + STOMP DataProvider sample

Standalone VelocityGridExt demo: **server-side row model** bound to a hub
**STOMP** data provider, authored and attached through the Customize drawer
(Data provider selector) — not a hard-wired mock feed.

## Prerequisites

1. **Kernel dist** (Vite resolves the co-located worker from dist):

   ```bash
   npm run build:kernel
   ```

2. **STOMP broker** — [ssrm-grid `stomp-view-server`](../../../ssrm-grid/apps/stomp-view-server)
   on **port 8082**:

   ```bash
   # from canvasgrid (prefers ../ssrm-grid/.../dist/main.js)
   npm run dev:stomp
   ```

   Or directly:

   ```bash
   cd ../ssrm-grid/apps/stomp-view-server
   npm run dev
   ```

   Health check: [http://localhost:8082/health](http://localhost:8082/health)

## Run

```bash
# sample only (broker already up)
npm run dev:stomp-ssrm-sample
# → http://localhost:5201

# broker + sample together
npm run dev:stomp-ssrm
```

## How to use (Customize flow)

1. Open the sample (empty SSRM grid until a provider is applied).
2. **Customize** (title-bar) → **Data** → **Data provider**.
3. Select **STOMP SSRM Positions** (seeded catalog entry).
4. Click **Apply** — hub connects to `ws://localhost:8082`, loads the snapshot,
   then pages the cache via SSRM `getRows`. The selection is **saved into the
   grid instance config** so a reload auto-reconnects the same provider.
5. Live ticks use `applyServerSideTransaction` so **Change flash** (Customize →
   Layout, on by default in this sample) highlights updated cells.
6. **Edit…** / **Manage…** opens the shared provider editor popout (Connection /
   Fields / Columns / Behaviour / Diagnostics) to change URL, topics, rates, etc.

## Persistence (localStorage)

| Plane | Key | Contents |
|-------|-----|----------|
| Provider catalog | `vg-data:provider-catalog` | Full `DataProviderConfig` bodies (`LocalStorageConfigBackend`) |
| AppData | `vg-appdata:stomp-ssrm-sample` | `{{name.key}}` bags (`LocalStorageAppDataStore`) |
| Grid config | `velocity-grid:instance:stomp-ssrm-sample` | View state + layouts + `activeProviderId` |

The seeded STOMP entry is written **once** if missing; later Manage… edits survive reload.

Optional console helper:

```js
await window.__sample.applySeeded()
```

## Seeded connection

| Field | Default |
|-------|---------|
| WebSocket | `ws://localhost:8082` (`VITE_STOMP_URL`) |
| Listener | `/snapshot/positions/TRADER001` |
| Trigger | `/snapshot/positions/TRADER001/1000/200` |
| End token | `Success` (substring) |
| Key | `positionId` |
| Row model | `serverSide` · blockSize `100` |
| Snapshot rows header | `20000` (`VITE_STOMP_ROWS`) |

Override via Vite env: `VITE_STOMP_URL`, `VITE_STOMP_CLIENT_ID`, `VITE_STOMP_RATE`,
`VITE_STOMP_BATCH`, `VITE_STOMP_ROWS`.
