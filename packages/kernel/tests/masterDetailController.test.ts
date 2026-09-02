import { describe, it, expect, vi } from 'vitest';
import {
  MasterDetailController,
  DEFAULT_DETAIL_ROW_HEIGHT,
  type DetailGridHandle,
  type MasterDetailOptions,
} from '../src/core/masterDetail';

/**
 * The master/detail controller on its own — expansion state, the pane
 * lifecycle, `keepDetailRows`, `template`, `refreshStrategy` and the
 * auto-height estimate.
 *
 * Tested against fake deps rather than through a mounted grid because these
 * are the behaviours ag-grid documents in prose and no amount of jsdom layout
 * makes them clearer: whether a re-expand hands back the SAME grid, whether a
 * superseded async load can overwrite a newer one, where a `template` puts
 * the grid.
 */

interface Row { id: string; name: string; calls: number[] }

function harness(opts: Partial<MasterDetailOptions<Row>> = {}, rows?: Row[]) {
  const data: Row[] = rows ?? [
    { id: 'a', name: 'A', calls: [1, 2, 3] },
    { id: 'b', name: 'B', calls: [] },
    { id: 'c', name: 'C', calls: [4] },
  ];
  const byId = new Map(data.map((r) => [r.id, r]));
  const container = document.createElement('div');
  document.body.appendChild(container);

  const created: Array<{ host: HTMLElement; options: Record<string, unknown>; handle: DetailGridHandle }> = [];
  const destroyed: string[] = [];
  let options: MasterDetailOptions<Row> = { masterDetail: true, ...opts };

  const controller = new MasterDetailController<Row>({
    container,
    getOptions: () => options,
    getRowData: (id) => byId.get(id),
    createDetailGrid: (host, gridOptions) => {
      let rowCount = 0;
      const handle: DetailGridHandle = {
        api: { tag: `api-${created.length}` },
        setRowData: (r) => { rowCount = r.length; },
        rowCount: () => rowCount,
        metrics: () => ({ rowHeight: 25, headerHeight: 30 }),
        destroy: () => { destroyed.push(host.getAttribute('data-owner') ?? '?'); },
      };
      created.push({ host, options: gridOptions, handle });
      return handle;
    },
    onExpandedChanged: vi.fn(),
    onDetailHeightChanged: vi.fn(),
  });

  /** Pretend every expanded row is on screen this frame. */
  const paint = (): void => {
    controller.syncBands(
      controller.expandedRowIds().map((rowId) => ({
        rowId, top: 0, height: controller.detailHeight(rowId),
        left: 0, width: 800, clipTop: 0, clipBottom: 10_000,
      })),
    );
  };

  return {
    controller, container, created, destroyed, paint, byId,
    setOptions: (next: Partial<MasterDetailOptions<Row>>) => { options = { ...options, ...next }; },
    cleanup: () => { controller.destroy(); container.remove(); },
  };
}

describe('master / detail controller — expansion + isRowMaster', () => {
  it('vetoes a non-master row and keeps every other one expandable', () => {
    const h = harness({ isRowMaster: (r) => r.calls.length > 0 });
    expect(h.controller.isRowMaster('a')).toBe(true);
    expect(h.controller.isRowMaster('b')).toBe(false);
    h.controller.setExpanded('b', true);
    expect(h.controller.isExpanded('b')).toBe(false);
    h.controller.setExpanded('a', true);
    expect(h.controller.isExpanded('a')).toBe(true);
    h.cleanup();
  });

  it('treats a row whose data has not arrived as a master', () => {
    // Otherwise the caret would flicker in as the mirror caught up.
    const h = harness({ isRowMaster: () => false });
    expect(h.controller.isRowMaster('unknown-id')).toBe(true);
    h.cleanup();
  });

  it('is inert while masterDetail is off', () => {
    const h = harness({ masterDetail: false });
    h.controller.setExpanded('a', true);
    expect(h.controller.expandedRowIds()).toEqual([]);
    h.cleanup();
  });
});

describe('master / detail controller — isMasterOpenByDefault', () => {
  it('passes ag-grid\'s param shape and opens what it asks for', () => {
    const seen: unknown[] = [];
    const h = harness({
      isMasterOpenByDefault: (p) => { seen.push(p); return p.data.id === 'c'; },
    });
    expect(h.controller.applyOpenByDefault(['a', 'b', 'c'])).toBe(true);
    expect(h.controller.expandedRowIds()).toEqual(['c']);
    // AG's `IsMasterOpenByDefaultParams` is `{ rowNode, data, level }` — NOT
    // `node`, which is what `getDetailRowData` uses.
    expect(seen[0]).toMatchObject({
      rowNode: { id: 'a' },
      data: { id: 'a' },
      level: 0,
    });
    h.cleanup();
  });

  it('never opens a row isRowMaster vetoed', () => {
    const h = harness({
      isRowMaster: (r) => r.calls.length > 0,
      isMasterOpenByDefault: () => true,
    });
    h.controller.applyOpenByDefault(['a', 'b', 'c']);
    expect(h.controller.expandedRowIds().sort()).toEqual(['a', 'c']);
    h.cleanup();
  });
});

describe('master / detail controller — panes', () => {
  it('builds one grid per visible band and feeds it getDetailRowData', () => {
    const h = harness({
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [{ colId: 'x' }] },
        getDetailRowData: (p) => p.successCallback((p.data as Row).calls),
      },
    });
    h.controller.setExpanded('a', true);
    h.paint();
    expect(h.created).toHaveLength(1);
    expect(h.created[0]!.options.columnDefs).toEqual([{ colId: 'x' }]);
    expect(h.created[0]!.handle.rowCount()).toBe(3);
    // Registered under ag-grid's id format so `getDetailGridInfo` ports over.
    const info = h.controller.getDetailGridInfo('detail_a');
    expect(info?.api).toBe(h.created[0]!.handle.api);
    h.cleanup();
  });

  it('drops a superseded async load rather than letting it overwrite a newer one', () => {
    const pending: Array<(rows: unknown[]) => void> = [];
    const h = harness({
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [] },
        getDetailRowData: (p) => { pending.push(p.successCallback); },
      },
      keepDetailRows: false,
    });
    h.controller.setExpanded('a', true);
    h.paint();
    expect(pending).toHaveLength(1);
    const stale = pending[0]!;

    // Collapse destroys the pane; the in-flight callback must now be inert.
    h.controller.setExpanded('a', false);
    h.paint();
    expect(() => stale([1, 2, 3, 4, 5])).not.toThrow();

    h.controller.setExpanded('a', true);
    h.paint();
    const fresh = pending[1]!;
    fresh([9]);
    expect(h.created[1]!.handle.rowCount()).toBe(1);
    h.cleanup();
  });

  it('mounts into the template slot, accepting data-ref and legacy ref alike', () => {
    for (const attr of ['data-ref', 'ref']) {
      const h = harness({
        detailCellRendererParams: {
          detailGridOptions: { columnDefs: [] },
          template: `<div class="hdr">Calls</div><div ${attr}="eDetailGrid" class="slot"></div>`,
        },
      });
      h.controller.setExpanded('a', true);
      h.paint();
      const host = h.created[0]!.host;
      expect(host.classList.contains('slot')).toBe(true);
      expect(host.parentElement?.querySelector('.hdr')?.textContent).toBe('Calls');
      h.cleanup();
    }
  });

  it('falls back to filling the band when a template names no slot', () => {
    const h = harness({
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [] },
        template: '<div class="just-decoration"></div>',
      },
    });
    h.controller.setExpanded('a', true);
    h.paint();
    expect(h.created[0]!.host.classList.contains('vg-detail-row')).toBe(true);
    h.cleanup();
  });

  it('lets a custom detailCellRenderer own the band instead of a grid', () => {
    const h = harness({
      detailCellRenderer: ({ data }) => `<b class="mine">${data.name}</b>`,
    });
    h.controller.setExpanded('a', true);
    h.paint();
    // No embedded grid built, so nothing registers itself.
    expect(h.created).toHaveLength(0);
    expect(h.controller.getDetailGridInfo('detail_a')).toBeUndefined();
    expect(h.container.querySelector('.mine')?.textContent).toBe('A');
    h.cleanup();
  });
});

describe('master / detail controller — keepDetailRows', () => {
  it('hands the same grid back on re-expand, and a fresh one when off', () => {
    const params = {
      detailGridOptions: { columnDefs: [] },
      getDetailRowData: (p: { successCallback: (r: unknown[]) => void }) => p.successCallback([]),
    };
    const kept = harness({ keepDetailRows: true, detailCellRendererParams: params });
    kept.controller.setExpanded('a', true);
    kept.paint();
    const first = kept.controller.getDetailGridInfo('detail_a')?.api;
    kept.controller.setExpanded('a', false);
    kept.paint();
    kept.controller.setExpanded('a', true);
    kept.paint();
    expect(kept.controller.getDetailGridInfo('detail_a')?.api).toBe(first);
    expect(kept.created).toHaveLength(1);
    kept.cleanup();

    const dropped = harness({ keepDetailRows: false, detailCellRendererParams: params });
    dropped.controller.setExpanded('a', true);
    dropped.paint();
    dropped.controller.setExpanded('a', false);
    dropped.paint();
    dropped.controller.setExpanded('a', true);
    dropped.paint();
    expect(dropped.created).toHaveLength(2);
    dropped.cleanup();
  });

  it('evicts least-recently-shown past keepDetailRowsCount', () => {
    const h = harness({
      keepDetailRows: true,
      keepDetailRowsCount: 1,
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [] },
        getDetailRowData: (p) => p.successCallback([]),
      },
    });
    h.controller.setExpanded('a', true);
    h.controller.setExpanded('c', true);
    h.paint();
    h.controller.setExpanded('a', false);   // parks 'a'
    h.controller.setExpanded('c', false);   // parks 'c', evicting 'a'
    h.paint();
    expect(h.controller.getDetailGridInfo('detail_a')).toBeUndefined();
    expect(h.controller.getDetailGridInfo('detail_c')).toBeDefined();
    h.cleanup();
  });
});

describe('master / detail controller — heights', () => {
  it('defaults to 300, matching ag-grid', () => {
    const h = harness();
    expect(h.controller.detailHeight('a')).toBe(DEFAULT_DETAIL_ROW_HEIGHT);
    expect(DEFAULT_DETAIL_ROW_HEIGHT).toBe(300);
    h.cleanup();
  });

  it('honours detailRowHeight, and rejects a nonsense one', () => {
    expect(harness({ detailRowHeight: 180 }).controller.detailHeight('a')).toBe(180);
    expect(harness({ detailRowHeight: 0 }).controller.detailHeight('a')).toBe(300);
    expect(harness({ detailRowHeight: -5 }).controller.detailHeight('a')).toBe(300);
  });

  it('floors an auto height at 150px of ROWS, with the header on top', () => {
    // AG's floor is on the rows section, not the whole band — otherwise a
    // one-row detail would collapse until the header ate the band.
    const h = harness({
      detailRowAutoHeight: true,
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [] },
        getDetailRowData: (p) => p.successCallback((p.data as Row).calls),
      },
    });
    h.controller.setExpanded('c', true);   // one call record
    h.paint();
    // header 30 + max(150, 1×25) + 2×1 padding
    expect(h.controller.detailHeight('c')).toBe(30 + 150 + 2);
    h.cleanup();
  });

  it('grows an auto height past the floor once the rows warrant it', () => {
    const many = { id: 'z', name: 'Z', calls: Array.from({ length: 20 }, (_, i) => i) };
    const h = harness({
      detailRowAutoHeight: true,
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [] },
        getDetailRowData: (p) => p.successCallback((p.data as Row).calls),
      },
    }, [many]);
    h.controller.setExpanded('z', true);
    h.paint();
    // header 30 + 20×25 rows + 2×1 padding
    expect(h.controller.detailHeight('z')).toBe(30 + 500 + 2);
    h.cleanup();
  });
});

describe('master / detail controller — refreshStrategy', () => {
  const build = (strategy: 'rows' | 'everything' | 'nothing') => {
    const loads: string[] = [];
    const h = harness({
      detailCellRendererParams: {
        refreshStrategy: strategy,
        detailGridOptions: { columnDefs: [] },
        getDetailRowData: (p) => { loads.push((p.data as Row).id); p.successCallback([]); },
      },
    });
    h.controller.setExpanded('a', true);
    h.paint();
    loads.length = 0;
    return { h, loads };
  };

  it("'rows' re-runs getDetailRowData on the SAME grid", () => {
    const { h, loads } = build('rows');
    const before = h.controller.getDetailGridInfo('detail_a')?.api;
    h.controller.refreshMasterRows(['a']);
    expect(loads).toEqual(['a']);
    expect(h.controller.getDetailGridInfo('detail_a')?.api).toBe(before);
    h.cleanup();
  });

  it("'everything' rebuilds the pane from scratch", () => {
    const { h } = build('everything');
    const before = h.controller.getDetailGridInfo('detail_a')?.api;
    h.controller.refreshMasterRows(['a']);
    h.paint();
    expect(h.controller.getDetailGridInfo('detail_a')?.api).not.toBe(before);
    h.cleanup();
  });

  it("'nothing' leaves the detail alone", () => {
    const { h, loads } = build('nothing');
    const before = h.controller.getDetailGridInfo('detail_a')?.api;
    h.controller.refreshMasterRows(['a']);
    expect(loads).toEqual([]);
    expect(h.controller.getDetailGridInfo('detail_a')?.api).toBe(before);
    h.cleanup();
  });

  it('defaults to rows when no strategy is given', () => {
    const loads: string[] = [];
    const h = harness({
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [] },
        getDetailRowData: (p) => { loads.push((p.data as Row).id); p.successCallback([]); },
      },
    });
    h.controller.setExpanded('a', true);
    h.paint();
    loads.length = 0;
    h.controller.refreshMasterRows(['a']);
    expect(loads).toEqual(['a']);
    h.cleanup();
  });
});

describe('master / detail controller — teardown', () => {
  it('drops a removed master\'s expansion and its pane', () => {
    const h = harness({
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [] },
        getDetailRowData: (p) => p.successCallback([]),
      },
    });
    h.controller.setExpanded('a', true);
    h.paint();
    expect(h.controller.dropRows(['a'])).toBe(true);
    expect(h.controller.isExpanded('a')).toBe(false);
    expect(h.controller.getDetailGridInfo('detail_a')).toBeUndefined();
    h.cleanup();
  });

  it('destroys every embedded grid on destroy', () => {
    const h = harness({
      detailCellRendererParams: {
        detailGridOptions: { columnDefs: [] },
        getDetailRowData: (p) => p.successCallback([]),
      },
    });
    h.controller.setExpanded('a', true);
    h.controller.setExpanded('c', true);
    h.paint();
    expect(h.container.querySelectorAll('.vg-detail-row')).toHaveLength(2);
    h.controller.destroy();
    expect(h.container.querySelectorAll('.vg-detail-row')).toHaveLength(0);
    expect(h.controller.expandedRowIds()).toEqual([]);
    h.container.remove();
  });
});
