/**
 * Cycle 21i Phase 2 / T5 — shared chrome styles for @cgrid/customizer
 * Lit components.
 *
 * Every value is a verbatim port of the kernel's `.cg-settings-*` rules
 * (packages/kernel/src/theming/tokens.css) — the G2 quality bar is that
 * a customizer panel is visually indistinguishable from the kernel's
 * native Grid Options chrome. Colors route through the same `--cg-*`
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
    font-family: var(--cg-font-family);
    font-size: var(--cg-font-size);
    color: var(--cg-fg-color);
    --cgc-accent: var(--cg-settings-accent, var(--cg-focus-ring-color));
  }
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;

/** Collapsible section band — mirrors .cg-settings-band*. */
export const bandStyles = css`
  :host {
    display: block;
    border-bottom: 1px solid color-mix(in srgb, var(--cg-border-color) 60%, transparent);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 10px 6px;
    font-family: var(--cg-font-family);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--cg-fg-color) 62%, transparent);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .header:hover {
    color: var(--cg-fg-color);
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

/** Field row — mirrors .cg-settings-row*. */
export const rowStyles = css`
  :host {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px 5px 12px;
  }
  :host(:hover) {
    background: var(--cg-row-hover-bg);
  }
  :host([modified])::before {
    content: '';
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 2px;
    border-radius: 1px;
    background: var(--cgc-accent);
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .label-text {
    font-size: var(--cg-font-size-sm);
    line-height: 1.35;
    cursor: default;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .hint {
    font-size: 10px;
    line-height: 1.3;
    color: color-mix(in srgb, var(--cg-fg-color) 50%, transparent);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .control {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }
`;

/** Toggle switch — mirrors .cg-settings-toggle*. */
export const switchStyles = css`
  :host {
    display: inline-flex;
  }
  button {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--cg-fg-color) 30%, transparent);
    border: none;
    cursor: pointer;
    padding: 0;
    flex: 0 0 auto;
    transition: background 120ms ease;
  }
  button[aria-checked='true'] {
    background: var(--cgc-accent);
  }
  button:focus-visible {
    outline: 2px solid var(--cg-focus-ring-color);
    outline-offset: 1px;
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--cg-bg-color);
    transition: transform 120ms ease;
  }
  button[aria-checked='true'] .knob {
    transform: translateX(12px);
  }
  @media (prefers-reduced-motion: reduce) {
    button,
    .knob {
      transition: none;
    }
  }
`;

/** Text-ish inputs (select / number) — mirrors .cg-settings-input*. */
export const inputStyles = css`
  select,
  input {
    padding: 3px 6px;
    font-size: var(--cg-font-size-sm);
    color: var(--cg-fg-color);
    background: color-mix(in srgb, var(--cg-fg-color) 5%, transparent);
    border: 1px solid var(--cg-border-color);
    border-radius: 4px;
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
    font-family: var(--cg-cell-font-family);
    text-align: right;
  }
`;
