# VelocityGrid Design System Phase 4: Information Architecture Implementation

**Status**: Complete (4a–4d)  
**Date**: August 17, 2026  
**Scope**: Tab groups, progressive disclosure, cross-module workflow badges  
**Goal**: Progressive disclosure and cross-module navigation in Customize

---

## What's Been Implemented

### 1. Tab Group System (`packages/ext/src/ui/tabGroup.ts`)

**Core Helpers**:

```typescript
createTabGroup(tabs, defaultTabId?, lucideSvg?)
createSettingsAdvancedTabs({ settings, advanced, history?, defaultTab?, lucideSvg? })
markBandComplexity(band, 'basic' | 'advanced')
appendBandsByComplexity(settingsPane, advancedPane, bands)
```

### 2. Workflow badges (`packages/ext/src/ui/workflowLink.ts`)

```typescript
workflowLink({ label, icon?, moduleId, events, lucideSvg?, hint? })
workflowStrip(links)
```

Emits `open-settings` with the target module id.

### 3. Module rollout

| Module | Tabs | Complexity routing | Workflow |
|--------|------|--------------------|----------|
| Smart Edit | Settings / Advanced | ✅ | → Edit History |
| Bulk Update | Settings / Advanced | ✅ | → Edit History |
| Plus / Minus | Settings / Advanced | ✅ | → Edit History |
| Alerts | Settings / Advanced / History | ✅ | → Conditional Styling |
| Conditional Styling | Settings / Advanced | ✅ | → Alerts |
| Edit History | — | — | → Smart Edit, Bulk Update |
| Calculated Columns | — | — | → Column Settings |

### 4. CSS (`cockpit.ts`)

- Tab underline + pane fade (Phase 4a)
- `.ckp-workflow-strip` / `.ckp-workflow-link` badges (Phase 4d)

---

## How to Use

```typescript
import {
  createSettingsAdvancedTabs,
  markBandComplexity,
  appendBandsByComplexity,
  workflowLink,
  workflowStrip,
  lucideSvg,
} from '../ui/cockpit';

const basic = band('Global');
markBandComplexity(basic, 'basic');
const adv = band('Safety');
markBandComplexity(adv, 'advanced');

const settings = el('div');
const advanced = el('div');
appendBandsByComplexity(settings, advanced, [basic, adv]);

root.appendChild(workflowStrip([
  workflowLink({
    label: 'View audit trail',
    icon: 'history',
    moduleId: 'data-change-history',
    events: ctx.events,
    lucideSvg,
  }),
]));

root.appendChild(createSettingsAdvancedTabs({
  settings,
  advanced,
  lucideSvg,
}).root);
```

---

## Success Criteria

| Criterion | Status |
|-----------|--------|
| Settings tab default | ✅ |
| Advanced progressive disclosure | ✅ via `data-complexity` + tabs |
| History tab where journal applies | ✅ Alerts |
| Cross-module badges | ✅ |
| Tab animation ≤150ms | ✅ |
| Prefers-reduced-motion | ✅ |

---

## Related Documentation

- Plan: `docs/superpowers/plans/2026-08-17-cycle-phase-4-ia.md`
- Phase 1–3 design-system guides in the same folder
