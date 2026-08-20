/**
 * Kernel bugfix follow-up (post-Cycle 21f) — `rowIdAt()` stub vs. real
 * rowIds.
 *
 * `rowIdAt(rowIndex)` used to be a permanent stub returning
 * `` `row-${rowIndex}` ``, and every pointer/keyboard event builder
 * (cellClicked, cellDoubleClicked, cellKeyDown/Press, cellMouseOver/Out,
 * rowMouseOver/Out) fed that stub into its event payload. Meanwhile the
 * paint pipeline used `stringRowIdAt`, the REAL string rowId from the
 * chunk's `stringRowIds` mirror — and @wellsfargo-starui/velocity-grid-ext/renderers keys its hit
 * regions on that real id. So a click on a row with real id 'r1' would
 * resolve to `rowId: 'row-0'` in the `cellClicked` payload — a value no
 * hit region was ever registered under — breaking onAction/onOpen style
 * callbacks entirely.
 *
 * This spec pins `cellClicked`'s payload to the real string id, using the
 * `checkboxSelectionColumn.test.ts` fixture pattern (fake Worker + fake
 * canvas 2D context) plus a directly-injected `ViewportChunk` (matching
 * the shape asserted against in `chunkStringRowIds.test.ts`) so the test
 * doesn't need to round-trip through the real worker.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ViewportChunk } from '../src/worker/protocol';

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

function fixtureChunk(): ViewportChunk {
  return {
    rowStart: 0,
    rowCount: 2,
    rowIds: new Uint32Array([1, 2]),
    stringRowIds: ['r1', 'r2'],
    rowKinds: new Uint8Array([0, 0]),
    groupDepth: new Uint8Array([0, 0]),
    numericCols: {},
    textCols: {},
    groupValue: ['', ''],
    groupChildCount: new Uint32Array([0, 0]),
    isExpanded: new Uint8Array([1, 1]),
    groupKey: ['', ''],
  };
}

async function setupGrid() {
  const { VelocityGrid } = await import('../src/velocityGrid');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new VelocityGrid(host, {
    getRowId: (r: any) => r.id,
    columnDefs: [{ colId: 'name', field: 'name', cellDataType: 'text' }],
  } as any);
  // Inject a loaded viewport chunk directly — bypasses the fake worker's
  // round-trip so the test doesn't depend on postMessage plumbing, and
  // matches the shape `stringRowIdAt`/paint already consume in production.
  (grid as any).chunk = fixtureChunk();
  return grid;
}

function fireClick(grid: any, rowIndex: number, colId: string) {
  const head = grid.featureChain.head;
  head.handleClick({
    grid: grid.featureChain.grid,
    hit: { kind: 'cell', rowIndex, colId },
    point: { x: 0, y: 0 },
    raw: new MouseEvent('click', { button: 0 }),
  });
}

describe('cellClicked rowId correlation with the paint path (rowIdAt fix)', () => {
  it('carries the REAL string rowId — matching stringRowIdAt / hit-region identity — not the synthetic row-${index} stub', async () => {
    const grid = await setupGrid();
    const events: any[] = [];
    grid.on('cellClicked', (e: any) => events.push(e));

    fireClick(grid, 0, 'name');

    expect(events).toHaveLength(1);
    expect(events[0].rowId).toBe('r1');
    expect(events[0].rowId).not.toBe('row-0');
    grid.destroy();
  });

  it('resolves the second visible row to its own real id, not a shared/reindexed synthetic one', async () => {
    const grid = await setupGrid();
    const events: any[] = [];
    grid.on('cellClicked', (e: any) => events.push(e));

    fireClick(grid, 1, 'name');

    expect(events).toHaveLength(1);
    expect(events[0].rowId).toBe('r2');
    grid.destroy();
  });

  it('falls back to the synthetic row-${index} id for a row outside the loaded chunk window (preserves old contract there)', async () => {
    const grid = await setupGrid();
    const events: any[] = [];
    grid.on('cellClicked', (e: any) => events.push(e));

    // Row 5 is outside the 2-row fixture chunk (rowStart 0, rowCount 2) —
    // stringRowIdAt returns null there, so rowIdAt must still synthesize
    // an id rather than silently dropping the event.
    fireClick(grid, 5, 'name');

    expect(events).toHaveLength(1);
    expect(events[0].rowId).toBe('row-5');
    grid.destroy();
  });
});
