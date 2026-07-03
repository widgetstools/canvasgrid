# Cycle 21i recon — @cgrid/customizer (committed 2026-07-03)

Recon redo for 21i-S0 (original scratchpad recon lost). Sources:
`docs/starui-customizer-ui/*.md` (00–19 + README), `docs/starui-customizer/*.md`,
`docs/starui-platform/{README,02-config-manager}.md`, and engine-package source
verification on `main` @ `b0cea9d`. Supersedes the compressed conclusions in
the 2026-07-02 session worklog.

## 1. Corrections to the preserved worklog conclusions

1. **"20 panels" → 19 numbered editors + foundations doc.** README claims 20
   (README.md:49) but catalogs 01–19. Split is **7 master-detail / 6 flat /
   5 inline-toolbar / 1 modal dialog** (not "8 flat").
2. **"18-primitive foundation library" → ~27 named components** in
   00-foundations.md across 4 buckets (settings chrome ×17, floating windows
   ×2, shared editors ×5, utility buttons ×3) plus stragglers (LedBar,
   FigmaPanelSection, toolbar chrome, op-toggle-group). README's own "~17"
   (README.md:113) undercounts its own list. No doc says 18.
3. **Stack assumption confirmed and stronger than "assumed":** the README
   asserts Lit + Web Awesome (ex-Shoelace) as cgrid's *intentional* choice
   (README.md:149-157), plus Monaco (lazy ~2.5MB, input fallback),
   SortableJS (~9KB, only Column Selector needs it), lit-virtualizer (only
   Column Settings), @lit/context, unsafeSVG. React idioms are explicitly
   mapped away (README.md:161-171).
4. **Two editors are not backed by the 15 engine modules:** #17 Filters
   Toolbar needs a **saved-filters store that does not exist anywhere yet**
   (17:130), and #19 Toolbar Date Settings is largely starui-specific — docs
   recommend shipping only a stripped row-filter panel (19:170-176).
5. **License note in the docs:** `@cgrid/customizer` is marked "TBD (can be
   commercial — AG Grid Enterprise model)" (README.md:18) while core stays
   MIT. Business decision, not made anywhere.

## 2. Editor inventory (19)

| # | Editor | Surface | Engine domain | Size |
|---|---|---|---|---|
| 01 | Column Settings | master-detail | kernel/format/renderers (10 bands) | x-large |
| 02 | Column Groups | master-detail | kernel column groups | large |
| 03 | Calculated Columns | master-detail | calc + expression + format | large (doc: "simplest MD") |
| 04 | Conditional Styling | master-detail | rules (7 bands, indicators) | x-large |
| 05 | Alerts | master-detail (+ bell popover) | rules/alerts | large |
| 06 | Plus/Minus | master-detail | edit | medium |
| 07 | Shortcuts | master-detail | edit | medium |
| 08 | Grid Options | flat + sidebar nav | kernel (~80 fields, 12 bands) | x-large |
| 09 | Smart Edit settings | flat | edit | small |
| 10 | Bulk Update settings | flat | edit | small |
| 11 | Data Change History | flat + live monitor | edit journal | medium |
| 12 | Visual Excel | flat (1 toggle) | export (21h) | tiny |
| 13 | Formatting Toolbar | toolbar + poppable OS window | format/templates | large |
| 14 | Smart Edit Toolbar | inline toolbar | edit | small |
| 15 | Bulk Update Toolbar | inline toolbar | edit | small |
| 16 | Edit History Toolbar | inline toolbar | edit | tiny |
| 17 | Filters Toolbar | inline pill row | **saved-filters — NO engine module exists** | medium |
| 18 | Column Selector | modal dialog | kernel visibility/order | medium |
| 19 | Toolbar Date Settings | flat + sidebar nav | mostly host-specific; strip to row-filter panel | medium→small |

Shared heavyweight editors (Phase 3 of the docs' build order): ExpressionEditor
(Monaco; used by 01/03/04/05/06/19), StyleEditor (01/02/04), FormatterPicker
(01/03/04/13), ColorPicker, TemplateManager (01/13). Docs prescribe a 6-phase
dependency-ordered build (substrate → lightest panels → settings panels →
shared editors → master-detail → toolbars) (README.md:173-214).

## 3. Host integration contract (from the docs)

- **Settings Sheet ("Cockpit")** is the parent chrome hosting all panels:
  menubar with 6 categories routing to the modules, header with Reset/Save,
  3-column master-detail layout, `--ds-*` theme tokens (README.md:102-109).
- **Toolbars** are separate strips (editing toolbar hosts 14/15/16; filters
  pill row; formatting toolbar with Poppable popout to an OS window).
- **Dialog** (Column Selector) is host-managed (`open`/`onOpenChange`/`api`).
- **State wiring**: draft → save/reset with per-row dirty LEDs (DirtyBus);
  commits go through engine reducers/APIs, never direct grid mutation.
  Toolbars emit `CellPatch[]` → edit engine `applyEdits()`.
- **Persistence**: host owns storage (ConfigManager); cgrid must expose
  `getState/setState/onStateChange` (+ recommended `getModuleState/`
  `setModuleState/onModuleChange/isDirty/onDirtyChange/suspend/resume`)
  (02-config-manager.md:437-479). Profile bundle = per-module `{version,data}`
  envelopes. cgrid ships only a MemoryStorageAdapter for tests/demos.
- **Notifications**: alerts evaluation in-engine, routing (toast/OpenFin) is
  host-wired via hooks (05:148). OpenFin specifics explicitly out of scope.

## 4. Engine-side readiness (source-verified)

**Two-tier public surface (governs everything):** panels registered through
the kernel tool-panel system receive `CGridApi` (`makeApi()`, cgrid.ts:5640) —
a strict subset of the `CGrid` class. Several methods exist class-only:
`getFilterModel()` (cgrid.ts:2543), `getState()/setState()`,
`setThemeParams()/getThemeParams()` (cgrid.ts:5079/5089), `getSortModel()`.
"Public API only" must state which tier is the contract.

**Panel attachment is NOT a gap.** The tool-panel registry accepts
third-party panels: `CGridOptions.components` + `SideBarDef.toolPanels`
(ToolPanelDef with id/label/icon/width), contract `init/getGui/refresh/
destroy` (toolPanels/registry.ts:48-86, types.ts:29-80). Runtime control via
`openToolPanel/closeToolPanel/getToolPanelInstance/...` — all on `CGridApi`.
Context menu + header menu custom items are public (`getContextMenuItems`,
`getMainMenuItems`, runtime-mutable). BUT: no generic modal/sheet/popout
primitive exists in the kernel (only purpose-scoped PopupHost/
FilterPopupHost); sidebar is single-panel and narrow — master-detail panels
don't fit it.

**Corrected engine-API gap list:**

Tier A — missing everywhere (new engine code needed):
1. Group-tree traversal (no forEachNode/group hierarchy walk; only
   expansion + group-column APIs).
2. Icon registry enumeration (`resolveIcon` lookup only; no `listIcons()`).
3. Renderer-registry enumeration on a live grid (registry has
   register/get only; static `RENDERER_NAMES` is not instance truth).
4. `@cgrid/export` empty scaffold — Visual Excel panel (#12) has nothing to
   drive until 21h ships.
5. No unified module-state persistence — `GridState` snapshot
   (stateSnapshot.ts:36-72) covers column/filter/sort/group/pivot/sideBar/
   selection/scroll but NONE of rules/calc/format/edit/renderer state; a
   template manager must serialize each engine separately today. Sidebar
   panel widths also unpersisted.
6. No per-column compiled-format read-back (format compiler slot is
   write-only).

Tier B — class-only, trivially fixable by widening `makeApi`:
7. `getFilterModel()` aggregate read; 8. `getState/setState`;
9. `setThemeParams/getThemeParams`; 10. `getSortModel()`.

Cleared non-gaps: column visibility (`setColumnsVisible` +
`getColumnState().hide` + `applyColumnState`), per-column filter contract
(`get/setColumnFilterModel`, `getColumnFilterType`, `buildColumnFilterEditor`
+ typed models in types/filter.ts), aggFunc enumeration
(`calc listAggregates()`), rules CRUD (`RuleEngine.setRules/getRules/
validateRule` — replace-all granularity), calc CRUD
(`registerCalculatedColumn/remove/list` + overrides + templates +
`onColumnsChanged`), format template registry
(`register/get/listFormatterTemplates`), edit settings trio + shortcuts +
plus-minus (all plain data + helpers).

**UI tech today:** all packages framework-free (zero UI deps); cgrid demo
apps build controls with raw `createElement`; React exists only in the
ag-grid comparison app. No Monaco/CodeMirror anywhere. Kernel
`tokens.css` provides a comprehensive CSS-var set panels can theme from;
sidebar chrome classes already tokenized.

## 5. Blocking decisions for the user (21i-S0)

See discussion summary presented 2026-07-03; decisions to be recorded in the
21i spec once made:

- **D-A Panel attachment — DECIDED 2026-07-03 (user):** hybrid, with
  layered entry (contextual right-click → scoped panel; toolbars for
  frequent actions; full surface behind that). **Grid Options (#08) is a
  kernel sidebar tool-panel TAB**, not a settings-sheet module: schema-driven
  (port StarUI's declarative field schema + band search,
  `react-grid/.../general-settings/fieldSchema.tsx`), scoped to
  runtime-mutable options only. ~60 fields at launch: ~35 whitelist options
  + ~27 fanned out from the single `defaultColDef` entry; StarUI marketsgrid
  exposes 92 across 10 bands — the ~30 remainder are cgrid feature gaps
  (pagination, advanced filter, SSRM, tooltips) or construction-only options
  → tracked as a runtime-promotion wish list, panel picks them up
  automatically as they land. Master-detail panels stay in the wider
  settings surface; add global settings search + "modified only" filter as
  deltas to the docs' design.
- **D-B Stack**: adopt the docs' Lit + Web Awesome (+ Monaco lazy,
  SortableJS) vs framework-free vanilla TS matching kernel ethos vs Lit-only.
- **D-C State/persistence contract**: which of the config-manager surface
  (`getModuleState`/`onModuleChange`/`isDirty`/...) lands in kernel vs a
  customizer-owned store; profile envelope formalization.
- **D-D Scope trim**: #17 saved-filters (needs a new engine store — build or
  defer), #19 strip-to-row-filter, alerts channels (host hooks only).
- **D-E License/positioning**: customizer package MIT like the rest, or
  reserved for a commercial tier (docs leave TBD).
- **D-F Engine-API gap wave**: land the missing public surfaces (see §4) as
  a pre-phase or per-panel PRs.
