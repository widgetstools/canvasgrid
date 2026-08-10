/**
 * Provider editor styles — Markets Customize drawer / cockpit visual language.
 *
 * Tokens mirror the ext cockpit kit (`--ckp-*`): softened borders, accent-first
 * chrome, transparent surface washes. Primitive controls (switch, caps label,
 * input focus ring) come from the shared kernel generators so this kit and the
 * cockpit kit can't drift.
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
  surface: 'var(--vg-dp-surface)',
  radius: 'var(--vg-dp-radius)',
};

export const EDITOR_CSS = `
.vg-dp-editor,
.vg-dp-shell {
  /* Cockpit-aligned aliases over VelocityGrid --vg-* theme tokens. */
  --vg-dp-fg: var(--vg-fg-color, #1a1f24);
  --vg-dp-muted: var(--vg-muted-fg-color, #8a93a6);
  --vg-dp-border: color-mix(in srgb, var(--vg-border-color, #c5d0d8) 92%, transparent);
  --vg-dp-accent: var(--vg-accent-color, var(--vg-chrome-accent, #4f9cf9));
  --vg-dp-accent-fg: var(--vg-accent-fg, var(--vg-primary-fg, #ffffff));
  --vg-dp-bg: var(--vg-popup-bg, var(--vg-bg-color, #f3f6f8));
  --vg-dp-surface: color-mix(in srgb, var(--vg-dp-fg) 3.5%, transparent);
  --vg-dp-surface-2: color-mix(in srgb, var(--vg-dp-fg) 5.5%, transparent);
  --vg-dp-panel: color-mix(in srgb, var(--vg-dp-fg) 1.5%, transparent);
  --vg-dp-input-bg: var(--vg-input-bg, var(--vg-dp-surface));
  --vg-dp-radius: var(--vg-radius, 2px);
  --vg-dp-card: transparent;
  --vg-dp-row-sel: color-mix(in srgb, var(--vg-dp-accent) 12%, transparent);

  font-family: var(--vg-font-family, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  font-size: 12.5px;
  line-height: 1.4;
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
  /* Soft sheet wash — matches Customize drawer atmosphere. */
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--vg-dp-fg) 2.5%, transparent), transparent 72px),
    var(--vg-dp-bg);
}
.vg-dp-shell * { box-sizing: border-box; }

.vg-dp-shell__sidebar {
  width: 248px;
  flex-shrink: 0;
  border-right: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
  scrollbar-width: thin;
}
.vg-dp-shell__sidebar-head {
  padding: 16px 14px 14px;
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
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.vg-dp-shell__sidebar-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
/* Cockpit + add control in the rail head. */
.vg-dp-addbtn.vg-dp-btn,
.vg-dp-shell .vg-dp-addbtn {
  width: 22px;
  height: 22px;
  min-width: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--vg-dp-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--vg-dp-accent) 45%, transparent);
  color: var(--vg-dp-accent);
  border-radius: var(--vg-dp-radius);
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  text-transform: none;
}
.vg-dp-addbtn.vg-dp-btn:hover:not(:disabled),
.vg-dp-shell .vg-dp-addbtn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vg-dp-accent) 20%, transparent);
  border-color: color-mix(in srgb, var(--vg-dp-accent) 55%, transparent);
  color: var(--vg-dp-accent);
  filter: none;
}
.vg-dp-shell__sidebar-head input[type="search"] {
  width: 100%;
  padding: 7px 10px;
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
  padding: 10px 10px 16px;
  scrollbar-width: thin;
}
.vg-dp-shell__ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.vg-dp-shell__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--vg-dp-radius);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 110ms ease, border-color 110ms ease, box-shadow 110ms ease;
}
.vg-dp-shell__row:hover { background: var(--vg-dp-surface); }
.vg-dp-shell__row.is-selected {
  background: var(--vg-dp-row-sel);
  border-color: color-mix(in srgb, var(--vg-dp-accent) 28%, transparent);
  box-shadow: inset 2px 0 0 var(--vg-dp-accent);
}
.vg-dp-shell__row-meta { flex: 1; min-width: 0; }
.vg-dp-shell__row-name {
  font-weight: 500;
  font-size: 12.5px;
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
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vg-dp-muted);
  background: var(--vg-dp-surface);
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
  border-radius: var(--vg-dp-radius);
}
.vg-dp-shell__row-tools button:hover,
.vg-dp-shell__row-tools .vg-dp-btn:hover {
  color: var(--vg-dp-fg);
  background: var(--vg-dp-surface);
}
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
  padding: 36px 24px;
  line-height: 1.5;
}
.vg-dp-shell__empty-main h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.015em;
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
  background: transparent;
}

/* Action buttons — cockpit actbtn language (caps, quiet secondary / solid primary).
   Excludes MultiSelect internals and the switch pill. */
.vg-dp-shell button:not(.vg-dp-switch):not(.vg-dp-ms__trigger):not(.vg-dp-ms__option):not(.vg-dp-ms__chip-x),
.vg-dp-shell .vg-dp-btn,
.vg-dp-editor button[type="button"]:not(.vg-dp-editor__tab):not(.vg-dp-editor__actions button):not(.vg-dp-switch):not(.vg-dp-ms__trigger):not(.vg-dp-ms__option):not(.vg-dp-ms__chip-x),
.vg-dp-editor .vg-dp-btn:not(.vg-dp-editor__tab) {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--vg-dp-muted);
  padding: 6px 10px;
  border-radius: var(--vg-dp-radius);
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition: color 110ms ease, background 110ms ease, border-color 110ms ease, filter 110ms ease;
}
.vg-dp-shell button:not(.vg-dp-switch):not(.vg-dp-ms__trigger):not(.vg-dp-ms__option):not(.vg-dp-ms__chip-x):hover:not(:disabled),
.vg-dp-shell .vg-dp-btn:hover:not(:disabled),
.vg-dp-editor button[type="button"]:not(.vg-dp-editor__tab):not(.vg-dp-editor__actions button):not(.vg-dp-switch):not(.vg-dp-ms__trigger):not(.vg-dp-ms__option):not(.vg-dp-ms__chip-x):hover:not(:disabled),
.vg-dp-editor .vg-dp-btn:hover:not(:disabled) {
  color: var(--vg-dp-fg);
  background: var(--vg-dp-surface);
  border-color: var(--vg-dp-border);
}
.vg-dp-shell button.primary,
.vg-dp-shell .vg-dp-btn--primary,
.vg-dp-shell__empty-main button.primary,
.vg-dp-shell__empty-main .vg-dp-btn--primary,
.vg-dp-editor .vg-dp-btn--primary {
  background: var(--vg-primary-color, var(--vg-dp-accent));
  color: var(--vg-primary-fg, var(--vg-dp-accent-fg));
  border-color: transparent;
}
.vg-dp-shell button.primary:hover:not(:disabled),
.vg-dp-shell .vg-dp-btn--primary:hover:not(:disabled),
.vg-dp-editor .vg-dp-btn--primary:hover:not(:disabled) {
  filter: brightness(1.08);
  border-color: transparent;
  color: var(--vg-primary-fg, var(--vg-dp-accent-fg));
  background: var(--vg-primary-color, var(--vg-dp-accent));
}

.vg-dp-btn--secondary,
.vg-dp-btn.secondary {
  background: transparent;
  color: var(--vg-dp-muted);
  border-color: transparent;
}
.vg-dp-btn--ghost {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}
.vg-dp-btn--danger,
.vg-dp-btn.destructive,
.vg-dp-modal__footer button.destructive {
  background: color-mix(in srgb, #dc2626 14%, transparent);
  color: color-mix(in srgb, #dc2626 88%, var(--vg-dp-fg));
  border-color: color-mix(in srgb, #dc2626 40%, transparent);
}
.vg-dp-btn--danger:hover:not(:disabled),
.vg-dp-btn.destructive:hover:not(:disabled) {
  background: color-mix(in srgb, #dc2626 22%, transparent);
  color: color-mix(in srgb, #dc2626 95%, var(--vg-dp-fg));
  filter: none;
}
.vg-dp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.vg-dp-search {
  width: 100%;
  padding: 7px 10px;
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
  border-color: color-mix(in srgb, var(--vg-dp-accent) 50%, transparent);
  color: var(--vg-dp-accent);
  background: color-mix(in srgb, var(--vg-dp-accent) 12%, transparent);
}

.vg-dp-editor {
  border: 0;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  min-height: 420px;
  max-width: 960px;
  background: transparent;
}
.vg-dp-editor * { box-sizing: border-box; }
.vg-dp-editor__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 22px 14px;
  border-bottom: 1px solid var(--vg-dp-border);
  background: transparent;
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
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--vg-dp-fg);
}
.vg-dp-editor__header input,
.vg-dp-editor__header textarea {
  width: 100%;
  min-width: 0;
  padding: 7px 10px;
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
/* Tab strip — Customize sheet-nav language (uppercase, accent wash when active). */
.vg-dp-editor__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--vg-dp-border);
  background: color-mix(in srgb, var(--vg-dp-fg) 2%, transparent);
  flex-shrink: 0;
}
.vg-dp-editor__tab {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  height: 30px;
  padding: 0 12px;
  cursor: pointer;
  color: var(--vg-dp-muted);
  border-radius: var(--vg-dp-radius);
  margin: 0;
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition: color 110ms ease, background 110ms ease, border-color 110ms ease;
}
.vg-dp-editor__tab:hover {
  color: var(--vg-dp-fg);
  background: var(--vg-dp-surface);
}
.vg-dp-editor__tab[aria-selected="true"] {
  color: var(--vg-dp-fg);
  background: color-mix(in srgb, var(--vg-dp-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--vg-dp-accent) 35%, transparent);
  font-weight: 650;
}
.vg-dp-editor__body {
  padding: 18px 22px 28px;
  flex: 1;
  overflow: auto;
  min-height: 0;
  scrollbar-width: thin;
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
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 12px 14px;
  align-items: center;
  max-width: 560px;
}
.vg-dp-editor__grid label { color: var(--vg-dp-muted); }
.vg-dp-editor__grid input,
.vg-dp-editor__grid select,
.vg-dp-editor__grid textarea,
.vg-dp-field input,
.vg-dp-field select,
.vg-dp-field textarea,
.vg-dp-editor__inline-actions input {
  padding: 7px 10px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  width: 100%;
  font: inherit;
  color-scheme: inherit;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vg-dp-editor__add-column-row input,
.vg-dp-editor__add-column-row select {
  padding: 7px 10px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
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
  '.vg-dp-editor__add-column-row input',
  '.vg-dp-editor__add-column-row select',
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
  min-height: 44px;
  padding: 10px 18px;
  border-top: 1px solid var(--vg-dp-border);
  background: color-mix(in srgb, var(--vg-dp-fg) 2.5%, transparent);
  flex-shrink: 0;
}
.vg-dp-editor__actions-left {
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--vg-dp-muted);
  min-width: 0;
}
.vg-dp-editor__actions-left.is-saved {
  color: color-mix(in srgb, #4ade80 85%, var(--vg-dp-fg));
}
.vg-dp-editor__actions-left.is-error {
  color: color-mix(in srgb, #dc2626 85%, var(--vg-dp-fg));
}
.vg-dp-editor__actions-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.vg-dp-editor__actions button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--vg-dp-muted);
  padding: 6px 10px;
  border-radius: var(--vg-dp-radius);
  cursor: pointer;
  font: inherit;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: color 110ms ease, background 110ms ease, border-color 110ms ease, filter 110ms ease;
}
.vg-dp-editor__actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.vg-dp-editor__actions button:hover:not(:disabled) {
  color: var(--vg-dp-fg);
  background: var(--vg-dp-surface);
  border-color: var(--vg-dp-border);
}
.vg-dp-editor__actions button.primary,
.vg-dp-editor__actions .vg-dp-btn--primary {
  border-color: transparent;
  background: var(--vg-primary-color, var(--vg-dp-accent));
  color: var(--vg-primary-fg, var(--vg-dp-accent-fg));
  min-width: 0;
}
.vg-dp-editor__actions button.primary:hover:not(:disabled),
.vg-dp-editor__actions .vg-dp-btn--primary:hover:not(:disabled) {
  filter: brightness(1.08);
  border-color: transparent;
  color: var(--vg-primary-fg, var(--vg-dp-accent-fg));
  background: var(--vg-primary-color, var(--vg-dp-accent));
}
.vg-dp-editor__actions button.secondary,
.vg-dp-editor__actions .vg-dp-btn--secondary {
  background: transparent;
  color: var(--vg-dp-muted);
  border-color: transparent;
}
.vg-dp-editor__actions button.secondary:hover:not(:disabled),
.vg-dp-editor__actions .vg-dp-btn--secondary:hover:not(:disabled) {
  color: var(--vg-dp-fg);
  background: var(--vg-dp-surface);
  border-color: var(--vg-dp-border);
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
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.vg-dp-editor th, .vg-dp-editor td {
  border-bottom: 1px solid var(--vg-dp-border);
  padding: 6px 8px;
  text-align: left;
}
.vg-dp-editor tbody tr:nth-child(even) {
  background: var(--vg-row-alt-bg, var(--vg-dp-surface));
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

.vg-dp-fields {
  display: flex;
  flex-direction: column;
  gap: 0;
  max-width: 560px;
}
/* Section cards → cockpit numbered-band look (title + rule, no boxed chrome). */
.vg-dp-card {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  margin: 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vg-dp-card:last-child { margin-bottom: 8px; }
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
.vg-dp-field {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 12px 14px;
  align-items: start;
  margin: 0 0 12px;
}
.vg-dp-field:last-child { margin-bottom: 0; }
.vg-dp-field__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
}
.vg-dp-field__main > input,
.vg-dp-field__main > select,
.vg-dp-field__main > textarea,
.vg-dp-field__main > .vg-dp-ms {
  width: 100%;
  max-width: 420px;
}
.vg-dp-field__main > .vg-dp-switch { margin-top: 2px; }
${vguiCapsCss('.vg-dp-field__label', DP_TOKENS)}
.vg-dp-field__help {
  margin: 6px 0 0;
  font-size: 11px;
  letter-spacing: 0.01em;
  color: var(--vg-dp-muted);
  line-height: 1.45;
  text-transform: none;
}
.vg-dp-muted { color: var(--vg-dp-muted); }
.vg-dp-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vg-dp-muted);
  background: var(--vg-dp-surface);
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
  scrollbar-width: thin;
  padding-right: 4px;
}
.vg-dp-editor__test-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0 0;
  margin-top: 16px;
  border-top: 1px solid var(--vg-dp-border);
  flex-shrink: 0;
}
.vg-dp-editor__test-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  padding: 3px 9px;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  background: var(--vg-dp-surface);
  color: var(--vg-dp-muted);
}
.vg-dp-editor__test-pill.is-ok {
  border-color: color-mix(in srgb, #4ade80 50%, transparent);
  color: #4ade80;
}
.vg-dp-editor__test-pill.is-error {
  border-color: color-mix(in srgb, #dc2626 45%, transparent);
  color: color-mix(in srgb, #dc2626 90%, var(--vg-dp-fg));
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
  padding: 36px 24px;
  color: var(--vg-dp-muted);
  line-height: 1.5;
}
.vg-dp-editor__fields-empty h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--vg-dp-fg);
}
.vg-dp-editor__fields-empty p { margin: 0; max-width: 22rem; font-size: 12px; }
.vg-dp-editor__fields-empty-icon {
  font-size: 22px;
  opacity: 0.4;
  line-height: 1;
}
.vg-dp-editor__inference-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 14px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--vg-dp-border);
}
.vg-dp-editor__inference-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--vg-dp-muted);
}
.vg-dp-editor__fields-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vg-dp-editor__fields-toolbar input[type="search"] {
  width: 100%;
  padding: 7px 10px;
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
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vg-dp-muted);
}
.vg-dp-editor__select-all input { width: auto; accent-color: var(--vg-dp-accent); }
.vg-dp-editor__field-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 320px;
  overflow: auto;
  scrollbar-width: thin;
  padding: 2px 0;
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

/* MultiSelect dropdown (key columns) — cockpit chip / input language. */
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
  min-height: 34px;
  padding: 4px 10px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
  cursor: pointer;
  text-align: left;
  color-scheme: inherit;
  transition: border-color 110ms ease, box-shadow 140ms ease, background 110ms ease;
}
.vg-dp-ms__trigger:hover {
  border-color: color-mix(in srgb, var(--vg-dp-muted) 45%, var(--vg-dp-border));
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
}
.vg-dp-ms__trigger:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--vg-dp-accent) 70%, var(--vg-dp-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vg-dp-accent) 16%, transparent);
}
.vg-dp-ms__trigger:disabled {
  opacity: 0.4;
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
  gap: 4px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-surface);
  font-size: 10.5px;
  letter-spacing: 0.04em;
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
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0;
  text-transform: none;
}
.vg-dp-ms__chip-x:hover {
  color: var(--vg-dp-fg);
  background: transparent;
  border-color: transparent;
}
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
  scrollbar-width: thin;
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
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: var(--vg-dp-radius);
  background: transparent;
  color: var(--vg-dp-fg);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
  cursor: pointer;
  text-align: left;
  transition: background 110ms ease;
}
.vg-dp-ms__option:hover {
  background: var(--vg-dp-surface);
  color: var(--vg-dp-fg);
  border-color: transparent;
}
.vg-dp-ms__option.is-selected {
  background: color-mix(in srgb, var(--vg-dp-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--vg-dp-accent) 28%, transparent);
  box-shadow: inset 2px 0 0 var(--vg-dp-accent);
}
.vg-dp-ms__option[aria-selected="true"] {
  background: color-mix(in srgb, var(--vg-dp-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--vg-dp-accent) 28%, transparent);
  box-shadow: inset 2px 0 0 var(--vg-dp-accent);
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
  padding: 7px 10px;
  margin: 1px 0;
  border: 1px solid transparent;
  border-radius: var(--vg-dp-radius);
  font-size: 12px;
  cursor: pointer;
  transition: background 110ms ease, border-color 110ms ease;
}
.vg-dp-editor__field-row:hover {
  background: var(--vg-dp-surface);
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
/* field | header | type | Add — single compact row */
.vg-dp-editor__add-column-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 100%;
}
.vg-dp-editor__add-column-row > .vg-dp-editor__add-column-field,
.vg-dp-editor__add-column-row > .vg-dp-editor__add-column-header {
  flex: 1 1 0;
  min-width: 0;
  width: auto;
  max-width: none;
}
.vg-dp-editor__add-column-row > .vg-dp-editor__add-column-type {
  flex: 0 0 auto;
  width: auto;
  min-width: 6.5rem;
  max-width: 9rem;
}
.vg-dp-editor__add-column-row > .vg-dp-btn {
  flex: 0 0 auto;
  white-space: nowrap;
}
@media (max-width: 640px) {
  .vg-dp-editor__add-column-row {
    flex-wrap: wrap;
  }
  .vg-dp-editor__add-column-row > .vg-dp-editor__add-column-field,
  .vg-dp-editor__add-column-row > .vg-dp-editor__add-column-header {
    flex: 1 1 calc(50% - 4px);
  }
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
  scrollbar-width: thin;
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
  background: color-mix(in srgb, var(--vg-dp-bg) 92%, var(--vg-dp-fg));
  color: var(--vg-dp-muted);
  font-weight: 650;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
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
  gap: 0;
}
.vg-dp-editor__diag-error {
  border: 1px solid color-mix(in srgb, #dc2626 40%, transparent);
  background: color-mix(in srgb, #dc2626 12%, transparent);
  color: color-mix(in srgb, #dc2626 90%, var(--vg-dp-fg));
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
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.015em;
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
  gap: 6px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--vg-dp-border);
  background: color-mix(in srgb, var(--vg-dp-fg) 2.5%, transparent);
}
.vg-dp-shell { position: relative; }

@media (prefers-reduced-motion: reduce) {
  .vg-dp-shell *,
  .vg-dp-editor * {
    transition: none !important;
  }
}
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
