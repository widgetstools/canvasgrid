/**
 * Format picker — the ribbon `# Format` pill's dropdown. Plain DOM, all
 * state re-derived from the host closures on every open/re-render; the
 * panel owns only its transient query/draft strings. Selection is a
 * dismissal gesture (apply + close), matching the layouts panel; Clear
 * and the Custom tab's quick-inserts keep the panel open.
 */
import { menu, svg } from './ui';
import { compileFormat } from '@cgrid/format';
import {
  CATEGORY_LABELS, CURRENCY_QUICK_INSERT, EXCEL_EXAMPLES,
  applyCurrencySymbol, categoriesForDataType, codeText, defaultSampleValue,
  filterPresets, findPresetByFormat, presetsForCategory, presetsForDataType,
  type FormatDataType, type FormatPreset,
} from './formatPresets';

export interface FormatPickerHost {
  targetCols(): string[];
  currentFormat(): string | undefined;
  applyFormat(format: string): void;
  clearFormat(): void;
  dataType(): FormatDataType;
}

const CUSTOM_TAB = '__custom__';

const I = {
  search: 'M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
};

/** Compile + run `format` against `sample`; `·` when anything fails. */
export function previewFormat(format: string, sample: unknown): string {
  try {
    const r = compileFormat(format);
    if (!r.ok) return '·';
    const text = r.program.formatText({ value: sample, row: { value: sample }, colId: '__preview' });
    return text === '' ? '·' : text;
  } catch { return '·'; }
}

export function formatPickerMenu(
  anchor: HTMLElement,
  host: FormatPickerHost,
  opts?: {
    /** Keep the panel inside this box (cockpit pane / settings sheet). */
    fitTo?: HTMLElement | (() => HTMLElement | null | undefined);
  },
): { toggle(): void; destroy(): void } {
  injectFormatPickerStyles();
  return menu(anchor, (close) => buildPanel(host, close), undefined, {
    preferWidth: 456,
    compactBelow: 380,
    fitTo: opts?.fitTo,
  });
}

function buildPanel(host: FormatPickerHost, close: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cgext-fmt';
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  if (host.targetCols().length === 0) {
    el.innerHTML = `<div class="cgext-fmt-empty">Select a cell or column first.</div>`;
    return el;
  }

  const dataType = host.dataType();
  const sample = defaultSampleValue(dataType);
  const categories = categoriesForDataType(dataType);
  let query = '';
  const current = () => host.currentFormat()?.trim();
  const activePreset = () => findPresetByFormat(current());
  let tab: string = activePreset()?.category
    ?? (current() !== undefined ? CUSTOM_TAB : categories[0] ?? CUSTOM_TAB);

  el.innerHTML =
    `<div class="cgext-fmt-header">` +
      `<div class="cgext-fmt-current">` +
        `<span class="cgext-fmt-caps">Applied</span>` +
        `<span class="cgext-fmt-current-chip"></span>` +
        `<button type="button" class="cgext-fmt-clear" title="Clear format" aria-label="Clear format">${svg(I.x, 14)}</button>` +
      `</div>` +
      `<div class="cgext-fmt-search">${svg(I.search, 14)}<input type="search" placeholder="Search formats…" aria-label="Search formats" /></div>` +
    `</div>` +
    `<div class="cgext-fmt-main"></div>`;
  const chipEl = el.querySelector<HTMLElement>('.cgext-fmt-current-chip')!;
  const clearBtn = el.querySelector<HTMLButtonElement>('.cgext-fmt-clear')!;
  const mainEl = el.querySelector<HTMLElement>('.cgext-fmt-main')!;
  const searchInput = el.querySelector<HTMLInputElement>('.cgext-fmt-search input')!;

  const renderCurrent = () => {
    const cur = current();
    chipEl.textContent = cur === undefined ? '—' : previewFormat(cur, activePreset()?.sample ?? sample);
    chipEl.title = cur === undefined ? 'No format applied' : cur;
    chipEl.classList.toggle('has-format', cur !== undefined);
    clearBtn.disabled = cur === undefined;
  };

  const presetRow = (p: FormatPreset): HTMLElement => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cgext-fmt-row' + (p.format === current() ? ' is-active' : '');
    row.dataset.presetId = p.id;
    const preview = previewFormat(p.format, p.sample ?? sample);
    row.innerHTML =
      `<span class="cgext-fmt-row-main"><span class="cgext-fmt-row-label"></span><span class="cgext-fmt-row-code"></span></span>` +
      `<span class="cgext-fmt-row-preview"></span>`;
    row.querySelector('.cgext-fmt-row-label')!.textContent = p.label;
    row.querySelector('.cgext-fmt-row-code')!.textContent = codeText(p.format);
    row.querySelector('.cgext-fmt-row-preview')!.textContent = preview;
    row.title = `${p.label} · ${preview}`;
    row.addEventListener('click', () => { host.applyFormat(p.format); close(); });
    return row;
  };

  const renderMain = () => {
    mainEl.replaceChildren();
    if (query.trim()) {
      const results = filterPresets(presetsForDataType(dataType), query);
      const list = document.createElement('div');
      list.className = 'cgext-fmt-list';
      if (results.length === 0) {
        list.innerHTML = `<div class="cgext-fmt-empty"></div>`;
        list.querySelector('.cgext-fmt-empty')!.textContent =
          `No formats match "${query.trim()}". Try the Custom tab.`;
      } else {
        list.append(...results.map(presetRow));
      }
      mainEl.appendChild(list);
      return;
    }
    const tabs = document.createElement('div');
    tabs.className = 'cgext-fmt-tabs';
    const tabBtn = (cat: string, label: string, count: number | null) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cgext-fmt-tab' + (tab === cat ? ' is-active' : '');
      b.dataset.cat = cat;
      b.innerHTML = `<span></span>` +
        (count === null ? svg(I.hash, 13) : `<span class="cgext-fmt-count">${count}</span>`);
      b.querySelector('span')!.textContent = label;
      b.addEventListener('click', () => { tab = cat; renderMain(); });
      tabs.appendChild(b);
    };
    for (const c of categories) tabBtn(c, CATEGORY_LABELS[c], presetsForCategory(c).length);
    tabBtn(CUSTOM_TAB, 'Custom', null);

    const body = document.createElement('div');
    body.className = 'cgext-fmt-body';
    if (tab === CUSTOM_TAB) {
      body.appendChild(buildCustomTab(host, dataType, { current, renderCurrent, renderMain, close }));
    } else {
      const list = document.createElement('div');
      list.className = 'cgext-fmt-list';
      list.append(...presetsForCategory(tab as never).map(presetRow));
      body.appendChild(list);
    }
    mainEl.append(tabs, body);
  };

  clearBtn.addEventListener('click', () => {
    host.clearFormat();
    renderCurrent();
    // Clearing the applied format doesn't change the Custom tab's in-progress
    // draft text — skip the renderMain() rebuild so it isn't discarded.
    if (tab !== CUSTOM_TAB) renderMain();
  });
  searchInput.addEventListener('input', () => { query = searchInput.value; renderMain(); });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    e.stopPropagation();
  });

  renderCurrent();
  renderMain();
  return el;
}

function buildCustomTab(
  host: FormatPickerHost,
  dataType: FormatDataType,
  ctx: { current(): string | undefined; renderCurrent(): void; renderMain(): void; close(): void },
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cgext-fmt-custom';
  wrap.innerHTML =
    `<div class="cgext-fmt-caps">Custom format</div>` +
    `<div class="cgext-fmt-symbols"><span class="cgext-fmt-caps">Currency</span></div>` +
    `<div class="cgext-fmt-custom-input">` +
      `${svg(I.hash, 14)}<input type="text" spellcheck="false" aria-label="Custom format" />` +
      `<button type="button" class="cgext-fmt-custom-apply" title="Apply format" aria-label="Apply format">${svg(I.check, 14)}</button>` +
      `<button type="button" class="cgext-fmt-custom-clear" title="Clear format" aria-label="Clear format">${svg(I.x, 14)}</button>` +
    `</div>` +
    `<div class="cgext-fmt-ref"></div>`;

  const input = wrap.querySelector<HTMLInputElement>('.cgext-fmt-custom-input input')!;
  const applyBtn = wrap.querySelector<HTMLButtonElement>('.cgext-fmt-custom-apply')!;
  const clearBtn = wrap.querySelector<HTMLButtonElement>('.cgext-fmt-custom-clear')!;
  input.placeholder = dataType === 'date' ? 'yyyy-mm-dd' : '#,##0.00';
  // Prefill with a current format that matches no preset (custom source of truth).
  const cur = ctx.current();
  if (cur !== undefined && !findPresetByFormat(cur)) input.value = cur;

  const validate = (): boolean => {
    const draft = input.value.trim();
    if (!draft) { input.classList.remove('is-error'); input.title = ''; applyBtn.disabled = true; return false; }
    const r = compileFormat(draft);
    input.classList.toggle('is-error', !r.ok);
    input.title = r.ok ? '' : r.error.message;
    applyBtn.disabled = !r.ok;
    return r.ok;
  };
  validate();
  input.addEventListener('input', validate);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && validate()) { host.applyFormat(input.value.trim()); ctx.close(); }
    if (e.key === 'Escape') ctx.close();
  });
  applyBtn.addEventListener('click', () => {
    if (validate()) { host.applyFormat(input.value.trim()); ctx.close(); }
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    validate();
    host.clearFormat();
    ctx.renderCurrent();
  });

  const symbols = wrap.querySelector<HTMLElement>('.cgext-fmt-symbols')!;
  for (const c of CURRENCY_QUICK_INSERT) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cgext-fmt-symbol';
    b.dataset.symbol = c.symbol;
    b.textContent = c.label;
    b.setAttribute('aria-label', `Insert ${c.label} currency symbol`);
    b.addEventListener('click', () => {
      const next = applyCurrencySymbol(input.value, c.symbol);
      input.value = next;
      if (validate()) { host.applyFormat(next); ctx.renderCurrent(); } // applies, stays open
    });
    symbols.appendChild(b);
  }

  const ref = wrap.querySelector<HTMLElement>('.cgext-fmt-ref')!;
  for (const section of EXCEL_EXAMPLES) {
    const title = document.createElement('div');
    title.className = 'cgext-fmt-ref-title cgext-fmt-caps';
    title.textContent = section.title;
    ref.appendChild(title);
    for (const row of section.rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cgext-fmt-ref-row';
      b.dataset.format = row.format;
      const sentinel = row.format.startsWith('—');
      b.disabled = sentinel;
      b.innerHTML =
        `<span class="cgext-fmt-ref-label"></span>` +
        `<span class="cgext-fmt-ref-code"></span>` +
        `<span class="cgext-fmt-ref-sample"></span>` +
        (sentinel ? '' : `<span class="cgext-fmt-ref-copy">${svg(I.copy, 12)}</span>`);
      b.querySelector('.cgext-fmt-ref-label')!.textContent = row.label;
      b.querySelector('.cgext-fmt-ref-code')!.textContent = row.format;
      b.querySelector('.cgext-fmt-ref-sample')!.textContent = row.sample;
      if (!sentinel) {
        b.addEventListener('click', () => {
          try { void navigator.clipboard?.writeText(row.format); } catch { /* copy is best-effort */ }
          host.applyFormat(row.format);
          ctx.close();
        });
      }
      ref.appendChild(b);
    }
  }
  return wrap;
}

export function injectFormatPickerStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('cgext-fmt-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'cgext-fmt-styles';
    document.head.appendChild(style);
  }
  style.textContent = FMT_CSS;
}

const FMT_CSS = `
/* Trading-desk quiet: hairline structure, restrained accent, tabular previews.
 * Width is set at open time (prefer 456px, clamped to fitTo / viewport). */
.cgext-menu.cgext-fmt {
  width: 456px;
  max-width: min(456px, calc(100vw - 16px));
  padding: 0;
  overflow: hidden;
  border-radius: var(--cg-radius, 2px);
  box-sizing: border-box;
}
.cgext-fmt-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 88%, transparent);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 2.5%, transparent);
}
.cgext-fmt-caps {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--cg-muted-fg-color, #9aa4b6) 88%, transparent);
}
.cgext-fmt-current {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cgext-fmt-current > .cgext-fmt-caps {
  flex: 0 0 auto;
  min-width: 52px;
}
.cgext-fmt-current-chip {
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 90%, transparent);
  border-radius: var(--cg-radius, 2px);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 3%, transparent);
  font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: var(--cg-muted-fg-color, #9aa4b6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}
.cgext-fmt-current-chip.has-format {
  color: var(--cg-fg-color, #e5e9f0);
  border-color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 55%, var(--cg-border-color, #2a3140));
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 8%, transparent);
}
.cgext-fmt-clear {
  appearance: none;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--cg-radius, 2px);
  background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}
.cgext-fmt-clear:hover:not(:disabled) {
  color: var(--cg-neg-color, #e2606c);
  background: color-mix(in srgb, var(--cg-neg-color, #e2606c) 10%, transparent);
  border-color: color-mix(in srgb, var(--cg-neg-color, #e2606c) 28%, transparent);
}
.cgext-fmt-clear:focus-visible {
  outline: 2px solid var(--cg-accent-color, #4f9cf9);
  outline-offset: 1px;
}
.cgext-fmt-clear:disabled { opacity: 0.35; cursor: default; }
.cgext-fmt-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 92%, transparent);
  border-radius: var(--cg-radius, 2px);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 3.5%, transparent);
  color: var(--cg-muted-fg-color, #9aa4b6);
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}
.cgext-fmt-search:focus-within {
  border-color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 70%, var(--cg-border-color, #2a3140));
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 6%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 16%, transparent);
  color: var(--cg-fg-color, #e5e9f0);
}
.cgext-fmt-search input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  color: var(--cg-fg-color, #e5e9f0);
  font: inherit;
  font-size: 13px;
}
.cgext-fmt-search input::placeholder {
  color: color-mix(in srgb, var(--cg-muted-fg-color, #9aa4b6) 85%, transparent);
}
.cgext-fmt-main {
  display: flex;
  gap: 0;
  min-height: 236px;
  padding: 8px 8px 10px;
}
.cgext-fmt.is-compact .cgext-fmt-main {
  flex-direction: column;
  min-height: 0;
}
.cgext-fmt-tabs {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 138px;
  flex: 0 0 auto;
  padding: 2px 6px 2px 2px;
  margin-right: 6px;
  border-right: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 80%, transparent);
}
.cgext-fmt.is-compact .cgext-fmt-tabs {
  flex-direction: row;
  flex-wrap: wrap;
  width: auto;
  margin-right: 0;
  margin-bottom: 8px;
  padding: 2px 2px 8px;
  border-right: none;
  border-bottom: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 80%, transparent);
}
.cgext-fmt.is-compact .cgext-fmt-tab {
  flex: 1 1 auto;
  justify-content: center;
  padding: 7px 8px;
  font-size: 12px;
}
.cgext-fmt.is-compact .cgext-fmt-tab.is-active {
  box-shadow: inset 0 -2px 0 var(--cg-accent-color, #4f9cf9);
}
.cgext-fmt.is-compact .cgext-fmt-body {
  max-height: min(280px, 50vh);
}
.cgext-fmt.is-compact .cgext-fmt-row-code {
  max-width: 140px;
}
.cgext-fmt-tab {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: var(--cg-radius, 2px);
  background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-align: left;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.cgext-fmt-tab:hover {
  color: var(--cg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 5%, transparent);
}
.cgext-fmt-tab:focus-visible {
  outline: 2px solid var(--cg-accent-color, #4f9cf9);
  outline-offset: 0;
}
.cgext-fmt-tab.is-active {
  color: var(--cg-fg-color, #e5e9f0);
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 14%, transparent);
  box-shadow: inset 2px 0 0 var(--cg-accent-color, #4f9cf9);
}
.cgext-fmt-tab.is-active .cgext-fmt-count,
.cgext-fmt-tab.is-active > svg {
  color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 88%, var(--cg-fg-color, #e5e9f0));
  opacity: 1;
}
.cgext-fmt-count {
  font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  opacity: 0.62;
  letter-spacing: 0.02em;
}
.cgext-fmt-body {
  flex: 1 1 auto;
  min-width: 0;
  max-height: 328px;
  overflow-y: auto;
  padding: 0 2px 2px 4px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--cg-muted-fg-color, #9aa4b6) 35%, transparent) transparent;
}
.cgext-fmt-list { display: flex; flex-direction: column; gap: 1px; }
.cgext-fmt-row {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: var(--cg-radius, 2px);
  background: transparent;
  color: var(--cg-fg-color, #e5e9f0);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.cgext-fmt-row:hover {
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 5%, transparent);
}
.cgext-fmt-row:focus-visible {
  outline: 2px solid var(--cg-accent-color, #4f9cf9);
  outline-offset: 0;
}
.cgext-fmt-row.is-active {
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 10%, transparent);
  border-color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 42%, transparent);
}
.cgext-fmt-row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cgext-fmt-row-label {
  font-weight: 560;
  font-size: 13px;
  letter-spacing: -0.005em;
  line-height: 1.25;
}
.cgext-fmt-row-code {
  font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.01em;
  color: color-mix(in srgb, var(--cg-muted-fg-color, #9aa4b6) 92%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 210px;
}
.cgext-fmt-row-preview {
  font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 88%, transparent);
  white-space: nowrap;
  flex: 0 0 auto;
  padding-left: 4px;
  border-left: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 70%, transparent);
  min-width: 4.5em;
  text-align: right;
}
.cgext-fmt-row.is-active .cgext-fmt-row-preview {
  color: var(--cg-fg-color, #e5e9f0);
  border-left-color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 35%, transparent);
}
.cgext-fmt-empty {
  padding: 28px 14px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--cg-muted-fg-color, #9aa4b6);
  text-align: center;
}
.cgext-fmt-custom {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 4px 2px;
}
.cgext-fmt-symbols {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.cgext-fmt-symbol {
  appearance: none;
  min-width: 34px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 90%, transparent);
  border-radius: var(--cg-radius, 2px);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 3%, transparent);
  color: var(--cg-fg-color, #e5e9f0);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}
.cgext-fmt-symbol:hover {
  border-color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 50%, var(--cg-border-color, #2a3140));
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 10%, transparent);
}
.cgext-fmt-symbol:focus-visible {
  outline: 2px solid var(--cg-accent-color, #4f9cf9);
  outline-offset: 1px;
}
.cgext-fmt-custom-input {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 11px;
  border: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 92%, transparent);
  border-radius: var(--cg-radius, 2px);
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 3%, transparent);
  color: var(--cg-muted-fg-color, #9aa4b6);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.cgext-fmt-custom-input:focus-within {
  border-color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 65%, var(--cg-border-color, #2a3140));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 14%, transparent);
}
.cgext-fmt-custom-input input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  color: var(--cg-fg-color, #e5e9f0);
  font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.cgext-fmt-custom-input input.is-error { color: var(--cg-neg-color, #e2606c); }
.cgext-fmt-custom-apply, .cgext-fmt-custom-clear {
  appearance: none;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--cg-radius, 2px);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
.cgext-fmt-custom-apply { color: var(--cg-accent-color, #4f9cf9); }
.cgext-fmt-custom-apply:hover:not(:disabled) {
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent);
  border-color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 28%, transparent);
}
.cgext-fmt-custom-apply:disabled { opacity: 0.35; cursor: default; }
.cgext-fmt-custom-clear { color: var(--cg-neg-color, #e2606c); }
.cgext-fmt-custom-clear:hover {
  background: color-mix(in srgb, var(--cg-neg-color, #e2606c) 10%, transparent);
  border-color: color-mix(in srgb, var(--cg-neg-color, #e2606c) 28%, transparent);
}
.cgext-fmt-ref {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-top: 1px solid color-mix(in srgb, var(--cg-border-color, #2a3140) 85%, transparent);
  padding-top: 10px;
  margin-top: 2px;
}
.cgext-fmt-ref-title { padding: 10px 6px 5px; }
.cgext-fmt-ref-row {
  appearance: none;
  display: grid;
  grid-template-columns: 122px minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: var(--cg-radius, 2px);
  background: transparent;
  color: var(--cg-fg-color, #e5e9f0);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
.cgext-fmt-ref-row:hover:not(:disabled) {
  background: color-mix(in srgb, var(--cg-fg-color, #e5e9f0) 5%, transparent);
}
.cgext-fmt-ref-row:focus-visible {
  outline: 2px solid var(--cg-accent-color, #4f9cf9);
  outline-offset: 0;
}
.cgext-fmt-ref-row:disabled { opacity: 0.5; cursor: default; }
.cgext-fmt-ref-label { font-weight: 500; letter-spacing: -0.005em; }
.cgext-fmt-ref-code, .cgext-fmt-ref-sample {
  font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.cgext-fmt-ref-code {
  color: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 82%, var(--cg-fg-color, #e5e9f0));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cgext-fmt-ref-sample {
  color: var(--cg-muted-fg-color, #9aa4b6);
  white-space: nowrap;
}
.cgext-fmt-ref-copy {
  display: inline-flex;
  color: color-mix(in srgb, var(--cg-muted-fg-color, #9aa4b6) 80%, transparent);
  opacity: 0;
  transition: opacity 120ms ease;
}
.cgext-fmt-ref-row:hover:not(:disabled) .cgext-fmt-ref-copy,
.cgext-fmt-ref-row:focus-visible .cgext-fmt-ref-copy { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .cgext-fmt-current-chip,
  .cgext-fmt-clear,
  .cgext-fmt-search,
  .cgext-fmt-tab,
  .cgext-fmt-row,
  .cgext-fmt-symbol,
  .cgext-fmt-custom-input,
  .cgext-fmt-custom-apply,
  .cgext-fmt-custom-clear,
  .cgext-fmt-ref-row,
  .cgext-fmt-ref-copy { transition: none; }
}
`;
