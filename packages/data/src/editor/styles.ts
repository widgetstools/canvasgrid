/**
 * Provider editor styles — driven by VelocityGrid `--vg-*` theme tokens so
 * the panel tracks dark / light (and custom) themes when mounted under
 * VelocityGridExt chrome. Fallbacks lean light for standalone / popout hosts.
 *
 * Primitive controls (switch, caps label, input focus ring) source their look
 * from the shared kernel primitives so this kit and the ext cockpit kit can't
 * drift; passing the `--vg-dp-*` aliases reproduces this kit's exact rendering.
 */
import {
  vguiSwitchCss,
  vguiCapsCss,
  vguiInputInteractionCss,
  type VguiTokens,
} from '@wellsfargo-starui/velocity-grid/ui/primitives';

const DP_TOKENS: VguiTokens = {
  accent: 'var(--vg-dp-accent)',
  border: 'var(--vg-dp-border)',
  muted: 'var(--vg-dp-muted)',
  surface: 'var(--vg-dp-input-bg)',
  radius: 'var(--vg-dp-radius)',
};

export const EDITOR_CSS = `
.vg-dp-editor,
.vg-dp-shell {
  --vg-dp-fg: var(--vg-fg-color, #1a1f24);
  --vg-dp-muted: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
  --vg-dp-border: var(--vg-border-color, #c5d0d8);
  --vg-dp-accent: var(--vg-primary-color, var(--vg-accent-color, var(--vg-chrome-accent, #4f9cf9)));
  --vg-dp-accent-fg: var(--vg-primary-fg, var(--vg-accent-fg, #ffffff));
  --vg-dp-bg: var(--vg-popup-bg, var(--vg-bg-color, var(--vg-header-bg, #f3f6f8)));
  --vg-dp-panel: color-mix(in srgb, var(--vg-dp-fg) 4%, var(--vg-dp-bg));
  --vg-dp-input-bg: var(--vg-input-bg, color-mix(in srgb, var(--vg-dp-fg) 3%, var(--vg-dp-bg)));
  --vg-dp-radius: var(--vg-radius, 2px);
  --vg-dp-card: color-mix(in srgb, var(--vg-dp-fg) 3%, var(--vg-dp-bg));
  --vg-dp-row-sel: color-mix(in srgb, var(--vg-dp-accent) 18%, var(--vg-dp-bg));

  font-family: var(--vg-font-family, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  font-size: 13px;
  color: var(--vg-dp-fg);
  background: var(--vg-dp-bg);
  color-scheme: inherit;
}

.vg-dp-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 0;
}
.vg-dp-shell * { box-sizing: border-box; }

.vg-dp-shell__sidebar {
  width: 288px;
  flex-shrink: 0;
  border-right: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.vg-dp-shell__sidebar-head {
  padding: 12px;
  border-bottom: 1px solid var(--vg-dp-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vg-dp-shell__sidebar-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.vg-dp-shell__sidebar-title-row h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.vg-dp-shell__sidebar-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.vg-dp-shell__sidebar-head input[type="search"] {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  font: inherit;
  font-size: 12px;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vg-dp-shell__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}
.vg-dp-shell__ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vg-dp-shell__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 10px;
  border-radius: var(--vg-dp-radius);
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 110ms ease, border-color 110ms ease;
}
.vg-dp-shell__row:hover { background: color-mix(in srgb, var(--vg-dp-fg) 6%, transparent); }
.vg-dp-shell__row.is-selected {
  background: var(--vg-dp-row-sel);
  border-left-color: var(--vg-dp-accent);
}
.vg-dp-shell__row-meta { flex: 1; min-width: 0; }
.vg-dp-shell__row-name {
  font-weight: 600;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vg-dp-shell__row-sub {
  font-size: 10px;
  color: var(--vg-dp-muted);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.vg-dp-shell__badge {
  display: inline-flex;
  align-items: center;
  height: 14px;
  padding: 0 5px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  font-size: 9px;
  line-height: 1;
  color: var(--vg-dp-muted);
}
.vg-dp-shell__row-tools {
  display: flex;
  gap: 2px;
  opacity: 0;
}
.vg-dp-shell__row:hover .vg-dp-shell__row-tools,
.vg-dp-shell__row.is-selected .vg-dp-shell__row-tools { opacity: 1; }
.vg-dp-shell__row-tools button,
.vg-dp-shell__row-tools .vg-dp-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--vg-dp-muted);
  cursor: pointer;
  padding: 2px 4px;
  font: inherit;
  font-size: 12px;
}
.vg-dp-shell__row-tools button:hover,
.vg-dp-shell__row-tools .vg-dp-btn:hover { color: var(--vg-dp-fg); }
.vg-dp-shell__empty,
.vg-dp-shell__empty-main {
  color: var(--vg-dp-muted);
  font-size: 12px;
  padding: 12px 8px;
}
.vg-dp-shell__empty-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 32px;
}
.vg-dp-shell__empty-main h2 {
  margin: 0;
  font-size: 16px;
  color: var(--vg-dp-fg);
}
.vg-dp-shell__empty-main p { margin: 0; max-width: 28rem; }
.vg-dp-shell__main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.vg-dp-shell__form {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.vg-dp-shell__form .vg-dp-editor {
  max-width: none;
  min-height: 0;
  height: 100%;
  border: 0;
  border-radius: 0;
}

/* Generic button chrome — excludes .vg-dp-switch, which is a <button> but owns
   its full pill styling (otherwise this rule's specificity overrides the
   switch on-state track fill). */
.vg-dp-shell button:not(.vg-dp-switch),
.vg-dp-shell .vg-dp-btn,
.vg-dp-editor button[type="button"]:not(.vg-dp-editor__tab):not(.vg-dp-editor__actions button):not(.vg-dp-switch),
.vg-dp-editor .vg-dp-btn:not(.vg-dp-editor__tab) {
  appearance: none;
  border: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  padding: 5px 10px;
  border-radius: var(--vg-dp-radius);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  transition: color 110ms ease, background 110ms ease, border-color 110ms ease;
}
.vg-dp-shell button.primary,
.vg-dp-shell .vg-dp-btn--primary,
.vg-dp-shell__empty-main button.primary,
.vg-dp-shell__empty-main .vg-dp-btn--primary {
  background: var(--vg-dp-accent);
  color: var(--vg-dp-accent-fg);
  border-color: transparent;
}
.vg-dp-shell button:not(.vg-dp-switch):hover,
.vg-dp-shell .vg-dp-btn:hover:not(:disabled) { border-color: var(--vg-dp-accent); }

.vg-dp-btn--secondary,
.vg-dp-btn.secondary {
  background: transparent;
  color: var(--vg-dp-fg);
}
.vg-dp-btn--ghost {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}
.vg-dp-btn--danger,
.vg-dp-btn.destructive,
.vg-dp-modal__footer button.destructive {
  background: color-mix(in srgb, #dc2626 88%, var(--vg-dp-bg));
  color: #fff;
  border-color: transparent;
}
.vg-dp-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.vg-dp-search {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  font: inherit;
  font-size: 12px;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vg-dp-badge--outline {
  background: transparent;
  border-color: var(--vg-dp-border);
}
.vg-dp-badge--accent {
  border-color: color-mix(in srgb, var(--vg-dp-accent) 55%, var(--vg-dp-border));
  color: var(--vg-dp-accent);
  background: color-mix(in srgb, var(--vg-dp-accent) 12%, transparent);
}

.vg-dp-editor {
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  display: flex;
  flex-direction: column;
  min-height: 420px;
  max-width: 960px;
}
.vg-dp-editor * { box-sizing: border-box; }
.vg-dp-editor__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-panel);
  flex-shrink: 0;
}
.vg-dp-editor__header-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.vg-dp-editor__header-name {
  width: 13rem;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vg-dp-editor__header-desc {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vg-dp-editor__header-public {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 4px;
  flex-shrink: 0;
}
.vg-dp-editor__brand {
  font-family: inherit;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--vg-dp-fg);
}
.vg-dp-editor__header input,
.vg-dp-editor__header textarea {
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  font: inherit;
  resize: vertical;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vg-dp-editor__header input::placeholder,
.vg-dp-editor__header textarea::placeholder {
  color: var(--vg-dp-muted);
  opacity: 0.85;
}
.vg-dp-editor__tabs {
  display: flex;
  gap: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--vg-dp-border);
  background: color-mix(in srgb, var(--vg-dp-panel) 80%, transparent);
  flex-shrink: 0;
}
.vg-dp-editor__tab {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 10px 14px;
  cursor: pointer;
  color: var(--vg-dp-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  transition: color 110ms ease, border-color 110ms ease;
}
.vg-dp-editor__tab:hover { color: var(--vg-dp-fg); }
.vg-dp-editor__tab[aria-selected="true"] {
  color: var(--vg-dp-accent);
  border-bottom-color: var(--vg-dp-accent);
  font-weight: 650;
}
.vg-dp-editor__body {
  padding: 16px;
  flex: 1;
  overflow: auto;
  min-height: 0;
}
/* Columns tab owns its own scroll region so the table can fill the viewport. */
.vg-dp-editor__body:has(> .vg-dp-editor__columns-tab) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 12px;
}
.vg-dp-editor__grid {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 8px 12px;
  align-items: center;
  max-width: 640px;
}
.vg-dp-editor__grid label { color: var(--vg-dp-muted); }
.vg-dp-editor__grid input,
.vg-dp-editor__grid select,
.vg-dp-editor__grid textarea,
.vg-dp-field input,
.vg-dp-field select,
.vg-dp-field textarea,
.vg-dp-editor__inline-actions input {
  padding: 6px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  width: 100%;
  font: inherit;
  color-scheme: inherit;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vg-dp-editor__header input,
.vg-dp-shell__sidebar-head input[type="search"] {
  color-scheme: inherit;
}
/* Shared hover + accent focus ring from the kernel primitive (same treatment
   as the ext cockpit input). Base box geometry stays on the rules above. */
${vguiInputInteractionCss([
  '.vg-dp-editor__grid input',
  '.vg-dp-editor__grid select',
  '.vg-dp-editor__grid textarea',
  '.vg-dp-field input',
  '.vg-dp-field select',
  '.vg-dp-field textarea',
  '.vg-dp-editor__inline-actions input',
  '.vg-dp-editor__header input',
  '.vg-dp-editor__header textarea',
  '.vg-dp-shell__sidebar-head input[type="search"]',
  '.vg-dp-editor__fields-toolbar input[type="search"]',
  '.vg-dp-search',
], DP_TOKENS)}
.vg-dp-mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.vg-dp-editor__grid input[type="checkbox"] {
  width: auto;
  accent-color: var(--vg-dp-accent);
}
.vg-dp-editor__grid select,
.vg-dp-field select { color-scheme: inherit; }
.vg-dp-editor__inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.vg-dp-editor__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-panel);
  flex-shrink: 0;
}
.vg-dp-editor__actions-left {
  font-size: 12px;
  color: var(--vg-dp-muted);
  min-width: 0;
}
.vg-dp-editor__actions-left.is-saved {
  color: color-mix(in srgb, #16a34a 80%, var(--vg-dp-fg));
}
.vg-dp-editor__actions-left.is-error {
  color: color-mix(in srgb, #dc2626 85%, var(--vg-dp-fg));
}
.vg-dp-editor__actions-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.vg-dp-editor__actions button {
  appearance: none;
  border: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  padding: 8px 14px;
  border-radius: var(--vg-dp-radius);
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition: color 110ms ease, background 110ms ease, border-color 110ms ease, filter 110ms ease;
}
.vg-dp-editor__actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.vg-dp-editor__actions button.primary,
.vg-dp-editor__actions .vg-dp-btn--primary {
  border-color: transparent;
  background: var(--vg-dp-accent);
  color: var(--vg-dp-accent-fg);
  min-width: 180px;
}
.vg-dp-editor__actions button.primary:hover:not(:disabled),
.vg-dp-editor__actions .vg-dp-btn--primary:hover:not(:disabled) { filter: brightness(1.08); }
.vg-dp-editor__actions button.secondary,
.vg-dp-editor__actions .vg-dp-btn--secondary {
  background: transparent;
  color: var(--vg-dp-fg);
}
.vg-dp-editor__actions button.secondary:hover:not(:disabled),
.vg-dp-editor__actions .vg-dp-btn--secondary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vg-dp-accent) 12%, transparent);
  border-color: var(--vg-dp-accent);
  color: var(--vg-dp-accent);
  filter: none;
}
.vg-dp-editor table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  color: var(--vg-dp-fg);
}
.vg-dp-editor th {
  color: var(--vg-dp-muted);
  font-weight: 600;
}
.vg-dp-editor th, .vg-dp-editor td {
  border-bottom: 1px solid var(--vg-dp-border);
  padding: 6px 8px;
  text-align: left;
}
.vg-dp-editor tbody tr:nth-child(even) {
  background: var(--vg-row-alt-bg, color-mix(in srgb, var(--vg-dp-fg) 3%, transparent));
}
.vg-dp-editor__status {
  font-variant-numeric: tabular-nums;
  color: var(--vg-dp-muted);
  margin-left: auto;
}
.vg-dp-editor__preview {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11px;
  background: color-mix(in srgb, var(--vg-dp-fg) 92%, var(--vg-dp-bg));
  color: color-mix(in srgb, var(--vg-dp-bg) 88%, var(--vg-dp-fg));
  border: 1px solid var(--vg-dp-border);
  padding: 12px;
  border-radius: var(--vg-dp-radius);
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
}
.vg-dp-editor button[type="button"]:not(.vg-dp-editor__tab):not(.vg-dp-editor__actions button):not(.vg-dp-switch):hover {
  border-color: var(--vg-dp-accent);
  color: var(--vg-dp-accent);
}

.vg-dp-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
}
.vg-dp-card {
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-card);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vg-dp-card__title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vg-dp-fg);
}
/* Trailing hairline rule — matches the ext cockpit band header (TITLE ────). */
.vg-dp-card__title::after {
  content: "";
  flex: 1 1 auto;
  height: 1px;
  background: var(--vg-dp-border);
}
.vg-dp-field { display: flex; flex-direction: column; gap: 6px; }
${vguiCapsCss('.vg-dp-field__label', DP_TOKENS)}
.vg-dp-field__help {
  margin: 0;
  font-size: 11px;
  color: var(--vg-dp-muted);
  line-height: 1.45;
}
.vg-dp-muted { color: var(--vg-dp-muted); }
.vg-dp-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vg-dp-muted);
}

/* Switch toggle — geometry + states from the shared kernel primitive so this
   kit and the ext cockpit switch (.ckp-switch) can't drift. */
${vguiSwitchCss({ root: 'vg-dp-switch', knob: 'vg-dp-switch__knob', on: 'is-on' }, DP_TOKENS)}
.vg-dp-editor__switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Connection test strip */
.vg-dp-editor__connection {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.vg-dp-editor__connection-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.vg-dp-editor__test-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0 0;
  margin-top: 12px;
  border-top: 1px solid var(--vg-dp-border);
  flex-shrink: 0;
}
.vg-dp-editor__test-pill {
  font-size: 12px;
  color: var(--vg-dp-muted);
}
.vg-dp-editor__test-pill.is-ok {
  color: color-mix(in srgb, #16a34a 80%, var(--vg-dp-fg));
}
.vg-dp-editor__test-pill.is-error {
  color: color-mix(in srgb, #dc2626 85%, var(--vg-dp-fg));
}

/* Fields tab */
.vg-dp-editor__fields-tab,
.vg-dp-editor__columns-tab,
.vg-dp-editor__diagnostics {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.vg-dp-editor__columns-tab {
  flex: 1;
  height: 100%;
}
.vg-dp-editor__columns-tab > .vg-dp-card,
.vg-dp-editor__columns-tab > .vg-dp-editor__columns-toolbar,
.vg-dp-editor__columns-tab > .vg-dp-editor__rows-footer {
  flex-shrink: 0;
}
.vg-dp-editor__fields-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 40px 24px;
  color: var(--vg-dp-muted);
}
.vg-dp-editor__fields-empty h3 {
  margin: 0;
  font-size: 14px;
  color: var(--vg-dp-fg);
}
.vg-dp-editor__fields-empty p { margin: 0; max-width: 22rem; font-size: 12px; }
.vg-dp-editor__fields-empty-icon {
  font-size: 28px;
  opacity: 0.45;
  line-height: 1;
}
.vg-dp-editor__inference-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--vg-dp-border);
}
.vg-dp-editor__inference-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--vg-dp-muted);
}
.vg-dp-editor__fields-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vg-dp-editor__fields-toolbar input[type="search"] {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  font: inherit;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vg-dp-editor__select-all {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.vg-dp-editor__select-all input { width: auto; accent-color: var(--vg-dp-accent); }
.vg-dp-editor__field-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow: auto;
}
.vg-dp-editor__key-select { width: 100%; max-width: 36rem; }
.vg-dp-editor__key-composite {
  margin: 6px 0 0;
  font-size: 10px;
  color: var(--vg-dp-muted);
}
.vg-dp-field__help code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10px;
  color: var(--vg-dp-fg);
}

/* MultiSelect dropdown (key columns) */
.vg-dp-ms {
  position: relative;
  width: 100%;
}
.vg-dp-ms__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  font: inherit;
  cursor: pointer;
  text-align: left;
  color-scheme: inherit;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vg-dp-ms__trigger:hover { border-color: var(--vg-dp-accent); }
.vg-dp-ms__trigger:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--vg-dp-accent) 70%, var(--vg-dp-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vg-dp-accent) 16%, transparent);
}
.vg-dp-ms__trigger:disabled {
  opacity: 0.55;
  cursor: default;
}
.vg-dp-ms__chips {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.vg-dp-ms__placeholder {
  font-size: 12px;
  color: var(--vg-dp-muted);
}
.vg-dp-ms__chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--vg-dp-radius);
  background: color-mix(in srgb, var(--vg-dp-fg) 8%, transparent);
  font-size: 11px;
  text-transform: none;
}
.vg-dp-ms__chip-x {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--vg-dp-muted);
  cursor: pointer;
  padding: 0 2px;
  font: inherit;
  line-height: 1;
}
.vg-dp-ms__chip-x:hover { color: var(--vg-dp-fg); }
.vg-dp-ms__caret {
  color: var(--vg-dp-muted);
  font-size: 10px;
  flex-shrink: 0;
}
.vg-dp-ms__panel {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-bg);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--vg-dp-fg) 18%, transparent);
  overflow: hidden;
}
.vg-dp-ms__search {
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  font: inherit;
  font-size: 12px;
  color-scheme: inherit;
  outline: none;
}
.vg-dp-ms__options {
  max-height: 220px;
  overflow: auto;
  padding: 4px;
}
.vg-dp-ms__empty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--vg-dp-muted);
}
.vg-dp-ms__option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--vg-dp-radius);
  background: transparent;
  color: var(--vg-dp-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.vg-dp-ms__option:hover {
  background: color-mix(in srgb, var(--vg-dp-fg) 6%, transparent);
}
.vg-dp-ms__check {
  width: 14px;
  flex-shrink: 0;
  color: var(--vg-dp-accent);
  font-size: 12px;
}
.vg-dp-ms__hint {
  margin-left: auto;
  font-size: 10px;
  text-transform: uppercase;
  color: var(--vg-dp-muted);
}
.vg-dp-editor__field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--vg-dp-radius);
  font-size: 12px;
  cursor: pointer;
}
.vg-dp-editor__field-row:hover {
  background: color-mix(in srgb, var(--vg-dp-fg) 5%, transparent);
}
.vg-dp-editor__field-row input { width: auto; accent-color: var(--vg-dp-accent); }
.vg-dp-editor__sample-size { width: auto; min-width: 6rem; }
.vg-dp-editor__error {
  margin: 0;
  font-size: 11px;
  color: color-mix(in srgb, #dc2626 85%, var(--vg-dp-fg));
}
.vg-dp-editor__columns-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.vg-dp-editor__columns-scroll {
  flex: 1 1 auto;
  min-height: 140px;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-bg);
}
.vg-dp-editor__columns-table {
  width: max(100%, max-content);
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  color: var(--vg-dp-fg);
}
.vg-dp-editor__columns-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--vg-dp-panel);
  color: var(--vg-dp-muted);
  font-weight: 600;
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vg-dp-border);
  box-shadow: 0 1px 0 var(--vg-dp-border);
  white-space: nowrap;
}
.vg-dp-editor__columns-table tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--vg-dp-border);
  vertical-align: middle;
  white-space: nowrap;
}
.vg-dp-editor__columns-table tbody tr:nth-child(even) td {
  background: var(--vg-row-alt-bg, color-mix(in srgb, var(--vg-dp-fg) 3%, transparent));
}
.vg-dp-editor__columns-table tbody tr:nth-child(odd) td {
  background: var(--vg-dp-bg);
}
.vg-dp-editor__columns-table td input,
.vg-dp-editor__columns-table td select {
  min-width: 8rem;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  font: inherit;
  color-scheme: inherit;
}
.vg-dp-editor__columns-actions-col,
.vg-dp-editor__col-actions {
  width: 1%;
  white-space: nowrap;
}
.vg-dp-editor__col-actions {
  display: flex;
  gap: 4px;
}
.vg-dp-editor__rows-footer {
  font-size: 11px;
  color: var(--vg-dp-muted);
}

/* Diagnostics */
.vg-dp-editor__diag-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0 12px;
  border-bottom: 1px solid var(--vg-dp-border);
}
.vg-dp-editor__diag-bar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vg-dp-editor__diag-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vg-dp-editor__diag-error {
  border: 1px solid color-mix(in srgb, #c0392b 45%, var(--vg-dp-border));
  background: color-mix(in srgb, #c0392b 12%, transparent);
  color: #c0392b;
  border-radius: var(--vg-dp-radius);
  padding: 8px 10px;
  font-size: 12px;
}
.vg-dp-editor__stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}
.vg-dp-editor__stat-label {
  font-size: 11px;
  color: var(--vg-dp-muted);
}
.vg-dp-editor__stat-value {
  font-size: 13px;
  font-weight: 500;
  margin-top: 2px;
}

/* Modal overlay (New / Delete) */
.vg-dp-modal-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: color-mix(in srgb, var(--vg-dp-fg) 35%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.vg-dp-modal {
  width: min(420px, 100%);
  background: var(--vg-dp-bg);
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  box-shadow: 0 12px 40px color-mix(in srgb, var(--vg-dp-fg) 25%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
}
.vg-dp-modal__header {
  padding: 16px 18px 8px;
}
.vg-dp-modal__header h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.vg-dp-modal__header p {
  margin: 0;
  font-size: 12px;
  color: var(--vg-dp-muted);
  line-height: 1.45;
}
.vg-dp-modal__body { padding: 8px 18px 12px; }
.vg-dp-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-panel);
}
.vg-dp-shell { position: relative; }
`;

let injected = false;
export function ensureEditorStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.head.querySelector('style[data-vg-dp-editor]');
  if (existing) {
    existing.textContent = EDITOR_CSS;
    injected = true;
    return;
  }
  if (injected) return;
  injected = true;
  const el = document.createElement('style');
  el.setAttribute('data-vg-dp-editor', '');
  el.textContent = EDITOR_CSS;
  document.head.appendChild(el);
}
