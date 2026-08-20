/**
 * ColumnStats — incremental min/max/maxAbs/sum/count per watched column.
 * Spec §2.4a. Cycle 21f / Task 3.
 *
 * Uses a fake VelocityGridApi stub (plain object — no real VelocityGrid instantiation).
 * rowsChanged event shape per packages/kernel/src/types/event.ts lines ~133-138:
 *   { type: 'rowsChanged'; added: {rowId,row}[]; updated: {rowId,row,oldRow}[]; removed: {rowId,row}[] }
 */
import { describe, it, expect } from 'vitest';
import type { VelocityGridApi } from '../../../kernel/src/types/api';
import { ColumnStats } from '../../src/renderers/columnStats';
import { makeLcg } from './helpers/lcg';

// ---------------------------------------------------------------------------
// Minimal fake VelocityGridApi stub
// ---------------------------------------------------------------------------

type RowsChangedEvent<TRow> = {
  type: 'rowsChanged';
  added: Array<{ rowId: string; row: TRow }>;
  updated: Array<{ rowId: string; row: TRow; oldRow: TRow }>;
  removed: Array<{ rowId: string; row: TRow }>;
  source: 'transaction' | 'transactionAsync' | 'edit';
};

interface FakeGrid<TRow> {
  rows: Map<string, TRow>;
  _handler: ((e: RowsChangedEvent<TRow>) => void) | null;
  api: VelocityGridApi<TRow>;
  emit(event: RowsChangedEvent<TRow>): void;
}

function makeFakeGrid<TRow>(initRows: Map<string, TRow>): FakeGrid<TRow> {
  let handler: ((e: RowsChangedEvent<TRow>) => void) | null = null;

  const api = {
    forEachRow(fn: (rowId: string, row: TRow) => void) {
      for (const [rowId, row] of initRows) fn(rowId, row);
    },
    getThemeKind() { return 'light' as const; },
    addEventListener(_type: string, h: (e: RowsChangedEvent<TRow>) => void) {
      handler = h;
      return () => { handler = null; };
    },
    removeEventListener(_type: string, _h: unknown) {
      handler = null;
    },
  } as unknown as VelocityGridApi<TRow>;

  const grid: FakeGrid<TRow> = {
    rows: initRows,
    get _handler() { return handler; },
    set _handler(v) { handler = v; },
    api,
    emit(event: RowsChangedEvent<TRow>) {
      handler?.(event);
    },
  };

  return grid;
}

// ---------------------------------------------------------------------------
// Seed data: pnl = [10, -5, 20, -30, 15]
// ---------------------------------------------------------------------------

type PnlRow = { pnl: number };

function makeSeedRows(): Map<string, PnlRow> {
  return new Map([
    ['r1', { pnl: 10 }],
    ['r2', { pnl: -5 }],
    ['r3', { pnl: 20 }],
    ['r4', { pnl: -30 }],
    ['r5', { pnl: 15 }],
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ColumnStats — seed', () => {
  it('seeds correctly from 5 rows: pnl=[10,-5,20,-30,15]', () => {
    const grid = makeFakeGrid(makeSeedRows());
    const stats = new ColumnStats<PnlRow>(grid.api, ['pnl']);
    const snap = stats.for('pnl');

    expect(snap.min).toBe(-30);
    expect(snap.max).toBe(20);
    expect(snap.maxAbs).toBe(30);
    expect(snap.sum).toBe(10);
    expect(snap.count).toBe(5);

    stats.destroy();
  });
});

describe('ColumnStats — rowsChanged: add', () => {
  it('add pnl:-40 → min/maxAbs update', () => {
    const grid = makeFakeGrid(makeSeedRows());
    const stats = new ColumnStats<PnlRow>(grid.api, ['pnl']);

    grid.emit({
      type: 'rowsChanged',
      added: [{ rowId: 'r6', row: { pnl: -40 } }],
      updated: [],
      removed: [],
      source: 'transaction',
    });

    const snap = stats.for('pnl');
    expect(snap.min).toBe(-40);
    expect(snap.maxAbs).toBe(40);
    expect(snap.count).toBe(6);

    stats.destroy();
  });
});

describe('ColumnStats — rowsChanged: update max holder moves away', () => {
  it('update row r3 (pnl:20→5) → max recomputes to 15 (heap lazy-delete scenario)', () => {
    const grid = makeFakeGrid(makeSeedRows());
    const stats = new ColumnStats<PnlRow>(grid.api, ['pnl']);

    // r3 holds the current max (20). Moving it away should leave 15 as max.
    grid.emit({
      type: 'rowsChanged',
      added: [],
      updated: [{ rowId: 'r3', row: { pnl: 5 }, oldRow: { pnl: 20 } }],
      removed: [],
      source: 'transaction',
    });

    const snap = stats.for('pnl');
    expect(snap.max).toBe(15); // 15 is now the max
    expect(snap.count).toBe(5); // count unchanged
    expect(snap.sum).toBe(-5); // 10 + -5 + 5 + -30 + 15 = -5

    stats.destroy();
  });
});

describe('ColumnStats — rowsChanged: remove all', () => {
  it('remove all 5 rows → null sentinels, count:0', () => {
    const rows = makeSeedRows();
    const grid = makeFakeGrid(rows);
    const stats = new ColumnStats<PnlRow>(grid.api, ['pnl']);

    grid.emit({
      type: 'rowsChanged',
      added: [],
      updated: [],
      removed: [
        { rowId: 'r1', row: { pnl: 10 } },
        { rowId: 'r2', row: { pnl: -5 } },
        { rowId: 'r3', row: { pnl: 20 } },
        { rowId: 'r4', row: { pnl: -30 } },
        { rowId: 'r5', row: { pnl: 15 } },
      ],
      source: 'transaction',
    });

    const snap = stats.for('pnl');
    expect(snap.min).toBeNull();
    expect(snap.max).toBeNull();
    expect(snap.maxAbs).toBeNull();
    expect(snap.sum).toBeNull();
    expect(snap.count).toBe(0);

    stats.destroy();
  });
});

describe('ColumnStats — non-number values skipped', () => {
  it('null/string/undefined values skipped without corrupting count', () => {
    type MixedRow = { pnl: number | null | string | undefined };
    const rows = new Map<string, MixedRow>([
      ['r1', { pnl: 10 }],
      ['r2', { pnl: null }],
      ['r3', { pnl: 'abc' }],
      ['r4', { pnl: undefined }],
      ['r5', { pnl: 5 }],
    ]);
    const grid = makeFakeGrid(rows);
    const stats = new ColumnStats<MixedRow>(grid.api as unknown as VelocityGridApi<MixedRow>, ['pnl']);

    const snap = stats.for('pnl');
    expect(snap.count).toBe(2);
    expect(snap.sum).toBe(15);
    expect(snap.min).toBe(5);
    expect(snap.max).toBe(10);

    stats.destroy();
  });
});

describe('ColumnStats — for() returns stable live snapshot', () => {
  it('for() returns the same object reference across calls and after rowsChanged', () => {
    const grid = makeFakeGrid(makeSeedRows());
    const stats = new ColumnStats<PnlRow>(grid.api, ['pnl']);
    const a = stats.for('pnl');
    const b = stats.for('pnl');
    expect(a).toBe(b);
    expect(a.count).toBe(5);

    grid.emit({
      type: 'rowsChanged',
      added: [{ rowId: 'r6', row: { pnl: 1 } }],
      updated: [],
      removed: [],
      source: 'transaction',
    });

    const c = stats.for('pnl');
    expect(c).toBe(a);
    expect(c.count).toBe(6);

    stats.destroy();
  });

  it('unwatched colId returns a frozen empty sentinel', () => {
    const grid = makeFakeGrid(makeSeedRows());
    const stats = new ColumnStats<PnlRow>(grid.api, ['pnl']);
    const snap = stats.for('missing');
    expect(snap.count).toBe(0);
    expect(Object.isFrozen(snap)).toBe(true);
    stats.destroy();
  });
});

// ---------------------------------------------------------------------------
// Incremental-parity property test: 3 seeds × ~200 ops
// ---------------------------------------------------------------------------

describe('ColumnStats — incremental parity vs brute-force recompute', () => {
  for (const seed of [42, 137, 999]) {
    it(`seed ${seed}: ~200 add/update/remove ops stay in sync with brute-force`, () => {
      type Row = { pnl: number | null };
      const liveRows = new Map<string, Row>();
      let nextId = 0;

      // Build initial state: 20 rows
      for (let i = 0; i < 20; i++) {
        liveRows.set(`r${nextId++}`, { pnl: i * 3 - 30 });
      }

      const grid = makeFakeGrid(new Map(liveRows));
      const stats = new ColumnStats<Row>(grid.api as unknown as VelocityGridApi<Row>, ['pnl']);

      const rand = makeLcg(seed);

      function bruteForce(): { min: number | null; max: number | null; maxAbs: number | null; sum: number | null; count: number } {
        let min: number | null = null;
        let max: number | null = null;
        let maxAbs: number | null = null;
        let sum: number | null = null;
        let count = 0;
        for (const row of liveRows.values()) {
          const v = row.pnl;
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          count++;
          sum = (sum ?? 0) + v;
          if (min === null || v < min) min = v;
          if (max === null || v > max) max = v;
          const abs = Math.abs(v);
          if (maxAbs === null || abs > maxAbs) maxAbs = abs;
        }
        return { min, max, maxAbs, sum, count };
      }

      const rowIds = () => [...liveRows.keys()];

      for (let op = 0; op < 200; op++) {
        const r = rand();
        const ids = rowIds();

        if (r < 0.35 || ids.length === 0) {
          // add
          const rowId = `r${nextId++}`;
          const pnl = Math.round((rand() * 200 - 100) * 100) / 100;
          const row: Row = { pnl };
          liveRows.set(rowId, row);
          grid.emit({ type: 'rowsChanged', added: [{ rowId, row }], updated: [], removed: [], source: 'transaction' });
        } else if (r < 0.65) {
          // update
          const rowId = ids[Math.floor(rand() * ids.length)] as string;
          const oldRow = liveRows.get(rowId)!;
          const pnl = Math.round((rand() * 200 - 100) * 100) / 100;
          const row: Row = { pnl };
          liveRows.set(rowId, row);
          grid.emit({ type: 'rowsChanged', added: [], updated: [{ rowId, row, oldRow }], removed: [], source: 'transaction' });
        } else {
          // remove
          const rowId = ids[Math.floor(rand() * ids.length)] as string;
          const row = liveRows.get(rowId)!;
          liveRows.delete(rowId);
          grid.emit({ type: 'rowsChanged', added: [], updated: [], removed: [{ rowId, row }], source: 'transaction' });
        }

        const snap = stats.for('pnl');
        const expected = bruteForce();
        expect(snap.count).toBe(expected.count);
        expect(snap.sum).toBeCloseTo(expected.sum ?? 0, 5);
        expect(snap.min).toBe(expected.min);
        expect(snap.max).toBe(expected.max);
        expect(snap.maxAbs).toBe(expected.maxAbs);
      }

      stats.destroy();
    });
  }
});
