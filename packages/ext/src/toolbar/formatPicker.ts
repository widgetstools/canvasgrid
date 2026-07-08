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
): { toggle(): void; destroy(): void } {
  injectFormatPickerStyles();
  return menu(anchor, (close) => buildPanel(host, close));
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
    `<div class="cgext-fmt-current">` +
      `<span class="cgext-fmt-caps">CURRENT</span>` +
      `<span class="cgext-fmt-current-chip"></span>` +
      `<button type="button" class="cgext-fmt-clear" title="Clear format">${svg(I.x, 14)}</button>` +
    `</div>` +
    `<div class="cgext-fmt-search">${svg(I.search, 14)}<input type="search" placeholder="Search formats…" aria-label="Search formats" /></div>` +
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

  clearBtn.addEventListener('click', () => { host.clearFormat(); renderCurrent(); renderMain(); });
  searchInput.addEventListener('input', () => { query = searchInput.value; renderMain(); });
  searchInput.addEventListener('keydown', (e) => e.stopPropagation());

  renderCurrent();
  renderMain();
  return el;
}

// Task 8 replaces this stub with the full Custom tab (symbol quick-insert,
// validated input, excel reference). Kept minimal so Task 7 ships runnable.
function buildCustomTab(
  _host: FormatPickerHost,
  _dataType: FormatDataType,
  _ctx: { current(): string | undefined; renderCurrent(): void; renderMain(): void; close(): void },
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cgext-fmt-custom';
  return wrap;
}

export function injectFormatPickerStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cgext-fmt-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-fmt-styles';
  style.textContent = FMT_CSS;
  document.head.appendChild(style);
}

const FMT_CSS = `
.cgext-menu.cgext-fmt { width: 440px; padding: 10px 12px 12px; }
.cgext-fmt-caps { font-size: 11px; font-weight: 650; letter-spacing: 0.08em; color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-fmt-current { display: flex; align-items: center; gap: 10px; padding-bottom: 8px; }
.cgext-fmt-current-chip {
  flex: 1 1 auto; min-width: 0; height: 26px; display: inline-flex; align-items: center;
  padding: 0 10px; border: 1px dashed var(--cg-border-color, #2a3140); border-radius: 6px;
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 12px;
  color: var(--cg-muted-fg-color, #9aa4b6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cgext-fmt-current-chip.has-format { color: var(--cg-fg-color, #e5e9f0); border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-fmt-clear {
  appearance: none; width: 26px; height: 26px; border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 6px; background: transparent; color: var(--cg-muted-fg-color, #9aa4b6);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.cgext-fmt-clear:hover:not(:disabled) { color: var(--cg-neg-color, #e2606c); border-color: var(--cg-neg-color, #e2606c); }
.cgext-fmt-clear:disabled { opacity: 0.4; cursor: default; }
.cgext-fmt-search {
  display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px;
  border: 1px solid var(--cg-accent-color, #4f9cf9); border-radius: 8px; margin-bottom: 8px;
  color: var(--cg-muted-fg-color, #9aa4b6);
}
.cgext-fmt-search input {
  flex: 1 1 auto; min-width: 0; border: none; background: transparent; outline: none;
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 13px;
}
.cgext-fmt-main { display: flex; gap: 12px; min-height: 220px; }
.cgext-fmt-tabs { display: flex; flex-direction: column; gap: 2px; width: 132px; flex: 0 0 auto; }
.cgext-fmt-tab {
  appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 7px 9px; border: none; border-radius: 6px; background: transparent;
  color: var(--cg-muted-fg-color, #9aa4b6); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.cgext-fmt-tab:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); }
.cgext-fmt-tab.is-active {
  color: var(--cg-accent-color, #4f9cf9);
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent);
  box-shadow: inset 2px 0 0 var(--cg-accent-color, #4f9cf9);
}
.cgext-fmt-count { font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 11px; opacity: 0.75; }
.cgext-fmt-body { flex: 1 1 auto; min-width: 0; max-height: 320px; overflow-y: auto; }
.cgext-fmt-list { display: flex; flex-direction: column; gap: 2px; }
.cgext-fmt-row {
  appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 9px; border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--cg-fg-color, #e5e9f0); font: inherit; text-align: left; cursor: pointer;
}
.cgext-fmt-row:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); }
.cgext-fmt-row.is-active {
  background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 12%, transparent);
  border-color: var(--cg-accent-color, #4f9cf9);
}
.cgext-fmt-row-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.cgext-fmt-row-label { font-weight: 600; font-size: 13px; }
.cgext-fmt-row-code {
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 11.5px;
  color: var(--cg-muted-fg-color, #9aa4b6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
}
.cgext-fmt-row-preview {
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace; font-size: 12px;
  color: var(--cg-fg-color, #d3dbe7); white-space: nowrap; flex: 0 0 auto;
}
.cgext-fmt-empty { padding: 18px 10px; font-size: 12.5px; color: var(--cg-muted-fg-color, #9aa4b6); }
.cgext-fmt-custom { display: flex; flex-direction: column; gap: 10px; }
`;
