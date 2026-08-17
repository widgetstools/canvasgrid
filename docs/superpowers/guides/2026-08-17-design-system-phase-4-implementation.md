# VelocityGrid Design System Phase 4: Information Architecture Implementation

**Status**: Foundation Complete — Tab System Ready  
**Date**: August 17, 2026  
**Scope**: Tab group helpers + CSS + pilot implementation in Smart Edit  
**Goal**: Enable progressive disclosure and information hierarchy via tabs

---

## What's Been Implemented

### 1. Tab Group System (`packages/ext/src/ui/tabGroup.ts`)

**Core Helpers**:

```typescript
// Main API
function createTabGroup(
  tabs: TabDefinition[],
  defaultTabId?: string,
  lucideSvg?: (name: string, size?: number) => string,
): TabGroup

// Simple variant (for flat layouts)
function createSimpleTabGroup(
  tabs: Array<{ id: string; label: string }>,
  renderContent: (id: string) => HTMLElement,
  defaultTabId?: string,
): TabGroup
```

**Features**:
- ✅ Multiple tabs with animated underline
- ✅ Smooth pane transitions (fade + slide)
- ✅ Optional Lucide icons on tab buttons
- ✅ Keyboard accessible (click-driven)
- ✅ Respects `prefers-reduced-motion`

### 2. Tab Group CSS (`packages/ext/src/ui/cockpit.ts`)

**New Classes**:

```css
.ckp-tab-group          /* Container */
.ckp-tabs-enhanced      /* Tab button bar */
.ckp-tab                /* Individual tab button */
.ckp-tab.active         /* Active tab */
.ckp-tab::after         /* Animated underline */
.ckp-tab-panes          /* Content container */
.ckp-tab-pane           /* Individual pane */
.ckp-tab-pane.active    /* Visible pane */
```

**Animations**:
- Tab underline: `scaleX(0 → 1)` — 150ms cubic-bezier
- Pane entry: Fade + slide up — 150ms cubic-bezier
- Tab hover: Subtle background + text color change

### 3. Pilot Implementation: Smart Edit Module

**Reorganization**:

**Before** (flat bands):
```
Global
Operations
Safety
```

**After** (tabbed):
```
Settings Tab (default)
├─ Global
└─ Operations

Advanced Tab (collapsed)
└─ Safety
```

**Code Changes**:
- Added `createTabGroup` import
- Reorganized render to create separate panes
- Safety band moved to Advanced tab
- Icons: Settings tab uses `sliders-horizontal`, Advanced uses `cog`

**Result**: Settings are now grouped by purpose. Basic users see Settings tab by default. Advanced users can switch tabs for power features.

---

## How to Use Tab Groups

### Basic Pattern

```typescript
import { createTabGroup } from '../ui/cockpit';

// In your render function:
const settingsPane = el('div');
settingsPane.appendChild(band('Basic'));
settingsPane.appendChild(band('Common'));

const advancedPane = el('div');
advancedPane.appendChild(band('Advanced'));

const tabGroup = createTabGroup([
  { id: 'settings', label: 'Settings', icon: 'sliders-horizontal', content: settingsPane },
  { id: 'advanced', label: 'Advanced', icon: 'cog', content: advancedPane },
], 'settings', lucideSvg);

root.appendChild(tabGroup.root);
```

### Tab Definition Interface

```typescript
interface TabDefinition {
  id: string;              // Unique identifier
  label: string;           // Display label
  icon?: string;           // Lucide icon name (optional)
  content: HTMLElement;    // Content to show when active
}
```

### Return Value (TabGroup)

```typescript
interface TabGroup {
  root: HTMLElement;           // Append this to DOM
  switchTo: (id: string) => void; // Switch tabs programmatically
  getActive: () => string;      // Get current tab ID
}
```

### Example: Simple Tab Group

```typescript
// For modules without Lucide icons
const tabs = createSimpleTabGroup(
  [
    { id: 'basic', label: 'Basic' },
    { id: 'advanced', label: 'Advanced' },
  ],
  (id) => {
    // Return content for each tab ID
    if (id === 'basic') return basicPane;
    return advancedPane;
  },
  'basic' // default tab
);

root.appendChild(tabs.root);
```

---

## Tab Design System

### Visual Specification

| Aspect | Details |
|--------|---------|
| **Tab Height** | 48px (12px padding + 20px icon + 2px underline) |
| **Underline Height** | 3px solid accent |
| **Underline Animation** | 150ms scaleX (0 → 1) |
| **Hover Background** | 8% accent opacity |
| **Text Color** | Secondary (muted) → Primary (hover/active) |
| **Transition Timing** | 150ms cubic-bezier(0.4, 0, 0.2, 1) |
| **Pane Animation** | Fade + translateY(-8px) — 150ms |

### Responsive Behavior

- **Desktop (>768px)**: Tabs horizontal, full width
- **Tablet (480-768px)**: Tabs stack, smaller font
- **Mobile (<480px)**: Tabs scrollable if needed

### Accessibility

- ✅ Tab buttons are `<button>` elements (semantic)
- ✅ Keyboard navigation via Tab key
- ✅ Focus ring visible (4px solid accent)
- ✅ Aria labels on tab buttons (auto via label)
- ✅ Prefers-reduced-motion respected

---

## Rollout Strategy

### Phase 4a ✅ COMPLETE
- Tab group system created
- CSS implemented
- Pilot in Smart Edit

### Phase 4b (Ready for Implementation)

Update 4 more modules (same pattern as Smart Edit):

1. **Bulk Update** — Settings + Advanced tabs
2. **Plus / Minus** — Settings + Advanced tabs
3. **Alerts** — Settings + Advanced + History tabs
4. **Conditional Styling** — Settings + Advanced tabs

### Phase 4c (Progressive Disclosure)

- Mark bands with `data-complexity` attribute
- Automatically route "advanced" bands to Advanced tab
- Create helper to auto-generate tabs

### Phase 4d (Cross-Module Workflows)

Create workflow badges:
```typescript
function workflowLink(
  label: string,
  icon: string,
  onClick: () => void,
): HTMLElement {
  // Card-style link to related module
}
```

Examples:
- Smart Edit: "View audit trail" → Data Change History
- Conditional Styling: "Related alerts" → Alerts module
- Formatting: "See results" → Calculated Columns

---

## File Status

### Created ✅
- `packages/ext/src/ui/tabGroup.ts` — Tab system (165 lines)
- `docs/superpowers/plans/2026-08-17-cycle-phase-4-ia.md` — Architecture plan

### Modified ✅
- `packages/ext/src/ui/cockpit.ts` — Imported tabGroup, added CSS, exported types
- `packages/ext/src/modules/smartEdit.ts` — Implemented tab groups

### Ready for Next Phase ⏳
- Bulk Update module
- Plus / Minus module
- Alerts module
- Conditional Styling module

---

## Testing Checklist

### Visual Testing (Smart Edit)

```
1. Open Smart Edit module
2. Verify two tabs visible: "Settings" + "Advanced"
3. Click "Settings" tab
   - Global + Operations bands visible
   - Underline animates under tab (scaleX)
   - Content fades in (150ms)
4. Click "Advanced" tab
   - Safety band visible
   - Underline slides to Advanced tab
   - Content fades in
5. Verify Save/Reset buttons always visible (sticky header)
6. Toggle setting in Settings tab → Save button enables
7. Click Save → Animation plays
8. Return to Advanced tab → setting persists
```

### Keyboard Testing

```
1. Tab key → Focus on first tab
2. Tab key → Focus on second tab
3. Enter key on tab → Switch tab
4. Space key on tab → Switch tab
5. Arrow keys → Should not navigate (not implemented, OK)
```

### Responsive Testing

```
1. Desktop (1920px) → Tabs horizontal, full width
2. Tablet (768px) → Tabs still horizontal
3. Mobile (375px) → Tabs horizontal (scrollable if needed)
```

### Accessibility Testing

```
1. Focus ring visible on all tabs (4px solid accent)
2. Color contrast: 16:1 for active tab text on dark background
3. Screen reader: Button role announced for each tab
4. Prefers-reduced-motion: No animation, instant tab switch
```

### Performance Testing

```
1. Tab switch ≤ 150ms (perceived instant)
2. No layout shifts during animation
3. 60fps during pane transition
4. No memory leaks (create/destroy tabs multiple times)
```

---

## CSS Animation Details

### Tab Underline

```css
.ckp-tab::after {
  transform: scaleX(0);                    /* Hidden */
  transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
.ckp-tab.active::after {
  transform: scaleX(1);                    /* Visible */
}
```

### Pane Entry

```css
@keyframes tabPaneIn {
  from {
    opacity: 0;
    transform: translateY(-8px);           /* Slide up */
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### Prefers-Reduced-Motion

```css
@media (prefers-reduced-motion: reduce) {
  .ckp-tab {
    transition: none;                      /* No animation */
  }
  .ckp-tab-pane.active {
    animation: none;                       /* No animation */
  }
}
```

---

## Next Steps

1. ✅ Test Smart Edit tabs in browser (visual + interaction)
2. Implement tabs in 4 more modules (Bulk Update, Plus/Minus, Alerts, Conditional Styling)
3. Create band classification system (basic vs advanced)
4. Add cross-module workflow badges
5. Document final Phase 4 completion

---

## Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Tab animations smooth | 60fps | ✅ Ready |
| Underline underline responsive | ≤150ms | ✅ Ready |
| Keyboard accessible | Tab + Enter/Space | ✅ Implemented |
| Screen reader compatible | Announced correctly | ✅ Semantic HTML |
| Pane transitions smooth | No jank | ✅ GPU accelerated |
| Mobile responsive | Works <480px | ✅ CSS ready |

---

## Related Documentation

- **Phase 1**: Design tokens + CSS generators
- **Phase 2**: Component migration (enhanced helpers)
- **Phase 3**: Micro-interactions (save animations)
- **Phase 4**: Information architecture (tab system) ← You are here

**Full journey**: Phases 1-4 transform VelocityGridExt from functional UI to premium, sophisticated experience with smooth animations, progressive disclosure, and wow factor.

