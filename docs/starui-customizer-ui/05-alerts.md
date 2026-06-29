# 05 — Alerts

> Rule editor with 3 trigger kinds (dataChange / relativeChange / rowChange), severity picker, message templates, notification channels. Plus a global-settings sub-band at the top.

Engine module: [alerts](../starui-customizer/04-alerts.md)

## Purpose

Configure alert rules that fire notifications on grid data events. Choose trigger kind, write the condition, pick severity + channels + message template, set per-rule debounce. Plus module-level settings (global enable, eval mode, channel toggles, history limit).

## Invocation

Settings Sheet → Styling → Alerts. Also accessible via a toolbar bell icon (opens a quick-mute popover that lists rules — that's a separate, smaller UI).

## Layout

```
┌──────────────────────────┬────────────────────────────────────────┐
│ Alert rules [+]          │ ┌─ GLOBAL SETTINGS (collapsed default)┐│
│──────────────────────────│ │ Alerts: [toggle]                    ││
│ ✓ Data change rule       │ │ Frequency: [realtime/throttled/paus]││
│   (LED) [clone][trash]   │ │ Channels: [toast][badge][openfin]   ││
│   Relative change rule   │ │ History: Keep [N] notifications     ││
│   Row added rule         │ └────────────────────────────────────┘│
│                          │────────────────────────────────────────│
│                          │ [Alert name input]  [Reset][Save]      │
│                          │ Rule: enabled [toggle]                 │
│                          │ Severity: [Info][Success][Warn][Crit]  │  ← AlertsSeverityPicker
│                          │ Trigger: [Expression][Δ Delta][Row]    │  ← TabStrip
│                          │   Expression tab:                     │
│                          │     <ExpressionBand>                  │
│                          │     Column [select, optional restrict]│
│                          │   Delta tab:                          │
│                          │     Column [select]                   │
│                          │     Mode [%/abs/any]                  │
│                          │     Threshold [number] (% only)       │
│                          │     Direction [both/up/down]          │
│                          │   Row tab:                            │
│                          │     [ROW_ADDED][ROW_REMOVED]          │
│                          │ Message: [template input]              │
│                          │   placeholders: {rule}{rowId}{column} │
│                          │ Channels: [toast][badge][openfin]      │
│                          │ Debounce: [slider + number, 0=default] │
└──────────────────────────┴────────────────────────────────────────┘
```

## Component tree

- **AlertsRulesList** (left rail; `ListPane`)
  - Add button + count
  - CockpitList of rules
  - Per-row: bell icon (faded if disabled) + name + LED + trigger-kind chip + clone + trash
- **AlertsEditor** (right pane; `EditorPane`)
  - **AlertsGlobalSettingsSection** (collapsible, default collapsed)
    - **AlertsSettingsBand** — 2-column grid:
      - Left: Alerts enable, Frequency radio + debounce slider
      - Right: Channels toggles, History limit
  - **AlertRuleEditor** (memoized, when rule selected)
    - RuleEditorHeader (name + Save/Reset)
    - Band: Rule (enabled toggle)
    - Band: Severity → AlertsSeverityPicker (4-tile radio)
    - Band: Trigger (3 tabs)
      - Expression: ExpressionBand + Column ColumnPicker (optional restrict)
      - RelativeChange: Column + Mode + Threshold + Direction
      - RowChange: ROW_ADDED / ROW_REMOVED radio
    - Band: Message (template input + placeholder list)
    - Band: Channels (toggles)
    - Band: Debounce (slider + input, 0 = use settings default)

## Props

Standard `ListPane` + `EditorPane`. Plus `AlertsRulesList` exports a quick-mute variant for the toolbar bell.

## Internal state

- Module: settings draft (enabled, evaluationMode, defaultDebounceMs, maxNotificationsPerSecond, enabledChannels, historyLimit)
- Rule: draft alert rule

## Interaction flows

**Add rule:**
```
[+] → create { id, name: 'New alert', enabled: true, priority: 0, severity: 'warning',
  trigger: { kind: 'dataChange', expression: '' },
  message: '{rule} fired on {rowId}',
  channels: ['toast', 'badge', 'openfin'] } → select
```

**Switch trigger kind:**
```
tab switch → replaces trigger shape (clears expression / mode / threshold / direction
  as appropriate; preserves common fields like severity, message)
```

**Severity picker:**
```
4-tile radio group → click → severity updates → preview chip in meta refreshes
```

**Module settings (no draft):**
```
Global enable / eval mode / debounce / channels / history — all live edit, auto-save
  (no Save button for these; they're module-scope not rule-scope)
```

**OpenFin channel toggle:**
```
isOpenFinHost() check → if window.fin missing, channel toggle is disabled with tooltip
  "OpenFin not available in this host"
```

## Engine wiring

- **Reads**: `alerts.rules` array; `alerts.settings` (module-level)
- **Rule commit**: via draft, by id match
- **Settings commit**: direct setState (no draft) — module-level changes are inherently global

## Shared primitives used

- CockpitList, Band, ObjectTitleRow, SummaryChip, TabStrip
- FigmaPanelSection (collapsible wrapper for global settings)
- RuleEditorHeader (shared with conditional-styling)
- ExpressionBand (shared with conditional-styling)
- AlertsSeverityPicker (custom: 4 tiles in a grid)
- BoolControl, NumberControl, Switch, RadioGroup, Slider

## Design decisions worth copying

1. **Collapsible global settings.** Default collapsed to preserve editor real estate for the rule being edited. Open it once, configure once, fold away. Don't waste space on settings users won't touch often.

2. **Severity tiles as radio.** 4 tiles in a grid (info / success / warning / critical), each with active state styling. More glanceable than a dropdown.

3. **Trigger kind via TabStrip.** Three kinds = three tabs. Switching tabs cleanly replaces the trigger shape. Avoids one mega-form with 12 conditional fields.

4. **`makeUniqueCloneName()` for dedupe.** "(copy)" suffix, "(copy) 2", "(copy) 3" — auto-increments to avoid duplicates.

5. **OpenFin auto-detection.** Channel toggle disables gracefully when not in OpenFin. Don't show error popups; just dim and tooltip.

6. **Message templates with named placeholders.** `{rule}`, `{rowId}`, `{column}` — simple string replace. Help text below input lists available placeholders.

7. **Live-edit module settings (no draft).** Rule edits use draft + Save (auditable, undoable). Module settings change immediately because there's no "preview" mode for "are alerts enabled."

## cgrid translation

1. **`<cgrid-alerts-list>`** + **`<cgrid-alerts-editor>`** + **`<cgrid-alert-rule-editor>`** + **`<cgrid-alerts-severity-picker>`** as Lit custom elements.
2. **TabStrip** as `<cgrid-tab-strip>` from foundations.
3. **OpenFin channel** — wrap in feature-detection (`'fin' in window`); when missing, render the toggle as disabled with tooltip.
4. **Engine wiring**: cgrid emits notification hits via the alerts evaluator (pure logic, no dependencies). Notification routing (toast, badge, OpenFin) is the host's responsibility — cgrid library provides hooks, host wires them.
5. **Toolbar bell popover** is a smaller separate component; build after the main panel works.

Build in Phase 4. Depends on ExpressionEditor + TabStrip.
