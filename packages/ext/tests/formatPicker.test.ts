import { describe, it, expect, afterEach } from 'vitest';
import { previewFormat } from '../src/toolbar/formatPicker';
import { FakeFormatHost, mountPicker } from './formatPickerHarness';

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
    const cats = Array.from(panel.querySelectorAll<HTMLElement>('.cgext-fmt-tab')).map((t) => t.dataset.cat);
    expect(cats).toEqual(['number', 'negatives', 'conditional', 'tick', 'percent', '__custom__']);
    expect(panel.querySelector('.cgext-fmt-tab[data-cat="number"] .cgext-fmt-count')!.textContent).toBe('6');
    expect(panel.querySelector('.cgext-fmt-tab[data-cat="__custom__"] .cgext-fmt-count')).toBeNull();
  });
  it('date columns get the date rail', () => {
    const host = new FakeFormatHost();
    host.dt = 'date';
    const { panel } = mountPicker(host);
    const cats = Array.from(panel.querySelectorAll<HTMLElement>('.cgext-fmt-tab')).map((t) => t.dataset.cat);
    expect(cats).toEqual(['date', '__custom__']);
  });
  it('shows rows for the active tab with label, code, live preview', () => {
    const { panel } = mountPicker();
    const row = panel.querySelector<HTMLElement>('.cgext-fmt-row[data-preset-id="num-integer"]')!;
    expect(row.querySelector('.cgext-fmt-row-label')!.textContent).toBe('Integer');
    expect(row.querySelector('.cgext-fmt-row-code')!.textContent).toBe('#,##0');
    expect(row.querySelector('.cgext-fmt-row-preview')!.textContent).toBe('1,235');
  });
  it('ƒ(x) code text for expression presets', () => {
    const { panel } = mountPicker();
    // Basis points is on the number tab
    const row = panel.querySelector<HTMLElement>('.cgext-fmt-row[data-preset-id="num-bps"]')!;
    expect(row.querySelector('.cgext-fmt-row-code')!.textContent).toBe('ƒ(x)');
    expect(row.querySelector('.cgext-fmt-row-preview')!.textContent).toBe('+12.3 bp');
  });
  it('no target columns → disabled hint', () => {
    const host = new FakeFormatHost();
    host.cols = [];
    const { panel } = mountPicker(host);
    expect(panel.querySelector('.cgext-fmt-empty')!.textContent).toContain('Select a cell or column');
    expect(panel.querySelector('.cgext-fmt-row')).toBeNull();
  });
});

describe('apply / current / clear', () => {
  it('row click applies the preset format and closes', () => {
    const { panel, host } = mountPicker();
    panel.querySelector<HTMLElement>('.cgext-fmt-row[data-preset-id="num-2dp"]')!.click();
    expect(host.applyFormat).toHaveBeenCalledWith('#,##0.00');
    expect(document.querySelector('.cgext-menu.cgext-fmt')).toBeNull();
  });
  it('CURRENT chip previews the current format; active row highlighted; clear stays open', () => {
    const host = new FakeFormatHost();
    host.format = '#,##0';
    const { panel } = mountPicker(host);
    expect(panel.querySelector('.cgext-fmt-current-chip')!.textContent).toBe('1,235');
    expect(panel.querySelector('.cgext-fmt-row[data-preset-id="num-integer"]')!.classList.contains('is-active')).toBe(true);
    const clear = panel.querySelector<HTMLButtonElement>('.cgext-fmt-clear')!;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(host.clearFormat).toHaveBeenCalled();
    expect(document.querySelector('.cgext-menu.cgext-fmt')).not.toBeNull(); // stays open
    expect(panel.querySelector('.cgext-fmt-current-chip')!.textContent).toBe('—');
  });
  it('clear is disabled with no current format', () => {
    const { panel } = mountPicker();
    expect(panel.querySelector<HTMLButtonElement>('.cgext-fmt-clear')!.disabled).toBe(true);
  });
});

describe('search', () => {
  const type = (panel: HTMLElement, text: string) => {
    const input = panel.querySelector<HTMLInputElement>('.cgext-fmt-search input')!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  it('non-blank query flips to a flat result list; blank restores tabs', () => {
    const { panel } = mountPicker();
    type(panel, 'parens');
    expect(panel.querySelector('.cgext-fmt-tabs')).toBeNull();
    expect(panel.querySelectorAll('.cgext-fmt-row').length).toBeGreaterThan(0);
    type(panel, '');
    expect(panel.querySelector('.cgext-fmt-tabs')).not.toBeNull();
  });
  it('zero matches show the empty-state hint', () => {
    const { panel } = mountPicker();
    type(panel, 'zzzznope');
    expect(panel.querySelector('.cgext-fmt-empty')!.textContent).toContain('No formats match');
  });
});

describe('lifecycle', () => {
  it('Escape closes; destroy cleans up', () => {
    const { panel, m } = mountPicker();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.cgext-menu.cgext-fmt')).toBeNull();
    m.destroy(); // second destroy must not throw
  });
});
