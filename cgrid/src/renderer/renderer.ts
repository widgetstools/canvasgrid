import type { ViewportState } from '../core/viewport';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ResolvedTheme } from '../theming/cssReader';
import type { CellRendererRegistry } from './cellRenderers/registry';
import type { CellDataLookup } from './painters/types';
import type { SortModel, SelectionRange } from '../types';
import type { CachedContext2D } from './gc';
import { paintCellsByRows } from './painters/byRows';
import { paintGridLines } from './painters/gridLinesPainter';
import { paintOverlay } from './painters/overlayPainter';
import { paintRangeOverlay } from './painters/rangeOverlayPainter';

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
    /** Cycle 9 / Task 3 — active cell-range selections from the
     *  `SelectionModel`. Forwarded into `PainterCtx.selection` so the
     *  rangeOverlayPainter can render the active ranges. */
    ranges: SelectionRange[];
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
  /**
   * Cycle 7 / Task 7 — current pre-lowercased quick-filter terms (or `[]`
   * when no quick filter is active). Forwarded into `PainterCtx` so the
   * cell painter can tint matching cells with `theme.quickFilterMatchBg`.
   */
  getQuickFilterLowerTerms: () => readonly string[];
  /**
   * Cycle 9 / Task 5 — when true, the range overlay painter draws a 6×6
   * fill handle at the bottom-right of the last range. Sourced from
   * `CGridOptions.enableFillHandle` per paint so a runtime
   * `setGridOption('enableFillHandle', true)` lights up immediately.
   */
  getShowFillHandle: () => boolean;
  /**
   * Cycle 12 / Task 2 — band-aware cell bounds resolver shared by every
   * overlay painter. Returns `null` whenever the cell straddles or has
   * scrolled outside its column's band, so painters never need to
   * reimplement the band-clip math. Backed by
   * `CGrid.getVisibleCellBounds`.
   */
  getVisibleCellBounds: (rowIndex: number, colId: string) =>
    { x: number; y: number; w: number; h: number } | null;
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
      quickFilterLowerTerms: this.opts.getQuickFilterLowerTerms(),
      showFillHandle: this.opts.getShowFillHandle(),
      getVisibleCellBounds: this.opts.getVisibleCellBounds,
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
    // Cycle 9 / Task 3 — range overlay paints translucent fill + opaque
    // border per active range. Runs after the focus-ring overlay so the
    // range border doesn't cut into the focus ring of an interior cell.
    paintRangeOverlay(gc, pctx);
  }
}
