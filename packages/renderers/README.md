# `@cgrid/renderers`

Rich canvas cell renderers for financial blotters — numeric tick-aware
cells, indicators, badges, bars, in-cell sparklines, multi-field
composites, and action clusters.

**Status:** Cycle 21f — 46 catalog painters + 5 kernel sparkline
re-exports (51 registered names). Zero kernel changes; ColumnStats and
TickHistory are main-side helpers wired through the bridge.

Design spec: `docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md`

## Quickstart

```ts
import { CGrid } from '@cgrid/kernel';
import { wireIntoKernel as wireFormat } from '@cgrid/format';
import { wireRenderersIntoKernel } from '@cgrid/renderers';

const grid = new CGrid(host, { columnDefs: [], getRowId: (r) => r.id });

// Wire format first when columns use DSL format strings.
wireFormat(grid);

// Seed row data before stats/history helpers scan the row set.
grid.setRowData(rows);

const { colDef, stats, history } = wireRenderersIntoKernel(grid, {
  statsColumns: ['pnl', 'qty'],
  historyColumns: { spread: { window: 30 } },
});

// Optional — map DOM mouse coords to canvas space for action hit regions.
grid.canvasCoordsFromEvent = (mouse) => {
  const rect = host.querySelector('canvas')!.getBoundingClientRect();
  return { x: mouse.clientX - rect.left, y: mouse.clientY - rect.top };
};

grid.updateGridOptions({
  columnDefs: [
    colDef.price('price', { prevField: 'prevPrice' }),
    colDef.heat('pnl'),
    colDef.renderer('volume-bar', 'qty'),
    colDef.renderer('spread-bar', 'spread', { bidField: 'bid', askField: 'ask' }),
    colDef.iconActionCluster('actions', {
      actions: [{ icon: 'x', label: 'Cancel', onAction: (rowId) => cancel(rowId) }],
    }),
  ],
});
```

`wireRenderersIntoKernel` is idempotent — re-calling on the same grid
returns the same handle (`grid.__renderersBridgeWired` marker).

## Bridge handle

| Member | Purpose |
|---|---|
| `colDef.renderer(name, field, params?, opts?)` | Typed ColDef for any `RendererName` |
| `colDef.price / heat / age / relativeTime / priceQuote` | Shorthand builders |
| `colDef.iconActionCluster / rowMenu` | Action columns (no rowData threading stub) |
| `stats.for(colId)` | Column-wide min/max/maxAbs snapshot (when `statsColumns` wired) |
| `history.get(rowId, colId)` | Rolling tick history array (when `historyColumns` wired) |
| `destroy()` | Clears age refresh timer, stats/history subscriptions |

## RowData threading (minimal composite)

Multi-field painters read `p.rowData` via the kernel's composite paint
channel. The bridge attaches a minimal `_compositeProgram` stub
(`THREADING_PROGRAM`) — **without** `type: 'composite'`, so
`@cgrid/format` does not attempt fragment compilation. Explicit
`cellRenderer` always wins over the composite fallback.

Value-only painters (`number`, sparklines, etc.) omit the stub.

## ColumnStats + TickHistory

Both helpers live on the main thread and subscribe to `rowsChanged`:

- **ColumnStats** — incremental min/max/maxAbs/sum/count per watched
  `colId` over the full row set (`scope: 'all'`). Injected into bar
  painters via `cellRendererSelector` as `params.stats`.
- **TickHistory** — bounded `Float64Array` ring buffers per
  `(rowId, colId)` for opted-in columns. Injected into `spread-bar`
  and sparkline columns as `params.history`.

Instantiate the bridge **after** initial `setRowData` so seed scans
see rows.

## Renderer catalog

Canonical names live in `RENDERER_NAMES` (51 entries). Categories:

| Category | Examples |
|---|---|
| Numeric | `price`, `pnl`, `delta`, `bps`, `fractional-price` |
| Text | `ticker`, `currency-pair`, `timestamp`, `age` |
| Indicators | `status-dot`, `traffic-light`, `stale-flag`, `structure-icon-strip` |
| Badges | `status-pill`, `rating-badge`, `venue-chip`, `side-chip` |
| Bars | `heat`, `volume-bar`, `progress-bar`, `spread-bar` |
| Charts | `line-sparkline`, `win-loss-sparkline`, + 5 kernel re-exports |
| Composite | `stacked-value`, `price-quote`, `nbbo`, `benchmark-spread` |
| Actions | `icon-action-cluster`, `row-menu` |

Visual contracts: `docs/superpowers/plans/2026-07-01-canvasgrid-cell-renderer-catalog.md`

## Action hit routing

Register hit regions inside painters via `registerHitRegion`. The
bridge listens for `cellClicked`, maps mouse → canvas coords, resolves
the region, and dispatches `IconActionSpec.onAction` or
`RowMenuCellParams.onOpen`.

## Showcase demos

- `/?feature=renderer-blotter` — numeric/text/indicator/badge/action painters
- `/?feature=renderer-charts` — bars, sparklines, composites with stats/history

E2E probes: `window.__cgridRenderers`, resolved `columnDefsMap` renderer
names, canvas presence. Canvas pixel parity is covered by fake-gc unit
tests — Playwright does not assert painted pixels.

## Dependencies

- **peer:** `@cgrid/kernel`
- **runtime:** `@cgrid/format` (format bridge should be wired when columns use DSL strings)

## Verification gates (cycle 21f)

```bash
npm run typecheck          # 21/21 packages
npm run lint               # root eslint
npm run build              # 13/13 packages
cd packages/renderers && npm test
cd apps/cgrid-showcase && npm run test:e2e   # 131 baseline + 12 new
git diff main...HEAD -- packages/kernel packages/{expression,format,rules,calc}  # must be empty
```
