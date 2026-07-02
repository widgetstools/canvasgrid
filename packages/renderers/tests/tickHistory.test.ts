/**
 * TickHistory — bounded per-(rowId, colId) ring buffers. Spec §2.4b. Task 4.
 */
import { describe, it, expect } from 'vitest';
import type { CGridApi } from '../../kernel/src/types/api';
import { TickHistory, DEFAULT_TICK_HISTORY_WINDOW } from '../src/tickHistory';
import { makeLcg } from './helpers/lcg';

type PxRow = { px?: number; size?: number };

type RowsChangedEvent<TRow> = {
  type: 'rowsChanged';
  added: Array<{ rowId: string; row: TRow }>;
  updated: Array<{ rowId: string; row: TRow; oldRow: TRow }>;
  removed: Array<{ rowId: string; row: TRow }>;
  source: 'transaction' | 'transactionAsync' | 'edit';
};

function makeFakeGrid<TRow>() {
  let handler: ((e: RowsChangedEvent<TRow>) => void) | null = null;
  const api = {
    forEachRow(_fn: (rowId: string, row: TRow) => void) {},
    getThemeKind() { return 'light' as const; },
    addEventListener(_type: string, h: (e: RowsChangedEvent<TRow>) => void) {
      handler = h;
    },
    removeEventListener(_type: string, _h: unknown) {
      handler = null;
    },
  } as unknown as CGridApi<TRow>;

  return {
    api,
    emit(event: RowsChangedEvent<TRow>) {
      handler?.(event);
    },
  };
}

describe('TickHistory — ring wrap', () => {
  it('window=3, push [1,2,3,4,5] → get returns [3,4,5]', () => {
    const grid = makeFakeGrid<PxRow>();
    const history = new TickHistory<PxRow>(grid.api, { px: { window: 3 } });

    for (const v of [1, 2, 3, 4, 5]) history.push('r1', 'px', v);

    expect([...history.get('r1', 'px')]).toEqual([3, 4, 5]);
    history.destroy();
  });
});

describe('TickHistory — under-fill', () => {
  it('window=5, push [1,2] → get returns [1,2] (not zero-padded)', () => {
    const grid = makeFakeGrid<PxRow>();
    const history = new TickHistory<PxRow>(grid.api, { px: { window: 5 } });

    history.push('r1', 'px', 1);
    history.push('r1', 'px', 2);

    expect([...history.get('r1', 'px')]).toEqual([1, 2]);
    history.destroy();
  });
});

describe('TickHistory — default window', () => {
  it('column opts in via {} → window defaults to 60', () => {
    const grid = makeFakeGrid<PxRow>();
    const history = new TickHistory<PxRow>(grid.api, { px: {} });

    for (let i = 0; i < 65; i++) history.push('r1', 'px', i);

    const values = history.get('r1', 'px');
    expect(values.length).toBe(DEFAULT_TICK_HISTORY_WINDOW);
    expect(values[0]).toBe(5);
    expect(values[values.length - 1]).toBe(64);
    history.destroy();
  });
});

describe('TickHistory — eviction on row removal', () => {
  it('rowsChanged removed clears buffers for that rowId', () => {
    const grid = makeFakeGrid<PxRow>();
    const history = new TickHistory<PxRow>(grid.api, { px: { window: 5 } });

    history.push('r1', 'px', 10);
    history.push('r1', 'px', 20);

    grid.emit({
      type: 'rowsChanged',
      added: [],
      updated: [],
      removed: [{ rowId: 'r1', row: {} }],
      source: 'transaction',
    });

    expect([...history.get('r1', 'px')]).toEqual([]);
    history.destroy();
  });
});

describe('TickHistory — multi-column / multi-row independence', () => {
  it('pushing (r1,px) does not mutate (r1,size) or (r2,px)', () => {
    const grid = makeFakeGrid<PxRow>();
    const history = new TickHistory<PxRow>(grid.api, {
      px: { window: 3 },
      size: { window: 3 },
    });

    history.push('r1', 'px', 1);
    history.push('r1', 'px', 2);
    history.push('r2', 'px', 99);

    expect([...history.get('r1', 'px')]).toEqual([1, 2]);
    expect([...history.get('r1', 'size')]).toEqual([]);
    expect([...history.get('r2', 'px')]).toEqual([99]);
    history.destroy();
  });
});

describe('TickHistory — non-finite values skipped', () => {
  it('NaN/Infinity/non-number pushes are ignored', () => {
    const grid = makeFakeGrid<PxRow>();
    const history = new TickHistory<PxRow>(grid.api, { px: { window: 5 } });

    history.push('r1', 'px', NaN);
    history.push('r1', 'px', Infinity);
    history.push('r1', 'px', 7);

    expect([...history.get('r1', 'px')]).toEqual([7]);
    history.destroy();
  });

  it('rowsChanged skips non-finite values from valueGetter', () => {
    const grid = makeFakeGrid<PxRow>();
    const history = new TickHistory<PxRow>(grid.api, { px: { window: 5 } });

    grid.emit({
      type: 'rowsChanged',
      added: [{ rowId: 'r1', row: { px: NaN } }],
      updated: [],
      removed: [],
      source: 'transaction',
    });
    grid.emit({
      type: 'rowsChanged',
      added: [{ rowId: 'r1', row: { px: 12 } }],
      updated: [],
      removed: [],
      source: 'transaction',
    });

    expect([...history.get('r1', 'px')]).toEqual([12]);
    history.destroy();
  });
});

describe('TickHistory — incremental parity vs reference model', () => {
  for (const seed of [7, 42]) {
    it(`seed ${seed}: ~500 pushes match plain-array ring model`, () => {
      const grid = makeFakeGrid<PxRow>();
      const history = new TickHistory<PxRow>(grid.api, {
        px: { window: 20 },
        size: { window: 60 },
      });
      const rand = makeLcg(seed);
      const rowIds = Array.from({ length: 10 }, (_, i) => `r${i}`);
      const colIds = ['px', 'size'] as const;
      const windows = { px: 20, size: 60 };
      const model = new Map<string, Map<string, number[]>>();

      function modelPush(rowId: string, colId: string, v: number): void {
        let row = model.get(rowId);
        if (row === undefined) {
          row = new Map();
          model.set(rowId, row);
        }
        let arr = row.get(colId);
        if (arr === undefined) {
          arr = [];
          row.set(colId, arr);
        }
        arr.push(v);
        const w = windows[colId as keyof typeof windows];
        if (arr.length > w) arr.shift();
      }

      for (let i = 0; i < 500; i++) {
        const rowId = rowIds[Math.floor(rand() * rowIds.length)] as string;
        const colId = colIds[Math.floor(rand() * colIds.length)] as string;
        const v = Math.round((rand() * 200 - 100) * 100) / 100;
        history.push(rowId, colId, v);
        modelPush(rowId, colId, v);
        expect([...history.get(rowId, colId)]).toEqual(model.get(rowId)?.get(colId) ?? []);
      }

      history.destroy();
    });
  }
});
