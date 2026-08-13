# 03 — Config planes (naming + ownership)

VelocityGrid / Markets integration uses **three persistence planes**. Mixing their
names is the most common host-integration bug.

| Plane | Owns | Does **not** own | Canvasgrid package / API |
|-------|------|------------------|---------------------------|
| **AppData** | Named KV bags; `{{name.key}}` templates (e.g. `asOfDate`) | Rows, layouts, provider defs | `@wellsfargo-starui/velocity-grid-appdata` |
| **Provider catalog** | `DataProviderConfig` bodies (transports, topics, schema) | View state, configs | `@wellsfargo-starui/velocity-grid-data` **`ConfigBackend`** (think: **ProviderCatalogBackend**) |
| **Config Manager / ConfigSession** | One config per grid: view state + layouts + module slices; optional `gridLevelData` pointers | Live row cache, transport sockets | Ext **`ConfigSession`** / `ProfileStore` facade → host Dexie later |

Markets **Config Manager** (Dexie `host-config`, identity, REST sync, BroadcastChannel)
is the production owner of plane 3. Canvasgrid ships a thin **`ConfigSession`**
adapter so Ext UI and labs share one store; a Markets-grade Config Manager can
implement the same interface later.

---

## Shared transport (`IStorage`)

All three planes persist through one KV interface from
`@wellsfargo-starui/velocity-grid-storage`. Domain APIs stay; only the byte
store is shared.

| Impl | Role |
|------|------|
| **`LocalStore`** | Browser `localStorage` (default) |
| **`RestStore`** | Generic document KV over HTTP (`GET/PUT/DELETE {base}/kv/{key}`) |
| **`MemoryStore`** | Tests / ephemeral |

Stable keys (unchanged):

| Plane | Key |
|-------|-----|
| AppData | `vg-appdata` / `vg-appdata:<ns>` |
| Provider catalog | `vg-data:provider-catalog` |
| Grid instance | `velocity-grid:instance:<gridId>` |

Host injection (one store for all planes):

```ts
import { LocalStore } from '@wellsfargo-starui/velocity-grid-storage';
import { LocalStorageConfigBackend } from '@wellsfargo-starui/velocity-grid-data';
import { PersistedAppDataStore } from '@wellsfargo-starui/velocity-grid-appdata';
import { VelocityGridExt } from '@wellsfargo-starui/velocity-grid-ext';

const storage = new LocalStore(); // or new RestStore({ baseUrl: 'https://…/api/' })

const catalog = new LocalStorageConfigBackend({ storage });
const appData = new PersistedAppDataStore('default', { storage });

new VelocityGridExt(el, {
  gridId: 'blotter-1',
  // Prefer Ext ConfigSession over kernel persistState when both would write.
  ext: { storage },
});
```

`createDefaultConfigBackend()` now returns `LocalStorageConfigBackend` (LocalStore).
`IndexedDbConfigBackend` is deprecated — do not introduce a second default path.

Kernel `persistState` (`velocity-grid:state:<gridId>`) remains a separate optional
path; prefer Ext ConfigSession **or** kernel persistState, not both.

---

## `getConfig` name collision

| API | Meaning |
|-----|---------|
| `grid.getConfig()` / `setConfig()` (**kernel**) | Runtime `VelocityGridOptions` (callbacks, columnDefs) — **not** pure JSON persistence |
| `ext.getConfig()` / `loadConfig()` / `persistConfig()` (**ext**) | JSON workspace blob: `GridState` + `layouts` |
| Markets `configManager.getConfig(configId)` | Fetch an `AppConfigRow` from Dexie/REST |

**Host rule:** Config Manager integration drives the grid with **`getState()` /
`setState()`** (and Ext `getConfig`/`loadConfig` when layouts must round-trip).
Do not use kernel `getConfig` for persistence.

---

## Provider catalog ≠ Config Manager

[`ConfigBackend`](../../packages/data/src/catalog/ConfigBackend.ts) in
`velocity-grid-data` stores **provider definitions** only (`vg-data:provider-catalog`).
It is **not** Markets Config Manager.

- Persist **active selection** as a pointer: StateModule `data-provider` →
  `{ activeProviderId }` (and optionally `gridLevelData.liveProviderId` /
  `historicalProviderId` on the instance bundle).
- Persist **definition bodies** in the provider catalog.
- Never embed full `DataProviderConfig` into layout/config JSON.

Domain REST catalog (`RestConfigBackend`) remains for Markets-style
`/providers` APIs. Hosts that want **all three planes** on one remote KV use
`RestStore` under `LocalStorageConfigBackend` / ConfigSession / AppData instead.

---

## Instance document shape (ConfigSession)

One **flat** document per `gridId`: workspace (`GridState` + `layouts`) at the
root, plus host pointers. There is no `profiles[]` plane — named views are
**layouts** only. `ProfileStore` / `ProfilesController` remain as a single-slot
facade (legacy Markets profile-set language) over this document.

```ts
{
  docVersion: 1,                 // instance document version (≠ GridState.version)
  gridLevelData: {
    activeProviderId?: string,
    liveProviderId?: string,
    historicalProviderId?: string,
  },
  meta?: { id: 'default', name: 'Default', updatedAt: number }, // ProfileStore facade
  // WorkspaceConfig / GridState fields at root:
  version: 4,
  columnState?, modules?, sideBar?, scroll?, …
  layouts?: GridLayoutsBundle,
}
```

Storage key (default adapter): `velocity-grid:instance:<gridId>`.

**Migration on read:**
- Legacy `velocity-grid:config:<gridId>` and `velocity-grid-ext:profiles` → flat
  instance doc.
- Older instance docs with `profiles[]` / `activeProfileId` → active profile’s
  `gridState` + top-level `layouts` (preferred) + `gridLevelData`, rewritten flat.

---

## Future HostConfigManager

Dexie / REST / identity / visibility / BroadcastChannel stay **out of** the
kernel. Implement them as a `ConfigSession` (or `ProfileStore`) behind the same
Ext wiring — or implement `IStorage` and keep the default adapters:

```ts
new VelocityGridExt(el, {
  gridId: 'blotter-1',
  ext: {
    storage, // shared LocalStore / RestStore / custom IStorage
    // or: profiles: { store: new HostConfigManagerSession({ … }) },
  },
});
```

No change to `getState`/`setState` or the data hub when that lands.
