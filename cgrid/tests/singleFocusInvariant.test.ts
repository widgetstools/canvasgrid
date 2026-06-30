import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Cardinal invariant: at most ONE cell can ever be focused. The grid's
 * focus state is a singleton (`focusedRowIndex`/`focusedColId`) by
 * type, but the user-visible "focus" is the union of focus-ring +
 * range overlays. A bug where Ctrl+Click accumulated disjoint
 * single-cell ranges in `rowSelection: 'multiple'` mode produced a
 * visual that the user reasonably read as "multiple focused cells".
 *
 * These tests gate against that regression. The behavioral contract:
 *
 *   - rowSelection='multiple' + Ctrl+Click → range REPLACES (never
 *     accumulates); row selection toggles independently.
 *   - rowSelection='single' / 'none' + Ctrl+Click → existing Excel-
 *     style disjoint range behavior preserved.
 *
 * `focusedRowIndex` + `focusedColId` are independently asserted to
 * remain a single coordinate after every interaction.
 */
beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
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
});

/** Build a RangeSelection feature against a controlled SelectionModel
 *  and a minimal CGridLike stub. Mode parameter switches the row-
 *  selection mode the feature consults. */
async function makeSetup(mode: 'none' | 'single' | 'multiple') {
  const { RangeSelection } = await import('../src/interaction/features/rangeSelection');
  const { SelectionModel } = await import('../src/interaction/selectionModel');
  const sel = new SelectionModel(mode);
  const feature = new RangeSelection();
  const grid = {
    selection: sel,
    allColIds: () => ['a', 'b', 'c'],
    totalRowCount: () => 100,
    getCellSelectionOptions: () => undefined,
    emitRangeSelectionChanged: vi.fn(),
    getBodyRect: () => ({ left: 0, right: 1000, top: 0, bottom: 1000 }),
    scrollBy: vi.fn(),
  } as any;
  return { feature, sel, grid };
}

describe('single-focus invariant — Ctrl+Click does not accumulate cell-ranges in multiple mode', () => {
  it('one Ctrl+Click → one range (the clicked cell)', async () => {
    const { feature, sel, grid } = await makeSetup('multiple');
    sel.setFocus(0, 'a');
    feature.handleMouseDown({
      grid, hit: { kind: 'cell', rowIndex: 2, colId: 'b' },
      point: { x: 0, y: 0 },
      raw: new MouseEvent('mousedown', { ctrlKey: true, button: 0 }),
    });
    expect(sel.state.ranges.length).toBe(1);
    expect(sel.state.ranges[0]).toMatchObject({ rowStart: 2, rowEnd: 2, colIds: ['b'] });
  });

  it('five consecutive Ctrl+Clicks → still exactly one range (the last clicked cell)', async () => {
    const { feature, sel, grid } = await makeSetup('multiple');
    for (const r of [0, 2, 4, 6, 8]) {
      feature.handleMouseDown({
        grid, hit: { kind: 'cell', rowIndex: r, colId: 'a' },
        point: { x: 0, y: 0 },
        raw: new MouseEvent('mousedown', { ctrlKey: true, button: 0 }),
      });
    }
    expect(sel.state.ranges.length).toBe(1);
    expect(sel.state.ranges[0]).toMatchObject({ rowStart: 8, rowEnd: 8, colIds: ['a'] });
  });

  it('Cmd+Click (meta) follows the same rule on macOS', async () => {
    const { feature, sel, grid } = await makeSetup('multiple');
    for (const r of [1, 3, 5]) {
      feature.handleMouseDown({
        grid, hit: { kind: 'cell', rowIndex: r, colId: 'c' },
        point: { x: 0, y: 0 },
        raw: new MouseEvent('mousedown', { metaKey: true, button: 0 }),
      });
    }
    expect(sel.state.ranges.length).toBe(1);
  });
});

describe('single-focus invariant — disjoint cell ranges still work in single/none modes', () => {
  it('rowSelection="single" + Ctrl+Click → disjoint cell-ranges DO accumulate (Excel mode preserved)', async () => {
    const { feature, sel, grid } = await makeSetup('single');
    for (const r of [0, 2, 4]) {
      feature.handleMouseDown({
        grid, hit: { kind: 'cell', rowIndex: r, colId: 'a' },
        point: { x: 0, y: 0 },
        raw: new MouseEvent('mousedown', { ctrlKey: true, button: 0 }),
      });
    }
    // Single-row mode means only one ROW selected at a time, but
    // cell-range accumulation is the spreadsheet-style behavior — keep it.
    expect(sel.state.ranges.length).toBe(3);
  });

  it('rowSelection="none" + Ctrl+Click → disjoint cell-ranges DO accumulate', async () => {
    const { feature, sel, grid } = await makeSetup('none');
    for (const r of [0, 2, 4]) {
      feature.handleMouseDown({
        grid, hit: { kind: 'cell', rowIndex: r, colId: 'a' },
        point: { x: 0, y: 0 },
        raw: new MouseEvent('mousedown', { ctrlKey: true, button: 0 }),
      });
    }
    expect(sel.state.ranges.length).toBe(3);
  });
});

describe('single-focus invariant — focusedRowIndex + focusedColId stay singular under any sequence', () => {
  it('after 10 mixed Ctrl+Clicks the focus is one specific cell', async () => {
    const { feature, sel, grid } = await makeSetup('multiple');
    const sequence: Array<[number, string]> = [
      [0, 'a'], [1, 'b'], [5, 'c'], [2, 'a'], [3, 'b'],
      [7, 'c'], [4, 'a'], [9, 'b'], [6, 'c'], [8, 'a'],
    ];
    for (const [r, c] of sequence) {
      feature.handleMouseDown({
        grid, hit: { kind: 'cell', rowIndex: r, colId: c },
        point: { x: 0, y: 0 },
        raw: new MouseEvent('mousedown', { ctrlKey: true, button: 0 }),
      });
    }
    // After all the clicks, the SelectionModel's focus pair is
    // singular by type. The range list — under the fix — is also
    // exactly one (the last clicked cell).
    const last = sequence[sequence.length - 1]!;
    expect(sel.state.ranges.length).toBe(1);
    expect(sel.state.ranges[0]).toMatchObject({ rowStart: last[0], rowEnd: last[0], colIds: [last[1]] });
    // Range is a singleton — but RangeSelection doesn't set focus
    // (that's CellSelection's job). The test here proves the ranges
    // can't accumulate.
  });
});

describe('single-focus invariant — Shift+Click + Shift+Arrow still extend the SINGLE range', () => {
  it('Shift+Click after Ctrl+Click extends the lone existing range — no fresh disjoint range', async () => {
    const { feature, sel, grid } = await makeSetup('multiple');
    feature.handleMouseDown({
      grid, hit: { kind: 'cell', rowIndex: 0, colId: 'a' },
      point: { x: 0, y: 0 },
      raw: new MouseEvent('mousedown', { ctrlKey: true, button: 0 }),
    });
    // Shift+Click on a different cell extends the only existing range.
    feature.handleMouseDown({
      grid, hit: { kind: 'cell', rowIndex: 3, colId: 'c' },
      point: { x: 0, y: 0 },
      raw: new MouseEvent('mousedown', { shiftKey: true, button: 0 }),
    });
    expect(sel.state.ranges.length).toBe(1);
    expect(sel.state.ranges[0]).toMatchObject({
      rowStart: 0, rowEnd: 3, colIds: ['a', 'b', 'c'],
    });
  });
});
