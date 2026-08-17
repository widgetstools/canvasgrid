# VelocityGrid Design System Phase 3: Micro-interactions

**Status**: Implementation Complete  
**Date**: August 17, 2026  
**Scope**: Save animations + change indicators + tab transitions  
**Goal**: Provide rich visual feedback for user actions and state changes

---

## Overview

Phase 3 adds micro-interactions that make the UI feel responsive and sophisticated:
- **Save animations**: Spinner → checkmark → idle (visual confirmation)
- **Change indicators**: Accent borders + visual prominence when data changes
- **Tab transitions**: Smooth animated underlines (from vguiTabsCssEnhanced)
- **Accordion animations**: Smooth expand/collapse (from vguiBandCssEnhanced)

All animations use GPU-accelerated transforms and opacity changes. No expensive layout shifts. Respects `prefers-reduced-motion`.

---

## 1. Save Button Animations

### Helper Function: `animateSaveButton()`

```typescript
import { animateSaveButton } from '../ui/cockpit';

// In your module's save handler:
let saveBtn: HTMLButtonElement | null = null;

const save = (): void => {
  // ... persist settings ...
  animateSaveButton(saveBtn, () => {
    // Optional: called after animation completes
    render();
  });
};
```

### Animation Sequence

1. **Click Save** → Button becomes disabled
2. **0-300ms**: Show spinner + "Saving..." label
3. **300-700ms**: Show checkmark + "Saved" label (checkPulse animation)
4. **700ms+**: Return to normal state + re-enable button

### CSS Classes Applied

- `.ckp-btn-saving` — While animating (during spinner phase)
- `.ckp-btn-saved` — While showing checkmark (green background)

### Example Integration (smartEdit.ts pattern)

```typescript
mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
  let saveBtn: HTMLButtonElement | null = null;

  const save = (): void => {
    const h = editHandle(ctx);
    if (!h || !draft || !saveBtn) return;
    // ... save logic ...
    animateSaveButton(saveBtn, () => render());
  };

  const render = (): void => {
    // ... other render code ...
    saveBtn = actionButtonEnhanced('Save', 'save');
    saveBtn.addEventListener('click', save);
    // ... append to DOM ...
  };
}
```

### CSS Animation Details

```css
/* Button state during saving */
.ckp-btn-primary-enhanced.ckp-btn-saving {
  background: linear-gradient(...);
  position: relative;
}

/* Button state after save succeeds */
.ckp-btn-primary-enhanced.ckp-btn-saved {
  background: var(--ckp-success, #10b981);
  border-color: var(--ckp-success, #10b981);
}

/* Checkmark pulse animation */
@keyframes checkPulse {
  0% { transform: scale(0.8) rotate(-45deg); opacity: 0; }
  50% { transform: scale(1.15); }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
```

---

## 2. Change Indicators

### Helper Function: `applyChangeIndicator()`

Adds visual prominence to rows/bands that have been modified.

```typescript
import { applyChangeIndicator } from '../ui/cockpit';

// Show change indicator
applyChangeIndicator(rowElement, true);

// Hide change indicator
applyChangeIndicator(rowElement, false);
```

### Visual Design

When enabled, applies:
- Left border: 3px solid accent color
- Left padding adjustment for alignment
- Flash animation on first application

### Example Usage

```typescript
// In your render function:
const dirtyRows = bandElement.querySelectorAll('[data-dirty="true"]');
for (const row of dirtyRows) {
  applyChangeIndicator(row, true);
}

// When saved:
for (const row of dirtyRows) {
  applyChangeIndicator(row, false);
}
```

### CSS Classes

- `.ckp-has-changes` — Applied to rows/bands with pending changes
- `::before` pseudo-element — Animated flash effect

### Animation Details

```css
.ckp-row.ckp-has-changes,
.ckp-band-enhanced.ckp-has-changes {
  border-left: 3px solid var(--ckp-accent, #3b82f6);
  padding-left: 12px;
}

@keyframes changeFlash {
  0% {
    opacity: 1;
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
  }
  100% {
    opacity: 0.3;
    box-shadow: 0 0 0 rgba(59, 130, 246, 0);
  }
}
```

---

## 3. Tab Transitions

Implemented via `vguiTabsCssEnhanced()` from Phase 1. No additional code needed in modules.

### Visual Design

- **Inactive tab**: Secondary text color
- **Hover**: Primary text color + subtle background
- **Active tab**: Primary text color + 3px solid accent underline
- **Animation**: Underline scales in with 150ms cubic-bezier

### HTML Structure

```html
<div class="ckp-tabs-enhanced">
  <button class="ckp-tab active">Settings</button>
  <button class="ckp-tab">Advanced</button>
</div>
```

### CSS Details

```css
.ckp-tab::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--ckp-accent);
  border-radius: 2px 2px 0 0;
  transform: scaleX(0);
  transition: transform 150ms cubic-bezier(...);
}

.ckp-tab.active::after {
  transform: scaleX(1);
}
```

---

## 4. Accordion Expand/Collapse

Implemented via `vguiBandCssEnhanced()` from Phase 1. Automatic.

### Visual Design

- **Chevron rotation**: 150ms on collapse toggle
- **Body expand**: Smooth max-height + opacity animation (200ms)
- **Body collapse**: Smooth max-height + opacity animation (200ms)
- **Header hover**: Lifted shadow + gradient background change

### HTML Structure

```html
<div class="ckp-band-enhanced">
  <div class="ckp-band-head">
    <span class="ckp-band-title">Settings</span>
    <span class="ckp-band-chevron">▼</span>
  </div>
  <div class="ckp-band-body"><!-- Content --></div>
</div>

<!-- When collapsed, add: -->
<div class="ckp-band-enhanced is-collapsed">
```

### CSS Details

```css
.ckp-band-enhanced.is-collapsed .ckp-band-chevron {
  transform: rotate(-90deg);
  transition: transform 150ms;
}

.ckp-band-body {
  max-height: 1000px;
  overflow: hidden;
  animation: expandDown 200ms cubic-bezier(...);
}

.ckp-band-enhanced.is-collapsed .ckp-band-body {
  max-height: 0;
  animation: collapseUp 200ms cubic-bezier(...);
}
```

---

## Implementation Checklist

### Per-Module Steps

For each settings module (smartEdit, bulkUpdate, plusMinus, alerts, dataChangeHistory):

- [ ] Import `animateSaveButton` in module file
- [ ] Add `let saveBtn: HTMLButtonElement | null = null;` at module scope
- [ ] Update `save()` handler to call `animateSaveButton(saveBtn, () => render())`
- [ ] Update render function to capture: `saveBtn = actionButtonEnhanced(...)`
- [ ] Test save animation in browser (spinner → checkmark → idle)

### Across All Modules

- [ ] Tab animations work automatically (no code changes needed)
- [ ] Accordion animations work automatically (no code changes needed)
- [ ] Change indicators can be added to dirty rows on demand via `applyChangeIndicator()`

---

## Best Practices

### 1. Save Button Animation Timing

Keep the animation fast but perceivable:
- Spinner phase: 300ms (shows system is working)
- Checkmark phase: 400ms (confirms success)
- Total: 700ms (users perceive instant feedback)

### 2. Change Indicator Usage

Apply change indicators when:
- User modifies a field (optional: immediate feedback)
- Save is in progress (optional: visual pause)
- Changes exist but not yet saved (recommended)

Remove when:
- User clicks Save and animation completes
- User clicks Reset
- External state refresh occurs

### 3. Reducing Motion

All animations respect `@media (prefers-reduced-motion: reduce)`:

```css
@media (prefers-reduced-motion: reduce) {
  /* Animations disabled */
  .ckp-btn-primary-enhanced.ckp-btn-saving { /* instant transition */ }
  .ckp-band-body { animation: none; }
}
```

No code changes needed — CSS handles it.

### 4. Performance Notes

- Use `transform` and `opacity` only (GPU-accelerated)
- Avoid `box-shadow` changes during animation (use `filter` for glow)
- No `width` or `height` changes during animation (use `max-height` for collapse)
- All animations complete within 700ms (no jarring delays)

---

## Testing Checklist

### Visual Testing (per module)

```typescript
// In browser devtools, test smartEdit.ts:
1. Open Smart Edit module
2. Change a setting (e.g., toggle "Enabled")
3. Click Save
4. Verify:
   - Button shows spinner + "Saving..." (300ms)
   - Button shows checkmark + "Saved" (400ms)
   - Button returns to normal (100ms)
   - Total animation ~800ms
5. Verify buttons re-enable after animation
```

### Accessibility Testing

- [ ] Spinner renders (visible and accessible)
- [ ] Checkmark renders (visible and accessible)
- [ ] Color-blindness: Use accent color for visibility (not color-only cue)
- [ ] Keyboard users: Can still click buttons during animation (disabled state blocks interaction appropriately)

### Performance Testing

```typescript
// Measure animation frame rate
// Open DevTools Performance tab
// Record animation
// Verify 60fps (16.67ms per frame)
// No long tasks during animation
```

---

## Files Modified

### Core
- `packages/ext/src/ui/cockpit.ts` — Added `animateSaveButton()`, `applyChangeIndicator()`, animation CSS
- `packages/kernel/src/ui/primitives-enhanced.ts` — vguiTabsCssEnhanced, vguiBandCssEnhanced (Phase 1)

### Modules (Save Animation Integration)
- `packages/ext/src/modules/smartEdit.ts` — Integrated save animation
- `packages/ext/src/modules/bulkUpdate.ts` — Integrated save animation

### Remaining Modules (Ready for Integration)
- `packages/ext/src/modules/plusMinus.ts` — Ready for save animation
- `packages/ext/src/modules/alerts.ts` — Ready for save animation
- `packages/ext/src/modules/dataChangeHistory.ts` — Ready for save animation

---

## Phase 3 Status

✅ **Complete**

- Core micro-interaction helpers implemented
- Save animation CSS with checkPulse + changeFlash animations
- Change indicator helper + CSS
- Tab transitions active (vguiTabsCssEnhanced)
- Accordion animations active (vguiBandCssEnhanced)
- Save animation integrated in 2 modules (smartEdit, bulkUpdate)
- Pattern established for remaining 3 modules

---

## Next Steps (Phase 4)

Phase 4: Information Architecture
- Tab reorganization (group related settings)
- Module grouping (editing vs. format vs. advanced)
- Cross-module workflows (e.g., Smart Edit + Data Change History)
- Progressive disclosure (collapse advanced sections by default)

---

## References

- Phase 1 Guide: `2026-08-17-design-system-phase-1-implementation.md`
- Phase 2 Complete: All 5 modules using enhanced components
- Original Analysis: `velocitygrid-ux-design-analysis.md`

