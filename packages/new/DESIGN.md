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
| `serverSide` sparse | Host (Perspective View) owns query; grid owns block cache + paint | Default Markets path |
| `serverSide` + `clientPipeline: true` | Full hydrate then CSRM passes | Explicit; fail closed if incomplete |

### Merge / ticks

- One helper: `mergeRowFields` — skip `null` / `undefined`
- Soft refresh merges by **row id**, never slot index
- Soft-refresh pacing runs **inside** the SSRM op chain; bail on generation change
- Live patches apply before soft refresh (rules / flash see `rowsChanged`)

### Feed epoch

- Diagnostics Stop writes shared stop epoch (localStorage) **before** releasing Web Lock
- Lock takeover of a live book = **resume live only** (no STOMP resnapshot)
- Per-view pending live batches

### Config planes (meanings preserved)

| Plane | Key prefix (new) |
|-------|------------------|
| AppData | `vg-new:appdata` |
| Provider catalog | `vg-new:provider-catalog` |
| Grid instance | `vg-new:instance:<gridId>` |

### UI grammar

Draft → Validate → Apply/Save. Dirty discard on Customize rail switch. Ribbon format undo until layout save (explicit exception).

### Forbidden dual paths

- No Lit `customizer` package
- No second Smart Edit / ExpressionEditor
- No forked Data Provider Customize panels (Perspective is a bind strategy)
- No SSRM v1 controller long-term (thin datasource shim only if needed)
