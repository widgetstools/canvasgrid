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
