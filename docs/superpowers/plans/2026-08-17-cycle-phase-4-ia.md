# Phase 4: Information Architecture Reorganization

**Status**: Complete (4a–4d shipped)  
**Date**: August 17, 2026  
**Scope**: Tab grouping + progressive disclosure + cross-module workflows  
**Goal**: Make customizer more intuitive by grouping related settings

---

## Overview

Phase 4 improves information architecture at three levels:

1. **Within Modules**: Tab-based grouping (Editing / Format / Advanced)
2. **Across Drawer**: Category-based module organization
3. **Cross-Module**: Workflows linking related modules (Smart Edit ↔ Data Change History)

---

## Current State Analysis

### Module Categories

```
Editing (5)
├── Smart Edit (smartEdit.ts)
├── Bulk Update (bulkUpdate.ts)
├── Plus / Minus (plusMinus.ts)
├── Shortcuts (shortcuts.ts)
└── Cell Editor (cellEditor.ts)

Format (2)
├── Conditional Styling (conditionalStyling.ts)
└── Calculated Columns (calculatedColumns.ts)

Layout (3)
├── Column Settings (columnSettings.ts)
├── Grouping (grouping.ts)
└── Sorting (sorting.ts)

Data (4)
├── Alerts (alerts.ts)
├── Data Change History (dataChangeHistory.ts)
├── Formatting (formatting.ts)
└── Cell Validation (cellValidation.ts)

Supporting
├── Rendering Options (renderingOptions.ts)
└── Configuration (configuration.ts)
```

### Current Band Organization (Within Modules)

Example: **Smart Edit** (editing module)
```
Global
  ├── Enabled
  ├── Increment step
  └── K/M/B shortcuts

Operations
  └── Toolbar ops (pill buttons)

Safety
  ├── Confirm above N
  ├── Single column
  ├── Preview before
  └── Record history
```

**Problem**: Bands are flat. No clear grouping by purpose or complexity level.

---

## Phase 4 Solution: Tabs-Based IA

### 1. Within-Module: Tab System

**For modules with 4+ bands**, add tabs:

```
┌─────────────────────────────────────────┐
│ Settings    Advanced    History         │  ← Tab bar
├─────────────────────────────────────────┤
│                                         │
│ Global                                  │
│  ├─ Enabled                            │
│  └─ Increment step                     │
│                                         │
│ Operations                              │
│  └─ Toolbar ops                        │
│                                         │
│ Safety                                  │
│  ├─ Confirm above N                    │
│  ├─ Single column                      │
│  ├─ Preview before                     │
│  └─ Record history      ← Can move to  │
│                           Advanced     │
└─────────────────────────────────────────┘

(Advanced tab)
┌─────────────────────────────────────────┐
│ Settings    Advanced    History         │
├─────────────────────────────────────────┤
│                                         │
│ Advanced Options                        │
│  ├─ Record history                     │
│  ├─ Performance tuning                 │
│  └─ Developer options                  │
│                                         │
└─────────────────────────────────────────┘
```

### Tab Categories

**Settings Tab** (default, visible)
- Core functionality
- User-facing options
- Most commonly changed

**Advanced Tab** (collapsed)
- Performance tuning
- Debug/developer options
- Rarely needed settings

**History Tab** (if applicable)
- Undo/redo settings
- Journal configuration
- Change tracking

### 2. Across Drawer: Module Grouping

Keep existing category structure but improve UI:

```
┌─ EDITING (expanded by default)
│  ├─ Smart Edit
│  ├─ Bulk Update
│  ├─ Plus / Minus
│  └─ Shortcuts
│
├─ FORMATTING
│  ├─ Conditional Styling
│  └─ Calculated Columns
│
├─ LAYOUT
│  ├─ Column Settings
│  ├─ Grouping
│  └─ Sorting
│
├─ DATA & MONITORING
│  ├─ Alerts
│  ├─ Data Change History
│  ├─ Cell Validation
│  └─ Formatting
│
└─ CONFIGURATION
   ├─ Rendering Options
   └─ Advanced Settings
```

### 3. Cross-Module Workflows

Link related modules with badges/indicators:

**Smart Edit**
- "Edit → see results in Data Change History"
- Badge: "View audit trail"

**Data Change History**
- "Paired with Smart Edit"
- Badge: "Go to Smart Edit"

---

## Implementation Plan

### Phase 4a: Tab System (Foundation)

**Files to Create**:
1. `packages/ext/src/ui/tabGroup.ts` — Tab group builder helper
   - `createTabs(tabs)` — Create tab group
   - `selectTab(tabEl, id)` — Switch active tab
   - CSS class names + animations

**Files to Modify**:
1. `packages/ext/src/ui/cockpit.ts` — Export tab helpers
2. Smart Edit module — Add tabs (pilot)
3. Bulk Update module — Add tabs (pilot)

**Changes**:
- Add `ckp-tabs-enhanced` wrapper with buttons
- Create `ckp-tab-pane` divs for each tab content
- Wire up tab switching with `onclick` events
- Use vguiTabsCssEnhanced for styling

### Phase 4b: Band Classification

**Update Modules** (add metadata to bands):
- Tag bands with `data-complexity="basic"` or `"advanced"`
- Use tags to decide which tab they go into
- Default: "Settings" tab shows basic, "Advanced" shows advanced

### Phase 4c: Progressive Disclosure

**Implementation**:
- Settings tab always visible
- Advanced tab collapsed by default
- Only show History tab if module has journal features
- CSS: `.ckp-tab-pane { display: none; } .ckp-tab-pane.active { display: block; }`

### Phase 4d: Cross-Module Links

**Create badges**:
```typescript
function workflowBadge(label: string, icon: string, onClick: () => void): HTMLElement {
  // Card-like element with icon + label
  // Appears at top of module
}
```

**Modules to Link**:
- Smart Edit ↔ Data Change History
- Conditional Styling ↔ Alerts
- Calculated Columns ↔ Formatting

---

## Tab Design Specification

### CSS Classes

```css
.ckp-tabs-group          /* Container */
  .ckp-tab              /* Individual tab */
  .ckp-tab.active       /* Active tab */
  .ckp-tab::after       /* Animated underline (from Phase 1) */

.ckp-tab-panes          /* Tab content container */
  .ckp-tab-pane         /* Individual pane */
  .ckp-tab-pane.active  /* Visible pane */
```

### JavaScript Pattern

```typescript
interface TabDefinition {
  id: string;
  label: string;
  icon?: string;
  content: HTMLElement;
}

function createTabGroup(tabs: TabDefinition[], defaultTabId?: string): {
  root: HTMLElement;
  switchTo: (id: string) => void;
} {
  // Create tab buttons + panes
  // Return container + switch function
}
```

### HTML Structure

```html
<div class="ckp-tabs-group">
  <div class="ckp-tabs-enhanced">
    <button class="ckp-tab active" data-tab="settings">Settings</button>
    <button class="ckp-tab" data-tab="advanced">Advanced</button>
    <button class="ckp-tab" data-tab="history">History</button>
  </div>
  <div class="ckp-tab-panes">
    <div class="ckp-tab-pane active" id="settings-pane">
      <!-- Settings content (bands + rows) -->
    </div>
    <div class="ckp-tab-pane" id="advanced-pane">
      <!-- Advanced content -->
    </div>
    <div class="ckp-tab-pane" id="history-pane">
      <!-- History content -->
    </div>
  </div>
</div>
```

---

## Rollout Strategy

### Phased Implementation

**Week 1: Foundation**
- Create tab group helpers in cockpit.ts
- Implement in Smart Edit (pilot)
- Test tab switching + animation

**Week 2: Expansion**
- Add tabs to Bulk Update, Plus/Minus, Alerts
- Classify bands as "basic" vs "advanced"
- Test progressive disclosure

**Week 3: Polish**
- Cross-module badges/links
- Documentation
- Visual QA + accessibility audit

---

## Modules Needing Tab Reorganization

### High Impact (4+ bands)

1. **Smart Edit** ✅ Ready
   - Settings: Enabled, Increment step, K/M/B shortcuts
   - Operations: Toolbar ops
   - Advanced: Confirm threshold, Single column, Preview, Record history

2. **Bulk Update** ✅ Ready
   - Settings: Enabled, Confirm threshold, Single column
   - Advanced: Record history, Distinct values, Max dropdown

3. **Alerts** ✅ Ready (Alert rule editor)
   - Settings: Enabled, Severity, Trigger, Channels
   - Advanced: Debounce, History (global settings)
   - History: Journal monitor

4. **Conditional Styling** ✅ Ready
   - Settings: Target, Expression, Style
   - Advanced: Flash on match, Indicator, Formatter

5. **Column Settings** ✅ Ready
   - Settings: Header, Filter
   - Advanced: Grouping, Aggregation, Behavior

### Medium Impact (3 bands)

6. **Calculated Columns** — Consider tabs
7. **Plus / Minus** — Consider tabs

### Low Impact (1-2 bands)

- Data Change History (already well-organized)
- Shortcuts (minimal bands)
- Others (keep as-is)

---

## Success Criteria

| Criterion | Measure |
|-----------|---------|
| Easier discovery | Users find advanced options without scrolling |
| Reduced cognitive load | Simpler initial view (Settings tab only) |
| Progressive disclosure | Advanced features available but hidden |
| Cross-module clarity | Users understand relationships (badges) |
| Animation smoothness | Tab switching feels polished (150ms) |
| Accessibility | Keyboard navigation works (Tab key) |
| Mobile-friendly | Tabs stack on small screens |

---

## Files to Create

- [ ] `packages/ext/src/ui/tabGroup.ts` — Tab system helpers
- [ ] `docs/superpowers/guides/2026-08-17-design-system-phase-4-ia.md` — Full guide
- [ ] `docs/superpowers/guides/PHASE-4-TAB-REFERENCE.md` — Quick reference

## Files to Modify

- [ ] `packages/ext/src/ui/cockpit.ts` — Export tab helpers + CSS
- [ ] `packages/ext/src/modules/smartEdit.ts` — Add tabs
- [ ] `packages/ext/src/modules/bulkUpdate.ts` — Add tabs
- [ ] `packages/ext/src/modules/alerts.ts` — Add tabs
- [ ] `packages/ext/src/modules/plusMinus.ts` — Add tabs (optional)
- [ ] `packages/ext/src/modules/conditionalStyling.ts` — Add tabs

---

## Next Steps

1. ✅ Review this plan
2. Create tab group helpers (tabGroup.ts)
3. Implement pilot in Smart Edit module
4. Test tab switching + animations
5. Expand to other modules
6. Add cross-module badges
7. Document + ship

---

## Related Documentation

- Phase 1: `2026-08-17-design-system-phase-1-implementation.md`
- Phase 2: Component migration (all 5 modules)
- Phase 3: `2026-08-17-design-system-phase-3-microinteractions.md`
- Analysis: `velocitygrid-ux-design-analysis.md` (original research)

