# CSS-driven cell styling — reference

cgrid is painted on a canvas, but its **appearance is authored in CSS** and
mapped onto the canvas paint artifacts. Styling *values* live in CSS (theme
tokens and custom-property variants); code only decides *which class* a cell
carries and draws data-viz *geometry*. There is no per-cell `getComputedStyle`
— everything below is read once per theme, in the theme probe.

## 1. Class-based cell & header styling

Give a column a class, author the class's appearance in CSS custom properties:

```ts
// column def — only the predicate (which class) is code
num('Daily P&L', 'dailyPnl', {
  cellClassRules: {
    loss: (p) => Number(p.value) < 0,
    gain: (p) => Number(p.value) > 0,
  },
});
// (or a static `cellClass: 'loss'`, or a function returning class names)
```

```css
/* the appearance — authored entirely in CSS, scoped anywhere in the grid's cascade */
.grid-host {
  --vg-cell-class-loss-fg: #e63946;
  --vg-cell-class-loss-bg: rgba(230, 57, 70, 0.10);
  --vg-cell-class-loss-border-left-width: 3px;
  --vg-cell-class-loss-border-left-style: solid;
  --vg-cell-class-loss-border-left-color: #e63946;
  --vg-cell-class-loss-font-weight: 700;
  --vg-cell-class-loss-decorator-tr: "▼";
  --vg-cell-class-loss-decorator-tr-color: #e63946;
}
```

Header cells use the same scheme with `--vg-header-class-<name>-*` and
`colDef.headerClass` / `headerClassRules`.

### Supported slots (`--vg-cell-class-<name>-<slot>`)

| Slot(s) | Paint artifact |
|---|---|
| `-fg`, `-bg` | text / background colour |
| `-halign` (`left`\|`right`\|`center`), `-valign` (`top`\|`middle`\|`bottom`) | alignment |
| `-font`, `-font-family`, `-font-size`, `-font-weight`, `-font-style` | typography |
| `-text-transform`, `-text-decoration`, `-letter-spacing`, `-line-height` | text treatment |
| `-padding`, `-padding-{top,right,bottom,left}` | content padding |
| `-border-{top,right,bottom,left}-{width,style,color}`, `-border-{side}` shorthand, `-border` (all sides) | per-side borders (width `0` = invisible) |
| `-icon` / `-emoji` / `-content` (+ `-icon-color`, `-icon-size`) | cell content override |
| `-decorator-{tl,tr,bl,br,ml,mr}` (+ `-color`, `-size`, `-inset`, `-bg`) | corner/edge decorator glyph |

CSS that a 2D canvas can't reproduce (gradients, `box-shadow`, `transform`,
`filter`) is not applied; use the mapped subset above.

## 2. Token-referenceable `cellStyle`

The typed `colDef.cellStyle` / `headerStyle` object still exists (typed,
programmatic, used by the UI customizer and calc). Its colour values may
reference theme tokens, resolved through the active theme:

```ts
num('Spread', 'spread', { cellStyle: { fg: 'var(--vg-info-color)' } });
```

`var(--vg-…)` (with optional `, fallback`) resolves once per token per theme and
re-resolves on theme swap. Literal colours pass through unchanged.

## 3. Data-viz renderer palette (tokens)

The `@wellsfargo-starui/velocity-grid-renderers` data-viz painters read every colour and key dimension from
CSS tokens (with the historical literals as defensive fallbacks), so a theme can
recolour bars / heat / pills / ratings without touching code:

| Token | Used by |
|---|---|
| `--vg-pos-color`, `--vg-neg-color`, `--vg-warning-color`, `--vg-info-color`, `--vg-muted-color` | semantic sign/status colours (P&L, bars, deltas, bps, …) |
| `--vg-status-<state>-{bg,fg,border}` | order status pills (`working`, `part-fill`, `filled`, `cancelled`, `rejected`, `pending`) |
| `--vg-rating-<grade>-color` | credit-rating scale (`aaa`…`d`, `nr`, `wd`) |
| `--vg-venue-<mic>-color` | venue chips |
| `--vg-bar-height`, `--vg-chip-height`, `--vg-chip-radius` | data-viz geometry |

A theme that declares none of these renders identically to the built-in defaults.

## 4. What stays in code

- **Data-viz geometry** — drawing a bar / heat fill / gauge is code; only its
  colours and dimensions come from CSS (§3).
- **Conditional predicates** — `@wellsfargo-starui/velocity-grid-rules` decides *when* a style applies
  (dynamic, per row value), authored via the rule-builder UI; the style values it
  applies target the same paint artifacts.
