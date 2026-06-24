import type { ViewportState } from '../core/viewport';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ResolvedTheme } from '../theming/cssReader';
import type { DirtyRect, PaintLoop } from '../core/paintLoop';
import type { CellRendererRegistry } from './cellRenderers/registry';
import type { CellDataLookup } from './painters/types';
import type { SortModel } from '../types';
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
  getSortModel: () => SortModel;
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
    const newW = Math.round(cssWidth * dpr);
    const newH = Math.round(cssHeight * dpr);
    const styleW = cssWidth + 'px';
    const styleH = cssHeight + 'px';

    // Skip when nothing changed — assigning canvas.width/height clears the
    // backing store even when the value is identical, which would cause
    // resize flicker during rapid ResizeObserver ticks.
    const sameBacking = this.opts.canvas.width === newW && this.opts.canvas.height === newH;
    const sameStyle = this.opts.canvas.style.width === styleW && this.opts.canvas.style.height === styleH;
    if (sameBacking && sameStyle) return;

    if (!sameBacking) {
      this.opts.canvas.width = newW;
      this.opts.canvas.height = newH;
    }
    if (!sameStyle) {
      this.opts.canvas.style.width = styleW;
      this.opts.canvas.style.height = styleH;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The canvas was just cleared by the width/height assignment above. Paint
    // synchronously so it's never left blank between the clear and the next
    // RAF — that gap is what makes browser-resize feel flickery.
    this.paint([]);
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
      sortModel: this.opts.getSortModel(),
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
