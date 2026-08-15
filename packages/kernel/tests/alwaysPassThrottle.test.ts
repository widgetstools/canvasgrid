/**
 * Task 13 (VelocityGrid production hardening) — A-P6.
 *
 * `recomputeAlwaysPass` used to run on EVERY transaction: an O(dataset)
 * predicate scan, a full rowId ship to the worker, a whole pipeline
 * rebuild and a viewport fetch — per tick, on any grid configured with
 * `alwaysPassFilter`.
 *
 * Now:
 *   • transaction-driven refreshes coalesce on a 50 ms trailing throttle,
 *     armed by the FIRST request of a burst (so a continuous feed cannot
 *     starve it);
 *   • they re-evaluate only the rows the transaction touched, folded into
 *     the previously-shipped set;
 *   • the worker round-trip is skipped entirely when the resolved set is
 *     unchanged;
 *   • `setRowData` and `onFilterChanged` still rescan EVERY row,
 *     immediately (the documented escape hatch for a predicate that
 *     closes over external state), and `setRowData` forces a re-ship
 *     because the worker clears its own set on that message.
 *
 * Assertions are call COUNTS (predicate invocations, `setAlwaysPassRowIds`
 * ships), never timings.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';

beforeAll(() => {
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

interface Row { id: string; flagged: boolean; px: number }

function rows(n: number): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < n; i++) out.push({ id: `r${i}`, flagged: i === 0, px: i });
  return out;
}

const teardown: Array<() => void> = [];
afterEach(() => {
  while (teardown.length > 0) teardown.pop()!();
});

function mountGrid(data: Row[], alwaysPassFilter: (p: { data: Row; rowId: string }) => boolean) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const prevWorker = (globalThis as any).Worker;
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
  const grid = new VelocityGrid<Row>(container, {
    columnDefs: [{ field: 'id' }, { field: 'px' }],
    getRowId: (r) => r.id,
    rowData: data,
    alwaysPassFilter,
  });
  teardown.push(() => {
    grid.destroy();
    (globalThis as any).Worker = prevWorker;
    container.remove();
  });
  // Spy on the coordinator's ship so we can count worker round-trips.
  const coord = (grid as any).workerCoord;
  const ship = vi.spyOn(coord, 'setAlwaysPassRowIds');
  return { grid, ship };
}

const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('A-P6 — alwaysPassFilter transaction throttle', () => {
  it('a burst of transactions coalesces into ONE re-evaluation window', async () => {
    const predicate = vi.fn(({ data }: { data: Row }) => data.flagged);
    const { grid, ship } = mountGrid(rows(50), predicate);
    await settle(60);
    predicate.mockClear();
    ship.mockClear();

    for (let i = 0; i < 20; i++) {
      grid.applyTransactionAsync({ update: [{ id: `r${i}`, flagged: false, px: i + 1 }] });
    }
    await settle(120);

    // Pre-A-P6 this was 20 × 50 = 1000 predicate calls and 20 ships.
    // Now: one window, and only the touched rows are re-evaluated.
    expect(predicate.mock.calls.length).toBeLessThanOrEqual(20);
    expect(ship.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('an unchanged resolved set skips the worker round-trip entirely', async () => {
    // Predicate never matches ⇒ the set is empty before and after.
    const predicate = vi.fn(() => false);
    const { grid, ship } = mountGrid(rows(20), predicate);
    await settle(60);
    ship.mockClear();

    grid.applyTransactionAsync({ update: [{ id: 'r3', flagged: true, px: 99 }] });
    await settle(120);
    expect(ship).not.toHaveBeenCalled();
  });

  it('a genuine membership change still ships the new set', async () => {
    const flaggedIds = new Set<string>(['r0']);
    const predicate = vi.fn(({ rowId }: { rowId: string }) => flaggedIds.has(rowId));
    const { grid, ship } = mountGrid(rows(20), predicate);
    await settle(60);
    ship.mockClear();

    flaggedIds.add('r7');
    grid.applyTransactionAsync({ update: [{ id: 'r7', flagged: true, px: 99 }] });
    await settle(120);

    expect(ship).toHaveBeenCalledTimes(1);
    const shipped = ship.mock.calls[0]![0] as string[];
    expect(new Set(shipped)).toEqual(new Set(['r0', 'r7']));
  });

  it('a removed row drops out of the shipped set', async () => {
    const predicate = ({ data }: { data: Row }) => data.flagged;
    const { grid, ship } = mountGrid(rows(20), predicate);
    await settle(60);
    ship.mockClear();

    grid.applyTransactionAsync({ remove: [{ id: 'r0', flagged: true, px: 0 }] });
    await settle(120);

    expect(ship).toHaveBeenCalledTimes(1);
    expect(ship.mock.calls[0]![0]).toEqual([]);
  });

  it('an added row that matches enters the shipped set', async () => {
    const predicate = ({ data }: { data: Row }) => data.flagged;
    const { grid, ship } = mountGrid(rows(20), predicate);
    await settle(60);
    ship.mockClear();

    grid.applyTransactionAsync({ add: [{ id: 'rNEW', flagged: true, px: 1000 }] });
    await settle(120);

    expect(ship).toHaveBeenCalledTimes(1);
    expect(new Set(ship.mock.calls[0]![0] as string[])).toEqual(new Set(['r0', 'rNEW']));
  });

  it('a continuous feed still gets its window flushed (throttle, not starving debounce)', async () => {
    const flaggedIds = new Set<string>();
    const predicate = ({ rowId }: { rowId: string }) => flaggedIds.has(rowId);
    const { grid, ship } = mountGrid(rows(20), predicate);
    await settle(60);
    ship.mockClear();

    // Tick every 10 ms for 150 ms — a reset-on-every-call debounce at
    // 50 ms would never fire.
    flaggedIds.add('r5');
    for (let i = 0; i < 15; i++) {
      grid.applyTransactionAsync({ update: [{ id: 'r5', flagged: true, px: i }] });
      await settle(10);
    }
    await settle(120);
    expect(ship.mock.calls.length).toBeGreaterThanOrEqual(1);
    const last = ship.mock.calls[ship.mock.calls.length - 1]![0] as string[];
    expect(last).toEqual(['r5']);
  });

  it('onFilterChanged rescans EVERY row immediately (impure-predicate escape hatch)', async () => {
    let gate = false;
    const predicate = vi.fn(() => gate);
    const { grid, ship } = mountGrid(rows(30), predicate);
    await settle(60);
    predicate.mockClear();
    ship.mockClear();

    // Flip the state the predicate closes over WITHOUT any transaction.
    gate = true;
    grid.onFilterChanged();

    // Synchronous, exhaustive: every mirrored row re-evaluated, set shipped.
    expect(predicate.mock.calls.length).toBe(30);
    expect(ship).toHaveBeenCalledTimes(1);
    expect((ship.mock.calls[0]![0] as string[]).length).toBe(30);
  });

  it('setRowData re-ships even when the resolved set is identical (worker cleared its own)', async () => {
    const predicate = ({ data }: { data: Row }) => data.flagged;
    const { grid, ship } = mountGrid(rows(10), predicate);
    await settle(60);
    ship.mockClear();

    // Same ids, same verdicts — but the worker wiped `alwaysPassIds` on
    // this message, so main MUST re-ship rather than decide "unchanged".
    grid.setRowData(rows(10));
    await settle(60);
    expect(ship).toHaveBeenCalledTimes(1);
    expect(ship.mock.calls[0]![0]).toEqual(['r0']);
  });

  it('destroy cancels a pending throttle window (no post-teardown ship)', async () => {
    const flaggedIds = new Set<string>(['r0']);
    const predicate = ({ rowId }: { rowId: string }) => flaggedIds.has(rowId);
    const { grid, ship } = mountGrid(rows(10), predicate);
    await settle(60);
    ship.mockClear();

    flaggedIds.add('r4');
    grid.applyTransactionAsync({ update: [{ id: 'r4', flagged: true, px: 1 }] });
    grid.destroy();
    await settle(150);
    expect(ship).not.toHaveBeenCalled();
  });
});
