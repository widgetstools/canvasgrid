# Design — VelocityGrid Greenfield

## Layering

```
vg-new-ext (shell) ──► vg-new-ui
        │
        ▼
vg-new-grid (ApiFacade → RowModel → Paint / Worker / SSRM)
        │
        ├── vg-new-data (hub + catalog) ──► vg-new-appdata
        └── vg-new-perspective (Book / Views / SharedWorker)
                │
                └── vg-new-engines (calc / rules / format / edit / alerts)
```

## Contracts (must not violate)

### Row models

| Mode | Ownership | Notes |
|------|-----------|--------|
| `clientSide` | Worker pipeline Filter→Group→Pivot→Sort→Agg→Viewport | Full book |
| `serverSide` sparse | Host (Perspective View) owns query; grid owns FlattenIndex + block cache + paint | Default Markets path — `getGroupSkeleton` / `getLeafRows` / `getGroupLeafIds` |
| `serverSide` + `clientPipeline: true` | Full hydrate then CSRM passes | Explicit via `ensureFullyHydrated`; fail closed if incomplete / grouped |

### Merge / ticks

- One helper: `mergeRowFields` — skip `null` / `undefined`
- Soft refresh merges by **row id**, never slot index
- Soft-refresh pacing runs **inside** the SSRM op chain; bail on generation change
- Live patches apply before soft refresh (rules / flash see `rowsChanged`)

### Feed epoch / SharedWorker

- Diagnostics Stop writes shared stop epoch (localStorage) **before** releasing Web Lock
- Lock takeover of a live book = **resume live only** (no resnapshot)
- SharedWorker host: `packages/new/perspective/src/sharedServer.worker.ts` (one session per port)
- Bootstrap: `@wellsfargo-starui/vg-new-perspective/bootstrap` (shared → dedicated fallback)
- Per-view pending live batches; page-level book share by `providerId`
- Sample: `?engine=wasm` · `?groupBy=desk,region` · `?worker=dedicated`

### Config planes (meanings preserved)

| Plane | Key prefix (new) |
|-------|------------------|
| AppData | `vg-new:appdata` |
| Provider catalog | `vg-new:provider-catalog` |
| Grid instance | `vg-new:instance:<gridId>` |

### Engines (`vg-new-engines`)

- Shared expression DSL (`[field]` paths) powers calc / rules / alerts
- Format: template codes (`0.00`, `currency`, `%`) + ribbon patches with undo/redo
- Rules: condition compile → paint style; Alerts: same conditions + token bucket + templates
- Calc: CSRM enrich + `toPerspectiveExpressions()` for SSRM; rejects calc-on-calc
- Edit: smart/bulk/nudge/shortcuts journal with undo/redo; cell editor overlay on dblclick
- Grid DI: `EnginesController` on `VelocityGrid`; Ext ribbons call format/edit APIs

### UI grammar

Draft → Validate → Apply/Save. Dirty discard on Customize rail switch. Ribbon format undo until layout save (explicit exception).

### Forbidden dual paths

- No Lit `customizer` package
- No second Smart Edit / ExpressionEditor
- No forked Data Provider Customize panels (Perspective is a bind strategy)
- No SSRM v1 controller long-term (thin datasource shim only if needed)
