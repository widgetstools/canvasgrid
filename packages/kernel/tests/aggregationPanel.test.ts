/**
 * Cycle 13 / Task 3 — agAggregationComponent test suite.
 *
 * 18 cases split across three layers:
 *
 *   - aggMath (pure functions): 9 cases proving the math contract on
 *     edge inputs (empty / single / count-only / mixed-type / NaN /
 *     Infinity / negative). One of these is the perf gate: ≤ 1 ms over
 *     500 finite numerics.
 *   - AgAggregationPanel render path: 8 cases proving the panel honours
 *     the design decisions — init renders nothing when empty, refresh
 *     un-hides on a range, canonical stat order, em-dash for N/A,
 *     `aggFuncs` restriction, custom `valueFormatter`, refresh triggers,
 *     destroy unsubscribes.
 *   - Registry wiring: 1 case proving `agAggregationComponent` is
 *     wired to `AgAggregationPanel` via the canonical built-in seeds.
 *
 * The fake api here is a minimal `AggPanelApi` — `getCellRanges`,
 * `getSelectedRowIds`, `getCellValue`, `addEventListener`. Same
 * approach as `countPanels.test.ts` — the panels intentionally read a
 * narrow subset and the test proves that subset is the contract.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { aggregate, CANONICAL_AGG_ORDER, type AggFunc } from '../src/interaction/statusBar/aggMath';
import {
  AgAggregationPanel,
  readRangeValues,
} from '../src/interaction/statusBar/panels/aggregation';
import { StatusPanelRegistry, BUILT_IN_STATUS_PANEL_KEYS } from '../src/interaction/statusBar/registry';
import type { CGridEvent, SelectionRange } from '../src/types';

type EventType = CGridEvent['type'];
type AnyHandler = (event: CGridEvent) => void;

/** Minimal CGridApi mock for the agg panel. Lets the test drive
 *  selection state + emit events synchronously, asserting both the
 *  render output and the listener-bookkeeping contract. */
class FakeApi {
  ranges: SelectionRange[] = [];
  selectedRowIds: string[] = [];
  /** Cell value lookup keyed by `${rowIndex}|${colId}`. */
  cells: Map<string, unknown> = new Map();
  private listeners: Map<EventType, Set<AnyHandler>> = new Map();

  getCellRanges(): SelectionRange[] { return this.ranges.slice(); }
  getSelectedRowIds(): string[] { return this.selectedRowIds.slice(); }
  getCellValue(rowIndex: number, colId: string): unknown {
    return this.cells.get(`${rowIndex}|${colId}`) ?? null;
  }
  setCell(rowIndex: number, colId: string, value: unknown): void {
    this.cells.set(`${rowIndex}|${colId}`, value);
  }
  addEventListener<K extends EventType>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): () => void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(handler as AnyHandler);
    return () => {
      this.listeners.get(type)?.delete(handler as AnyHandler);
    };
  }
  emit(event: CGridEvent): void {
    const bucket = this.listeners.get(event.type);
    if (!bucket) return;
    for (const h of Array.from(bucket)) h(event);
  }
  listenerCount(type: EventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** Pull the rendered label/value pairs from a panel root, in DOM order.
 *  Returns the array `[{label, value}, ...]` so a test can assert both
 *  the canonical ordering and the per-stat text in one shape. */
function getStats(root: HTMLElement): Array<{ label: string; value: string }> {
  const stats: Array<{ label: string; value: string }> = [];
  for (const statEl of Array.from(root.querySelectorAll('.cg-status-panel-agg-stat'))) {
    const label = statEl.querySelector('.cg-status-panel-agg-label')?.textContent ?? '';
    const value = statEl.querySelector('.cg-status-panel-agg-value')?.textContent ?? '';
    stats.push({ label, value });
  }
  return stats;
}

describe('aggMath.aggregate (pure functions)', () => {
  it('empty input — count=0, sum=0, min/max/avg=NaN (the no-input defaults)', () => {
    const r = aggregate([]);
    expect(r.count).toBe(0);
    expect(r.sum).toBe(0);
    expect(Number.isNaN(r.min)).toBe(true);
    expect(Number.isNaN(r.max)).toBe(true);
    expect(Number.isNaN(r.avg)).toBe(true);
  });

  it('single finite value [42] — every stat equals the value (or 1 for count)', () => {
    const r = aggregate([42]);
    expect(r).toEqual({ count: 1, sum: 42, min: 42, max: 42, avg: 42 });
  });

  it('count-only restriction — request just [count], the result reports count and "no input" defaults for the rest', () => {
    const r = aggregate([10, 20, 30], ['count']);
    expect(r.count).toBe(3);
    // sum/min/max/avg were NOT requested → "no input" defaults.
    expect(r.sum).toBe(0);
    expect(Number.isNaN(r.min)).toBe(true);
    expect(Number.isNaN(r.max)).toBe(true);
    expect(Number.isNaN(r.avg)).toBe(true);
  });

  it('mixed-type input — count covers every cell, numerics drive sum/min/max/avg only', () => {
    // 5 cells total: 3 finite numerics + 1 string + 1 null. count = 5,
    // numeric aggregates run over [10, 20, 30] — decision 6.
    const r = aggregate([10, 'AAPL', 20, null, 30]);
    expect(r.count).toBe(5);
    expect(r.sum).toBe(60);
    expect(r.min).toBe(10);
    expect(r.max).toBe(30);
    expect(r.avg).toBe(20);
  });

  it('NaN and Infinity are skipped from numerics (non-finite per isAggregable)', () => {
    // Plain NaN → not finite → skipped. ±Infinity same. The two
    // surviving values are 5 and 7 — sum/min/max/avg run over them.
    const r = aggregate([5, NaN, 7, Infinity, -Infinity]);
    expect(r.count).toBe(5); // every cell counted
    expect(r.sum).toBe(12);
    expect(r.min).toBe(5);
    expect(r.max).toBe(7);
    expect(r.avg).toBe(6);
  });

  it('all non-finite input — count = length, sum = 0, min/max/avg = NaN', () => {
    // The "all-strings range" case from the design notes.
    const r = aggregate(['AAPL', 'MSFT', null, undefined, NaN]);
    expect(r.count).toBe(5);
    expect(r.sum).toBe(0);
    expect(Number.isNaN(r.min)).toBe(true);
    expect(Number.isNaN(r.max)).toBe(true);
    expect(Number.isNaN(r.avg)).toBe(true);
  });

  it('negative numbers — min/max/sum/avg respect sign', () => {
    const r = aggregate([-5, -3, -10, 2, 4]);
    expect(r.count).toBe(5);
    expect(r.sum).toBe(-12);
    expect(r.min).toBe(-10);
    expect(r.max).toBe(4);
    expect(r.avg).toBeCloseTo(-2.4, 10);
  });

  it('CANONICAL_AGG_ORDER is the canonical order (Count → Sum → Min → Max → Avg)', () => {
    expect(CANONICAL_AGG_ORDER).toEqual(['count', 'sum', 'min', 'max', 'avg']);
  });

  it('perf — aggregate(500 finite numerics) returns in ≤ 1 ms (Architecture perf gate)', () => {
    // Build a deterministic 500-value sample. We run the aggregate
    // many times and take the median to absorb GC / V8 warmup jitter,
    // then assert the median is under the gate. Median (not mean)
    // because one cold-start spike can blow a mean way past 1ms while
    // the typical pass is sub-100µs.
    const values = new Array(500);
    for (let i = 0; i < 500; i++) values[i] = (i * 37 % 1000) + 0.5;
    // Warm up V8.
    for (let i = 0; i < 50; i++) aggregate(values);
    const timings: number[] = [];
    for (let trial = 0; trial < 25; trial++) {
      const start = performance.now();
      aggregate(values);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length / 2)]!;
    expect(median).toBeLessThan(1);
  });
});

describe('AgAggregationPanel render path', () => {
  let api: FakeApi;
  let panel: AgAggregationPanel;

  beforeEach(() => {
    api = new FakeApi();
    panel = new AgAggregationPanel();
  });

  it('init with no selection — panel hidden (decision 4 inversion of the count "never collapse" rule)', () => {
    panel.init({ api });
    const gui = panel.getGui();
    expect(gui.hidden).toBe(true);
    // Subscriptions still wired regardless of hidden state.
    expect(api.listenerCount('cellSelectionChanged')).toBe(1);
    expect(api.listenerCount('selectionChanged')).toBe(1);
    panel.destroy();
  });

  it('range selection over a numeric column — renders 5 stats in canonical order with `·` separators', () => {
    // Seed a single column "px" with values 10, 20, 30, 40, 50 at
    // rows 0..4. Range covers all five. Expect Count=5, Sum=150,
    // Min=10, Max=50, Avg=30. Stats render in canonical order
    // regardless of any input order.
    for (let r = 0; r < 5; r++) api.setCell(r, 'px', (r + 1) * 10);
    api.ranges = [{ rowStart: 0, rowEnd: 4, colIds: ['px'] }];
    panel.init({ api });
    const gui = panel.getGui();
    expect(gui.hidden).toBe(false);
    expect(getStats(gui)).toEqual([
      { label: 'Count:', value: '5' },
      { label: 'Sum:', value: '150' },
      { label: 'Min:', value: '10' },
      { label: 'Max:', value: '50' },
      { label: 'Avg:', value: '30' },
    ]);
    // 4 separators between 5 stats.
    expect(gui.querySelectorAll('.cg-status-panel-agg-separator').length).toBe(4);
    expect(gui.querySelector('.cg-status-panel-agg-separator')?.textContent).toBe('·');
    expect(gui.querySelector('.cg-status-panel-agg-separator')?.getAttribute('aria-hidden')).toBe('true');
    panel.destroy();
  });

  it('refresh on cellSelectionChanged un-hides the panel + renders the new stats', () => {
    panel.init({ api });
    expect(panel.getGui().hidden).toBe(true);
    // Mutate selection then emit the trigger event.
    api.setCell(0, 'px', 100);
    api.ranges = [{ rowStart: 0, rowEnd: 0, colIds: ['px'] }];
    api.emit({ type: 'cellSelectionChanged', ranges: api.ranges });
    expect(panel.getGui().hidden).toBe(false);
    expect(getStats(panel.getGui())).toEqual([
      { label: 'Count:', value: '1' },
      { label: 'Sum:', value: '100' },
      { label: 'Min:', value: '100' },
      { label: 'Max:', value: '100' },
      { label: 'Avg:', value: '100' },
    ]);
    panel.destroy();
  });

  it('row-only selection (no ranges) — Count is defined, numerics show em-dash (N/A without a column)', () => {
    api.selectedRowIds = ['row-1', 'row-2', 'row-3'];
    panel.init({ api });
    const gui = panel.getGui();
    expect(gui.hidden).toBe(false);
    const stats = getStats(gui);
    expect(stats[0]).toEqual({ label: 'Count:', value: '3' });
    // Sum is 0 (mathematical convention for empty numeric set per
    // aggMath contract — see decision 5 + aggMath module doc).
    expect(stats[1]).toEqual({ label: 'Sum:', value: '0' });
    // Min/Max/Avg of an empty numeric set are NaN → em-dash.
    expect(stats[2]).toEqual({ label: 'Min:', value: '—' });
    expect(stats[3]).toEqual({ label: 'Max:', value: '—' });
    expect(stats[4]).toEqual({ label: 'Avg:', value: '—' });
    panel.destroy();
  });

  it('aggFuncs restriction — only the requested funcs render, in canonical order regardless of input order', () => {
    // Caller passes `['avg', 'count']` → panel renders Count THEN Avg
    // (decision 3, canonical order wins).
    for (let r = 0; r < 4; r++) api.setCell(r, 'px', (r + 1) * 5);
    api.ranges = [{ rowStart: 0, rowEnd: 3, colIds: ['px'] }];
    panel.init({ api, statusPanelParams: { aggFuncs: ['avg', 'count'] as AggFunc[] } });
    const stats = getStats(panel.getGui());
    expect(stats.map((s) => s.label)).toEqual(['Count:', 'Avg:']);
    expect(stats).toEqual([
      { label: 'Count:', value: '4' },
      { label: 'Avg:', value: '12.5' },
    ]);
    // 2 stats → 1 separator.
    expect(panel.getGui().querySelectorAll('.cg-status-panel-agg-separator').length).toBe(1);
    panel.destroy();
  });

  it('custom valueFormatter — every stat goes through the supplied formatter', () => {
    for (let r = 0; r < 3; r++) api.setCell(r, 'pnl', (r + 1) * 1000);
    api.ranges = [{ rowStart: 0, rowEnd: 2, colIds: ['pnl'] }];
    const formatterCalls: Array<{ value: number; func: AggFunc }> = [];
    panel.init({
      api,
      statusPanelParams: {
        valueFormatter: ({ value, func }) => {
          formatterCalls.push({ value, func });
          // Tag each value with the func so we can assert routing.
          return `${func}=${value}`;
        },
      },
    });
    const stats = getStats(panel.getGui());
    expect(stats).toEqual([
      { label: 'Count:', value: 'count=3' },
      { label: 'Sum:', value: 'sum=6000' },
      { label: 'Min:', value: 'min=1000' },
      { label: 'Max:', value: 'max=3000' },
      { label: 'Avg:', value: 'avg=2000' },
    ]);
    // Formatter was invoked exactly 5 times (one per finite stat),
    // never with NaN (em-dash handled upstream).
    expect(formatterCalls.length).toBe(5);
    panel.destroy();
  });

  it('disjoint ranges flatten into a single value array (union semantics, matches spreadsheet Ctrl-click)', () => {
    api.setCell(0, 'px', 10);
    api.setCell(1, 'px', 20);
    api.setCell(5, 'px', 100);
    api.ranges = [
      { rowStart: 0, rowEnd: 1, colIds: ['px'] },
      { rowStart: 5, rowEnd: 5, colIds: ['px'] },
    ];
    panel.init({ api });
    const stats = getStats(panel.getGui());
    expect(stats[0]).toEqual({ label: 'Count:', value: '3' });
    expect(stats[1]).toEqual({ label: 'Sum:', value: '130' });
    expect(stats[2]).toEqual({ label: 'Min:', value: '10' });
    expect(stats[3]).toEqual({ label: 'Max:', value: '100' });
    panel.destroy();
  });

  it('destroy unsubscribes both triggers — events after destroy do NOT touch the gui', () => {
    api.setCell(0, 'px', 7);
    api.ranges = [{ rowStart: 0, rowEnd: 0, colIds: ['px'] }];
    panel.init({ api });
    expect(api.listenerCount('cellSelectionChanged')).toBe(1);
    expect(api.listenerCount('selectionChanged')).toBe(1);
    panel.destroy();
    expect(api.listenerCount('cellSelectionChanged')).toBe(0);
    expect(api.listenerCount('selectionChanged')).toBe(0);
    // Snapshot the post-destroy gui state then fire an event and
    // assert the DOM didn't change.
    const beforeStats = getStats(panel.getGui());
    api.setCell(0, 'px', 99999);
    api.emit({ type: 'cellSelectionChanged', ranges: api.ranges });
    expect(getStats(panel.getGui())).toEqual(beforeStats);
  });
});

describe('readRangeValues (range → flat values array)', () => {
  it('preserves rowStart inclusive + rowEnd inclusive (matches SelectionRange contract)', () => {
    const api = new FakeApi();
    // Seed rows 2..4 inclusive — three rows.
    api.setCell(2, 'a', 'x');
    api.setCell(3, 'a', 'y');
    api.setCell(4, 'a', 'z');
    const out = readRangeValues(
      [{ rowStart: 2, rowEnd: 4, colIds: ['a'] }],
      api,
    );
    expect(out).toEqual(['x', 'y', 'z']);
  });
});

describe('registry wiring', () => {
  it('agAggregationComponent resolves to AgAggregationPanel via seedBuiltIns (no stub)', () => {
    const reg = new StatusPanelRegistry();
    reg.seedBuiltIns();
    // Every built-in key has a real ctor registered — for Task 3 that
    // includes agAggregationComponent.
    for (const key of BUILT_IN_STATUS_PANEL_KEYS) {
      expect(reg.resolve(key)).not.toBeNull();
    }
    const ctor = reg.resolve('agAggregationComponent');
    expect(ctor).toBe(AgAggregationPanel);
  });
});
