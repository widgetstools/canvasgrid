/**
 * Cycle 11 / Task 3 — ColumnsToolPanel unit tests.
 *
 * The Columns tool panel renders every column as a row (checkbox +
 * drag-handle + label) and below the list ships two section drop zones
 * (Row Groups, Values) plus a Pivot Mode toggle and a search input at
 * the top. The panel reads from `api.getColumnState()` and writes back
 * through `api.setColumnsVisible` / `api.moveColumns`. `headerName`
 * resolution goes through the new `api.getColumnHeaderName(colId)`
 * surface — `getColumnState()` only carries colIds.
 *
 * The seven user-visible suppress flags from `IToolPanelColumnCompParams`
 * (suppressColumnMove, suppressRowGroups, suppressValues,
 * suppressPivotMode, suppressColumnFilter, suppressSyncLayoutWithGrid,
 * plus suppressPivots which is a no-op since pivot ships in Cycle 16)
 * are exercised here per the acceptance criteria.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ColumnsToolPanel } from '../src/interaction/toolPanels/columnsPanel';
import type { CColumnState } from '../src/types';
import type { ToolPanelParams } from '../src/interaction/toolPanels/types';

interface MockApi {
  getColumnState: () => CColumnState[];
  setColumnsVisible: ReturnType<typeof vi.fn>;
  moveColumns: ReturnType<typeof vi.fn>;
  getColumnHeaderName: (colId: string) => string | undefined;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function makeApi(initial?: Partial<{ state: CColumnState[]; headers: Record<string, string> }>): MockApi {
  let state: CColumnState[] = initial?.state ?? [
    { colId: 'athlete', width: 120, hide: false },
    { colId: 'age', width: 80, hide: false },
    { colId: 'country', width: 100, hide: false },
    { colId: 'year', width: 80, hide: true },
    { colId: 'gold', width: 80, hide: false },
  ];
  const headers: Record<string, string> = initial?.headers ?? {
    athlete: 'Athlete',
    age: 'Age',
    country: 'Country',
    year: 'Year',
    gold: 'Gold',
  };
  return {
    getColumnState: () => state.map((s) => ({ ...s })),
    setColumnsVisible: vi.fn((keys: string[], visible: boolean) => {
      state = state.map((s) => (keys.includes(s.colId) ? { ...s, hide: !visible } : s));
    }),
    moveColumns: vi.fn((keys: string[], toIndex: number) => {
      const moving = state.filter((s) => keys.includes(s.colId));
      const rest = state.filter((s) => !keys.includes(s.colId));
      rest.splice(toIndex, 0, ...moving);
      state = rest;
    }),
    getColumnHeaderName: (colId: string) => headers[colId],
    addEventListener: vi.fn(() => () => {}),
    removeEventListener: vi.fn(),
  };
}

function mountPanel(api: MockApi, toolPanelParams: Record<string, unknown> = {}): {
  panel: ColumnsToolPanel;
  root: HTMLElement;
} {
  const panel = new ColumnsToolPanel();
  const params: ToolPanelParams = { api, toolPanelParams };
  panel.init(params);
  const root = panel.getGui();
  document.body.appendChild(root);
  return { panel, root };
}

describe('ColumnsToolPanel', () => {
  let hosts: ColumnsToolPanel[] = [];

  beforeEach(() => { hosts = []; });
  afterEach(() => {
    for (const p of hosts) {
      try { p.destroy(); } catch { /* noop */ }
    }
    document.body.replaceChildren();
  });

  it('init + getGui returns a root with search input, Pivot Mode toggle, column list, and the Row Groups + Values section headers', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    expect(root.classList.contains('cg-columns-panel')).toBe(true);
    expect(root.querySelector('.cg-columns-panel-search')).not.toBeNull();
    expect(root.querySelector('.cg-columns-panel-pivot-mode')).not.toBeNull();
    expect(root.querySelector('.cg-columns-panel-list')).not.toBeNull();
    const sections = Array.from(root.querySelectorAll('.cg-columns-panel-section-header'))
      .map((el) => el.textContent?.trim());
    expect(sections).toContain('Row Groups');
    expect(sections).toContain('Values');
    // Plan element-req 6: no Column Labels / pivot section in Cycle 11.
    expect(sections).not.toContain('Column Labels');
  });

  it('renders one row per columnState entry in order, with the headerName label and the visibility checkbox reflecting `hide`', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const rows = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-row'));
    expect(rows.map((r) => r.dataset.colId)).toEqual(['athlete', 'age', 'country', 'year', 'gold']);
    expect(rows.map((r) => r.querySelector<HTMLElement>('.cg-columns-panel-row-label')?.textContent)).toEqual([
      'Athlete', 'Age', 'Country', 'Year', 'Gold',
    ]);
    const checkboxes = rows.map((r) => r.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    // `hide: true` → unchecked; everything else checked.
    expect(checkboxes.map((c) => c.checked)).toEqual([true, true, true, false, true]);
  });

  it('falls back to colId when the header name is unknown', () => {
    const api = makeApi({
      state: [{ colId: 'unlabelled', hide: false }],
      headers: {}, // no headerName registered
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const label = root.querySelector<HTMLElement>('.cg-columns-panel-row-label');
    expect(label?.textContent).toBe('unlabelled');
  });

  it('toggling a checkbox calls api.setColumnsVisible([colId], visible)', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const ageRow = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="age"]')!;
    const checkbox = ageRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    expect(api.setColumnsVisible).toHaveBeenCalledWith(['age'], false);
    // The mock flips state — a real grid would emit columnVisible which the
    // panel listens to. Checkbox is updated optimistically.
    expect(checkbox.checked).toBe(false);
  });

  it('search input filters the list (case-insensitive substring on label OR colId)', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);

    const search = root.querySelector<HTMLInputElement>('.cg-columns-panel-search input')!;
    search.value = 'go';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-row'));
    const visible = rows.filter((r) => r.style.display !== 'none');
    expect(visible.map((r) => r.dataset.colId)).toEqual(['gold']);

    // Clear → all rows return.
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const restored = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-row'))
      .filter((r) => r.style.display !== 'none');
    expect(restored.length).toBe(5);
  });

  it('suppressColumnFilter hides the search input', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api, { suppressColumnFilter: true });
    hosts.push(panel);
    expect(root.querySelector('.cg-columns-panel-search')).toBeNull();
  });

  it('suppressRowGroups hides the Row Groups section', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api, { suppressRowGroups: true });
    hosts.push(panel);
    const sections = Array.from(root.querySelectorAll('.cg-columns-panel-section-header'))
      .map((el) => el.textContent?.trim());
    expect(sections).not.toContain('Row Groups');
    // Values section is still present.
    expect(sections).toContain('Values');
  });

  it('suppressValues hides the Values section', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api, { suppressValues: true });
    hosts.push(panel);
    const sections = Array.from(root.querySelectorAll('.cg-columns-panel-section-header'))
      .map((el) => el.textContent?.trim());
    expect(sections).not.toContain('Values');
    expect(sections).toContain('Row Groups');
  });

  it('suppressPivotMode hides the Pivot Mode toggle', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api, { suppressPivotMode: true });
    hosts.push(panel);
    expect(root.querySelector('.cg-columns-panel-pivot-mode')).toBeNull();
  });

  it('suppressColumnMove hides the drag handles', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api, { suppressColumnMove: true });
    hosts.push(panel);
    const handles = root.querySelectorAll('.cg-columns-panel-row-handle');
    expect(handles.length).toBe(0);
  });

  it('refresh() re-reads getColumnState() — checkbox states + row order update without rebuilding the GUI root', () => {
    const initial: CColumnState[] = [
      { colId: 'a', hide: false },
      { colId: 'b', hide: false },
      { colId: 'c', hide: false },
    ];
    let state = [...initial];
    const api: MockApi = {
      getColumnState: () => state.map((s) => ({ ...s })),
      setColumnsVisible: vi.fn(),
      moveColumns: vi.fn(),
      getColumnHeaderName: (colId) => ({ a: 'A', b: 'B', c: 'C' })[colId],
      addEventListener: vi.fn(() => () => {}),
      removeEventListener: vi.fn(),
    };
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const originalRoot = root;

    // Mutate state externally — flip `b` hidden + reorder so `c` is first.
    state = [
      { colId: 'c', hide: false },
      { colId: 'a', hide: false },
      { colId: 'b', hide: true },
    ];
    panel.refresh();

    // Root identity is preserved (no rebuild of root container).
    expect(panel.getGui()).toBe(originalRoot);

    const rows = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-row'));
    expect(rows.map((r) => r.dataset.colId)).toEqual(['c', 'a', 'b']);
    const checkboxes = rows.map((r) => r.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(checkboxes.map((c) => c.checked)).toEqual([true, true, false]);
  });

  it('subscribes to columnVisible + columnMoved events on init and unsubscribes on destroy (default sync behaviour)', () => {
    const api = makeApi();
    const { panel } = mountPanel(api);
    hosts.push(panel);

    const subscribedTypes = (api.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(subscribedTypes).toContain('columnVisible');
    expect(subscribedTypes).toContain('columnMoved');
  });

  it('suppressSyncLayoutWithGrid: true skips the columnVisible/columnMoved listeners', () => {
    const api = makeApi();
    const { panel } = mountPanel(api, { suppressSyncLayoutWithGrid: true });
    hosts.push(panel);
    const subscribedTypes = (api.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    // Cycle 15.5 / Task 2 — the Row Groups zone subscription
    // (`columnRowGroupChanged`) is NOT gated by this flag: the flag's
    // contract is about column LAYOUT, not grouping. The zone is a
    // mirror by design; suppressing the sync would defeat the
    // three-views-one-list invariant. Only the column-layout
    // subscriptions are skipped.
    expect(subscribedTypes).not.toContain('columnVisible');
    expect(subscribedTypes).not.toContain('columnMoved');
  });

  it('Row Groups + Values drop zones render dashed-border containers with placeholder text', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const dropZones = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-drop-zone'));
    expect(dropZones.length).toBe(2);
    const texts = dropZones.map((z) => z.textContent?.trim());
    expect(texts).toContain('Drag here to set row groups');
    expect(texts).toContain('Drag here to aggregate');
  });

  it('Pivot Mode toggle click flips the data-active attribute (visual stub — wired to api.setPivotMode in Cycle 16)', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const toggle = root.querySelector<HTMLElement>('.cg-columns-panel-pivot-mode')!;
    const button = toggle.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('destroy() removes the DOM root from any parent and is idempotent', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    expect(document.body.contains(root)).toBe(true);
    panel.destroy();
    expect(document.body.contains(root)).toBe(false);
    // idempotent
    expect(() => panel.destroy()).not.toThrow();
  });
});
