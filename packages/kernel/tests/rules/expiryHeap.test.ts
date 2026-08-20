import { describe, expect, it } from 'vitest';
import { ExpiryHeap, type ExpiryEntry } from '../../src/rules/expiryHeap';
import { makeClock } from './helpers/fakeClock';

function make() {
  const clock = makeClock();
  const heap = new ExpiryHeap({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const batches: string[][] = [];
  heap.onExpire((expired) => batches.push(expired.map((e) => e.ruleId)));
  return { clock, heap, batches };
}

function entry(deadline: number, ruleId: string): ExpiryEntry {
  return { deadline, rowId: 'row', colId: 'col', ruleId };
}

describe('ExpiryHeap', () => {
  it('expires in deadline order regardless of push order', () => {
    const { clock, heap, batches } = make();
    heap.push(entry(30, 'r30'));
    heap.push(entry(10, 'r10'));
    heap.push(entry(20, 'r20'));
    clock.advance(100);
    expect(batches).toEqual([['r10', 'r20', 'r30']]); // one batch, deadline order
    expect(clock.pendingTimerCount()).toBe(0); // heap drained — no timer armed
  });

  it('re-arms the single pending timer when an earlier deadline arrives', () => {
    const { clock, heap, batches } = make();
    heap.push(entry(50, 'late'));
    expect(clock.pendingTimerCount()).toBe(1);
    heap.push(entry(20, 'early'));
    expect(clock.pendingTimerCount()).toBe(1); // coalesced — re-armed, not added
    clock.advance(20);
    expect(batches).toEqual([['early']]);
    expect(clock.pendingTimerCount()).toBe(1); // re-armed for 'late'
    clock.advance(50);
    expect(batches).toEqual([['early'], ['late']]);
  });

  it('batches all entries whose deadline <= now() into one callback', () => {
    const { clock, heap, batches } = make();
    heap.push({ deadline: 10, rowId: 'a', colId: 'p', ruleId: 'x' });
    heap.push({ deadline: 10, rowId: 'b', colId: 'p', ruleId: 'y' });
    clock.advance(10);
    expect(batches).toHaveLength(1);
    expect([...batches[0]!].sort()).toEqual(['x', 'y']);
  });

  it('isActive is true inside the window, false at/after the deadline; colId is part of the key', () => {
    const { clock, heap } = make();
    heap.push({ deadline: 100, rowId: 'a', colId: 'price', ruleId: 'r' });
    expect(heap.isActive('a', 'price', 'r')).toBe(true);
    expect(heap.isActive('a', null, 'r')).toBe(false); // different key
    clock.advance(99);
    expect(heap.isActive('a', 'price', 'r')).toBe(true);
    clock.advance(100);
    expect(heap.isActive('a', 'price', 'r')).toBe(false);
  });

  it('re-pushing a key extends its window without a spurious early expiry', () => {
    const { clock, heap, batches } = make();
    heap.push({ deadline: 50, rowId: 'a', colId: 'p', ruleId: 'r' });
    heap.push({ deadline: 150, rowId: 'a', colId: 'p', ruleId: 'r' });
    clock.advance(60); // stale 50-entry pops but is superseded — no event
    expect(batches).toEqual([]);
    expect(heap.isActive('a', 'p', 'r')).toBe(true);
    clock.advance(150);
    expect(batches).toEqual([['r']]); // exactly one expiry, at the extended deadline
    expect(heap.isActive('a', 'p', 'r')).toBe(false);
  });

  it('clear() cancels the timer, the active set, and pending entries', () => {
    const { clock, heap, batches } = make();
    heap.push({ deadline: 40, rowId: 'a', colId: 'p', ruleId: 'r' });
    heap.clear();
    expect(clock.pendingTimerCount()).toBe(0);
    expect(heap.isActive('a', 'p', 'r')).toBe(false);
    clock.advance(1000);
    expect(batches).toEqual([]);
  });

  it('onExpire unsubscribe stops notifications', () => {
    const clock = makeClock();
    const heap = new ExpiryHeap({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const seen: string[][] = [];
    const un = heap.onExpire((expired) => seen.push(expired.map((e) => e.ruleId)));
    un();
    heap.push(entry(10, 'r'));
    clock.advance(20);
    expect(seen).toEqual([]);
  });
});
