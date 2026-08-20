// @wellsfargo-starui/velocity-grid-ext/edit — bulkUpdate.test.ts
// Covers collectBulkUpdateTargets (shared walk with smart-edit, different
// type filter), bulkUpdateValueKind, parseBulkUpdateValue (number/date/
// dateTime/text), buildBulkUpdatePatches, makeDistinctValuesFeed.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §1.1.5.
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.4.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 7 Step 1 (10 cases).

import { describe, it, expect, vi } from 'vitest';
import {
  collectBulkUpdateTargets,
  bulkUpdateValueKind,
  parseBulkUpdateValue,
  buildBulkUpdatePatches,
  makeDistinctValuesFeed,
} from '../../src/edit/bulkUpdate';
import type { CellTarget } from '../../src/edit/patches';
import { createFakeGrid, type FakeRow, type FakeColDef } from './helpers/fakeGrid';

const rows: FakeRow[] = [
  {
    id: 'r0',
    qty: 10,
    name: 'a',
    when: '2026-01-01',
    stamp: '2026-01-01T00:00',
    active: true,
    misc: 'x',
  },
  {
    id: 'r1',
    qty: 20,
    name: 'b',
    when: '2026-01-02',
    stamp: '2026-01-02T00:00',
    active: false,
    misc: 'y',
  },
];

const colDefs: FakeColDef[] = [
  { colId: 'qty', field: 'qty', cellDataType: 'number' },
  { colId: 'name', field: 'name', cellDataType: 'text' },
  { colId: 'when', field: 'when', cellDataType: 'date' },
  { colId: 'stamp', field: 'stamp', cellDataType: 'dateTime' },
  { colId: 'active', field: 'active', cellDataType: 'boolean' },
  { colId: 'misc', field: 'misc' }, // undefined cellDataType
];

describe('collectBulkUpdateTargets', () => {
  it('type filter: text/number/date/dateTime/undefined included, boolean excluded', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [
        {
          rowStart: 0,
          rowEnd: 1,
          colIds: ['qty', 'name', 'when', 'stamp', 'active', 'misc'],
        },
      ],
    });
    const targets = await collectBulkUpdateTargets(grid.surface);
    const colIds = new Set(targets.map((t) => t.colId));

    expect(colIds.has('qty')).toBe(true);
    expect(colIds.has('name')).toBe(true);
    expect(colIds.has('when')).toBe(true);
    expect(colIds.has('stamp')).toBe(true);
    expect(colIds.has('misc')).toBe(true); // undefined cellDataType -> treated as text
    expect(colIds.has('active')).toBe(false); // boolean excluded
  });

  it('non-editable cell filtered (shared-walk spot check)', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [{ rowStart: 0, rowEnd: 1, colIds: ['name'] }],
      nonEditable: [{ rowIndex: 0, colId: 'name' }],
    });
    const targets = await collectBulkUpdateTargets(grid.surface);
    expect(targets.map((t) => t.rowId)).toEqual(['r1']);
  });

  it('focused-cell fallback works (shared-walk spot check)', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [],
      focusedCell: { rowIndex: 0, colId: 'name' },
    });
    const targets = await collectBulkUpdateTargets(grid.surface);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.rowId).toBe('r0');
  });

  it('overlapping ranges dedupe with ONE getRowsByIndex call (shared-walk spot check)', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [
        { rowStart: 0, rowEnd: 1, colIds: ['name'] },
        { rowStart: 0, rowEnd: 1, colIds: ['name'] },
      ],
    });
    const targets = await collectBulkUpdateTargets(grid.surface);
    expect(grid.getRowsByIndexSpy).toHaveBeenCalledTimes(1);
    const pairs = targets.map((t) => `${t.rowId}:${t.colId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('bulkUpdateValueKind', () => {
  it('maps cellDataType to its value-parsing family', () => {
    expect(bulkUpdateValueKind('number')).toBe('number');
    expect(bulkUpdateValueKind('date')).toBe('date');
    expect(bulkUpdateValueKind('dateTime')).toBe('date');
    expect(bulkUpdateValueKind('text')).toBe('text');
    expect(bulkUpdateValueKind(undefined)).toBe('text');
    expect(bulkUpdateValueKind('boolean')).toBe('text');
  });
});

describe('parseBulkUpdateValue — number', () => {
  // StarUI's `parseFloat(raw) || null` falsy-coercion bug would turn '0'
  // into null (0 is falsy); `Number('0') === 0` is correctly truthy-checked
  // here via an explicit `''` guard + Number.isNaN, so '0' MUST parse to 0.
  it("'0' parses to 0 (StarUI falsy-bug lock)", () => {
    expect(parseBulkUpdateValue('0', 'number')).toBe(0);
  });

  it('parses valid numeric strings', () => {
    expect(parseBulkUpdateValue('3.5', 'number')).toBe(3.5);
    expect(parseBulkUpdateValue('-2', 'number')).toBe(-2);
  });

  it('rejects empty string and non-numeric text', () => {
    expect(parseBulkUpdateValue('', 'number')).toBeNull();
    expect(parseBulkUpdateValue('abc', 'number')).toBeNull();
  });
});

describe('parseBulkUpdateValue — date', () => {
  it('leap-year table (incl. century rules)', () => {
    expect(parseBulkUpdateValue('2024-02-29', 'date')).toBe('2024-02-29'); // leap
    expect(parseBulkUpdateValue('2026-02-29', 'date')).toBeNull(); // not leap
    expect(parseBulkUpdateValue('2000-02-29', 'date')).toBe('2000-02-29'); // /400 leap
    expect(parseBulkUpdateValue('1900-02-29', 'date')).toBeNull(); // century non-leap
  });

  it('month/day-for-month validation', () => {
    expect(parseBulkUpdateValue('2026-13-01', 'date')).toBeNull(); // bad month
    expect(parseBulkUpdateValue('2026-04-31', 'date')).toBeNull(); // April has 30 days
  });

  it('strict zero-padding required', () => {
    expect(parseBulkUpdateValue('2026-7-2', 'date')).toBeNull();
  });

  it('normalization passthrough for an already-valid ISO date', () => {
    expect(parseBulkUpdateValue('2026-07-02', 'date')).toBe('2026-07-02');
  });
});

describe('parseBulkUpdateValue — dateTime', () => {
  it('accepts with and without seconds', () => {
    expect(parseBulkUpdateValue('2026-07-02T13:45', 'dateTime')).toBe('2026-07-02T13:45');
    expect(parseBulkUpdateValue('2026-07-02T13:45:59', 'dateTime')).toBe('2026-07-02T13:45:59');
  });

  it('rejects out-of-range hour/minute/second', () => {
    expect(parseBulkUpdateValue('2026-07-02T24:00', 'dateTime')).toBeNull();
    expect(parseBulkUpdateValue('2026-07-02T13:60', 'dateTime')).toBeNull();
    expect(parseBulkUpdateValue('2026-07-02T13:45:60', 'dateTime')).toBeNull();
  });

  it('rejects a space separator (must be literal T)', () => {
    expect(parseBulkUpdateValue('2026-07-02 13:45', 'dateTime')).toBeNull();
  });

  it('re-checks date-component rules (non-leap Feb 29 rejected)', () => {
    expect(parseBulkUpdateValue('2026-02-29T10:00', 'dateTime')).toBeNull();
  });
});

describe('parseBulkUpdateValue — text', () => {
  it('always passes through raw, including empty string', () => {
    expect(parseBulkUpdateValue('', 'text')).toBe('');
    expect(parseBulkUpdateValue('hello', 'text')).toBe('hello');
    expect(parseBulkUpdateValue('123', 'text')).toBe('123'); // stays a string
    expect(parseBulkUpdateValue('123', undefined)).toBe('123'); // undefined -> text
  });
});

describe('buildBulkUpdatePatches', () => {
  function target(overrides?: Partial<CellTarget>): CellTarget {
    return {
      rowId: 'r1', colId: 'qty', field: 'qty', value: 10, rowIndex: 0,
      rowData: { qty: 10 },
      ...overrides,
    };
  }

  it('Object.is no-op guard: NaN vs NaN skipped', () => {
    expect(buildBulkUpdatePatches([target({ value: NaN })], NaN)).toEqual([]);
  });

  // Object.is(-0, 0) is false, so -0 -> 0 (and vice versa) is NOT a no-op —
  // documented distinctly from the NaN case above, per the shared
  // buildPatchesFromTargets semantics (patches.ts / spec §2.3).
  it('Object.is no-op guard: -0 vs 0 IS a change (patch produced)', () => {
    expect(buildBulkUpdatePatches([target({ value: -0 })], 0)).toEqual([
      { rowId: 'r1', colId: 'qty', field: 'qty', oldValue: -0, newValue: 0 },
    ]);
  });

  it('same-string value skipped', () => {
    expect(buildBulkUpdatePatches([target({ value: 'active' })], 'active')).toEqual([]);
  });

  it('changed value produces a correctly-shaped patch', () => {
    expect(buildBulkUpdatePatches([target({ value: 10 })], 99)).toEqual([
      { rowId: 'r1', colId: 'qty', field: 'qty', oldValue: 10, newValue: 99 },
    ]);
  });
});

describe('makeDistinctValuesFeed', () => {
  it('fetches at maxDropdownValues, parses type-aware, drops nulls, never caches', async () => {
    const fetcher = vi.fn(async () => ['1', '0', 'abc', '2.5']);
    const feed = makeDistinctValuesFeed(fetcher, { maxDropdownValues: 20 });

    const values = await feed('qty', 'number');
    expect(fetcher).toHaveBeenCalledWith('qty', 20);
    expect(values).toEqual([1, 0, 2.5]); // 'abc' dropped, '0' survives the falsy trap

    await feed('qty', 'number');
    expect(fetcher).toHaveBeenCalledTimes(2); // fresh fetch every call, no cache
  });

  it('text kind: passthrough', async () => {
    const fetcher = vi.fn(async () => ['a', 'b']);
    const feed = makeDistinctValuesFeed(fetcher, { maxDropdownValues: 20 });
    expect(await feed('name', undefined)).toEqual(['a', 'b']);
  });
});
