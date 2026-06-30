import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Cycle 24 follow-up — conventional keyboard parity with ag-grid.
 *
 * Wires three missing shortcuts that match ag-grid's documented
 * cell-range behaviour:
 *   • Delete       — clear every cell in the active range(s)
 *   • Ctrl+D       — fill down: copy the top row of the range to
 *                    every other row in the same range
 *   • Shift+Space  — extend / toggle a row range from the anchor
 *                    (mirror of Shift+Click on a row)
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

describe('conventional / Delete — clear cells in selected range', () => {
  it('routes Delete through KeyboardShortcuts to grid.clearSelectedCells', async () => {
    const { KeyboardShortcuts } = await import('../src/interaction/features/keyboardShortcuts');
    const feature = new KeyboardShortcuts();
    const clearSelectedCells = vi.fn();
    feature.handleKeyDown({
      grid: {
        isEditing: () => false,
        isClipboardApiSuppressed: () => false,
        isClipboardPasteSuppressed: () => false,
        selection: { getRanges: () => [{ rowStart: 0, rowEnd: 2, colIds: ['a', 'b'] }] },
        clearSelectedCells,
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'Delete' }),
    });
    expect(clearSelectedCells).toHaveBeenCalled();
  });

  it('Delete is a no-op when no ranges are selected', async () => {
    const { KeyboardShortcuts } = await import('../src/interaction/features/keyboardShortcuts');
    const feature = new KeyboardShortcuts();
    const clearSelectedCells = vi.fn();
    feature.handleKeyDown({
      grid: {
        isEditing: () => false,
        isClipboardApiSuppressed: () => false,
        isClipboardPasteSuppressed: () => false,
        selection: { getRanges: () => [] },
        clearSelectedCells,
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'Delete' }),
    });
    expect(clearSelectedCells).not.toHaveBeenCalled();
  });

  it('Delete defers to the editor when editing — does NOT clear the range', async () => {
    const { KeyboardShortcuts } = await import('../src/interaction/features/keyboardShortcuts');
    const feature = new KeyboardShortcuts();
    const clearSelectedCells = vi.fn();
    feature.handleKeyDown({
      grid: {
        isEditing: () => true,
        isClipboardApiSuppressed: () => false,
        isClipboardPasteSuppressed: () => false,
        selection: { getRanges: () => [{ rowStart: 0, rowEnd: 2, colIds: ['a'] }] },
        clearSelectedCells,
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'Delete' }),
    });
    expect(clearSelectedCells).not.toHaveBeenCalled();
  });
});

describe('conventional / Ctrl+D — fill down', () => {
  it('routes Ctrl+D through KeyboardShortcuts to grid.fillDown', async () => {
    const { KeyboardShortcuts } = await import('../src/interaction/features/keyboardShortcuts');
    const feature = new KeyboardShortcuts();
    const fillDown = vi.fn();
    feature.handleKeyDown({
      grid: {
        isEditing: () => false,
        isClipboardApiSuppressed: () => false,
        isClipboardPasteSuppressed: () => false,
        selection: { getRanges: () => [{ rowStart: 0, rowEnd: 5, colIds: ['a', 'b'] }] },
        fillDown,
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }),
    });
    expect(fillDown).toHaveBeenCalled();
  });

  it('Ctrl+D no-ops when no multi-row range exists', async () => {
    const { KeyboardShortcuts } = await import('../src/interaction/features/keyboardShortcuts');
    const feature = new KeyboardShortcuts();
    const fillDown = vi.fn();
    feature.handleKeyDown({
      grid: {
        isEditing: () => false,
        isClipboardApiSuppressed: () => false,
        isClipboardPasteSuppressed: () => false,
        selection: { getRanges: () => [{ rowStart: 3, rowEnd: 3, colIds: ['a'] }] },
        fillDown,
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }),
    });
    expect(fillDown).not.toHaveBeenCalled();
  });
});

describe('conventional / Shift+Space — extend row range from anchor', () => {
  it('Shift+Space with no prior selection seeds a single-row toggle', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const feature = new CellSelection();
    const toggleMulti = vi.fn();
    const range = vi.fn();
    feature.handleKeyDown({
      grid: {
        selection: {
          state: { focusedRowIndex: 5, focusedColId: 'a', selectedRowIndices: new Set() },
          toggleMulti, range, setFocusAndCollapseRanges: vi.fn(), addRange: vi.fn(),
          extendLastRangeToCell: vi.fn(), setFocus: vi.fn(),
          selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn(),
          getRanges: () => [],
        },
        allColIds: () => ['a', 'b'],
        totalRowCount: () => 100,
        isEditing: () => false,
        getEditingFlags: () => ({} as any),
        isCellEditable: () => false,
        canvas: { requestRepaint: vi.fn() },
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: ' ', shiftKey: true }),
    });
    // No prior selection → seed by toggling the focused row.
    expect(toggleMulti).toHaveBeenCalledWith(5);
  });

  it('Shift+Space with an existing selection extends the row range from anchor to focus', async () => {
    const { CellSelection } = await import('../src/interaction/features/cellSelection');
    const feature = new CellSelection();
    const range = vi.fn();
    const toggleMulti = vi.fn();
    feature.handleKeyDown({
      grid: {
        selection: {
          state: { focusedRowIndex: 7, focusedColId: 'a', selectedRowIndices: new Set([3]) },
          toggleMulti, range, setFocusAndCollapseRanges: vi.fn(), addRange: vi.fn(),
          extendLastRangeToCell: vi.fn(), setFocus: vi.fn(),
          selectSingle: vi.fn(), clear: vi.fn(), clearRanges: vi.fn(),
          getRanges: () => [],
        },
        allColIds: () => ['a', 'b'],
        totalRowCount: () => 100,
        isEditing: () => false,
        getEditingFlags: () => ({} as any),
        isCellEditable: () => false,
        canvas: { requestRepaint: vi.fn() },
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: ' ', shiftKey: true }),
    });
    // Anchor = first selected row (3), focus = 7 → range(3, 7).
    expect(range).toHaveBeenCalledWith(3, 7);
    expect(toggleMulti).not.toHaveBeenCalled();
  });
});
