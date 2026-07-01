// Cycle 18 / Task 1 — PivotState primitive tests.
//
// PivotState is the single source of truth the pivot UIs (columns tool
// panel Values + Column Labels drop zones, the pivot panel, the header
// context menu) mutate. It mirrors GroupingState: ordered lists, idempotent
// verbs, no-op-no-event, fresh-array reads, a `pivotStateChanged` event,
// and serialize/restore for Grid State.
//
// State:
//   - pivotMode: boolean (master switch)
//   - pivotColumns: string[] (ordered — Column Labels / pivot dimensions)
//   - valueColumns: Array<{ colId; aggFunc }> (ordered — Values / measures)

import { describe, it, expect, vi } from 'vitest';
import { PivotState } from '../src/core/pivotState';

describe('PivotState — construction + reads', () => {
  it('defaults to pivotMode off, empty pivot + value columns', () => {
    const p = new PivotState();
    expect(p.isPivotMode()).toBe(false);
    expect(p.getPivotColumns()).toEqual([]);
    expect(p.getValueColumns()).toEqual([]);
    expect(p.isPivotActive()).toBe(false);
  });

  it('seeds from init', () => {
    const p = new PivotState({
      pivotMode: true,
      pivotColumns: ['sector'],
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
    });
    expect(p.isPivotMode()).toBe(true);
    expect(p.getPivotColumns()).toEqual(['sector']);
    expect(p.getValueColumns()).toEqual([{ colId: 'pnl', aggFunc: 'sum' }]);
  });

  it('reads return fresh copies — mutating them does not affect state', () => {
    const p = new PivotState({ pivotColumns: ['a'], valueColumns: [{ colId: 'v', aggFunc: 'sum' }] });
    p.getPivotColumns().push('b');
    p.getValueColumns().push({ colId: 'x', aggFunc: 'avg' });
    p.getValueColumns()[0]!.aggFunc = 'max';
    expect(p.getPivotColumns()).toEqual(['a']);
    expect(p.getValueColumns()).toEqual([{ colId: 'v', aggFunc: 'sum' }]);
  });
});

describe('PivotState — isPivotActive', () => {
  it('requires pivotMode AND >=1 pivot col AND >=1 value col', () => {
    const p = new PivotState();
    expect(p.isPivotActive()).toBe(false);
    p.setPivotMode(true);
    expect(p.isPivotActive()).toBe(false); // no pivot/value cols
    p.addPivotColumn('sector');
    expect(p.isPivotActive()).toBe(false); // no value col
    p.addValueColumn('pnl', 'sum');
    expect(p.isPivotActive()).toBe(true);
    p.setPivotMode(false);
    expect(p.isPivotActive()).toBe(false); // mode off
  });
});

describe('PivotState — setPivotMode', () => {
  it('flips the flag and emits source "mode"; idempotent', () => {
    const p = new PivotState();
    const events: string[] = [];
    p.on('pivotStateChanged', (e) => events.push(e.source));
    p.setPivotMode(true);
    p.setPivotMode(true); // no-op
    p.setPivotMode(false);
    expect(events).toEqual(['mode', 'mode']);
    expect(p.isPivotMode()).toBe(false);
  });
});

describe('PivotState — pivot columns', () => {
  it('addPivotColumn appends; idempotent (no dup, no event)', () => {
    const p = new PivotState();
    const events: string[] = [];
    p.on('pivotStateChanged', (e) => events.push(e.source));
    p.addPivotColumn('sector');
    p.addPivotColumn('assetClass');
    p.addPivotColumn('sector'); // dup → no-op
    expect(p.getPivotColumns()).toEqual(['sector', 'assetClass']);
    expect(events).toEqual(['add', 'add']);
  });

  it('removePivotColumn removes; idempotent', () => {
    const p = new PivotState({ pivotColumns: ['a', 'b', 'c'] });
    p.removePivotColumn('b');
    p.removePivotColumn('zzz'); // not present → no-op
    expect(p.getPivotColumns()).toEqual(['a', 'c']);
  });

  it('setPivotColumns replaces wholesale; no-op when identical', () => {
    const p = new PivotState({ pivotColumns: ['a', 'b'] });
    const events: string[] = [];
    p.on('pivotStateChanged', (e) => events.push(e.source));
    p.setPivotColumns(['a', 'b']); // identical → no-op
    p.setPivotColumns(['c']);
    expect(p.getPivotColumns()).toEqual(['c']);
    expect(events).toEqual(['set']);
  });

  it('movePivotColumn reorders (splice semantics, like GroupingState)', () => {
    const p = new PivotState({ pivotColumns: ['a', 'b', 'c'] });
    p.movePivotColumn(2, 0); // c to front
    expect(p.getPivotColumns()).toEqual(['c', 'a', 'b']);
    p.movePivotColumn(0, 3); // c to end
    expect(p.getPivotColumns()).toEqual(['a', 'b', 'c']);
  });

  it('movePivotColumn no-ops on out-of-range / same-slot', () => {
    const p = new PivotState({ pivotColumns: ['a', 'b'] });
    const events: string[] = [];
    p.on('pivotStateChanged', (e) => events.push(e.source));
    p.movePivotColumn(5, 0); // out of range
    p.movePivotColumn(0, 0); // same slot
    p.movePivotColumn(1, 1); // same slot
    expect(events).toEqual([]);
    expect(p.getPivotColumns()).toEqual(['a', 'b']);
  });
});

describe('PivotState — value columns', () => {
  it('addValueColumn appends {colId, aggFunc}; idempotent by colId', () => {
    const p = new PivotState();
    p.addValueColumn('pnl', 'sum');
    p.addValueColumn('qty', 'avg');
    p.addValueColumn('pnl', 'max'); // colId already present → no-op
    expect(p.getValueColumns()).toEqual([
      { colId: 'pnl', aggFunc: 'sum' },
      { colId: 'qty', aggFunc: 'avg' },
    ]);
  });

  it('setValueColumnAggFunc changes the func; no-op when unchanged or absent', () => {
    const p = new PivotState({ valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const events: string[] = [];
    p.on('pivotStateChanged', (e) => events.push(e.source));
    p.setValueColumnAggFunc('pnl', 'sum'); // unchanged → no-op
    p.setValueColumnAggFunc('absent', 'avg'); // not present → no-op
    p.setValueColumnAggFunc('pnl', 'avg');
    expect(p.getValueColumns()).toEqual([{ colId: 'pnl', aggFunc: 'avg' }]);
    expect(events).toEqual(['aggFunc']);
  });

  it('removeValueColumn removes by colId; idempotent', () => {
    const p = new PivotState({ valueColumns: [{ colId: 'a', aggFunc: 'sum' }, { colId: 'b', aggFunc: 'avg' }] });
    p.removeValueColumn('a');
    p.removeValueColumn('zzz');
    expect(p.getValueColumns()).toEqual([{ colId: 'b', aggFunc: 'avg' }]);
  });

  it('moveValueColumn reorders', () => {
    const p = new PivotState({ valueColumns: [{ colId: 'a', aggFunc: 'sum' }, { colId: 'b', aggFunc: 'avg' }, { colId: 'c', aggFunc: 'min' }] });
    // Gap-index semantics (same as GroupingState.moveRowGroupColumn): moving
    // index 0 to gap 2 drops 'a' between b and c → ['b','a','c'].
    p.moveValueColumn(0, 2);
    expect(p.getValueColumns().map((v) => v.colId)).toEqual(['b', 'a', 'c']);
    // Moving to gap 3 (== length) drops at the very end.
    p.moveValueColumn(0, 3); // 'b' to end
    expect(p.getValueColumns().map((v) => v.colId)).toEqual(['a', 'c', 'b']);
  });
});

describe('PivotState — event payload', () => {
  it('carries the full new state snapshot + source on every change', () => {
    const p = new PivotState();
    const handler = vi.fn();
    p.on('pivotStateChanged', handler);
    p.setPivotMode(true);
    p.addPivotColumn('sector');
    p.addValueColumn('pnl', 'sum');
    const last = handler.mock.calls.at(-1)![0];
    expect(last).toMatchObject({
      type: 'pivotStateChanged',
      pivotMode: true,
      pivotColumns: ['sector'],
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
      source: 'add',
    });
  });

  it('event arrays are fresh copies (mutating them does not corrupt state)', () => {
    const p = new PivotState();
    p.on('pivotStateChanged', (e) => {
      e.pivotColumns.push('hacked');
      e.valueColumns.push({ colId: 'hacked', aggFunc: 'sum' });
    });
    p.addPivotColumn('sector');
    p.addValueColumn('pnl', 'sum');
    expect(p.getPivotColumns()).toEqual(['sector']);
    expect(p.getValueColumns()).toEqual([{ colId: 'pnl', aggFunc: 'sum' }]);
  });
});

describe('PivotState — serialize / restore', () => {
  it('serialize → restore round-trips all state', () => {
    const p = new PivotState({
      pivotMode: true,
      pivotColumns: ['sector', 'assetClass'],
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }, { colId: 'qty', aggFunc: 'avg' }],
    });
    const snap = JSON.parse(JSON.stringify(p.serialize()));

    const q = new PivotState();
    const events: string[] = [];
    q.on('pivotStateChanged', (e) => events.push(e.source));
    q.restore(snap);

    expect(q.isPivotMode()).toBe(true);
    expect(q.getPivotColumns()).toEqual(['sector', 'assetClass']);
    expect(q.getValueColumns()).toEqual([{ colId: 'pnl', aggFunc: 'sum' }, { colId: 'qty', aggFunc: 'avg' }]);
    expect(events).toEqual(['restore']);
  });

  it('serialize output is independent of the instance', () => {
    const p = new PivotState({ pivotColumns: ['a'] });
    const snap = p.serialize();
    p.addPivotColumn('b');
    expect(snap.pivotColumns).toEqual(['a']); // snapshot frozen at serialize time
  });
});

describe('PivotState — destroy', () => {
  it('after destroy, mutations are no-ops and emit nothing', () => {
    const p = new PivotState();
    const handler = vi.fn();
    p.on('pivotStateChanged', handler);
    p.destroy();
    p.setPivotMode(true);
    p.addPivotColumn('x');
    p.addValueColumn('v', 'sum');
    expect(handler).not.toHaveBeenCalled();
    expect(p.isPivotMode()).toBe(false);
  });
});
