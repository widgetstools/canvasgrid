import { describe, it, expect, afterEach } from 'vitest';
import { effectiveFlag, mixedValue } from '../src/toolbar/columnPanel';
import { FakeColumnGrid, mountColumnPanel } from './columnPanelHarness';

afterEach(() => { document.body.replaceChildren(); });

describe('effectiveFlag resolution', () => {
  it('own template beats base def beats default', () => {
    const g = new FakeColumnGrid();
    expect(effectiveFlag(g, 'qty', 'enableRowGroup')).toBe(true);   // base def
    expect(effectiveFlag(g, 'px', 'enableRowGroup')).toBe(false);   // default
    expect(effectiveFlag(g, 'px', 'sortable')).toBe(true);          // default true
    expect(effectiveFlag(g, 'px', 'floatingFilter')).toBe(true);    // grid option fallback
    g.editColumn('qty', { enableRowGroup: false });
    expect(effectiveFlag(g, 'qty', 'enableRowGroup')).toBe(false);  // own template wins
  });
  it('mixedValue detects divergent targets', () => {
    const g = new FakeColumnGrid();
    g.editColumn('px', { sortable: false });
    expect(mixedValue(g, ['px', 'qty'], 'sortable')).toEqual({ value: undefined, mixed: true });
    expect(mixedValue(g, ['qty'], 'sortable')).toEqual({ value: true, mixed: false });
  });
});

describe('panel anatomy', () => {
  it('renders the four section headings and the empty state without targets', () => {
    const { panel } = mountColumnPanel();
    const caps = Array.from(panel.querySelectorAll('.cgext-col-caps')).map((c) => c.textContent);
    expect(caps).toEqual(['FILTER', 'GROUPING', 'AGGREGATION', 'BEHAVIOR']);
    document.body.replaceChildren();
    const { panel: empty } = mountColumnPanel([]);
    expect(empty.querySelector('.cgext-fmt-empty')!.textContent).toContain('Select a cell or column');
    expect(empty.querySelector('.cgext-col-row')).toBeNull();
  });
  it('switch rows expose aria-checked from effective state', () => {
    const { panel } = mountColumnPanel(['qty']);
    const sw = panel.querySelector<HTMLElement>('.cgext-col-row[data-k="enableRowGroup"] .cgext-col-switch')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
  it('Escape closes; destroy cleans up', () => {
    const { panel, m } = mountColumnPanel();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.cgext-menu.cgext-col')).toBeNull();
    m.destroy();
  });
});

describe('sections — state read + apply fan-out', () => {
  const row = (panel: HTMLElement, k: string) => panel.querySelector<HTMLElement>(`.cgext-col-row[data-k="${k}"]`)!;

  it('floating filter switch applies editColumn to every target', () => {
    const grid = new FakeColumnGrid();
    const { panel, host } = mountColumnPanel(['px', 'qty'], grid);
    row(panel, 'floatingFilter').querySelector<HTMLElement>('.cgext-col-switch')!.click();
    // grid option floatingFilter=true → effective true → toggle writes false
    expect(grid.editColumn).toHaveBeenCalledWith('px', { floatingFilter: false });
    expect(grid.editColumn).toHaveBeenCalledWith('qty', { floatingFilter: false });
    expect(host.onApplied).toHaveBeenCalled();
    expect(document.querySelector('.cgext-menu.cgext-col')).not.toBeNull(); // stays open
  });

  it('filter type segment: Set writes filter:set, Auto writes filter:null', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px'], grid);
    row(panel, 'filter').querySelector<HTMLElement>('.cgext-col-seg button[data-v="set"]')!.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { filter: 'set' });
    row(panel, 'filter').querySelector<HTMLElement>('.cgext-col-seg button[data-v="auto"]')!.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { filter: null });
  });

  it('agg select drives the value-column APIs (add / change / remove)', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px'], grid);
    const sel = row(panel, 'aggFunc').querySelector<HTMLSelectElement>('select')!;
    sel.value = 'sum'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(grid.addValueColumn).toHaveBeenCalledWith('px', 'sum');
    grid.valueCols = [{ colId: 'px', aggFunc: 'sum' }];
    sel.value = 'avg'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(grid.setValueColumnAggFunc).toHaveBeenCalledWith('px', 'avg');
    grid.valueCols = [{ colId: 'px', aggFunc: 'avg' }];
    sel.value = 'none'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(grid.removeValueColumn).toHaveBeenCalledWith('px');
  });

  it('show-in-header switch writes the INVERSE suppress flag and is disabled without an agg', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px'], grid);
    const sw = row(panel, 'aggHeader').querySelector<HTMLButtonElement>('.cgext-col-switch')!;
    expect(sw.disabled).toBe(true); // no agg on px
    document.body.replaceChildren();
    grid.valueCols = [{ colId: 'px', aggFunc: 'sum' }];
    const { panel: p2 } = mountColumnPanel(['px'], grid);
    const sw2 = row(p2, 'aggHeader').querySelector<HTMLButtonElement>('.cgext-col-switch')!;
    expect(sw2.disabled).toBe(false);
    expect(sw2.getAttribute('aria-checked')).toBe('true'); // suppress default false → shown
    sw2.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { suppressAggFuncInHeader: true });
  });

  it('pinned segment uses setColumnsPinned; hidden switch uses editColumn hide', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px', 'qty'], grid);
    row(panel, 'pinned').querySelector<HTMLElement>('button[data-v="left"]')!.click();
    expect(grid.setColumnsPinned).toHaveBeenCalledWith(['px', 'qty'], 'left');
    row(panel, 'pinned').querySelector<HTMLElement>('button[data-v="none"]')!.click();
    expect(grid.setColumnsPinned).toHaveBeenCalledWith(['px', 'qty'], null);
    row(panel, 'hide').querySelector<HTMLElement>('.cgext-col-switch')!.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { hide: true });
  });

  it('mixed multi-column state renders indeterminate and normalizes on first toggle', () => {
    const grid = new FakeColumnGrid();
    grid.editColumn('px', { sortable: false });
    grid.editColumn.mockClear();
    const { panel } = mountColumnPanel(['px', 'qty'], grid);
    const sw = row(panel, 'sortable').querySelector<HTMLElement>('.cgext-col-switch')!;
    expect(sw.classList.contains('is-mixed')).toBe(true);
    sw.click(); // mixed → true for ALL
    expect(grid.editColumn).toHaveBeenCalledWith('px', { sortable: true });
    expect(grid.editColumn).toHaveBeenCalledWith('qty', { sortable: true });
  });

  it('a throwing apply marks the row with the error tint, no crash', () => {
    const grid = new FakeColumnGrid();
    grid.editColumn.mockImplementationOnce(() => { throw new Error('nope'); });
    const { panel } = mountColumnPanel(['px'], grid);
    row(panel, 'enableRowGroup').querySelector<HTMLElement>('.cgext-col-switch')!.click();
    expect(row(panel, 'enableRowGroup').classList.contains('is-error')).toBe(true);
  });
});
