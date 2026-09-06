# VelocityGrid Lab — client-side row model

A 19-tab onboarding lab for **VelocityGrid + VelocityGridExt**, running a
fixed-income credit blotter. One feature per tab, on real ticking data, with
the configuration that produces it shown underneath the grid.

```bash
npm run dev:lab-csrm     # http://localhost:5301
npm run typecheck --workspace=velocitygrid-lab-csrm
npm run test --workspace=velocitygrid-lab-csrm
```

No broker required. The book is generated and ticked in-tab, which is also the
honest picture of what this row model is: **the tab holds every row**, and the
grid's own worker does the filtering, sorting, grouping and aggregation over it.

The [server-side lab](../velocitygrid-lab-ssrm) is the same 19 tabs against the
same blotter with the book behind a datasource. Run both to see which
interactions change and which do not.

## Tabs

| Area | Tabs |
|---|---|
| Getting started | Overview (everything on at once) |
| Formatting & paint | Formatting (Excel format strings), Cell renderers (51 canvas renderers), Format toolbar, Conditional styling |
| Columns | Column groups, Calculated columns, Expression lab, Saved filters |
| Data | Live updates, Grouping & totals, Pivot, Alerts |
| Editing | Editing, Bulk update, Plus/minus, Shortcuts, Change history |
| State | Profiles & layouts, Export |

## How it is put together

- **[`src/data/domain.ts`](./src/data/domain.ts)** — the blotter: 54 fields per
  row, generated from a seeded PRNG so the book is identical on every reload.
  The relationships are real (yield inverse to price, spread banded off rating,
  DV01 from duration and notional), because a demo that ticks nonsense teaches
  the grid but not the domain.
- **[`src/data/columns.ts`](./src/data/columns.ts)** — column defs. Formatting is
  Excel format strings (`#,##0.000`, `#,##0;[Red](#,##0)`), which compile in the
  worker and survive a profile round-trip, rather than JS formatter callbacks.
- **[`src/lab/catalog.ts`](./src/lab/catalog.ts)** — every tab, as data: its
  columns, its grid options, and its Inspector guidance. Adding a tab is adding
  an entry; there is no per-tab React.
- **[`src/grid/VelocityLabGrid.tsx`](./src/grid/VelocityLabGrid.tsx)** — the
  React host. It mounts the grid once and hands ownership over; props changing
  never remount it, because that would throw away the worker and the raster
  cache.
- **[`src/data/scenarios.ts`](./src/data/scenarios.ts)** — market events the demo
  console injects as sparse overlays (duration rally, credit selloff, sector
  downgrade, liquidity gap, curve steepener).

## Feeds

Default is the in-tab generator. `?feed=stomp` routes through
`DataServicesHub` — the CSRM data hub SharedWorker, one socket and one
`RowCache` per origin — and needs `npm run dev:stomp`.
