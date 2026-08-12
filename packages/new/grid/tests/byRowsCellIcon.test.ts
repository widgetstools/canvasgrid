// Cycle 21c / Task 16 — byRows inline icon rendering.
//
// Verifies that a data column whose resolved `cellIcon` fn returns a
// registry-resolvable IconRef gets its icon stroked (Path2D) and its
// text shifted; columns without cellIcon behave exactly as before.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { paintCellsByRows } from '../src/renderer/painters/byRows';
import { CellRendererRegistry, textCell, headerCell } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';
import { registerIconSet, _resetIconRegistry_forTests } from '../src/icons/registry';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class {
      constructor(_d?: string) {}
    };
  }
});

const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 10, getRowHeight: () => 30, getCell: () => null,
};

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

const theme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
} as unknown as ResolvedTheme;

function makeVs(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 0, bottom: 30, height: 30 },
    ],
    firstRow: 0, lastRow: 0,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 100, bodyTop: 0, bodyBottom: 30, bodyWidth: 100, bodyHeight: 30,
    contentWidth: 100, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 270,
  } as ViewportState;
}

function makeReg(): CellRendererRegistry {
  const reg = new CellRendererRegistry();
  reg.register('text', textCell);
  reg.register('header', headerCell);
  return reg;
}

function baseDef(over: Partial<ResolvedColDef> = {}): ResolvedColDef {
  return {
    colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity,
    cellDataType: 'text', cellRenderer: 'text', sortable: true, resizable: true,
    editable: false, suppressFloatingFilterButton: false,
    ...over,
  } as ResolvedColDef;
}

function paint(gc: CachedContext2D, def: ResolvedColDef): void {
  paintCellsByRows(gc, {
    viewport: makeVs(), theme, columnDefs: new Map([['a', def]]),
    cellRenderers: makeReg(),
    cellData: () => ({ value: 42, valueFormatted: '42' }),
    selection: { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() },
    sortModel: [], rowDataSnapshotAt: () => ({}), quickFilterLowerTerms: [],
  } as never);
}

describe('byRows — cellIcon inline rendering', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('strokes the icon path for a leading icon and shifts text right', () => {
    registerIconSet('lucide', { 'trending-up': 'M0 0' });
    const gc = fakeGc();
    paint(gc, baseDef({
      cellIcon: () => ({ name: 'trending-up', position: 'leading' }),
    } as Partial<ResolvedColDef>));
    expect(gc.stroke as any).toHaveBeenCalled();
    // Text shifted: leading pad = 6 + floor(30*0.55)=16 + 4 = 26.
    const [, textX] = (gc.fillText as any).mock.calls[0]!;
    expect(textX).toBe(26);
    // Icon translated to (6, (30-16)/2 = 7).
    expect(gc.translate as any).toHaveBeenCalledWith(6, 7);
  });

  it('trailing icon draws at the right edge; text keeps its origin', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const gc = fakeGc();
    paint(gc, baseDef({
      cellIcon: () => ({ name: 'star', position: 'trailing' }),
    } as Partial<ResolvedColDef>));
    expect(gc.stroke as any).toHaveBeenCalled();
    // Icon at x = 100 - 6 - 16 = 78.
    expect(gc.translate as any).toHaveBeenCalledWith(78, 7);
    const [, textX] = (gc.fillText as any).mock.calls[0]!;
    expect(textX).toBe(6);
  });

  it('unresolvable icon name paints text at the default origin (no stroke)', () => {
    const gc = fakeGc();
    paint(gc, baseDef({
      cellIcon: () => ({ name: 'not-registered' }),
    } as Partial<ResolvedColDef>));
    expect(gc.stroke as any).not.toHaveBeenCalled();
    const [, textX] = (gc.fillText as any).mock.calls[0]!;
    expect(textX).toBe(6);
  });

  it('cellIcon returning null is a plain text cell', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const gc = fakeGc();
    paint(gc, baseDef({ cellIcon: () => null } as Partial<ResolvedColDef>));
    expect(gc.stroke as any).not.toHaveBeenCalled();
  });

  it('throwing cellIcon is swallowed (cell still paints)', () => {
    const gc = fakeGc();
    expect(() => paint(gc, baseDef({
      cellIcon: () => { throw new Error('boom'); },
    } as Partial<ResolvedColDef>))).not.toThrow();
    expect(gc.fillText as any).toHaveBeenCalled();
  });

  it('column without cellIcon — no behavioral change', () => {
    const gc = fakeGc();
    paint(gc, baseDef());
    expect(gc.stroke as any).not.toHaveBeenCalled();
    const [, textX] = (gc.fillText as any).mock.calls[0]!;
    expect(textX).toBe(6);
  });

  it('icon tint uses IconRef.color when set', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const gc = fakeGc();
    const strokeStyles: string[] = [];
    (gc.stroke as any).mockImplementation(() => strokeStyles.push(String((gc as any).strokeStyle)));
    paint(gc, baseDef({
      cellIcon: () => ({ name: 'star', color: '#0a7' }),
    } as Partial<ResolvedColDef>));
    expect(strokeStyles).toContain('#0a7');
  });

  it('renders an emoji IconRef via fillText in the leading slot and shifts text', () => {
    const gc = fakeGc();
    paint(gc, baseDef({
      cellIcon: () => ({ emoji: '🔥', position: 'leading' }),
    } as Partial<ResolvedColDef>));
    // Emoji drawn: some fillText call received the emoji glyph.
    const emojiCall = (gc.fillText as any).mock.calls.find((c: unknown[]) => c[0] === '🔥');
    expect(emojiCall).toBeTruthy();
    // No Path2D stroke for the icon (emoji path).
    expect(gc.stroke as any).not.toHaveBeenCalled();
    // Text shifted: leading pad = 6 + floor(30*0.55)=16 + 4 = 26.
    const [, textX] = (gc.fillText as any).mock.calls[0]!;
    expect(textX).toBe(26);
  });

  it('ignores an IconRef with neither name nor emoji', () => {
    const gc = fakeGc();
    expect(() => paint(gc, baseDef({
      cellIcon: () => ({ position: 'leading' }) as any,
    } as Partial<ResolvedColDef>))).not.toThrow();
    expect(gc.stroke as any).not.toHaveBeenCalled();
    const emojiCall = (gc.fillText as any).mock.calls.find((c: unknown[]) => c[0] === '🔥');
    expect(emojiCall).toBeFalsy();
    const [, textX] = (gc.fillText as any).mock.calls[0]!;
    expect(textX).toBe(6);
  });
});
