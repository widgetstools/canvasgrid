import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import type { CColDef } from '../src/types';

/**
 * Autosize formatted-measurement regression — the user report was
 * "autosize sometimes leaves columns narrower than their contents".
 * Root cause: the worker pass measured RAW `String(row[field])`, but the
 * painter draws `valueFormatter` output ("(2,230,893)" vs "-2230893") in
 * the document's fonts. `autoSizeColumns` now measures regular columns
 * MAIN-SIDE: raw sample values come back from the worker
 * (`autosizeSampleValues`) and main formats + measures them exactly like
 * the paint path (`cellAt` → `formatNumber`).
 *
 * Coverage:
 *   • formatted text (longer than raw) drives the resolved width
 *   • header competes with `headerPadding` when `skipHeader` is false
 *   • per-value `cellStyleFn` font patches are honoured via composeFont
 */

const PER_CHAR = 10;

beforeAll(() => {
  if (!(globalThis as any).__cgridFakeWorkerInstalled) {
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      constructor(public url: URL) {}
      postMessage(): void { /* replies are mocked at the coordinator */ }
      addEventListener = (_: string, cb: (e: { data: any }) => void) => {
        this.listeners.push(cb);
      };
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
    (globalThis as any).__cgridFakeWorkerInstalled = true;
  }
});

/** Synthetic 2D context: every character is PER_CHAR px wide regardless
 *  of font, but the applied font is recorded per measurement so tests
 *  can assert font composition. */
function fakeMeasureCtx() {
  const fontsSeen: string[] = [];
  const ctx = {
    font: '',
    measureText(text: string) {
      fontsSeen.push(this.font);
      return { width: text.length * PER_CHAR };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fontsSeen };
}

function mount(columnDefs: CColDef[]) {
  const el = document.createElement('div');
  el.style.cssText = 'width:800px; height:600px;';
  document.body.appendChild(el);
  return new VelocityGrid(el, { columnDefs, rowData: [], getRowId: (r: any) => r.id });
}

function arm(grid: VelocityGrid<any>, values: Record<string, unknown[]>) {
  const coord = (grid as any).workerCoord;
  vi.spyOn(coord, 'autosizeSampleValues').mockResolvedValue({
    values, rowCount: Object.values(values)[0]?.length ?? 0,
  });
  const { ctx, fontsSeen } = fakeMeasureCtx();
  (grid as any).headerMeasureCtx = ctx;
  return { fontsSeen };
}

describe('autoSizeColumns — main-side formatted measurement', () => {
  it('sizes to the FORMATTED text, not the raw value', async () => {
    const grid = mount([{
      colId: 'pnl', field: 'pnl', headerName: 'P',
      cellDataType: 'number', minWidth: 10,
      // Paren-negative accounting format: formatted is LONGER than raw.
      valueFormatter: (p: { value: unknown }) => {
        const v = p.value as number;
        return v < 0 ? `(${Math.abs(v).toLocaleString('en-US')})` : String(v);
      },
    }]);
    arm(grid, { pnl: [-2230893] });

    await grid.autoSizeColumns(['pnl'], true /* skipHeader */);

    // '(2,230,893)' = 11 chars × 10 + padding 16 = 126.
    // Raw '-2230893' would have been 8 × 10 + 16 = 96 — the clipped bug.
    const width = grid.getColumnState().find((s) => s.colId === 'pnl')!.width;
    expect(width).toBe(126);
    grid.destroy();
  });

  it('lets the header win when wider (headerPadding reserves the sort caret)', async () => {
    const grid = mount([{
      colId: 'q', field: 'q', headerName: 'A Very Wide Header',
      cellDataType: 'number', minWidth: 10,
    }]);
    arm(grid, { q: [7] });

    await grid.autoSizeColumns(['q'], false);

    // header 'A Very Wide Header' = 18 chars × 10 + headerPadding 30 = 210
    // beats data '7' = 1 × 10 + 16 = 26.
    const width = grid.getColumnState().find((s) => s.colId === 'q')!.width;
    expect(width).toBe(210);
    grid.destroy();
  });

  it('honours per-value cellStyleFn font patches when measuring', async () => {
    const grid = mount([{
      colId: 'v', field: 'v', headerName: 'V',
      cellDataType: 'number', minWidth: 10,
      cellStyle: (p: { value: unknown }) =>
        (p.value as number) < 0 ? { fontWeight: 700 } : undefined,
    } as CColDef]);
    const { fontsSeen } = arm(grid, { v: [-5, 5] });

    await grid.autoSizeColumns(['v'], true);

    // The negative value must have been measured with a 700-weight font.
    expect(fontsSeen.some((f) => f.includes('700'))).toBe(true);
    grid.destroy();
  });
});
