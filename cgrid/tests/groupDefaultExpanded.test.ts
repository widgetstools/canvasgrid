import { describe, it, expect, beforeAll, vi } from 'vitest';
import { CGrid } from '../src/cgrid';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';
import { createWorkerHost } from '../src/worker/worker';
import type { CGridOptions } from '../src/types';

/**
 * Cycle 15 / Task 9 — `groupDefaultExpanded` + `groupDefaultExpandedKeys`.
 *
 * Two-part suite:
 *
 * Pass-level (cases 1-3) — `GroupPass.computeDefaultExpandedKeys`
 * resolves the option into either the all-expanded sentinel (`null`)
 * or an explicit `Set<string>` against the supplied tree roots. The
 * function is pure given the roots + the installed defaults, so the
 * unit tests can hit it without spinning a worker.
 *
 * Wired-grid (cases 4-7) — the option propagates through the
 * worker-init handshake, gets re-seeded on every `setGroupModel`
 * reply, and lands on the main-thread mirror so
 * `getExpandedKeys()` returns the correct snapshot. These cases
 * cover the full round-trip the slicer + paint path observe.
 *
 * The 3-level fixture is deliberately tiny (3 desks × 2 regions × 2
 * types — 12 leaf nodes max) so the tree shape is easy to reason
 * about in the assertions; the larger group-pass tests already cover
 * scale (see `groupPass.perf.test.ts`).
 */

// happy-dom doesn't include Path2D or a canvas 2D context. The grid's
// renderer touches both during the initial layout pass; mirror the
// stub the other group/cgrid tests install.
beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class { constructor(_d?: string) {} };
  }
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: Record<string, unknown> = {
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
    return () => fakeCtx as CanvasRenderingContext2D;
  })() as typeof HTMLCanvasElement.prototype.getContext;
});

// ----- Pass-level fixtures -----

const PASS_COLS: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'type',   field: 'type',   type: 'text' },
];

function passFixture(): { pass: GroupPass; ids: string[] } {
  const store = new RowStore('id');
  store.setAll([
    { id: '1', desk: 'APAC', region: 'Rates',  type: 'IRS'  },
    { id: '2', desk: 'APAC', region: 'Rates',  type: 'Swap' },
    { id: '3', desk: 'APAC', region: 'Credit', type: 'CDS'  },
    { id: '4', desk: 'EMEA', region: 'Rates',  type: 'IRS'  },
    { id: '5', desk: 'EMEA', region: 'Credit', type: 'CDS'  },
  ]);
  const pass = new GroupPass(store, PASS_COLS);
  pass.setModel({ rowGroupCols: ['desk', 'region', 'type'] });
  return { pass, ids: ['1', '2', '3', '4', '5'] };
}

// ----- Wired-grid harness -----

interface Row { id: string; desk: string; region: string; pri: number }

const WIRED_ROWS: Row[] = [
  { id: 'a', desk: 'APAC', region: 'Rates',  pri: 10 },
  { id: 'b', desk: 'APAC', region: 'Rates',  pri: 20 },
  { id: 'c', desk: 'APAC', region: 'Credit', pri: 30 },
  { id: 'd', desk: 'EMEA', region: 'Rates',  pri: 40 },
  { id: 'e', desk: 'EMEA', region: 'Credit', pri: 50 },
  { id: 'f', desk: 'AMER', region: 'Rates',  pri: 60 },
];

const WIRED_COLS = [
  { field: 'id' },
  { field: 'desk' },
  { field: 'region' },
  { field: 'pri', type: 'number' as const },
];

function buildWiredGrid(
  rows: Row[],
  cols: Array<Record<string, unknown>>,
  extraOptions: Partial<CGridOptions<Row>> = {},
) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const prevWorker = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = class {
    listeners: Array<(e: { data: unknown }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: unknown) { this.host.handle(msg as Parameters<typeof this.host.handle>[0]); }
    addEventListener(_: string, cb: (e: { data: unknown }) => void) { this.listeners.push(cb); }
    terminate() {}
  };
  const grid = new CGrid<Row>(container, {
    columnDefs: cols as Parameters<typeof CGrid<Row>>[1]['columnDefs'],
    getRowId: (r) => r.id,
    rowData: rows,
    ...extraOptions,
  });
  const restore = () => {
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
    container.remove();
  };
  return { grid, restore };
}

// ----- Pass-level cases -----

describe('GroupPass.computeDefaultExpandedKeys', () => {
  // 1 — Option absent / `'all'` → null sentinel. The worker keeps the
  // cheap all-expanded path (no Set allocation); main treats `null`
  // as "every group expanded" via `knownGroupKeys` materialisation in
  // `getExpandedKeys()`.
  it('1. defaults to all-expanded sentinel (null) when no option is installed', () => {
    const { pass, ids } = passFixture();
    const out = pass.apply(ids);
    expect(pass.computeDefaultExpandedKeys(out.roots)).toBeNull();
  });

  // 2 — `groupDefaultExpanded: 0` walks the tree and includes only
  // depth-0 (top-level) groups. Per the plan spec: "number = expand
  // depth ≤ N". So N=0 expands ONLY the top-level groups; their
  // immediate child groups (depth 1) render as collapsed rows.
  it('2. groupDefaultExpanded: 0 returns exactly the top-level group keys', () => {
    const { pass, ids } = passFixture();
    pass.setDefaultExpansion({ expanded: 0 });
    const out = pass.apply(ids);
    const set = pass.computeDefaultExpandedKeys(out.roots);
    expect(set).not.toBeNull();
    // 2 top-level desks (APAC, EMEA) — sorted deterministically by
    // composite key by GroupPass; the Set is unordered but contents
    // are what we assert.
    expect(set!.size).toBe(2);
    expect(set!.has('desk:APAC')).toBe(true);
    expect(set!.has('desk:EMEA')).toBe(true);
    // Depth-1 region groups must NOT be in the set.
    expect(set!.has('desk:APAC::region:Rates')).toBe(false);
    expect(set!.has('desk:EMEA::region:Credit')).toBe(false);
  });

  // 3 — `groupDefaultExpanded: 1` expands depth 0 AND 1; depth 2
  // (leaf type buckets) stays collapsed. Proves the depth ≤ N
  // boundary inclusively.
  it('3. groupDefaultExpanded: 1 includes depth 0 + 1 groups but not depth 2', () => {
    const { pass, ids } = passFixture();
    pass.setDefaultExpansion({ expanded: 1 });
    const out = pass.apply(ids);
    const set = pass.computeDefaultExpandedKeys(out.roots);
    expect(set).not.toBeNull();
    // 2 desks + (APAC: 2 regions, EMEA: 2 regions) = 6 keys.
    expect(set!.size).toBe(6);
    expect(set!.has('desk:APAC')).toBe(true);
    expect(set!.has('desk:APAC::region:Rates')).toBe(true);
    expect(set!.has('desk:EMEA::region:Credit')).toBe(true);
    // Depth-2 type leaves must NOT be in the set.
    expect(set!.has('desk:APAC::region:Rates::type:IRS')).toBe(false);
    expect(set!.has('desk:EMEA::region:Credit::type:CDS')).toBe(false);
  });
});

// ----- Wired-grid cases -----

describe('CGrid — groupDefaultExpanded option', () => {
  // 4 — Option absent → every group expanded after the first
  // `setGroupModel`. Regression guard that the Task 9 reply field
  // doesn't accidentally collapse the existing pre-Task-9 behaviour
  // when no option is supplied.
  it('4. (no option) keeps the default-all-expanded behaviour', async () => {
    const { grid, restore } = buildWiredGrid(WIRED_ROWS, WIRED_COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await new Promise((r) => setTimeout(r, 50));
    const keys = grid.getExpandedKeys();
    expect(keys.size).toBe(3); // APAC + EMEA + AMER
    expect(keys.has('desk:APAC')).toBe(true);
    expect(keys.has('desk:EMEA')).toBe(true);
    expect(keys.has('desk:AMER')).toBe(true);
    grid.destroy();
    restore();
  });

  // 5 — `groupDefaultExpanded: 0` with a two-level grouping. After
  // the first `setGroupModel`, only the 3 top-level desk groups
  // appear in `getExpandedKeys()` — the depth-1 region groups under
  // each desk start collapsed. End-to-end proof that the option
  // propagates through the worker init handshake AND the reply
  // re-seeds the main mirror.
  it('5. groupDefaultExpanded: 0 exposes only top-level groups via getExpandedKeys', async () => {
    const { grid, restore } = buildWiredGrid(WIRED_ROWS, WIRED_COLS, {
      groupDefaultExpanded: 0,
    });
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk', 'region'] });
    await new Promise((r) => setTimeout(r, 50));
    const keys = grid.getExpandedKeys();
    // 3 desks expanded at depth 0; region groups (depth 1) collapsed.
    expect(keys.size).toBe(3);
    expect(keys.has('desk:APAC')).toBe(true);
    expect(keys.has('desk:EMEA')).toBe(true);
    expect(keys.has('desk:AMER')).toBe(true);
    expect(keys.has('desk:APAC::region:Rates')).toBe(false);
    expect(keys.has('desk:APAC::region:Credit')).toBe(false);
    grid.destroy();
    restore();
  });

  // 6 — Negative `groupDefaultExpanded` means "collapse all".
  // `-1` is the canonical form (mirrors ag-grid's inverse). The
  // mirror should hold an explicit empty `Set` — non-null so the
  // slicer reads "no groups expanded" instead of the all-expanded
  // sentinel.
  it('6. groupDefaultExpanded: -1 collapses every group at first setGroupModel', async () => {
    const { grid, restore } = buildWiredGrid(WIRED_ROWS, WIRED_COLS, {
      groupDefaultExpanded: -1,
    });
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk', 'region'] });
    await new Promise((r) => setTimeout(r, 50));
    expect(grid.getExpandedKeys().size).toBe(0);
    grid.destroy();
    restore();
  });

  // 7 — `groupDefaultExpandedKeys` overrides the depth rule.
  // Supplies `['desk:APAC']` AND `groupDefaultExpanded: 1` (which
  // would otherwise expand depth 0 + 1); the explicit list MUST win
  // and the resulting mirror holds only that one key. Stale keys are
  // also tested implicitly — `desk:FAKE` doesn't exist in the
  // current tree and silently falls out (mirror just stores the
  // explicit list verbatim; the slicer ignores unmatched keys).
  it('7. groupDefaultExpandedKeys overrides groupDefaultExpanded (explicit list wins)', async () => {
    const { grid, restore } = buildWiredGrid(WIRED_ROWS, WIRED_COLS, {
      groupDefaultExpanded: 1, // would expand depth 0 + 1
      groupDefaultExpandedKeys: ['desk:APAC', 'desk:FAKE'],
    });
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk', 'region'] });
    await new Promise((r) => setTimeout(r, 50));
    const keys = grid.getExpandedKeys();
    // Explicit list wins; the stale `desk:FAKE` rides along
    // unchanged (the slicer's `expandedKeys.has(node.key)` lookup
    // simply doesn't match anything for it).
    expect(keys.size).toBe(2);
    expect(keys.has('desk:APAC')).toBe(true);
    expect(keys.has('desk:FAKE')).toBe(true);
    expect(keys.has('desk:EMEA')).toBe(false);
    expect(keys.has('desk:APAC::region:Rates')).toBe(false);
    grid.destroy();
    restore();
  });
});
