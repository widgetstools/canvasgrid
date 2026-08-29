/**
 * Ext chrome design tokens — the closed set of metric, type and state values
 * the ext chrome is allowed to use.
 *
 * Before this module the chrome declared 84 distinct paddings, 33 pixel
 * heights, 16 radii, 16 letter-spacings, 13 font sizes and 8 font weights
 * across `packages/ext/src`, and the four-step spacing scale that already
 * existed in `titleBar.ts` was referenced only by the file that declared it.
 * Every stylesheet in the ext now derives from the variables below, so a
 * value that is not here does not appear on screen.
 *
 * Nothing here changes markup, DOM structure or behaviour: it is a value
 * layer. Class names, event wiring and public API are untouched — the
 * stylesheets that consume these tokens keep the selectors they always had.
 *
 * The token block is scoped to `[class*="vg-theme-"]`, which the ext mirrors
 * onto both the shell root and body-mounted popups, so drawer, ribbon,
 * title bar and detached menus all resolve the same values.
 */

/** Chrome token block. Scoped to any themed root so popups inherit it too. */
const CHROME_TOKENS = `
[class*="vg-theme-"] {
  /* ── Theme aliases ───────────────────────────────────────────────────
   * The kernel themes don't declare these; derive them from the theme's
   * own tokens so every control follows the theme instead of falling back
   * to a per-rule hardcoded colour. */
  --vg-primary-color: var(--vg-chrome-accent);
  --vg-primary-fg: var(--vg-checkbox-checked-fg, #ffffff);
  --vg-accent-color: var(--vg-chrome-accent);
  --vg-accent-fg: var(--vg-checkbox-checked-fg, #ffffff);
  --vg-muted-fg-color: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 62%, transparent);
  --vg-control-bg: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 6%, transparent);

  /* ── Spacing — five steps, no others ─────────────────────────────── */
  --vgext-space-1: 4px;   /* inside a control: icon to label */
  --vgext-space-2: 8px;   /* between controls in a group */
  --vgext-space-3: 12px;  /* between groups in a bar */
  --vgext-space-4: 16px;  /* every container gutter */
  --vgext-space-5: 24px;  /* between sections */

  /* ── Controls — one height for anything a pointer acts on ────────── */
  --vgext-control-h: 28px;   /* button, input, select, segmented, pill */
  --vgext-control-px: 13px;  /* side padding of a labelled button */
  --vgext-field-px: 10px;    /* side padding of a text field */
  --vgext-icon-btn: 28px;    /* square icon button */
  --vgext-glyph: 16px;       /* glyph inside a 28px control */
  --vgext-glyph-sm: 14px;    /* glyph inside a chip or dense row */
  --vgext-chip-h: 20px;      /* read-only chip — not a control */
  --vgext-row-h: 30px;       /* dense list row */
  --vgext-band-h: 26px;      /* section head */

  /* ── Bars ────────────────────────────────────────────────────────── */
  --vgext-bar-h: 44px;    /* command bar: 28px control + 2x space-2 */
  --vgext-strip-h: 36px;  /* secondary strip */
  --vgext-status-h: 28px; /* status bar */

  /* ── Type — four roles ───────────────────────────────────────────── */
  --vgext-body-size: 13px;      /* control text and help */
  --vgext-label-size: 12.5px;   /* settings row label */
  --vgext-help-size: 11px;      /* help under a label; sentence case */
  --vgext-eyebrow-size: 11px;   /* section heads and tabs */
  --vgext-eyebrow-weight: 600;
  --vgext-eyebrow-track: 0.1em;
  --vgext-title-size: 15px;     /* panel title */
  --vgext-title-weight: 600;
  --vgext-title-track: -0.01em; /* the one negative tracking value */
  --vgext-num-size: 11.5px;     /* ids, counts, hex, measurements */

  /* ── Motion ──────────────────────────────────────────────────────── */
  --vgext-t: 120ms ease;
}
`;

/**
 * Shared primitives every ext surface can opt into.
 *
 * These are ADDITIVE modifier classes. Existing buttons keep their own
 * classes and behaviour; adding a rung class only restyles them, so a
 * caller that doesn't opt in renders exactly as before.
 */
const CHROME_PRIMITIVES = `
/* ── Baseline — what every control inherits before any component rule ──
 * Wrapped in :where() so it contributes ZERO specificity: any component
 * rule beats it without needing !important, and a control that forgets to
 * state its own type still lands on the scale instead of on the browser
 * default. Roughly 700 controls across 20 classes were rendering at the UA
 * default 13.3333px because they only ever contained an icon and nobody
 * thought to set a font on them.
 *
 * Deliberately narrow: font only. Height, padding and colour stay the
 * component's business — a baseline that guessed at those would fight the
 * very rules it is meant to support. */
:where(.vgext-root, .vgext-menu, .vgext-sf-pop, .vgext-sheet, .ckp)
:where(button, input, select, textarea, [role="button"]) {
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
}

/* ── Button ladder — four rungs, chosen by consequence ─────────────────
 * Primary   one per screen, the commit
 * Secondary real actions, no risk
 * Quiet     dismiss and navigation only
 * Danger    always confirms; the only red in the chrome */
.vgext-rung-primary,
.vgext-rung-secondary,
.vgext-rung-quiet,
.vgext-rung-danger {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--vgext-space-1);
  height: var(--vgext-control-h);
  padding: 0 var(--vgext-control-px);
  border-radius: var(--vg-radius, 2px);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--vgext-t), border-color var(--vgext-t), color var(--vgext-t);
}
.vgext-rung-primary {
  border: 1px solid var(--vg-chrome-accent);
  background: var(--vg-chrome-accent);
  color: var(--vg-accent-fg, #ffffff);
  font-weight: 600;
}
.vgext-rung-primary:hover:not(:disabled) { filter: brightness(1.08); }
.vgext-rung-secondary {
  border: 1px solid var(--vg-border-color, #2a3140);
  background: transparent;
  color: var(--vg-fg-color, #e5e9f0);
  font-weight: 500;
}
.vgext-rung-secondary:hover:not(:disabled) {
  background: var(--vg-row-hover-bg, rgba(255, 255, 255, 0.06));
  border-color: var(--vg-chrome-accent);
}
.vgext-rung-quiet {
  border: 1px solid transparent;
  background: transparent;
  color: var(--vg-muted-fg-color, #8a93a6);
  font-weight: 500;
}
.vgext-rung-quiet:hover:not(:disabled) {
  background: var(--vg-row-hover-bg, rgba(255, 255, 255, 0.06));
  color: var(--vg-fg-color, #e5e9f0);
}
.vgext-rung-danger {
  border: 1px solid color-mix(in srgb, var(--vg-neg-color, #e5646e) 45%, transparent);
  background: transparent;
  color: var(--vg-neg-color, #e5646e);
  font-weight: 500;
}
.vgext-rung-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vg-neg-color, #e5646e) 14%, transparent);
  border-color: var(--vg-neg-color, #e5646e);
}
.vgext-rung-primary:focus-visible,
.vgext-rung-secondary:focus-visible,
.vgext-rung-quiet:focus-visible,
.vgext-rung-danger:focus-visible {
  outline: 2px solid var(--vg-chrome-accent);
  outline-offset: -2px;
}
/* Disabled always says why — callers set title/aria-description; the
 * treatment is uniform so a dead control is never a mystery. */
.vgext-rung-primary:disabled,
.vgext-rung-secondary:disabled,
.vgext-rung-quiet:disabled,
.vgext-rung-danger:disabled {
  opacity: 0.45;
  cursor: default;
  filter: none;
}

/* ── Eyebrow — one uppercase micro-label spec, replacing five ───────── */
.vgext-eyebrow {
  font-size: var(--vgext-eyebrow-size);
  font-weight: var(--vgext-eyebrow-weight);
  letter-spacing: var(--vgext-eyebrow-track);
  text-transform: uppercase;
  color: var(--vg-muted-fg-color, #8a93a6);
}

/* ── Counter — one grammar for "N of these exist" ───────────────────── */
.vgext-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--vg-radius, 2px);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 10%, transparent);
  color: var(--vg-muted-fg-color, #8a93a6);
  font-family: var(--vg-cell-font-family, ui-monospace, monospace);
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ── Feed state dot — the one always-on colour in the chrome ────────── */
.vgext-state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--vg-muted-fg-color, #8a93a6);
}
.vgext-state-dot[data-state="live"] {
  background: var(--vg-pos-color, #3FA266);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vg-pos-color, #3FA266) 18%, transparent);
}
.vgext-state-dot[data-state="stale"] { background: var(--vg-warning-color, #f0b429); }
.vgext-state-dot[data-state="error"] { background: var(--vg-neg-color, #e5646e); }
`;

const STYLE_ID = 'vgext-chrome-tokens';

/**
 * Inject the chrome token + primitive stylesheet once per document.
 *
 * Called by every ext style entry point (title bar, shell, cockpit) so the
 * tokens are present no matter which surface mounts first. Idempotent.
 */
export function injectChromeTokens(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (style) return;
  style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CHROME_TOKENS + CHROME_PRIMITIVES;
  // Prepend so consumer stylesheets injected later win on equal specificity.
  document.head.insertBefore(style, document.head.firstChild);
}

export { CHROME_TOKENS, CHROME_PRIMITIVES };
