import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RowStore, TransactionQueue } from '../src/worker/dataPipeline';

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
});
