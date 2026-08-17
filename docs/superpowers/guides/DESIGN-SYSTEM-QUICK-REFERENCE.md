# VelocityGridExt Design System Quick Reference

**Fast lookup** for implementing enhanced UI components and micro-interactions.

---

## Component Helpers

### Buttons

```typescript
import { actionButtonEnhanced, resetButtonEnhanced } from '../ui/cockpit';

// Primary button (Save, Done, Create)
const saveBtn = actionButtonEnhanced('Save', 'save');

// Secondary button (Reset, Cancel, Delete)
const resetBtn = resetButtonEnhanced('Reset', 'rotate-ccw');

// Usage in event listeners
saveBtn.addEventListener('click', () => { /* handle save */ });
```

### Toggles

```typescript
import { switchToggleEnhanced } from '../ui/cockpit';

// Enhanced 44×24px toggle switch
const toggle = switchToggleEnhanced(
  true,  // current value
  (newValue) => { /* handle change */ }
);
```

### Form Rows

```typescript
import { row } from '../ui/cockpit';

// Label + control + optional help text
const rowEl = row('Setting name', controlElement, 'Optional help text');
```

### Bands/Accordions

```typescript
import { band } from '../ui/cockpit';

// Collapsible section
const section = band('Section Title');
section.body.append(row1, row2, row3);
rootElement.appendChild(section.root);
```

### Text/Number Inputs

```typescript
import { textInput, numberInput } from '../ui/cockpit';

const text = textInput('default', (val) => { /* handle change */ });
const num = numberInput(42, (val) => { /* handle change */ });
```

---

## Micro-interactions

### Save Animation

```typescript
import { animateSaveButton } from '../ui/cockpit';

// In your module scope
let saveBtn: HTMLButtonElement | null = null;

// In save handler
const save = (): void => {
  // ... persist settings ...
  animateSaveButton(saveBtn, () => {
    // Called after animation completes (optional)
    render();
  });
};

// In render function, capture button
const render = (): void => {
  // ... other render logic ...
  saveBtn = actionButtonEnhanced('Save', 'save');
  saveBtn.addEventListener('click', save);
  // ... append to DOM ...
};
```

### Change Indicators

```typescript
import { applyChangeIndicator } from '../ui/cockpit';

// Highlight modified row
const rowEl = row('Setting', control);
applyChangeIndicator(rowEl, true);   // Show indicator
applyChangeIndicator(rowEl, false);  // Hide indicator
```

### Tabs (Auto)
```typescript
// No code needed! vguiTabsCssEnhanced handles animation automatically
// Just use the class: ckp-tabs-enhanced
// Active tab gets .active class automatically
```

### Accordions (Auto)
```typescript
// No code needed! vguiBandCssEnhanced handles animation automatically
// Toggle .is-collapsed class on band element to animate
band.classList.toggle('is-collapsed');
```

---

## CSS Classes

### Component Classes
| Class | Purpose |
|-------|---------|
| `.ckp-switch-enhanced` | 44×24px toggle |
| `.ckp-btn-primary-enhanced` | Primary button (Save) |
| `.ckp-btn-secondary-enhanced` | Secondary button (Reset) |
| `.ckp-btn-tertiary-enhanced` | Tertiary button (icon-only) |
| `.ckp-row-enhanced` | Card-based form row |
| `.ckp-band-enhanced` | Collapsible band/accordion |
| `.ckp-tabs-enhanced` | Tab navigation |
| `.ckp-input-enhanced` | Text/number input |

### Animation Classes
| Class | Effect |
|-------|--------|
| `.ckp-btn-saving` | Applied during spinner phase |
| `.ckp-btn-saved` | Applied during checkmark phase |
| `.ckp-has-changes` | Applied to rows with modifications |
| `.is-collapsed` | Applied to collapsed bands |

### State Classes
| Class | Meaning |
|-------|---------|
| `.active` | Active tab |
| `.on` | Toggle is on |
| `.is-modified` | Row has pending changes |
| `.is-collapsed` | Band is collapsed |

---

## Pattern: Module Integration

```typescript
import type { SettingsModule } from '../extension/types';
import {
  band, row, injectCockpitStyles,
  switchToggleEnhanced, actionButtonEnhanced, resetButtonEnhanced,
  animateSaveButton, applyChangeIndicator,
} from '../ui/cockpit';

export function myModule(): SettingsModule {
  return {
    id: 'my-module',
    title: 'My Module',
    kind: 'settings-module',
    category: 'editing',

    init(): void { injectCockpitStyles(); },

    mount(host: HTMLElement, ctx): ModuleInstance {
      let saveBtn: HTMLButtonElement | null = null;
      let committed: Settings | null = null;
      let draft: Settings | null = null;

      const save = (): void => {
        // Persist logic
        animateSaveButton(saveBtn, () => render());
      };

      const render = (): void => {
        saveBtn = actionButtonEnhanced('Save', 'save');
        saveBtn.addEventListener('click', save);

        const resetBtn = resetButtonEnhanced('Reset', 'rotate-ccw');
        resetBtn.addEventListener('click', () => {
          // Reset logic
          render();
        });

        const section = band('Settings');
        section.body.append(
          row('Enabled', switchToggleEnhanced(draft.enabled, (v) => {
            draft.enabled = v;
            render();
          })),
          row('Count', numberInput(draft.count, (v) => {
            draft.count = v;
            render();
          })),
        );

        // ... render to host ...
      };

      render();
      return { destroy() { /* cleanup */ }, commit() { /* save */ } };
    },
  };
}
```

---

## Token System

### Enhanced Tokens

```typescript
import { VGUI_ENHANCED_TOKENS } from '@wellsfargo-starui/velocity-grid/ui/primitives-enhanced';

// Accent color
VGUI_ENHANCED_TOKENS.accent      // Blue: #3b82f6
VGUI_ENHANCED_TOKENS.accentLight // 20% opacity
VGUI_ENHANCED_TOKENS.accentDark  // 200% brightness

// Semantic colors
VGUI_ENHANCED_TOKENS.success     // Green: #10b981
VGUI_ENHANCED_TOKENS.warning     // Amber: #f59e0b
VGUI_ENHANCED_TOKENS.danger      // Red: #ef4444
VGUI_ENHANCED_TOKENS.info        // Cyan: #06b6d4

// Backgrounds
VGUI_ENHANCED_TOKENS.bgPrimary   // Dark
VGUI_ENHANCED_TOKENS.bgSecondary // Elevated
VGUI_ENHANCED_TOKENS.bgTertiary  // Hover state

// Text colors
VGUI_ENHANCED_TOKENS.textPrimary   // Main text
VGUI_ENHANCED_TOKENS.textSecondary // Secondary
VGUI_ENHANCED_TOKENS.textTertiary  // Muted
VGUI_ENHANCED_TOKENS.textMuted     // Disabled

// Borders & Shadows
VGUI_ENHANCED_TOKENS.borderStrong
VGUI_ENHANCED_TOKENS.borderSubtle
VGUI_ENHANCED_TOKENS.borderLight
VGUI_ENHANCED_TOKENS.shadow
VGUI_ENHANCED_TOKENS.shadowMd
VGUI_ENHANCED_TOKENS.focusRing
```

### Spacing Scale

```typescript
import { VGUI_SPACING } from '@wellsfargo-starui/velocity-grid/ui/primitives-enhanced';

VGUI_SPACING.xs    // 4px  (icon padding)
VGUI_SPACING.sm    // 8px  (input padding)
VGUI_SPACING.md    // 12px (row padding)
VGUI_SPACING.lg    // 16px (section padding)
VGUI_SPACING.xl    // 20px (major spacing)
VGUI_SPACING['2xl'] // 24px (drawer padding)
```

### Typography Scale

```typescript
import { VGUI_TYPOGRAPHY } from '@wellsfargo-starui/velocity-grid/ui/primitives-enhanced';

// Font sizes
VGUI_TYPOGRAPHY.xs     // 11px (labels)
VGUI_TYPOGRAPHY.sm     // 12px (field labels)
VGUI_TYPOGRAPHY.base   // 13px (body)
VGUI_TYPOGRAPHY.lg     // 14px (buttons)
VGUI_TYPOGRAPHY.xl     // 16px (tabs)
VGUI_TYPOGRAPHY['2xl'] // 20px (titles)

// Font weights
VGUI_TYPOGRAPHY.weight400 // Normal
VGUI_TYPOGRAPHY.weight500 // Medium
VGUI_TYPOGRAPHY.weight600 // Semibold
VGUI_TYPOGRAPHY.weight700 // Bold

// Line heights
VGUI_TYPOGRAPHY.tight   // 1.2 (compact)
VGUI_TYPOGRAPHY.normal  // 1.5 (standard)
VGUI_TYPOGRAPHY.relaxed // 1.6 (comfortable)
```

### Transitions

```typescript
import { VGUI_TRANSITIONS } from '@wellsfargo-starui/velocity-grid/ui/primitives-enhanced';

VGUI_TRANSITIONS.fast   // 100ms (quick feedback)
VGUI_TRANSITIONS.base   // 150ms (standard)
VGUI_TRANSITIONS.slow   // 200ms (deliberate)
VGUI_TRANSITIONS.slower // 300ms (entrance)

// All use: cubic-bezier(0.4, 0, 0.2, 1)
```

---

## Animation Timing

| Animation | Duration | Purpose |
|-----------|----------|---------|
| Save spinner | 300ms | Show work in progress |
| Save checkmark | 400ms | Confirm success |
| Total save feedback | 700ms | User perceives instant |
| Checkmark pulse | 400ms | Celebratory reveal |
| Change flash | 400ms | Draw attention to change |
| Tab underline | 150ms | Subtle feedback |
| Band expand | 200ms | Smooth reveal |
| Band collapse | 200ms | Smooth hide |

---

## Common Patterns

### Dirty State Tracking

```typescript
const isDirty = (): boolean =>
  !!draft && !!committed && JSON.stringify(draft) !== JSON.stringify(committed);

const save = (): void => {
  // ... save logic ...
  committed = clone(draft);
};

const reset = (): void => {
  draft = clone(committed);
};
```

### Disable Save/Reset During Animation

```typescript
saveBtn.addEventListener('click', () => {
  saveBtn.disabled = true;  // Done automatically by animateSaveButton
  resetBtn.disabled = true;
  // ... animation plays ...
  // Buttons re-enabled automatically
});
```

### Change Indicator Workflow

```typescript
// On every render
const isDirty = fieldA !== committed.fieldA || fieldB !== committed.fieldB;

if (isDirty) {
  applyChangeIndicator(row, true);
} else {
  applyChangeIndicator(row, false);
}
```

---

## Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

All animations use standard CSS (`transform`, `opacity`, `keyframes`). No polyfills needed.

---

## Performance Checklist

- ✅ Only `transform` and `opacity` animate (GPU-accelerated)
- ✅ No width/height changes during animation
- ✅ No box-shadow during animation (static only)
- ✅ Max animation duration: 700ms (no infinite loops)
- ✅ All animations complete within perceived UI responsiveness
- ✅ Respects `prefers-reduced-motion` automatically via CSS

---

## Debugging Tips

### Animation Not Playing
1. Check button has `saveBtn.addEventListener('click', save)`
2. Verify `animateSaveButton(saveBtn, ...)` is called inside save handler
3. Ensure `saveBtn` is not null (module scope variable)
4. Check browser DevTools: button should get `.ckp-btn-saving` class

### Tab Underline Not Animating
1. Verify parent div has `.ckp-tabs-enhanced` class
2. Verify active tab has `.active` class
3. Check CSS loaded (`injectCockpitStyles()` called)

### Change Indicator Not Showing
1. Verify element passed to `applyChangeIndicator(element, true)`
2. Check element is `.ckp-row` or `.ckp-band-enhanced`
3. Verify not called with `false` immediately after

### Performance Issues
1. Run DevTools Performance tab during animation
2. Should show 60fps (16.67ms per frame)
3. If dropping frames, check for:
   - Layout recalculations (avoid width/height changes)
   - Paint operations (avoid color-only changes during animation)
   - JavaScript blocking (no long tasks during animation)

---

## Related Documentation

- **Full Phase 1 Guide**: `2026-08-17-design-system-phase-1-implementation.md`
- **Full Phase 3 Guide**: `2026-08-17-design-system-phase-3-microinteractions.md`
- **Phases 1-3 Summary**: `2026-08-17-design-system-phases-1-3-complete.md`
- **Original Analysis**: `velocitygrid-ux-design-analysis.md` (40+ page research)

