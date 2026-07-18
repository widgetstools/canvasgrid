import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RowStore, TransactionQueue, conflateQueuedTxs } from '../src/worker/dataPipeline';

describe('RowStore', () => {
  it('stores rows by getRowId(row)[rowIdField]', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    expect(s.size()).toBe(2);
    expect(s.getById('a')).toEqual({ id: 'a', v: 1 });
  });

  it('applies add/update/remove with result counts', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a', v: 1 }]);
    const r = s.apply({ add: [{ id: 'b', v: 2 }], update: [{ id: 'a', v: 10 }], remove: ['x'] });
    expect(r.add).toEqual([{ rowId: 'b' }]);
    expect(r.update).toEqual([{ rowId: 'a' }]);
    expect(r.remove).toEqual([]);  // 'x' didn't exist
    expect(s.getById('a')).toEqual({ id: 'a', v: 10 });
  });

  it('numeric IDs are stable across a session', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a' }, { id: 'b' }]);
    const a1 = s.getNumericId('a');
    s.apply({ add: [{ id: 'c' }] });
    const a2 = s.getNumericId('a');
    expect(a1).toBe(a2);
  });

  it('reverse-lookup string ID from numeric', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'foo' }]);
    const n = s.getNumericId('foo');
    expect(s.getStringId(n)).toBe('foo');
  });
});

describe('TransactionQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces pushes and flushes after waitMs', () => {
    const onFlush = vi.fn();
    const q = new TransactionQueue({ waitMs: 50, onFlush });
    q.push({ add: [{ rowId: 'x' }] as any });
    q.push({ update: [{ rowId: 'y' }] as any });
    vi.advanceTimersByTime(40);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('flush() drains immediately', () => {
    const onFlush = vi.fn();
    const q = new TransactionQueue({ waitMs: 50, onFlush });
    q.push({ add: [{ rowId: 'x' }] as any });
    q.flush();
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('conflates updates by row id before flush (last write wins)', () => {
    const applied: any[] = [];
    const q = new TransactionQueue({
      waitMs: 50,
      conflate: true,
      getRowId: (r: any) => r.id,
      onFlush: () => {},
    });
    q.setFlushFn((txs) => {
      applied.push(...txs);
      return txs.map(() => ({ add: [], update: [], remove: [] }));
    });
    q.push({ update: [{ id: 'a', v: 1 }] });
    q.push({ update: [{ id: 'a', v: 2 }, { id: 'b', v: 1 }] });
    q.push({ update: [{ id: 'a', v: 3 }] });
    vi.advanceTimersByTime(50);
    expect(applied).toHaveLength(1);
    expect(applied[0].update).toEqual([{ id: 'a', v: 3 }, { id: 'b', v: 1 }]);
  });

  it('throttleMs enforces a minimum interval between flushes', () => {
    const onFlush = vi.fn();
    const q = new TransactionQueue({ waitMs: 20, throttleMs: 100, onFlush });
    q.push({ update: [{ id: 'a' }] as any });
    vi.advanceTimersByTime(20);
    expect(onFlush).toHaveBeenCalledTimes(1);
    q.push({ update: [{ id: 'b' }] as any });
    vi.advanceTimersByTime(20);
    expect(onFlush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(80);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});

describe('conflateQueuedTxs', () => {
  it('remove beats earlier update; add after remove resurrects', () => {
    const out = conflateQueuedTxs(
      [
        { update: [{ id: 'a', v: 1 }] },
        { remove: ['a'] },
        { add: [{ id: 'a', v: 9 }] },
      ],
      (r: { id: string }) => r.id,
    );
    expect(out).toEqual([{ add: [{ id: 'a', v: 9 }] }]);
  });
});
