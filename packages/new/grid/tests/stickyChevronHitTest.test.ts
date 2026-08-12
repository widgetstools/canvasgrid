import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';

// Regression — sticky band caret unclickable with a pinned auto-group
// column. `paintStickyGroups` anchors the band to the auto-group
// column's left (Cycle 21i: `min(autoGroupCol.left, bodyLeft)`), but
// `hitTestStickyChevron` still anchored to `bodyLeft` AND rejected any
// x < bodyLeft. With the group column pinned-left (the default), every
// click on the painted caret landed short of `bodyLeft`, fell through
// the sticky hit-test, and died on the leaf row hidden under the band —
// so after expanding to leaves and scrolling, collapse-via-caret was
// impossible. The hit zone must live where the chevron paints.

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

// Geometry constants mirrored from stickyGroups.ts / hitTestStickyChevron.
const PADDING = 6;
const CHEVRON_SIZE = 12;
const INDENT_UNIT = 14;
const ROW_H = 30;

function mountWithBand(opts: { pinnedAutoGroupCol: boolean }) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = new VelocityGrid(el, {
    columnDefs: [
      { colId: 'region', field: 'region' },
      { colId: 'notional', field: 'notional' },
    ],
    rowData: [],
    getRowId: (r: any) => r.id,
    rowHeight: ROW_H,
  });
  const g = grid as any;
  // Auto-group column pinned-left over [0, 150]; scrolling body starts at 150.
  const autoCol = opts.pinnedAutoGroupCol
    ? [{ colId: 'ag-Grid-AutoColumn', index: 0, left: 0, right: 150, width: 150, pinned: 'left' }]
    : [];
  g.viewport = {
    ...g.viewport,
    bodyTop: 40, bodyLeft: 150, bodyRight: 400, bodyBottom: 400,
    visibleColumns: [
      ...autoCol,
      { colId: 'notional', index: autoCol.length, left: 150, right: 260, width: 110 },
    ],
    visibleRows: [],
  };
  g.stickyAncestors = [
    { depth: 0, key: 'region:AMER', colId: 'region', value: 'AMER', childCount: 8, isExpanded: true },
    { depth: 1, key: 'region:AMER::desk:Credit Trading', colId: 'desk', value: 'Credit Trading', childCount: 666, isExpanded: true },
  ];
  return g;
}

// Painted chevron center x for a band ancestor (bandLeft-anchored).
const paintedX = (bandLeft: number, depth: number) =>
  bandLeft + PADDING + depth * INDENT_UNIT + CHEVRON_SIZE / 2;
const bandY = (bandIdx: number) => 40 + bandIdx * ROW_H + ROW_H / 2;

describe('hitTestStickyChevron — anchors to the painted band, not bodyLeft', () => {
  it('hits the caret where it is painted inside a pinned auto-group column', () => {
    const g = mountWithBand({ pinnedAutoGroupCol: true });
    // Band anchors at min(autoGroupCol.left, bodyLeft) = 0.
    expect(g.hitTestStickyChevron(paintedX(0, 0), bandY(0)))
      .toEqual({ groupKey: 'region:AMER' });
    expect(g.hitTestStickyChevron(paintedX(0, 1), bandY(1)))
      .toEqual({ groupKey: 'region:AMER::desk:Credit Trading' });
  });

  it('no longer hits at the stale bodyLeft-anchored zone', () => {
    const g = mountWithBand({ pinnedAutoGroupCol: true });
    // Pre-fix zone: bodyLeft + PADDING + indent. Out in the data columns,
    // nowhere near the painted caret — must miss.
    expect(g.hitTestStickyChevron(150 + PADDING + CHEVRON_SIZE / 2, bandY(0))).toBeNull();
    expect(g.hitTestStickyChevron(150 + PADDING + INDENT_UNIT + CHEVRON_SIZE / 2, bandY(1))).toBeNull();
  });

  it('falls back to bodyLeft anchoring when no auto-group column is visible', () => {
    const g = mountWithBand({ pinnedAutoGroupCol: false });
    expect(g.hitTestStickyChevron(paintedX(150, 0), bandY(0)))
      .toEqual({ groupKey: 'region:AMER' });
    // Left of the band → miss.
    expect(g.hitTestStickyChevron(100, bandY(0))).toBeNull();
  });

  it('misses outside the band rows and outside the chevron hit pad', () => {
    const g = mountWithBand({ pinnedAutoGroupCol: true });
    // Below the band (two ancestors → band ends at bodyTop + 2 × rowH).
    expect(g.hitTestStickyChevron(paintedX(0, 0), 40 + 2 * ROW_H + 5)).toBeNull();
    // Same band row, x past the chevron + HIT_PAD.
    expect(g.hitTestStickyChevron(0 + PADDING + CHEVRON_SIZE + 4 + 2, bandY(0))).toBeNull();
  });
});
