import type { ViewportState } from '../core/viewport';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ResolvedTheme } from '../theming/cssReader';
import type { DirtyRect, PaintLoop } from '../core/paintLoop';
import type { CellRendererRegistry } from './cellRenderers/registry';
import type { CellDataLookup } from './painters/types';
import { paintHeader } from './painters/headerPainter';
import { paintBody } from './painters/bodyPainter';
import { paintPinned } from './painters/pinnedPainter';
import { paintOverlay } from './painters/overlayPainter';

export type { CellDataLookup };

export interface RendererOpts {
  canvas: HTMLCanvasElement;
  paintLoop: PaintLoop;
  getViewport: () => ViewportState;
  getTheme: () => ResolvedTheme;
  getColumnDefs: () => Map<string, ResolvedColDef>;
  cellRenderers: CellRendererRegistry;
  cellData: CellDataLookup;
  getSelection: () => {
    focusedRowIndex: number | null;
    focusedColId: string | null;
    selectedRowIndices: Set<number>;
  };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private opts: RendererOpts) {
    const c = opts.canvas.getContext('2d');
    if (!c) throw new Error('[cgrid] failed to get 2d context');
    this.ctx = c;
  }

  syncSize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.opts.canvas.width = Math.round(cssWidth * dpr);
    this.opts.canvas.height = Math.round(cssHeight * dpr);
    this.opts.canvas.style.width = cssWidth + 'px';
    this.opts.canvas.style.height = cssHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.opts.paintLoop.markFullDirty();
  }

  paint(_dirtyRects: DirtyRect[]): void {
    // Foundation: dirty-rect filtering is a future optimization; full paint per frame.
    const ctx = this.ctx;
    const pctx = {
      viewport: this.opts.getViewport(),
      theme: this.opts.getTheme(),
      columnDefs: this.opts.getColumnDefs(),
      cellRenderers: this.opts.cellRenderers,
      cellData: this.opts.cellData,
      selection: this.opts.getSelection(),
    };
    ctx.fillStyle = pctx.theme.bg;
    ctx.fillRect(0, 0, this.opts.canvas.width, this.opts.canvas.height);
    paintHeader(ctx, pctx);
    paintPinned(ctx, pctx, 'left');
    paintBody(ctx, pctx);
    paintPinned(ctx, pctx, 'right');
    paintOverlay(ctx, pctx);
  }
}
