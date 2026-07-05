# MarketsCgrid — Remaining Tasks

Status as of 2026-07-04. cgrid slots into the StarUI React platform
(`/Users/develop/wfh/starui`) as a drop-in AG Grid replacement behind
`surface: 'ag' | 'cgrid'` (AG default). Plan of record:
`~/.claude/plans/elegant-hatching-robin.md`.

Branches: canvasgrid `feature/markets-cgrid-kernel` · starui `feature/markets-cgrid`.
Pilot: `apps/demos/demo-react` → `http://localhost:5190/?view=cgrid` (CGRID PILOT tab).

## Done (M1 · M2 · M3 partial)

- **M1 — renders**: MarketsCgridSurface + CGridApiAdapter + option/colDef
  translators + AG event-name bridge + facades; StarUI OKLCH theme adapter
  (light/dark live flips, 3 densities); StrictMode-safe deferred teardown
  (GridPlatform.destroy is terminal); vite `fs.allow` for the kernel worker;
  kernel `rowIdField` option. 500 streaming rows, sort, densities verified.
- **M2 — profiles**: `MarketsGridApi` structural seam (~45 members) across
  engine + ~30 module files; `stateTranslator` (AG GridState ⇄ cgrid
  GridState v4, profiles stay AG-shaped on disk, cgrid extras under
  `__cgrid`); adapter getState/setState + viewport-anchor methods.
  Save → reload → restore verified; AG-shaped blob applies on cgrid.
- **M3 (partial)**: kernel `getRowById` + opt-in `mirrorDisplayedRowIds`
  (sync displayed-row-id mirror; `forEachNodeAfterFilter` /
  `getDisplayedRowAtIndex` now truthful); event-payload synthesis
  (node/data/column/colDef on rowId+colId events); SettingsSheet opens on
  the pilot; **Grid Options ✅** and **Column Settings ✅** verified
  end-to-end.

## M3 — remaining module checklist (11 of 13 panes)

Verify each pane applies + persists on the cgrid pilot; fix at the right
layer (translator / adapter / kernel — no retroactive layering).

| Pane | Expected effort | Notes |
|---|---|---|
| Column Groups | S | kernel has native column groups; translator GROUP_PASSTHROUGH exists |
| Custom Settings | S | pure module state, no grid coupling expected |
| Shortcuts | M | needs editing events (see M4); `getEditingCells` currently stubs `[]` |
| Plus / Minus | M | same editing dependency |
| Style Rules (conditional-styling) | M | **no rowClassRules on kernel** — fan row rules out to per-column `cellClassRules` in the translator, or add kernel support |
| Calculated Columns | M/L | **JS valueGetters never evaluate** (M1 spike) — compile module expressions to a `@cgrid/calc` program via `registerCalcProvider`; translator currently warns+drops valueGetters |
| Smart Edit | M | collectors unblocked by displayed-row mirror; needs M4 editing round-trip |
| Bulk Update | M | same as Smart Edit |
| Edit History (data-change-history) | M | consumes enriched cellValueChanged (landed); verify journal writes |
| Alerts | M | RowChangeBus delta shapes over cgrid events need verification |
| Visual Excel | L | route AG export → `@cgrid/export` / kernel `exportDataResult`; adapter `exportDataAsExcel` currently warn-once no-op |

Also in M3 scope:
- Composite rowId keys (adapter currently degrades to first field with a warning).
- `cellSelectionChanged` payload fidelity for the range-based collectors.
- Filter placeholder text (`>100, 1,2,3, 100..200`) renders oddly in some
  floating filters — cosmetic, worth a look.

## M4 — toolbars + editing

- Kernel: `readOnlyEdit` option (editors emit cellValueChanged without
  writing — provider-writeback; must be kernel-side, adapter-level revert
  races streaming ticks). `applyEditLockGuard` already calls it via the
  translator (currently IGNORED).
- Kernel: editing-cells accessor to back `getEditingCells()`.
- Formatting/Filters toolbars + QuickSearch against the cgrid surface.
- Edit round-trip through the data provider (STOMP writeback).

## M5 — parity demo + perf

- Side-by-side AG vs cgrid page in the starui demo app.
- Scripted 17-module + 16-event checklist.
- 100k-row streaming perf comparison (also quantifies the
  `mirrorDisplayedRowIds` per-flush id-array clone cost).

## Kernel backlog (canvasgrid)

- `readOnlyEdit` (M4, above).
- rowClassRules equivalent (M3 Style Rules, above).
- Compound/multi filter per column (AG two-tab Multi Filter parity —
  currently degrades to best single kind).
- Editing-cells accessor.

## Standing constraints

- Never commit the 4 starui WIP files: root `package.json`,
  `packages/react-core/config-browser/package.json`,
  `packages/react-grid/grid/src/widget/styles/marketsGrid.css`,
  `scripts/staruiConsumerVite.mjs`.
- Kernel is consumed as dist (`file:` dep) — rebuild `packages/kernel`
  after kernel changes.
- Seam growth rule: a member added to `MarketsGridApi` must land with its
  `CGridApiAdapter` mirror in the same change (compile-time assertion
  enforces this).
- AG-path invariance gate: engine (289) + grid (654) + kernel (2785)
  suites, 17-app workspace typecheck.
