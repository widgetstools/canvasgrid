# Markets Customizer Parity E2E — Design

**Date:** 2026-08-07  
**Status:** Approved for implementation planning  
**Demo:** `apps/cgrid-ext-demo`  
**Markets reference:** `/Users/develop/wfh/stern-bak/apps/e2e` (`v2-*.spec.ts`)

## Goal

Prove canvasgrid Customize sheet modules and related toolbars behave like Markets Grid: settings save correctly, and the grid executes those settings (filters, edits, alerts, format styles). Verification is a **behavioral checklist** ported from Markets Playwright specs — Markets is not run in the same CI job.

## Non-goals

- Twin CI that launches Markets + canvasgrid in one pipeline
- SSRM twin suite (`cgrid-ext-ssrm-demo`) — separate track
- Pixel / canvas scraping as primary assertions
- RelativeChange / tick-driven alerts that require a live feed (document as `n/a` or optional later)

## Verification approach

| Layer | How |
|-------|-----|
| UI | Playwright clicks on Customize sheet, ribbon, title-bar filter pills |
| Settings | `__edit.getSettings()`, cockpit Save/Reset, module state |
| Grid execution | `__ext.grid` APIs: `getGridOption`, `getFilterModel`, `getColumnState`, `forEachRow`, `getAlertRules` / `getAlertHistory`, `getRules`, `getTemplates` |
| Edit path | `__edit.smartEdit` / bulk / plusMinus / shortcuts apply + `journal` undo |

Each test cites its Markets source in a one-line comment, e.g.  
`// Markets: v2-bulk-update — bulk set after selection`.

## Boot & helpers

- Hermetic boot: `/?paintHarness` (200 fixed rows, no STOMP)
- Clear `localStorage` in `beforeEach` (existing `bootCustomizer`)
- Reuse / extend `e2e/helpers/customizer.ts`
- Add small helpers only when repeated (selection setup, filter-pill locators, edit apply)
- Prefer selection / `__edit.*.apply` when canvas cell clicks are flaky; still exercise Customize UI for settings Save
- Do not blur CodeMirror before Save assertions; do not press Escape while typing in CM

## Suite structure (option 2 — split by Markets module)

Keep existing coverage in `customizer.spec.ts` (shell, Options, Column Groups/Settings, Styling Rules, Calculated Columns, Persistence, Edit History smoke, Alerts smoke, thin Editing settings).

New or extended files land beside it under `apps/cgrid-ext-demo/e2e/`.

### Phase 1 — Customize sheet gap-fill

| File | Markets checklist | Must assert |
|------|-------------------|-------------|
| `customizer-bulkUpdate.spec.ts` | `v2-bulk-update.spec.ts` | Panel opens; settings Save → `__edit.getSettings().bulkUpdate`; range selection → Apply mutates values (`forEachRow`); Undo restores |
| `customizer-plusMinus.spec.ts` | `v2-plus-minus.spec.ts` | Panel opens; enable + nudge config Saves; `+/-` or API apply mutates target column; Undo restores |
| `customizer-smartEdit.spec.ts` | `v2-smart-edit.spec.ts` | Settings + ops (multiply / add / set); preview on/off if exposed; multi-column disable if parity exists |
| `customizer-shortcuts.spec.ts` | `v2-shortcuts.spec.ts` | Add binding + Save; letter key applies op; disabled module ignores keys; Undo |
| `customizer-alerts.spec.ts` | `v2-alerts.spec.ts` | Beyond current smoke: channels/frequency controls; enable kill-switch blocks dispatch; badge + mark-read |

Optional cleanup: once Phase 1 files cover the same ground, thin duplicates in `customizer.spec.ts` Editing/Alerts describes may be removed or left as smoke.

### Phase 2 — Toolbar parity

| File | Markets checklist | Must assert |
|------|-------------------|-------------|
| `savedFilters.spec.ts` | `v2-filters-toolbar.spec.ts` | Empty `+`; capture → pill; toggle off/on ↔ `getFilterModel()`; clear all; rename/remove; no duplicate when inactive pill matches live filter; layout-tier persist across reload / layout switch; overflow carets when applicable |
| `formattingToolbar.spec.ts` (new) and/or extend `formatPicker.spec.ts` / `iconRibbon.spec.ts` | `v2-formatting-toolbar.spec.ts` | Selection enables ribbon; Bold / align / clear write style state; templates; format undo if not already covered; overflow `⋯` at narrow viewport |

### Phase 3 — Full Markets mirror

- Add `apps/cgrid-ext-demo/e2e/parity/CHECKLIST.md` mapping each Markets `v2-*` case → canvasgrid spec + status (`covered` / `gap` / `n/a`)
- Fill remaining gaps: deeper column customization, conditional styling flash/indicators (where stable), edit-history edges, general settings, calc-column extras, profile/layout isolation where canvasgrid has an equivalent
- Explicit `n/a` for AG-DOM-only or Markets-lab-profile-only cases

## npm scripts

Extend `apps/cgrid-ext-demo` scripts so `test:e2e:customizer` includes Phase 1–2 customizer/toolbar specs (or a dedicated `test:e2e:parity` that composes them). Full suite remains `test:e2e`.

## Phased delivery order

1. Phase 1 specs + helper extensions + script wiring  
2. Phase 2 saved filters + formatting toolbar  
3. Phase 3 checklist + remaining module gaps  

Do not start Phase 2 until Phase 1 green on `paintHarness`. Do not start Phase 3 until Phase 2 green.

## Success criteria

- Phase 1: Bulk, ±/Minus, Smart Edit, Shortcuts, Alerts settings and at least one execute path each (mutate + undo or fire + badge) pass hermetically
- Phase 2: Saved filter pill lifecycle + format ribbon core ops pass; persist where product contract requires it
- Phase 3: Checklist exists; no silent omissions — every Markets case is `covered`, `gap`, or `n/a` with reason

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Canvas selection flaky vs AG `.ag-cell` | Use grid selection APIs + `__edit` apply; keep one UI path for toolbar Apply where present |
| ExpressionEditor auto-Save on blur | Existing `typeInCm` / Save helpers; never blur to dismiss |
| Layout vs profile persist for filters | Assert layout-tier contract from saved-filters design spec |
| Overlap with existing customizer tests | Prefer additive specs; dedupe only after new coverage is green |
