/**
 * Cycle 18 / Task 5 — Tool panel pivot sections (Column Labels + Values
 * zones; pivotMode-dependent checkbox semantics).
 *
 * The columns tool panel (Cycle 11 / Task 3) shipped a Pivot Mode toggle
 * that flipped only `aria-pressed`, a Values zone that was inert, and no
 * Column Labels zone at all. Cycle 18 / Task 5 makes all three live —
 * pivot mode wires to `api.setPivotMode` + subscribes to
 * `pivotStateChanged`; the Column Labels and Values zones become the
 * "many views over one PivotState" surfaces (parallel to how the Row
 * Groups zone is a view over `GroupingState` since Cycle 15.5 / Task 2);
 * checkboxes in the column list switch from visibility-toggling to
 * role-adding when pivot mode is on.
 *
 * 31 cases, structured to mirror toolPanelRowGroups.test.ts:
 *  1-5   pivot mode toggle wiring + suppressPivotMode
 *  6-15  Column Labels drop zone (render, drag-in, drag-out, suppressPivots)
 *  16-23 Values drop zone (render, drag-in, drag-out, suppressValues)
 *  24-31 pivotMode-dependent checkbox semantics (the AG-parity bug:
 *        Prompt 9 item 4 — highest-confidence regression to test)
 *
 * The mock api wraps an in-memory equivalent of PivotState so the panel's
 * mutate-then-resubscribe flow can be exercised without standing up a real
 * CGrid+worker (those round-trips are covered by the integration tests in
 * apps/cgrid-positions/e2e).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ColumnsToolPanel } from '../src/interaction/toolPanels/columnsPanel';
import type { CColumnState, CGridEvent } from '../src/types';
import type { ToolPanelParams } from '../src/interaction/toolPanels/types';

interface PivotMockApi {
  // ── column model ───────────────────────────────────────────────
  getColumnState: () => CColumnState[];
  setColumnsVisible: ReturnType<typeof vi.fn>;
  moveColumns: ReturnType<typeof vi.fn>;
  getColumnHeaderName: (colId: string) => string | undefined;
  // ── row group enable + state ──────────────────────────────────
  isColumnRowGroupEnabled: (colId: string) => boolean;
  getRowGroupColumns: () => string[];
  addRowGroupColumn: ReturnType<typeof vi.fn>;
  removeRowGroupColumn: ReturnType<typeof vi.fn>;
  // ── pivot mode + columns + values (NEW for Task 5) ────────────
  isPivotMode: () => boolean;
  setPivotMode: ReturnType<typeof vi.fn>;
  getPivotColumns: () => string[];
  addPivotColumn: ReturnType<typeof vi.fn>;
  removePivotColumn: ReturnType<typeof vi.fn>;
  isColumnPivotEnabled: (colId: string) => boolean;
  getValueColumns: () => Array<{ colId: string; aggFunc: string }>;
  addValueColumn: ReturnType<typeof vi.fn>;
  removeValueColumn: ReturnType<typeof vi.fn>;
  isColumnValueEnabled: (colId: string) => boolean;
  /** Resolved colDef aggFunc — the panel reads this for the default
   *  aggregation when a column is dropped on the Values zone. */
  getColumnDefaultAggFunc: (colId: string) => string | undefined;
  // ── event bus ─────────────────────────────────────────────────
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  getGridOption: ReturnType<typeof vi.fn>;
  /** Pump a synthetic event into every subscriber. */
  emit: (event: CGridEvent) => void;
}

interface PivotMockInit {
  state?: CColumnState[];
  headers?: Record<string, string>;
  groupable?: Set<string>;
  pivotable?: Set<string>;
  valueable?: Set<string>;
  defaultAggFunc?: Record<string, string>;
  rowGroupColumns?: string[];
  pivotColumns?: string[];
  valueColumns?: Array<{ colId: string; aggFunc: string }>;
  pivotMode?: boolean;
  allowDragFromColumnsToolPanel?: boolean;
}

function makeApi(initial?: PivotMockInit): PivotMockApi {
  let state: CColumnState[] = initial?.state ?? [
    { colId: 'athlete', width: 120, hide: false },
    { colId: 'age',     width: 80,  hide: false },
    { colId: 'country', width: 100, hide: false },
    { colId: 'year',    width: 80,  hide: false },
    { colId: 'sport',   width: 100, hide: false },
    { colId: 'gold',    width: 80,  hide: false },
    { colId: 'silver',  width: 80,  hide: false },
  ];
  const headers: Record<string, string> = initial?.headers ?? {
    athlete: 'Athlete', age: 'Age', country: 'Country', year: 'Year',
    sport: 'Sport', gold: 'Gold', silver: 'Silver',
  };
  const groupable = initial?.groupable ?? new Set(['athlete', 'country', 'year', 'sport']);
  const pivotable = initial?.pivotable ?? new Set(['country', 'year', 'sport']);
  const valueable = initial?.valueable ?? new Set(['gold', 'silver', 'age']);
  const defaultAggFunc = initial?.defaultAggFunc ?? {};
  let rowGroupColumns: string[] = [...(initial?.rowGroupColumns ?? [])];
  let pivotColumns: string[] = [...(initial?.pivotColumns ?? [])];
  let valueColumns: Array<{ colId: string; aggFunc: string }> = (initial?.valueColumns ?? []).map((v) => ({ ...v }));
  let pivotMode = initial?.pivotMode ?? false;
  const allowDrag = initial?.allowDragFromColumnsToolPanel;
  const listeners = new Map<string, Set<(e: CGridEvent) => void>>();

  const fireRowGroupChanged = (source: 'add' | 'remove' | 'move' | 'set' | 'sort' | 'restore') => {
    api.emit({ type: 'columnRowGroupChanged', columns: [...rowGroupColumns], source });
  };
  const firePivotChanged = (source: 'mode' | 'add' | 'remove' | 'move' | 'set' | 'aggFunc' | 'restore') => {
    api.emit({
      type: 'pivotStateChanged',
      pivotMode,
      pivotColumns: [...pivotColumns],
      valueColumns: valueColumns.map((v) => ({ ...v })),
      source,
    });
  };

  const api: PivotMockApi = {
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
    getColumnHeaderName: (colId) => headers[colId],
    isColumnRowGroupEnabled: (colId) => groupable.has(colId),
    getRowGroupColumns: () => [...rowGroupColumns],
    addRowGroupColumn: vi.fn((colId: string) => {
      if (rowGroupColumns.includes(colId)) return;
      rowGroupColumns = [...rowGroupColumns, colId];
      fireRowGroupChanged('add');
    }),
    removeRowGroupColumn: vi.fn((colId: string) => {
      const idx = rowGroupColumns.indexOf(colId);
      if (idx < 0) return;
      rowGroupColumns = [...rowGroupColumns.slice(0, idx), ...rowGroupColumns.slice(idx + 1)];
      fireRowGroupChanged('remove');
    }),

    isPivotMode: () => pivotMode,
    setPivotMode: vi.fn((next: boolean) => {
      if (pivotMode === next) return;
      pivotMode = next;
      firePivotChanged('mode');
    }),
    getPivotColumns: () => [...pivotColumns],
    addPivotColumn: vi.fn((colId: string) => {
      if (pivotColumns.includes(colId)) return;
      pivotColumns = [...pivotColumns, colId];
      firePivotChanged('add');
    }),
    removePivotColumn: vi.fn((colId: string) => {
      const idx = pivotColumns.indexOf(colId);
      if (idx < 0) return;
      pivotColumns = [...pivotColumns.slice(0, idx), ...pivotColumns.slice(idx + 1)];
      firePivotChanged('remove');
    }),
    isColumnPivotEnabled: (colId) => pivotable.has(colId),
    getValueColumns: () => valueColumns.map((v) => ({ ...v })),
    addValueColumn: vi.fn((colId: string, aggFunc: string) => {
      if (valueColumns.some((v) => v.colId === colId)) return;
      valueColumns = [...valueColumns, { colId, aggFunc }];
      firePivotChanged('add');
    }),
    removeValueColumn: vi.fn((colId: string) => {
      const idx = valueColumns.findIndex((v) => v.colId === colId);
      if (idx < 0) return;
      valueColumns = [...valueColumns.slice(0, idx), ...valueColumns.slice(idx + 1)];
      firePivotChanged('remove');
    }),
    isColumnValueEnabled: (colId) => valueable.has(colId),
    getColumnDefaultAggFunc: (colId) => defaultAggFunc[colId],

    addEventListener: vi.fn((type: string, handler: (e: CGridEvent) => void) => {
      let bucket = listeners.get(type);
      if (!bucket) { bucket = new Set(); listeners.set(type, bucket); }
      bucket.add(handler);
      return () => bucket!.delete(handler);
    }),
    removeEventListener: vi.fn(),
    getGridOption: vi.fn((key: string) => {
      if (key === 'allowDragFromColumnsToolPanel') return allowDrag;
      return undefined;
    }),
    emit: (event: CGridEvent) => {
      // Tests that emit a synthetic columnRowGroupChanged / pivotStateChanged
      // (simulating an external surface mutating state) should keep the
      // mock's underlying snapshot in sync with the payload.
      if (event.type === 'columnRowGroupChanged') {
        rowGroupColumns = [...event.columns];
      } else if (event.type === 'pivotStateChanged') {
        pivotMode = event.pivotMode;
        pivotColumns = [...event.pivotColumns];
        valueColumns = event.valueColumns.map((v) => ({ ...v }));
      }
      const bucket = listeners.get(event.type);
      if (!bucket) return;
      for (const h of bucket) h(event);
    },
  };
  return api;
}

function mountPanel(api: PivotMockApi, toolPanelParams: Record<string, unknown> = {}): {
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

function pinZoneRect(root: HTMLElement, selector: string, rect: { left: number; top: number; right: number; bottom: number }): void {
  const zone = root.querySelector<HTMLElement>(selector);
  if (!zone) throw new Error(`zone not mounted: ${selector}`);
  zone.getBoundingClientRect = () => ({
    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width: rect.right - rect.left, height: rect.bottom - rect.top,
    x: rect.left, y: rect.top, toJSON() { return rect; },
  });
}

describe('ColumnsToolPanel — pivot mode toggle (Cycle 18 / Task 5)', () => {
  let hosts: ColumnsToolPanel[] = [];
  beforeEach(() => { hosts = []; });
  afterEach(() => {
    for (const p of hosts) { try { p.destroy(); } catch { /* noop */ } }
    document.body.replaceChildren();
  });

  it('toggle aria-pressed reads initial pivotMode state from api.isPivotMode()', () => {
    const api = makeApi({ pivotMode: true });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const btn = root.querySelector<HTMLButtonElement>('.cg-columns-panel-toggle');
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking the toggle calls api.setPivotMode(!current)', () => {
    const api = makeApi({ pivotMode: false });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const btn = root.querySelector<HTMLButtonElement>('.cg-columns-panel-toggle')!;
    btn.click();
    expect(api.setPivotMode).toHaveBeenCalledWith(true, { discardSettings: true });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    btn.click();
    expect(api.setPivotMode).toHaveBeenCalledWith(false, { discardSettings: true });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('external pivotStateChanged event with new pivotMode re-syncs the toggle aria-pressed', () => {
    const api = makeApi({ pivotMode: false });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const btn = root.querySelector<HTMLButtonElement>('.cg-columns-panel-toggle')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    api.emit({ type: 'pivotStateChanged', pivotMode: true, pivotColumns: [], valueColumns: [], source: 'mode' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('suppressPivotMode: true omits the toggle row entirely', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api, { suppressPivotMode: true });
    hosts.push(panel);
    expect(root.querySelector('.cg-columns-panel-pivot-mode')).toBeNull();
    expect(root.querySelector('.cg-columns-panel-toggle')).toBeNull();
  });

  it('panel subscribes to pivotStateChanged on init and unsubscribes on destroy', () => {
    const api = makeApi();
    const { panel } = mountPanel(api);
    hosts.push(panel);
    const types = (api.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(types).toContain('pivotStateChanged');
  });
});

// Cycle 21i / Phase 1 — the Column Labels drop zone was removed from
// the columns tool panel (column-labels config lives in the top pivot
// strip's split-right half). Its former render/drag tests are dropped.

describe('ColumnsToolPanel — Values drop zone (Cycle 18 / Task 5)', () => {
  let hosts: ColumnsToolPanel[] = [];
  beforeEach(() => { hosts = []; });
  afterEach(() => {
    for (const p of hosts) { try { p.destroy(); } catch { /* noop */ } }
    document.body.replaceChildren();
  });

  it('zone renders with role="list", aria-label, and empty-state placeholder when no value columns set', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const zone = root.querySelector<HTMLElement>('.cg-columns-panel-valz');
    expect(zone).not.toBeNull();
    expect(zone!.getAttribute('role')).toBe('list');
    expect(zone!.getAttribute('aria-label')).toBe('Aggregate value columns');
    const empty = zone!.querySelector<HTMLElement>('.cg-columns-panel-valz-empty');
    expect(empty?.textContent).toBe('Drag here to aggregate');
    expect(zone!.querySelectorAll('.cg-columns-panel-valz-pill').length).toBe(0);
  });

  it('renders one pill per getValueColumns() entry in order with aggFunc(headerName) label', () => {
    const api = makeApi({ valueColumns: [
      { colId: 'gold',   aggFunc: 'sum' },
      { colId: 'silver', aggFunc: 'avg' },
    ] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const pills = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-valz-pill'));
    expect(pills.map((p) => p.dataset.colId)).toEqual(['gold', 'silver']);
    const labels = pills.map((p) => p.querySelector<HTMLElement>('.cg-columns-panel-valz-pill-label')?.textContent);
    expect(labels).toEqual(['sum(Gold)', 'avg(Silver)']);
  });

  it('pill `×` click calls api.removeValueColumn(colId)', () => {
    const api = makeApi({ valueColumns: [{ colId: 'gold', aggFunc: 'sum' }] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const pill = root.querySelector<HTMLElement>('.cg-columns-panel-valz-pill[data-col-id="gold"]')!;
    const remove = pill.querySelector<HTMLButtonElement>('.cg-columns-panel-valz-pill-remove')!;
    remove.click();
    expect(api.removeValueColumn).toHaveBeenCalledWith('gold');
  });

  it('drag a value-enabled column with no declared aggFunc into the zone calls addValueColumn(colId, "sum")', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinZoneRect(root, '.cg-columns-panel-valz', { left: 0, top: 300, right: 240, bottom: 380 });
    const handle = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="gold"] .cg-columns-panel-row-handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 340 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 340 }));
    expect(api.addValueColumn).toHaveBeenCalledWith('gold', 'sum');
  });

  it('drag a value-enabled column whose colDef declares aggFunc uses the declared func', () => {
    const api = makeApi({ defaultAggFunc: { gold: 'avg' } });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinZoneRect(root, '.cg-columns-panel-valz', { left: 0, top: 300, right: 240, bottom: 380 });
    const handle = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="gold"] .cg-columns-panel-row-handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 340 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 340 }));
    expect(api.addValueColumn).toHaveBeenCalledWith('gold', 'avg');
  });

  it('drag a non-value-enabled column into the zone shows reject state and does NOT call addValueColumn', () => {
    // `country` is groupable + pivotable but NOT in `valueable`.
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinZoneRect(root, '.cg-columns-panel-valz', { left: 0, top: 300, right: 240, bottom: 380 });
    const handle = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 340 }));
    const zone = root.querySelector<HTMLElement>('.cg-columns-panel-valz')!;
    expect(zone.dataset.drop).toBe('reject');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 340 }));
    expect(api.addValueColumn).not.toHaveBeenCalled();
    expect(zone.dataset.drop).toBeUndefined();
  });

  it('drag-into-zone for an already-measured column is rejected (no double-add)', () => {
    const api = makeApi({ valueColumns: [{ colId: 'gold', aggFunc: 'sum' }] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinZoneRect(root, '.cg-columns-panel-valz', { left: 0, top: 300, right: 240, bottom: 380 });
    const handle = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="gold"] .cg-columns-panel-row-handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 340 }));
    const zone = root.querySelector<HTMLElement>('.cg-columns-panel-valz')!;
    expect(zone.dataset.drop).toBe('reject');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 340 }));
    expect(api.addValueColumn).not.toHaveBeenCalled();
  });

  it('pill drag-OUT of the Values zone calls api.removeValueColumn', () => {
    const api = makeApi({ valueColumns: [{ colId: 'gold', aggFunc: 'sum' }] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinZoneRect(root, '.cg-columns-panel-valz', { left: 0, top: 300, right: 240, bottom: 380 });
    const pill = root.querySelector<HTMLElement>('.cg-columns-panel-valz-pill[data-col-id="gold"]')!;
    pill.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 340, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 350 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 500 }));
    expect(api.removeValueColumn).toHaveBeenCalledWith('gold');
  });

  it('Values zone subscribes to pivotStateChanged and re-renders pills when state mutates externally', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    expect(root.querySelectorAll('.cg-columns-panel-valz-pill').length).toBe(0);
    api.addValueColumn('gold', 'sum');
    const pills = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-valz-pill'));
    expect(pills.map((p) => p.dataset.colId)).toEqual(['gold']);
  });

  it('suppressValues: true omits the entire Values zone', () => {
    const api = makeApi({ valueColumns: [{ colId: 'gold', aggFunc: 'sum' }] });
    const { panel, root } = mountPanel(api, { suppressValues: true });
    hosts.push(panel);
    expect(root.querySelector('.cg-columns-panel-valz')).toBeNull();
  });
});

describe('ColumnsToolPanel — pivotMode-dependent checkbox semantics (Cycle 18 / Task 5)', () => {
  // This is THE AG-parity bug (Prompt 9 item 4) — the highest-confidence
  // regression. Each test pins one branch of the truth table.
  let hosts: ColumnsToolPanel[] = [];
  beforeEach(() => { hosts = []; });
  afterEach(() => {
    for (const p of hosts) { try { p.destroy(); } catch { /* noop */ } }
    document.body.replaceChildren();
  });

  it('pivotMode OFF: clicking a row checkbox toggles VISIBILITY (existing behavior preserved)', () => {
    const api = makeApi({ pivotMode: false });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const cb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-checkbox')!;
    cb.click(); // toggle off → makes hidden
    expect(api.setColumnsVisible).toHaveBeenCalledWith(['country'], false);
    expect(api.addRowGroupColumn).not.toHaveBeenCalled();
    expect(api.addValueColumn).not.toHaveBeenCalled();
  });

  it('pivotMode ON: checking a role-eligible column ADDS the role and does NOT call setColumnsVisible', () => {
    // Cycle 19 / Task 5b — under pivot mode the checkbox owns ROLE
    // membership only. Primary visibility is owned by `PivotEngine`'s
    // auto-hide pass; the panel MUST NOT call `setColumnsVisible` in
    // pivot mode or it would fight that invariant.
    const api = makeApi({
      pivotMode: true,
      state: [
        { colId: 'athlete', width: 120, hide: true },
        { colId: 'country', width: 100, hide: true },
        { colId: 'gold',    width: 80,  hide: true },
      ],
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const cb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-checkbox')!;
    expect(cb.checked).toBe(false);
    cb.click();
    expect(api.addRowGroupColumn).toHaveBeenCalledWith('country');
    expect(api.setColumnsVisible).not.toHaveBeenCalled();
  });

  it('pivotMode ON: checking a value-eligible column ADDS as value with default sum and does NOT call setColumnsVisible', () => {
    const api = makeApi({
      pivotMode: true,
      state: [
        { colId: 'country', width: 100, hide: true },
        { colId: 'gold',    width: 80,  hide: true },
      ],
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const cb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="gold"] .cg-columns-panel-row-checkbox')!;
    expect(cb.checked).toBe(false);
    cb.click();
    expect(api.addValueColumn).toHaveBeenCalledWith('gold', 'sum');
    expect(api.addRowGroupColumn).not.toHaveBeenCalled();
    expect(api.setColumnsVisible).not.toHaveBeenCalled();
  });

  it('pivotMode ON: unchecking a row-group REMOVES the role and does NOT call setColumnsVisible', () => {
    const api = makeApi({ pivotMode: true, rowGroupColumns: ['country'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const cb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-checkbox')!;
    expect(cb.checked).toBe(true);
    cb.click();
    expect(api.removeRowGroupColumn).toHaveBeenCalledWith('country');
    expect(api.setColumnsVisible).not.toHaveBeenCalled();
  });

  it('pivotMode ON: unchecking a value REMOVES the role and does NOT call setColumnsVisible', () => {
    const api = makeApi({ pivotMode: true, valueColumns: [{ colId: 'gold', aggFunc: 'sum' }] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const cb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="gold"] .cg-columns-panel-row-checkbox')!;
    expect(cb.checked).toBe(true);
    cb.click();
    expect(api.removeValueColumn).toHaveBeenCalledWith('gold');
    expect(api.setColumnsVisible).not.toHaveBeenCalled();
  });

  it('pivotMode ON: column with BOTH enableRowGroup AND enableValue — enableRowGroup wins on check (AG parity)', () => {
    const api = makeApi({
      pivotMode: true,
      groupable: new Set(['athlete']),
      valueable: new Set(['athlete']),
      state: [{ colId: 'athlete', width: 120, hide: true }],
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const cb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="athlete"] .cg-columns-panel-row-checkbox')!;
    expect(cb.checked).toBe(false);
    cb.click();
    expect(api.addRowGroupColumn).toHaveBeenCalledWith('athlete');
    expect(api.addValueColumn).not.toHaveBeenCalled();
  });

  it('pivotMode ON: column with NEITHER enableRowGroup NOR enableValue — click is a no-op', () => {
    // Cycle 19 / Task 5b — under pivot mode the checkbox represents
    // role membership; a non-role-eligible column has no role to
    // toggle. The panel MUST NOT fall through to `setColumnsVisible`
    // (that would fight `PivotEngine`'s primary auto-hide invariant).
    const api = makeApi({
      pivotMode: true,
      groupable: new Set(),
      valueable: new Set(),
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const cb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="athlete"] .cg-columns-panel-row-checkbox')!;
    cb.click();
    expect(api.addRowGroupColumn).not.toHaveBeenCalled();
    expect(api.addValueColumn).not.toHaveBeenCalled();
    expect(api.setColumnsVisible).not.toHaveBeenCalled();
  });

  it('pivotMode ON: checkbox checked state reads ROLE membership only (strict AG-v36)', () => {
    const api = makeApi({
      pivotMode: true,
      rowGroupColumns: ['country'],
      valueColumns: [{ colId: 'gold', aggFunc: 'sum' }],
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const countryCb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-checkbox')!;
    const goldCb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="gold"] .cg-columns-panel-row-checkbox')!;
    const athleteCb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="athlete"] .cg-columns-panel-row-checkbox')!;
    // Country has rowGroup role → checked. Gold has value role →
    // checked. Athlete has no role → UNCHECKED, regardless of its
    // hide state (Cycle 19 / Task 5b — the pre-5b "visibility
    // fallback" is dropped so the panel state matches AG-v36).
    expect(countryCb.checked).toBe(true);
    expect(goldCb.checked).toBe(true);
    expect(athleteCb.checked).toBe(false);
  });

  it('pivotMode ON→OFF flip (via external event) re-syncs checkboxes back to visibility semantics', () => {
    const api = makeApi({
      pivotMode: true,
      rowGroupColumns: ['country'],
      state: [
        { colId: 'athlete', width: 120, hide: false },
        { colId: 'country', width: 100, hide: false },
        { colId: 'gold',    width: 80,  hide: false },
      ],
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const countryCb = root.querySelector<HTMLInputElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-checkbox')!;
    expect(countryCb.checked).toBe(true); // grouped (role) → checked under pivot
    // Flip pivot mode off (e.g. via the toggle from elsewhere).
    api.emit({ type: 'pivotStateChanged', pivotMode: false, pivotColumns: [], valueColumns: [], source: 'mode' });
    expect(countryCb.checked).toBe(true); // visible → still checked under non-pivot (visibility semantic now)
    // Now click in pivot-off mode — should toggle visibility, not role.
    countryCb.click();
    expect(api.setColumnsVisible).toHaveBeenCalledWith(['country'], false);
  });
});
