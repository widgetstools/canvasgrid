import { describe, it, expect, vi, beforeAll } from 'vitest';
import { GroupExpandFeature } from '../src/interaction/features/groupExpand';
import type { CGridEventCtx, CGridLike } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';

/**
 * Cycle 15 / Task 7 — group expand / collapse interaction + API.
 *
 * Two-part suite:
 *
 * Feature half (cases 1-8) — `GroupExpandFeature` chain semantics
 * against a mock `CGridLike`. The feature only ever fans out through
 * two hooks: `hitTestGroupChevron(x, y)` resolves a canvas-local point
 * to a group key, `toggleGroupExpanded(key)` mutates the expansion
 * state. The feature decides:
 *   - which button (left only) toggles
 *   - which event phase (mousedown, plus consume the trailing click)
 *     mutates state
 *   - how the hover cursor reflects the hit zone
 *
 * API half (cases 9-15) — `expandAll`, `collapseAll`, `setExpanded`,
 * `getExpandedKeys` against a fully-wired grid. Each test drives the
 * worker via the same `buildWiredGrid` harness `cgrid.integration.test.ts`
 * uses so the round-trip semantics (group keys ride back; mirror
 * materialises against them; events fire with the right `source`) are
 * exercised end-to-end.
 */

// happy-dom doesn't include Path2D or a canvas 2D context. The grid's
// renderer touches both during the initial layout pass, so we install
// the same stubs the integration suite uses.
beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
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

// ----- Feature-level harness -----

interface MockGrid {
  hitTestGroupChevron: (x: number, y: number) => { groupKey: string } | null;
  toggleGroupExpanded: ReturnType<typeof vi.fn>;
  /** Cycle 15 / Task 8 — tri-state checkbox stubs. Default null
   *  returns so existing Task 7 cases (chevron-only) keep their
   *  behaviour; cases that want checkbox interactions override. */
  hitTestGroupCheckbox?: (x: number, y: number) => { groupKey: string; state: 'none' | 'partial' | 'all' } | null;
  toggleGroupChildrenSelected?: ReturnType<typeof vi.fn>;
}

function makeCtx(
  grid: MockGrid,
  point: { x: number; y: number },
  raw?: MouseEvent | KeyboardEvent | WheelEvent,
): CGridEventCtx {
  const hit: Hit = { kind: 'empty' };
  // Cycle 15 / Task 8 — splice default `hitTestGroupCheckbox` /
  // `toggleGroupChildrenSelected` stubs onto Task-7-era mocks that
  // pre-date the checkbox hit-lane. Tests can still override either
  // method by setting it explicitly on `grid`.
  const augmented: MockGrid = {
    hitTestGroupCheckbox: () => null,
    toggleGroupChildrenSelected: vi.fn(),
    ...grid,
  };
  return {
    hit,
    point,
    grid: augmented as unknown as CGridLike,
    raw: raw ?? new MouseEvent('mousedown', { button: 0 }),
  };
}

// ----- API-level harness (wired worker) -----

function buildWiredGrid<T extends { id: string }>(rows: T[], cols: Array<Record<string, unknown>>) {
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
  const grid = new CGrid<T>(container, {
    columnDefs: cols as Parameters<typeof CGrid<T>>[1]['columnDefs'],
    getRowId: (r) => r.id,
    rowData: rows,
  });
  const restore = () => {
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
    container.remove();
  };
  return { grid, restore };
}

// ----- Feature-level cases -----

describe('GroupExpandFeature — chain semantics', () => {
  it('1. mousedown on a chevron toggles the group via grid.toggleGroupExpanded', () => {
    const grid: MockGrid = {
      hitTestGroupChevron: (x, y) => (x === 12 && y === 40 ? { groupKey: 'desk:APAC' } : null),
      toggleGroupExpanded: vi.fn(),
    };
    const f = new GroupExpandFeature();
    f.handleMouseDown(makeCtx(grid, { x: 12, y: 40 }));
    expect(grid.toggleGroupExpanded).toHaveBeenCalledWith('desk:APAC');
  });

  it('2. mousedown outside the chevron hit zone falls through to super (toggleGroupExpanded not called)', () => {
    const grid: MockGrid = {
      hitTestGroupChevron: () => null,
      toggleGroupExpanded: vi.fn(),
    };
    const f = new GroupExpandFeature();
    const next = { handleMouseDown: vi.fn(), handleMouseUp: vi.fn(), handleMouseMove: vi.fn(),
      handleMouseDrag: vi.fn(), handleClick: vi.fn(), handleDoubleClick: vi.fn(),
      handleContextMenu: vi.fn(), handleKeyDown: vi.fn(), handleWheel: vi.fn(), setCursor: vi.fn(),
      cursor: null as string | null, next: null, append: vi.fn() } as unknown as GroupExpandFeature;
    f.next = next;
    f.handleMouseDown(makeCtx(grid, { x: 100, y: 100 }));
    expect(grid.toggleGroupExpanded).not.toHaveBeenCalled();
    expect((next.handleMouseDown as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('3. click on a chevron is consumed (downstream does not see the trailing click)', () => {
    const grid: MockGrid = {
      hitTestGroupChevron: () => ({ groupKey: 'desk:APAC' }),
      toggleGroupExpanded: vi.fn(),
    };
    const f = new GroupExpandFeature();
    const next = { handleClick: vi.fn(), handleMouseDown: vi.fn() } as unknown as GroupExpandFeature;
    f.next = next;
    f.handleClick(makeCtx(grid, { x: 12, y: 40 }));
    expect((next.handleClick as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('4. click outside the chevron forwards to super so downstream click handlers still run', () => {
    const grid: MockGrid = {
      hitTestGroupChevron: () => null,
      toggleGroupExpanded: vi.fn(),
    };
    const f = new GroupExpandFeature();
    const next = { handleClick: vi.fn() } as unknown as GroupExpandFeature;
    f.next = next;
    f.handleClick(makeCtx(grid, { x: 200, y: 80 }));
    expect((next.handleClick as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('5. mousemove over the chevron sets cursor: pointer on the feature instance', () => {
    const grid: MockGrid = {
      hitTestGroupChevron: () => ({ groupKey: 'desk:APAC' }),
      toggleGroupExpanded: vi.fn(),
    };
    const f = new GroupExpandFeature();
    f.handleMouseMove(makeCtx(grid, { x: 12, y: 40 }));
    expect(f.cursor).toBe('pointer');
  });

  it('6. mousemove outside the chevron clears any prior cursor (no leak)', () => {
    const grid: MockGrid = {
      hitTestGroupChevron: (x) => (x < 50 ? { groupKey: 'desk:APAC' } : null),
      toggleGroupExpanded: vi.fn(),
    };
    const f = new GroupExpandFeature();
    f.handleMouseMove(makeCtx(grid, { x: 10, y: 40 })); // sets pointer
    expect(f.cursor).toBe('pointer');
    f.handleMouseMove(makeCtx(grid, { x: 200, y: 40 })); // clears
    expect(f.cursor).toBeNull();
  });

  it('7. right-button mousedown on the chevron does NOT toggle (left-only gesture)', () => {
    const grid: MockGrid = {
      hitTestGroupChevron: () => ({ groupKey: 'desk:APAC' }),
      toggleGroupExpanded: vi.fn(),
    };
    const f = new GroupExpandFeature();
    const raw = new MouseEvent('mousedown', { button: 2 });
    f.handleMouseDown(makeCtx(grid, { x: 12, y: 40 }, raw));
    expect(grid.toggleGroupExpanded).not.toHaveBeenCalled();
  });

  it('8. middle-button mousedown on the chevron does NOT toggle', () => {
    const grid: MockGrid = {
      hitTestGroupChevron: () => ({ groupKey: 'desk:APAC' }),
      toggleGroupExpanded: vi.fn(),
    };
    const f = new GroupExpandFeature();
    const raw = new MouseEvent('mousedown', { button: 1 });
    f.handleMouseDown(makeCtx(grid, { x: 12, y: 40 }, raw));
    expect(grid.toggleGroupExpanded).not.toHaveBeenCalled();
  });

  // Cycle 15 / Task 8 — checkbox hit-lane cases.

  it('9. mousedown on the tri-state checkbox of a "none" group cascade-selects', () => {
    // Click on an empty checkbox completes (selects all
    // descendants). Mirrors Excel / ag-grid: 'none' → 'all' on first
    // click. The feature must route to toggleGroupChildrenSelected
    // with `selected: true` AND consume the event so no editor
    // opens.
    const toggle = vi.fn();
    const grid: MockGrid = {
      hitTestGroupChevron: () => null,
      toggleGroupExpanded: vi.fn(),
      hitTestGroupCheckbox: () => ({ groupKey: 'desk:APAC', state: 'none' }),
      toggleGroupChildrenSelected: toggle,
    };
    const f = new GroupExpandFeature();
    f.handleMouseDown(makeCtx(grid, { x: 40, y: 40 }));
    expect(toggle).toHaveBeenCalledWith('desk:APAC', true);
  });

  it('10. mousedown on the tri-state checkbox of a "partial" group COMPLETES (true, not false)', () => {
    // The crucial design rule from `cycle-15-grouping-design.md`
    // § Task 8: a mixed group "completes" on first click. The
    // alternative ('true → false on partial') would silently
    // destroy the user's existing selection — a quietly hostile UX
    // that the design pass explicitly rejected.
    const toggle = vi.fn();
    const grid: MockGrid = {
      hitTestGroupChevron: () => null,
      toggleGroupExpanded: vi.fn(),
      hitTestGroupCheckbox: () => ({ groupKey: 'desk:APAC', state: 'partial' }),
      toggleGroupChildrenSelected: toggle,
    };
    const f = new GroupExpandFeature();
    f.handleMouseDown(makeCtx(grid, { x: 40, y: 40 }));
    expect(toggle).toHaveBeenCalledWith('desk:APAC', true);
  });

  it('11. mousedown on the tri-state checkbox of an "all" group deselects (true → false)', () => {
    // The 'all → none' transition. Click empties the cascade.
    const toggle = vi.fn();
    const grid: MockGrid = {
      hitTestGroupChevron: () => null,
      toggleGroupExpanded: vi.fn(),
      hitTestGroupCheckbox: () => ({ groupKey: 'desk:APAC', state: 'all' }),
      toggleGroupChildrenSelected: toggle,
    };
    const f = new GroupExpandFeature();
    f.handleMouseDown(makeCtx(grid, { x: 40, y: 40 }));
    expect(toggle).toHaveBeenCalledWith('desk:APAC', false);
  });

  it('12. mousemove over the checkbox sets cursor: pointer', () => {
    // Mirrors the chevron's cursor affordance — Task 7's
    // "cursor is the affordance" decision extends to the checkbox
    // hit lane. No bg tint, no color bump; cursor alone signals
    // interactivity.
    const grid: MockGrid = {
      hitTestGroupChevron: () => null,
      toggleGroupExpanded: vi.fn(),
      hitTestGroupCheckbox: () => ({ groupKey: 'desk:APAC', state: 'none' }),
      toggleGroupChildrenSelected: vi.fn(),
    };
    const f = new GroupExpandFeature();
    f.handleMouseMove(makeCtx(grid, { x: 40, y: 40 }));
    expect(f.cursor).toBe('pointer');
  });

  it('13. chevron hit takes precedence over checkbox hit (both reported in the same gesture)', () => {
    // Defensive case — the two hit zones are designed not to overlap
    // (chevron is strictly left of the checkbox), but if a future
    // refactor lets them overlap the chevron MUST win. Otherwise
    // a click on the chevron would silently cascade-select instead
    // of toggling expand state.
    const toggleExpand = vi.fn();
    const toggleSelect = vi.fn();
    const grid: MockGrid = {
      hitTestGroupChevron: () => ({ groupKey: 'desk:APAC' }),
      toggleGroupExpanded: toggleExpand,
      hitTestGroupCheckbox: () => ({ groupKey: 'desk:APAC', state: 'none' }),
      toggleGroupChildrenSelected: toggleSelect,
    };
    const f = new GroupExpandFeature();
    f.handleMouseDown(makeCtx(grid, { x: 12, y: 40 }));
    expect(toggleExpand).toHaveBeenCalledWith('desk:APAC');
    expect(toggleSelect).not.toHaveBeenCalled();
  });
});

// ----- API-level cases -----

interface Row { id: string; desk: string; pri: number }
const SAMPLE_ROWS: Row[] = [
  { id: 'a', desk: 'APAC', pri: 10 },
  { id: 'b', desk: 'APAC', pri: 20 },
  { id: 'c', desk: 'EMEA', pri: 30 },
  { id: 'd', desk: 'EMEA', pri: 40 },
  { id: 'e', desk: 'AMER', pri: 50 },
];
const SAMPLE_COLS = [
  { field: 'id' },
  { field: 'desk' },
  { field: 'pri', type: 'number' },
];

describe('CGrid — expand / collapse API', () => {
  it('9. setGroupModel resolves the worker round-trip and getExpandedKeys returns every known key', async () => {
    const { grid, restore } = buildWiredGrid<Row>(SAMPLE_ROWS, SAMPLE_COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await new Promise((r) => setTimeout(r, 50));
    const keys = grid.getExpandedKeys();
    // 3 desks → 3 top-level groups, all expanded by default.
    expect(keys.size).toBe(3);
    expect(keys.has('desk:APAC')).toBe(true);
    expect(keys.has('desk:EMEA')).toBe(true);
    expect(keys.has('desk:AMER')).toBe(true);
    grid.destroy();
    restore();
  });

  it('10. expandAll resets the mirror to the default-all sentinel and fires expandOrCollapseAll(true)', async () => {
    const { grid, restore } = buildWiredGrid<Row>(SAMPLE_ROWS, SAMPLE_COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await new Promise((r) => setTimeout(r, 50));
    // First collapse so the next expandAll has work to do.
    grid.collapseAll();
    await new Promise((r) => setTimeout(r, 50));
    expect(grid.getExpandedKeys().size).toBe(0);
    const events: Array<{ expanded: boolean }> = [];
    grid.on('expandOrCollapseAll', (e) => events.push({ expanded: e.expanded }));
    grid.expandAll();
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toEqual([{ expanded: true }]);
    expect(grid.getExpandedKeys().size).toBe(3);
    grid.destroy();
    restore();
  });

  it('11. collapseAll fires expandOrCollapseAll(false) and getExpandedKeys returns empty', async () => {
    const { grid, restore } = buildWiredGrid<Row>(SAMPLE_ROWS, SAMPLE_COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await new Promise((r) => setTimeout(r, 50));
    const events: Array<{ expanded: boolean }> = [];
    grid.on('expandOrCollapseAll', (e) => events.push({ expanded: e.expanded }));
    grid.collapseAll();
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toEqual([{ expanded: false }]);
    expect(grid.getExpandedKeys().size).toBe(0);
    grid.destroy();
    restore();
  });

  it('12. setExpanded(key, false) from the default-all sentinel materialises the explicit set', async () => {
    const { grid, restore } = buildWiredGrid<Row>(SAMPLE_ROWS, SAMPLE_COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await new Promise((r) => setTimeout(r, 50));
    grid.setExpanded('desk:APAC', false);
    await new Promise((r) => setTimeout(r, 50));
    const keys = grid.getExpandedKeys();
    expect(keys.has('desk:APAC')).toBe(false);
    expect(keys.has('desk:EMEA')).toBe(true);
    expect(keys.has('desk:AMER')).toBe(true);
    grid.destroy();
    restore();
  });

  it('13. setExpanded(key, true) while the mirror is default-all is a no-op (no event fires)', async () => {
    const { grid, restore } = buildWiredGrid<Row>(SAMPLE_ROWS, SAMPLE_COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await new Promise((r) => setTimeout(r, 50));
    const events: Array<{ key: string; expanded: boolean }> = [];
    grid.on('rowGroupOpened', (e) => events.push({ key: e.key, expanded: e.expanded }));
    grid.setExpanded('desk:APAC', true); // already expanded
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toHaveLength(0);
    grid.destroy();
    restore();
  });

  it('14. setExpanded fires rowGroupOpened with source: "api" on a state change', async () => {
    const { grid, restore } = buildWiredGrid<Row>(SAMPLE_ROWS, SAMPLE_COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await new Promise((r) => setTimeout(r, 50));
    const events: Array<{ key: string; expanded: boolean; source: 'ui' | 'api' }> = [];
    grid.on('rowGroupOpened', (e) =>
      events.push({ key: e.key, expanded: e.expanded, source: e.source }),
    );
    grid.setExpanded('desk:APAC', false);
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([
      { key: 'desk:APAC', expanded: false, source: 'api' },
    ]);
    grid.destroy();
    restore();
  });

  it('15. setExpanded is idempotent when the requested state matches the current state', async () => {
    const { grid, restore } = buildWiredGrid<Row>(SAMPLE_ROWS, SAMPLE_COLS);
    await new Promise((r) => setTimeout(r, 50));
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await new Promise((r) => setTimeout(r, 50));
    grid.setExpanded('desk:APAC', false);
    await new Promise((r) => setTimeout(r, 30));
    const events: Array<unknown> = [];
    grid.on('rowGroupOpened', (e) => events.push(e));
    // Already collapsed — calling again must not fire a second event.
    grid.setExpanded('desk:APAC', false);
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toHaveLength(0);
    grid.destroy();
    restore();
  });
});
