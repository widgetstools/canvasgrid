# StarUI Platform — Data Providers & Config Manager

This folder documents the **two host-level subsystems** the cgrid customizer architecture sits on top of:

- **Data Providers** — how data flows into the grid (live streams, snapshots, historical mode, switching). Lives in starui's `packages/data/host-data/`.
- **Config Manager** — how customizer state (profiles, module settings, identity, visibility) is persisted, synced across tabs, and migrated across schema versions. Lives in `packages/data/host-config/`.

Both are **host concerns**, not grid concerns. cgrid should not ship its own data provider or config manager — those belong to the application embedding cgrid. cgrid's job is to **expose the right surfaces** so a data provider can drive its row state and a config manager can drive its profile state.

Companion folders:
- [../starui-customizer/](../starui-customizer/) — the engine layer (lives in cgrid core)
- [../starui-customizer-ui/](../starui-customizer-ui/) — the `@cgrid/customizer` UI addon

---

## Where these fit in the architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Host Application                            │
│  ┌────────────────────────┐         ┌────────────────────────────┐  │
│  │  Data Provider         │         │  Config Manager            │  │
│  │  (host-data)           │         │  (host-config)             │  │
│  │  • SharedWorker hub    │         │  • IndexedDB (Dexie)       │  │
│  │  • STOMP / REST / etc. │         │  • Profile bundles         │  │
│  │  • Snapshot + ticks    │         │  • Identity + visibility   │  │
│  │  • Live/Historical     │         │  • Cross-tab sync          │  │
│  └───────────┬────────────┘         └─────────────┬──────────────┘  │
└──────────────┼─────────────────────────────────────┼─────────────────┘
               │ row data + schema                   │ getState/setState
               │ (transactions)                      │ (profile snapshots)
               ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          cgrid (core)                                │
│  • Public API surface (api.ts)                                       │
│  • Engine layer (expression engine, format, edit journal, ...)       │
│  • Canvas rendering                                                  │
└──────────────────────────────────────────────────────────────────────┘
               ▲
               │ drives via api.ts
               │
┌──────────────────────────────────────────────────────────────────────┐
│                  @cgrid/customizer (addon)                           │
│  • UI editors (panels, dialogs, toolbars)                            │
│  • Lit + Web Awesome web components                                  │
└──────────────────────────────────────────────────────────────────────┘
```

**cgrid sits between** the host's data provider (feeding it rows) and the host's config manager (feeding it state). It must expose two clean integration seams:

1. **Data ingress** — a way for the host to push row data (snapshots + incremental updates) into the grid efficiently
2. **State egress/ingress** — a way for the host to read the grid's current state as JSON and restore from a JSON snapshot

Both seams need to live in `cgrid/src/api.ts` (the public contract documented in [../starui-customizer/README.md](../starui-customizer/README.md#public-api-surface-the-contract)).

---

## The two docs

- **[01-data-providers.md](01-data-providers.md)** — Full starui data layer: hub-spoke SharedWorker architecture, ProviderEmit / IDataProvider contracts, transport types (STOMP, REST, Mock, WebSocket, AppData), snapshot vs delta semantics, live/historical switching with as-of-date templating, throttling + conflation, key column identity, bootstrap lifecycle. Includes recommended cgrid API surface for data ingress.

- **[02-config-manager.md](02-config-manager.md)** — Full starui config layer: ConfigManager with IndexedDB persistence, profile bundle structure, per-module state slicing with schema versioning, identity + impersonation + visibility, optimistic locking, cross-tab BroadcastChannel sync, seed data + migrations, deploy export/import. Includes recommended cgrid API surface for state management.

---

## Key principle: cgrid as a *consumer*, not an *implementer*

Both subsystems are **already solved** in starui. cgrid doesn't need to:
- Ship its own data provider plumbing (SharedWorker, hub, transports) — too opinionated, too host-specific
- Ship its own config manager (IndexedDB, REST sync, identity, visibility) — same reason
- Reimplement live/historical switching — the host orchestrates it

cgrid **does** need to:
- Accept row data in a form that fits the host's data port (`applyTransaction`-style upserts with key-column identity)
- Surface complete JSON state for the host to persist (`getState()` / `setState()`)
- Emit change events the host can listen to (`onStateChange()`)
- Stay lifecycle-friendly (start, suspend, resume, dispose)

That's the API contract these docs spec out, alongside [the customizer engine docs](../starui-customizer/).

---

## What the addon needs from these

`@cgrid/customizer` mostly doesn't talk to the data provider or config manager directly — it talks to **cgrid's public API**. Two exceptions:

1. **Some panels need column metadata** that ultimately comes from the data provider (column names, data types). cgrid should re-expose this via `grid.getColumnSchema()` rather than the addon reaching into the provider.
2. **Dirty/save UX** needs to know whether the host's config manager is in REST mode (network delay) or local mode (instant). cgrid should re-expose this via `grid.getProfileMode()` or have the host configure save semantics on the addon directly.

In both cases the pattern is: addon ↔ cgrid API ↔ host subsystem. The addon never directly imports `host-data` or `host-config`.
