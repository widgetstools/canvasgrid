# AG Grid v36+ deltas vs 35.3.1

> Comparison date: 2026-08-21
> Catalog base version: 35.3.1
> Latest stable at comparison time: 36.1.0 (source: `npm view ag-grid-community versions --json`,
> which lists 36.0.0, 36.0.1, 36.0.2, 36.1.0 as published releases; confirmed
> against AG Grid's official docs/blog via WebFetch — `javascript-data-grid/upgrading-to-ag-grid-36/`,
> `blog.ag-grid.com/whats-new-in-ag-grid-36/`, `blog.ag-grid.com/whats-new-in-ag-grid-36-1/`,
> and the module-licensing table at `javascript-data-grid/modules/`)

This appendix lists **material** behavioral or API differences between the
catalog's base version (35.3.1) and the latest stable AG Grid release
(36.1.0), and — where relevant — VelocityGrid's current parity status.

## Version gap assessment

AG Grid 36 **has been released** since the previous version of this document
was written (2026-06-23, when 36 did not yet exist). Version history observed:

| Version | Notes |
|---------|-------|
| 35.3.1  | Catalog baseline (unchanged) |
| 36.0.0  | Major release — Calculated Columns, Show Values As, Automatic Column Generation |
| 36.0.1  | Patch |
| 36.0.2  | Patch |
| 36.1.0  | Minor — Editable Column Header Names, Custom Menu Items in Columns Tool Panel, `ag-dev` AI coding skill, Markdown docs |

## Breaking changes (36.0.0)

None of these change VelocityGrid's canvas-port surface directly — they're
internal to AG Grid's own DOM/module architecture — but are recorded for
completeness since a couple affect *behavior* an app author would notice:

- **DOM restructuring**: 9+ containers collapsed into a single scrolling
  container; 25+ CSS class renames (pinned columns, floating rows, containers).
  Font weight now defaults to `400` instead of inheriting page styles.
- **Aggregation function order**: column-menu aggFunc list now shows
  usage-frequency order (Sum, Average, Max, Min, Count, First, Last) instead
  of alphabetical.
- **Date filters** with `cellDataType: 'date'` now return date-only values
  (time component stripped).
- **Pivot column value order** is now persisted in grid state (previously lost
  on state round-trip).
- **`ValidationModule` removed from default bundles** — dev-time validation
  now requires explicitly calling `enableDevValidations()`.
- **CSRM integrated into core** — no longer requires explicit module
  registration.
- **Overlay DOM repositioned** as a viewport sibling (ARIA compliance).
- **`suppressContentVisibilityAuto`** default flipped from `false` to `true`.
- **Framework/tooling**: TypeScript minimum raised to 5.8.3; new `ag-stack`
  shared dependency; Angular minimum raised to v20; Integrated Charts require
  AG Charts 14.

## Notable new features (36.0.0–36.1.0) and VelocityGrid parity

Full detail and file:line evidence in `FEATURE_MATRIX.md`'s "AG Grid 36
additions" section. Summary:

| Feature | AG tier | VelocityGrid status |
|---|---|---|
| Calculated Columns | Enterprise | ✅ Already shipped, predates AG 36, arguably more capable (scoped aggregates, `PREV()`) |
| Show Values As | Enterprise, CSRM only | ❌ No parity |
| Automatic Column Generation | Community | ⚠️ Partial — inference logic exists, not exposed as a grid option |
| Editable Column Header Names | Enterprise (36.1) | ❌ Column-group renaming only, not regular columns |
| Custom Menu Items in Columns Tool Panel | Enterprise (36.1) | ❌ Context-menu system exists, not wired into the tool panel |
| Accessibility: pinned-column screen-reader announcements | Community | ⚠️ Unverified — general a11y overlay exists, pinned-column-specific behavior not confirmed |
| Theming performance/flexibility improvements | Community | N/A — VelocityGrid has its own canvas-based theming system (`CgTheme` object API), not directly comparable |
| `ag-dev` AI coding skill, Markdown docs (36.1) | Community | N/A — AG Grid dev-tooling, not a grid feature |

## Action for next check

```bash
npm view ag-grid-community version
```

Re-run this comparison when a new major/minor lands; update the version table
and the parity summary above.
