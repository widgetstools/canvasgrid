/**
 * Cycle 11 / Task 4 — FiltersToolPanel unit tests.
 *
 * The Filters tool panel renders one collapsible row per filterable
 * column, with a top-level search input and an expand-all toggle.
 * Clicking a row expands it inline and mounts the column's filter
 * editor — the SAME editor `FilterPopupHost` mounts in popup mode,
 * threaded through the new `api.buildColumnFilterEditor(colId)` helper
 * so a bug fixed in one path is fixed in both.
 *
 * Suppress flags from `IToolPanelFiltersCompParams` (suppressExpandAll,
 * suppressFilterSearch, suppressSyncLayoutWithGrid) are exercised here
 * per the acceptance criteria.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FiltersToolPanel } from '../src/interaction/toolPanels/filtersPanel';
import type { CColumnState } from '../src/types';
import type { ToolPanelParams } from '../src/interaction/toolPanels/types';

type FilterType = 'text' | 'number' | 'date' | 'set' | null;

interface MockApi {
  getColumnState: () => CColumnState[];
  getColumnHeaderName: (colId: string) => string | undefined;
  getColumnFilterType: (colId: string) => FilterType;
  buildColumnFilterEditor: ReturnType<typeof vi.fn>;
  setColumnFilterModel: ReturnType<typeof vi.fn>;
  getColumnFilterModel: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

interface MockApiOptions {
  state?: CColumnState[];
  headers?: Record<string, string>;
  filterTypes?: Record<string, FilterType>;
  editor?: (colId: string) => { gui: HTMLElement; destroy(): void } | null;
}

function makeApi(opts: MockApiOptions = {}): MockApi {
  const state: CColumnState[] = opts.state ?? [
    { colId: 'athlete', hide: false },
    { colId: 'age', hide: false },
    { colId: 'country', hide: false },
    { colId: 'year', hide: false },
    { colId: 'gold', hide: false },
    // A column with NO filter — should not appear in the panel.
    { colId: 'misc', hide: false },
  ];
  const headers: Record<string, string> = opts.headers ?? {
    athlete: 'Athlete',
    age: 'Age',
    country: 'Country',
    year: 'Year',
    gold: 'Gold',
    misc: 'Misc',
  };
  const filterTypes: Record<string, FilterType> = opts.filterTypes ?? {
    athlete: 'text',
    age: 'number',
    country: 'set',
    year: 'number',
    gold: 'number',
    misc: null,
  };
  const editorBuilder = opts.editor ?? ((_colId: string) => {
    const gui = document.createElement('div');
    gui.className = 'mock-filter-editor';
    const destroy = vi.fn();
    return { gui, destroy };
  });
  return {
    getColumnState: () => state.map((s) => ({ ...s })),
    getColumnHeaderName: (colId) => headers[colId],
    getColumnFilterType: (colId) => filterTypes[colId] ?? null,
    buildColumnFilterEditor: vi.fn((colId: string) => Promise.resolve(editorBuilder(colId))),
    setColumnFilterModel: vi.fn(() => Promise.resolve()),
    getColumnFilterModel: vi.fn(() => null),
    addEventListener: vi.fn(() => () => {}),
    removeEventListener: vi.fn(),
  };
}

function mountPanel(api: MockApi, toolPanelParams: Record<string, unknown> = {}): {
  panel: FiltersToolPanel;
  root: HTMLElement;
} {
  const panel = new FiltersToolPanel();
  const params: ToolPanelParams = { api, toolPanelParams };
  panel.init(params);
  const root = panel.getGui();
  document.body.appendChild(root);
  return { panel, root };
}

describe('FiltersToolPanel', () => {
  let hosts: FiltersToolPanel[] = [];

  beforeEach(() => { hosts = []; });
  afterEach(() => {
    for (const p of hosts) {
      try { p.destroy(); } catch { /* noop */ }
    }
    document.body.replaceChildren();
  });

  it('init + getGui returns a root with search input, expand-all button, and a row list', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    expect(root.classList.contains('vg-filters-panel')).toBe(true);
    expect(root.querySelector('.vg-filters-panel-search')).not.toBeNull();
    expect(root.querySelector('.vg-filters-panel-expand-all')).not.toBeNull();
    expect(root.querySelector('.vg-filters-panel-list')).not.toBeNull();
  });

  it('renders one collapsible row per FILTERABLE column from getColumnState (skips columns with no filter type)', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const rows = Array.from(root.querySelectorAll<HTMLElement>('.vg-filters-panel-row'));
    // misc has filterType: null → skipped.
    expect(rows.map((r) => r.dataset.colId)).toEqual(['athlete', 'age', 'country', 'year', 'gold']);
    expect(rows.map((r) => r.querySelector<HTMLElement>('.vg-filters-panel-row-label')?.textContent))
      .toEqual(['Athlete', 'Age', 'Country', 'Year', 'Gold']);
  });

  it('every row starts collapsed (chevron `>`, data-expanded="false")', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const rows = Array.from(root.querySelectorAll<HTMLElement>('.vg-filters-panel-row'));
    for (const row of rows) {
      expect(row.dataset.expanded).toBe('false');
      const chevron = row.querySelector<HTMLElement>('.vg-filters-panel-row-chevron');
      expect(chevron?.textContent).toBe('›'); // ›
    }
  });

  it('falls back to colId when headerName is unknown', () => {
    const api = makeApi({
      state: [{ colId: 'unlabelled', hide: false }],
      headers: {},
      filterTypes: { unlabelled: 'text' },
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const label = root.querySelector<HTMLElement>('.vg-filters-panel-row-label');
    expect(label?.textContent).toBe('unlabelled');
  });

  it('clicking a row header expands it and mounts the column filter editor inline', async () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const ageRow = root.querySelector<HTMLElement>('.vg-filters-panel-row[data-col-id="age"]')!;
    const header = ageRow.querySelector<HTMLElement>('.vg-filters-panel-row-header')!;
    header.click();
    // Wait one microtask + a tick for the async buildColumnFilterEditor.
    await Promise.resolve();
    await Promise.resolve();

    expect(api.buildColumnFilterEditor).toHaveBeenCalledWith('age');
    expect(ageRow.dataset.expanded).toBe('true');
    const chevron = ageRow.querySelector<HTMLElement>('.vg-filters-panel-row-chevron');
    expect(chevron?.textContent).toBe('⌄'); // ⌄
    const editorHost = ageRow.querySelector<HTMLElement>('.vg-filters-panel-row-editor');
    expect(editorHost?.querySelector('.mock-filter-editor')).not.toBeNull();
  });

  it('clicking an already-expanded row collapses it and destroys the editor', async () => {
    const destroy = vi.fn();
    const api = makeApi({
      editor: () => ({ gui: document.createElement('div'), destroy }),
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const ageRow = root.querySelector<HTMLElement>('.vg-filters-panel-row[data-col-id="age"]')!;
    const header = ageRow.querySelector<HTMLElement>('.vg-filters-panel-row-header')!;
    header.click();
    await Promise.resolve(); await Promise.resolve();
    expect(ageRow.dataset.expanded).toBe('true');

    header.click();
    expect(ageRow.dataset.expanded).toBe('false');
    expect(destroy).toHaveBeenCalledTimes(1);
    const chevron = ageRow.querySelector<HTMLElement>('.vg-filters-panel-row-chevron');
    expect(chevron?.textContent).toBe('›');
  });

  it('only one row can be in the expanded state at a time — opening a second collapses the first', async () => {
    const destroyA = vi.fn();
    let calls = 0;
    const api = makeApi({
      editor: () => {
        calls++;
        if (calls === 1) return { gui: document.createElement('div'), destroy: destroyA };
        return { gui: document.createElement('div'), destroy: vi.fn() };
      },
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const ageRow = root.querySelector<HTMLElement>('.vg-filters-panel-row[data-col-id="age"]')!;
    const goldRow = root.querySelector<HTMLElement>('.vg-filters-panel-row[data-col-id="gold"]')!;
    ageRow.querySelector<HTMLElement>('.vg-filters-panel-row-header')!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(ageRow.dataset.expanded).toBe('true');

    goldRow.querySelector<HTMLElement>('.vg-filters-panel-row-header')!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(goldRow.dataset.expanded).toBe('true');
    expect(ageRow.dataset.expanded).toBe('false');
    expect(destroyA).toHaveBeenCalledTimes(1);
  });

  it('search input filters the row list (case-insensitive substring on label OR colId)', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const search = root.querySelector<HTMLInputElement>('.vg-filters-panel-search input')!;
    search.value = 'go';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.vg-filters-panel-row'));
    const visible = rows.filter((r) => r.style.display !== 'none');
    expect(visible.map((r) => r.dataset.colId)).toEqual(['gold']);

    // Clear → all rows return.
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const restored = Array.from(root.querySelectorAll<HTMLElement>('.vg-filters-panel-row'))
      .filter((r) => r.style.display !== 'none');
    expect(restored.length).toBe(5);
  });

  it('expand-all button expands every row in a single click', async () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const btn = root.querySelector<HTMLButtonElement>('.vg-filters-panel-expand-all button')!;
    btn.click();
    // Wait a couple of microtasks for every editor promise to resolve.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.vg-filters-panel-row'));
    for (const row of rows) {
      expect(row.dataset.expanded).toBe('true');
    }
  });

  it('expand-all toggles back to collapse-all when every row is already expanded', async () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const btn = root.querySelector<HTMLButtonElement>('.vg-filters-panel-expand-all button')!;
    btn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    btn.click();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.vg-filters-panel-row'));
    for (const row of rows) {
      expect(row.dataset.expanded).toBe('false');
    }
  });

  it('suppressFilterSearch hides the search input', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api, { suppressFilterSearch: true });
    hosts.push(panel);
    expect(root.querySelector('.vg-filters-panel-search')).toBeNull();
  });

  it('suppressExpandAll hides the expand-all button', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api, { suppressExpandAll: true });
    hosts.push(panel);
    expect(root.querySelector('.vg-filters-panel-expand-all')).toBeNull();
  });

  it('subscribes to columnMoved + columnVisible events on init and unsubscribes on destroy (default sync behaviour)', () => {
    const api = makeApi();
    const { panel } = mountPanel(api);
    hosts.push(panel);

    const subscribedTypes = (api.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(subscribedTypes).toContain('columnMoved');
    expect(subscribedTypes).toContain('columnVisible');
  });

  it('suppressSyncLayoutWithGrid: true skips the columnMoved/columnVisible listeners', () => {
    const api = makeApi();
    const { panel } = mountPanel(api, { suppressSyncLayoutWithGrid: true });
    hosts.push(panel);
    expect(api.addEventListener).not.toHaveBeenCalled();
  });

  it('renders the "No filterable columns" empty state when no column has a filter type', () => {
    const api = makeApi({
      state: [
        { colId: 'a', hide: false },
        { colId: 'b', hide: false },
      ],
      headers: { a: 'A', b: 'B' },
      filterTypes: { a: null, b: null },
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    expect(root.querySelector('.vg-filters-panel-row')).toBeNull();
    const empty = root.querySelector<HTMLElement>('.vg-filters-panel-empty');
    expect(empty?.textContent?.trim()).toBe('No filterable columns');
  });

  it('refresh() re-reads getColumnState + getColumnFilterType — adds new rows, drops gone ones, keeps root identity', () => {
    let state: CColumnState[] = [
      { colId: 'a', hide: false },
      { colId: 'b', hide: false },
    ];
    let filterTypes: Record<string, FilterType> = { a: 'text', b: 'number' };
    const api: MockApi = {
      getColumnState: () => state.map((s) => ({ ...s })),
      getColumnHeaderName: (id) => ({ a: 'A', b: 'B', c: 'C' })[id],
      getColumnFilterType: (id) => filterTypes[id] ?? null,
      buildColumnFilterEditor: vi.fn(() => Promise.resolve({ gui: document.createElement('div'), destroy: vi.fn() })),
      setColumnFilterModel: vi.fn(),
      getColumnFilterModel: vi.fn(),
      addEventListener: vi.fn(() => () => {}),
      removeEventListener: vi.fn(),
    };
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const originalRoot = root;

    state = [
      { colId: 'b', hide: false },
      { colId: 'c', hide: false },
    ];
    filterTypes = { b: 'number', c: 'set' };
    panel.refresh();

    expect(panel.getGui()).toBe(originalRoot);
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.vg-filters-panel-row'));
    expect(rows.map((r) => r.dataset.colId)).toEqual(['b', 'c']);
  });

  it('destroy() removes the DOM root and destroys any mounted editor; idempotent', async () => {
    const destroy = vi.fn();
    const api = makeApi({
      editor: () => ({ gui: document.createElement('div'), destroy }),
    });
    const { panel, root } = mountPanel(api);
    expect(document.body.contains(root)).toBe(true);

    const ageRow = root.querySelector<HTMLElement>('.vg-filters-panel-row[data-col-id="age"]')!;
    ageRow.querySelector<HTMLElement>('.vg-filters-panel-row-header')!.click();
    await Promise.resolve(); await Promise.resolve();

    panel.destroy();
    expect(document.body.contains(root)).toBe(false);
    expect(destroy).toHaveBeenCalled();
    // idempotent
    expect(() => panel.destroy()).not.toThrow();
  });
});
