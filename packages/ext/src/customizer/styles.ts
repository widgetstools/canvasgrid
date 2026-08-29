/**
 * Cycle 21i Phase 2 / T5 — shared chrome styles for @wellsfargo-starui/velocity-grid-ext/customizer
 * Lit components.
 *
 * Every value is a verbatim port of the kernel's `.vg-settings-*` rules
 * (packages/kernel/src/theming/tokens.css) — the G2 quality bar is that
 * a customizer panel is visually indistinguishable from the kernel's
 * native Grid Options chrome. Colors route through the same `--vg-*`
 * custom properties, which inherit across shadow boundaries, so light /
 * dark / high-contrast theming comes free; only the RULES are cloned
 * (kernel stylesheets can't pierce shadow DOM).
 *
 * If a kernel settings rule changes, change it here too — the
 * side-by-side screenshot check in T5/T6 verification is the guard.
 */
import { css } from 'lit';

/** Base typography + color inheritance every component starts from. */
export const chromeBase = css`
  :host {
    font-family: var(--vg-font-family);
    font-size: var(--vg-font-size);
    color: var(--vg-fg-color);
    --cgc-accent: var(--vg-chrome-accent);
  }
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;

/** Collapsible section band — mirrors .vg-settings-band*. */
export const bandStyles = css`
  :host {
    display: block;
  }
  :host(:not(:first-child)) {
    margin-top: 10px;
  }
  .header {
    /* 2026-08 look-and-feel — 16px gutter and a ground of its own. The
     * band header sat on a 10px gutter while its rows sat on 16px, so the
     * section title and the field labels under it started on different
     * left edges. A section is now visible without reading it. */
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 28px;
    padding: 0 16px;
    background: transparent;
    font-family: var(--vg-font-family);
    font-size: var(--vgext-eyebrow-size, 11px);
    font-weight: var(--vgext-eyebrow-weight, 600);
    letter-spacing: var(--vgext-eyebrow-track, 0.1em);
    text-transform: uppercase;
    color: color-mix(in srgb, var(--vg-fg-color) 62%, transparent);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .header:hover {
    color: var(--vg-fg-color);
  }
  .chevron {
    flex: 0 0 auto;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid currentColor;
    transition: transform 120ms ease;
  }
  .header[aria-expanded='false'] .chevron {
    transform: rotate(-90deg);
  }
  .title {
    flex: 1 1 auto;
  }
  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
`;

/** Field row — mirrors .vg-settings-row (vguiRowCss grammar). */
export const rowStyles = css`
  :host {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px 14px;
    align-items: center;
    /* No per-row divider — see the note on .vg-settings-row, which this
     * file deliberately clones. Sections are grouped by space. */
    padding: 7px 16px;
    min-height: 40px;
    margin: 0;
    box-sizing: border-box;
    transition: background 120ms ease;
  }
  :host(:hover) {
    background: var(--vg-row-hover-bg);
  }
  :host([modified]) {
    box-shadow: inset 2px 0 0 var(--cgc-accent);
  }
  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    /* Was 10px, which put the label 26px in while its band header sat at
     * 10px and the row edge at 16px — three left edges in one panel. */
    padding-left: 0;
  }
  .label-text {
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1.4;
    letter-spacing: 0;
    text-transform: none;
    cursor: default;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .hint {
    font-size: 11px;
    font-weight: 400;
    line-height: 1.45;
    letter-spacing: 0;
    text-transform: none;
    /* 50% of fg measured under AA for a line that has to be read. */
    color: color-mix(in srgb, var(--vg-fg-color) 62%, transparent);
  }
  .control {
    min-height: 28px;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
  }
`;

/** Canonical `.vg-checkbox` paint — cloned into shadow DOM. */
export const switchStyles = css`
  :host {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
  }
  .vg-checkbox {
    flex: 0 0 auto;
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin: 0;
    border: 1.5px solid color-mix(in srgb, var(--vg-fg-color) 40%, transparent);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    position: relative;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .vg-checkbox:hover {
    border-color: color-mix(in srgb, var(--vg-fg-color) 65%, transparent);
  }
  .vg-checkbox:checked {
    background: var(--cgc-accent, var(--vg-chrome-accent));
    border-color: var(--cgc-accent, var(--vg-chrome-accent));
  }
  .vg-checkbox:checked::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    box-sizing: border-box;
    width: 5px;
    height: 9px;
    border: solid var(--vg-bg-color);
    border-width: 0 2px 2px 0;
    transform: translate(-50%, -58%) rotate(45deg);
  }
  .vg-checkbox:focus-visible {
    outline: 2px solid var(--vg-focus-ring-color);
    outline-offset: 1px;
  }
`;

/** Text-ish inputs (select / number) — mirrors .vg-settings-input*. */
export const inputStyles = css`
  /* 2026-08 look-and-feel — these measured ~22px against a 28px product.
   * They now stand on the same control rung as every other input in the
   * chrome, with a border that identifies them as controls:
   * --vg-line-control clears WCAG 1.4.11's 3:1 for a UI component
   * boundary, where --vg-border-color measured 1.09:1 against its own
   * fill — the edge that identifies a control did not identify it. */
  select,
  input {
    height: 28px;
    box-sizing: border-box;
    padding: 0 10px;
    font-size: 12px;
    color: var(--vg-input-fg, var(--vg-fg-color));
    background: var(--vg-input-bg, color-mix(in srgb, var(--vg-fg-color) 5%, transparent));
    border: 1px solid var(--vg-line-control, var(--vg-border-color));
    border-radius: var(--vg-radius, 2px);
    outline: none;
  }
  select:focus,
  input:focus {
    border-color: var(--cgc-accent);
  }
  select:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--cgc-accent);
    outline-offset: 1px;
  }
  select {
    min-width: 140px;
    max-width: 100%;
    font-family: inherit;
    cursor: pointer;
  }
  input[type='number'] {
    width: 80px;
    font-family: var(--vg-cell-font-family);
    text-align: right;
  }
`;
