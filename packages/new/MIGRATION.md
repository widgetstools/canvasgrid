# Migration — legacy → `packages/new`

## Import map

| Legacy package | New package |
|----------------|-------------|
| `@wellsfargo-starui/velocity-grid` | `@wellsfargo-starui/vg-new-grid` |
| `@wellsfargo-starui/velocity-grid-ext` | `@wellsfargo-starui/vg-new-ext` |
| `@wellsfargo-starui/velocity-grid-customizer` | _(removed — absorbed into vg-new-ext)_ |
| `@wellsfargo-starui/velocity-grid-data` | `@wellsfargo-starui/vg-new-data` |
| `@wellsfargo-starui/velocity-grid-appdata` | `@wellsfargo-starui/vg-new-appdata` |
| `@wellsfargo-starui/velocity-grid-perspective` | `@wellsfargo-starui/vg-new-perspective` |
| `@wellsfargo-starui/velocity-grid-{calc,rules,format,edit}` | `@wellsfargo-starui/vg-new-engines` |

## Persistence keys

| Plane | Legacy | New |
|-------|--------|-----|
| AppData | `vg-appdata` | `vg-new:appdata` |
| Provider catalog | `vg-data:provider-catalog` | `vg-new:provider-catalog` |
| Instance | `velocity-grid:instance:<id>` | `vg-new:instance:<id>` |
| Feed stop epoch | `cgrid-ssrm:feed-stop:*` | `vg-new:feed-stop:*` |

Migrators (to be run once at cutover) copy legacy keys → new keys when new key is absent.

## API deltas (intentional)

- Unified selection API only (no legacy `rowSelection` dual config)
- One filter-model shape
- Sparse SSRM = v2 skeleton path; pipeline mode is explicit `serverSideEnableClientSidePipeline: true`
- Pivot fail-closed on sparse SSRM
- `destroy()` on Perspective provider always detaches expression host

## Demo cutover

| Legacy app | New app | Port |
|------------|---------|------|
| `cgrid-ext-demo` | `cgrid-new-ext-demo` | 5211 |
| `cgrid-perspective-ssrm-sample` | `cgrid-new-perspective-ssrm` | 5212 |
| _(new)_ | `cgrid-new-csrm` | 5210 |

## Deprecation

After parity e2e green on new demos:

1. Mark legacy packages `"deprecated": true` in package.json
2. Point docs to `packages/new/README.md`
3. Remove legacy packages in a follow-up major

## Status

Greenfield packages are scaffolded and behaviorally bootstrapped (CSRM paint, SSRM engine contracts, Ext shell on vg-new-ui, Perspective seed book, engines, data catalog). Full pass-for-pass parity with legacy continues against [`INVENTORY.md`](INVENTORY.md).
