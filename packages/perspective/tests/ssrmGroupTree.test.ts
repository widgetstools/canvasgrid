import { describe, expect, it } from 'vitest';
import {
  buildCompositeGroupKey,
  isPathVisible,
  materializeGroupedRows,
  parseCompositeGroupKey,
  splitGroupKey,
} from '../src/ssrmGroupTree';

// Task 4 — perspective's local copy of the composite-key vocabulary must
// escape the `:` segment separator / `::` level separator inside group
// values, matching the kernel's `escapeGroupKeySegment` / `splitGroupKey`
// scheme (no new cross-package dependency — this is an independent copy).
describe('ssrmGroupTree — composite group key separator escaping', () => {
  it('round-trips a value containing "::" through build → split → parse', () => {
    const key = buildCompositeGroupKey(['desk'], ['AB::CD']);
    expect(splitGroupKey(key).length).toBe(1);
    expect(parseCompositeGroupKey(key)).toEqual([{ colId: 'desk', value: 'AB::CD' }]);
  });

  it('round-trips a value containing a single ":" through build → split → parse', () => {
    const key = buildCompositeGroupKey(['desk'], ['X:Y']);
    expect(splitGroupKey(key).length).toBe(1);
    expect(parseCompositeGroupKey(key)).toEqual([{ colId: 'desk', value: 'X:Y' }]);
  });

  it('two-level key with a separator-bearing value keeps the correct depth + values', () => {
    const key = buildCompositeGroupKey(['desk', 'region'], ['AB::CD', 'X:Y']);
    expect(splitGroupKey(key).length).toBe(2);
    expect(parseCompositeGroupKey(key)).toEqual([
      { colId: 'desk', value: 'AB::CD' },
      { colId: 'region', value: 'X:Y' },
    ]);
  });

  it('two distinct values that collide under the OLD unescaped scheme now build distinct keys', () => {
    const twoLevel = buildCompositeGroupKey(['desk', 'region'], ['AB', 'CD']);
    const collidingValue = buildCompositeGroupKey(['desk'], ['AB::region:CD']);
    expect(twoLevel).not.toBe(collidingValue);
    expect(splitGroupKey(twoLevel).length).toBe(2);
    expect(splitGroupKey(collidingValue).length).toBe(1);
  });

  it('isPathVisible expansion targeting is unaffected by a "::"-bearing ancestor value', () => {
    const rowGroupCols = ['desk', 'region'];
    const path = ['AB::CD', 'EMEA'];
    const ancestorKey = buildCompositeGroupKey(rowGroupCols, ['AB::CD']);
    // Collapsed — the child path must NOT be visible.
    expect(isPathVisible(path, rowGroupCols, new Set())).toBe(false);
    // Expanded via the EXACT escaped ancestor key — must be visible.
    expect(isPathVisible(path, rowGroupCols, new Set([ancestorKey]))).toBe(true);
  });

  it('materializeGroupedRows nests a "::"-bearing group value at the correct depth and targets the right group on expansion', () => {
    const rawRows: Record<string, unknown>[] = [
      { __ROW_PATH__: ['AB::CD'], positionId: 2, desk: 'AB::CD' },
      { __ROW_PATH__: ['AB::CD', 'X:Y'], positionId: 1, desk: 'AB::CD', region: 'X:Y' },
      { __ROW_PATH__: ['EF'], positionId: 1, desk: 'EF' },
    ];
    const topKey = buildCompositeGroupKey(['desk'], ['AB::CD']);
    const childKey = buildCompositeGroupKey(['desk', 'region'], ['AB::CD', 'X:Y']);

    const collapsed = materializeGroupedRows(rawRows, {
      rowGroupCols: ['desk', 'region'],
      expandedGroupKeys: [],
    });
    // Only the two top-level groups are visible when nothing is expanded.
    expect(collapsed.map((r) => r.positionId)).toEqual([
      `__grp__${topKey}`,
      `__grp__${buildCompositeGroupKey(['desk'], ['EF'])}`,
    ]);

    const expanded = materializeGroupedRows(rawRows, {
      rowGroupCols: ['desk', 'region'],
      expandedGroupKeys: [topKey],
    });
    // Expanding the EXACT escaped top key reveals its one child group —
    // not corrupted into a 3-level tree by the value's own "::".
    const childRow = expanded.find((r) => r.positionId === `__grp__${childKey}`);
    expect(childRow).toBeDefined();
    expect(childRow!.__ssrm as { depth: number }).toMatchObject({ depth: 1 });
  });

  it('splitGroupKey on an empty key returns an empty array (parity with the old split behaviour)', () => {
    expect(splitGroupKey('')).toEqual([]);
    expect(parseCompositeGroupKey('')).toEqual([]);
  });
});
