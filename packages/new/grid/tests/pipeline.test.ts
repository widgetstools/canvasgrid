import { describe, expect, it, vi } from 'vitest';
import { runCsrmPipeline } from '../src/csrm/pipeline';
import { AsyncTransactionQueue, conflateTransactions } from '../src/csrm/asyncTransactions';

type Row = { id: string; desk: string; pnl: number };

describe('CSRM pipeline', () => {
  it('filters then sorts', () => {
    const rows: Row[] = [
      { id: '1', desk: 'EQ', pnl: 10 },
      { id: '2', desk: 'FX', pnl: 30 },
      { id: '3', desk: 'EQ', pnl: 20 },
    ];
    const out = runCsrmPipeline({
      rows,
      filterModel: { desk: { filterType: 'text', type: 'equals', filter: 'EQ' } },
      quickFilterText: '',
      sortModel: [{ colId: 'pnl', direction: 'desc' }],
      columns: [{ field: 'desk' }, { field: 'pnl' }],
    });
    expect(out.map((r) => r.id)).toEqual(['3', '1']);
  });
});

describe('async transactions', () => {
  it('conflates last write per id', () => {
    const tx = conflateTransactions<Row>([
      { update: [{ id: '1', desk: 'EQ', pnl: 1 }] },
      { update: [{ id: '1', desk: 'EQ', pnl: 9 }] },
      { remove: ['2'] },
    ], (r) => r.id);
    expect(tx.update?.[0]?.pnl).toBe(9);
    expect(tx.remove).toEqual(['2']);
  });

  it('defers while scrolling then flushes on scroll end', () => {
    vi.useFakeTimers();
    let scrolling = true;
    const applied: unknown[] = [];
    const q = new AsyncTransactionQueue<Row>({
      deferWhileScrolling: true,
      conflate: true,
      waitMillis: 50,
      getRowId: (r) => r.id,
      isScrolling: () => scrolling,
      apply: (tx) => applied.push(tx),
    });
    q.enqueue({ update: [{ id: '1', desk: 'EQ', pnl: 1 }] });
    vi.advanceTimersByTime(100);
    expect(applied).toHaveLength(0);
    scrolling = false;
    q.onScrollEnd();
    expect(applied).toHaveLength(1);
    q.destroy();
    vi.useRealTimers();
  });
});
