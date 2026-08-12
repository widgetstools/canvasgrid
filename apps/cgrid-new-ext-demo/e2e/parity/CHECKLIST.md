# New Ext demo — Markets / legacy parity checklist

Port of [`apps/cgrid-ext-demo/e2e/parity/CHECKLIST.md`](../../../cgrid-ext-demo/e2e/parity/CHECKLIST.md)
onto `cgrid-new-ext-demo` (`vg-new-*`).

**Statuses:** `covered` · `smoke` · `gap` · `n/a`  
**Boot:** `npm run dev:new-ext-demo` → http://localhost:5211

| Area | Case | Status | Notes |
|------|------|--------|-------|
| Shell | Title bar / ribbons / Customize drawer | covered | unit: `packages/new/ext/tests/shell.test.ts` |
| Grammar | Draft → Validate → Apply | covered | unit: `configSession.test.ts` + modules |
| Grid options | Quick filter + row groups Apply | smoke | Customize → Grid options |
| Column settings | Caption/width Apply | smoke | |
| Data provider | Catalog list + mock bind + Stop/Restart | smoke | Seeds via `SEED_PROVIDERS` |
| Calculated columns | Expression → `setCalcColumns` | smoke | |
| Conditional styling | Rule → `setStyleRules` | smoke | |
| Alerts | Rule → `setAlertRules` + badge | smoke | |
| Smart edit | Multiply/add/set/nudge on selection | smoke | |
| Bulk update | Set value on selection | smoke | |
| Plus / minus | Nudge ±1 | smoke | |
| Edit history | Undo / redo | smoke | |
| Formatting ribbon | Bold/italic/align/format/undo | smoke | |
| Editing ribbon | ×2 / +1 / nudge | smoke | |
| Saved filters | Builtin EQ/FX + Save pill + persist | smoke | `ConfigSession.savedFilters` |
| Column groups | Nested header editor | gap | E-MOD-02 |
| Shortcuts | Letter → numeric op panel | gap | E-MOD-10 |
| Layouts switcher | Multi-layout UI | gap | E-CFG-02 |
| Playwright suite | Port of `customizer-*.spec.ts` | gap | Phase 9 follow-up |

## How to run

```bash
npm run test:new                 # unit suites for vg-new-*
npm run dev:new-ext-demo         # manual smoke on :5211
```

## Gap priority

1. Playwright port of legacy Ext customizer specs  
2. Column groups editor  
3. Layouts switcher  
4. Shortcut letter bindings panel  
