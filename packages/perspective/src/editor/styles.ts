/**
 * Styles for the StompPerspectiveProvider editor — Markets DataProvider
 * editor visual language (Connection / Fields / Columns / Behaviour / Diagnostics).
 */
export const PSP_EDITOR_CSS = `
.vg-psp-editor {
  --psp-fg: var(--vg-fg-color, #e6e8ec);
  --psp-muted: var(--vg-muted-fg-color, #9aa3b2);
  --psp-border: color-mix(in srgb, var(--psp-fg) 14%, transparent);
  --psp-accent: var(--vg-chrome-accent);
  --psp-bg: var(--vg-popup-bg, #141a22);
  --psp-surface: color-mix(in srgb, var(--psp-fg) 4%, transparent);
  --psp-input: color-mix(in srgb, var(--psp-fg) 6%, transparent);
  --psp-radius: 2px;
  font: 12.5px/1.4 Inter, system-ui, sans-serif;
  color: var(--psp-fg);
  background: var(--psp-bg);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}
.vg-psp-editor *, .vg-psp-editor *::before, .vg-psp-editor *::after { box-sizing: border-box; }

.vg-psp-editor__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--psp-border);
  flex: 0 0 auto;
}
.vg-psp-editor__title {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex: 1;
}
.vg-psp-editor__tabs {
  display: flex;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--psp-border);
  flex: 0 0 auto;
  overflow-x: auto;
}
.vg-psp-editor__tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--psp-muted);
  padding: 8px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}
.vg-psp-editor__tab:hover { color: var(--psp-fg); }
.vg-psp-editor__tab[aria-selected="true"] {
  color: var(--psp-fg);
  border-bottom-color: var(--psp-accent);
}
.vg-psp-editor__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vg-psp-editor__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--psp-border);
  flex: 0 0 auto;
}
.vg-psp-card {
  border: 1px solid var(--psp-border);
  border-radius: var(--psp-radius);
  background: var(--psp-surface);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vg-psp-card__title {
  margin: 0;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--psp-muted);
}
.vg-psp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vg-psp-field__label {
  font-size: 11px;
  color: var(--psp-muted);
  letter-spacing: 0.02em;
}
.vg-psp-field__label .req { color: #ef9a9a; margin-left: 2px; }
.vg-psp-field__help {
  font-size: 11px;
  color: var(--psp-muted);
  opacity: 0.9;
}
.vg-psp-field input,
.vg-psp-field select,
.vg-psp-field textarea {
  appearance: none;
  width: 100%;
  border: 1px solid var(--psp-border);
  border-radius: var(--psp-radius);
  background: var(--psp-input);
  color: var(--psp-fg);
  padding: 6px 8px;
  font: inherit;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
}
.vg-psp-field textarea { min-height: 72px; resize: vertical; }
.vg-psp-field input:disabled,
.vg-psp-field select:disabled,
.vg-psp-field textarea:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.vg-psp-field input.invalid { border-color: #ef9a9a; }
.vg-psp-grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.vg-psp-btn {
  appearance: none;
  border: 1px solid var(--psp-border);
  background: transparent;
  color: var(--psp-fg);
  border-radius: var(--psp-radius);
  padding: 6px 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}
.vg-psp-btn:hover { background: color-mix(in srgb, var(--psp-fg) 6%, transparent); }
.vg-psp-btn--primary {
  background: var(--psp-accent);
  border-color: var(--psp-accent);
  color: #fff;
}
.vg-psp-btn--primary:hover { filter: brightness(1.06); }
.vg-psp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.vg-psp-table th,
.vg-psp-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--psp-border);
}
.vg-psp-table th {
  color: var(--psp-muted);
  font-weight: 550;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.vg-psp-checkrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.vg-psp-checkrow input { accent-color: var(--psp-accent); }
.vg-psp-diag {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.vg-psp-stat {
  border: 1px solid var(--psp-border);
  border-radius: var(--psp-radius);
  padding: 8px 10px;
  background: var(--psp-surface);
}
.vg-psp-stat__k {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--psp-muted);
}
.vg-psp-stat__v {
  margin-top: 4px;
  font-size: 14px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.vg-psp-muted { color: var(--psp-muted); font-size: 12px; }
`;

let injected = false;
export function ensurePspEditorStyles(): void {
  if (injected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-vg-psp-editor', '');
  el.textContent = PSP_EDITOR_CSS;
  document.head.appendChild(el);
  injected = true;
}
