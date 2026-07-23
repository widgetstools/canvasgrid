import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';

// The pinned grand-total row (TotalsSubgrid) resolves cells through
// `totalsCellLookup(colId)`. The auto-group column has no aggFunc, so it
// used to resolve null and the row painted with NO label anywhere. AG
// parity: the grand-total row labels 'Total' in the group column,
// customizable via `autoGroupColumnDef.cellRendererParams
// .totalValueGetter` — the same hook the in-body footer renderer reads.

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

function mount(extraOptions: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = new CGrid(el, {
    columnDefs: [
      { colId: 'region', field: 'region' },
      { colId: 'notional', field: 'notional', aggFunc: 'sum' },
    ],
    rowData: [],
    getRowId: (r: any) => r.id,
    ...extraOptions,
  });
  const g = grid as any;
  // Minimal chunk — the lookup only needs `totals` for value columns.
  g.chunk = { ...g.chunk, totals: { notional: 42 }, rowKinds: g.chunk?.rowKinds ?? [] };
  return g;
}

describe('totalsCellLookup — grand-total row label in the auto-group column', () => {
  it("labels the grand-total record 'Total' by default", () => {
    const g = mount();
    expect(g.totalsCellLookup('ag-Grid-AutoColumn'))
      .toEqual({ value: 'Total', valueFormatted: 'Total' });
  });

  it('routes through autoGroupColumnDef.cellRendererParams.totalValueGetter', () => {
    const g = mount({
      autoGroupColumnDef: {
        cellRendererParams: {
          totalValueGetter: (p: { isGrandTotal: boolean }) =>
            p.isGrandTotal ? 'Grand Total' : 'nope',
        },
      },
    });
    expect(g.totalsCellLookup('ag-Grid-AutoColumn'))
      .toEqual({ value: 'Grand Total', valueFormatted: 'Grand Total' });
  });

  it('does NOT label per-group lookups or value columns', () => {
    const g = mount();
    // Per-group lookup for the auto-group column — stays unlabelled
    // (group rows label through the 'group' renderer, not totals).
    expect(g.totalsCellLookup('ag-Grid-AutoColumn', 'region:AMER')).toBeNull();
    // Value column still resolves its aggregate, not a label.
    expect(g.totalsCellLookup('notional')?.value).toBe(42);
  });
});
