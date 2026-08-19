# Cycle 27 — Cell Styling Expansion — Design Spec

> Expand cgrid's per-cell, per-header, and per-group-header styling to cover:
> per-side borders, vertical alignment, font breakouts, text transforms, cell
> content types (icon / emoji / icon+text), and corner-/edge-positioned
> decorators. First-class API for bg/fg color throughout.

**Status:** Cycle 27 — proposed, not yet started.
**Author:** Plan distilled from styling-capability audit (2026-06-29).
**Target:** 3 tasks within Cycle 27, ~1,500–2,500 LOC total across `cgrid/src/types.ts`, `cgrid/src/core/propertyChain.ts`, `cgrid/src/renderer/`.

---

## Goals

1. Users can set per-side borders (top/right/bottom/left) on cells, column headers, and column group headers — independent width, color, style (solid/dashed/dotted/double), and visibility per side.
2. Users can vertically align cell content (top / middle / bottom) — middle remains the default.
3. Users can configure font as separate breakout fields (`fontSize`, `fontWeight`, `fontStyle: italic`, `fontFamily`) instead of having to bake everything into a single CSS shorthand string.
4. Users can apply `textTransform` (uppercase / lowercase / capitalize), `letterSpacing`, `lineHeight`.
5. Users can render cell content as plain text, an SVG icon, an emoji, or icon+text combined — declaratively via `cellStyle.content`.
6. Users can attach up to 6 decorators to a cell — one per position (top-left, top-right, bottom-left, bottom-right, middle-left, middle-right). Each decorator is an icon, emoji, dot, or short text label with optional badge background.
7. Background and foreground colors are first-class per-cell / per-header / per-group-header — already partially supported via `cellStyle: { fg, bg }`; this spec makes the surface consistent and discoverable across all three surface types.
8. Same styling system works on **cells, column headers, and column group headers**. Today only cells have a clean style override path; headers/group-headers use class variants only. We're adding `headerStyle` and `groupHeaderStyle` for parity.

## Non-goals

- **CSS gradients / images in cell backgrounds.** Out of scope. Solid colors only.
- **DOM overlays per cell** (tooltips, popovers). Out of scope; cgrid stays canvas-only.
- **Clickable decorators / hit testing.** Out of scope for v1 — decorators are visual-only. Click affordances are a follow-up cycle.
- **CSS animations / transitions on style changes.** Cell flash (covered in conditional-styling spec) is a separate concern.
- **Class variants supporting all new fields.** Class variants today scan a fixed regex (`bg | fg | font | halign`). Extending the scanner to cover the new fields is a follow-up cycle; for v1, new fields are only addressable via the inline `cellStyle` / `headerStyle` / `groupHeaderStyle` callback paths.

---

## Type system (the contract)

All changes live in [cgrid/src/types.ts](cgrid/src/types.ts). One unified `CellOverrides` shape used by all three surfaces.

```ts
// ─── Building blocks ───────────────────────────────────────────────────

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export type FontWeight =
  | 'normal' | 'bold' | 'lighter' | 'bolder'
  | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type FontStyle = 'normal' | 'italic';

export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double';

export interface BorderSide {
  width?: number;    // pixels. 0 (or omitted) = invisible
  color?: string;    // any CSS color string
  style?: BorderStyle; // default 'solid'
}

export interface BorderSpec {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
  /** Shortcut: applies to any side NOT explicitly set above. */
  all?: BorderSide;
}

export interface Padding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

// ─── Content slots ─────────────────────────────────────────────────────

export type CellContent =
  | { kind: 'text'; value: string }
  | { kind: 'icon'; icon: string; color?: string; size?: number }
  | { kind: 'emoji'; value: string; size?: number }
  | {
      kind: 'icon-text';
      icon: string;
      text: string;
      iconPosition?: 'before' | 'after';   // default 'before'
      gap?: number;                         // default 4px
      iconColor?: string;
      iconSize?: number;
    };

// ─── Decorators ────────────────────────────────────────────────────────

export type DecoratorPosition =
  | 'tl' | 'tr' | 'bl' | 'br'   // four corners
  | 'ml' | 'mr';                 // middle-left, middle-right

export type CellDecorator =
  | {
      position: DecoratorPosition;
      kind: 'icon';
      icon: string;        // registered icon name
      color?: string;
      size?: number;       // default 12px
      inset?: number;      // distance from cell edge, default 2px
      bg?: string;         // optional badge background
    }
  | {
      position: DecoratorPosition;
      kind: 'emoji' | 'text';
      value: string;
      color?: string;
      size?: number;
      inset?: number;
      bg?: string;
    }
  | {
      position: DecoratorPosition;
      kind: 'dot';
      color: string;       // required for dot
      size?: number;       // diameter; default 6px
      inset?: number;
      bg?: string;         // optional ring
    };

// ─── The unified override shape ────────────────────────────────────────

export interface CellOverrides {
  // Colors (existing, kept verbatim)
  fg?: string;
  bg?: string;

  // Alignment
  halign?: HAlign;          // existing
  valign?: VAlign;          // NEW — default 'middle'

  // Font (existing shorthand kept for back-compat; NEW breakouts take precedence)
  font?: string;            // CSS font shorthand, e.g. '600 13px Helvetica'
  fontFamily?: string;      // NEW
  fontSize?: number;        // NEW — pixels
  fontWeight?: FontWeight;  // NEW
  fontStyle?: FontStyle;    // NEW

  // Text
  textTransform?: TextTransform; // NEW
  letterSpacing?: number;        // NEW — pixels
  lineHeight?: number;           // NEW — multiplier (default 1.2)

  // Padding (fine-tune content position; defaults from theme)
  padding?: number | Padding;    // NEW — uniform or per-side

  // Borders (NEW)
  border?: BorderSpec;

  // Content slot (NEW — when set, overrides default text rendering)
  content?: CellContent;

  // Decorators (NEW — up to 6, one per position)
  decorators?: CellDecorator[];
}
```

`ColCellOverrides` (existing type used by `cellStyle`) becomes an alias for `CellOverrides`. Same shape for new fields:

```ts
export interface CColDef<TRow = unknown> {
  // ... existing
  cellStyle?: CellOverrides | ((p: CellStyleParams) => CellOverrides | null);
  headerStyle?: CellOverrides | ((p: HeaderStyleParams) => CellOverrides | null);   // NEW
}

export interface CColGroupDef {
  // ... existing
  headerStyle?: CellOverrides | ((p: GroupHeaderStyleParams) => CellOverrides | null); // NEW
}
```

### Why this shape

- **One type, three surfaces.** Cells, headers, group headers all accept `CellOverrides`. Reduces API surface and lets users learn one schema.
- **Breakouts AND shorthand.** Both `font: '600 13px Helvetica'` (existing) and `fontSize: 13, fontWeight: 600, fontFamily: 'Helvetica'` work. Breakouts compose into a final font string at paint time. Shorthand wins if both are present (predictable precedence).
- **Decorators are a flat array.** Up to 6 — one per position. Multiple decorators in the same position is an error (validated; last one wins with a console warning).
- **Content slot is opt-in.** Default (no `content`) renders text as today. Setting `content: { kind: 'icon', ... }` switches to icon rendering. No breakage of existing grids.

---

## Task 1 — Cell-style expansion

**Scope:** vertical alignment, font breakouts, text transform, letter spacing, line height, padding, direct `headerStyle` / `groupHeaderStyle`. Bg/fg already work — surfaced here as part of the consistent override schema.

**Effort:** Small. Mostly type additions + painter tweaks.

### Code touch points

| File | Change |
|---|---|
| [cgrid/src/types.ts](cgrid/src/types.ts) | Add: `VAlign`, `FontWeight`, `FontStyle`, `TextTransform`, `Padding`; extend `CellOverrides` with new fields; add `headerStyle` and `groupHeaderStyle` to colDef/groupDef. |
| [cgrid/src/core/propertyChain.ts](cgrid/src/core/propertyChain.ts) | Extend `applyCellProps` to compose font shorthand from breakouts when present; resolve `headerStyle` / `groupHeaderStyle`; apply `textTransform` before `valueFormatted`; honor `padding` for content area. |
| [cgrid/src/renderer/cellRenderers/registry.ts](cgrid/src/renderer/cellRenderers/registry.ts) | `textCell`, `numberCell`: compute y baseline based on `valign`; apply `textTransform` (already done upstream — assert here); apply `letterSpacing` via `ctx.letterSpacing = '<px>px'` (modern browsers); fall back to manual char-spacing if unsupported. |
| [cgrid/src/renderer/cellRenderers/wrapText.ts](cgrid/src/renderer/cellRenderers/wrapText.ts) | Use `lineHeight` multiplier instead of fixed 1.2. |

### Vertical alignment implementation

Today every painter sets `textBaseline = 'middle'` and uses `bounds.y + bounds.h / 2`. New formula:

```ts
function computeY(bounds: Rect, valign: VAlign, padding: Padding): number {
  const top    = bounds.y + (padding.top ?? 0);
  const bottom = bounds.y + bounds.h - (padding.bottom ?? 0);
  switch (valign) {
    case 'top':    return top;
    case 'bottom': return bottom;
    case 'middle':
    default:       return (top + bottom) / 2;
  }
}
```

Painter still uses `textBaseline = 'middle'` for `'middle'` valign, `'top'` for `'top'`, `'alphabetic'` for `'bottom'` — slight per-mode tweak.

### Font composition

```ts
function composeFont(o: CellOverrides, themeFont: string): string {
  if (o.font) return o.font;  // explicit shorthand wins
  if (!o.fontFamily && !o.fontSize && !o.fontWeight && !o.fontStyle) return themeFont;

  // parse theme font to fill any missing pieces
  const parsed = parseFontShorthand(themeFont);
  const style  = o.fontStyle  ?? parsed.style  ?? 'normal';
  const weight = o.fontWeight ?? parsed.weight ?? 'normal';
  const size   = o.fontSize   ?? parsed.size   ?? 13;
  const family = o.fontFamily ?? parsed.family ?? 'sans-serif';

  return `${style} ${weight} ${size}px ${family}`;
}
```

`parseFontShorthand` is a small utility (~30 LOC, regex-based) — composed once per cell style resolution and cached if the override is static.

### Text transform

Applied after `valueFormatter` runs, before the painter renders. Most efficient location: in `applyCellProps` where `valueFormatted` is computed.

```ts
if (overrides.textTransform === 'uppercase') valueFormatted = valueFormatted.toUpperCase();
else if (overrides.textTransform === 'lowercase') valueFormatted = valueFormatted.toLowerCase();
else if (overrides.textTransform === 'capitalize') valueFormatted = capitalize(valueFormatted);
```

### Letter spacing

Canvas 2D supports `ctx.letterSpacing` in Chromium 99+, Firefox 116+, Safari 16+. For older browsers, fall back to char-by-char rendering (only when `letterSpacing` is set — no perf hit when unused).

### `headerStyle` / `groupHeaderStyle` resolution

Mirror the existing `cellStyle` resolution chain in `propertyChain.ts`:
```
header default theme → headerClass variants → headerStyle (static) → headerStyle (callback)
```
Same precedence rules; same painter consumption.

### Deliverables

- Updated `types.ts` exports
- Updated `propertyChain.ts` composition logic
- Updated painters honoring all new fields
- Unit tests covering each new field (snapshot-based for visual output)
- Showcase feature `apps/velocitygrid-showcase/src/features/cellStyleExpansion.js` demonstrating each capability

### Acceptance criteria

- All existing demos render identically (no regressions)
- New showcase demo shows: top/middle/bottom aligned cells; italic cells; uppercase headers; per-header background colors; per-column letter spacing
- Bundle size delta < 2 KB minified

---

## Task 2 — Per-side borders

**Scope:** Per-side border width / color / style / visibility on cells, column headers, group headers. Style support: solid, dashed, dotted, double.

**Effort:** Medium. Architectural shift in how borders are drawn.

### Architecture today

[cgrid/src/renderer/painters/gridLinesPainter.ts](cgrid/src/renderer/painters/gridLinesPainter.ts) draws **uniform** horizontal + vertical grid lines for the entire viewport in a single pass, using `theme.gridLineColor`. Per-cell painters never draw borders.

### Architecture after

Two-pass border rendering:

1. **Default grid lines pass** (existing) — draws uniform grid where no cell-specific border overrides exist
2. **Per-cell border pass** (NEW) — only iterates cells whose resolved `CellOverrides` include a `border` spec. Strokes per-side as specified. Runs AFTER content paint so borders sit on top of background but don't interfere with text rendering.

For a cell with a border spec, suppress the default grid line on the corresponding edges (e.g., custom top border → skip default top grid line for that segment) to avoid double-stroking with different colors.

### Implementation

New painter: `cgrid/src/renderer/painters/cellBordersPainter.ts`

```ts
export function paintCellBorders(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  border: BorderSpec
): void {
  const sides: Array<['top' | 'right' | 'bottom' | 'left', BorderSide | undefined]> = [
    ['top',    border.top    ?? border.all],
    ['right',  border.right  ?? border.all],
    ['bottom', border.bottom ?? border.all],
    ['left',   border.left   ?? border.all],
  ];

  for (const [side, spec] of sides) {
    if (!spec || !spec.width || spec.width === 0) continue;

    ctx.save();
    ctx.strokeStyle = spec.color ?? '#000';
    ctx.lineWidth = spec.width;
    setDashPattern(ctx, spec.style ?? 'solid', spec.width);

    ctx.beginPath();
    switch (side) {
      case 'top':    ctx.moveTo(bounds.x, bounds.y);                  ctx.lineTo(bounds.x + bounds.w, bounds.y); break;
      case 'right':  ctx.moveTo(bounds.x + bounds.w, bounds.y);       ctx.lineTo(bounds.x + bounds.w, bounds.y + bounds.h); break;
      case 'bottom': ctx.moveTo(bounds.x, bounds.y + bounds.h);       ctx.lineTo(bounds.x + bounds.w, bounds.y + bounds.h); break;
      case 'left':   ctx.moveTo(bounds.x, bounds.y);                  ctx.lineTo(bounds.x, bounds.y + bounds.h); break;
    }
    ctx.stroke();
    ctx.restore();
  }
}

function setDashPattern(ctx: CanvasRenderingContext2D, style: BorderStyle, width: number) {
  switch (style) {
    case 'solid':  ctx.setLineDash([]); break;
    case 'dashed': ctx.setLineDash([width * 3, width * 2]); break;
    case 'dotted': ctx.setLineDash([width, width]); break;
    case 'double': /* draw two strokes; see below */ break;
  }
}
```

For `'double'`: render as two parallel lines `width` apart. Slightly more painter logic; ~15 extra LOC.

### Performance considerations

- **Most cells have no border.** Iterate only visible cells with a non-null `border` field. Bound by viewport (typically <500 cells visible). Negligible cost.
- **State changes are expensive on canvas.** Group cells by border-style signature in a pre-pass and stroke each group as a batch (one `save`/`restore` per group). Optimization for v1.1; not v1.
- **Grid-line suppression.** When a cell has any border, skip the default grid line at that segment. Implement as a "border mask" computed alongside the per-cell border pass.

### Code touch points

| File | Change |
|---|---|
| [cgrid/src/types.ts](cgrid/src/types.ts) | Add `BorderSide`, `BorderSpec`, `BorderStyle` (from Task 1's type system). |
| [cgrid/src/renderer/painters/cellBordersPainter.ts](cgrid/src/renderer/painters/cellBordersPainter.ts) | **NEW.** Per-cell border painter. |
| [cgrid/src/renderer/painters/gridLinesPainter.ts](cgrid/src/renderer/painters/gridLinesPainter.ts) | Add `excludeSegments` parameter to suppress default lines where per-cell borders override. |
| [cgrid/src/velocityGrid.ts](cgrid/src/velocityGrid.ts) (or the renderer orchestration) | Wire the new painter into the paint pipeline; run after content paint, before overlays. |

### Deliverables

- New painter
- Grid-line suppression logic
- Per-cell, per-header, per-group-header border support
- Tests covering: single side, all sides, mixed styles, mixed colors, double-line rendering
- Showcase demo with: outlined cells, dashed borders on headers, custom group header chrome, totals row with thick top border

### Acceptance criteria

- Per-side borders render correctly with all four styles (solid/dashed/dotted/double)
- No regression on grids without any border specs (default grid lines unchanged)
- 10K row × 50 col grid with ~5% of cells having custom borders maintains 60fps scroll
- Bundle size delta < 3 KB minified

---

## Task 3 — Cell content slots + corner decorators

**Scope:** `content` slot (icon / emoji / icon+text instead of plain text) + `decorators` (up to 6 per cell, in corner and middle-edge positions).

**Effort:** Medium. New rendering layer; user-extensible icon registry.

### User-extensible icon registry

Today [cgrid/src/renderer/icons.ts](cgrid/src/renderer/icons.ts) has a hardcoded set (`chevron-up`, `filter`, `menu`, etc.). Make it user-extensible:

```ts
// New public API:
grid.registerIcon(name: string, path: string): void;
grid.registerIcons(map: Record<string, string>): void;
grid.getIcon(name: string): IconDef | undefined;
```

`path` is SVG path data (`d` attribute of `<path>`). Icons render at any size via `Path2D` + canvas transform. Apps can ship their own icon set (lucide, heroicons, custom) by calling `registerIcons` at init.

### Content slot dispatcher

In each cell painter, check for `overrides.content` BEFORE defaulting to text rendering:

```ts
function renderCellContent(ctx, bounds, props: CellPaintConfig) {
  const content = props.overrides.content;
  if (!content) {
    renderText(ctx, bounds, props);   // existing path
    return;
  }
  switch (content.kind) {
    case 'text':       renderText(ctx, bounds, { ...props, value: content.value }); return;
    case 'icon':       renderIcon(ctx, bounds, content, props); return;
    case 'emoji':      renderEmoji(ctx, bounds, content, props); return;
    case 'icon-text':  renderIconAndText(ctx, bounds, content, props); return;
  }
}
```

`renderIcon`: looks up the icon path, computes center based on `halign`/`valign`, strokes Path2D at requested size + color.

`renderEmoji`: uses `fillText` (emojis are just glyphs) but bumps font-size to `content.size` if specified.

`renderIconAndText`: lays out icon + gap + text horizontally based on `iconPosition` (before / after). Honors `halign` for the overall cluster.

### Decorator layer

After cell content paints, iterate `overrides.decorators`:

```ts
function paintDecorators(ctx, bounds, decorators: CellDecorator[]) {
  for (const d of decorators) {
    const pos = computeDecoratorPosition(bounds, d.position, d.size ?? 12, d.inset ?? 2);
    if (d.bg) paintBadgeBackground(ctx, pos, d.size ?? 12, d.bg);
    switch (d.kind) {
      case 'icon':  paintIconAt(ctx, pos, d.icon, d.color, d.size); break;
      case 'emoji': paintEmojiAt(ctx, pos, d.value, d.size); break;
      case 'text':  paintTextAt(ctx, pos, d.value, d.color, d.size); break;
      case 'dot':   paintDotAt(ctx, pos, d.color, d.size); break;
    }
  }
}

function computeDecoratorPosition(
  bounds: Rect, position: DecoratorPosition, size: number, inset: number
): Point {
  const halfW = size / 2, halfH = size / 2;
  switch (position) {
    case 'tl': return { x: bounds.x + inset + halfW,            y: bounds.y + inset + halfH };
    case 'tr': return { x: bounds.x + bounds.w - inset - halfW, y: bounds.y + inset + halfH };
    case 'bl': return { x: bounds.x + inset + halfW,            y: bounds.y + bounds.h - inset - halfH };
    case 'br': return { x: bounds.x + bounds.w - inset - halfW, y: bounds.y + bounds.h - inset - halfH };
    case 'ml': return { x: bounds.x + inset + halfW,            y: bounds.y + bounds.h / 2 };
    case 'mr': return { x: bounds.x + bounds.w - inset - halfW, y: bounds.y + bounds.h / 2 };
  }
}
```

Decorators overlay content — they don't shrink the content area. (If users need that, they pad the content via `cellStyle.padding`.)

### Validation

Decorator validation at colDef resolution time:
- Max 6 decorators per cell
- Each position can appear at most once (duplicate → console warning, last wins)
- `kind: 'icon'` requires `icon` field referencing a registered name
- `kind: 'dot'` requires `color` field

Errors logged once per colDef compile, not per cell paint.

### Performance

- Decorators add per-cell cost only when present. Bound by 6 × visible cell count.
- Icon Path2D objects cached after first render (already done for built-in icons).
- Most cells will have zero decorators → early-exit on empty array (`if (!decorators?.length) return`).

### Code touch points

| File | Change |
|---|---|
| [cgrid/src/types.ts](cgrid/src/types.ts) | Add `CellContent`, `CellDecorator`, `DecoratorPosition`. |
| [cgrid/src/renderer/icons.ts](cgrid/src/renderer/icons.ts) | Make registry mutable; add `registerIcon`/`registerIcons`/`getIcon` accessors. |
| [cgrid/src/renderer/cellRenderers/contentSlot.ts](cgrid/src/renderer/cellRenderers/contentSlot.ts) | **NEW.** Content dispatcher (text/icon/emoji/icon+text). |
| [cgrid/src/renderer/cellRenderers/decorators.ts](cgrid/src/renderer/cellRenderers/decorators.ts) | **NEW.** Decorator paint layer + position computation. |
| [cgrid/src/renderer/cellRenderers/registry.ts](cgrid/src/renderer/cellRenderers/registry.ts) | `textCell`/`numberCell`: replace inline `fillText` with `renderCellContent`; call `paintDecorators` after content. |
| [cgrid/src/velocityGrid.ts](cgrid/src/velocityGrid.ts) | Expose `registerIcon` / `registerIcons` on the public API. |

### Deliverables

- Content slot + dispatcher
- Decorator layer + position computation
- User-extensible icon registry
- Validation with one-time console warnings
- Tests for: each content kind, each decorator position, max-6 validation
- Showcase demo: "Status" column with `tl: red dot` for failed rows; "Rating" column with `content: { kind: 'icon-text', icon: 'star', text: '4.5' }`; "Trend" column with `content: { kind: 'icon', icon: 'arrow-up', color: 'green' }`

### Acceptance criteria

- All 6 decorator positions render correctly at any cell size (>= 20×20)
- Built-in icons + user-registered icons coexist
- Existing showcases unchanged
- 10K row × 50 col grid with decorators on ~30% of cells maintains 60fps scroll
- Bundle size delta < 4 KB minified (including built-in icon registry expansion to common icons)

---

## Migration & backwards compatibility

**Zero breaking changes** across all three tasks. Every new field is optional. Existing grids using `cellStyle: { fg, bg, font, halign }` work identically.

Existing `colDef.headerClass` + class-variant CSS scheme continues to work. The new `headerStyle` is an additional path with higher precedence when both are present (consistent with `cellClass` + `cellStyle` precedence today).

Class variants don't gain the new fields in this scope — they're still limited to `bg | fg | font | halign`. Following cycles can extend the scanner regex if user demand emerges.

---

## Performance budget

Combined cost of all three tasks on a 10K row × 50 col grid (~500 cells visible at any time):

| Pass | Cost per visible cell | Total per frame |
|---|---|---|
| Task 1 — font + valign + transforms | ~0.5 μs (one font compose + transform check) | ~0.25 ms |
| Task 2 — borders (5% of cells) | ~3 μs per bordered cell (4 strokes) | ~0.075 ms |
| Task 3 — content + decorators (30% with decorators, avg 1.5 decorators) | ~5 μs per decorated cell | ~0.75 ms |
| **Combined** | | **~1.1 ms / frame** |

Budget: 16.6 ms per frame (60 fps). Cell styling adds ~7% of frame budget. Acceptable.

---

## Test plan

Per task:

1. **Unit tests** (vitest) for type composition, font shorthand parsing, decorator position math, validation rules.
2. **Visual snapshot tests** using canvas pixel capture — render a 5×5 grid with various style permutations, hash output, compare against committed baselines. Catches accidental regressions in painter output.
3. **Performance regression tests** — render-frame timing for the 10K × 50 grid with various styling densities. Fail if regression > 10% vs. baseline.
4. **Showcase demos** under `apps/velocitygrid-showcase/src/features/` — one per task. Hand-verified.

---

## Open questions for the user

Pick or skip — all have reasonable defaults if you don't care.

1. **Dashed/dotted dash patterns.** Spec proposes `setLineDash([width * 3, width * 2])` for dashed and `[width, width]` for dotted. Make these themable? Default for v1 is hardcoded.
2. **Decorator clickability.** Spec says no for v1. Confirm — or do you want click events on decorators (for "delete this row" trash icons, etc.)? If yes, that's a small follow-up cycle.
3. **Padding interaction with decorators.** Should `ml`/`mr` decorators automatically shrink the text area, or always overlay? Spec proposes overlay-only (user handles padding manually). The alternative (auto-shrink) is more "intuitive" but harder to predict.
4. **Class variants for new fields.** Extending the CSS variant scanner to support `valign`, `fontSize`, etc. is a small follow-up. Worth doing in this scope, or defer until users ask?
5. **Task ordering within Cycle 27.** Spec proposes Task 1 → 2 → 3. Want to swap (e.g., do per-side borders first since most visible)? Or bundle Tasks 1+2 into one PR since they're both small?

---

## Estimated timeline (loose)

- **Task 1:** 1–2 days dev + 1 day test/polish/demo
- **Task 2:** 2–3 days dev + 1 day test/polish/demo
- **Task 3:** 3–4 days dev + 1 day test/polish/demo

Total: ~7–10 working days for a single dev, including showcase and tests.
