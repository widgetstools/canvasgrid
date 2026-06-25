import { describe, it, expect } from 'vitest';
import { sizeColumnsToFit, type SizeColumnsToFitParams } from '../src/core/layout';
import type { ResolvedColDef } from '../src/core/propertyChain';

const r = (over: Partial<ResolvedColDef<any>> = {}): ResolvedColDef<any> => ({
  colId: over.colId ?? 'c',
  headerName: '',
  minWidth: 30,
  maxWidth: Number.POSITIVE_INFINITY,
  type: 'text',
  cellRenderer: 'text',
  sortable: true,
  resizable: true,
  editable: false,
  columnGroupShow: null,
  suppressMovable: false,
  lockPosition: null,
  hide: false,
  lockVisible: false,
  lockPinned: false,
  ...over,
}) as ResolvedColDef<any>;

function sum(widths: Map<string, number>): number {
  let s = 0;
  for (const w of widths.values()) s += w;
  return s;
}

describe('sizeColumnsToFit', () => {
  it('single-leaf grid fills the container width', () => {
    const out = sizeColumnsToFit([r({ colId: 'a', width: 100 })], 800);
    expect(out.get('a')).toBe(800);
  });

  it('two leaves, no flex, both with min/max headroom split evenly', () => {
    const out = sizeColumnsToFit(
      [r({ colId: 'a', width: 100 }), r({ colId: 'b', width: 100 })],
      1000,
    );
    expect(out.get('a')).toBe(500);
    expect(out.get('b')).toBe(500);
    expect(sum(out)).toBe(1000);
  });

  it('flex + non-flex mix: flex column takes its flex share', () => {
    // a non-flex contributes its current width (100) to the share pool;
    // b + c contribute flex weights (10, 30). totalShare = 140; container
    // 1400 → 1 share = 10 px. Each leaf has minWidth=30, no max — no
    // clamps fire so the math is exact:
    //   a: 100 * 10 = 1000
    //   b:  10 * 10 = 100
    //   c:  30 * 10 = 300
    const out = sizeColumnsToFit(
      [
        r({ colId: 'a', width: 100, minWidth: 30 }),
        r({ colId: 'b', flex: 10, minWidth: 30 }),
        r({ colId: 'c', flex: 30, minWidth: 30 }),
      ],
      1400,
    );
    expect(out.get('a')).toBe(1000);
    expect(out.get('b')).toBe(100);
    expect(out.get('c')).toBe(300);
    // c is 3x b (the flex weight ratio).
    expect(out.get('c')!).toBe(out.get('b')! * 3);
    expect(sum(out)).toBe(1400);
  });

  it('suppressSizeToFit leaves keep their current width', () => {
    const out = sizeColumnsToFit(
      [
        r({ colId: 'a', width: 100 }),
        r({ colId: 'fixed', width: 200, suppressSizeToFit: true }),
        r({ colId: 'b', width: 100 }),
      ],
      1000,
    );
    expect(out.get('fixed')).toBe(200);
    // Remaining 800 split between a and b.
    expect(out.get('a')).toBe(400);
    expect(out.get('b')).toBe(400);
    expect(sum(out)).toBe(1000);
  });

  it('minWidth clamps: leftover routed to right-most unclamped leaf', () => {
    // 3 cols totaling 300 initial; target 200. a has minWidth 150
    // (forced to 150), so b + c must absorb the remainder 50.
    const out = sizeColumnsToFit(
      [
        r({ colId: 'a', width: 100, minWidth: 150 }),
        r({ colId: 'b', width: 100, minWidth: 20 }),
        r({ colId: 'c', width: 100, minWidth: 20 }),
      ],
      200,
    );
    expect(out.get('a')).toBe(150);
    expect(out.get('b')! + out.get('c')!).toBe(50);
    expect(sum(out)).toBe(200);
  });

  it('honors columnLimits override for min/max', () => {
    const params: SizeColumnsToFitParams = {
      columnLimits: [{ key: 'a', maxWidth: 100 }],
    };
    const out = sizeColumnsToFit(
      [r({ colId: 'a', width: 100 }), r({ colId: 'b', width: 100 })],
      1000,
      params,
    );
    expect(out.get('a')).toBe(100);
    expect(out.get('b')).toBe(900);
  });

  it('does not mutate the input col defs', () => {
    const a = r({ colId: 'a', width: 100 });
    const before = a.width;
    sizeColumnsToFit([a], 500);
    expect(a.width).toBe(before);
  });
});
