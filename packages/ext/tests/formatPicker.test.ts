import { describe, it, expect, afterEach } from 'vitest';
import { previewFormat } from '../src/toolbar/formatPicker';
import { FakeFormatHost, mountPicker } from './formatPickerHarness';
import { EXCEL_EXAMPLES } from '../src/toolbar/formatPresets';

afterEach(() => { document.body.replaceChildren(); });

describe('previewFormat', () => {
  it('renders through the real compiler and degrades to · on failure', () => {
    expect(previewFormat('#,##0', 1234.5678)).toBe('1,235');
    expect(previewFormat('TICK32', 101.5)).toBe('101-16');
    expect(previewFormat('=UPPER(', 'x')).toBe('·');
  });
});

describe('panel anatomy', () => {
  it('renders sidebar tabs with counts for the data type + the custom tab', () => {
    const { panel } = mountPicker();
    const cats = Array.from(panel.querySelectorAll<HTMLElement>('.vgext-fmt-tab')).map((t) => t.dataset.cat);
    expect(cats).toEqual(['number', 'currency', 'negatives', 'conditional', 'tick', 'percent', '__custom__']);
    expect(panel.querySelector('.vgext-fmt-tab[data-cat="number"] .vgext-fmt-count')!.textContent).toBe('6');
    expect(panel.querySelector('.vgext-fmt-tab[data-cat="__custom__"] .vgext-fmt-count')).toBeNull();
  });
  it('date columns get the date rail', () => {
    const host = new FakeFormatHost();
    host.dt = 'date';
    const { panel } = mountPicker(host);
    const cats = Array.from(panel.querySelectorAll<HTMLElement>('.vgext-fmt-tab')).map((t) => t.dataset.cat);
    expect(cats).toEqual(['date', '__custom__']);
  });
  it('shows rows for the active tab with label, code, live preview', () => {
    const { panel } = mountPicker();
    const row = panel.querySelector<HTMLElement>('.vgext-fmt-row[data-preset-id="num-integer"]')!;
    expect(row.querySelector('.vgext-fmt-row-label')!.textContent).toBe('Integer');
    expect(row.querySelector('.vgext-fmt-row-code')!.textContent).toBe('#,##0');
    expect(row.querySelector('.vgext-fmt-row-preview')!.textContent).toBe('1,235');
  });
  it('ƒ(x) code text for expression presets', () => {
    const { panel } = mountPicker();
    // Basis points is on the number tab
    const row = panel.querySelector<HTMLElement>('.vgext-fmt-row[data-preset-id="num-bps"]')!;
    expect(row.querySelector('.vgext-fmt-row-code')!.textContent).toBe('ƒ(x)');
    expect(row.querySelector('.vgext-fmt-row-preview')!.textContent).toBe('+12.3 bp');
  });
  it('no target columns → disabled hint', () => {
    const host = new FakeFormatHost();
    host.cols = [];
    const { panel } = mountPicker(host);
    expect(panel.querySelector('.vgext-fmt-empty')!.textContent).toContain('Select a cell or column');
    expect(panel.querySelector('.vgext-fmt-row')).toBeNull();
  });
});

describe('apply / current / clear', () => {
  it('row click applies the preset format and closes', () => {
    const { panel, host } = mountPicker();
    panel.querySelector<HTMLElement>('.vgext-fmt-row[data-preset-id="num-2dp"]')!.click();
    expect(host.applyFormat).toHaveBeenCalledWith('#,##0.00');
    expect(document.querySelector('.vgext-menu.vgext-fmt')).toBeNull();
  });
  it('CURRENT chip previews the current format; active row highlighted; clear stays open', () => {
    const host = new FakeFormatHost();
    host.format = '#,##0';
    const { panel } = mountPicker(host);
    expect(panel.querySelector('.vgext-fmt-current-chip')!.textContent).toBe('1,235');
    expect(panel.querySelector('.vgext-fmt-row[data-preset-id="num-integer"]')!.classList.contains('is-active')).toBe(true);
    const clear = panel.querySelector<HTMLButtonElement>('.vgext-fmt-clear')!;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(host.clearFormat).toHaveBeenCalled();
    expect(document.querySelector('.vgext-menu.vgext-fmt')).not.toBeNull(); // stays open
    expect(panel.querySelector('.vgext-fmt-current-chip')!.textContent).toBe('—');
  });
  it('clear is disabled with no current format', () => {
    const { panel } = mountPicker();
    expect(panel.querySelector<HTMLButtonElement>('.vgext-fmt-clear')!.disabled).toBe(true);
  });
});

describe('search', () => {
  const type = (panel: HTMLElement, text: string) => {
    const input = panel.querySelector<HTMLInputElement>('.vgext-fmt-search input')!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  it('non-blank query flips to a flat result list; blank restores tabs', () => {
    const { panel } = mountPicker();
    type(panel, 'parens');
    expect(panel.querySelector('.vgext-fmt-tabs')).toBeNull();
    expect(panel.querySelectorAll('.vgext-fmt-row').length).toBeGreaterThan(0);
    type(panel, '');
    expect(panel.querySelector('.vgext-fmt-tabs')).not.toBeNull();
  });
  it('zero matches show the empty-state hint', () => {
    const { panel } = mountPicker();
    type(panel, 'zzzznope');
    expect(panel.querySelector('.vgext-fmt-empty')!.textContent).toContain('No formats match');
  });
});

describe('lifecycle', () => {
  it('Escape closes; destroy cleans up', () => {
    const { panel, m } = mountPicker();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vgext-menu.vgext-fmt')).toBeNull();
    m.destroy(); // second destroy must not throw
  });
  it('Escape closes even while focus is in the search input (not swallowed by stopPropagation)', () => {
    const { panel } = mountPicker();
    const input = panel.querySelector<HTMLInputElement>('.vgext-fmt-search input')!;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vgext-menu.vgext-fmt')).toBeNull();
  });
});

describe('custom tab', () => {
  const openCustom = (host?: FakeFormatHost) => {
    const r = mountPicker(host);
    r.panel.querySelector<HTMLElement>('.vgext-fmt-tab[data-cat="__custom__"]')!.click();
    return r;
  };
  const draftInput = (panel: HTMLElement) =>
    panel.querySelector<HTMLInputElement>('.vgext-fmt-custom-input input')!;

  it('symbol quick-insert seeds/replaces the draft and applies immediately, staying open', () => {
    const { panel, host } = openCustom();
    // happy-dom's selector parser mishandles quote-containing attribute
    // values (e.g. `[data-symbol='"£"']`), so look the button up in JS
    // instead of via a nested-quote CSS attribute selector.
    Array.from(panel.querySelectorAll<HTMLButtonElement>('.vgext-fmt-symbols button'))
      .find((b) => b.dataset.symbol === '"£"')!.click();
    expect(host.applyFormat).toHaveBeenCalledWith('"£"#,##0.00');
    expect(document.querySelector('.vgext-menu.vgext-fmt')).not.toBeNull();
    expect(draftInput(panel).value).toBe('"£"#,##0.00');
  });
  it('valid input + ✓ applies and closes; invalid input shows error state and disables ✓', () => {
    const { panel, host } = openCustom();
    const input = draftInput(panel);
    input.value = '0.00%';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('is-error')).toBe(false);
    const apply = panel.querySelector<HTMLButtonElement>('.vgext-fmt-custom-apply')!;
    expect(apply.disabled).toBe(false);
    apply.click();
    expect(host.applyFormat).toHaveBeenCalledWith('0.00%');
    expect(document.querySelector('.vgext-menu.vgext-fmt')).toBeNull();
  });
  it('invalid draft: error class + disabled apply', () => {
    const { panel } = openCustom();
    const input = draftInput(panel);
    input.value = '=UPPER(';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.classList.contains('is-error')).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('.vgext-fmt-custom-apply')!.disabled).toBe(true);
  });
  it('✕ clears the draft and the applied format, staying open', () => {
    const host = new FakeFormatHost();
    host.format = '#,##0';
    const { panel } = openCustom(host);
    panel.querySelector<HTMLElement>('.vgext-fmt-custom-clear')!.click();
    expect(host.clearFormat).toHaveBeenCalled();
    expect(draftInput(panel).value).toBe('');
    expect(document.querySelector('.vgext-menu.vgext-fmt')).not.toBeNull();
  });
  it('reference rows copy + apply + close; tick sentinels are disabled', () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t: string) => { writes.push(t); return Promise.resolve(); } },
      configurable: true,
    });
    const { panel, host } = openCustom();
    const titles = Array.from(panel.querySelectorAll('.vgext-fmt-ref-title')).map((t) => t.textContent);
    expect(titles).toEqual(EXCEL_EXAMPLES.map((s) => s.title));
    panel.querySelector<HTMLElement>('.vgext-fmt-ref-row[data-format="0.00E+00"]')!.click();
    expect(host.applyFormat).toHaveBeenCalledWith('0.00E+00');
    expect(writes).toEqual(['0.00E+00']);
    expect(document.querySelector('.vgext-menu.vgext-fmt')).toBeNull();
  });
  it('tick sentinel rows are disabled buttons', () => {
    const { panel } = openCustom();
    const sentinel = Array.from(panel.querySelectorAll<HTMLButtonElement>('.vgext-fmt-ref-row'))
      .find((r) => r.dataset.format!.startsWith('—'))!;
    expect(sentinel.disabled).toBe(true);
  });
  it('a custom current format opens on the Custom tab with the draft prefilled', () => {
    const host = new FakeFormatHost();
    host.format = '#,##0.000000';       // matches no preset
    const { panel } = mountPicker(host); // no explicit tab click
    expect(draftInput(panel).value).toBe('#,##0.000000');
  });
  it('CURRENT clear while on the Custom tab preserves the in-progress draft text', () => {
    const host = new FakeFormatHost();
    host.format = '#,##0.000000';       // matches no preset → opens on the Custom tab
    const { panel } = mountPicker(host);
    const input = draftInput(panel);
    input.value = '#,##0.00';           // edit the draft further, don't apply it
    input.dispatchEvent(new Event('input', { bubbles: true }));
    panel.querySelector<HTMLButtonElement>('.vgext-fmt-clear')!.click(); // top CURRENT clear
    expect(host.clearFormat).toHaveBeenCalled();
    expect(draftInput(panel).value).toBe('#,##0.00'); // draft survives the clear
  });
});
