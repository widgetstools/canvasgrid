/**
 * D-F7 — `getColumnDefsSnapshot()` / `upsertColumnDefs()` are the supported
 * replacement for reaching into the private `columnDefsMap` (which
 * `@wellsfargo-starui/velocity-grid-ext`'s calculated-columns editor was
 * casting to). Gates the two properties the ext side depends on:
 *   1. the snapshot is DETACHED — mutating it (at any depth of plain
 *      object/array) cannot write through into the grid's live colDefs;
 *   2. `upsertColumnDefs` adds/replaces by `colId ?? field` and drives the
 *      same rebuild path as `updateGridOptions({ columnDefs })`.
 *
 * Mounts a real `VelocityGrid` against the fake Worker + canvas harness
 * (same `beforeAll` stub + `mount()` shape as
 * `tests/columnGroupMutationApi.integration.test.ts`).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
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

async function mount(defs?: any[]) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<any>(container, {
    columnDefs: defs ?? [
      { field: 'a', headerName: 'Alpha' },
      { field: 'b', headerName: 'Beta' },
    ],
    getRowId: (r: any) => r.a,
    theme: 'vg-theme-quartz',
  });
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  return grid;
}

describe('VelocityGrid.getColumnDefsSnapshot', () => {
  it('returns every resolved leaf (hidden included) in leaf order', async () => {
    const grid = await mount();
    grid.setColumnsVisible(['b'], false);
    const snap = grid.getColumnDefsSnapshot();
    expect(snap.map((d) => d.colId)).toEqual(['a', 'b']);
    // RESOLVED, not authored — defaultColDef-tier fields are materialised.
    expect(snap[0]!.headerName).toBe('Alpha');
    expect(typeof snap[0]!.minWidth).toBe('number');
    grid.destroy();
  });

  it('carries runtime column state (width / hide) that lives only on the resolved copy', async () => {
    const grid = await mount();
    grid.setColumnWidths([{ key: 'a', newWidth: 321 }]);
    grid.setColumnsVisible(['a'], false);
    const a = grid.getColumnDefsSnapshot().find((d) => d.colId === 'a')!;
    expect(a.width).toBe(321);
    expect(a.hide).toBe(true);
    grid.destroy();
  });

  it('is DETACHED — mutating the snapshot cannot write into the grid', async () => {
    const grid = await mount([
      { field: 'a', headerName: 'Alpha', cellStyle: { color: 'red' } },
      { field: 'b', headerName: 'Beta' },
    ]);
    const snap = grid.getColumnDefsSnapshot();
    const a = snap.find((d) => d.colId === 'a')! as Record<string, any>;

    // Top level.
    a.headerName = 'MUTATED';
    // Nested plain object — the case a shallow `{...d}` copy would leak.
    a.cellStyle.color = 'lime';

    expect(grid.getColumnHeaderName('a')).toBe('Alpha');
    const fresh = grid.getColumnDefsSnapshot().find((d) => d.colId === 'a')! as Record<string, any>;
    expect(fresh.headerName).toBe('Alpha');
    expect(fresh.cellStyle.color).toBe('red');
    // Two calls never hand out the same object graph either.
    expect(fresh).not.toBe(a);
    expect(fresh.cellStyle).not.toBe(a.cellStyle);
    grid.destroy();
  });

  it('shares function-valued slots by reference (behaviour is not cloned)', async () => {
    const valueGetter = (p: any) => p.data?.a;
    const grid = await mount([{ field: 'a', valueGetter }, { field: 'b' }]);
    const a = grid.getColumnDefsSnapshot().find((d) => d.colId === 'a')!;
    expect(a.valueGetter).toBe(valueGetter);
    grid.destroy();
  });
});

describe('VelocityGrid.upsertColumnDefs', () => {
  it('adds a brand-new column and rebuilds the tree', async () => {
    const grid = await mount();
    const evs: string[] = [];
    grid.addEventListener('columnDefsChanged', () => evs.push('c'));

    grid.upsertColumnDefs([{ colId: 'calc1', field: 'calc1', headerName: 'Calc One' }]);

    expect(grid.getColumnDefsSnapshot().map((d) => d.colId)).toEqual(['a', 'b', 'calc1']);
    expect(grid.getColumnHeaderName('calc1')).toBe('Calc One');
    expect(evs.length).toBeGreaterThan(0);
    grid.destroy();
  });

  it('replaces an existing column by colId and appends it at the end', async () => {
    const grid = await mount();
    grid.upsertColumnDefs([{ colId: 'a', field: 'a', headerName: 'Alpha II' }]);
    const snap = grid.getColumnDefsSnapshot();
    expect(snap.map((d) => d.colId)).toEqual(['b', 'a']);
    expect(grid.getColumnHeaderName('a')).toBe('Alpha II');
    grid.destroy();
  });

  it('matches an existing def by `field` too, so an alias never duplicates', async () => {
    const grid = await mount();
    grid.upsertColumnDefs([{ field: 'b', headerName: 'Beta II' }]);
    const snap = grid.getColumnDefsSnapshot();
    expect(snap.filter((d) => d.field === 'b')).toHaveLength(1);
    expect(grid.getColumnHeaderName('b')).toBe('Beta II');
    grid.destroy();
  });

  it('is a no-op for an empty def list', async () => {
    const grid = await mount();
    const evs: string[] = [];
    grid.addEventListener('columnDefsChanged', () => evs.push('c'));
    grid.upsertColumnDefs([]);
    expect(evs).toEqual([]);
    expect(grid.getColumnDefsSnapshot().map((d) => d.colId)).toEqual(['a', 'b']);
    grid.destroy();
  });

  it('reaches the same rebuild path as updateGridOptions({ columnDefs })', async () => {
    const viaUpsert = await mount();
    viaUpsert.upsertColumnDefs([{ colId: 'calc1', field: 'calc1', headerName: 'Calc One' }]);

    const viaOptions = await mount();
    const next = viaOptions.getColumnDefsSnapshot();
    next.push({ colId: 'calc1', field: 'calc1', headerName: 'Calc One' });
    viaOptions.updateGridOptions({ columnDefs: next });

    expect(viaUpsert.getColumnDefsSnapshot().map((d) => d.colId))
      .toEqual(viaOptions.getColumnDefsSnapshot().map((d) => d.colId));
    expect(viaUpsert.getColumnState().map((s) => s.colId))
      .toEqual(viaOptions.getColumnState().map((s) => s.colId));
    viaUpsert.destroy();
    viaOptions.destroy();
  });

  // `makeApi()` ends in `... as VelocityGridApi<TRow>`, so TypeScript cannot
  // gate coverage of the interface — a method declared on `VelocityGridApi`
  // but never wired into the closure compiles fine and is `undefined` at
  // runtime. Assert the wiring explicitly instead.
  it('is reachable through the public VelocityGridApi surface', async () => {
    const grid = await mount();
    const api = (grid as any).makeApi();
    expect(typeof api.getColumnDefsSnapshot).toBe('function');
    expect(typeof api.upsertColumnDefs).toBe('function');
    api.upsertColumnDefs([{ colId: 'calc1', field: 'calc1', headerName: 'Calc One' }]);
    expect(api.getColumnDefsSnapshot().map((d) => d.colId)).toEqual(['a', 'b', 'calc1']);
    grid.destroy();
  });
});
