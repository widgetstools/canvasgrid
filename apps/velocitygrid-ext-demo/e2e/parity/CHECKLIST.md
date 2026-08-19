# Markets customizer parity checklist

Maps Markets Playwright specs (`/Users/develop/wfh/stern-bak/apps/e2e/v2-*.spec.ts`) to canvasgrid `apps/velocitygrid-ext-demo/e2e` coverage.

**Statuses:** `covered` · `gap` · `n/a`  
**Boot:** canvasgrid customizer/toolbar parity specs use `/?paintHarness` unless noted.

| Markets file | Case (summary) | Canvasgrid spec | Status | Notes |
|--------------|----------------|-----------------|--------|-------|
| `v2-bulk-update.spec.ts` | Settings panel opens | `customizer-bulkUpdate.spec.ts` | covered | |
| `v2-bulk-update.spec.ts` | Bulk set after selection | `customizer-bulkUpdate.spec.ts` | covered | via `__edit.bulkUpdate` + `addCellRange` |
| `v2-bulk-update.spec.ts` | Undo restores | `customizer-bulkUpdate.spec.ts` | covered | |
| `v2-bulk-update.spec.ts` | Toolbar value control / Apply | `customizer-bulkUpdate.spec.ts` | covered | Ribbon Bulk Apply |
| `v2-bulk-update.spec.ts` | Multi-column disables apply | `customizer-bulkUpdate.spec.ts` | covered | |
| `v2-bulk-update.spec.ts` | Distinct-value dropdown UI | — | gap | Dropdown feed not e2e’d |
| `v2-plus-minus.spec.ts` | Settings panel opens | `customizer-plusMinus.spec.ts` | covered | |
| `v2-plus-minus.spec.ts` | Plus key nudges + undo | `customizer-plusMinus.spec.ts` | covered | Needs 1×1 range + canvas focus |
| `v2-plus-minus.spec.ts` | Minus key + expression gate | `customizer-plusMinus.spec.ts` | covered | Seeded via `__edit.setNudges` |
| `v2-plus-minus.spec.ts` | midPrice / lab profile steps | — | n/a | Markets lab profiles |
| `v2-smart-edit.spec.ts` | Settings + multiply/add + enforceSingleColumn | `customizer-smartEdit.spec.ts` | covered | |
| `v2-smart-edit.spec.ts` | Preview setting + preview API (no mutate) | `customizer-smartEdit.spec.ts` | covered | Ribbon confirm dialog still gap |
| `v2-smart-edit.spec.ts` | Preview dialog / cancel UI | — | gap | Ribbon does not gate on previewBeforeApply yet |
| `v2-smart-edit.spec.ts` | Subtract / set dialog | — | gap | Engine ops exist; UI path not e2e’d |
| `v2-shortcuts.spec.ts` | Add binding, H key, disabled ignores | `customizer-shortcuts.spec.ts` | covered | |
| `v2-shortcuts.spec.ts` | Lab profile letter bindings (M/L) | — | n/a | Markets lab profiles |
| `v2-alerts.spec.ts` | Channels/frequency band | `customizer-alerts.spec.ts` | covered | |
| `v2-alerts.spec.ts` | Badge + mark read | `customizer-alerts.spec.ts` | covered | |
| `v2-alerts.spec.ts` | Kill-switch | `customizer-alerts.spec.ts` | covered | |
| `v2-alerts.spec.ts` | OpenFin channel disabled without `fin` | — | gap | Small UI assert |
| `v2-alerts.spec.ts` | RelativeChange / tick rules | — | n/a | Needs live ticker; paintHarness has no ticks |
| `v2-edit-history.spec.ts` | Suspended / stream / undo | `customizer.spec.ts` | covered | Smoke in existing suite |
| `v2-filters-toolbar.spec.ts` | Empty +, capture, toggle, clear, rename, delete, no-dupe, persist | `savedFilters.spec.ts` | covered | Persist via `updateLayout` + `velocity-grid:state:ext-demo` |
| `v2-filters-toolbar.spec.ts` | AND compose across columns | `savedFilters.spec.ts` | covered | |
| `v2-filters-toolbar.spec.ts` | OR same-column / collapse summary / scrollbar hide | — | gap | Product may differ (no collapse chip yet) |
| `v2-formatting-toolbar.spec.ts` | Enable on select, Bold, italic, underline, align, clear, overflow | `formattingToolbar.spec.ts` | covered | |
| `v2-formatting-toolbar.spec.ts` | Center/Left/presets persist | `formatPicker.spec.ts` | partial | Presets covered; center/left not dedicated |
| `v2-column-templates.spec.ts` | Templates menu | `formatPicker` / ribbon | gap | Partial via format own-templates |
| `v2-column-customization.spec.ts` | Caption/pin/hide/filter/group | `customizer.spec.ts`, `columnConfig.spec.ts` | covered | Partial depth |
| `v2-column-groups.spec.ts` | Groups CRUD | `customizer.spec.ts` | covered | Partial |
| `v2-conditional-styling.spec.ts` | Rules CRUD | `customizer.spec.ts` | covered | |
| `v2-conditional-styling.spec.ts` | Flash/indicator bands | — | gap | Timing-sensitive paint |
| `v2-calculated-columns.spec.ts` | Add/invalid/delete | `customizer.spec.ts` | covered | |
| `v2-general-settings.spec.ts` | Options apply | `customizer.spec.ts` | covered | Partial field set |
| `v2-settings-panels.spec.ts` | Every panel mounts | `customizer.spec.ts` shell | covered | 11 tabs |
| SSRM twin (worklog) | Edit leaf + undo vs server book | — | n/a | Separate `cgrid-ext-ssrm-demo` track |

## How to run

```bash
cd apps/velocitygrid-ext-demo
npm run test:e2e:customizer   # Phase 1 + existing customizer/spine
npm run test:e2e:parity       # Phase 1–2 + related toolbar specs
```

## Gap priority (remaining)

1. Distinct-value bulk dropdown UI  
2. Smart Edit ribbon preview/confirm dialog  
3. Filter OR same-column merge + collapse chrome  
4. Conditional styling flash/indicator bands  
5. OpenFin channel disabled without `fin`  
