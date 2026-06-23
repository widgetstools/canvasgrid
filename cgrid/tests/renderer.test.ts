import { describe, it, expect, vi } from 'vitest';
import { Renderer } from '../src/renderer/renderer';
import { PaintLoop } from '../src/core/paintLoop';
import { CellRendererRegistry } from '../src/renderer/cellRenderers/registry';

function fakeCanvas() {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), measureText: () => ({ width: 50 }),
    setTransform: vi.fn(), clearRect: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '', lineWidth: 1, globalAlpha: 1,
  };
  const canvas = { width: 0, height: 0, style: {} as CSSStyleDeclaration, getContext: () => ctx } as any;
  return { canvas, ctx };
}

describe('Renderer', () => {
  it('syncSize sets canvas width/height to css * dpr', () => {
    const { canvas, ctx } = fakeCanvas();
    const loop = new PaintLoop(() => {});
    const r = new Renderer({
      canvas, paintLoop: loop,
      getViewport: () => ({} as any),
      getTheme: () => ({} as any),
      getColumnDefs: () => new Map(),
      cellRenderers: new CellRendererRegistry(),
      cellData: () => null,
      getSelection: () => ({ focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set() }),
    });
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    r.syncSize(800, 600);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });
});
