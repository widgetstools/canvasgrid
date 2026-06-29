# 04 — Conditional Styling

> Rule-based cell/row styling, flash animations, indicator badges, animated glyphs, value formatters. Second-biggest editor after Column Settings.

Engine module: [conditional-styling](../starui-customizer/03-conditional-styling.md)

## Purpose

Create rules that match boolean expressions and apply styling, flashing, indicators, or value formatters. Examples: "red text when value < 0", "flash yellow when changed", "▲ icon badge in cells where new > old".

## Invocation

Settings Sheet → Styling → Conditional Styling.

## Layout

```
┌────────────────────────┬──────────────────────────────────────────┐
│ RULES: 12 [+]          │ [Rule name input]  [Reset][Save]        │
│────────────────────────│──────────────────────────────────────────│
│ ✓ Rule 1 (LED)[clone]  │ Sticky meta strip:                       │
│   Rule 2 (muted)       │ ENABLED │ SCOPE │ PRIORITY │ FLASH │ APP │
│   Rule 3 (LED)[clone]  │──────────────────────────────────────────│
│   …                    │ 01 EXPRESSION                            │
│                        │   <ExpressionEditor> + validation        │
│                        │ 02 TARGET COLUMNS (if scope=cell)        │
│                        │   [column checkboxes]                    │
│                        │ STYLE                                    │
│                        │   <StyleEditor: text + color + border>   │
│                        │ 07 FLASH                                 │
│                        │   enabled [toggle], target, mode, color, │
│                        │   duration                               │
│                        │ 08 INDICATOR                             │
│                        │   <IndicatorPicker>                      │
│                        │     [icon grid grouped by category]      │
│                        │     [TARGET: cells/headers/both]         │
│                        │     [POSITION: 6 corners + middles]      │
│                        │     [color picker] [clear]               │
│                        │ 09 VALUE FORMATTER (cell scope only)     │
│                        │   <FormatterPicker compact>              │
│                        │ 10 ANIMATE (cell scope only)             │
│                        │   kind [spin/pulse], duration            │
└────────────────────────┴──────────────────────────────────────────┘
```

## Component tree

- **ConditionalStylingList** (left rail; `ListPane`)
  - Header + `[+]` add button
  - CockpitList of rules
  - **RuleRow** (memoized per rule) — name, LED, [clone] + [trash] buttons (hover reveal)
- **ConditionalStylingEditor** (right pane; `EditorPane`)
  - Empty placeholder when none selected
  - **RuleEditor** (memoized)
    - **RuleEditorHeader** — name input + Save/Reset
    - **RuleMetaStrip** — sticky: enabled chip, scope kind, priority, flash status, applied row count
    - Scrollable bands:
      - **ExpressionBand** — ExpressionEditor + live validation
      - **TargetColumnsBand** — only renders if `scope.kind === 'cell'`; checkboxes
      - **StyleEditor** (shared)
      - **FlashBand** — flash config
      - **IndicatorBand** — IndicatorPicker (grouped icon grid)
      - **ValueFormatterBand** — only if scope is cell
      - **AnimateBand** — only if scope is cell (value glyph animation)

## Props

Standard `ListPane` + `EditorPane`.

## Internal state

- Selected rule ID
- Draft rule (`{ id, name, enabled, priority, scope, expression, style, flash?, indicator?, valueFormatter?, animation?, activeDurationMs? }`)
- Validation result from expression engine

## Interaction flows

**Add rule:**
```
[+] → create { id, name: 'New Rule', enabled: true, priority: length,
  scope: { kind: 'row' }, expression: 'true',
  style: { light: {}, dark: {} } } → select
```

**Clone rule:**
```
clone button → copy → generate new id → name + ' (copy)' (deduped via makeUniqueCloneName) →
  enabled: false → priority shifted → re-select clone
```

**Switch scope (row ↔ cell):**
```
scope toggle → if switching to row: TargetColumnsBand + ValueFormatterBand + AnimateBand hide
              → if switching to cell: those bands appear
```

**Set indicator:**
```
pick icon from grouped grid → indicator state populated with defaults
  (target: 'both', position: 'top-right') →
  color picker becomes available → set color → preview updates inline
```

**Toggle enabled:**
```
switch → rule.enabled updates → immediately disables rule matching in engine
```

**Delete:**
```
trash → confirm not required (rules are easily recreated) → remove from rules array
```

## Engine wiring

- **Reads**: `conditional-styling.rules` array
- **Commit**: via draft → match by id
- **Live validation**: `useGridPlatform().resources.expression()` → compiles per keystroke, returns error or null
- **Live applied count**: meta strip's "APP N" shows how many rows currently match — computed by querying the engine's evaluator

## Shared primitives used

- CockpitList, Band, ObjectTitleRow, SummaryChip
- ExpressionEditor (multiline)
- StyleEditor (sections: text + color + border; not format)
- FormatterPicker (compact, in ValueFormatterBand)
- ColorPicker / CompactColorField (in IndicatorBand)
- PillToggleGroup (TARGET, POSITION)
- ChromeButton, GhostIconButton

## IndicatorPicker detail

This is the most complex sub-editor in this panel. Renders an icon grid grouped by category (Direction, Alert, Status, Lifecycle, Favorite, Classification — ~24 icons total from lucide).

```
┌──────────────────────────────────────┐
│ Current: [▲ red @ top-right]        │
│ Color: [color picker swatch]         │
│ Target: [Cells][Headers][Both]      │  ← PillToggleGroup
│ Position: [TL][TR][BL][BR][LM][RM]  │  ← PillToggleGroup
│ ─────────────────────────────────── │
│ DIRECTION                            │
│  ▲ ▼ ◀ ▶ ↑ ↓ ← →                  │
│ ALERT                                │
│  ⚠ ❗ ⓘ ?                            │
│ STATUS                               │
│  ✓ ✗ ● ○                            │
│ LIFECYCLE                            │
│  ◐ ◑ ⊕ ⊖                            │
│ FAVORITE                             │
│  ★ ☆ ♥                              │
│ CLASSIFICATION                       │
│  ▪ ◆ ▼                              │
│ [Clear indicator]                    │
└──────────────────────────────────────┘
```

Icons are stored as inline SVG strings with `currentColor` placeholders — `iconAsDataUrl()` swaps in the chosen color for rendering. Avoids pulling the entire lucide bundle.

## Design decisions worth copying

1. **Grouped icon grid as a flat data structure.** `INDICATOR_ICONS: { key, group, label, body }[]`. The picker groups by `group` at render time. Easy to add icons; no module restructuring.

2. **Inline SVG with `currentColor` placeholder.** `iconAsDataUrl(icon, color)` returns a data URL with the color baked in. Lets the picker preview each icon in the user's chosen color without a separate render.

3. **RuleRow memoized on rule + active only.** Dirty LED is a separate sub-component subscribing to DirtyBus. Row doesn't re-render when an unrelated rule is edited.

4. **Scope-conditional bands.** TargetColumnsBand, ValueFormatterBand, AnimateBand appear/disappear based on `scope.kind`. Cleaner than a single mega-form with 20 always-visible conditional fields.

5. **Live applied-rows count in meta.** "APP 47" tells the user how many rows currently match. Reassures them the rule is doing something.

6. **Clone with unique name + disabled default.** New clone starts disabled so user can edit before activating — avoids accidentally double-firing the same rule.

## cgrid translation

1. **`<cgrid-conditional-styling-list>`** + **`<cgrid-conditional-styling-editor>`** + **`<cgrid-rule-editor>`** + **`<cgrid-indicator-picker>`** as Lit custom elements.
2. **Inline-SVG icon catalog** — port the indicator icon library directly. Lit's `unsafeSVG` directive (~1 KB) renders SVG with color substitution.
3. **Engine wiring**: cgrid needs `cellClassRules`/`rowClassRules`-equivalent (covered in [engine doc](../starui-customizer/03-conditional-styling.md#cgrid-translation)). This editor writes rule definitions; the engine evaluates them.
4. **Flash animation editor**: writes a `FlashConfig` to the rule. cgrid's renderer applies flash in the paint loop (see engine doc). The editor just authors the config; doesn't preview animation live (consider a Preview button for that).
5. **Live applied-rows count**: requires the engine to expose a `matchCount(ruleId)` getter (or emit a count event on each evaluation).

Build in Phase 4 — depends on StyleEditor + FormatterPicker + ExpressionEditor + ColorPicker all being ready.
