import { describe, it, expect, vi } from 'vitest';
import { Renderer } from '../src/renderer/renderer';
import { CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

/** Build a minimal CachedContext2D-shaped fake whose `.cache` writes pass
 * straight through to the underlying object. Painters don't read state
 * values back, so a plain forwarding object is enough to drive the renderer
 * and check that draw calls happen. */
function fakeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    beginPath: vi.fn(), stroke: vi.fn(), measureText: () => ({ width: 50 }),
    moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(),
    setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) {
      if (key === 'save' || key === 'restore') return target[key];
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

describe('Renderer', () => {
  it('paint fills the canvas with theme bg before drawing the rest', () => {
    const gc = fakeGc();
    const r = new Renderer({
      getViewport: () => ({
        visibleColumns: [], visibleRows: [],
        firstRow: 0, lastRow: -1, scrollLeft: 0, scrollTop: 0,
        bodyLeft: 0, bodyRight: 800, bodyTop: 32, bodyBottom: 600,
        bodyWidth: 800, bodyHeight: 568,
        contentWidth: 0, contentHeight: 0, maxScrollLeft: 0, maxScrollTop: 0,
      } as any),
      getTheme: () => ({
        headerHeight: 32, headerBg: '#000', headerFg: '#fff', borderColor: '#333',
        bg: '#000', fg: '#fff', font: '13px monospace',
        focusRingColor: '#08f', focusRingWidth: 2,
      } as any),
      getColumnDefs: () => new Map(),
      cellRenderers: new CellRendererRegistry(),
      cellData: () => null,
      getSelection: () => ({ focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set() }),
      getSortModel: () => [],
      getCanvasWidth: () => 800,
      getCanvasHeight: () => 600,
      rowDataSnapshotAt: () => ({}),
      getQuickFilterLowerTerms: () => [],
    });
    r.paint(gc);
    // The very first fillRect call must be the full-canvas bg fill — this is
    // the prerequisite for no-flicker resize (no transparent gap between
    // a freshly-cleared backing store and the next painted frame).
    const calls = (gc.fillRect as any).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual([0, 0, 800, 600]);
  });
});
