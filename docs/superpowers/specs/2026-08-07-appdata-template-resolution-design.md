# AppData store + `{{name.key}}` template resolution

**Date:** 2026-08-07  
**Status:** Implemented (minimal)  
**Markets reference:** `stern-bak/packages/data/host-data/src/runtime/template/resolver.ts`  
**Package:** `@wellsfargo-starui/velocity-grid-appdata` (future: `@wellsfargo-starui/velocity-grid-data` AppData slice)

## Goal

Host-side key/value context (e.g. `SessionContext.userId`) that config strings can reference via Markets-compatible tokens, resolved before STOMP / datasource attach.

## Grammar (Markets-compatible)

- Token: `{{providerName.key}}` or nested `{{providerName.a.b.c}}`
- Lookup: `get(providerName, key)` then optional object walk for dotted remainder
- Unresolved tokens stay **verbatim** (debug affordance)
- `resolveCfg` deep-walks objects/arrays; string leaves only
- `assertAppDataResolved` fail-closed gate before broker wire

## API

```ts
const appData = new AppDataStore();
appData.set('SessionContext', 'userId', 'jdoe');

resolveTemplate(
  'w2w222w2w;userId={{SessionContext.userId}}',
  appData.lookup,
); // → 'w2w222w2w;userId=jdoe'

const cfg = resolveCfg({ wsUrl: 'ws://host/{{SessionContext.userId}}' }, appData.lookup);
```

`AppDataStore`: `get` / `set` / `delete` / `subscribe` / `snapshot` / `lookup`.

## Integration

`StompPerspectiveProvider` accepts optional `appData?: AppDataLookup | AppDataStore` and runs `resolveCfg` over string config fields before book/feed connect. Unresolved tokens throw via `assertAppDataResolved` when `appData` is supplied (fail closed).

## Non-goals (this cut)

- SharedWorker / IndexedDB persistence (Markets hub)
- Provider catalog UI
- Auto re-attach on AppData mutation (host can subscribe + restart)
