import { describe, it, expect, afterEach } from 'vitest';
import { effectiveFlag, mixedValue, aggFuncChoices, AGG_FUNCS } from '../src/toolbar/columnPanel';
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

  // I1 — suppressAggFuncInHeader must inherit the grid-level option, not
  // hard-default to false (same bug class as the floatingFilter fix).
  it('suppressAggFuncInHeader inherits the grid-level option when unset on the column', () => {
    const g = new FakeColumnGrid();
    expect(effectiveFlag(g, 'px', 'suppressAggFuncInHeader')).toBe(false); // grid option unset → default off
    g.options.suppressAggFuncInHeader = true;
    expect(effectiveFlag(g, 'px', 'suppressAggFuncInHeader')).toBe(true);  // grid option ON → inherited
    // An explicit per-column value still wins over the grid-level option.
    g.editColumn('px', { suppressAggFuncInHeader: false });
    expect(effectiveFlag(g, 'px', 'suppressAggFuncInHeader')).toBe(false);
  });

  // I2 — defaultColDef/columnTypes must be consulted for ALL def flags (the
  // kernel merges `{ ...typeBundle, ...defaultColDef, ...colDef }`), not
  // just `editable`.
  it('reads defaultColDef for a flag with no per-column or type-bundle value', () => {
    const g = new FakeColumnGrid();
    g.options.defaultColDef = { sortable: false };
    expect(effectiveFlag(g, 'px', 'sortable')).toBe(false); // defaultColDef-sourced, not the true default
  });

  it('a raw colDef value still beats defaultColDef', () => {
    const g = new FakeColumnGrid();
    g.options.defaultColDef = { enableRowGroup: false };
    expect(effectiveFlag(g, 'qty', 'enableRowGroup')).toBe(true); // qty's own raw def wins
  });

  it('reads a columnTypes bundle when the column carries a matching `type`', () => {
    const g = new FakeColumnGrid();
    g.defs.push({ colId: 'notional', cellDataType: 'number', type: 'money' });
    g.options.columnTypes = { money: { enableRowGroup: true, resizable: false } };
    expect(effectiveFlag(g, 'notional', 'enableRowGroup')).toBe(true);
    expect(effectiveFlag(g, 'notional', 'resizable')).toBe(false);
  });

  it('defaultColDef beats a columnTypes bundle for the same key', () => {
    const g = new FakeColumnGrid();
    g.defs.push({ colId: 'notional', cellDataType: 'number', type: 'money' });
    g.options.columnTypes = { money: { sortable: false } };
    g.options.defaultColDef = { sortable: true };
    expect(effectiveFlag(g, 'notional', 'sortable')).toBe(true); // defaultColDef wins
  });

  // M6 — a field-only colDef (no explicit colId) still matches by field.
  it('baseDefOf matches a field-only colDef by field when colId is absent', () => {
    const g = new FakeColumnGrid();
    g.defs.push({ field: 'notes', cellDataType: 'text', sortable: false });
    expect(effectiveFlag(g, 'notes', 'sortable')).toBe(false);
  });
});

// M7 — host-registered aggFuncs (setGridOption('aggFuncs', …)) must appear
// in the picker choices, not just the seven built-ins.
describe('aggFuncChoices', () => {
  it('returns just the built-ins when no custom aggFuncs are registered', () => {
    const g = new FakeColumnGrid();
    expect(aggFuncChoices(g)).toEqual(AGG_FUNCS);
  });
  it('unions in host-registered aggFuncs, de-duplicating built-in names', () => {
    const g = new FakeColumnGrid();
    g.options.aggFuncs = { median: () => 0, sum: () => 0 };
    expect(aggFuncChoices(g)).toEqual([...AGG_FUNCS, 'median']);
  });
});

describe('panel anatomy', () => {
  it('renders the four section headings and the empty state without targets', () => {
    const { panel } = mountColumnPanel();
    const caps = Array.from(panel.querySelectorAll('.vgext-col-caps')).map((c) => c.textContent);
    expect(caps).toEqual(['FILTER', 'GROUPING', 'AGGREGATION', 'BEHAVIOR']);
    document.body.replaceChildren();
    const { panel: empty } = mountColumnPanel([]);
    expect(empty.querySelector('.vgext-fmt-empty')!.textContent).toContain('Select a cell or column');
    expect(empty.querySelector('.vgext-col-row')).toBeNull();
  });
  it('switch rows expose aria-checked from effective state', () => {
    const { panel } = mountColumnPanel(['qty']);
    const sw = panel.querySelector<HTMLElement>('.vgext-col-row[data-k="enableRowGroup"] .vgext-col-switch')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
  it('Escape closes; destroy cleans up', () => {
    const { panel, m } = mountColumnPanel();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vgext-menu.vgext-col')).toBeNull();
    m.destroy();
  });
});

describe('sections — state read + apply fan-out', () => {
  const row = (panel: HTMLElement, k: string) => panel.querySelector<HTMLElement>(`.vgext-col-row[data-k="${k}"]`)!;

  it('floating filter switch applies editColumn to every target', () => {
    const grid = new FakeColumnGrid();
    const { panel, host } = mountColumnPanel(['px', 'qty'], grid);
    row(panel, 'floatingFilter').querySelector<HTMLElement>('.vgext-col-switch')!.click();
    // grid option floatingFilter=true → effective true → toggle writes false
    expect(grid.editColumn).toHaveBeenCalledWith('px', { floatingFilter: false });
    expect(grid.editColumn).toHaveBeenCalledWith('qty', { floatingFilter: false });
    expect(host.onApplied).toHaveBeenCalled();
    expect(document.querySelector('.vgext-menu.vgext-col')).not.toBeNull(); // stays open
  });

  it('filter type segment: Set writes filter:set, Auto writes filter:null', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px'], grid);
    row(panel, 'filter').querySelector<HTMLElement>('.vgext-col-seg button[data-v="set"]')!.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { filter: 'set' });
    row(panel, 'filter').querySelector<HTMLElement>('.vgext-col-seg button[data-v="auto"]')!.click();
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
    const sw = row(panel, 'aggHeader').querySelector<HTMLButtonElement>('.vgext-col-switch')!;
    expect(sw.disabled).toBe(true); // no agg on px
    document.body.replaceChildren();
    grid.valueCols = [{ colId: 'px', aggFunc: 'sum' }];
    const { panel: p2 } = mountColumnPanel(['px'], grid);
    const sw2 = row(p2, 'aggHeader').querySelector<HTMLButtonElement>('.vgext-col-switch')!;
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
    row(panel, 'hide').querySelector<HTMLElement>('.vgext-col-switch')!.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { hide: true });
  });

  it('mixed multi-column state renders indeterminate and normalizes on first toggle', () => {
    const grid = new FakeColumnGrid();
    grid.editColumn('px', { sortable: false });
    grid.editColumn.mockClear();
    const { panel } = mountColumnPanel(['px', 'qty'], grid);
    const sw = row(panel, 'sortable').querySelector<HTMLElement>('.vgext-col-switch')!;
    expect(sw.classList.contains('is-mixed')).toBe(true);
    sw.click(); // mixed → true for ALL
    expect(grid.editColumn).toHaveBeenCalledWith('px', { sortable: true });
    expect(grid.editColumn).toHaveBeenCalledWith('qty', { sortable: true });
  });

  it('a throwing apply marks the row with the error tint, no crash', () => {
    const grid = new FakeColumnGrid();
    grid.editColumn.mockImplementationOnce(() => { throw new Error('nope'); });
    const { panel } = mountColumnPanel(['px'], grid);
    row(panel, 'enableRowGroup').querySelector<HTMLElement>('.vgext-col-switch')!.click();
    expect(row(panel, 'enableRowGroup').classList.contains('is-error')).toBe(true);
  });
});
