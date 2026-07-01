import { describe, it, expect, vi } from 'vitest';
import { totalsCell } from '../src/renderer/cellRenderers/totals';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

/**
 * Cycle 14 / Task 5 — polished `'totals'` cell renderer.
 *
 * The eight cases below cover the leaf decisions called out in
 * `docs/superpowers/plans/notes/cycle-14-aggregation-design.md` § Task 5:
 *   - paint geometry (bg fill discipline + text positioning)
 *   - value formatting (delegated to `valueFormatted`)
 *   - em-dash placeholder for empty / null / undefined totals
 *   - muted fg fall-back to `fg` when `emptyFg` isn't supplied
 *   - column-halign inheritance (right / center / left)
 *   - no cell-edge strokes (gridlines own the row border)
 *   - per-cell override interaction (a `cellClass` painted into
 *     `target.fg/bg/font` propagates into the renderer's fillStyle).
 */

function makeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    translate: vi.fn(),
    scale: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

const baseParams = (over: Partial<CellPaintConfig> = {}): CellPaintConfig => ({
  value: 0,
  valueFormatted: '0',
  bounds: { x: 10, y: 100, w: 120, h: 30 },
  font: '500 13px JetBrains Mono',
  fg: '#0f172a',                // theme.totalsFg (light)
  bg: '#f7f9fb',                // theme.totalsBg (light) — same as prefillColor by default
  borderColor: '#cbd5e1',
  halign: 'right',
  prefillColor: '#f7f9fb',
  isFocused: false,
  isSelected: false,
  isHovered: false,
  isHeader: false,
  emptyFg: '#475569',           // theme.totalsFgMuted (light)
  ...over,
});

describe('totalsCell — value path', () => {
  it('paints the formatted value at the right edge AND vertical midpoint for numeric (halign=right) cells', () => {
    // The trader needs decimal alignment under the column above; this
    // mirrors numberCell's right-edge geometry exactly. If the totals
    // value lands at any other x, the column above and below disagree.
    // The cy assertion guards against a vertical drift — the totals
    // row's text must middle-baseline on the row centre so it visually
    // tracks the data rows above (same 13px font, same baseline).
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: 1234567.89,
      valueFormatted: '$1,234,567.89',
      halign: 'right',
    }));
    expect((gc.fillText as any)).toHaveBeenCalledTimes(1);
    const [text, x, y] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('$1,234,567.89');
    // bounds.x = 10, bounds.w = 120, PADDING = 6 → x at right - 6 = 124.
    expect(x).toBe(10 + 120 - 6);
    // bounds.y = 100, bounds.h = 30 → cy = 115 (middle-baseline).
    expect(y).toBe(100 + 30 / 2);
    expect(gc.cache.textAlign).toBe('right');
    expect(gc.cache.textBaseline).toBe('middle');
  });

  it('honours the column valueFormatter via valueFormatted (renderer never re-formats)', () => {
    // The renderer must paint whatever `valueFormatted` carries — that's
    // the column's `valueFormatter` output as resolved upstream. If the
    // renderer re-stringified `value`, a moneyFormatter would lose its
    // currency symbol on the totals row.
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: 42,
      valueFormatted: '$42.00',
      halign: 'right',
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('$42.00');
    expect(text).not.toBe('42');
  });
});

describe('totalsCell — empty placeholder', () => {
  it('paints blank (empty string) in emptyFg when value AND valueFormatted are both empty', () => {
    // Column without an aggFunc → chunk.totals returns null → byRows
    // threads value: '' / valueFormatted: '' into the renderer. Cell is
    // blank rather than an em-dash; emptyFg is still applied so the
    // canvas fill-style is set correctly even for zero-length text.
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: '',
      valueFormatted: '',
      halign: 'right',
      fg: '#0f172a',
      emptyFg: '#475569',
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('');
    expect(gc.cache.fillStyle).toBe('#475569');
  });

  it('paints blank for null and undefined values too', () => {
    // The empty predicate must catch the three shapes byRows / aggregation
    // can produce: '' (column had no aggFunc), null (worker returned null),
    // undefined (aggFunc resolved but yielded no value e.g. empty filter).
    for (const v of [null, undefined] as const) {
      const gc = makeGc();
      totalsCell.paint(gc, baseParams({
        value: v,
        valueFormatted: '',
        emptyFg: '#475569',
      }));
      const [text] = (gc.fillText as any).mock.calls[0]!;
      expect(text).toBe('');
    }
  });

  it('falls back to fg when emptyFg is unset (defensive — non-totals callers)', () => {
    // emptyFg is populated by applyCellProps only when ctx.isTotals === true.
    // A non-totals caller (or a future refactor that drops the field) must
    // still render cleanly — blank text in the body fg, not transparent.
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: null,
      valueFormatted: '',
      fg: '#0f172a',
      emptyFg: undefined,
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('');
    expect(gc.cache.fillStyle).toBe('#0f172a');
  });
});

describe('totalsCell — column halign inheritance', () => {
  it('places a left-aligned (text) totals value at the left edge + PADDING', () => {
    // A text column's totals cell paints empty in practice (chunk.totals
    // returns null for text columns), but a literal-string aggFunc could
    // produce a value; in either case the em-dash / value must land where
    // the column data lands above it.
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: 'TOTAL',
      valueFormatted: 'TOTAL',
      halign: 'left',
    }));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(10 + 6); // bounds.x + PADDING
    expect(gc.cache.textAlign).toBe('left');
  });

  it('center-aligned columns paint at the cell midpoint', () => {
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: 7,
      valueFormatted: '7',
      halign: 'center',
    }));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(10 + 120 / 2); // bounds.x + bounds.w / 2
    expect(gc.cache.textAlign).toBe('center');
  });
});

describe('totalsCell — paint discipline', () => {
  it('never strokes a cell-edge divider (gridlines pass owns row borders)', () => {
    // Cell renderers must NOT draw cell-edge lines. The top border of the
    // totals row is painted ONCE by gridLinesPainter using
    // theme.totalsBorderTop; if the renderer added its own stroke, the
    // row would double-paint over the body↔totals transition and the
    // hairline would land at the wrong pixel.
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: 100,
      valueFormatted: '100',
    }));
    expect((gc.stroke as any)).not.toHaveBeenCalled();
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
  });

  it('skips fillRect when bg === prefillColor (row-bg bundle already painted it)', () => {
    // The row-bg bundle paints theme.totalsBg across the row in a single
    // pass before the renderer runs. Per-cell bg fills would double-paint
    // and burn pixel budget; the discipline matches textCell / numberCell.
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: 5,
      valueFormatted: '5',
      bg: '#f7f9fb',
      prefillColor: '#f7f9fb',
    }));
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
    expect((gc.fillText as any)).toHaveBeenCalled();
  });
});

describe('totalsCell — per-column renderer override (byRows resolver)', () => {
  it('byRows routes isTotals cells to the column totalsCellRenderer when set, else to "totals"', async () => {
    // The column-level override path: `def.totalsCellRenderer ?? 'totals'`
    // is the resolution rule (see byRows.ts renderer-resolution branch).
    // Spy on the registry's `get(name)` to capture which name is requested
    // per cell. Two columns: one default (no override → 'totals'), one
    // with `totalsCellRenderer: 'number'` (override wins).
    const { paintCellsByRows } = await import('../src/renderer/painters/byRows');
    const { CellRendererRegistry } = await import('../src/renderer/cellRenderers/registry');
    const { totalsCell: tc } = await import('../src/renderer/cellRenderers/totals');
    const { numberCell, headerCell } = await import('../src/renderer/cellRenderers/registry');

    const reg = new CellRendererRegistry();
    reg.register('totals', tc);
    reg.register('number', numberCell);
    reg.register('header', headerCell);
    const getSpy = vi.spyOn(reg, 'get');

    const totalsSubgrid = {
      type: 'totals' as const,
      isHeader: false, isData: false, isTotals: true, isFooter: false,
      getRowCount: () => 1,
      getRowHeight: () => 30,
      getCell: (_l: number, colId: string) => ({
        value: colId === 'a' ? 100 : null,
        valueFormatted: colId === 'a' ? '100' : '',
      }),
    };

    const columnDefs = new Map<string, any>([
      ['a', {
        colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity,
        cellDataType: 'number', cellRenderer: 'number',
        sortable: true, resizable: true, editable: false,
        suppressFloatingFilterButton: false,
        totalsCellRenderer: undefined, // default → 'totals'
      }],
      ['b', {
        colId: 'b', headerName: 'B', minWidth: 30, maxWidth: Infinity,
        cellDataType: 'number', cellRenderer: 'number',
        sortable: true, resizable: true, editable: false,
        suppressFloatingFilterButton: false,
        totalsCellRenderer: 'number', // explicit override → 'number'
      }],
    ]);

    const theme: any = {
      font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
      borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
      rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
      flashFromColor: '#ffeb3b', flashToColor: 'transparent',
      totalsBg: '#f7f9fb', totalsFg: '#0f172a', totalsBorderTop: '#cbd5e1',
      totalsFgMuted: '#475569', totalsFontWeight: 500,
      pinnedRowBg: '#fbf8f3', pinnedRowFg: '#0f172a', pinnedRowBorder: '#cbd5e1',
      rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
      cellClassVariants: new Map(), headerClassVariants: new Map(),
    };

    const vs: any = {
      visibleColumns: [
        { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
        { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
      ],
      visibleRows: [
        { rowIndex: 0, subgrid: totalsSubgrid, localRowIndex: 0, top: 0, bottom: 30, height: 30 },
      ],
      firstRow: 0, lastRow: 0,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 0, bodyRight: 200, bodyTop: 0, bodyBottom: 30,
      bodyWidth: 200, bodyHeight: 30,
      contentWidth: 200, contentHeight: 30, maxScrollLeft: 0, maxScrollTop: 0,
    };

    const gc = makeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs, cellRenderers: reg,
      cellData: () => ({ value: '', valueFormatted: '' }),
      selection: { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set() },
      sortModel: [], rowDataSnapshotAt: () => ({}),
      quickFilterLowerTerms: [],
    });

    // Column 'a' (no override) → 'totals'; column 'b' (override) → 'number'.
    const requested = getSpy.mock.calls.map((c) => c[0]);
    expect(requested).toContain('totals');
    expect(requested).toContain('number');
    // No data renderer should be invoked for the column without an override
    // — that was the regression the override-resolution rule was added to
    // prevent (a numeric-typed column would otherwise paint the totals via
    // 'number', missing the em-dash placeholder for empty totals).
    const aRequest = getSpy.mock.calls.find((c, i) => i === 0); // first cell painted
    expect(aRequest?.[0]).toBe('totals');
  });
});

describe('totalsCell — per-cell override interaction', () => {
  it('reads fg / bg / font from the (potentially mutated) config — cellClass works', () => {
    // A column with cellClassRules that paints negative sums red mutates
    // target.fg via applyCellProps' class-variant pass BEFORE the renderer
    // runs. The renderer must paint with that mutated fg — not with
    // theme.totalsFg directly — so the override flows through.
    const gc = makeGc();
    totalsCell.paint(gc, baseParams({
      value: -1000,
      valueFormatted: '-$1,000.00',
      fg: '#dc2626',  // class-variant tint for negative sums
      bg: '#fee2e2',  // class-variant bg
      prefillColor: '#f7f9fb',
      font: '600 13px JetBrains Mono',  // class-variant weight bump
    }));
    // bg mutation produced a per-cell fillRect (bg !== prefillColor)
    expect((gc.fillRect as any)).toHaveBeenCalled();
    // fg propagated into the text fillStyle
    expect((gc.fillText as any)).toHaveBeenCalled();
    expect(gc.cache.fillStyle).toBe('#dc2626');
    // font propagated unchanged
    expect(gc.cache.font).toBe('600 13px JetBrains Mono');
  });
});
