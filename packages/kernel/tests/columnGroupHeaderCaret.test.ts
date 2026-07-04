import { describe, it, expect, vi } from 'vitest';
import { paintCellsByRows, groupHasToggleEffect } from '../src/renderer/painters/byRows';
import { CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
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
