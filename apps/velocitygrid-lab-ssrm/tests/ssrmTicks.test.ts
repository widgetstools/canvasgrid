/**
 * How a tick reaches the grid on the server-side path.
 *
 * This is a lock on a mistake that was easy to make and silent to live with.
 * The stream writes new rows into the book the datasource reads, so a bare
 * `refreshServerSide` makes the grid repaint the right VALUES — the numbers on
 * screen are correct and nothing looks wrong. What it does not do is tell the
 * grid which cells moved or what they moved from, because a block re-read
 * carries no old/new pairing.
 *
 * Everything that depends on that pairing then goes quiet, on this row model
 * only: cell flash, tick-direction rules, the tick arrows, relative-change
 * alerts. The symptom is a feature that works in the client-side lab and does
 * nothing in the server-side one, which is a long way from its cause.
 */
import { describe, it, expect, vi } from 'vitest';
import { applySnapshot, applyTick, type SsrmTickTarget } from '../src/lab/ssrmTicks';
import { makeRows } from '../src/data/domain';

function fakeGrid() {
  const calls: Array<{ op: string; rows?: number; purge?: boolean }> = [];
  const grid: SsrmTickTarget = {
    applyServerSideTransaction: vi.fn((tx) => { calls.push({ op: 'transaction', rows: tx.update.length }); }),
    refreshServerSide: vi.fn((p) => { calls.push({ op: 'refresh', purge: p.purge }); }),
  };
  return { grid, calls };
}

describe('server-side ticks', () => {
  it('sends the changed rows as a transaction, not a bare refresh', () => {
    const { grid, calls } = fakeGrid();
    applyTick(grid, makeRows(6, 1, 0));
    expect(calls).toEqual([{ op: 'transaction', rows: 6 }]);
  });

  it('never invalidates blocks on a tick', () => {
    // A refresh per tick costs a full window re-read AND loses the old values.
    const { grid, calls } = fakeGrid();
    for (let i = 0; i < 5; i++) applyTick(grid, makeRows(3, i, 0));
    expect(calls.every((c) => c.op === 'transaction')).toBe(true);
  });

  it('carries the rows through untouched, since the old/new diff is the point', () => {
    const { grid } = fakeGrid();
    const rows = makeRows(4, 2, 0);
    applyTick(grid, rows);
    const tx = (grid.applyServerSideTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(tx.update).toBe(rows);
  });

  it('does nothing when there is no grid yet, or nothing changed', () => {
    const { grid, calls } = fakeGrid();
    applyTick(null, makeRows(2, 3, 0));
    applyTick(undefined, makeRows(2, 3, 0));
    applyTick(grid, []);
    expect(calls).toEqual([]);
  });

  it('purges on a snapshot, because every cached block is void', () => {
    const { grid, calls } = fakeGrid();
    applySnapshot(grid);
    expect(calls).toEqual([{ op: 'refresh', purge: true }]);
  });

  it('tolerates a snapshot before the grid exists', () => {
    expect(() => applySnapshot(null)).not.toThrow();
    expect(() => applySnapshot(undefined)).not.toThrow();
  });
});
