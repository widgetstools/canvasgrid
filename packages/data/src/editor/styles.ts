/**
 * Provider editor styles — driven by VelocityGrid `--vg-*` theme tokens so
 * the panel tracks dark / light (and custom) themes when mounted under
 * VelocityGridExt chrome. Fallbacks lean light for standalone hosts.
 */
export const EDITOR_CSS = `
.vg-dp-editor {
  --vg-dp-fg: var(--vg-fg-color, #1a1f24);
  --vg-dp-muted: var(--vg-muted-fg-color, color-mix(in srgb, var(--vg-fg-color, #1a1f24) 55%, transparent));
  --vg-dp-border: var(--vg-border-color, #c5d0d8);
  --vg-dp-accent: var(--vg-primary-color, var(--vg-accent-color, #4f9cf9));
  --vg-dp-accent-fg: var(--vg-primary-fg, var(--vg-accent-fg, #ffffff));
  --vg-dp-bg: var(--vg-popup-bg, var(--vg-header-bg, #f3f6f8));
  --vg-dp-panel: color-mix(in srgb, var(--vg-dp-fg) 4%, var(--vg-dp-bg));
  --vg-dp-input-bg: var(--vg-input-bg, color-mix(in srgb, var(--vg-dp-fg) 3%, var(--vg-dp-bg)));
  --vg-dp-radius: var(--vg-radius, 2px);

  font-family: var(--vg-font-family, "IBM Plex Sans", "Segoe UI", sans-serif);
  font-size: 13px;
  color: var(--vg-dp-fg);
  background: var(--vg-dp-bg);
  border: 1px solid var(--vg-dp-border);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  min-height: 420px;
  max-width: 960px;
}
.vg-dp-editor * { box-sizing: border-box; }
.vg-dp-editor__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-panel);
}
.vg-dp-editor__brand {
  font-family: "IBM Plex Serif", Georgia, serif;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--vg-dp-fg);
}
.vg-dp-editor__header input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
}
.vg-dp-editor__header input::placeholder {
  color: var(--vg-dp-muted);
  opacity: 0.85;
}
.vg-dp-editor__tabs {
  display: flex;
  gap: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--vg-dp-border);
  background: color-mix(in srgb, var(--vg-dp-panel) 80%, transparent);
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
}
.vg-dp-editor__tab:hover {
  color: var(--vg-dp-fg);
}
.vg-dp-editor__tab[aria-selected="true"] {
  color: var(--vg-dp-accent);
  border-bottom-color: var(--vg-dp-accent);
  font-weight: 600;
}
.vg-dp-editor__body {
  padding: 16px;
  flex: 1;
  overflow: auto;
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
.vg-dp-editor__grid textarea {
  padding: 6px 8px;
  border: 1px solid var(--vg-dp-border);
  border-radius: var(--vg-dp-radius);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  width: 100%;
  font: inherit;
}
.vg-dp-editor__grid input[type="checkbox"] {
  width: auto;
  accent-color: var(--vg-dp-accent);
}
.vg-dp-editor__grid select {
  color-scheme: inherit;
}
.vg-dp-editor__actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-panel);
}
.vg-dp-editor__actions button {
  appearance: none;
  border: 1px solid var(--vg-dp-accent);
  background: var(--vg-dp-accent);
  color: var(--vg-dp-accent-fg);
  padding: 7px 14px;
  border-radius: var(--vg-dp-radius);
  cursor: pointer;
  font: inherit;
}
.vg-dp-editor__actions button:hover {
  filter: brightness(1.08);
}
.vg-dp-editor__actions button.secondary {
  background: transparent;
  color: var(--vg-dp-accent);
}
.vg-dp-editor__actions button.secondary:hover {
  background: color-mix(in srgb, var(--vg-dp-accent) 12%, transparent);
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
  font-family: "IBM Plex Mono", ui-monospace, monospace;
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
.vg-dp-editor button[type="button"]:not(.vg-dp-editor__tab):not(.vg-dp-editor__actions button) {
  appearance: none;
  border: 1px solid var(--vg-dp-border);
  background: var(--vg-dp-input-bg);
  color: var(--vg-dp-fg);
  padding: 6px 10px;
  border-radius: var(--vg-dp-radius);
  cursor: pointer;
  font: inherit;
}
.vg-dp-editor button[type="button"]:not(.vg-dp-editor__tab):not(.vg-dp-editor__actions button):hover {
  border-color: var(--vg-dp-accent);
  color: var(--vg-dp-accent);
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
