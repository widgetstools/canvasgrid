# VelocityGrid Lab — server-side row model

A 19-tab onboarding lab for **VelocityGrid + VelocityGridExt**, running a
fixed-income credit blotter. One feature per tab, on real ticking data, with
the configuration that produces it shown underneath the grid.

```bash
npm run dev:lab-ssrm     # http://localhost:5302
npm run typecheck --workspace=velocitygrid-lab-ssrm
npm run test --workspace=velocitygrid-lab-ssrm
```

No broker required. The grid never holds the book here — it holds a **window**.
A datasource owns the filtering, sorting, grouping and aggregation, and the grid
asks it three questions: what groups exist, what leaves sit under this one, and
what rows fill this flat window.

The one thing worth watching for, because people expect it to be slow and it is
not: **expanding a group costs no request**. The kernel owns the group skeleton
and the expansion state, so a toggle reflows in the same frame and a collapse
needs zero calls.

That datasource answers from an in-memory book so the lab opens with nothing
running. It is a stand-in for a Perspective engine or an HTTP endpoint, not the
product — and swapping it changes nothing above the datasource boundary, which
is the property the boundary exists to give you.

The [client-side lab](../velocitygrid-lab-csrm) is the same 19 tabs against the
same blotter with the whole book in the tab. Run both to see which interactions
change and which do not.

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
- **[`src/data/ssrmDatasource.ts`](./src/data/ssrmDatasource.ts)** — the v2
  datasource contract implemented in full: `getGroupSkeleton` (every group at
  every depth, pre-aggregated, plus the grand total as `path: []`),
  `getLeafRows`, `getRows`, and `getGroupLeafIds` for selection over leaves that
  were never loaded.
- **[`src/data/scenarios.ts`](./src/data/scenarios.ts)** — market events the demo
  console injects as sparse overlays (duration rally, credit selloff, sector
  downgrade, liquidity gap, curve steepener).

## Feeds

Default is the in-tab generator behind the datasource. The production shape of
this path is a Perspective engine in a SharedWorker holding one table per
origin, with the STOMP feed running inside the same worker — see
[`docs/ssrm-shared-engine-architecture.md`](../../docs/ssrm-shared-engine-architecture.md)
and `npm run dev:ssrm-provider` for that wiring.
