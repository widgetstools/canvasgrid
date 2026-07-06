/**
 * Cycle: columns tool panel hierarchy — Task 2.
 *
 * The Columns tool panel's visibility list historically rendered every
 * column as one flat row (see `columnsToolPanel.test.ts`). This test
 * proves the NEW hierarchical rendering: group rows (with a caret +
 * tri-state checkbox) interleaved with indented leaf rows, mounted on a
 * REAL CGrid (not a mock api) so `getColumnGroupDefs()` reflects the
 * authored `columnDefs` tree exactly as production code sees it.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import type { CColDef, CColGroupDef } from '../src/types';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as any;
  })() as any;
});

/** Mount a real CGrid with the Columns tool panel opened, driving the
 *  side-bar tab exactly as a user click would. Returns the live CGrid
 *  instance — its methods (`setColumnsVisible`, `getColumnState`,
 *  `destroy`) are the same surface exercised elsewhere in the suite. */
async function mountWithPanel(
  columnDefs: (CColDef | CColGroupDef)[],
): Promise<CGrid<{ id: string }>> {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);

  const grid = new CGrid<{ id: string }>(container, {
    columnDefs,
    getRowId: (r) => r.id,
    theme: 'cg-theme-quartz',
    sideBar: { toolPanels: ['columns'] },
  });

  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));

  const bar = container.querySelector('.cg-side-bar') as HTMLElement;
  const colsTab = bar.querySelector('.cg-side-bar-tab[data-id="agColumnsToolPanel"]') as HTMLButtonElement;
  colsTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  return grid;
}

describe('Columns tool panel — hierarchical rendering (T2)', () => {
  it('renders group rows with indented children', async () => {
    const grid = await mountWithPanel([
      { field: 'a' },
      { groupId: 'G', headerName: 'Grp', children: [{ field: 'b' }, { field: 'c' }] },
    ]);
    const panel = document.querySelector('.cg-columns-panel')!;
    const groupRow = panel.querySelector('[data-group-id="G"]')!;
    expect(groupRow).toBeTruthy();
    expect(groupRow.querySelector('.cg-columns-panel-row-caret')).toBeTruthy();

    const b = panel.querySelector('[data-col-id="b"]') as HTMLElement;
    const a = panel.querySelector('[data-col-id="a"]') as HTMLElement;
    // child indented deeper than the top-level 'a'
    expect(parseInt(b.style.getPropertyValue('--cg-indent') || '0'))
      .toBeGreaterThan(parseInt(a.style.getPropertyValue('--cg-indent') || '0'));
    grid.destroy();
  });

  it('group checkbox is tri-state and toggles all descendants', async () => {
    const grid = await mountWithPanel([
      { groupId: 'G', headerName: 'Grp', children: [{ field: 'b' }, { field: 'c' }] },
    ]);
    const cb = document.querySelector('[data-group-id="G"] input[type=checkbox]') as HTMLInputElement;
    expect(cb.checked).toBe(true);

    grid.setColumnsVisible(['b'], false); // mixed → indeterminate
    await Promise.resolve();
    expect(cb.indeterminate).toBe(true);

    cb.click(); // toggles all off (or on)
    await Promise.resolve();
    expect(
      grid.getColumnState().filter((s) => ['b', 'c'].includes(s.colId))
        .every((s) => (s.hide === true) === (cb.checked === false)),
    ).toBe(true);
    grid.destroy();
  });

  it('an anonymous (no groupId) group renders with a RESOLVABLE data-group-id and is a valid drag target (review fix — ag-grid parity)', async () => {
    const grid = await mountWithPanel([
      { field: 'a' },
      // No `groupId` — a legal ag-grid authoring pattern. The panel must
      // synthesize the SAME id the mutation core resolves against, or the
      // rendered group is a dead drag target (review FIX 1).
      { headerName: 'Grp', children: [{ field: 'b' }, { field: 'c' }] },
    ]);
    const panel = document.querySelector('.cg-columns-panel')!;
    const groupRow = panel.querySelector('[data-group-id="cg-grp-1"]');
    expect(groupRow).toBeTruthy();

    grid.moveColumnToGroup('a', 'cg-grp-1');
    await Promise.resolve();
    expect(grid.getColumnState().map((s) => s.colId)).toEqual(['b', 'c', 'a']);
    grid.destroy();
  });
});
