# 02 — Config Manager

> How starui persists customizer state, identity, and component configuration. cgrid is a *consumer* of this kind of system — it should not ship its own. cgrid's job is to expose a clean `getState()` / `setState()` surface that any config manager can drive.

Reference: `/Users/develop/wfh/starui/packages/data/host-config/` and `packages/shared/engine/src/{persistence,profiles,platform,store}/`.

## 1. Architectural overview

ConfigManager is a **dual-mode store** (local IndexedDB by default, REST-mirrored in production) that centralizes:

- **Component configs** (`AppConfigRow`) — grids, docks, workspaces, data provider definitions, registry
- **Profile bundles** — every customizer instance's profiles + grid-level data, stored as a single row
- **Identity & auth tables** — apps (`AppRegistry`), users (`UserProfile`), roles, permissions
- **Sync state** — queue of failed REST writes pending retry
- **Change notifications** — cross-tab + same-tab event broadcasts

```
┌─────────────────────────────────────────────────────────┐
│  ConfigManager (singleton per window/worker)            │
├──────────────┬──────────────┬──────────┬────────────────┤
│  Dexie DB    │ ChangeNotif. │ REST     │ Profiles       │
│  (IndexedDB) │ (Broadcast-  │ Sync     │ Namespace      │
│              │  Channel)    │ Queue    │                │
├──────────────┴──────────────┴──────────┴────────────────┤
│  6 Tables: appConfig, appRegistry, userProfile,         │
│            roles, permissions, pendingSync              │
├─────────────────────────────────────────────────────────┤
│  ApplicationContext (AppData mirror)                    │
│   AppId, LoggedInUser, ImpersonatedUser, Profile        │
└─────────────────────────────────────────────────────────┘
         ▲                                       ▲
         │                                       │
┌────────┴───────┐                    ┌─────────┴──────────┐
│  cgrid + addon │                    │  Other components  │
│  (via Storage  │                    │  (docks, wsps,     │
│   Adapter)     │                    │   provider defs)   │
└────────────────┘                    └────────────────────┘
```

**Scoping**: one ConfigManager per execution context (browser window or SharedWorker); shared IndexedDB (`marketsui-config`) per origin. Multiple ConfigManagers on the same DB is safe — Dexie's IndexedDB locks handle concurrency.

---

## 2. What is a "Profile"?

A **profile** is a JSON snapshot of customizer state at a moment in time — formatting, filters, column orders, conditional rules, etc. — that a user wants to restore later.

### Profile bundle structure

All profiles for one grid instance (identified by `instanceId`) are **bundled into a single `AppConfigRow`**:

```ts
{
  configId: 'my-grid-instance-id',
  appId: 'my-app',
  userId: 'alice',
  componentType: 'markets-grid-profile-set',
  payload: {
    version: 3,                          // bundle version (optimistic lock)
    profiles: [
      {
        id: '__default__',
        gridId: 'opaque',
        name: 'Default Layout',
        state: {
          'module-alerts':       { version: 1, data: { /* ... */ } },
          'module-conditional':  { version: 2, data: { /* ... */ } },
          'module-columns':      { version: 1, data: { /* ... */ } },
        },
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      { id: 'profile-2', name: 'Narrow View', state: {/*...*/} },
    ],
    gridLevelData: {
      liveProviderId: 'provider-x',
      historicalProviderId: 'provider-y',
    },
  },
  isPublic: true,
  createdBy: 'alice',
  updatedBy: 'alice',
  creationTime: '2026-06-29T12:00:00Z',
  updatedTime: '2026-06-29T14:30:00Z',
}
```

### Per-module state slicing

Each customizer module (alerts, conditional styling, columns, etc.) stores **versioned state** under its own key:

```ts
state: {
  'alerts':              { version: 1, data: {/* module JSON */} },
  'conditional-styling': { version: 2, data: {/* module JSON */} },
}
```

Module versions enable schema migrations: if alerts bumps its state version from 1 → 2, old profiles are lazily deserialized + migrated on load. The config manager is agnostic — it just stores/returns the envelope.

### Profile metadata

- `id` — unique within the bundle
- `name` — user-friendly display name
- `gridId` — opaque reference, typically UUID
- `createdAt`, `updatedAt` — `Date.now()` ms timestamps
- `state` — `Record<moduleId, SerializedState>`

---

## 3. Storage layer

### IndexedDB schema (6 tables)

| Table | Primary key | Indexes | Purpose |
|---|---|---|---|
| `appConfig` | `configId` | `appId`, `userId`, `[componentType+componentSubType]`, `isTemplate` | Component configs + profile bundles + templates |
| `appRegistry` | `appId` | — | Deployed apps |
| `userProfile` | `userId` | `appId` | User → roles mapping |
| `roles` | `roleId` | — | Role definitions |
| `permissions` | `permissionId` | `category` | Permission definitions |
| `pendingSync` | `++id` | `tableName`, `recordId` | Failed REST writes queued for retry |

### Migrations

Dexie schema versioning is **additive** — old versions never disappear; migrations run only on first access after a version bump:

- v1: original shape
- v2: rename `config→payload`, `createdAt→creationTime`, `updatedAt→updatedTime`; add `userId` index (backfill from `createdBy`)
- v3: add `isPublic` field (backfill to `true`)
- v4: remove deprecated `isRegisteredComponent`

Each `version()` call defines schema (indexes, structure) + an optional `.upgrade()` callback. Upgrade runs only when the browser's actual DB is below that version.

### Caching strategy

**Single-row read cache** (`ConfigManager.rowCache`):
- Memoizes `getConfig(configId)` hits (both found and not-found) to avoid re-hitting Dexie
- Invalidated on every write via `ChangeNotifier`
- Bounded at 1000 entries; clears wholesale when exceeded
- Cross-tab invalidation: when a sibling tab writes, `BroadcastChannel` delivers `configChanged` → local listener evicts the key → next read re-fetches

### Cross-instance coordination

`BroadcastChannel('marketsui-config-changes')`:
- `ChangeNotifier` broadcasts `configChanged(configId)` across tabs in the same origin
- Tabs subscribe via `configManager.onConfigChanged(fn)` or `configManager.profiles.subscribe(scope, fn)`
- When Tab A writes config X, all tabs (including A) receive `configChanged(X)` → re-fetch from Dexie
- Fallback: best-effort; environments without `BroadcastChannel` (Node, old browsers) still work via local-only notifications

---

## 4. ConfigManager API surface

### Profile lifecycle

| Method | Returns | Purpose |
|---|---|---|
| `profiles.list(scope)` | `Promise<ProfileSnapshot[]>` | All profiles for an instance |
| `profiles.save(scope, snapshot, opts?)` | `Promise<void>` | Insert/update profile; bumps bundle version (optimistic lock) |
| `profiles.delete(scope, profileId, opts?)` | `Promise<void>` | Remove from bundle |
| `profiles.loadGridLevelData(scope)` | `Promise<unknown \| null>` | Fetch grid-level state (provider IDs, etc.) |
| `profiles.saveGridLevelData(scope, data, opts?)` | `Promise<void>` | Persist grid-level state |

`ProfilesScope` = `{ instanceId, appId?, userId? }` (appId + userId default to manager's identity).

### Config row operations

| Method | Purpose |
|---|---|
| `getConfig(id)` | Fetch single config; served from row cache if warm |
| `saveConfig(row, opts?)` | Create/update; stamps audit + sync to REST |
| `createConfig(input)` | Convenience for `saveConfig` with auto-timestamps |
| `updateConfig(id, patch, opts?)` | Read-modify-write; throws `ConfigNotFoundError` or `OptimisticLockError` |
| `deleteConfig(id)` | Delete locally + from REST |
| `getConfigsByApp(appId)` | All under an app (visibility-filtered) |
| `getConfigsByUser(userId)` | All owned by user within this app |
| `findByComponentType(type, subType?)` | Configs matching type |
| `getTemplates(type?, subType?)` | Only `isTemplate: true` rows |
| `getAllConfigs()` | All visible to current user |
| `getAllConfigsUnfiltered()` | All rows, no visibility filter (admin/export) |

### Subscriptions

- `onConfigChanged(fn)` — fires on every config write/delete (same-tab + cross-tab); returns unsubscribe
- `profiles.subscribe(scope, fn)` — fires only when this instance's bundle changes

### Identity & impersonation

- `getIdentity()` — construction-time authenticated user
- `getAppId()` — manager's deployment app
- `getApplicationContext()` — read-only sync access to AppData keys (AppId, LoggedInUser, ImpersonatedUser, profile)
- `setImpersonatedUser(user \| null)` — set/clear impersonation; subsequent visibility checks + owner stamps use the impersonated user

### Seed & reset

- `init(opts?)` — initialize; if DB empty and `seedConfigUrl` set, fetch + populate all 6 tables. Safe to call multiple times.
- `resetToSeed()` — hard reset all tables to seed file (unconditional)
- `seedConfigReload` option — `'empty-only'` (default) or `'when-changed'` (re-apply when seed digest changes)

### REST & sync

- `configServiceRestUrl?: string` — optional REST backend; writes go to REST first (with `If-Match` for optimistic locking), then mirror to Dexie
- Sync drain every 10s (configurable) — retries failed writes up to `MAX_SYNC_RETRIES` times
- `isRestMode()` / `getRestUrl()` — capability check

---

## 5. Module integration

### Module registration

There is no formal registration. A module:

1. Picks a stable `moduleId` string (e.g., `'alerts'`)
2. Versions its `data` schema
3. Migrates old state versions on deserialization
4. Reads/writes its slice through the StorageAdapter

ConfigManager is agnostic — stores/returns envelopes only.

### `useModuleDraft` (the React contract)

```ts
const [draft, isDirty, save, revert] = useModuleDraft(moduleId, snapshot, storage);
```

Under the hood:
- `storage.subscribeToChanges?.(gridId, fn)` — when the profile bundle changes (another tab saved), refetch the bundle
- `storage.saveProfile(snapshot)` — calls `configManager.profiles.save(scope, snapshot)` after merging in the draft

For cgrid (Lit), the same contract becomes a **reactive controller**:

```ts
class ModuleDraftController<T> {
  draft: T;
  dirty = false;
  constructor(host, opts: { moduleId, snapshot, storage }) { /* ... */ }
  setDraft(patch: Partial<T>) { /* merge + dirty + requestUpdate */ }
  save() { /* commit via storage; clear dirty */ }
  revert() { /* re-seed from snapshot; clear dirty */ }
}
```

### "DirtyBus"

Not a separate machinery — the profile bundle's `version` field IS the change-detection source of truth. When the bundle increments, `ChangeNotifier` fires, every subscriber refetches, and all dirty LEDs across the customizer UI update.

---

## 6. Identity, scoping, visibility

### Effective user

Two identity slots:

```ts
function getEffectiveUser(ctx: ApplicationContext) {
  return ctx.ImpersonatedUser ?? ctx.LoggedInUser;
}
```

- **LoggedInUser** — real authenticated user. Drives **audit** fields (`createdBy`, `updatedBy`) — always.
- **ImpersonatedUser** — optional admin override. Drives **visibility** and **owner stamping** (`userId` on appConfig rows).

Audit history is immutable across impersonation — you can never rewrite who actually made a change.

### Profile scope

```ts
interface ProfilesScope {
  instanceId: string;
  appId?: string;     // defaults to ConfigManager.appId
  userId?: string;    // defaults to identity.userId (or impersonated)
}
```

The triple `(instanceId, appId, userId)` identifies which row to read/write.

### Visibility predicate

```ts
function isVisible(row, ctx) {
  if (row.appId !== ctx.appId) return false;
  if (row.isPublic) return true;
  return row.userId === ctx.effectiveUserId;
}
```

Applied to every list operation. Examples:
- Alice privately saves config X. Bob sees nothing.
- Alice (impersonating Charlie) privately saves Y as Charlie. After impersonation ends, Charlie sees Y, Alice doesn't.

### Seed & seed locking

On first run (empty DB):
1. `init()` → `seedIfEmpty()`
2. Acquire exclusive Web Lock (`navigator.locks.request('starui:seed-lock:...')`)
3. Re-check emptiness inside the lock (concurrent windows wait)
4. Fetch seed JSON, normalize scope drift (fix mismatched appId/userId via `normalizeSeedData`), `bulkPut` all tables
5. Release lock

Seed JSON shape:

```ts
{
  activeAppId: 'my-app',
  activeUserId: 'alice',
  appRegistry: [/*...*/],
  userProfiles: [/*...*/],
  roles: [/*...*/],
  permissions: [/*...*/],
  appConfig: [/*...*/],  // optional, includes templates + initial workspace configs
}
```

`activeAppId` / `activeUserId` stamped onto every seeded row that lacks them.

---

## 7. Change notification

```
saveConfig() / deleteConfig()
  ↓
changeNotifier.notify(configId)
  ├─ dispatchLocal(configId)  → sync callbacks (this tab)
  └─ BroadcastChannel.postMessage({ type: 'configChanged', configId })

Other tabs:
  BroadcastChannel.onmessage
    ↓
  dispatchLocal(configId)  → fire local listeners
```

Subscription patterns:
1. **Global**: `onConfigChanged(fn)` — every config change
2. **Per-scope**: `profiles.subscribe({ instanceId }, fn)` — only this bundle

Cross-tab works within the same origin only. Best-effort fallback if `BroadcastChannel` is unavailable.

---

## 8. Audit & optimistic locking

### Audit fields

Every row carries:

```ts
createdBy: string;     // userId who first wrote the row
updatedBy: string;     // userId who last modified
creationTime: string;  // ISO 8601
updatedTime: string;   // ISO 8601
```

Stamped automatically. Callers cannot override.

Special case: `AppConfigRow.userId` is the **owner** (drives visibility). Owner stamping uses the **effective** user (impersonated if set); audit uses the **real** logged-in user (never impersonated).

### Optimistic locking

```ts
const row = await cm.getConfig('cfg-1');  // captured updatedTime: '14:00:00Z'

// Writer B wins the race:
await cm.saveConfig({ ...someRow, updatedTime: '14:05:00Z' });

// Writer A tries to save with stale updatedTime:
await cm.saveConfig(
  { ...row, payload: { v: 2 } },
  { expectedUpdatedTime: '14:00:00Z' }
);
// → throws OptimisticLockError with current row state
```

REST mode: `If-Match` header. Local mode: Dexie pre-write check. Error tells caller the current row so they can offer a merge UI.

---

## 9. Deploy / export / import

`deployExport.ts` packages a Config Browser export into a scoped bundle ready for seed:

```ts
interface DeployExportResult {
  bundle: DeployExportInput;
  warnings: DeployExportWarning[];   // 'error' | 'warn' | 'info'
  stats: DeployExportStats;
  hasErrors: boolean;
}
```

A bundle includes:
- All workspace rows (define deployed instances)
- All template rows (referenced by instances)
- Well-known rows (dock-config, component registry, appdata)
- Profile-set rows referenced by any workspace's `instanceIds` / snapshot URLs
- All auth/registry tables

Validation (`validateDeployExport`) checks:
- `activeAppId` set (error if missing)
- Workspace `instanceIds` match snapshot URLs (warn if mismatch)
- Referenced instances exist (error if missing)
- Instances have non-empty profile state (warn if `state: {}`)
- All provider IDs set (warn if missing `gridLevelData.liveProviderId`)

Normalization (`normalizeSeedData`) fixes scope drift on import — every row with mismatched `appId` ← `activeAppId`, mismatched `userId` (and not `'system'`) ← `activeUserId`. So exporting from dev app X and importing into prod app Y auto-restamps ownership.

---

## 10. Key types

| Type | File | Purpose |
|---|---|---|
| `AppConfigRow` | [types.ts](../../starui/packages/data/host-config/src/types.ts) | Component config or profile bundle row |
| `ProfileSnapshot` | [profileBundle.types.ts](../../starui/packages/data/host-config/src/profileBundle.types.ts) | One profile (id, name, state, timestamps) |
| `ProfileSetPayload` | same | Bundle payload: `{ version, profiles[], gridLevelData }` |
| `AppIdentity` | [types.ts](../../starui/packages/data/host-config/src/types.ts) | `{ userId, displayName?, getAccessToken? }` |
| `ApplicationContext` | same | AppData keys: AppId, LoggedInUser, ImpersonatedUser, Profile |
| `SeedData` | same | Seed file structure |
| `ChangeNotifier` | [changeNotifier.ts](../../starui/packages/data/host-config/src/changeNotifier.ts) | Bridges local + BroadcastChannel subscriptions |
| `ConfigDatabase` (Dexie) | [db.ts](../../starui/packages/data/host-config/src/db.ts) | IndexedDB wrapper; v1–v4 schemas |
| `ProfilesNamespace` | [profileBundle.ts](../../starui/packages/data/host-config/src/profileBundle.ts) | Profiles API (list, save, delete, grid-level data) |
| `StorageAdapter` | (in MarketsGrid) | Grid-level persistence contract |
| `VisibilityContext` | [visibility.ts](../../starui/packages/data/host-config/src/visibility.ts) | Inputs to visibility predicate |
| `OptimisticLockError` | [errors.ts](../../starui/packages/data/host-config/src/errors.ts) | Stale-write rejection |

---

## 11. cgrid integration: the API surface

cgrid should **not** ship a config manager. The host owns ConfigManager (or whatever equivalent it uses — localStorage adapter, simple in-memory, custom backend). cgrid's job is to expose a **clean state contract** any config manager can drive.

### Minimal contract (must-have)

```ts
// In cgrid/src/api.ts:

export interface VelocityGridState {
  // Opaque JSON-serializable state snapshot
  [moduleId: string]: { version: number; data: unknown };
}

export interface VelocityGridStateAPI {
  /** Capture the grid's full state as a JSON-serializable snapshot. */
  getState(): VelocityGridState;

  /** Restore from a JSON snapshot. Handles per-module migration. */
  setState(state: VelocityGridState): Promise<void>;

  /** Fire when the user (or programmatic edit) mutates state. Returns unsubscribe. */
  onStateChange(fn: () => void): () => void;
}
```

### Recommended contract (full)

```ts
export interface VelocityGridConfig extends VelocityGridStateAPI {
  /** Component identity for the host's component registry / profile bundling */
  readonly componentType: string;     // e.g., 'cgrid'
  readonly componentSubType: string;  // e.g., 'markets'

  /** Read/write a specific module slice (alerts, conditional-styling, columns, etc.) */
  getModuleState(moduleId: string): { version: number; data: unknown } | null;
  setModuleState(moduleId: string, state: { version: number; data: unknown }): Promise<void>;

  /** Subscribe to a specific module's state changes (not all changes) */
  onModuleChange(moduleId: string, fn: () => void): () => void;

  /** Dirty signal — host UI can show "unsaved changes" indicator without polling */
  isDirty(): boolean;
  onDirtyChange(fn: (dirty: boolean) => void): () => void;

  /** Lifecycle hooks the host can call (e.g., when instance is being moved or hibernated) */
  suspend?(): Promise<void>;
  resume?(): Promise<void>;
}
```

### Profile load/save choreography (the host owns this)

```ts
// In the host app:

// 1. Construct grid
const grid = new VelocityGrid({ /* initial options */ });

// 2. Load profile bundle
const profiles = await configManager.profiles.list({ instanceId: 'my-grid' });
const active = profiles.find(p => p.id === '__default__');

// 3. Restore grid state
if (active) await grid.setState(active.state);

// 4. Wire up dirty tracking
grid.onDirtyChange((dirty) => {
  saveButton.disabled = !dirty;
});

// 5. Cross-tab listener — another tab saved, reload our bundle
configManager.profiles.subscribe({ instanceId: 'my-grid' }, async () => {
  const reloaded = await configManager.profiles.list({ instanceId: 'my-grid' });
  const next = reloaded.find(p => p.id === currentId);
  if (next) await grid.setState(next.state);
});

// 6. User clicks Save
saveButton.onclick = async () => {
  const snapshot: ProfileSnapshot = {
    id: active.id,
    gridId: 'my-grid',
    name: active.name,
    state: grid.getState(),
    createdAt: active.createdAt,
    updatedAt: Date.now(),
  };
  await configManager.profiles.save({ instanceId: 'my-grid' }, snapshot);
};
```

### What cgrid should NOT do

- **No IndexedDB / localStorage / network calls in cgrid.** Host concern.
- **No identity / impersonation / visibility logic.** Host concern.
- **No cross-tab sync.** Host concern via `BroadcastChannel`.
- **No profile bundling.** cgrid produces and consumes `state` blobs; the host bundles them however it wants.
- **No "save" button** in cgrid itself — the host owns when to save (auto-save? button-driven? on unload?). cgrid just exposes `getState()` and `isDirty()`.

### What the customizer addon needs

The `@wellsfargo-starui/velocity-grid-customizer` addon does NOT talk to the host config manager directly. It reads/writes through cgrid's API:

- `grid.getModuleState(moduleId)` — to load the editor's working state
- `grid.setModuleState(moduleId, state)` — to commit the editor's draft
- `grid.isDirty()` — to enable/disable Save buttons across panels
- `grid.onModuleChange(moduleId, fn)` — for live panel updates (e.g., if alerts is edited in panel A, panel B's rule count refreshes)

The host's config manager subscribes to cgrid's overall state changes (via `onStateChange()`) and decides when to persist. The addon doesn't need to know whether persistence is IndexedDB, REST, or memory.

### Gaps to close

1. **Module state versioning** — cgrid needs to formalize the `{ version, data }` envelope for each module so old profiles can migrate.
2. **`isDirty()` aggregation** — must aggregate dirty signals across all modules (alerts, conditional-styling, etc.). Implement as a `Set<moduleId>` of dirty modules + a `dirty` getter.
3. **`onModuleChange` granularity** — currently most grids only emit a coarse "something changed" event. Per-module change events let the addon's editor panels update independently without re-rendering each other.
4. **State migration hooks** — when `setState()` is called with an older `version`, cgrid should run registered migration functions per module before applying. Without this, schema evolution breaks old profiles.

### Recommendation: ship a `MemoryStorageAdapter` in cgrid for tests/demos

Even though cgrid doesn't ship a real config manager, having a tiny `MemoryStorageAdapter` (~30 LOC) bundled lets:

- Unit tests work without IndexedDB mocks
- The cgrid-showcase app run without a config backend
- Documentation examples be self-contained

```ts
// cgrid/src/api.ts:
export class MemoryStorageAdapter implements StorageAdapter {
  private profiles = new Map<string, ProfileSnapshot[]>();
  // ... list, save, delete, subscribe — all in-memory
}
```

For production, hosts implement their own `StorageAdapter` against ConfigManager, localStorage, REST, or whatever. cgrid stays storage-agnostic.
