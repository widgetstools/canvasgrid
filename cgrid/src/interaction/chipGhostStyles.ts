/**
 * Shared helper for the row-group + pivot panel drag ghosts.
 *
 * Both panels mount their drag ghost on `document.body` with
 * `position: fixed`. The ghost is a `cloneNode(true)` of the source
 * chip / pill, so it inherits the same class list. The chip CSS,
 * however, resolves values through panel-scoped CSS variables
 * (`--cg-row-group-chip-bg`, `--cg-row-group-chip-border`, etc.)
 * defined under `.cg-row-group-panel` / `.cg-pivot-panel`. Outside
 * those parents — i.e. on `document.body` — the variables are
 * `undefined`, and the ghost renders as bare text (no bg, no border).
 *
 * `copyResolvedChipStyles` reads the source chip's COMPUTED style
 * (which has all variables resolved against its panel ancestry) and
 * applies the visible bits inline on the ghost. The ghost then
 * renders identically regardless of where it lives in the DOM.
 *
 * Why inline and not `var(...)`? `getComputedStyle` returns the
 * resolved final value (e.g. `rgb(...)`), so the ghost no longer
 * needs the variables. This keeps the ghost self-contained.
 */

/** Copy the chip's resolved bg / border / radius / fg / font / padding
 *  from `source` into `ghost.style.*` as inline declarations. */
export function copyResolvedChipStyles(source: HTMLElement, ghost: HTMLElement): void {
  const cs = getComputedStyle(source);
  // Background + border — the two values the missing CSS variables
  // were responsible for. Without these the ghost is transparent +
  // borderless on document.body.
  ghost.style.background = cs.background;
  ghost.style.color = cs.color;
  ghost.style.borderTop = cs.borderTop;
  ghost.style.borderRight = cs.borderRight;
  ghost.style.borderBottom = cs.borderBottom;
  ghost.style.borderLeft = cs.borderLeft;
  ghost.style.borderRadius = cs.borderRadius;
  // Layout / typography — keep the ghost the same shape as the source.
  ghost.style.padding = cs.padding;
  ghost.style.fontFamily = cs.fontFamily;
  ghost.style.fontSize = cs.fontSize;
  ghost.style.fontWeight = cs.fontWeight;
  ghost.style.lineHeight = cs.lineHeight;
  ghost.style.gap = cs.gap;
  // Recopy display / alignment so the inline-flex layout survives the
  // jump to document.body (where the parent isn't a flex container).
  ghost.style.display = cs.display;
  ghost.style.alignItems = cs.alignItems;
}
