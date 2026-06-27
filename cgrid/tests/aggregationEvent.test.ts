// Cycle 14 / Task 6 — `aggregationChanged` event payload polish.
//
// The grid already fired `aggregationChanged` from earlier cycles (the
// foundation viewport-response handler), but the payload only carried
// `totals` — listeners couldn't tell whether the recompute was driven
// by a data mutation, a filter pass, an `aggFuncs` swap, a per-column
// aggFunc change, or an explicit imperative API call. This task adds
// the `source` discriminator and tightens the firing rules: cosmetic
// re-renders (sort, scroll, theme, column move / visible / pin /
// resize) MUST NOT fire — listeners that want every paint go via
// `viewportChanged` instead.
//
// Five cases, in spec order:
//   1. payload shape — `{ type, totals, source }` arrives on the
//      listener with the worker-computed totals attached.
//   2. source tag — different triggers produce different `source`
//      strings on the next emit; the tag identifies the cause.
//   3. fires on `setRowData` (data mutation → `rowDataChanged`).
//   4. fires on `setColumnFilterModel` (filter pipeline →
//      `filterChanged`).
//   5. does NOT fire on cosmetic re-renders — sort, scroll, theme.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { AggregationChangedEvent, CGridEvent } from '../src/types';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: any) { this.host.handle(msg); }
    addEventListener(_: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
    terminate() {}
  };

  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as any;
  })() as any;
});

type Row = { id: string; price: number; qty: number };

function mkGrid(opts?: Partial<Parameters<typeof CGrid<Row>>[1]>) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<Row>(container, {
    columnDefs: [
      { field: 'id' },
      { field: 'price', aggFunc: 'sum' },
      { field: 'qty', aggFunc: 'sum' },
    ],
    getRowId: (r) => r.id,
    rowData: [
      { id: 'r1', price: 10, qty: 1 },
      { id: 'r2', price: 20, qty: 2 },
      { id: 'r3', price: 30, qty: 3 },
    ],
    ...(opts ?? {}),
  });
  const events: AggregationChangedEvent[] = [];
  grid.on('aggregationChanged', (e) => events.push(e));
  return {
    grid,
    container,
    events,
    cleanup: () => { grid.destroy(); container.remove(); },
  };
}

const tick = (ms: number = 30) => new Promise((r) => setTimeout(r, ms));

describe('aggregationChanged — payload shape', () => {
  // 1 — Payload shape. The emit carries `{ type, totals, source }` —
  // `type` is the discriminator the typed-event union dispatches on,
  // `totals` is the per-column map keyed by colId, `source` tags the
  // cause. This is the contract apps lock onto; any drift here is a
  // breaking change for listener code.
  it('emits { type, totals, source } when initial rowData lands', async () => {
    const t = mkGrid();
    await tick(50);
    expect(t.events.length).toBeGreaterThanOrEqual(1);
    const e = t.events[0]!;
    expect(e.type).toBe('aggregationChanged');
    // `totals` is the worker-computed map; the columns we declared
    // `aggFunc: 'sum'` for both appear with the sum of the seeded rows.
    expect(e.totals).toBeDefined();
    expect(e.totals.price).toBe(60); // 10 + 20 + 30
    expect(e.totals.qty).toBe(6);    // 1 + 2 + 3
    // `source` is the discriminator added in Task 6. The initial seed
    // is the rowData option flowing through `setRowData` — same source
    // tag a runtime `setRowData(...)` call produces.
    expect(e.source).toBe('rowDataChanged');
    t.cleanup();
  });
});

describe('aggregationChanged — source tag varies with trigger', () => {
  // 2 — Source tag varies with trigger. Apps that need to render
  // different UI for different causes (e.g. spinner on filter, toast
  // on data update) read `source` and switch. The same totals payload
  // with a different `source` is a legitimate signal — the worker
  // recomputed under a new pipeline state. Confirm at least two
  // distinct `source` values fire on this grid: `rowDataChanged` on
  // init + `filterChanged` on the column filter swap.
  it('rowDataChanged for initial seed, filterChanged for column filter', async () => {
    const t = mkGrid();
    await tick(50);
    // Initial seed.
    const initial = t.events[0]!;
    expect(initial.source).toBe('rowDataChanged');
    const initialCount = t.events.length;
    // Filter to a single row → totals shrink to that row's values.
    await t.grid.setColumnFilterModel('price', {
      filterType: 'number', type: 'equals', filter: 20,
    });
    await tick(50);
    expect(t.events.length).toBeGreaterThan(initialCount);
    const filterEvt = t.events[t.events.length - 1]!;
    expect(filterEvt.source).toBe('filterChanged');
    // And the totals reflect the filter — only `r2` (price=20, qty=2)
    // survived, so the sums collapse to that row.
    expect(filterEvt.totals.price).toBe(20);
    expect(filterEvt.totals.qty).toBe(2);
    t.cleanup();
  });
});

describe('aggregationChanged — fires on rowData mutation', () => {
  // 3 — `setRowData` (full replace) fires `aggregationChanged` with
  // `source: 'rowDataChanged'` AND the totals reflect the new row set.
  // The intermediate state (between worker setRowData → viewport
  // response) shouldn't emit early; only the final viewport response
  // carries the recomputed totals.
  it('setRowData fires aggregationChanged with source rowDataChanged + new totals', async () => {
    const t = mkGrid();
    await tick(50);
    const before = t.events.length;
    // Replace with rows whose sums differ from the seed.
    t.grid.setRowData([
      { id: 'a', price: 100, qty: 5 },
      { id: 'b', price: 200, qty: 5 },
    ]);
    await tick(50);
    expect(t.events.length).toBeGreaterThan(before);
    const e = t.events[t.events.length - 1]!;
    expect(e.source).toBe('rowDataChanged');
    expect(e.totals.price).toBe(300); // 100 + 200
    expect(e.totals.qty).toBe(10);    // 5 + 5
    t.cleanup();
  });
});

describe('aggregationChanged — fires on filter mutation', () => {
  // 4 — `setColumnFilterModel` fires `aggregationChanged` with
  // `source: 'filterChanged'`. The filter pipeline change recomputes
  // the totals against the surviving row set; the listener gets a
  // tag that matches the upstream `filterChanged` event so apps can
  // correlate the two.
  it('setColumnFilterModel fires aggregationChanged with source filterChanged', async () => {
    const t = mkGrid();
    await tick(50);
    const before = t.events.length;
    // Filter price > 15 → drops r1, keeps r2 + r3.
    await t.grid.setColumnFilterModel('price', {
      filterType: 'number', type: 'greaterThan', filter: 15,
    });
    await tick(50);
    expect(t.events.length).toBeGreaterThan(before);
    const e = t.events[t.events.length - 1]!;
    expect(e.source).toBe('filterChanged');
    expect(e.totals.price).toBe(50); // 20 + 30
    expect(e.totals.qty).toBe(5);    // 2 + 3
    t.cleanup();
  });
});

describe('aggregationChanged — cosmetic re-renders do NOT fire', () => {
  // 5 — Sort, scroll, theme are cosmetic — they don't change which
  // rows are in the visible set, so the totals don't change either.
  // Firing the event for them would be a false positive: apps that
  // update a sticky banner on every emit would see redundant churn
  // on every scroll tick. The current chunk-response handler still
  // computes totals on every chunk; the gating happens via
  // `pendingAggSource` — cosmetic re-fetches pass `null` and don't
  // set the pending source, so the event is suppressed.
  it('sort + scroll + theme do NOT fire aggregationChanged', async () => {
    const t = mkGrid();
    await tick(50);
    const afterInit = t.events.length;
    expect(afterInit).toBeGreaterThan(0); // initial fired
    // (a) Sort. Same rows, just reordered → same totals → no emit.
    t.grid.setSortModel([{ colId: 'price', sort: 'desc' }]);
    await tick(50);
    expect(t.events.length).toBe(afterInit);
    // (b) Scroll. The scroller's scroll event triggers a viewport
    // re-fetch for the new row range. Same rows in the model, same
    // totals → no emit.
    const grid = t.grid as unknown as { onScrollerScroll: (x: number, y: number) => void };
    grid.onScrollerScroll(0, 100);
    await tick(50);
    expect(t.events.length).toBe(afterInit);
    // (c) Theme. `setGridOption('theme', …)` swaps the theme class
    // and triggers a repaint, but no worker round-trip. We assert
    // no aggregationChanged emit fires.
    t.grid.setGridOption('theme', 'cg-theme-balham');
    await tick(50);
    expect(t.events.length).toBe(afterInit);
    t.cleanup();
  });

  // Extra guard — the event type IS a member of `CGridEvent`. This is
  // a static type assertion that prevents a future refactor from
  // dropping the discriminator from the public union by accident.
  it('AggregationChangedEvent is assignable to CGridEvent', () => {
    const evt: AggregationChangedEvent = {
      type: 'aggregationChanged',
      totals: { x: 1 },
      source: 'api',
    };
    const wide: CGridEvent = evt;
    expect(wide.type).toBe('aggregationChanged');
  });
});
