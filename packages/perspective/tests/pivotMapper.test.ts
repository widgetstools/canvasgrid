import { describe, it, expect, vi } from 'vitest';
import {
  mapPerspectivePivot,
  parsePerspectiveColumnPath,
  type PerspectivePivotViewResult,
} from '../src/pivotMapper';
import {
  encodePivotValueKey, PIVOT_PATH_SEP, PIVOT_ROW_TOTAL_PATH_MARKER,
} from '@wellsfargo-starui/velocity-grid';
import { buildCompositeGroupKey } from '../src/ssrmGroupTree';

/**
 * Perspective `split_by` → kernel pivot cross-tab.
 *
 * The fixtures below are the SHAPE REAL PERSPECTIVE EMITS, captured from
 * @perspective-dev 4.5.2 running in the browser against the seed book:
 *   column_paths() → ["AMER|pnl","APAC|pnl","EMEA|pnl"]
 *   to_json()      → [{__ROW_PATH__:[], "AMER|pnl":26592266.53, …},
 *                     {__ROW_PATH__:["Credit Trading"], …}, …]
 * — not guessed from documentation.
 *
 * The keys must agree with the kernel's own PivotPass exactly, so every
 * assertion builds its expected key with the kernel's exported
 * `encodePivotValueKey` rather than re-implementing the encoding.
 */

const ROW_GROUP_COLS = ['desk'];

/** One pivot level: split_by ['region'], measure `pnl`. */
function depth1(): PerspectivePivotViewResult {
  return {
    depth: 1,
    columnPaths: ['AMER|pnl', 'EMEA|pnl'],
    rows: [
      { __ROW_PATH__: [], 'AMER|pnl': 30, 'EMEA|pnl': 40 },
      { __ROW_PATH__: ['Rates'], 'AMER|pnl': 20, 'EMEA|pnl': 10 },
      { __ROW_PATH__: ['Credit'], 'AMER|pnl': 10, 'EMEA|pnl': 30 },
    ],
  };
}

describe('parsePerspectiveColumnPath', () => {
  it('splits path segments from the trailing value column', () => {
    expect(parsePerspectiveColumnPath('EMEA|pnl', ['pnl'], 1))
      .toEqual({ pivotPath: ['EMEA'], valueColId: 'pnl' });
    expect(parsePerspectiveColumnPath('EMEA|Govt|pnl', ['pnl'], 2))
      .toEqual({ pivotPath: ['EMEA', 'Govt'], valueColId: 'pnl' });
  });

  it('picks the right measure when several are projected', () => {
    expect(parsePerspectiveColumnPath('EMEA|marketValue', ['pnl', 'marketValue'], 1))
      .toEqual({ pivotPath: ['EMEA'], valueColId: 'marketValue' });
  });

  it('refuses to guess when a pivot value contains the separator', () => {
    // 'A|B' as a single region value is indistinguishable from two levels.
    // Mis-keying would silently paint one region's number under another.
    expect(parsePerspectiveColumnPath('A|B|pnl', ['pnl'], 1)).toBeNull();
  });

  it('returns null for a column that is not a pivot cell', () => {
    expect(parsePerspectiveColumnPath('somethingElse', ['pnl'], 1)).toBeNull();
  });
});

describe('mapPerspectivePivot', () => {
  it('builds the key tree and leaf paths from the deepest view', () => {
    const out = mapPerspectivePivot({
      results: [depth1()],
      rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
    })!;
    expect(out.leafPaths).toEqual([['AMER'], ['EMEA']]);
    expect(out.keyTree).toEqual([
      { value: 'AMER', path: ['AMER'], children: [] },
      { value: 'EMEA', path: ['EMEA'], children: [] },
    ]);
  });

  it('keys cells by composite group key, matching the skeleton', () => {
    const out = mapPerspectivePivot({
      results: [depth1()],
      rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
    })!;
    const ratesKey = buildCompositeGroupKey(ROW_GROUP_COLS, ['Rates']);
    expect(out.values.get(encodePivotValueKey(ratesKey, 'EMEA', 'pnl'))).toBe(10);
    expect(out.values.get(encodePivotValueKey(ratesKey, 'AMER', 'pnl'))).toBe(20);
  });

  it("maps Perspective's root row to the kernel's empty grand-total key", () => {
    const out = mapPerspectivePivot({
      results: [depth1()],
      rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
    })!;
    // `__ROW_PATH__: []` is the grand total; the totals subgrid reads ''.
    expect(out.values.get(encodePivotValueKey('', 'EMEA', 'pnl'))).toBe(40);
  });

  it('supplies prefix values from the shallower view (collapsed groups)', () => {
    // split_by emits leaf paths only. A collapsed pivot column group reads
    // the PREFIX aggregate, so depth-1 must contribute alongside depth-2.
    const d2: PerspectivePivotViewResult = {
      depth: 2,
      columnPaths: ['EMEA|Govt|pnl', 'EMEA|Corp|pnl'],
      rows: [{ __ROW_PATH__: ['Rates'], 'EMEA|Govt|pnl': 6, 'EMEA|Corp|pnl': 4 }],
    };
    const d1: PerspectivePivotViewResult = {
      depth: 1,
      columnPaths: ['EMEA|pnl'],
      rows: [{ __ROW_PATH__: ['Rates'], 'EMEA|pnl': 10 }],
    };
    const out = mapPerspectivePivot({
      results: [d1, d2],
      rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region', 'sector'],
      valueColIds: ['pnl'],
    })!;
    const gk = buildCompositeGroupKey(ROW_GROUP_COLS, ['Rates']);
    // Leaves…
    expect(out.values.get(
      encodePivotValueKey(gk, ['EMEA', 'Govt'].join(PIVOT_PATH_SEP), 'pnl'),
    )).toBe(6);
    // …and the prefix a collapsed 'EMEA' group paints. Aggregated by
    // Perspective at depth 1, never rolled up locally (which would break
    // avg/median/dominant).
    expect(out.values.get(encodePivotValueKey(gk, 'EMEA', 'pnl'))).toBe(10);
    // Tree depth comes from the deepest view only.
    expect(out.keyTree[0]!.children.map((c) => c.value).sort()).toEqual(['Corp', 'Govt']);
  });

  it('keys row totals under the sentinel from the group_by-only view', () => {
    const out = mapPerspectivePivot({
      results: [depth1()],
      rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
      rowTotalRows: [
        { __ROW_PATH__: ['Rates'], pnl: 30 },
        { __ROW_PATH__: [], pnl: 70 },
      ],
    })!;
    const gk = buildCompositeGroupKey(ROW_GROUP_COLS, ['Rates']);
    expect(out.values.get(
      encodePivotValueKey(gk, PIVOT_ROW_TOTAL_PATH_MARKER, 'pnl'),
    )).toBe(30);
    expect(out.values.get(
      encodePivotValueKey('', PIVOT_ROW_TOTAL_PATH_MARKER, 'pnl'),
    )).toBe(70);
  });

  it('refuses like PivotPass when the matrix would exceed the column cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => `R${i}|pnl`);
    const out = mapPerspectivePivot({
      results: [{ depth: 1, columnPaths: many, rows: [] }],
      rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
      maxGeneratedColumns: 10,
    })!;
    expect(out.maxColumnsReached).toEqual({ generatedColumns: 40, cap: 10 });
    expect(out.keyTree).toEqual([]);
    expect(out.values.size).toBe(0);
  });

  it('warns and omits ambiguous columns rather than mis-keying them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = mapPerspectivePivot({
      results: [{
        depth: 1,
        columnPaths: ['EMEA|pnl', 'A|B|pnl'],
        rows: [{ __ROW_PATH__: ['Rates'], 'EMEA|pnl': 1, 'A|B|pnl': 2 }],
      }],
      rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region'],
      valueColIds: ['pnl'],
    })!;
    expect(out.leafPaths).toEqual([['EMEA']]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be parsed unambiguously'));
    warn.mockRestore();
  });

  it('returns null when there is nothing to pivot', () => {
    expect(mapPerspectivePivot({
      results: [depth1()], rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: [], valueColIds: ['pnl'],
    })).toBeNull();
    expect(mapPerspectivePivot({
      results: [depth1()], rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region'], valueColIds: [],
    })).toBeNull();
    // Deepest view missing (mount raced a teardown) — no partial matrix.
    expect(mapPerspectivePivot({
      results: [depth1()], rowGroupCols: ROW_GROUP_COLS,
      pivotColIds: ['region', 'sector'], valueColIds: ['pnl'],
    })).toBeNull();
  });
});
