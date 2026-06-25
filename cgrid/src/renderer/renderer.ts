import type { ViewportState } from '../core/viewport';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ResolvedTheme } from '../theming/cssReader';
import type { CellRendererRegistry } from './cellRenderers/registry';
import type { CellDataLookup } from './painters/types';
import type { SortModel } from '../types';
import type { CachedContext2D } from './gc';
import { paintCellsByRows } from './painters/byRows';
import { paintGridLines } from './painters/gridLinesPainter';
import { paintOverlay } from './painters/overlayPainter';

export type { CellDataLookup };

export interface RendererOpts {
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
  /** Total drawable width in CSS px (matches CGridCanvas.bounds.width). */
  getCanvasWidth: () => number;
  /** Total drawable height in CSS px (matches CGridCanvas.bounds.height). */
  getCanvasHeight: () => number;
  /**
   * Synchronous row snapshot — keyed by colId. Forwarded into `PainterCtx`
   * for `cellClassRules` / function-form `cellStyle` callbacks.
   * Cycle 6 / Task 7.
   */
  rowDataSnapshotAt: (rowIndex: number) => Record<string, unknown>;
}

export class Renderer {
  constructor(private opts: RendererOpts) {}

  paint(gc: CachedContext2D): void {
    const pctx = {
      viewport: this.opts.getViewport(),
      theme: this.opts.getTheme(),
      columnDefs: this.opts.getColumnDefs(),
      cellRenderers: this.opts.cellRenderers,
      cellData: this.opts.cellData,
      selection: this.opts.getSelection(),
      sortModel: this.opts.getSortModel(),
      rowDataSnapshotAt: this.opts.rowDataSnapshotAt,
    };
    // Fill the entire drawable area with theme bg as the FIRST instruction so
    // there's no transparent moment between the prior frame's pixels (or a
    // freshly-cleared backing store after a canvas.width assignment) and the
    // grid content. CGridCanvas sized the canvas to CSS px so we draw in CSS px.
    const w = this.opts.getCanvasWidth();
    const h = this.opts.getCanvasHeight();
    gc.cache.fillStyle = pctx.theme.bg;
    gc.fillRect(0, 0, w, h);
    paintCellsByRows(gc, pctx);
    // Gridlines run after all cell paints so they sit on top with no double-stroked
    // seams. Overlay (focus ring) goes last so it sits above the gridlines.
    paintGridLines(gc, pctx);
    paintOverlay(gc, pctx);
  }
}
