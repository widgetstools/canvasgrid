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
    border-bottom: 1px solid color-mix(in srgb, var(--vg-border-color) 60%, transparent);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 10px 6px;
    font-family: var(--vg-font-family);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
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
    padding: 9px 16px;
    margin: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--vg-border-color) 70%, transparent);
    transition: background 120ms ease, border-color 120ms ease;
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
    padding-left: 10px;
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
    color: color-mix(in srgb, var(--vg-fg-color) 50%, transparent);
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
  select,
  input {
    padding: 3px 6px;
    font-size: var(--vg-font-size-sm);
    color: var(--vg-fg-color);
    background: color-mix(in srgb, var(--vg-fg-color) 5%, transparent);
    border: 1px solid var(--vg-border-color);
    border-radius: 2px;
    outline: none;
  }
  select:focus,
  input:focus {
    border-color: var(--cgc-accent);
  }
  select {
    max-width: 130px;
    font-family: inherit;
    cursor: pointer;
  }
  input[type='number'] {
    width: 72px;
    font-family: var(--vg-cell-font-family);
    text-align: right;
  }
`;
