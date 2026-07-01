import { describe, it, expect } from 'vitest';
import { resolveColumnWidths } from '../src/core/layout';

const r = (over: any = {}) => ({
  colId: 'c', headerName: '', minWidth: 30, maxWidth: Infinity,
  type: 'text' as const, cellRenderer: 'text',
  sortable: true, resizable: true, editable: false, ...over,
});

describe('resolveColumnWidths', () => {
  it('fixed widths sum and place left-to-right', () => {
    const out = resolveColumnWidths([r({ colId: 'a', width: 100 }), r({ colId: 'b', width: 200 })], 1000);
    expect(out).toEqual([
      { colId: 'a', left: 0,   width: 100 },
      { colId: 'b', left: 100, width: 200 },
    ]);
  });

  it('flex distributes remaining width proportionally', () => {
    const out = resolveColumnWidths(
      [r({ colId: 'a', width: 100 }), r({ colId: 'b', flex: 1 }), r({ colId: 'c', flex: 2 })],
      700,
    );
    expect(out[0]!.width).toBe(100);
    expect(out[1]!.width).toBe(200);
    expect(out[2]!.width).toBe(400);
  });

  it('respects minWidth on flex columns', () => {
    const out = resolveColumnWidths([r({ colId: 'a', flex: 1, minWidth: 300 })], 100);
    expect(out[0]!.width).toBe(300);
  });

  it('pinned: left' satisfies string, () => {
    const out = resolveColumnWidths(
      [r({ colId: 'p', width: 50, pinned: 'left' }), r({ colId: 'b', width: 100 })],
      500,
    );
    expect(out[0]).toEqual({ colId: 'p', left: 0, width: 50, pinned: 'left' });
    expect(out[1]).toEqual({ colId: 'b', left: 50, width: 100 });
  });
});
