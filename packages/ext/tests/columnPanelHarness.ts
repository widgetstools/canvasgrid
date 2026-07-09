import { vi } from 'vitest';
import { columnPanelMenu, type ColumnConfigGrid, type ColumnPanelHost } from '../src/toolbar/columnPanel';

export class FakeColumnGrid implements ColumnConfigGrid {
  templates = new Map<string, Record<string, unknown>>(); // colId → own overrides
  defs: Array<Record<string, unknown>> = [
    { colId: 'px', cellDataType: 'number' },
    { colId: 'qty', cellDataType: 'number', enableRowGroup: true },
  ];
  valueCols: Array<{ colId: string; aggFunc: string }> = [];
  pinnedByCol = new Map<string, 'left' | 'right' | null>();
  options: Record<string, unknown> = { columnDefs: this.defs, floatingFilter: true, defaultColDef: { editable: true } };

  editColumn = vi.fn((colId: string, patch: Record<string, unknown>) => {
    const own = this.templates.get(colId) ?? {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete own[k]; else own[k] = v;
    }
    this.templates.set(colId, own);
    return { ok: true };
  });
  getTemplates() {
    return [...this.templates.entries()].map(([colId, overrides]) => ({ id: `__cgridOwn:${colId}`, overrides }));
  }
  getGridOption(key: string) { return this.options[key]; }
  getValueColumns() { return this.valueCols.map((v) => ({ ...v })); }
  addValueColumn = vi.fn((colId: string, aggFunc: string) => { this.valueCols.push({ colId, aggFunc }); });
  setValueColumnAggFunc = vi.fn((colId: string, aggFunc: string) => {
    const v = this.valueCols.find((x) => x.colId === colId); if (v) v.aggFunc = aggFunc;
  });
  removeValueColumn = vi.fn((colId: string) => { this.valueCols = this.valueCols.filter((x) => x.colId !== colId); });
  setColumnsPinned = vi.fn((keys: string[], pinned: 'left' | 'right' | null) => {
    for (const k of keys) this.pinnedByCol.set(k, pinned);
  });
  getColumnState() { return this.defs.map((d) => ({ colId: d.colId as string, pinned: this.pinnedByCol.get(d.colId as string) ?? null })); }
}

export function mountColumnPanel(cols: string[] = ['px'], grid = new FakeColumnGrid()) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const host: ColumnPanelHost = { targetCols: () => cols, grid, onApplied: vi.fn() };
  const m = columnPanelMenu(anchor, host);
  m.toggle();
  const panel = document.querySelector<HTMLElement>('.cgext-menu.cgext-col')!;
  return { anchor, host, grid, m, panel };
}
