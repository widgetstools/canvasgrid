# AG Grid v36+ deltas vs 35.3.1

> Comparison date: 2026-06-23
> Catalog base version: 35.3.1
> Latest stable at comparison time: 35.3.1 (source: npm registry — `npm view ag-grid-community version` returned `35.3.1`; confirmed by GitHub releases page at https://github.com/ag-grid/ag-grid/releases and npm search returning "last published 21 days ago" for 35.3.1)

This appendix lists only **material** behavioral or API differences between
the catalog's base version (35.3.1) and the latest stable AG Grid release.
Cosmetic changes, internal refactors, and additive non-breaking APIs that
do not affect the canvas-port plan are omitted.

## Version gap assessment

At the time of comparison (2026-06-23) **no AG Grid v36 has been released**.
The latest stable version is **35.3.1** — the same version against which the
entire catalog (areas 01–26 and FEATURE_MATRIX.md) was written.

Version history of the v35 line at comparison time:

| Version | Release date |
|---------|-------------|
| 35.0.0  | 2025-12-10  |
| 35.0.1  | 2026-01-22  |
| 35.1.0  | 2026-02-11  |
| 35.2.0  | 2026-03-25  |
| 35.2.1  | 2026-04-07  |
| 35.3.0  | 2026-05-12  |
| 35.3.1  | 2026-06-02  |

Sources consulted:
- npm registry (`npm view ag-grid-community version`)
- GitHub releases: https://github.com/ag-grid/ag-grid/releases
- npmjs.com package page for `ag-grid-community`
- Context7 AG Grid documentation (highest-version indexed: 33.3.2; no v36 docs present)
- Web search for "AG Grid version 36 release notes breaking changes 2025 2026" returned no v36 results

## Breaking changes

_No material deltas observed in this category._

There are no breaking changes to document: the catalog base version (35.3.1)
and the latest stable release (35.3.1) are identical.

## Notable non-breaking additions

_No material deltas observed in this category._

The catalog was authored directly against 35.3.1, so all additions through
that version are already reflected in the area files (01–26) and
FEATURE_MATRIX.md.

## No-change confirmation

All — no per-area deltas observed.

The following catalog files were checked: 01-grid-options.md, 02-column-model.md,
03-row-models.md, 04-data-updates.md, 05-rendering-and-dom.md,
06-cell-editing.md, 07-sorting.md, 08-filtering.md, 09-row-grouping.md,
10-aggregation.md, 11-pivoting.md, 12-selection.md, 13-master-detail.md,
14-tree-data.md, 15-server-side-row-model.md, 16-pinning-and-layout.md,
17-side-bar-and-tool-panels.md, 18-status-bar.md,
19-context-menu-and-clipboard.md, 20-keyboard-and-accessibility.md,
21-themes-and-styling.md, 22-events.md, 23-api.md,
24-charts-and-sparklines.md, 25-export.md, 26-performance-knobs.md.

All documented surfaces match 35.3.1 — the current latest stable — verbatim.

## Action required when v36 ships

When AG Grid v36 is released, re-run this comparison using:

```bash
# Check npm for new version
npm view ag-grid-community version

# If a new version is found, consult the migration guide at:
# https://www.ag-grid.com/javascript-data-grid/upgrading-to-ag-grid-36/
# and the codemod runner:
npx @ag-grid-devtools/cli@latest migrate --from=35.3.1 --to=36.0 --dry-run
```

Update this file with the delta rows and bump the "Latest stable at
comparison time" field accordingly.
