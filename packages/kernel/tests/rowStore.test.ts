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

describe('RowStore — malformed-row resilience (critical review remediation)', () => {
  it('setAll skips a row with a null/undefined id instead of aborting the rest of the batch', () => {
    const s = new RowStore('id');
    const rows = [
      { id: 'a', v: 1 },
      { id: null, v: 2 },
      { id: 'c', v: 3 },
      { v: 4 }, // id undefined
      { id: 'e', v: 5 },
    ];
    const warnings = s.setAll(rows as unknown[]);
    // Every well-formed row survives — a malformed row mid-batch used to
    // throw out of the loop, permanently dropping every row after it.
    expect(s.size()).toBe(3);
    expect(s.getById('a')).toEqual({ id: 'a', v: 1 });
    expect(s.getById('c')).toEqual({ id: 'c', v: 3 });
    expect(s.getById('e')).toEqual({ id: 'e', v: 5 });
    // The caller is told which rows were skipped — not a silent drop.
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toContain('index 1');
    expect(warnings[1]).toContain('index 3');
  });

  it('apply skips malformed rows in add/update without aborting the rest of the batch, and reports them', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a', v: 1 }]);
    const r = s.apply({
      add: [{ id: 'b', v: 2 }, { id: null, v: 99 }, { id: 'd', v: 4 }] as unknown[],
      update: [{ id: 'a', v: 10 }, { v: 999 }] as unknown[], // second update row has no id
    });
    // Valid add/update entries land even though a malformed row sits
    // between them in the same batch.
    expect(r.add.map((x) => x.rowId)).toEqual(['b', 'd']);
    expect(r.update.map((x) => x.rowId)).toEqual(['a']);
    expect(s.size()).toBe(3);
    expect(s.getById('b')).toEqual({ id: 'b', v: 2 });
    expect(s.getById('d')).toEqual({ id: 'd', v: 4 });
    expect(s.getById('a')).toEqual({ id: 'a', v: 10 });
    // Skipped rows are surfaced via TransactionResult.warnings, not
    // dropped silently.
    expect(r.warnings).toBeDefined();
    expect(r.warnings!.length).toBe(2);
    expect(r.warnings!.some((w) => w.includes("add[1]"))).toBe(true);
    expect(r.warnings!.some((w) => w.includes("update[1]"))).toBe(true);
  });

  it('apply omits `warnings` entirely when every row is well-formed', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a' }]);
    const r = s.apply({ add: [{ id: 'b' }], update: [{ id: 'a', v: 1 }] });
    expect(r.warnings).toBeUndefined();
  });
});

/** Private id-map peek — these are the maps A-L3 is about. */
function idMaps(s: RowStore<any>): {
  stringToNumeric: Map<string, number>;
  numericToString: Map<number, string>;
} {
  return s as unknown as {
    stringToNumeric: Map<string, number>;
    numericToString: Map<number, string>;
  };
}

describe('RowStore — id-map hygiene (A-L3)', () => {
  it('setAll rebuilds the id maps so a rotating dataset does not grow them forever', () => {
    const s = new RowStore('id');
    // Ten full replaces, each with a completely disjoint id set — the
    // rotating-dataset shape (a blotter reloading a fresh book). Pre-fix
    // `stringToNumeric` / `numericToString` were never cleared here, so
    // they ended at 10 × 50 = 500 entries and grew for the whole session.
    for (let load = 0; load < 10; load++) {
      s.setAll(Array.from({ length: 50 }, (_, i) => ({ id: `load${load}-r${i}` })));
    }
    const maps = idMaps(s);
    expect(s.size()).toBe(50);
    expect(maps.stringToNumeric.size).toBe(50);
    expect(maps.numericToString.size).toBe(50);
    // Only the LIVE ids are mapped.
    expect(maps.stringToNumeric.has('load9-r0')).toBe(true);
    expect(maps.stringToNumeric.has('load0-r0')).toBe(false);
  });

  it('setAll keeps the numeric id of a row that survives the replace', () => {
    // Numeric ids ride every ViewportChunk and key the flash registry —
    // rebuilding the maps must not renumber rows that stayed.
    const s = new RowStore('id');
    s.setAll([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const beforeB = s.getNumericId('b');
    s.setAll([{ id: 'b' }, { id: 'd' }]);
    expect(s.getNumericId('b')).toBe(beforeB);
    expect(s.getStringId(beforeB)).toBe('b');
    // The dropped ids no longer resolve.
    expect(idMaps(s).stringToNumeric.has('a')).toBe(false);
    expect(idMaps(s).stringToNumeric.has('c')).toBe(false);
  });

  it('a fresh id after a replace never collides with a retired numeric id', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a' }]);
    const nA = s.getNumericId('a');
    s.setAll([{ id: 'z' }]);
    expect(s.getNumericId('z')).not.toBe(nA);
    // 'a' is gone; re-adding it mints a NEW number rather than reviving the
    // retired one (nextNumeric stays monotonic).
    s.apply({ add: [{ id: 'a' }] });
    expect(s.getNumericId('a')).not.toBe(nA);
  });

  it('remove drops the id mappings for the rows it deletes', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const nB = s.getNumericId('b');
    s.apply({ remove: ['b'] });
    const maps = idMaps(s);
    expect(maps.stringToNumeric.has('b')).toBe(false);
    expect(maps.numericToString.has(nB)).toBe(false);
    // Untouched rows keep theirs.
    expect(maps.stringToNumeric.has('a')).toBe(true);
    expect(maps.stringToNumeric.has('c')).toBe(true);
    expect(maps.stringToNumeric.size).toBe(2);
  });

  it('removing an absent id leaves the maps alone', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a' }]);
    const before = idMaps(s).stringToNumeric.size;
    const r = s.apply({ remove: ['nope'] });
    expect(r.remove).toEqual([]);
    expect(idMaps(s).stringToNumeric.size).toBe(before);
  });
});

describe('RowStore — batched removal (A-L5)', () => {
  it('compacts `order` in one pass and preserves the surviving order exactly', () => {
    const s = new RowStore('id');
    s.setAll(Array.from({ length: 20 }, (_, i) => ({ id: `r${i}` })));
    // Remove a scattered set, deliberately out of positional order and with
    // a duplicate + an unknown id mixed in.
    s.apply({ remove: ['r5', 'r0', 'r19', 'r5', 'ghost', 'r12'] });
    const ids = [...s.rows()].map((r: any) => r.id);
    expect(ids).toEqual(
      Array.from({ length: 20 }, (_, i) => `r${i}`)
        .filter((id) => !['r0', 'r5', 'r12', 'r19'].includes(id)),
    );
    expect(s.size()).toBe(16);
  });

  it('reports each real removal exactly once, in the order requested', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const r = s.apply({ remove: ['c', 'a', 'c', 'missing'] });
    expect(r.remove).toEqual([{ rowId: 'c' }, { rowId: 'a' }]);
  });

  it('removes 10k ids from a 100k book without the O(k·n) indexOf+splice cost', () => {
    const s = new RowStore('id');
    s.setAll(Array.from({ length: 100_000 }, (_, i) => ({ id: `r${i}` })));
    // Removals spread across the whole book — the worst case for the old
    // `order.indexOf(id)` scan (average n/2 per id ⇒ ~500M comparisons).
    const doomed = Array.from({ length: 10_000 }, (_, i) => `r${i * 10}`);
    const t0 = Date.now();
    const r = s.apply({ remove: doomed });
    const elapsed = Date.now() - t0;

    expect(r.remove).toHaveLength(10_000);
    expect(s.size()).toBe(90_000);
    // Order correctness, not just count: the survivors keep their relative
    // positions and none of the removed ids came back.
    const rows = [...s.rows()] as Array<{ id: string }>;
    expect(rows).toHaveLength(90_000);
    expect(rows[0]!.id).toBe('r1');
    expect(rows[8]!.id).toBe('r9');
    expect(rows[9]!.id).toBe('r11');
    expect(rows[rows.length - 1]!.id).toBe('r99999');
    expect(idMaps(s).stringToNumeric.size).toBe(90_000);
    // Loose ceiling — the point is the complexity class, not a benchmark.
    expect(elapsed).toBeLessThan(5_000);
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
