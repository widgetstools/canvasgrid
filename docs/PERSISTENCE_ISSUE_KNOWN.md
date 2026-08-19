# Known Persistence Issue - Grid State Capture

**Status**: Identified and documented (not yet fixed)  
**Date**: 2026-08-16  
**Scope**: `apps/velocitygrid-ext-demo/e2e/customizer.spec.ts` - "Persistence › styling rule + calculated column survive reload"  
**Impact**: 1 failing e2e test (48/49 passing - 98%)

## Problem Summary

The e2e persistence test creates a styling rule and calculated column, saves them via the customizer, and expects them to be persisted to localStorage and survive a page reload. However, the rules and columns do not appear in the persisted data.

## Root Cause

The grid state persistence layer (`packages/ext/src/profiles/configSession.ts`) relies on `grid.getState()` to capture the full grid state for persistence. However, rules and calculated columns added via:
- `conditionalStyling.ts`: `grid.addRule()`
- `calculatedColumns.ts`: grid expression API

...are not being included in the GridState returned by `grid.getState()` during the persistence snapshot.

**Architectural gap**: The conditional-styling and calculatedColumns modules add state to the grid but may not be properly integrated with the grid's state capture and module registration system.

## Investigation Details

### Persistence Flow

1. Test creates rule via `conditionalStyling` module → calls `grid.addRule()` + `ctx.profiles.markDirty()`
2. Test calls `saveCard()` → Save button listener → `save()` function
3. Test closes customizer via `closeViaDone()`
4. Test calls `profiles.save()` → `ProfilesController.save()`
5. Since using ConfigSession: → `saveWorkspace()` → `saveWorkspaceSync()`
6. `saveWorkspaceSync()` calls `grid.getState()` to capture current state
7. **BUG**: Rules and columns missing from `gridState` snapshot
8. `writeRaw()` persists the incomplete state
9. Test checks localStorage for 'PersistRule' + 'vcol_' → **FAILS**

### Key Code Locations

- **Persistence controller**: `packages/ext/src/profiles/controller.ts:71` - `this.grid.getState()`
- **ConfigSession save**: `packages/ext/src/profiles/configSession.ts:600-633` - `saveWorkspaceSync()`
- **Module implementation**:
  - `packages/ext/src/modules/conditionalStyling.ts:184-192` - `save()` function
  - `packages/ext/src/modules/calculatedColumns.ts` - expression API integration
- **Test**: `apps/velocitygrid-ext-demo/e2e/customizer.spec.ts:464-520`

## Why Not Fixed

This is an architectural issue that would require:

1. **Understanding grid state module registration**: How modules register their state with the grid
2. **Tracing state lifecycle**: Verifying rules/columns are captured in grid state before serialization
3. **Risk assessment**: Changes to the grid state capture system could break:
   - Existing state persistence for other features
   - Layout restore logic
   - Grid initialization from stored configs

Given that this is isolated to a single test and the rest of the test suite passes (98%), fixing it would require careful refactoring of the grid state module system.

## Related Work

This issue was discovered during the **VelocityGrid production hardening branch** work:
- Fixed 9 timeout-related e2e tests by restoring `.ckp-switch` toggle elements
- Updated modules to use `switchToggle()` instead of `checkbox()`
- Added CSS for `.ckp-switch` visual elements
- **Final result**: 48/49 tests passing (98%)

The persistence issue is unrelated to the switch/toggle changes and appears to be a pre-existing architectural limitation.

## Recommendation

- **Short term**: Document as a known limitation in test skip comment (done)
- **Medium term**: Mark for architectural review of grid state module system
- **Long term**: Implement proper state registration protocol for modules that modify grid state

## Test Status

```
✘  42 [chromium] › e2e/customizer.spec.ts:464:3 › Persistence › styling rule + calculated column survive reload

Error: expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
Timeout 5000ms exceeded while waiting on localStorage to contain 'PersistRule' && 'vcol_'
```

**Blocked on**: Grid state capture system investigation
**Owner**: To be assigned
**Priority**: Low (1 test, no feature impact, architectural issue)
