import { describe, it, expect, vi, beforeAll } from 'vitest';
import { paintCellsByRows, groupHasToggleEffect } from '../src/renderer/painters/byRows';
import { CellRendererRegistry, headerCell, ellipsizeToWidth } from '../src/renderer/cellRenderers/registry';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import { HeaderGroupSubgrid } from '../src/core/subgrid';
import { resolveColumnTree } from '../src/core/columnTree';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

// Task 10 — regular (non-pivot) column-group headers now paint the same
// leading expand/collapse caret pivot result groups already had, but ONLY
// when collapsing the group actually hides something (ag-grid parity: a
// sub-group child, or a direct `columnGroupShow: 'open'|'closed'` leaf).
// This file covers both the extracted predicate (`groupHasToggleEffect`)
// and its wiring into the group-header paint branch in `byRows.ts`.

function fakeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(),
    translate: vi.fn(), scale: vi.fn(),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
};

const cellData = { getRowData: () => undefined } as any;
const selection = { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() };

describe('groupHasToggleEffect', () => {
  it('is false when every direct child is an always-visible leaf', () => {
    const tree = resolveColumnTree([
      { groupId: 'g', headerName: 'G', children: [{ field: 'x' }, { field: 'y' }] },
    ]);
    expect(groupHasToggleEffect(tree.groupById.get('g')!)).toBe(false);
  });

  it('is true when a direct child leaf has columnGroupShow: "open"', () => {
    const tree = resolveColumnTree([
      { groupId: 'g', headerName: 'G', children: [{ field: 'x' }, { field: 'y', columnGroupShow: 'open' }] },
    ]);
    expect(groupHasToggleEffect(tree.groupById.get('g')!)).toBe(true);
  });

  it('is true when a direct child leaf has columnGroupShow: "closed"', () => {
    const tree = resolveColumnTree([
      { groupId: 'g', headerName: 'G', children: [{ field: 'x' }, { field: 'y', columnGroupShow: 'closed' }] },
    ]);
    expect(groupHasToggleEffect(tree.groupById.get('g')!)).toBe(true);
  });

  it('is true when a direct child is a sub-group (nested groups)', () => {
    const tree = resolveColumnTree([
      {
        groupId: 'outer', headerName: 'Outer',
        children: [{ field: 'a' }, { groupId: 'inner', headerName: 'Inner', children: [{ field: 'b' }] }],
      },
    ]);
    expect(groupHasToggleEffect(tree.groupById.get('outer')!)).toBe(true);
  });
});

describe('paintCellsByRows — regular column-group header caret', () => {
  function paintOneGroupHeader(opts: {
    tree: ReturnType<typeof resolveColumnTree>;
    leafIds: string[];
    open: boolean;
  }): CellPaintConfig {
    const { tree, leafIds, open } = opts;
    const groupSubgrid = new HeaderGroupSubgrid(() => tree, () => 24, 0, () => leafIds);
    const captured: CellPaintConfig[] = [];
    const spyReg = new CellRendererRegistry();
    spyReg.register('header', {
      paint: (_gc, p) => { captured.push({ ...p, bounds: { ...p.bounds } }); },
    });
    spyReg.register('text', { paint: vi.fn() });
    spyReg.register('number', { paint: vi.fn() });

    const colDefs = new Map<string, ResolvedColDef>(
      tree.leaves.map((l) => [l.colId, l as ResolvedColDef]),
    );

    const visibleColumns = leafIds.map((colId, i) => ({
      colId, index: i, left: i * 100, right: (i + 1) * 100, width: 100,
    }));

    const vs: ViewportState = {
      visibleColumns,
      visibleRows: [
        { rowIndex: 0, subgrid: groupSubgrid, localRowIndex: 0, top: 0, bottom: 24, height: 24 },
      ],
      firstRow: 0, lastRow: -1,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 0, bodyRight: visibleColumns.length * 100, bodyTop: 24, bodyBottom: 24,
      bodyWidth: visibleColumns.length * 100, bodyHeight: 0,
      contentWidth: visibleColumns.length * 100, contentHeight: 0, maxScrollLeft: 0, maxScrollTop: 0,
    };

    const gc = fakeGc();
    paintCellsByRows(gc, {
      viewport: vs, theme, columnDefs: colDefs, cellRenderers: spyReg,
      cellData, selection, sortModel: [], rowDataSnapshotAt: () => ({}), quickFilterLowerTerms: [],
      getColumnGroupOpen: () => open,
    });
    expect(captured.length).toBe(1);
    return captured[0]!;
  }

  it('sets no expand prop for a group whose children are all always-visible', () => {
    const tree = resolveColumnTree([
      { groupId: 'always', headerName: 'Always', children: [{ field: 'x' }, { field: 'y' }] },
    ]);
    const cfg = paintOneGroupHeader({ tree, leafIds: ['x', 'y'], open: true });
    expect(cfg.pivotGroupExpand).toBeUndefined();
  });

  it('sets pivotGroupExpand="open" for an OPEN group with an "open"-tagged leaf child', () => {
    const tree = resolveColumnTree([
      { groupId: 'g', headerName: 'G', children: [{ field: 'x' }, { field: 'y', columnGroupShow: 'open' }] },
    ]);
    const cfg = paintOneGroupHeader({ tree, leafIds: ['x', 'y'], open: true });
    expect(cfg.pivotGroupExpand).toBe('open');
  });

  it('sets pivotGroupExpand="closed" for a CLOSED group with an "open"-tagged leaf child', () => {
    const tree = resolveColumnTree([
      { groupId: 'g', headerName: 'G', children: [{ field: 'x' }, { field: 'y', columnGroupShow: 'open' }] },
    ]);
    const cfg = paintOneGroupHeader({ tree, leafIds: ['x', 'y'], open: false });
    expect(cfg.pivotGroupExpand).toBe('closed');
  });

  it('sets the expand prop for a group with a nested sub-group child', () => {
    const tree = resolveColumnTree([
      {
        groupId: 'outer', headerName: 'Outer',
        children: [{ field: 'a' }, { groupId: 'inner', headerName: 'Inner', children: [{ field: 'b' }] }],
      },
    ]);
    const cfg = paintOneGroupHeader({ tree, leafIds: ['a', 'b'], open: true });
    expect(cfg.pivotGroupExpand).toBe('open');
  });
});

// Task 11 — the group-header caret must not overlap the caption. A long
// caption in a narrow group span used to be cell-clipped at the group's
// right edge while the caret (placed right after the caption, clamped to
// that same edge) drew on top of it. The fix reserves the caret's
// footprint in the caption's rendered width up front — ellipsizing the
// caption before it reaches the caret — instead of only clamping the
// caret's own position.

describe('ellipsizeToWidth', () => {
  // Synthetic measure: 10 units per character (mirrors the brief's guidance
  // for a simple, deterministic width function).
  const measure = (t: string) => t.length * 10;

  it('returns the input unchanged when it already fits', () => {
    expect(ellipsizeToWidth(measure, 'Group', 100)).toBe('Group');
  });

  it('trims and appends an ellipsis so the result measures <= maxW', () => {
    const result = ellipsizeToWidth(measure, 'Very Long Group Caption', 60);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toBe('Very Long Group Caption');
    expect(measure(result)).toBeLessThanOrEqual(60);
  });

  it('returns just the ellipsis when only a sliver of width is available', () => {
    const result = ellipsizeToWidth(measure, 'Group', 10);
    expect(result).toBe('…');
    expect(measure(result)).toBeLessThanOrEqual(10);
  });

  it('returns empty string when maxW <= 0', () => {
    expect(ellipsizeToWidth(measure, 'Group', 0)).toBe('');
    expect(ellipsizeToWidth(measure, 'Group', -5)).toBe('');
  });
});

describe('headerCell.paint — Task 11 caret space reservation (group headers)', () => {
  // Constants mirrored from registry.ts (not exported — the module keeps
  // them internal; tests pin the same values so the assertions stay
  // meaningful if the source constants ever drift, a mismatch here would
  // surface as a failing width/position assertion below).
  const HEADER_PADDING = 8;
  const PIVOT_CHEVRON_SIZE = 14;
  const PIVOT_CHEVRON_GAP = 4;

  function fakePaintGc(): CachedContext2D {
    const ctx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(),
      translate: vi.fn(), scale: vi.fn(),
      // 10 units per character — deterministic + easy to reason about.
      measureText: (t: string) => ({ width: t.length * 10 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
      lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
    };
    ctx.cache = new Proxy(ctx, {
      get(target, key) { return target[key]; },
      set(target, key, value) { target[key] = value; return true; },
    });
    ctx.clearFill = vi.fn();
    return ctx as CachedContext2D;
  }

  function baseHeaderParams(over: Partial<CellPaintConfig> = {}): CellPaintConfig {
    return {
      value: '', valueFormatted: '',
      bounds: { x: 0, y: 0, w: 100, h: 32 },
      font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc',
      halign: 'left', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: true,
      ...over,
    };
  }

  // drawIcon() builds a Path2D per icon name; happy-dom doesn't ship one.
  beforeAll(() => {
    if (typeof (globalThis as any).Path2D === 'undefined') {
      (globalThis as any).Path2D = class {
        constructor(_d?: string) {}
      };
    }
  });

  /** Recovers the caret's cx from the `ctx.translate(cx - size/2, cy - size/2)`
   *  call `drawIcon` makes — the fake gc doesn't intercept the `drawIcon`
   *  module import, but it does record every `translate` call. */
  function caretCxFromTranslateCalls(gc: CachedContext2D): number {
    const calls = (gc.translate as any).mock.calls;
    const [tx] = calls[calls.length - 1]!;
    return tx + PIVOT_CHEVRON_SIZE / 2;
  }

  it('NARROW group header: ellipsizes the caption so it never reaches the caret, and the caret stays inside the cell', () => {
    const gc = fakePaintGc();
    const bounds = { x: 0, y: 0, w: 90, h: 32 };
    const longCaption = 'Very Long Column Group Caption';
    headerCell.paint(gc, baseHeaderParams({
      value: longCaption, valueFormatted: longCaption,
      bounds, pivotGroupExpand: 'closed',
    }));

    const maxCapW = Math.max(0, bounds.w - HEADER_PADDING - (PIVOT_CHEVRON_GAP + PIVOT_CHEVRON_SIZE + HEADER_PADDING));
    const [drawnText] = (gc.fillText as any).mock.calls[0]!;
    expect(drawnText).not.toBe(longCaption); // ellipsized, not the raw caption
    expect(drawnText.endsWith('…')).toBe(true);
    expect(drawnText.length * 10).toBeLessThanOrEqual(maxCapW); // reserved footprint honored

    const iconCx = caretCxFromTranslateCalls(gc);
    const maxIconCx = bounds.x + bounds.w - HEADER_PADDING - PIVOT_CHEVRON_SIZE / 2;
    expect(iconCx).toBeLessThanOrEqual(maxIconCx); // caret never overflows the cell
    // Caret sits immediately after the (ellipsized) drawn caption, not
    // wherever the untruncated caption would have ended.
    const textX = bounds.x + HEADER_PADDING;
    expect(iconCx).toBeCloseTo(textX + drawnText.length * 10 + PIVOT_CHEVRON_GAP + PIVOT_CHEVRON_SIZE / 2, 5);
  });

  it('WIDE group header: draws the full caption untouched, caret immediately after it', () => {
    const gc = fakePaintGc();
    const bounds = { x: 0, y: 0, w: 400, h: 32 };
    const caption = 'Valuation';
    headerCell.paint(gc, baseHeaderParams({
      value: caption, valueFormatted: caption,
      bounds, pivotGroupExpand: 'open',
    }));

    const [drawnText] = (gc.fillText as any).mock.calls[0]!;
    expect(drawnText).toBe(caption); // fits comfortably — no ellipsis needed

    const textX = bounds.x + HEADER_PADDING;
    const capW = caption.length * 10;
    const iconCx = caretCxFromTranslateCalls(gc);
    expect(iconCx).toBeCloseTo(textX + capW + PIVOT_CHEVRON_GAP + PIVOT_CHEVRON_SIZE / 2, 5);
  });

  it('leaf header (no pivotGroupExpand): caption is drawn verbatim, unaffected by the reservation logic', () => {
    const gc = fakePaintGc();
    const bounds = { x: 0, y: 0, w: 60, h: 32 }; // narrow enough that the group path WOULD ellipsize
    const caption = 'Very Long Leaf Column Name';
    headerCell.paint(gc, baseHeaderParams({
      value: caption, valueFormatted: caption,
      bounds, // pivotGroupExpand left undefined — plain leaf header
    }));
    const [drawnText] = (gc.fillText as any).mock.calls[0]!;
    expect(drawnText).toBe(caption);
  });

  it('sort header (no pivotGroupExpand): caption drawn verbatim; sort chevron placement unchanged', () => {
    const gc = fakePaintGc();
    const bounds = { x: 0, y: 0, w: 60, h: 32 };
    const caption = 'Very Long Sortable Column Name';
    headerCell.paint(gc, baseHeaderParams({
      value: caption, valueFormatted: caption,
      bounds, sortDirection: 'asc',
    }));
    const [drawnText] = (gc.fillText as any).mock.calls[0]!;
    expect(drawnText).toBe(caption);
    const iconCx = caretCxFromTranslateCalls(gc);
    const SORT_ICON_PAD = 8, SORT_ICON_SIZE = 14;
    expect(iconCx).toBeCloseTo(bounds.x + bounds.w - SORT_ICON_PAD - SORT_ICON_SIZE / 2, 5);
  });
});
