# AG Grid Feature Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the granular AG Grid 35.3.1 Community + Enterprise feature catalog described in `docs/superpowers/specs/2026-06-22-ag-grid-feature-catalog-design.md` — 26 area files + FEATURE_MATRIX.md + screenshots + v36 deltas appendix — entirely under `docs/catalog/`. No code in `src/` is touched.

**Architecture:** A research artifact, not code. Each task dispatches one Explore-style subagent against a topical cluster of areas, has it read the installed AG Grid type files (`node_modules/ag-grid-community`, `node_modules/ag-grid-enterprise`), cross-reference Context7 docs, and write the cluster's area files following a fixed skeleton, appending rows to a shared `FEATURE_MATRIX.md`. Screenshots are captured sequentially against the running showcase via Chrome DevTools MCP. v36 deltas and final cross-check come last.

**Tech Stack:** Markdown only. Subagent tool: Explore (read-only is fine — agents Write to `docs/catalog/` paths declared per task). Browser automation: Chrome DevTools MCP. Docs source: Context7 MCP (`ag-grid` library).

## Global Constraints

These apply to **every task** in this plan.

- **Version target:** AG Grid **35.3.1** Community + Enterprise. Any v36+ behaviors are documented only in `v36-deltas.md` (Task 9), never in area files.
- **Source-of-truth priority:** (1) installed types under `node_modules/ag-grid-community` and `node_modules/ag-grid-enterprise`, (2) Context7 docs for `ag-grid`, (3) live behavior in the showcase. When sources disagree, installed package wins; the area file carries an explicit note.
- **Area file skeleton (every file under `docs/catalog/NN-*.md` MUST follow this):**
  1. `## Concept` — one paragraph.
  2. `## Configuration surface` — markdown table(s) of option keys with type, default, and one-line description. Source: `.d.ts`.
  3. `## API methods` — markdown table(s) of `GridApi` / `ColumnApi` methods relevant to this area, with signature and one-line behavior. Source: `.d.ts`.
  4. `## Events` — markdown table(s) of event name, payload type, fire condition.
  5. `## Behaviors / interactions` — prose + bullets covering keyboard shortcuts, mouse modifiers, animations, defaults.
  6. `## Look & feel` — references to `screenshots/<filename>.png` (added in Task 8). If no screenshot is possible, an explicit "no live screenshot — see docs" note.
  7. `## Canvas-port implications` — bullet list of what the future canvas grid must model to support this area, and any open questions for the Foundation brainstorm.
- **No placeholders.** No `TODO`, `TBD`, `coming soon`, or empty section. Sections with no entries say "N/A — see `<other-area>.md`" with a real cross-reference.
- **`FEATURE_MATRIX.md` discipline.** Every option in §6.2, method in §6.3, event in §6.4, and named interaction in §6.5 of every area file gets at least one corresponding row in `FEATURE_MATRIX.md`. The matrix schema is fixed (see Task 0).
- **No `src/` edits.** This cycle is research-only. The only writable paths are under `docs/catalog/` and `docs/superpowers/`.
- **Commits:** small, per-task, conventional commits (`docs(catalog): ...`).

---

### Task 0: Catalog scaffold

**Files:**
- Create: `docs/catalog/README.md`
- Create: `docs/catalog/FEATURE_MATRIX.md`
- Create: `docs/catalog/screenshots/.gitkeep`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `docs/catalog/FEATURE_MATRIX.md` with the fixed header and a section anchor per area-file number (`<!-- area:01 -->` through `<!-- area:26 -->`). Subsequent cluster tasks append rows under their assigned anchors.
  - `docs/catalog/README.md` documenting catalog navigation rules.

- [ ] **Step 1: Create the screenshots directory placeholder**

```bash
mkdir -p docs/catalog/screenshots
touch docs/catalog/screenshots/.gitkeep
```

- [ ] **Step 2: Write `docs/catalog/README.md`**

```markdown
# AG Grid Feature Catalog

Granular reference for AG Grid 35.3.1 (Community + Enterprise), produced as input
to the canvas-based grid port described in `docs/superpowers/specs/2026-06-22-ag-grid-feature-catalog-design.md`.

## Navigation

- `FEATURE_MATRIX.md` — one row per feature; the entry point for "does AG Grid have X?".
- `01-grid-options.md` through `26-performance-knobs.md` — per-area deep dives. Each
  follows the same skeleton: Concept → Configuration surface → API methods → Events →
  Behaviors → Look & feel → Canvas-port implications.
- `screenshots/` — PNGs named `<area>-<feature>-<state>.png`, referenced from the
  Look & feel section of each area file.
- `v36-deltas.md` — notable behaviors that differ between 35.3.1 (this catalog) and
  the latest stable AG Grid release at the time of writing.

## Updating

- The catalog is a snapshot. The bottom row of `FEATURE_MATRIX.md` records the
  `Last verified` date; bump it when re-running the catalog production plan.
- Sources of truth, in priority order: installed `node_modules/ag-grid-*` types,
  AG Grid docs (via Context7), live behavior in the showcase app. Conflicts get an
  explicit note in the affected area file.
- New areas insert with a decimal suffix (e.g. `08a-quick-filter.md`) rather than
  renumbering.
```

- [ ] **Step 3: Write `docs/catalog/FEATURE_MATRIX.md` with header and per-area anchors**

```markdown
# AG Grid Feature Matrix

> Last verified: 2026-06-22 against AG Grid 35.3.1

| Area | Feature | Tier | Surface | Showcase-uses? | Canvas-port priority | Notes |
|------|---------|------|---------|----------------|----------------------|-------|

<!-- area:01 GridOptions -->

<!-- area:02 Column model -->

<!-- area:03 Row models -->

<!-- area:04 Data updates -->

<!-- area:05 Rendering & DOM -->

<!-- area:06 Cell editing -->

<!-- area:07 Sorting -->

<!-- area:08 Filtering -->

<!-- area:09 Row grouping -->

<!-- area:10 Aggregation -->

<!-- area:11 Pivoting -->

<!-- area:12 Selection -->

<!-- area:13 Master/Detail -->

<!-- area:14 Tree data -->

<!-- area:15 Server-side row model -->

<!-- area:16 Pinning & layout -->

<!-- area:17 Side bar & tool panels -->

<!-- area:18 Status bar -->

<!-- area:19 Context menu & clipboard -->

<!-- area:20 Keyboard & a11y -->

<!-- area:21 Themes & styling -->

<!-- area:22 Events -->

<!-- area:23 API -->

<!-- area:24 Charts & sparklines -->

<!-- area:25 Export -->

<!-- area:26 Performance knobs -->
```

- [ ] **Step 4: Verify scaffold**

Run:
```bash
ls docs/catalog/
test -f docs/catalog/README.md && echo "README ok"
test -f docs/catalog/FEATURE_MATRIX.md && echo "matrix ok"
test -d docs/catalog/screenshots && echo "screenshots dir ok"
grep -c '<!-- area:' docs/catalog/FEATURE_MATRIX.md
```

Expected: `README ok`, `matrix ok`, `screenshots dir ok`, and the grep count is `26`.

- [ ] **Step 5: Commit**

```bash
git add docs/catalog/
git commit -m "docs(catalog): scaffold feature catalog directory + matrix"
```

---

### Task 1: Cluster A — Core model (areas 01–05)

**Files:**
- Create: `docs/catalog/01-grid-options.md`
- Create: `docs/catalog/02-column-model.md`
- Create: `docs/catalog/03-row-models.md`
- Create: `docs/catalog/04-data-updates.md`
- Create: `docs/catalog/05-rendering-and-dom.md`
- Modify: `docs/catalog/FEATURE_MATRIX.md` (append rows under anchors `area:01`–`area:05`)

**Interfaces:**
- Consumes: matrix anchors from Task 0.
- Produces:
  - Five area files following the §6 skeleton from Global Constraints.
  - Matrix rows whose `Area` column equals the area-file numeric prefix.
  - Cross-references: `04-data-updates.md` may point into `03-row-models.md` for `getRowId` semantics; `05-rendering-and-dom.md` may point into `02-column-model.md` for sizing options. Cross-refs use exact filenames.

- [ ] **Step 1: Dispatch Explore subagent for cluster A**

Use the Agent tool, `subagent_type: Explore`, with this prompt:

> You are writing 5 area files of a research catalog for AG Grid 35.3.1 (Community + Enterprise), under `/Users/develop/wfh/canvasgrid/docs/catalog/`. The spec is at `docs/superpowers/specs/2026-06-22-ag-grid-feature-catalog-design.md` and you MUST read it before starting.
>
> Files to write (in this order):
> 1. `01-grid-options.md` — `GridOptions` surface, lifecycle (initial-only vs runtime-mutable), grid creation/destruction, top-level callbacks not specific to a later area.
> 2. `02-column-model.md` — `ColDef`, `ColGroupDef`, `defaultColDef`, column state (`getColumnState`/`applyColumnState`), pinning at column level (cross-link to `16-pinning-and-layout.md`), sizing (`sizeColumnsToFit`, autosize, `flex`), `valueGetter` / `valueFormatter`, `headerName`, `headerClass`, `cellClass`, `cellClassRules`, `tooltipField`, suppress* properties.
> 3. `03-row-models.md` — Client-Side, Infinite, Viewport, Server-Side: when to use each, `IDatasource`/`IViewportDatasource`/`IServerSideDatasource` contracts (signatures verbatim from `.d.ts`), block size, cache options, `getRowId` semantics.
> 4. `04-data-updates.md` — `setGridOption('rowData', …)`, `applyTransaction`, `applyTransactionAsync`, async transaction batching options, immutable data mode, delta detection, refresh APIs (`refreshCells`, `redrawRows`, `flashCells`), `enableCellChangeFlash`.
> 5. `05-rendering-and-dom.md` — row virtualization, column virtualization (`suppressColumnVirtualisation`), DOM layout modes (`normal` / `autoHeight` / `print`), full-width rows, cell renderers (`cellRenderer`, `cellRendererSelector`, `ICellRendererComp`/`ICellRendererParams`), `valueGetter` vs `cellRenderer` separation, `rowBuffer`, `rowHeight`, dynamic `getRowHeight`.
>
> Each file MUST follow this exact skeleton (no other top-level headings):
> ```
> # NN — <Title>
> ## Concept
> ## Configuration surface
> ## API methods
> ## Events
> ## Behaviors / interactions
> ## Look & feel
> ## Canvas-port implications
> ```
> Source-of-truth priority: (1) `node_modules/ag-grid-community/dist/types` and `node_modules/ag-grid-enterprise/dist/types` `.d.ts` files, (2) AG Grid docs via Context7 MCP (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs` with library `ag-grid`), (3) the live showcase under `src/`. When sources disagree, installed package wins; add a one-line note.
>
> `## Configuration surface`, `## API methods`, and `## Events` MUST be markdown tables. Columns:
> - Configuration: `Option | Type | Default | Tier | Description`
> - API: `Method | Signature | Tier | Description`
> - Events: `Event | Payload | Tier | Fires when`
>
> `## Look & feel` for now writes "_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._" Do NOT invent screenshot filenames.
>
> `## Canvas-port implications` is a bullet list of: what the canvas grid must model to support this area, and explicit open questions tagged `Q:` for the future Foundation brainstorm.
>
> No `TODO` / `TBD` / placeholders. Sections with no entries say `N/A — see <other-file>.md` with a real cross-reference.
>
> Then append rows to `docs/catalog/FEATURE_MATRIX.md` under the appropriate `<!-- area:NN -->` anchor. Schema: `| Area | Feature | Tier | Surface | Showcase-uses? | Canvas-port priority | Notes |`. Values:
> - `Area`: numeric prefix (e.g. `01`).
> - `Surface`: one of `option` / `api` / `event` / `behavior` / `chrome`.
> - `Showcase-uses?`: check `src/grid/PositionsGrid.tsx` and `src/grid/columnDefs.ts` — `yes` / `no` / `partial`.
> - `Canvas-port priority`: your judgment, P0 (MVP) / P1 (early) / P2 (later) / P3 (exotic).
> - `Notes`: ≤80 chars; cross-references allowed.
>
> Output a summary at the end listing files written and total matrix rows added per area.

- [ ] **Step 2: Verify each cluster A file has the full skeleton**

Run:
```bash
for f in docs/catalog/0{1,2,3,4,5}-*.md; do
  echo "== $f =="
  grep -c '^## Concept\|^## Configuration surface\|^## API methods\|^## Events\|^## Behaviors / interactions\|^## Look & feel\|^## Canvas-port implications' "$f"
done
```

Expected: each file reports `7`.

- [ ] **Step 3: Verify no placeholders survived**

Run:
```bash
grep -nE 'TODO|TBD|coming soon|fill in|XXX' docs/catalog/0{1,2,3,4,5}-*.md && echo "FAIL: placeholders found" || echo "ok"
```

Expected: `ok`.

- [ ] **Step 4: Verify matrix rows added under correct anchors**

Run:
```bash
awk '/<!-- area:01/,/<!-- area:02/' docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
awk '/<!-- area:02/,/<!-- area:03/' docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
awk '/<!-- area:03/,/<!-- area:04/' docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
awk '/<!-- area:04/,/<!-- area:05/' docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
awk '/<!-- area:05/,/<!-- area:06/' docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
```

Expected: each count is ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add docs/catalog/01-*.md docs/catalog/02-*.md docs/catalog/03-*.md docs/catalog/04-*.md docs/catalog/05-*.md docs/catalog/FEATURE_MATRIX.md
git commit -m "docs(catalog): cluster A — core model (grid options, columns, row models, data updates, rendering)"
```

---

### Task 2: Cluster B — Editing & data ops (areas 06–08)

**Files:**
- Create: `docs/catalog/06-cell-editing.md`
- Create: `docs/catalog/07-sorting.md`
- Create: `docs/catalog/08-filtering.md`
- Modify: `docs/catalog/FEATURE_MATRIX.md` (append rows under anchors `area:06`–`area:08`)

**Interfaces:**
- Consumes: matrix anchors from Task 0; cross-refs into `02-column-model.md` (where editing/sorting/filtering options live on `ColDef`) and `04-data-updates.md` (where edit results land via transactions).
- Produces: three area files in the cluster A skeleton; matrix rows under three anchors.

- [ ] **Step 1: Dispatch Explore subagent for cluster B**

Use the Agent tool, `subagent_type: Explore`, with this prompt:

> You are writing 3 area files of a research catalog for AG Grid 35.3.1, under `/Users/develop/wfh/canvasgrid/docs/catalog/`. First read `docs/superpowers/specs/2026-06-22-ag-grid-feature-catalog-design.md` and `docs/catalog/01-grid-options.md` (already written) to match style and depth.
>
> Files to write:
> 1. `06-cell-editing.md` — `editable`, `cellEditor` types (text, large text, select, rich select, number, date, checkbox), `cellEditorParams`, `cellEditorSelector`, `singleClickEdit` / `stopEditingWhenCellsLoseFocus`, full row edit mode, popup editors (`cellEditorPopup`), validation hooks (`valueSetter`, `valueParser`), undo/redo (`undoRedoCellEditing*`), `editType: 'fullRow'`.
> 2. `07-sorting.md` — `sortable`, `sort`/`sortIndex`, multi-sort (`multiSortKey`), `comparator`, `unSortIcon`, `accentedSort`, post-sort hooks, `getRowId` interaction with stable sort, `enableMultiRowDragging` is NOT here (it's in 12-selection).
> 3. `08-filtering.md` — filter types: `agTextColumnFilter`, `agNumberColumnFilter`, `agDateColumnFilter`, `agSetColumnFilter` (Enterprise), `agMultiColumnFilter` (Enterprise); floating filters (`floatingFilter`, `floatingFilterComponent`); quick filter (`quickFilterText`, `getQuickFilterText`); external filter (`isExternalFilterPresent`, `doesExternalFilterPass`); filter model API (`getFilterModel`, `setFilterModel`); filter buttons (`buttons`); apply behavior (`buttons: ['apply','clear','reset','cancel']`).
>
> Same skeleton, same source priority, same `## Configuration surface` / `## API methods` / `## Events` table schemas as cluster A.
>
> `## Look & feel` for now writes "_Screenshots captured in Task 8 — see `screenshots/<area>-*.png`._" Do NOT invent screenshot filenames.
>
> Append rows to `docs/catalog/FEATURE_MATRIX.md` under the `<!-- area:06 -->`, `<!-- area:07 -->`, `<!-- area:08 -->` anchors. Same row schema as cluster A. Check `src/grid/columnDefs.ts` for showcase-usage column.
>
> No `TODO` / `TBD`. Output a summary listing files written and rows added per area.

- [ ] **Step 2: Verify skeleton, placeholders, and matrix rows**

Run:
```bash
for f in docs/catalog/0{6,7,8}-*.md; do
  count=$(grep -c '^## Concept\|^## Configuration surface\|^## API methods\|^## Events\|^## Behaviors / interactions\|^## Look & feel\|^## Canvas-port implications' "$f")
  echo "$f: $count (expect 7)"
done
grep -nE 'TODO|TBD|coming soon|fill in|XXX' docs/catalog/0{6,7,8}-*.md && echo "FAIL" || echo "ok"
for a in 06 07 08; do
  next=$(printf "%02d" $((10#$a + 1)))
  echo -n "area:$a rows: "
  awk "/<!-- area:$a/,/<!-- area:$next/" docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
done
```

Expected: each skeleton count is `7`; placeholder grep prints `ok`; each anchor has ≥1 row.

- [ ] **Step 3: Commit**

```bash
git add docs/catalog/06-*.md docs/catalog/07-*.md docs/catalog/08-*.md docs/catalog/FEATURE_MATRIX.md
git commit -m "docs(catalog): cluster B — cell editing, sorting, filtering"
```

---

### Task 3: Cluster C — Group / aggregate / pivot (areas 09–11)

**Files:**
- Create: `docs/catalog/09-row-grouping.md`
- Create: `docs/catalog/10-aggregation.md`
- Create: `docs/catalog/11-pivoting.md`
- Modify: `docs/catalog/FEATURE_MATRIX.md` (append rows under anchors `area:09`–`area:11`)

**Interfaces:**
- Consumes: cross-refs into `02-column-model.md` (`rowGroup`, `aggFunc`, `pivot` are `ColDef` properties) and `10-aggregation.md` is consumed by both `09-row-grouping.md` and `11-pivoting.md`.
- Produces: three area files; matrix rows under three anchors.

- [ ] **Step 1: Dispatch Explore subagent for cluster C**

Use the Agent tool, `subagent_type: Explore`, with this prompt:

> You are writing 3 area files of a research catalog for AG Grid 35.3.1, under `/Users/develop/wfh/canvasgrid/docs/catalog/`. First read `docs/superpowers/specs/2026-06-22-ag-grid-feature-catalog-design.md` and one prior cluster file (e.g. `docs/catalog/02-column-model.md`) to match style.
>
> Files to write:
> 1. `09-row-grouping.md` — `rowGroup` / `rowGroupIndex` on `ColDef`, `groupDefaultExpanded`, `autoGroupColumnDef`, `groupDisplayType` (`singleColumn` / `multipleColumns` / `groupRows` / `custom`), `groupTotalRow` / `grandTotalRow`, `groupHideOpenParents`, `groupSelectsChildren` (cross-ref `12-selection.md`), group state APIs (`expandAll`, `collapseAll`, `setRowGroupColumns`).
> 2. `10-aggregation.md` — built-in `aggFunc` values (`sum`, `min`, `max`, `count`, `avg`, `first`, `last`), custom aggregator shape (`IAggFunc`), `aggFuncs` grid option, value getter interaction with aggregation, group footers vs total rows, `suppressAggFuncInHeader`, `IAggFunc` signature verbatim from `.d.ts`.
> 3. `11-pivoting.md` — `pivotMode`, `pivot` / `pivotIndex` on `ColDef`, pivot result columns (`secondaryColumnDefs`), pivot total columns (`pivotRowTotals`, `pivotColumnGroupTotals`), `processPivotResultColDef` / `processPivotResultColGroupDef`, pivot chart integration (cross-ref `24-charts-and-sparklines.md`).
>
> Same skeleton, same source priority, same table schemas. `## Look & feel` writes the "Screenshots captured in Task 8" placeholder. Append matrix rows under `<!-- area:09 -->`, `<!-- area:10 -->`, `<!-- area:11 -->`. Cross-reference `12-selection.md` for `groupSelectsChildren` even though that file is in a later cluster — the cross-ref is to a known filename, which is valid.
>
> No `TODO` / `TBD`. Output a summary.

- [ ] **Step 2: Verify (same pattern as cluster B)**

Run:
```bash
for f in docs/catalog/{09,10,11}-*.md; do
  count=$(grep -c '^## Concept\|^## Configuration surface\|^## API methods\|^## Events\|^## Behaviors / interactions\|^## Look & feel\|^## Canvas-port implications' "$f")
  echo "$f: $count (expect 7)"
done
grep -nE 'TODO|TBD|coming soon|fill in|XXX' docs/catalog/{09,10,11}-*.md && echo "FAIL" || echo "ok"
for a in 09 10 11; do
  next=$(printf "%02d" $((10#$a + 1)))
  echo -n "area:$a rows: "
  awk "/<!-- area:$a/,/<!-- area:$next/" docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
done
```

Expected: skeleton counts `7`, placeholder grep `ok`, each anchor ≥1 row.

- [ ] **Step 3: Commit**

```bash
git add docs/catalog/09-*.md docs/catalog/10-*.md docs/catalog/11-*.md docs/catalog/FEATURE_MATRIX.md
git commit -m "docs(catalog): cluster C — grouping, aggregation, pivoting"
```

---

### Task 4: Cluster D — Selection & advanced row models (areas 12–15)

**Files:**
- Create: `docs/catalog/12-selection.md`
- Create: `docs/catalog/13-master-detail.md`
- Create: `docs/catalog/14-tree-data.md`
- Create: `docs/catalog/15-server-side-row-model.md`
- Modify: `docs/catalog/FEATURE_MATRIX.md`

**Interfaces:**
- Consumes: cross-refs into `03-row-models.md` (SSRM is one of the row models) and `09-row-grouping.md` (SSRM groups have group state).
- Produces: four area files; matrix rows under four anchors.

- [ ] **Step 1: Dispatch Explore subagent for cluster D**

Use the Agent tool, `subagent_type: Explore`, with this prompt:

> You are writing 4 area files of a research catalog for AG Grid 35.3.1, under `/Users/develop/wfh/canvasgrid/docs/catalog/`. Read the spec and one prior cluster file first.
>
> Files to write:
> 1. `12-selection.md` — row selection (`rowSelection: 'single' | 'multiple'`, `suppressRowDeselection`, `rowMultiSelectWithClick`), checkbox column (`checkboxSelection`, `headerCheckboxSelection`, `checkboxLocation: 'autoGroupColumn'`), `groupSelectsChildren` / `groupSelectsFiltered` (cross-ref `09-row-grouping.md`), range selection (Enterprise: `enableRangeSelection`, range API), fill handle (`enableFillHandle`, `fillHandleDirection`), cell-range API (`getCellRanges`, `addCellRange`, `clearRangeSelection`), copy/paste keyboard interaction (cross-ref `19-context-menu-and-clipboard.md`).
> 2. `13-master-detail.md` — `masterDetail: true`, `detailCellRenderer` / `detailCellRendererParams`, `detailRowHeight` / `detailRowAutoHeight`, embedded `gridOptions`, refresh strategy (`keepDetailRows`, `keepDetailRowsCount`), detail-grid API (`getDetailGridInfo`).
> 3. `14-tree-data.md` — `treeData: true`, `getDataPath`, auto group column adapted for trees, `groupDefaultExpanded` semantics for trees, server-side tree (`treeData` + SSRM), filter/sort behavior with trees.
> 4. `15-server-side-row-model.md` — `rowModelType: 'serverSide'`, `IServerSideDatasource` signature verbatim from `.d.ts`, `cacheBlockSize`, `maxBlocksInCache`, partial / full store mode, group state restoration, `applyServerSideTransaction`, refresh (`refreshServerSide`, `purgeServerSide`), pivot / aggregation in SSRM, `serverSideInfiniteScroll`.
>
> Same skeleton, same source priority, same table schemas. `## Look & feel` writes the "Screenshots captured in Task 8" placeholder. Append matrix rows under `<!-- area:12 -->`–`<!-- area:15 -->`.
>
> No `TODO` / `TBD`. Output a summary.

- [ ] **Step 2: Verify**

Run:
```bash
for f in docs/catalog/{12,13,14,15}-*.md; do
  count=$(grep -c '^## Concept\|^## Configuration surface\|^## API methods\|^## Events\|^## Behaviors / interactions\|^## Look & feel\|^## Canvas-port implications' "$f")
  echo "$f: $count (expect 7)"
done
grep -nE 'TODO|TBD|coming soon|fill in|XXX' docs/catalog/{12,13,14,15}-*.md && echo "FAIL" || echo "ok"
for a in 12 13 14 15; do
  next=$(printf "%02d" $((10#$a + 1)))
  echo -n "area:$a rows: "
  awk "/<!-- area:$a/,/<!-- area:$next/" docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
done
```

Expected: skeleton counts `7`, placeholder grep `ok`, each anchor ≥1 row.

- [ ] **Step 3: Commit**

```bash
git add docs/catalog/12-*.md docs/catalog/13-*.md docs/catalog/14-*.md docs/catalog/15-*.md docs/catalog/FEATURE_MATRIX.md
git commit -m "docs(catalog): cluster D — selection, master/detail, tree data, server-side row model"
```

---

### Task 5: Cluster E — Layout & chrome (areas 16–21)

**Files:**
- Create: `docs/catalog/16-pinning-and-layout.md`
- Create: `docs/catalog/17-side-bar-and-tool-panels.md`
- Create: `docs/catalog/18-status-bar.md`
- Create: `docs/catalog/19-context-menu-and-clipboard.md`
- Create: `docs/catalog/20-keyboard-and-accessibility.md`
- Create: `docs/catalog/21-themes-and-styling.md`
- Modify: `docs/catalog/FEATURE_MATRIX.md`

**Interfaces:**
- Consumes: cross-refs scattered (`02-column-model.md` for `pinned`, `08-filtering.md` for sidebar filter panel, etc.).
- Produces: six area files; matrix rows under six anchors.

- [ ] **Step 1: Dispatch Explore subagent for cluster E**

Use the Agent tool, `subagent_type: Explore`, with this prompt:

> You are writing 6 area files of a research catalog for AG Grid 35.3.1, under `/Users/develop/wfh/canvasgrid/docs/catalog/`. Read the spec and one prior cluster file first.
>
> Files to write:
> 1. `16-pinning-and-layout.md` — `pinned: 'left' | 'right'` on `ColDef`, `pinnedTopRowData` / `pinnedBottomRowData`, full-width rows (`isFullWidthRow`, `fullWidthCellRenderer`), `domLayout` (`normal` / `autoHeight` / `print`), `enableRtl`, `headerHeight` / `floatingFiltersHeight` / `groupHeaderHeight` / `pivotHeaderHeight`.
> 2. `17-side-bar-and-tool-panels.md` — `sideBar` config shorthand (`'columns'`, `'filters'`, `true`), full `SideBarDef`, built-in tool panel components (`agColumnsToolPanel`, `agFiltersToolPanel`), custom tool panels (`IToolPanelComp` / `IToolPanelParams` signatures from `.d.ts`), API (`openToolPanel`, `closeToolPanel`, `isToolPanelShowing`).
> 3. `18-status-bar.md` — `statusBar` config, built-in components (`agTotalRowCountComponent`, `agFilteredRowCountComponent`, `agSelectedRowCountComponent`, `agAggregationComponent`, `agTotalAndFilteredRowCountComponent`), custom status bar components (`IStatusPanelComp` signature), alignment (`left` / `center` / `right`).
> 4. `19-context-menu-and-clipboard.md` — default `getContextMenuItems`, item shape (`MenuItemDef`), suppressing context menu, clipboard: `copyToClipboard` / `copySelectedRangeToClipboard`, `pasteFromClipboard`, `processCellForClipboard` / `processCellFromClipboard`, copy with headers (`copyHeadersToClipboard`).
> 5. `20-keyboard-and-accessibility.md` — default navigation map (arrows, page up/down, home/end, tab/enter), `navigateToNextCell` / `tabToNextCell` callbacks, `suppressNavigable`, focus ring behavior, ARIA roles (`grid` / `row` / `gridcell` / `columnheader` / `rowheader`), `enableCellTextSelection`, screen reader announcements, `getCellAriaLabel`.
> 6. `21-themes-and-styling.md` — provided themes (Quartz, Alpine, Material, Balham; legacy and Theming API), theming API (`themeQuartz`, `withParams`, `withPart`), CSS variables (`--ag-*` token list excerpt from `.d.ts` or theme source), density / row height interaction, dark mode, custom cell styling order of precedence (`cellClass` < `cellClassRules` < `cellStyle`).
>
> Same skeleton, same source priority, same table schemas. `## Look & feel` writes the "Screenshots captured in Task 8" placeholder. Append matrix rows under `<!-- area:16 -->`–`<!-- area:21 -->`.
>
> No `TODO` / `TBD`. Output a summary.

- [ ] **Step 2: Verify**

Run:
```bash
for f in docs/catalog/{16,17,18,19,20,21}-*.md; do
  count=$(grep -c '^## Concept\|^## Configuration surface\|^## API methods\|^## Events\|^## Behaviors / interactions\|^## Look & feel\|^## Canvas-port implications' "$f")
  echo "$f: $count (expect 7)"
done
grep -nE 'TODO|TBD|coming soon|fill in|XXX' docs/catalog/{16,17,18,19,20,21}-*.md && echo "FAIL" || echo "ok"
for a in 16 17 18 19 20 21; do
  next=$(printf "%02d" $((10#$a + 1)))
  echo -n "area:$a rows: "
  awk "/<!-- area:$a/,/<!-- area:$next/" docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
done
```

Expected: skeleton counts `7`, placeholder grep `ok`, each anchor ≥1 row.

- [ ] **Step 3: Commit**

```bash
git add docs/catalog/16-*.md docs/catalog/17-*.md docs/catalog/18-*.md docs/catalog/19-*.md docs/catalog/20-*.md docs/catalog/21-*.md docs/catalog/FEATURE_MATRIX.md
git commit -m "docs(catalog): cluster E — layout, side bar, status bar, context menu, a11y, themes"
```

---

### Task 6: Cluster F — Reference catalogs (areas 22–23)

These are the catch-all reference files. They overlap with earlier areas by design: every prior area cross-references its events into `22-events.md` and its APIs into `23-api.md`, so these two files act as flat indexes.

**Files:**
- Create: `docs/catalog/22-events.md`
- Create: `docs/catalog/23-api.md`
- Modify: `docs/catalog/FEATURE_MATRIX.md`

**Interfaces:**
- Consumes: `01`–`21` are written; reads their `## Events` and `## API methods` sections.
- Produces: two reference files; matrix rows that are largely back-pointers (`Notes` column says "see `NN-*.md`").

- [ ] **Step 1: Dispatch Explore subagent for cluster F**

Use the Agent tool, `subagent_type: Explore`, with this prompt:

> You are writing 2 reference catalog files for AG Grid 35.3.1, under `/Users/develop/wfh/canvasgrid/docs/catalog/`. Read the spec and the previously-written area files (`docs/catalog/01-*.md` through `21-*.md`).
>
> Files to write:
> 1. `22-events.md` — A flat catalog of EVERY public AG Grid event. Source: `node_modules/ag-grid-community/dist/types/.../events.d.ts` (and Enterprise equivalent). Skeleton sections still apply, but `## Configuration surface` is `N/A — events are not configured here; see individual area files for `onXxx` callback options.` and `## Behaviors / interactions` is `N/A — see individual area files`. `## Events` is the meat: one big table covering all events, grouped by sub-heading (`### Grid lifecycle`, `### Column events`, `### Row events`, `### Cell events`, `### Selection events`, `### Filter / sort events`, `### Group / pivot events`, `### Drag events`, `### Tool panel / side bar events`, `### Chart events (Enterprise)`, `### Misc`). Columns: `Event | Payload type | Tier | Originating area | Fires when`. `Originating area` is the `NN-*.md` file that owns the deeper explanation.
> 2. `23-api.md` — A flat catalog of EVERY public `GridApi` method (and any remaining `ColumnApi` shims if not yet folded into `GridApi` in 35.3.1 — check `.d.ts`). Same skeleton-with-N/A treatment as `22-events.md`. `## API methods` is the meat, grouped by sub-heading (`### Lifecycle`, `### Data`, `### Columns`, `### Rows`, `### Cells`, `### Selection`, `### Sorting`, `### Filtering`, `### Grouping / aggregation / pivot`, `### Server-side`, `### Clipboard`, `### Charts`, `### Export`, `### Status bar / side bar`, `### Misc`). Columns: `Method | Signature | Tier | Originating area | Description`.
>
> No invented signatures — copy verbatim from the installed `.d.ts`. If a method's owner area is ambiguous, pick the most specific.
>
> `## Look & feel` for both writes "N/A — reference catalog, no UI of its own."
>
> Append rows to `FEATURE_MATRIX.md` under `<!-- area:22 -->` and `<!-- area:23 -->` only for groupings (one row per sub-heading, with `Notes` linking to the originating area files). The matrix should NOT bloat with every event/method — that's what the catalog files are for.
>
> No `TODO` / `TBD`. Output a summary including total event count and total API method count.

- [ ] **Step 2: Verify**

Run:
```bash
for f in docs/catalog/{22,23}-*.md; do
  count=$(grep -c '^## Concept\|^## Configuration surface\|^## API methods\|^## Events\|^## Behaviors / interactions\|^## Look & feel\|^## Canvas-port implications' "$f")
  echo "$f: $count (expect 7)"
done
grep -nE 'TODO|TBD|coming soon|fill in|XXX' docs/catalog/{22,23}-*.md && echo "FAIL" || echo "ok"
echo "events catalog rows:" ; grep -c '^| ' docs/catalog/22-events.md
echo "api catalog rows:" ; grep -c '^| ' docs/catalog/23-api.md
```

Expected: skeleton counts `7`, placeholder grep `ok`, event table has ≥30 rows (AG Grid has roughly 60+ events), API table has ≥80 rows.

- [ ] **Step 3: Commit**

```bash
git add docs/catalog/22-*.md docs/catalog/23-*.md docs/catalog/FEATURE_MATRIX.md
git commit -m "docs(catalog): cluster F — events catalog + API catalog"
```

---

### Task 7: Cluster G — Visualization & performance (areas 24–26)

**Files:**
- Create: `docs/catalog/24-charts-and-sparklines.md`
- Create: `docs/catalog/25-export.md`
- Create: `docs/catalog/26-performance-knobs.md`
- Modify: `docs/catalog/FEATURE_MATRIX.md`

**Interfaces:**
- Consumes: cross-refs into `12-selection.md` (range chart starts from a selection), `04-data-updates.md` (`asyncTransactionWaitMillis`), `05-rendering-and-dom.md` (`rowBuffer`, `suppressColumnVirtualisation`).
- Produces: three area files; matrix rows under three anchors.

- [ ] **Step 1: Dispatch Explore subagent for cluster G**

Use the Agent tool, `subagent_type: Explore`, with this prompt:

> You are writing 3 area files of a research catalog for AG Grid 35.3.1, under `/Users/develop/wfh/canvasgrid/docs/catalog/`. Read the spec and a prior cluster file first.
>
> Files to write:
> 1. `24-charts-and-sparklines.md` — Integrated charts (Enterprise): `enableCharts`, `createRangeChart`, chart toolbar items (`chartToolbarItems`), chart options (`ChartCreated` / `ChartRangeSelectionChanged` events, cross-ref `22-events.md`), pivot charts. Sparklines: `agSparklineCellRenderer`, sparkline types (`line`, `area`, `column`, `bar`), sparkline options. Note dependency on `ag-charts-community` / `ag-charts-enterprise`.
> 2. `25-export.md` — CSV export (`exportDataAsCsv`, `getDataAsCsv`, `CsvExportParams`), Excel export (Enterprise: `exportDataAsExcel`, `getDataAsExcel`, `ExcelExportParams`, `ExcelStyle`), pre/post processing (`processCellCallback`, `processHeaderCallback`, `processRowGroupCallback`, `processGroupHeaderCallback`).
> 3. `26-performance-knobs.md` — `applyTransactionAsync` + `asyncTransactionWaitMillis`, `suppressColumnVirtualisation` cost, `rowBuffer`, `animateRows: false`, `suppressAnimationFrame`, `getRowId` for immutable mode, `suppressPropertyNamesCheck`, debounced filters / pivot, large dataset patterns (`infinite`/`viewport`/`serverSide` row models, cross-ref `03-row-models.md`), profiling tips. This file's `## Canvas-port implications` section is unusually rich — call out which knobs the canvas grid makes obsolete (e.g., column virtualization is mandatory in the canvas grid), and which translate directly (transaction batching).
>
> Same skeleton, same source priority, same table schemas. `## Look & feel` for `24` writes the screenshots placeholder; `25` and `26` write "N/A — no dedicated UI; see referenced areas." Append matrix rows under `<!-- area:24 -->`–`<!-- area:26 -->`.
>
> No `TODO` / `TBD`. Output a summary.

- [ ] **Step 2: Verify**

Run:
```bash
for f in docs/catalog/{24,25,26}-*.md; do
  count=$(grep -c '^## Concept\|^## Configuration surface\|^## API methods\|^## Events\|^## Behaviors / interactions\|^## Look & feel\|^## Canvas-port implications' "$f")
  echo "$f: $count (expect 7)"
done
grep -nE 'TODO|TBD|coming soon|fill in|XXX' docs/catalog/{24,25,26}-*.md && echo "FAIL" || echo "ok"
for a in 24 25 26; do
  next=$(printf "%02d" $((10#$a + 1)))
  echo -n "area:$a rows: "
  awk "/<!-- area:$a/,/<!-- area:$next/" docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$'
done
```

Expected: skeleton counts `7`, placeholder grep `ok`, each anchor ≥1 row.

Note: the `awk` range for `area:26` looks for `area:27` which doesn't exist; the awk command reads to EOF in that case, which is the desired behavior.

- [ ] **Step 3: Commit**

```bash
git add docs/catalog/24-*.md docs/catalog/25-*.md docs/catalog/26-*.md docs/catalog/FEATURE_MATRIX.md
git commit -m "docs(catalog): cluster G — charts/sparklines, export, performance knobs"
```

---

### Task 8: Screenshot capture against the running showcase

**Files:**
- Create: `docs/catalog/screenshots/*.png` (multiple)
- Modify: each `docs/catalog/NN-*.md` whose `## Look & feel` currently contains the "Screenshots captured in Task 8" placeholder — replace with a markdown list of `![alt](screenshots/<filename>.png) — caption` entries.

**Interfaces:**
- Consumes: completed area files from clusters A–G.
- Produces: PNG files + updated `## Look & feel` sections in area files.

This task runs sequentially because the showcase is single-tab.

- [ ] **Step 1: Start the STOMP server (if reachable)**

Run:
```bash
if curl -sf http://localhost:8081/health > /dev/null 2>&1; then
  echo "STOMP server already running"
elif [ -d /Users/develop/wfh/starui/apps/demos/stomp-view-server ]; then
  echo "Start the server manually in a separate terminal:"
  echo "  cd /Users/develop/wfh/starui/apps/demos/stomp-view-server && npm start"
  echo "Then re-run this step. Or proceed without it for static-state screenshots only."
else
  echo "STOMP server directory not found; static-state screenshots only"
fi
```

Expected: either confirmation the server is up, or a clear next step.

- [ ] **Step 2: Start the showcase dev server in the background**

Run:
```bash
cd /Users/develop/wfh/canvasgrid && npm run dev
```

Use `run_in_background: true`. The dev server listens on `http://localhost:5174` per `README.md`.

- [ ] **Step 3: Drive the showcase with Chrome DevTools MCP and capture screenshots**

For each screenshot in the list below, use `mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page` (first only) → `navigate_page` → any interaction tools (`click`, `hover`, `take_snapshot` for finding selectors, `wait_for`) → `take_screenshot` saving to `docs/catalog/screenshots/<filename>.png`.

Required screenshot list (filename → state to capture). Skip any whose state cannot be reached and note the skip in the area file:

```
05-rendering-virtual-scroll-mid.png       Scrolled mid-grid, showing row virtualization edge
05-rendering-overlay-no-rows.png          Empty grid overlay
06-cell-editing-popup-editor-open.png     Click a numeric cell, popup editor visible
07-sorting-multi-sort-three-cols.png      Shift+click three header sorts, sort indicators visible
08-filtering-text-filter-popup.png        Click filter icon on a text column, popup open
08-filtering-set-filter-popup.png         Same but a column with set filter (Enterprise)
08-filtering-multi-filter-tabs.png        agMultiColumnFilter with both tabs visible
08-filtering-floating-filter-row.png      Floating filter row populated
09-grouping-three-level-expanded.png      Desk → Region → Instrument Type, top group expanded
09-grouping-group-total-row.png           Group total row visible
10-aggregation-aggfunc-in-header.png      Header showing "sum(quantity)" or similar
12-selection-checkbox-mixed-state.png     Group with some leaves selected (indeterminate)
12-selection-range-cell-fill-handle.png   Range selection with fill handle visible (Enterprise)
16-pinning-left-and-right.png             Pinned-left and pinned-right columns visible
17-sidebar-columns-panel-open.png         Columns tool panel open
17-sidebar-filters-panel-open.png         Filters tool panel open
18-status-bar-aggregation-component.png   agAggregationComponent showing sum/avg in status bar
19-context-menu-default.png               Right-click a cell, default context menu
20-keyboard-focus-ring-on-cell.png        Focused cell with visible focus ring
21-theme-quartz-light.png                 Default Quartz theme
04-data-updates-cell-flash.png            A cell mid-flash (capture during live stream tick)
```

For each capture:
```
mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page  url=http://localhost:5174
# perform interaction(s) needed to reach the state
mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot  filePath=/Users/develop/wfh/canvasgrid/docs/catalog/screenshots/<name>.png  fullPage=false
```

- [ ] **Step 4: Update each area file's `## Look & feel` section**

For every area file that had the "Screenshots captured in Task 8" placeholder, replace it with a list of the screenshots actually captured for that area. Example for `09-row-grouping.md`:

```markdown
## Look & feel

- ![Three-level grouping expanded](screenshots/09-grouping-three-level-expanded.png) — Desk → Region → Instrument Type with the top group expanded.
- ![Group total row](screenshots/09-grouping-group-total-row.png) — Inline group total row at the bottom of the expanded group.
```

If a planned screenshot could not be captured, replace the placeholder with an explicit note: `_Planned screenshot `<filename>` could not be captured — state requires live STOMP stream which was unavailable._`

- [ ] **Step 5: Stop the dev server**

Use the Monitor tool to find the background shell ID for `npm run dev` and stop it (TaskStop). If the user prefers to leave it running for further inspection, that's fine — note this in the commit message.

- [ ] **Step 6: Verify screenshots exist and are referenced**

Run:
```bash
ls docs/catalog/screenshots/*.png | wc -l
grep -c 'screenshots/' docs/catalog/*.md
grep -nE 'Screenshots captured in Task 8' docs/catalog/*.md && echo "FAIL: placeholder still present" || echo "ok"
```

Expected: PNG count matches captured count, screenshot references appear in area files, placeholder grep prints `ok`.

- [ ] **Step 7: Commit**

```bash
git add docs/catalog/screenshots/ docs/catalog/*.md
git commit -m "docs(catalog): screenshots from showcase app + Look & feel updates"
```

---

### Task 9: v36-deltas appendix

**Files:**
- Create: `docs/catalog/v36-deltas.md`

**Interfaces:**
- Consumes: completed area files (knows what 35.3.1 says).
- Produces: appendix flagging material changes between 35.3.1 and the latest stable.

- [ ] **Step 1: Fetch latest stable AG Grid version + changelog highlights via Context7**

Use:
```
mcp__context7__resolve-library-id  libraryName=ag-grid
mcp__context7__query-docs           library=ag-grid  query="changelog 36 breaking changes"
mcp__context7__query-docs           library=ag-grid  query="what's new in latest version"
```

Capture: the current stable version number and a list of breaking / notable changes since 35.x.

- [ ] **Step 2: Write `docs/catalog/v36-deltas.md`**

Structure:
```markdown
# AG Grid v36+ deltas vs 35.3.1

> Comparison date: 2026-06-22
> Catalog base version: 35.3.1
> Latest stable at comparison time: <version>

This appendix lists only **material** behavioral or API differences between
the catalog's base version (35.3.1) and the latest stable AG Grid release.
Cosmetic changes, internal refactors, and additive non-breaking APIs are
omitted unless they affect the canvas-port plan.

## Breaking changes

| Area | Change | Catalog file | Impact on canvas port |
|------|--------|--------------|-----------------------|

## Notable non-breaking additions

| Area | Addition | Catalog file | Impact on canvas port |
|------|----------|--------------|-----------------------|

## No-change confirmation

Areas verified unchanged: <list of catalog files whose surfaces match latest>.
```

If no material deltas exist, write exactly one line under each table: `_No material deltas observed in this category._` Then the file is complete.

- [ ] **Step 3: Verify**

Run:
```bash
test -f docs/catalog/v36-deltas.md && echo "ok"
grep -nE 'TODO|TBD|fill in' docs/catalog/v36-deltas.md && echo "FAIL" || echo "ok"
```

Expected: both `ok`.

- [ ] **Step 4: Commit**

```bash
git add docs/catalog/v36-deltas.md
git commit -m "docs(catalog): v36+ deltas appendix"
```

---

### Task 10: Final cross-check pass

**Files:**
- Modify: `docs/catalog/FEATURE_MATRIX.md` (deduplicate, sort within sections, update `Last verified`)

**Interfaces:**
- Consumes: every catalog file.
- Produces: a finalized matrix that satisfies the DoD from the spec.

- [ ] **Step 1: Run completeness checks**

Run:
```bash
# Every area file follows the skeleton
for f in docs/catalog/[0-2][0-9]-*.md; do
  count=$(grep -c '^## Concept\|^## Configuration surface\|^## API methods\|^## Events\|^## Behaviors / interactions\|^## Look & feel\|^## Canvas-port implications' "$f")
  if [ "$count" -ne 7 ]; then echo "SKELETON FAIL: $f ($count)"; fi
done

# No placeholders survive
grep -rnE 'TODO|TBD|coming soon|fill in|XXX' docs/catalog/ && echo "PLACEHOLDER FAIL" || echo "placeholders clean"

# Matrix has rows under every anchor
for a in $(seq -w 1 26); do
  next=$(printf "%02d" $((10#$a + 1)))
  count=$(awk "/<!-- area:$a/,/<!-- area:$next/" docs/catalog/FEATURE_MATRIX.md | grep -c '^|.*|.*|.*|.*|.*|.*|$')
  if [ "$count" -eq 0 ]; then echo "MATRIX FAIL: area $a has 0 rows"; fi
done

# Screenshots are referenced by at least one area file each
for png in docs/catalog/screenshots/*.png; do
  base=$(basename "$png")
  if ! grep -ql "screenshots/$base" docs/catalog/*.md; then
    echo "UNREFERENCED SCREENSHOT: $base"
  fi
done
```

Expected: no FAIL / UNREFERENCED lines printed.

- [ ] **Step 2: Update `Last verified` row in the matrix**

Edit `docs/catalog/FEATURE_MATRIX.md` so the first non-header line reads:
```
> Last verified: 2026-06-22 against AG Grid 35.3.1
```
(Already written in Task 0 — this step exists in case earlier passes overwrote it.)

- [ ] **Step 3: Commit**

```bash
git add docs/catalog/FEATURE_MATRIX.md
git commit -m "docs(catalog): final cross-check pass, matrix finalized"
```

- [ ] **Step 4: Print done summary**

Run:
```bash
echo "=== AG Grid Feature Catalog — Cycle 1 Complete ==="
echo "Files in docs/catalog/: $(ls docs/catalog/ | wc -l)"
echo "Area files: $(ls docs/catalog/[0-2][0-9]-*.md | wc -l)"
echo "Screenshots: $(ls docs/catalog/screenshots/*.png 2>/dev/null | wc -l)"
echo "Matrix rows: $(grep -c '^| ' docs/catalog/FEATURE_MATRIX.md)"
echo "Next cycle: brainstorm the Foundation track (canvas renderer + worker data pipeline + viewport virtualization)."
```

---

## Self-review pass

- **Spec coverage:** Every section of the design spec maps to a task. §3 sources → embedded in Global Constraints + every cluster prompt. §4 on-disk structure → Task 0 + clusters A–G. §5 matrix schema → Task 0 header + cluster append rules. §6 area-file skeleton → Global Constraints + cluster prompts. §7 production approach → Tasks 1–9. §8 DoD → Task 10 verification. §9 risks (screenshot fallback, source disagreement) → Task 8 fallback path + Global Constraints conflict rule.
- **Placeholder scan:** All steps have concrete commands or content. No "TBD", no "implement later".
- **Type consistency:** The skeleton headings are spelled identically everywhere (`## Concept`, `## Configuration surface`, `## API methods`, `## Events`, `## Behaviors / interactions`, `## Look & feel`, `## Canvas-port implications`). The matrix schema columns are spelled identically across Task 0 (definition), every cluster prompt (append rule), and Task 10 (verification): `Area | Feature | Tier | Surface | Showcase-uses? | Canvas-port priority | Notes`. The matrix anchor format is identical: `<!-- area:NN -->`.
- **Coverage gap check:** §9 of the spec mentions a `Last verified` row — added to Task 0 step 3 (initial) and Task 10 step 2 (re-confirmation).
