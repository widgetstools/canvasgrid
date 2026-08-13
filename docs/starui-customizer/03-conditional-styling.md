# 03 — conditional-styling

> Expression-driven cell/row styling, flash animations, badge indicators. Largest visual-impact module. Requires [expression engine](README.md#1-expression-engine) and a `cellClassRules`-equivalent in the grid.

## Purpose

Apply styling to cells or whole rows based on rules that re-evaluate when values change. Examples:

- "Cells in `change %` column: red text if value < 0, green if > 0, with a flash animation on update"
- "Whole row: yellow background if `priority = 'high'` AND `unread = true`"
- "Show a ▲ badge in cells where `[col.new] > [col.old]`"

## Config schema

```ts
interface ConditionalRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;                          // lower fires first
  scope: { kind: 'cell'; columnIds: string[] } | { kind: 'row' };
  expression: string;                         // boolean predicate
  style: ThemeAwareStyle;                     // light + dark CSS slices
  flash?: FlashConfig;                        // CSS keyframe animation on activation
  indicator?: RuleIndicator;                  // badge icon, color, position
  animation?: AnimationConfig;                // glyph spin/pulse
  valueFormatter?: ValueFormatterTemplate;    // applied only to matching cells
  activeDurationMs?: number;                  // auto-expire (for "blink on change" UX)
}

interface ThemeAwareStyle {
  light?: { color, backgroundColor, fontWeight, ... };
  dark?:  { color, backgroundColor, fontWeight, ... };
}

interface FlashConfig {
  enabled: boolean;
  target: 'cell' | 'row';
  mode: 'fade' | 'pulse' | 'glow';
  color: FlashColor;       // from a palette mapped to CSS vars
  durationMs: number;
}

interface RuleIndicator {
  iconName: string;                            // from INDICATOR_ICONS (24 lucide icons)
  color: string;
  target: 'cell' | 'row-start' | 'row-end';
  position: 'before' | 'after'                 // Prefix / Suffix (inline)
         | 'tl' | 'tr' | 'bl' | 'br' | 'ml' | 'mr';  // positional overlays
}
```

## Runtime behavior

### Compile once

At module init, every rule's `expression` is compiled via the expression engine. Predicates are closures stored alongside the rule:

```ts
rule.predicate = engine.compile(rule.expression);  // (rowCtx) => boolean
```

### Trigger-column extraction

Walk the AST to extract which columns the expression references. Store as `rule.triggerColumns: string[]`. Used at runtime: when a cell in column X changes, refresh only the cells/rows whose rules reference X. Without this, AG-Grid only re-evaluates the changed cell's own rules — peer columns whose rules depend on the changed value go stale.

### `cellClassRules` / `rowClassRules`

For each rule, inject a class-rule mapping `ds-rule-<id>` → `predicate`. The grid stamps the class on matching cells/rows. The actual styles live in a CSS block injected via `CssHandle`:

```css
.ds-rule-abc123                 { background: var(--rule-bg-abc123); color: ... }
.ag-theme-dark .ds-rule-abc123  { background: var(--rule-bg-abc123-dark); ... }
```

Zero per-cell React work. CSS does the painting; the predicate just toggles class presence.

### Flash animation

CSS keyframes with each rule's own color and timing:

```css
@keyframes flash-abc123 {
  0%   { background: var(--flash-abc123); }
  100% { background: transparent; }
}
.ds-rule-abc123.flashing { animation: flash-abc123 800ms ease-out; }
```

Why custom keyframes vs. AG-Grid's `flashCells()`:
- AG-Grid flash has one global color per grid; rule-specific colors are impossible
- Can paint **headers** too (AG-Grid has no `headerClassRules`)
- Composes naturally with `activeDurationMs`
- Zero JS per cell

### Diff-aware rules (`[col.old]` / `[col.new]`)

Expressions can reference prior values. The runtime maintains a `RowDiffMap` keyed by colId; on `cellValueChanged`, sync old/new into the map. Lazy: diff snapshot only created for rules that actually use `.old`/`.new` refs (extracted at compile time).

### Timed rules (`activeDurationMs`)

Some rules are "blink on change" — match briefly, then expire. Implementation:

- `timedRuleState: Map<rowId, Map<ruleId, expiresAt>>`
- On match: `upsertTimedRowActivation(rowId, ruleId, expiresAt)`
- Single coalesced timer armed for the nearest expiry across all entries; on fire, prune expired entries and refresh affected cells
- O(1) insert, O(log N) expiry — uses a min-heap or sorted structure

## UI surface

Engine layer has none. Host renders:
- Rules panel: list with priority, enable toggle, edit/delete
- Rule editor dialog: name, scope (cell/row + columns picker), expression editor with autocomplete, style picker (color/font/border), flash config, indicator picker (icon grid + color + position), animation toggle
- Live preview against current grid data

## Persistence

```ts
{
  rules: ConditionalRule[]
}
```

Light/dark slices, rule IDs, priorities all persisted. Timed-state (in-memory) never persisted — rules fire fresh on profile reload.

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/conditional-styling/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/conditional-styling/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/conditional-styling/transforms.ts](../../../starui/packages/shared/engine/src/customizer/modules/conditional-styling/transforms.ts)
- [../starui/packages/shared/engine/src/customizer/modules/conditional-styling/indicatorIcons.ts](../../../starui/packages/shared/engine/src/customizer/modules/conditional-styling/indicatorIcons.ts)

## Design decisions worth copying

- **CSS keyframe flash, not grid-native.** Per-rule colors, header support, composability — all impossible with AG-Grid's `flashCells()`. The trade-off (custom CSS upkeep) is worth it.
- **Compile-once predicates.** Per-cell evaluation must be a closure call, not a parse.
- **Trigger-column extraction.** Without this, peer-column rules go stale on cell change. AG-Grid only refreshes the changed cell by default.
- **Lazy diff snapshot.** Only rules that use `.old`/`.new` cause diff tracking. Most rules don't, so default cost is zero.
- **Min-heap expiry scheduler.** Single coalesced timer instead of one per activation. Critical at scale (1000s of active timed rules).
- **CSS classes with stable IDs.** `ds-rule-<ruleId>` makes Excel export trivial — visual-excel maps each class to an `ExcelStyle`.

## cgrid translation

This is the module where cgrid needs the most new machinery:

1. **`cellClassRules` / `rowClassRules` equivalent.** cgrid renders cells on canvas, not DOM, so "CSS class" doesn't apply directly. Two options:
   - Register class-named style overrides; the renderer reads computed CSS for the class on init and applies styles when the predicate matches. Keeps the "class as data" model.
   - Inline the styles directly into the rule object and skip CSS altogether. Simpler but breaks Excel-export reuse.
   
   **Recommended: hybrid.** Rule has a `style` object that the canvas renderer applies directly. Also emit a CSS class for HTML overlays (headers? floating filter row?) and for Excel export.

2. **Header styling.** cgrid's header is canvas-rendered. The header painter needs a hook to consult conditional-styling rules whose scope is `header` (or row-scope rules whose first cell is a header).

3. **Flash animations on canvas.** Canvas doesn't have CSS animations. Options:
   - Render flash as a per-cell overlay div positioned absolutely over the canvas cell — full CSS keyframe support, slow at scale.
   - Implement flash in the canvas paint loop with a per-cell timestamp; interpolate color over `durationMs`. Fast, but reimplementing easing curves.
   
   **Recommended: paint-loop flash.** cgrid already has a render loop; add a `flashState: Map<cellKey, { startedAt, config }>`. The paint pass interpolates the background color. ~50 LOC.

4. **Old/new diff tracking.** Worker needs to emit old + new on cell change. Verify and add if missing — this is the single biggest gap.

5. **Indicator badges.** Render in the cell paint pass as a small icon at the chosen position. cgrid already has an icon system in `renderer/icons/`.
