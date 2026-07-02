// Cycle 21e / Task 14 — byRows rule indicator paint.
//
// Verifies that a rule engine's per-cell `indicator` (folded onto
// `config.ruleIndicator` by applyCellProps, Task 11) is painted through
// the same icon-registry Path2D machinery as the 21c colDef `cellIcon`,
// with rule-indicator precedence and row-start / row-end column
// targeting resolved by byRows (it alone knows visible column order).

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { paintCellsByRows } from '../src/renderer/painters/byRows';
import { CellRendererRegistry, textCell, headerCell } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';
import { registerIconSet, _resetIconRegistry_forTests } from '../src/icons/registry';
import {
  registerRuleEngine,
  _resetRuleEngine_forTests,
  type RuleEngineShape,
} from '../src/core/ruleEngineSlot';

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

function makeVs(cols: Array<{ colId: string; left: number; right: number; width: number }> = [
  { colId: 'a', left: 0, right: 100, width: 100 },
]): ViewportState {
  return {
    visibleColumns: cols.map((c, i) => ({ ...c, index: i })),
    visibleRows: [
      { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 0, bottom: 30, height: 30 },
    ],
    firstRow: 0, lastRow: 0,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: cols.reduce((s, c) => s + c.width, 0), bodyTop: 0, bodyBottom: 30,
    bodyWidth: cols.reduce((s, c) => s + c.width, 0), bodyHeight: 30,
    contentWidth: 100, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 270,
  } as ViewportState;
}

function makeReg(): CellRendererRegistry {
  const reg = new CellRendererRegistry();
  reg.register('text', textCell);
  reg.register('header', headerCell);
  return reg;
}

function baseDef(colId: string, over: Partial<ResolvedColDef> = {}): ResolvedColDef {
  return {
    colId, headerName: colId.toUpperCase(), minWidth: 30, maxWidth: Infinity,
    cellDataType: 'text', cellRenderer: 'text', sortable: true, resizable: true,
    editable: false, suppressFloatingFilterButton: false,
    ...over,
  } as ResolvedColDef;
}

function paint(
  gc: CachedContext2D,
  defs: ResolvedColDef[],
  vs: ViewportState = makeVs(),
): void {
  paintCellsByRows(gc, {
    viewport: vs,
    theme,
    columnDefs: new Map(defs.map(d => [d.colId, d])),
    cellRenderers: makeReg(),
    cellData: () => ({ value: 42, valueFormatted: '42' }),
    selection: { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() },
    sortModel: [], rowDataSnapshotAt: () => ({}), quickFilterLowerTerms: [],
    stringRowIdAt: () => 'r1',
    getRowDataById: () => ({}),
    themeKind: 'light',
  } as never);
}

function engineWithIndicator(indicator: { iconName: string; color: string; target: string; position: string } | null): RuleEngineShape {
  return {
    evaluateCell: () => ({ matched: indicator ? ['rule-1'] : [], style: null, indicator, formatProgram: null }),
    resolveRuleRef: () => null,
  };
}

describe('byRows — rule indicator paint (Cycle 21e / Task 14)', () => {
  beforeEach(() => {
    _resetIconRegistry_forTests();
    _resetRuleEngine_forTests();
  });

  it('cell-target indicator strokes the registered path with the rule color', () => {
    registerIconSet('lucide', { 'trending-up': 'M0 0' });
    registerRuleEngine(engineWithIndicator({
      iconName: 'trending-up', color: '#c62828', target: 'cell', position: 'before',
    }));
    const gc = fakeGc();
    const strokeStyles: string[] = [];
    (gc.stroke as any).mockImplementation(() => strokeStyles.push(String((gc as any).strokeStyle)));
    paint(gc, [baseDef('a')]);
    expect(gc.stroke as any).toHaveBeenCalled();
    expect(strokeStyles).toContain('#c62828');
    // Leading placement: text padding shifts right, same as 21c cellIcon.
    const [, textX] = (gc.fillText as any).mock.calls[0]!;
    expect(textX).toBe(26);
  });

  it('rule indicator wins over colDef cellIcon when both present', () => {
    registerIconSet('lucide', { 'trending-up': 'M0 0', star: 'M1 1' });
    registerRuleEngine(engineWithIndicator({
      iconName: 'trending-up', color: '#c62828', target: 'cell', position: 'before',
    }));
    const colDefCellIcon = vi.fn(() => ({ name: 'star', position: 'leading' as const }));
    const gc = fakeGc();
    const strokeStyles: string[] = [];
    (gc.stroke as any).mockImplementation(() => strokeStyles.push(String((gc as any).strokeStyle)));
    paint(gc, [baseDef('a', { cellIcon: colDefCellIcon })]);
    // Rule indicator painted (its color), colDef cellIcon never invoked.
    expect(strokeStyles).toContain('#c62828');
    expect(colDefCellIcon).not.toHaveBeenCalled();
  });

  it('row-start paints only on the first visible column', () => {
    registerIconSet('lucide', { 'trending-up': 'M0 0' });
    registerRuleEngine(engineWithIndicator({
      iconName: 'trending-up', color: '#0a7', target: 'row-start', position: 'before',
    }));
    const gc = fakeGc();
    const vs = makeVs([
      { colId: 'a', left: 0, right: 100, width: 100 },
      { colId: 'b', left: 100, right: 200, width: 100 },
    ]);
    paint(gc, [baseDef('a'), baseDef('b')], vs);
    expect((gc.stroke as any).mock.calls.length).toBe(1);
    // Icon translated into column 'a' (leading edge at x=0).
    expect(gc.translate as any).toHaveBeenCalledWith(6, 7);
  });

  it('row-end paints only on the last visible column', () => {
    registerIconSet('lucide', { 'trending-up': 'M0 0' });
    registerRuleEngine(engineWithIndicator({
      iconName: 'trending-up', color: '#0a7', target: 'row-end', position: 'after',
    }));
    const gc = fakeGc();
    const vs = makeVs([
      { colId: 'a', left: 0, right: 100, width: 100 },
      { colId: 'b', left: 100, right: 200, width: 100 },
    ]);
    paint(gc, [baseDef('a'), baseDef('b')], vs);
    expect((gc.stroke as any).mock.calls.length).toBe(1);
    // Trailing icon in column 'b': x = 100 + 100 - 6 - 16 = 178.
    expect(gc.translate as any).toHaveBeenCalledWith(178, 7);
  });

  it('no engine / ruleIndicator null → colDef cellIcon path unchanged (regression)', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const gc = fakeGc();
    paint(gc, [baseDef('a', { cellIcon: () => ({ name: 'star', position: 'trailing' }) })]);
    expect(gc.stroke as any).toHaveBeenCalled();
    expect(gc.translate as any).toHaveBeenCalledWith(78, 7);
  });

  it('engine registered but indicator null → colDef cellIcon still paints', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    registerRuleEngine(engineWithIndicator(null));
    const gc = fakeGc();
    paint(gc, [baseDef('a', { cellIcon: () => ({ name: 'star', position: 'trailing' }) })]);
    expect(gc.stroke as any).toHaveBeenCalled();
  });
});
