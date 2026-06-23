# AG Grid Feature Catalog — Design

**Date:** 2026-06-22
**Status:** Design (awaiting user review)
**Cycle:** Research catalog only — first of a multi-cycle program toward a canvas-based grid

---

## 1. Problem & motivation

The goal of the larger program is to build a canvas-based grid that matches AG Grid's feature surface and look-and-feel, with all data manipulation (sort, filter, group, aggregate, pivot) executed in a Web Worker and only viewport rows/columns rendered on the main thread. That program is multi-year in scope and must be decomposed into independent tracks (research → render foundation → worker data pipeline → feature parity tracks).

This first cycle produces **only the research artifact**: a granular catalog of AG Grid's object model, configuration surface, API methods, events, behaviors, and look-and-feel. The catalog becomes the input to every later track — it tells the Foundation track what shapes to design for, and gives the feature-parity tracks a concrete checklist.

No code in `src/` is touched in this cycle.

## 2. Scope

**In scope**
- AG Grid **Community + Enterprise**, version **35.3.1** (the version installed in this repo and exercised by the existing STOMP Positions showcase).
- All public configuration (`GridOptions`, `ColDef`, `ColGroupDef`, `defaultColDef`), `GridApi`/`ColumnApi` methods, events, cell renderer/editor surfaces, row models, themes, tool panels, status bar, side bar.
- A short appendix (`v36-deltas.md`) flagging any breaking or notable changes between 35.3.1 and the latest stable release.
- Screenshot capture from the running showcase app for visual reference.

**Out of scope (deferred to later cycles)**
- Canvas renderer / WebGL design.
- Worker data pipeline design (column model, row model, transferable chunk protocol).
- Viewport virtualization algorithm design.
- Hypergrid teardown / lessons-learned doc.
- Any code in `src/`.

## 3. Sources of truth (priority order)

1. **Live behavior** of the running showcase (`npm run dev` in this repo) driven via Chrome DevTools MCP. Used for screenshots and behavior probes (cell flash, range select, group expand, filter popups, sidebar, status bar, column menu).
2. **Installed source / types** under `node_modules/ag-grid-community` and `node_modules/ag-grid-enterprise`. The `.d.ts` files are the ground truth for option keys, API method signatures, event payload shapes, and column property names.
3. **Official AG Grid docs** via the Context7 MCP (`ag-grid` library). Used for prose explanations and concept framing where the `.d.ts` is unclear.
4. **Hypergrid source** under `/Users/develop/wfh/hypergrid/src`. Used only as architectural inspiration for the eventual canvas grid — NOT as a source of AG Grid feature truth.

When sources disagree, behavior of the installed package wins, then `.d.ts` types, then docs. Conflicts get an explicit note in the catalog.

## 4. On-disk structure

All catalog output lives under `docs/catalog/` in this repo.

```
docs/catalog/
  README.md                       # how the catalog is organized + how to update it
  FEATURE_MATRIX.md               # one row per feature (see §5)
  v36-deltas.md                   # notable changes vs latest stable

  01-grid-options.md
  02-column-model.md
  03-row-models.md
  04-data-updates.md
  05-rendering-and-dom.md
  06-cell-editing.md
  07-sorting.md
  08-filtering.md
  09-row-grouping.md
  10-aggregation.md
  11-pivoting.md
  12-selection.md
  13-master-detail.md
  14-tree-data.md
  15-server-side-row-model.md
  16-pinning-and-layout.md
  17-side-bar-and-tool-panels.md
  18-status-bar.md
  19-context-menu-and-clipboard.md
  20-keyboard-and-accessibility.md
  21-themes-and-styling.md
  22-events.md
  23-api.md
  24-charts-and-sparklines.md
  25-export.md
  26-performance-knobs.md

  screenshots/                    # PNG captures, named <area>-<feature>-<state>.png
```

Filenames are numerically prefixed so a directory listing reads in a sensible learning order. New areas (if any are discovered) get inserted with decimal suffixes (e.g. `08a-quick-filter.md`) to avoid renumbering.

## 5. FEATURE_MATRIX.md schema

A single markdown table. One row per feature.

| Column | Values | Purpose |
| --- | --- | --- |
| `Area` | numeric prefix (01–26) | Which area file documents it |
| `Feature` | short name | Searchable handle |
| `Tier` | `Community` / `Enterprise` | License gate in the original |
| `Surface` | `option` / `api` / `event` / `behavior` / `chrome` | Which kind of catalog entry it is |
| `Showcase-uses?` | `yes` / `no` / `partial` | Whether the existing PositionsGrid demo exercises it |
| `Canvas-port priority` | `P0` / `P1` / `P2` / `P3` | P0 = needed for MVP; P3 = exotic / deferrable |
| `Notes` | free text | Caveats, links to screenshots, related features |

Priorities are an opinion, not a commitment — the Foundation brainstorm will revisit them.

## 6. Per-area file shape

Every per-area file follows the same skeleton, scaled to its area's complexity:

1. **Concept** — what this area is, in one paragraph.
2. **Configuration surface** — option keys (`GridOptions` / `ColDef` / etc.) with types and defaults, drawn from the installed `.d.ts`. Tables, not prose dumps.
3. **API methods** — `GridApi` / `ColumnApi` methods relevant to this area, with signatures and one-line behavior summaries.
4. **Events** — event names, payload shape, fire conditions.
5. **Behaviors / interactions** — what the user sees and does. Keyboard shortcuts, mouse modifiers, animations, default UX choices.
6. **Look & feel** — screenshot references and notes on visual chrome (popup positioning, icon set, density, focus rings, hover states).
7. **Canvas-port implications** — short bullet list: what the canvas grid will need to model to support this area. Marks open questions for the Foundation brainstorm.

The "Canvas-port implications" section is what differentiates this from "just another AG Grid summary" — it makes the catalog directly useful as input to later design work.

## 7. Production approach

- **Parallelization.** Once the implementation plan exists, area files are produced by Explore subagents dispatched in parallel, clustered by topical proximity (e.g., one agent owns column-model + row-models + data-updates; another owns sorting + filtering; etc.). Each agent reads the installed `.d.ts` + relevant doc sections and writes one or more area files.
- **Screenshots.** Captured sequentially against the live app via Chrome DevTools MCP, after area files are drafted (so each screenshot can be named for the feature it illustrates).
- **STOMP server fallback.** If `/Users/develop/wfh/starui/apps/demos/stomp-view-server` is not reachable, screenshots fall back to UI-chrome states that don't require live data (filter popups, sidebar, column menu, group expand on seeded mock data). Any feature whose live behavior cannot be observed is flagged in its area file and in FEATURE_MATRIX.md.
- **v36 deltas.** Produced last, after area files are complete. Uses Context7 to fetch latest-stable docs and diff against catalog text. Only material differences land in the appendix.

## 8. Definition of done

This cycle is complete when:

1. All 26 numbered area files exist with the full skeleton from §6 populated. "Populated" means: every section has real content or an explicit "N/A — see <other area>" pointer; no `TODO`, `TBD`, or placeholder text remains.
2. `FEATURE_MATRIX.md` covers every feature documented across the area files. Cross-check: every option row in a §6.2 "Configuration surface" table, every method in §6.3, every event in §6.4, and every interaction in §6.5 maps to at least one matrix row. The §6.1 "Concept" and §6.6 "Look & feel" sections are descriptive and do not require matrix rows.
3. `screenshots/` contains captures for every feature whose behavior is observable in the showcase, named consistently per §4.
4. `v36-deltas.md` exists and either lists notable deltas or explicitly states "no material deltas observed".
5. `README.md` explains how to navigate and update the catalog.

## 9. Risks & open questions

- **AG Grid 35.3.1 source readability.** The Enterprise package may be minified or partially obfuscated. If `.d.ts` files are sparse, we lean harder on docs via Context7. Worst case: a few API signatures get marked "type uncertain — observed signature: X".
- **Screenshot coverage gaps.** Some features (e.g., charts, full master/detail) aren't in the showcase. Those will be documented from docs alone, flagged in their area file, and the matrix `Notes` column will say "no live screenshot".
- **Catalog drift.** The catalog is a snapshot. A short note in `README.md` will say so, and `FEATURE_MATRIX.md` will carry a `Last verified` date row so future passes know what to re-check.

## 10. What this enables next

After this cycle, the natural next brainstorm is **the Foundation track**: canvas render engine + viewport virtualization + worker data pipeline. That brainstorm will use the catalog's "Canvas-port implications" sections as its concrete input checklist, decide on shapes (render protocol, transferable chunk format, column/row model interfaces), and produce its own spec and plan.

Cycles after Foundation pick off feature-parity tracks one at a time, each with its own brainstorm → spec → plan → build.
