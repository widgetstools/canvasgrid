/**
 * Task 13 (VelocityGrid production hardening) — A-P4, end to end.
 *
 * `modelUpdated` (every transaction flush) unconditionally ran
 * `new RowHeightIndex(rowCount, () => fallback)`: two fresh
 * `Float32Array(rowCount)` buffers plus an O(n) BIT build, even on a
 * uniform-height grid where the replacement was bit-identical to the
 * index it threw away.
 *
 * The fix keeps the index PRESENT at every consuming call site (the
 * no-index path is not equivalent — see the task report) and only skips
 * the reallocation when the existing index is already exactly what the
 * constructor would produce. These tests pin both halves: the object is
 * genuinely reused on a uniform grid, and the geometry every scroll/paint
 * consumer reads is unchanged.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import { RowHeightIndex } from '../src/core/rowHeightIndex';

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

interface Row { id: string; px: number }

const teardown: Array<() => void> = [];
afterEach(() => {
  while (teardown.length > 0) teardown.pop()!();
});

function mountGrid(data: Row[], extraOptions: Record<string, unknown> = {}) {
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
    rowHeight: 30,
    ...extraOptions,
  });
  teardown.push(() => {
    grid.destroy();
    (globalThis as any).Worker = prevWorker;
    container.remove();
  });
  return grid;
}

function rows(n: number): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < n; i++) out.push({ id: `r${i}`, px: i });
  return out;
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe('A-P4 — uniform-height grids stop reallocating the Fenwick index', () => {
  it('a transaction that leaves rowCount unchanged REUSES the index object', async () => {
    const grid = mountGrid(rows(200));
    await settle();
    const before = (grid as any).rowHeightIndex as RowHeightIndex | null;
    expect(before).not.toBeNull();
    expect(before!.length()).toBe(200);

    for (let i = 0; i < 5; i++) {
      grid.applyTransaction({ update: [{ id: `r${i}`, px: i * 1000 }] });
      await settle();
    }
    const after = (grid as any).rowHeightIndex as RowHeightIndex | null;
    // Pre-A-P4 this was a brand-new object (and two new Float32Arrays)
    // after EVERY flush.
    expect(after).toBe(before);
    // …and it is still the exact geometry every consumer reads.
    expect(after!.length()).toBe(200);
    expect(after!.topOf(0)).toBe(0);
    expect(after!.topOf(10)).toBe(300);
    expect(after!.totalHeight()).toBe(6000);
    expect(after!.rowAt(305)).toBe(10);
  });

  it('a rowCount change still rebuilds (index must cover the new population)', async () => {
    const grid = mountGrid(rows(50));
    await settle();
    const before = (grid as any).rowHeightIndex as RowHeightIndex | null;
    expect(before!.length()).toBe(50);

    grid.applyTransaction({ add: [{ id: 'rNEW', px: 999 }] });
    await settle();
    const after = (grid as any).rowHeightIndex as RowHeightIndex | null;
    expect(after).not.toBe(before);
    expect(after!.length()).toBe(51);
    expect(after!.totalHeight()).toBe(51 * 30);
  });

  it('a grid with per-row heights rebuilds (non-uniform ⇒ no skip), geometry intact', async () => {
    // `getRowHeight` makes every 10th row taller — the index is genuinely
    // mixed once a chunk lands, so the modelUpdated wipe-and-rebuild (which
    // deliberately resets to the grid fallback — heights follow row
    // IDENTITY, not slot) must still happen.
    const grid = mountGrid(rows(100), {
      getRowHeight: (p: { data: Row }) => (Number(p.data.px) % 10 === 0 ? 60 : 30),
    });
    await settle();
    const before = (grid as any).rowHeightIndex as RowHeightIndex | null;
    expect(before).not.toBeNull();
    expect(before!.isUniformAt(30)).toBe(false);

    grid.applyTransaction({ update: [{ id: 'r1', px: 1 }] });
    await settle();
    const after = (grid as any).rowHeightIndex as RowHeightIndex | null;
    expect(after).not.toBe(before);
    expect(after!.length()).toBe(100);
    // The rebuild seeds every row at the grid fallback and the follow-up
    // chunk then re-overlays the real per-row heights (`refreshRowHeightIndex`)
    // — so by the time the round-trip settles, row 0 is back at 60 and rows
    // 1..2 at 30: topOf(3) === 60 + 30 + 30. Exactly the pre-A-P4 behavior.
    expect(after!.heightAt(0)).toBe(60);
    expect(after!.topOf(3)).toBe(120);
  });

  it('the index is never null after the first model update (scroll math depends on it)', async () => {
    const grid = mountGrid(rows(400));
    await settle();
    expect((grid as any).rowHeightIndex).not.toBeNull();
    grid.applyTransaction({ update: [{ id: 'r2', px: 7 }] });
    await settle();
    expect((grid as any).rowHeightIndex).not.toBeNull();
    expect(((grid as any).rowHeightIndex as RowHeightIndex).totalHeight()).toBe(400 * 30);
  });
});
