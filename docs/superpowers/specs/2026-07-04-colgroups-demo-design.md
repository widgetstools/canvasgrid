# Design: `apps/colgroups` — AG-Grid Column Grouping Showcase

**Date:** 2026-07-04
**Status:** Approved (brainstorming) — ready for implementation plan

## Purpose

A standalone React demo app under `apps/colgroups` that demonstrates the full
range of AG-Grid **column grouping** use cases in a single "kitchen-sink" grid,
rendered in a **dark theme**. It is a pedagogical catalog: each top-level column
structure is chosen to isolate one grouping permutation, and one centerpiece
group mixes individual fields *and* nested sub-groups, each independently set to
always-visible / open-only / closed-only.

## Stack & Conventions

Mirror the existing `apps/showcase` app:

- React 19 + Vite 7, TypeScript ~5.9.
- `ag-grid-react` / `ag-grid-community` **35.3.1** using the new Theming API
  (`themeQuartz.withParams(...)`) — **no** legacy CSS theme imports.
- Community modules only. `columnGroupShow`, `openByDefault`, and
  `marryChildren` are all AG-Grid Community features, so **no enterprise license
  is required**. Register `AllCommunityModule` in `agGridSetup.ts`.
- Dev server on **port 5175** (showcase uses 5174), `open: true`.
- Add a `dev:colgroups` script to the root `package.json`.

## Dark Theme

Reuse the proven `quartzDark` params from `apps/showcase`:

- `browserColorScheme: 'dark'`, `backgroundColor: '#1a1f2e'`,
  `foregroundColor: '#e2e8f0'`, `accentColor: '#2dd4bf'`.
- `headerBackgroundColor: '#0f1320'`, `headerFontWeight: 600`.
- `columnBorder: true`, `oddRowBackgroundColor: '#1e2436'`, Inter Google font,
  `spacing: 6`, `wrapperBorderRadius: 4`.
- The page shell itself (body, header, legend, buttons) is dark to match.

## Grid Structure — 7 top-level column structures

One grid. Each entry isolates a grouping permutation.

| # | Column structure | Feature demonstrated |
|---|---|---|
| 1 | `Position ID` — plain column, pinned left, **no group** | flat column beside groups |
| 2 | **Instrument** group → instrument, cusip, assetClass (all always-visible) | fields-only group, **not expandable** (no caret) |
| 3 | **Book & Coverage** group, `openByDefault: false` → book (always), desk (`open`), trader (`open`), region (`closed`) | expandable group **closed by default**; always / open / closed leaf children |
| 4 | **Valuation** group, `openByDefault: true` → price (always), mtm (`open`), currency (`open`), prevClose (`closed`) | expandable group **open by default** |
| 5 | **P&L** group → marketValue (always), dayPnl / mtdPnl / ytdPnl (all `open`) | group revealing extra columns only when opened |
| 6 | **Risk & Analytics** group (`marryChildren`) — the centerpiece (see below) | one group mixing individual fields AND nested column groups, each in always / open / closed state |
| 7 | **Metadata** group (`marryChildren`) → sector, rating, maturity, updatedAt | fields-only group locked together |

### Centerpiece — group #6 "Risk & Analytics"

A single top-level group (`marryChildren: true`) whose children are a **mix of
leaf fields and nested sub-groups**, each element independently pinned to a
`columnGroupShow` state:

- `dv01` — individual field — **always visible** (no `columnGroupShow`)
- `cr01` — individual field — `columnGroupShow: 'open'`
- `duration` — individual field — `columnGroupShow: 'closed'`
- **Exposure** sub-group — **always visible** — children: grossExp, netExp
- **Greeks** sub-group — `columnGroupShow: 'open'` — children: delta, gamma, vega, theta
- **Scenario** sub-group — `columnGroupShow: 'closed'` — children: up100bp, down100bp

This proves that within one parent group you can have individual fields *and*
column groups, each of which can be always visible, shown only when the parent
is open, or shown only when the parent is closed.

## Data

`src/data.ts` generates ~200 synthetic position rows. Fields:

- Identity: positionId, instrument, cusip, assetClass
- Coverage: book, desk, trader, region
- Valuation: price, mtm, prevClose, currency
- P&L: notional, marketValue, dayPnl, mtdPnl, ytdPnl
- Risk: dv01, cr01, duration, grossExp, netExp, delta, gamma, vega, theta, up100bp, down100bp
- Metadata: sector, rating, maturity, updatedAt

`valueFormatter`s for currency, plain number, and basis-point values; P&L cells
colored red/green via `cellClassRules` (or a small `cellStyle`) so the dark grid
reads as a polished trading blotter.

## Page Shell

- Dark page with a title + one-line intro.
- A **legend chip strip** explaining the three states (a chip each for
  "always visible", "shows when open ▸", "shows when closed") and the caret.
- **Expand all groups** / **Collapse all groups** buttons that iterate provided
  column groups via `api.setColumnGroupOpened(groupId, open)` (or the documented
  35.x column-group API), so users can watch the open/closed columns swap.
- Full-height grid below.

## Files

```
apps/colgroups/
  package.json            # name "colgroups", vite scripts, port 5175
  index.html              # dark <body>, Inter preconnect, #root
  vite.config.ts          # react plugin, server.port 5175, open
  tsconfig.json
  tsconfig.node.json
  src/
    main.tsx              # createRoot + agGridSetup + styles import
    agGridSetup.ts        # ModuleRegistry.registerModules([AllCommunityModule])
    App.tsx               # page shell: header, legend, buttons, grid
    columnDefs.ts         # the 7 structures incl. centerpiece group #6
    data.ts               # synthetic rows + formatters
    styles.css            # dark page chrome (not the grid — grid is themed via API)
    vite-env.d.ts
```

Root `package.json`: add `"dev:colgroups": "npm run dev --workspace=colgroups"`.

## Testing / Verification

- `npm run dev:colgroups` starts cleanly, no console errors.
- Browser-driven check (per repo's E2E-for-UI bar): grid renders in dark theme;
  group #3 collapsed by default with a caret; group #4 open by default; toggling
  a group swaps its open/closed columns; group #6 shows dv01 + Exposure sub-group
  when collapsed and additionally cr01 + Greeks when opened (and duration +
  Scenario when the collapsed-only variant is shown); Expand/Collapse-all buttons
  work.
- `tsc --noEmit` passes for the app.

## Non-Goals (YAGNI)

- No enterprise features (row grouping / pivot / sidebar).
- No live data feed — static synthetic snapshot only.
- No multiple grids — single kitchen-sink grid per the chosen layout.
