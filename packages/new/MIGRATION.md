# Migration — legacy → `packages/new`

> **Not yet actionable.** `packages/new` is a prototype at roughly 5% of legacy behavior
> (see [`INVENTORY.md`](INVENTORY.md)). Legacy `@wellsfargo-starui/velocity-grid*` remains
> the production implementation and is **not** deprecated. This document is the target
> shape of the migration, kept ahead of the rebuild so the seams stay honest.

## Import map

| Legacy package | New package |
|----------------|-------------|
| `@wellsfargo-starui/velocity-grid` | `@wellsfargo-starui/vg-new-grid` |
| `@wellsfargo-starui/velocity-grid-ext` | `@wellsfargo-starui/vg-new-ext` |
| `@wellsfargo-starui/velocity-grid-customizer` | _(removed — absorbed into vg-new-ext)_ |
| `@wellsfargo-starui/velocity-grid-data` | `@wellsfargo-starui/vg-new-data` |
| `@wellsfargo-starui/velocity-grid-appdata` | `@wellsfargo-starui/vg-new-appdata` |
| `@wellsfargo-starui/velocity-grid-perspective` | `@wellsfargo-starui/vg-new-perspective` |
| `@wellsfargo-starui/velocity-grid-{calc,rules,format,edit,expression}` | `@wellsfargo-starui/vg-new-engines` |

### Host bootstrap sketch

```ts
import { migrateLegacyPersistence } from '@wellsfargo-starui/vg-new-appdata';
import { VelocityGrid } from '@wellsfargo-starui/vg-new-grid';
import { VelocityGridExtShell } from '@wellsfargo-starui/vg-new-ext';
import { DataProviderController, SEED_PROVIDERS } from '@wellsfargo-starui/vg-new-data';

migrateLegacyPersistence(); // idempotent LS copy

const shell = new VelocityGridExtShell(host, {
  gridId: 'my-grid',
  getGridApi: () => api,
  dataProvider,
});
const grid = new VelocityGrid(shell.getGridHost(), { columnDefs, rowData, getRowId });
```

## Persistence keys

| Plane | Legacy | New |
|-------|--------|-----|
| AppData | `vg-appdata` (+ `:namespace`) | `vg-new:appdata` (+ `:namespace`) |
| Provider catalog | `vg-data:provider-catalog` | `vg-new:provider-catalog` |
| Instance | `velocity-grid:instance:<id>` | `vg-new:instance:<id>` |
| Feed stop epoch | `cgrid-ssrm:feed-stop:*` | `vg-new:feed-stop:*` |

### Migrator

```ts
import { migrateLegacyPersistence } from '@wellsfargo-starui/vg-new-appdata';

const report = migrateLegacyPersistence();
// report.copied / report.skipped — never overwrites existing vg-new:* keys
```

New demos call this once at boot. Safe to leave in place permanently.

## API deltas (intentional)

| Area | Legacy | New |
|------|--------|-----|
| Entry | `VelocityGrid` + Lit customizer | `VelocityGrid` + `VelocityGridExtShell` on `vg-new-ui` |
| Selection | Dual `rowSelection` shapes | Unified selection API (`getSelectedRows`, group cascade) |
| Filter model | Mixed AG / Markets shapes | One filter-model shape on CSRM pipeline |
| SSRM | v1 + v2 paths | Sparse v2 skeleton; pipeline only when `serverSideEnableClientSidePipeline: true` |
| Pivot | Soft-fail / partial | Fail-closed on sparse SSRM |
| Engines | Separate calc/rules/format/edit packages | Single `@wellsfargo-starui/vg-new-engines` + `EnginesHost` |
| Customize grammar | Mixed save paths | Draft → Validate → Apply/Save (`ConfigSession`) |
| Data bind | Hub + controllers | `DataProviderController` + `bindProviderToGrid` + AppData resolve |
| Perspective destroy | Expression host edge cases | `destroy()` always detaches expression host |

## Demo cutover

| Legacy app | New app | Port | Dev script |
|------------|---------|------|------------|
| `cgrid-ext-demo` | `cgrid-new-ext-demo` | 5211 | `npm run dev:new-ext-demo` |
| `cgrid-perspective-ssrm-sample` | `cgrid-new-perspective-ssrm` | 5212 | `npm run dev:new-perspective-ssrm` |
| _(new)_ | `cgrid-new-csrm` | 5210 | `npm run dev:new-csrm` |

Parity checklist for the Ext surface:
[`apps/cgrid-new-ext-demo/e2e/parity/CHECKLIST.md`](../../apps/cgrid-new-ext-demo/e2e/parity/CHECKLIST.md)

Run greenfield unit tests:

```bash
npm run test:new
```

## Deprecation

Nothing is deprecated. Preconditions for that step live in
[`DEPRECATION.md`](DEPRECATION.md).

## Status

Prototype. The rebuild method is: extract the behavior spec from each legacy module,
re-implement it cleanly (collapsed dual paths, no god object, one design system), then
port the legacy tests as the parity gate. A feature is only complete when those tests
pass — see [`INVENTORY.md`](INVENTORY.md) for the per-feature truth.
