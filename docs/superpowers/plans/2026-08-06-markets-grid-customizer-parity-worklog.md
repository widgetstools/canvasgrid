# Markets Grid Customizer Parity — Implementation Worklog

**Date:** 2026-08-06  
**Status:** Research complete · ready for phased implementation  
**Reference codebase:** `/Users/develop/wfh/stern-bak/packages` (Markets Grid / StarUI)  
**Target codebase:** `/Users/develop/wfh/canvasgrid` (`@wellsfargo-starui/velocity-grid-ext`, `@wellsfargo-starui/velocity-grid-rules`, `@wellsfargo-starui/velocity-grid-edit`, `@wellsfargo-starui/velocity-grid-calc`, kernel)  
**Companion specs (already in-repo):**
- Engine contract: [`docs/starui-customizer/`](../../starui-customizer/)
- UI editor contract: [`docs/starui-customizer-ui/`](../../starui-customizer-ui/)

This worklog is the **implementation bridge**: what Markets Grid ships today, what canvasgrid already has, and the ordered work to close the gap without re-inventing engines that already exist.

---

## 0. Executive summary

Markets Grid’s “Grid Customizer” is not one panel — it is a **modular platform**:

1. **Module registry** (`DEFAULT_MODULES`) — 17 modules with priority-ordered transforms, activate hooks, serialize/deserialize, and optional Settings UI.
2. **Settings Sheet** — drawer/popout chrome with grouped menubar (Options / Columns / Styling / Editing / Data), dirty-draft counting, help cheatsheet, master-detail ListPane/EditorPane.
3. **Editing toolbars** — Smart Edit, Bulk Update, Edit History undo/redo live outside the sheet.
4. **Profiles** — per-module state snapshots; alert *history* and edit *journal stacks* are session-only.

**canvasgrid already has most engines** (`@wellsfargo-starui/velocity-grid-edit` journal + smart/bulk/±/shortcuts; `@wellsfargo-starui/velocity-grid-rules` RuleEngine + AlertsEngine; `@wellsfargo-starui/velocity-grid-calc`; ext settings modules for Options / Groups / Column Settings / Style Rules / Calculated Columns). The missing work is primarily **Alerts UI + Edit History UI/tooling + Editing-module settings panels + sheet IA (menubar groups) + profile persistence for the new modules + E2E**.

**Row-model requirement:** every customizer feature in this worklog must work on **both** client-side row model (`cgrid-ext-demo`) **and** sparse SSRM v2 (`cgrid-ext-ssrm-demo` / blotter). CSRM-only acceptance is insufficient. See §3a.

**Research sources (2026-08-06):**
- Markets inventory — [Explore Markets Grid customizer](aaf50f8a-df67-4a2e-8615-5e2d469c0994)
- canvasgrid gap analysis — [Compare canvasgrid customizer gap](cce3d01e-78a2-4261-b7e1-1176cf839f2b)

---

## 1. Markets Grid architecture (source of truth)

### 1.1 Module list & Settings menubar

Source: `react-grid/grid/src/widget/modules.ts`, `SettingsModuleMenubar.tsx`, `SettingsSheet.tsx`.

| Group | Module id | UI label | Has Settings UI | Priority (approx) |
|-------|-----------|----------|-----------------|-------------------|
| **Options** | `general-settings` | Grid Options | Flat panel | 0 |
| Options | `toolbar-visibility` | Toolbar Visibility | Hidden (profile-only) | 1000 |
| Options | `toolbar-date-settings` | Custom Settings | Flat panel | 1002 |
| Options | `grid-state` | Grid State | No panel (save/replay only) | 200 |
| Options | `shortcuts` | Shortcuts | Master-detail | 25 |
| **Columns** | `column-customization` | Column Settings | Master-detail | 10 |
| Columns | `column-groups` | Column Groups | Master-detail | 18 |
| Columns | `calculated-columns` | Calculated Columns | Master-detail | 15 |
| Columns | `column-templates` | Templates | Passive (state for ribbon/templates) | 5 |
| **Styling** | `conditional-styling` | Style Rules | Master-detail | 20 |
| Styling | `alerts` | Alerts | Master-detail | 27 |
| **Editing** | `smart-edit` | Smart Edit | Flat settings | 22 |
| Editing | `bulk-update` | Bulk Update | Flat settings | 23 |
| Editing | `plus-minus` | Plus / Minus | Master-detail | 24 |
| Editing | `data-change-history` | Edit History | Flat + live monitor | 26 |
| **Data** | `saved-filters` | Saved Filters | Opaque state (+ Filters toolbar) | 1001 |
| Data | `visual-excel` | Visual Excel | Flat panel | 21 |

Settings sheet only shows modules that expose `SettingsPanel` and/or `ListPane`+`EditorPane`. Hidden modules still round-trip through profiles.

### 1.2 Cross-cutting chrome

| Surface | Path | Behavior |
|---------|------|----------|
| Settings Sheet | `widget/SettingsSheet.tsx` | Drawer + optional OpenFin popout; dirty count via DirtyBus; help panel; Done closes |
| Module menubar | `widget/SettingsModuleMenubar.tsx` | 5 categories (no horizontal tab overflow) |
| Draft cards | `useModuleDraft` (customizer hooks) | Per-item Save/Reset; Esc discard confirm |
| Profiles | `useProfileManager` + core profile store | Serialize each module; load/switch/save-as |
| Expression editor | `customizer/ui/ExpressionEditor` | CodeMirror, lint, `[col]` completion, ⌘↵ commit |
| Style chrome | style editors + color pickers | Theme-aware `{dark,light}` styles |
| HistoryStack | `core/engine/src/history/HistoryStack.ts` | Generic undo for **UI state** snapshots (not cell edits) |
| EditJournal | `core/.../editing-core/EditJournal.ts` | Cell-patch undo/redo + monitor list |

### 1.3 Four systems often mislabeled “history / undo” (do not conflate)

| System | What it tracks | Persistence | UX |
|--------|----------------|------------|----|
| **EditJournal** (`data-change-history` + `editing-core`) | Cell value patches from Smart Edit / Bulk / ± / Shortcuts / cell editor / (opt) stream | **Settings only** (enabled, maxEntries, unifyUndo, recordSources). Stacks are **session-only** | Toolbar Undo/Redo + monitor per-entry Undo |
| **Formatter HistoryStack** (Markets Formatting Toolbar; canvasgrid `formatHistory.ts`) | Column customization style/format/template mutations from the ribbon | Session only | Formatting undo/redo pills — **separate** from EditJournal |
| **Native cell undo** (AG `undoRedoCellEditing` / kernel equivalent) | Built-in cell edits | Session | Disabled when Edit History `unifyUndo` is on |
| **Alert notification history** | Fired alert events | **Never persisted** (`serialize` forces `history: []`) | Toolbar bell badge + popover |

Also: **module drafts** (card Save/Reset) and **profile discard** are not undo stacks — they revert unsaved UI or reload the last saved profile snapshot.

**“Layouts” wording:** Markets’ ProfileSelector says “layout”; there is **no** separate Layouts module. Column order/sort/filter ride `grid-state` inside the active profile. canvasgrid title bar currently elevates **layouts** as the primary switcher; profiles remain wave-0 / secondary — keep that distinction when porting Save UX.

---

## 2. Feature inventory (Markets Grid → canvasgrid)

Legend for **canvasgrid status**:
- **Engine solid** — library logic exists and is wired in demos
- **UI partial** — some settings UI / toolbar exists
- **UI missing** — no Customize-sheet module / incomplete chrome
- **Gap** — needs both engine work and UI (rare)

### 2.1 Options group

#### A. Grid Options (`general-settings`)
- **Markets:** ~80 curated options: density, row/header height, selection, sidebar, status bar, floating filters, animate rows, cell flash colors, undoRedoCellEditing (AG native), refresh-rate cap, etc. Live apply via `transformGridOptions`.
- **Paths:** `customizer/modules/general-settings/*`, state schemaVersion 6.
- **canvasgrid:** **UI partial** — `packages/ext/src/modules/gridOptions.ts` + kernel settings panel; E2E covers core fields. Not full Top-80 parity (flash color swatches, density presets, update-rate cap may still lag).
- **Work:** Gap-audit fields vs Markets `INITIAL_GENERAL_SETTINGS`; port missing rows; keep live-apply semantics.

#### B. Toolbar Visibility (`toolbar-visibility`)
- **Markets:** Hidden module; `visible: Record<toolbarId, boolean>` in profile.
- **canvasgrid:** **UI missing** / ribbon has its own visibility patterns.
- **Work:** Low priority unless host needs profile-round-trip of ribbon segments.

#### C. Toolbar Date / Custom Settings (`toolbar-date-settings`)
- **Markets:** Historical as-of date + row-exclusion expression via external filter.
- **canvasgrid:** **Gap** for Markets-blotter hosts; not required for generic customizer parity.
- **Work:** Defer to host-specific phase.

#### D. Grid State (`grid-state`)
- **Markets:** Capture native AG state on Save; replay on ready / profile:loaded. Priority 200 last.
- **canvasgrid:** **Engine solid / UI partial** — kernel `getState`/`setState` + ext profiles; capture-on-save path exists but bootstrap can race module registration (already noted in E2E persistence test).
- **Work:** Harden profile bootstrap to re-apply after rules/calc wire; document Save contract.

#### E. Shortcuts (`shortcuts`)
- **Markets:** Letter-key numeric ops; ListPane/EditorPane for shortcut defs; `transformColumnDefs` + `activate`.
- **canvasgrid:** **Engine solid** (`@wellsfargo-starui/velocity-grid-edit` shortcuts + bridge); **UI missing** settings module.
- **Work:** Phase 3 settings panel + profile slice; ribbon already uses edit handle.

### 2.2 Columns group

#### F. Column Settings (`column-customization`)
- **Markets:** Assignments: caption, filter, row grouping, pin/hide, themed cell/header style, formatters, cellRendererId/config, global baselines. Depends on templates.
- **canvasgrid:** **UI partial** — cockpit Column Settings with draft Save; caption via calc overrides; pin apply-order fixed. Missing: full style bands, cell renderers picker, global baselines UI, template chain depth.
- **Work:** Phase 4 deepen bands; keep draft/Save contract; E2E per band.

#### G. Column Groups (`column-groups`)
- **Markets:** Nestable groups, header style CSS, openGroupIds persistence, compose into ColGroupDefs.
- **canvasgrid:** **UI partial** — groups panel + picker + Save; header style coverage TBD vs Markets.
- **Work:** Verify header style/borders parity; expand/collapse memory.

#### H. Calculated Columns (`calculated-columns`)
- **Markets:** Virtual cols, aggregates with group scope, format/placement, cross-row invalidation when aggregates used.
- **canvasgrid:** **Engine solid + UI partial** — calc bridge + Customize tab; E2E covers add/invalid/delete/pin.
- **Work:** Aggregate-invalidation polish; format picker fit-to already started.

#### I. Templates (`column-templates`)
- **Markets:** Passive state; ribbon Template Manager resolves chain into customization.
- **canvasgrid:** **UI partial** — `templateManager.ts` / ribbon templates tests landed; not a Settings tab.
- **Work:** Ensure profile serialize of templates; keep ribbon as primary UX (Markets also hides templates from casual nav).

### 2.3 Styling group  ★ high priority for this request

#### J. Style Rules (`conditional-styling`)
- **Markets features:**
  - Row vs cell scope + target columns
  - Expression with `[col]` / `[col.old]` / `[col.new]`
  - Theme-aware base style (bg/fg/font/borders)
  - Flash config (oneShot/pulse, palette, duration, target cells/headers/row)
  - Indicators (Lucide icon badges)
  - Priority, enabled, activeDurationMs
  - Runtime: cellClassRules / rowClassRules + CSS injection + header painter + timed activations
- **Paths:** `conditional-styling/{index,runtime/*,ConditionalStylingPanel,*}`
- **canvasgrid:** **Engine solid + UI partial** — `@wellsfargo-starui/velocity-grid-rules` RuleEngine wired; Customize Styling Rules tab with expression/style bands; flash/indicator depth may lag Markets.
- **Gaps called out in gap analysis:** UI filters `kind === 'style'` so standalone `IndicatorRule` is not edited; aggregate/`PREV()` in rule conditions still reserved; no settings-sheet undo for rule CRUD (draft discard only).
- **Work:** Audit flash + indicators + header painter vs Markets; decide whether IndicatorRule gets its own editor or stays style-embedded; expand E2E beyond expression/name/scope.

#### K. Alerts (`alerts`)  ★ missing UI + persistence hole
- **Markets features:**
  - Trigger kinds: `dataChange` (expression), `relativeChange` (%/abs/any + direction), `rowChange` (added/removed)
  - Severity: info/success/warning/critical
  - Message templates: `{value}`, `{prev}`, `{rowId}`, `{column}`, …
  - Channels: toast, badge, openfin (no-op without `fin`)
  - Per-rule debounce; global settings: enable, defaultDebounceMs, maxNotificationsPerSecond, historyLimit, evaluationMode (realtime/throttled/paused), channel kill-switches
  - Runtime: previous-value store, dispatch token-bucket, AG event wiring
  - Toolbar **AlertsBadge** + toast bridge + OpenFin bridge
  - Persist rules+settings; **never** persist notification history
- **Paths:**  
  - Core: `core/engine/src/customizer/modules/alerts/state.ts`  
  - UI/runtime: `react-grid/.../customizer/modules/alerts/*`
- **canvasgrid:** **Engine solid / UI missing** — `packages/rules/src/alerts/alertsEngine.ts` + types in `rules/src/types.ts`; `wireIntoKernel` constructs AlertsEngine; showcase demo has a feature sample. **No** Customize Alerts tab or badge in `@wellsfargo-starui/velocity-grid-ext`.
- **Critical persistence gap:** kernel `registerStateModule('rules')` snapshots **style rules only**. Alert rules + `AlertsSettings` are **not** in the profile/module envelope today — Phase 2 must register a dedicated `alerts` (or extended) state module, not assume they ride `rules`.
- **Work:** Phase 2 (see §4) — full Alerts module + badge + **separate state-module persistence** + E2E.

### 2.4 Editing group  ★ undo/redo / session history

#### L. Edit History (`data-change-history`)  ★ incomplete chrome
- **Markets features:**
  - Settings: enabled, suspended, maxEntries (default 50), unifyUndo (disables AG native undo), recordSources {smartEdit, bulkUpdate, plusMinus, shortcuts, cellEditor, stream}
  - Live **EditHistoryMonitor** — chronological entries with per-entry Undo (undoEntry walks timeline)
  - Toolbar **EditHistoryToolbarBody** — Undo / Redo / entry count
  - `activate` records cell-editor patches; wraps value setters; journal via editing-core
- **Paths:** `data-change-history/*`, `editing/journalUndoRedo.ts`, core `EditJournal`
- **canvasgrid:** **Engine solid / UI missing** — `@wellsfargo-starui/velocity-grid-edit` `EditJournal` + settings helpers (`shouldRecord`, etc.); demo wires `wireEditIntoKernel`; ribbon History already calls `journal.undo/redo`. **No** Customize “Edit History” panel / live monitor (#11). Format undo lives separately in `ext/src/toolbar/formatHistory.ts` (templates+overrides only — ignores rules/calc/alerts).
- **Work:** Phase 1 — settings module + monitor + unifyUndo coordination; do **not** merge formatHistory into EditJournal.

#### M. Smart Edit (`smart-edit`)
- **Markets:** Settings (enabled, magnitude shortcuts, preview); toolbar body for ops on selection; records to journal.
- **canvasgrid:** **Engine solid + UI partial** — bridge + ribbon wiring; Lit settings panel already exists in `@wellsfargo-starui/velocity-grid-customizer` (`packages/customizer/src/panels/smartEdit.ts`) but is **not** in the ext Customize sheet / `defaultBundle`.
- **Work:** Phase 3 — either promote Lit panel into sheet IA or port cockpit equivalent; wire profile settings slice.

#### N. Bulk Update (`bulk-update`)
- **Markets:** Replace selection column with one value; distinct-values feed; toolbar.
- **canvasgrid:** **Engine solid + UI partial** — same as Smart Edit (`packages/customizer/src/panels/bulkUpdate.ts` Lit panel exists; not in default Customize nav).
- **Work:** Phase 3.

#### O. Plus / Minus (`plus-minus`)
- **Markets:** Per-column nudge rules (step, optional expression gate); keyboard activate; master-detail editor.
- **canvasgrid:** **Engine solid / UI missing** settings ListPane.
- **Work:** Phase 3.

### 2.5 Data group

#### P. Saved Filters (`saved-filters`)
- **Markets:** Opaque filterModel pills in Filters toolbar; validated on deserialize.
- **canvasgrid:** **Partial** — kernel filter model exists; no Markets-style saved-filter pills module.
- **Work:** Phase 5 (host toolbar).

#### Q. Visual Excel (`visual-excel`)
- **Markets:** Builds `excelStyles` from column customization + conditional styling for faithful XLSX export.
- **canvasgrid:** **Gap / partial** — export exists in kernel; visual-excel module not in ext.
- **Work:** Phase 5 after style/format stability.

### 2.6 Toolbars outside the sheet (Markets)

| Toolbar | Module | canvasgrid |
|---------|--------|------------|
| Smart Edit toolbar | smart-edit | Partial (ribbon) |
| Bulk Update toolbar | bulk-update | Partial (ribbon) |
| Edit History undo/redo | data-change-history | Missing / incomplete |
| Alerts badge | alerts | Missing |
| Filters pills | saved-filters | Missing |
| Formatting / style ribbon | column-customization + templates | Partial (ribbon format picker, templates) |

---

## 3a. SSRM parity (first-class — cgrid-ssrm / cgrid-ext-ssrm)

Markets Grid customizations are used on live blotters. canvasgrid’s reference host is already wired:

| Host | Path | Row model | Engines today |
|------|------|-----------|---------------|
| Ext CSRM demo | `apps/cgrid-ext-demo` | client / paintHarness | format + edit + calc + rules + Customize sheet |
| Ext SSRM demo | `apps/cgrid-ext-ssrm-demo` | sparse SSRM v2 + mock server | same wires + titleBar + ribbon; edits round-trip via `server.applyEdit` + `applyServerSideTransaction` |
| SSRM blotter | `apps/cgrid-ssrm-demo` | sparse SSRM + STOMP/Perspective | chrome varies; same kernel engines when host wires them |

**Hard rule:** a phase is not done until the feature passes hermetic checks on **both** `/?paintHarness` (or CSRM) **and** `cgrid-ext-ssrm-demo` (or equivalent SSRM harness).

### 3a.1 SSRM constraints by feature

| Feature | SSRM reality | Implementation contract |
|---------|--------------|-------------------------|
| **Style Rules** | Paint/eval only against **hydrated** leaf rows in cache; group/skeleton/`__ssrm` rows are not style targets | Rules engine stays event-driven (`rowsChanged` / `cellValueChanged` / ticks). “Applied N rows” chips must label **loaded window** (or “—”), never claim full book size |
| **Alerts** | `dataChange` / `relativeChange` fire on edit + live ticks for loaded leaves; `rowChange` may see block fetch add/remove, not full universe | Previous-value store keyed by `rowId+colId` for hydrated cells only; debounce/token-bucket must survive soft `refreshServerSide`; do not require scanning unloaded rows |
| **Edit History / Undo** | Authoritative book is the **server**; kernel hydrate is a cache | Journal undo/redo must reverse **both** grid cache and server (`applyEdit` / SSRM transaction), same as forward edit path in `cgrid-ext-ssrm-demo`. Skipping server → undone UI that reappears on rehydrate |
| **Smart Edit / Bulk / ± / Shortcuts** | Target collection uses `getRowsByIndex` — only loaded indexes resolve | Ops apply to selection ∩ hydrated rows; missing fetches skip (already in `collectCellsByType`). Document “selection may include unloaded rows — skipped”. Never invent synthetic rows |
| **Calculated columns** | Row-local exprs OK on hydrated leaves; book-wide aggregates may disagree with server group totals | Prefer row-local calc on SSRM; if aggregates ship, document they are **client-window** unless a server expression path exists. Don’t break group footer / grand-total SSRM path |
| **Column Settings / Groups / Options** | Structure transforms are row-model agnostic | Pin/hide/group defs must not mark skeleton/auto-group columns editable (`columns.ts` already guards `__ssrm`) |
| **Profiles / grid-state** | SSRM viewport + expanded group skeleton matter | Capture/replay must restore open groups + scroll without purging the whole cache incorrectly; Save must not assume CSRM `setRowData` |
| **Live ticks** | Soft refresh every 1s + `applyServerSideTransaction` | Alerts/style flash must not storm; Edit History `recordSources.stream` default **off** (already Markets default) |

### 3a.2 Host integration checklist (SSRM)

Every new Customize module must:

1. Use **public** grid/edit/rules APIs only (no CSRM-only private caches).
2. Treat missing `getRowsByIndex` results as skip, not error.
3. On cell edit undo/redo, invoke the same host persistence hook CSRM demos use for forward edits (ext-ssrm: `server.applyEdit` + SSRM tx). Prefer a single `EditGridWriter` / host callback so CSRM and SSRM share code.
4. Ignore non-leaf / `__ssrm` meta rows for edit + alert evaluation.
5. Add at least one E2E or smoke assertion on `apps/cgrid-ext-ssrm-demo` (expand a group → edit leaf → undo → alert/style still coherent after soft refresh).

### 3a.3 SSRM acceptance matrix (add to each phase DoD)

| Check | CSRM (`cgrid-ext-demo`) | SSRM (`cgrid-ext-ssrm-demo`) |
|-------|-------------------------|------------------------------|
| Customize sheet opens; module Save/Reset | ✅ | ✅ |
| Style rule paints matching **visible** leaves | ✅ | ✅ (after expand/hydrate) |
| Alert fires on cell edit | ✅ | ✅ + survives soft refresh |
| Alert relativeChange on tick (optional) | if ticks | ✅ mock ticker |
| Edit → journal entry → Undo restores value | ✅ | ✅ **and** server book matches |
| Smart Edit on range with partial hydrate | N/A / all loaded | Skips unloaded; no throw |
| Profile Save / reload keeps rules+settings | ✅ | ✅ (alerts module once registered) |
| Group/skeleton rows not editable | N/A | ✅ |

### 3a.4 Suggested SSRM test harness

- Extend or twin `apps/cgrid-ext-demo/e2e/customizer.spec.ts` → `apps/cgrid-ext-ssrm-demo/e2e/customizer-ssrm.spec.ts`.
- Boot: `npm run dev:ext-ssrm-demo` (self-contained mock server, no STOMP).
- Minimal scenario: open Settings → add style/alert → expand Desk group → edit hydrated PnL → Undo → assert DOM/API + `server` book.
- Reuse `window.__demo = { ext, grid, server, editHandle }`.

---

## 3. Gap matrix (priority)

| Priority | Feature | Engine | Customize UI | Toolbar | Profile | E2E |
|----------|---------|--------|--------------|---------|---------|-----|
| P0 | Edit History + Undo/Redo | ✅ `@wellsfargo-starui/velocity-grid-edit` | ❌ | ⚠️ ribbon | settings only | ❌ |
| P0 | Alerts rules + badge | ✅ `@wellsfargo-starui/velocity-grid-rules` | ❌ | ❌ | ❌ | ❌ |
| P1 | Style Rules flash/indicators parity | ✅ | ⚠️ | n/a | ⚠️ | ⚠️ |
| P1 | Sheet IA (menubar groups / more tabs) | n/a | ⚠️ tabs only | n/a | n/a | ⚠️ |
| P2 | Smart Edit / Bulk / ± / Shortcuts settings | ✅ | ❌ | ⚠️ | ❌ | ❌ |
| P2 | Column Settings style/renderer depth | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| P3 | Visual Excel / Saved Filters / Date settings | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| P3 | Templates profile polish | ⚠️ | ribbon | ✅ | ⚠️ | ⚠️ |

---

## 4. Phased implementation plan

### Phase 0 — Substrate (1–2 days)
**Goal:** Stable hooks so new modules don’t fight bootstrap/profile races.

| Task | Detail | Done when |
|------|--------|-----------|
| 0.1 Profile re-apply after wire | After `wireRules` / `wireCalc` / `wireEdit`, call `profiles.switchTo(activeId)` or deferred bootstrap | Persistence E2E green without flaky race |
| 0.2 Ext module contract doc | Document SettingsModule shape vs Markets `Module<T>` (ListPane/EditorPane optional) | README section in ext |
| 0.3 Menubar grouping | Port `MODULE_GROUP_DEFS` into shell nav (Options/Columns/Styling/Editing/Data) when module count > ~6 | Nav groups in UI; e2e updates |
| 0.4 DirtyBus (optional) | Aggregate per-card dirty count in sheet header like Markets `useDirtyCount` | Footer/header shows Dirty=N |

**Refs:** Markets `SettingsSheet.tsx`, canvasgrid `packages/ext/src/shell/shell.ts`, `profiles/controller.ts`.

---

### Phase 1 — Edit History + session Undo/Redo (P0)
**Goal:** Users can record all in-session cell edits and undo/redo them (Markets Edit History).

#### 1A. Engine surface (mostly exists)
| Task | Files | Notes |
|------|-------|-------|
| 1.1 Confirm journal API on edit handle | `packages/edit/src/bridge.ts`, `journal.ts` | Expose `journal.undo/redo/undoEntry/entries/subscribe`, settings getters/setters |
| 1.2 Unify with kernel cell edits | bridge `cellValueChanged` recording | Match Markets `recordCellEditorPatch` + `unifyUndo` semantics |
| 1.2b SSRM undo writer | shared apply path with `cgrid-ext-ssrm-demo` | Undo/redo must call server `applyEdit` (or host writer) + SSRM tx, not only hydrate cache |
| 1.3 Suspend during journal apply | guard re-entry | Markets `withJournalApplyGuard` / `journal.suspend` |

#### 1B. Customize module
| Task | Files | Notes |
|------|-------|-------|
| 1.4 `dataChangeHistoryModule` | `packages/ext/src/modules/dataChangeHistory.ts` | Cockpit flat panel: Global + Record Sources + Monitor |
| 1.5 Monitor component | port UX from `EditHistoryMonitor.tsx` | Per-entry Undo calling `journal.undoEntry` |
| 1.6 Profile serialize | settings only | Never persist past/future stacks |
| 1.7 Register in `defaultBundle` | under Editing group | |

#### 1C. Toolbar
| Task | Files | Notes |
|------|-------|-------|
| 1.8 Undo/Redo buttons | ribbon / editing toolbar | Disabled when `!canUndo/canRedo`; show stack size |
| 1.9 Keyboard (optional) | ⌘Z / ⇧⌘Z when unifyUndo | Don’t fight browser when editing text fields |

#### 1D. Verification
| Task | Notes |
|------|-------|
| 1.10 Unit tests | Journal record sources, unifyUndo, undoEntry cascade |
| 1.11 E2E CSRM | Edit cell → monitor entry → Undo toolbar → value restored → Redo |
| 1.12 E2E SSRM | Expand group → edit hydrated leaf → Undo → grid **and** `server` book match (§3a.3) |

**Acceptance:** Markets-equivalent Edit History panel + toolbar undo/redo on **CSRM and SSRM**.

---

### Phase 2 — Alerts (P0)
**Goal:** Alerts sit beside Style Rules in Customize → Styling.

#### 2A. Wire engine into grid lifecycle
| Task | Files | Notes |
|------|-------|-------|
| 2.1 Public grid API for alerts | kernel bridge / rules bridge | `getAlertRules`, `addAlertRule`, `updateAlertRule`, `deleteAlertRule`, `getAlertsSettings`, `setAlertsSettings`, `getAlertHistory`, `markAlertRead`, `clearAlertHistory` |
| 2.2 Ensure live evaluation | `wireIntoKernel` already builds AlertsEngine | Verify dataChange / relativeChange / rowChange on **CSRM and SSRM** (hydrated leaves + tick path; no full-book scan) |
| 2.3 State module persistence | **New** `registerStateModule({ id: 'alerts', … })` — do **not** fold into `rules` | Persist rules+settings; history always `[]` on serialize; verify profile reload restores alerts independently of style rules |

#### 2B. Customize UI
| Task | Files | Notes |
|------|-------|-------|
| 2.4 `alertsModule` settings | `packages/ext/src/modules/alerts.ts` (+ panel components) | Mirror Markets `AlertsPanel.tsx` bands |
| 2.5 Trigger tabs | Expression / Δ Delta / Row | Reuse ExpressionEditor |
| 2.6 Global settings band | enable, frequency, channels, history limit | Collapsed by default |
| 2.7 Draft Save/Reset | same cockpit card contract as Style Rules | |

#### 2C. Chrome
| Task | Files | Notes |
|------|-------|-------|
| 2.8 AlertsBadge | title bar / ribbon | Unread count + popover list |
| 2.9 Toast bridge | host toast or simple DOM toasts | OpenFin optional later |
| 2.10 Register in defaultBundle + menubar Styling | next to conditional-styling | |

#### 2D. Verification
| Task | Notes |
|------|-------|
| 2.11 Unit | AlertsEngine already tested — add ext module tests |
| 2.12 E2E CSRM | Create dataChange rule → mutate cell → toast/badge → history; relativeChange; disable; profile reload keeps rules, clears history |
| 2.13 E2E SSRM | Same on hydrated leaf after expand; fire on mock tick if relativeChange; history intact across soft `refreshServerSide` |

**Acceptance:** User can author all three trigger kinds; notifications fire on CSRM **and** SSRM; profile round-trips rules (not notification history).

**UI spec:** [`docs/starui-customizer-ui/05-alerts.md`](../../starui-customizer-ui/05-alerts.md)  
**Engine spec:** [`docs/starui-customizer/04-alerts.md`](../../starui-customizer/04-alerts.md)

---

### Phase 3 — Editing modules settings (P2)
**Goal:** Settings panels for engines already on `wireEditIntoKernel`.

| Module | UI type | Profile | Toolbar already? |
|--------|---------|---------|------------------|
| Smart Edit | Flat settings | settings | Yes (ribbon) |
| Bulk Update | Flat settings | settings | Yes |
| Plus / Minus | Master-detail nudges | settings+nudges | Keyboard |
| Shortcuts | Master-detail defs | settings+shortcuts | Keyboard |

| Task | Notes |
|------|-------|
| 3.1 Four ext modules | Port Markets panels → cockpit |
| 3.2 Journal integration | Toggles in Edit History recordSources must control these |
| 3.3 E2E smoke | One happy path each + undo via journal |

---

### Phase 4 — Style Rules + Column Settings depth (P1)
| Task | Notes |
|------|-------|
| 4.1 Flash parity | oneShot/pulse, palette, header targets |
| 4.2 Indicators | Lucide catalog already partially in styling module |
| 4.3 Column Settings style bands | Themed cell/header + format + renderer picker |
| 4.4 Expand customizer E2E | Flash, indicator, pin+caption regression suite |

---

### Phase 5 — Data / export / host extras (P3)
| Task | Notes |
|------|-------|
| 5.1 Visual Excel module | excelStyles from styles + formats |
| 5.2 Saved Filters | pills toolbar + profile validation |
| 5.3 Toolbar date settings | only if blotter host needs as-of |
| 5.4 Toolbar visibility profile keys | if ribbon segments must round-trip |

---

## 5. Recommended build order (dependency DAG)

```text
Phase 0 substrate
    │
    ├─► Phase 1 Edit History / Undo-Redo  ──► Phase 3 Editing settings
    │                                              (journal recordSources)
    │
    └─► Phase 2 Alerts ──► (badge uses same toast infra)
                │
                └─► Phase 4 Style depth (shared ExpressionEditor / style chrome)
                              │
                              └─► Phase 5 Visual Excel / Saved Filters
```

**Do not** build Alerts UI before confirming AlertsEngine fires on the demo’s row model.  
**Do not** ship Undo toolbar before unifyUndo + journal apply guards (double-apply bugs).

---

## 6. Concrete file map (canvasgrid targets)

| Area | Create / extend |
|------|-----------------|
| Edit History module | `packages/ext/src/modules/dataChangeHistory.ts` |
| Alerts module | `packages/ext/src/modules/alerts.ts` (+ `alertsPanel` helpers) |
| Bundle | `packages/ext/src/defaultBundle.ts` |
| Shell nav groups | `packages/ext/src/shell/shell.ts` |
| Profiles | `packages/ext/src/profiles/controller.ts` + rules/calc state modules |
| Alerts API | `packages/rules/src/bridge.ts` (+ kernel public façade if needed) |
| Journal toolbar | `packages/ext/src/toolbar/ribbon.ts` / editing toolbar |
| Badge | `packages/ext/src/toolbar/alertsBadge.ts` |
| E2E | `apps/cgrid-ext-demo/e2e/customizer.spec.ts` (+ alerts/history specs) |
| Unit | `packages/ext/tests/alerts*.test.ts`, `dataChangeHistory*.test.ts` |

Reference (read-only) Markets paths:
- `stern-bak/packages/react-grid/grid/src/customizer/modules/alerts/`
- `stern-bak/packages/react-grid/grid/src/customizer/modules/data-change-history/`
- `stern-bak/packages/core/engine/src/customizer/modules/alerts/state.ts`
- `stern-bak/packages/core/engine/src/customizer/modules/editing-core/EditJournal.ts`

---

## 7. UX contracts to preserve (parity checklist)

Copied from Markets — treat as acceptance criteria:

1. **Card Save/Reset** — every master-detail editor keeps draft until Save; Reset discards; dirty Confirm on navigate away.
2. **Title-bar Save\*** — persists profile (module settings + grid state); does not persist alert history or edit journal stacks.
3. **Esc** — closes Customize sheet (already); must not steal from ExpressionEditor unnecessarily.
4. **Expression blur auto-commit** — Markets/canvasgrid ExpressionEditor may Save on blur; E2E helpers must not blur before asserting Save enabled.
5. **Unify undo** — when Edit History unifyUndo is on, native AG/cgrid undo is disabled; one stack only.
6. **Alert history session-only** — reload clears notifications; rules remain.
7. **Priority ordering** — lower priority number fires first (alerts + style rules).

---

## 8. Testing strategy

| Layer | Scope |
|-------|-------|
| Unit | AlertsEngine triggers; EditJournal stacks; ext module serialize/deserialize |
| Integration | wireEdit + wireRules on real VelocityGrid **CSRM + SSRM**; mutate cells; undo; alert fire |
| E2E CSRM | `apps/cgrid-ext-demo/e2e/customizer.spec.ts` (+ alerts/history) via `/?paintHarness` |
| E2E SSRM | `apps/cgrid-ext-ssrm-demo/e2e/customizer-ssrm.spec.ts` — expand → edit → undo → alert/style (§3a.4) |
| Smoke | Keep `cgrid-ext-ssrm-demo/scripts/smoke.mjs` green when chrome changes |
| Manual | OpenFin channel (optional); toast flood under maxNotificationsPerSecond; long scroll + tick under alerts |

Reuse CSRM helpers in `apps/cgrid-ext-demo/e2e/helpers/customizer.ts`; SSRM twin should share open/tab/CM helpers where possible.

---

## 9. Out of scope / defer

- Full Markets “Custom Settings” as-of date blotter pipeline (host-specific).
- OpenFin Notifications Center (badge/toast first; OpenFin bridge later).
- Replacing canvasgrid ribbon with Markets PrimaryToolbar 1:1.
- React port of SettingsSheet — stay on vanilla/cockpit in `@wellsfargo-starui/velocity-grid-ext`.
- AG Grid Enterprise-only APIs that canvasgrid kernel does not implement.
- **SSRM full-book** rule/alert evaluation over unloaded rows (not feasible client-side; document loaded-window semantics instead of faking counts).

---

## 10. Effort sketch (rough)

| Phase | Effort | Risk |
|-------|--------|------|
| 0 Substrate | 1–2 d | Low |
| 1 Edit History | 4–6 d | Medium–high (unifyUndo **+ SSRM server round-trip undo**) |
| 2 Alerts | 6–9 d | Medium (relativeChange + channels + SSRM ticks) |
| 3 Editing settings | 4–6 d | Low (engines exist; SSRM skip unloaded already) |
| 4 Style/Column depth | 5–10 d | Medium (CSS/header painter; loaded-window counts) |
| 5 Data/export | 3–6 d | Low–medium |
| SSRM E2E twin suite | +2–3 d | Medium (flaky hydrate timing) |

Total to strong Markets customizer parity on **CSRM + SSRM** (P0–P2): **~5–7 weeks** for one engineer familiar with ext/cockpit and sparse SSRM.

---

## 11. First sprint recommendation (start here)

1. **Phase 0.1** — fix profile bootstrap race (unblocks all persistence work).  
2. **Phase 1** — Edit History panel + toolbar Undo/Redo, with **SSRM server-backed undo** from day one.  
3. **Phase 2** — Alerts tab + badge beside Style Rules; verify on `cgrid-ext-ssrm-demo` ticks.  
4. Land **CSRM + SSRM** E2E after each phase; do not batch UI without hermetic tests on both hosts.

---

## 12. Traceability

| User ask | Where covered |
|----------|---------------|
| Style rules | §2.3 J, Phase 4 |
| Alert rules | §2.3 K, Phase 2 |
| Session edit history | §1.3, §2.4 L, Phase 1 |
| Undo/redo edits | §2.4 L, Phase 1 |
| Every customization feature | §1.1 table + §2 inventory |
| **Works on cgrid SSRM** | **§3a**, phase DoD rows 1.12 / 2.13, §8 |
| Implementation worklog | §4–§11 |

When implementing a phase, open the matching `docs/starui-customizer-ui/NN-*.md` and treat it as the UX acceptance checklist; use Markets source only for behavioral edge cases not captured in those docs.

---

## 13. Appendix — Markets → canvasgrid package map

| Markets (stern-bak) | canvasgrid today |
|---------------------|------------------|
| `react-grid/.../SettingsSheet` + menubar | `@wellsfargo-starui/velocity-grid-ext` shell (flat icon tabs; needs groups) |
| `react-grid/.../customizer/modules/*` | `@wellsfargo-starui/velocity-grid-ext/src/modules/*` (5 of ~17) |
| Lit-less React panels | Mostly vanilla cockpit in ext; **partial** Lit in `@wellsfargo-starui/velocity-grid-customizer` (Smart Edit + Bulk Update only) |
| `core/engine` EditJournal / alerts / CS | `@wellsfargo-starui/velocity-grid-edit`, `@wellsfargo-starui/velocity-grid-rules`, `@wellsfargo-starui/velocity-grid-calc` |
| Formatting Toolbar + HistoryStack | `ext` ribbon + `formatHistory.ts` |
| ProfileManager + “layout” selector | `ext` profiles (wave-0) + title-bar **layouts** as primary switcher |
| Showcase / OpenFin bridges | `apps/cgrid-showcase` alerts sample; OpenFin deferred |

**`defaultBundle` today:** settings-launcher, Save\*, grid-options, column-groups, column-settings, conditional-styling, calculated-columns.  
**Not bundled:** alerts, data-change-history, smart-edit/bulk-update/plus-minus/shortcuts settings, visual-excel, saved-filters, toolbar-date-settings, expressionLab (exported but unused).
