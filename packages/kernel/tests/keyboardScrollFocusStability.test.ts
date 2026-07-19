/**
 * Regression locks for the keyboard-scroll focus instability:
 *
 *   SYMPTOM 1 — holding ArrowDown, the focus ring bounces up/down before
 *   settling: async `getRowIndicesForIds` replies (fired per live-tick
 *   `modelUpdated`) landed AFTER focus had already moved on, remapping
 *   focus back to the request-time row's index.
 *
 *   SYMPTOM 2 — ArrowUp at the first visible row teleported the grid to
 *   row 0 from anywhere: focus on a not-yet-loaded row recorded the
 *   SYNTHETIC `row-<n>` id (`rowIdAt`'s fallback), the worker resolved it
 *   to -1, `rebuildIndices` nulled the focus, and the next arrow press
 *   navigated from `fr ?? 1` → row 0 → `ensureRowIndexVisible(0)` rolled
 *   the viewport to the top.
 *
 * Two fixes, locked separately:
 *   A. cgrid's selection resolver records ONLY real chunk row ids — a row
 *      outside the loaded window (or a group/footer row) records null, so
 *      no unresolvable synthetic id can ever null the focus.
 *   B. `rebuildIndices` remaps focus only when the reply's map has an
 *      entry for the CURRENT focused id — a stale reply for a superseded
 *      focus leaves the focus index alone.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SelectionModel } from '../src/interaction/selectionModel';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { CGridOptions } from '../src/types/options';

// ─── Fix B: stale-reply guard (pure SelectionModel unit) ─────────────────────

describe('SelectionModel.rebuildIndices — stale-reply focus guard', () => {
  function makeModel() {
    const model = new SelectionModel('multiple');
    const ids = new Map<number, string>();
    for (let i = 0; i < 100; i++) ids.set(i, `r${i}`);
    model.setRowIdResolver((ri) => ids.get(ri) ?? null);
    return model;
  }

  it('a reply that lacks the CURRENT focused id leaves focus alone (symptom 1)', () => {
    const model = makeModel();
    model.setFocusAndCollapseRanges(5, 'a');   // request captured here: allIds = ['r5']
    model.setFocusAndCollapseRanges(9, 'a');   // focus moves on while the reply is in flight
    // Stale reply: resolves ONLY r5. Pre-fix: map.get('r9') === undefined
    // → focus nulled. Post-fix: r9 absent from the map → leave focus at 9.
    model.rebuildIndices(new Map([['r5', 5]]));
    expect(model.state.focusedRowIndex).toBe(9);
  });

  it('still follows its OWN id to the new index (the two-focus-rings fix)', () => {
    const model = makeModel();
    model.setFocusAndCollapseRanges(5, 'a');
    model.rebuildIndices(new Map([['r5', 42]]));
    expect(model.state.focusedRowIndex).toBe(42);
    // Collapsed range follows.
    expect(model.getRanges()).toEqual([{ rowStart: 42, rowEnd: 42, colIds: ['a'] }]);
  });

  it('a genuinely removed row (-1 in the reply) still clears focus', () => {
    const model = makeModel();
    model.setFocusAndCollapseRanges(5, 'a');
    model.rebuildIndices(new Map([['r5', -1]]));
    expect(model.state.focusedRowIndex).toBeNull();
  });
});

// ─── Fix A: no synthetic ids in persistent focus (wired CGrid) ───────────────

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
  let rafId = 0;
  (globalThis as any).requestAnimationFrame = (_cb: () => void) => { rafId += 1; return rafId; };
  (globalThis as any).cancelAnimationFrame = () => {};
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    const perCanvas = new WeakMap<object, any>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) { ctx = { ...fakeCtx, canvas: this }; perCanvas.set(this, ctx); }
      return ctx;
    };
  })() as any;
});

function buildWiredGrid() {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
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
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `row-id-${i}`, v: i }));
  const grid = new CGrid(container, {
    columnDefs: [{ field: 'id' }, { field: 'v', type: 'number' }],
    getRowId: (r) => r.id,
    rowData: rows,
  } as CGridOptions<{ id: string; v: number }>);
  const g = grid as any;
  Object.defineProperty(g.scroller, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(g.scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(g.root, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(g.root, 'clientHeight', { value: 600, configurable: true });
  g.cgridCanvas.resize();
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, g, restore };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('CGrid — persistent focus id never records the synthetic fallback', () => {
  it('focus on a loaded row records the REAL row id', async () => {
    const { grid, g, restore } = buildWiredGrid();
    await tick();
    g.selection.setFocusAndCollapseRanges(3, 'id');
    expect(g.selection.getPersistentFocusedRowId()).toBe('row-id-3');
    grid.destroy();
    restore();
  });

  it('focus on a row OUTSIDE the loaded chunk records null, not row-<n> (symptom 2 root)', async () => {
    const { grid, g, restore } = buildWiredGrid();
    await tick();
    // 1000 rows at ~30px in a 600px body — row 900 is far outside the
    // fetched window, so `stringRowIdAt(900)` is null and `rowIdAt(900)`
    // would fall back to the synthetic 'row-900'.
    expect(g.stringRowIdAt(900)).toBeNull();
    g.selection.setFocusAndCollapseRanges(900, 'id');
    // Pre-fix: 'row-900' — an id the worker resolves to -1, which nulls
    // the focus on the next modelUpdated rebuild and teleports the next
    // arrow press to row 0.
    expect(g.selection.getPersistentFocusedRowId()).toBeNull();
    grid.destroy();
    restore();
  });

  it('a modelUpdated-style rebuild leaves an unloaded-row focus index alone', async () => {
    const { grid, g, restore } = buildWiredGrid();
    await tick();
    g.selection.setFocusAndCollapseRanges(900, 'id');
    expect(g.selection.state.focusedRowIndex).toBe(900);
    // The exact call the modelUpdated handler makes.
    g.rebuildSelectionFromPersistentIds();
    await tick();
    // Pre-fix: focus null (synthetic id resolved to -1) → next ArrowUp
    // teleports to row 0. Post-fix: focus survives at 900.
    expect(g.selection.state.focusedRowIndex).toBe(900);
    grid.destroy();
    restore();
  });
});
