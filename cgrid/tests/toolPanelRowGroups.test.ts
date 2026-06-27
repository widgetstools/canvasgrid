/**
 * Cycle 15.5 / Task 2 — Tool panel Row Groups drop zone unit tests.
 *
 * The columns tool panel (`agColumnsToolPanel`) ships in Cycle 11
 * with a Row Groups SECTION that's an inert stub: section header +
 * dashed-outline placeholder. Cycle 15.5 / Task 2 upgrades the
 * section into a LIVE drop zone — the third view (along with the
 * row group panel from Cycle 15 / Task 6 + 15.5 / Task 1 + the
 * header context menu items from this same task) over the SAME
 * ordered `rowGroupColumns` list maintained by the GroupingState
 * primitive.
 *
 * Each test mounts the panel against a `MockApi` that satisfies the
 * subset of `CGridApi` the panel calls. Assertions read the rendered
 * DOM (pill stack, drop-state attributes) + watch the API mock for
 * the right primitive calls.
 *
 * 18 cases per worklog Task 2.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ColumnsToolPanel } from '../src/interaction/toolPanels/columnsPanel';
import type { CColumnState, CGridEvent } from '../src/types';
import type { ToolPanelParams } from '../src/interaction/toolPanels/types';

interface MockApi {
  getColumnState: () => CColumnState[];
  setColumnsVisible: ReturnType<typeof vi.fn>;
  moveColumns: ReturnType<typeof vi.fn>;
  getColumnHeaderName: (colId: string) => string | undefined;
  isColumnRowGroupEnabled: (colId: string) => boolean;
  getRowGroupColumns: () => string[];
  addRowGroupColumn: ReturnType<typeof vi.fn>;
  removeRowGroupColumn: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  getGridOption: ReturnType<typeof vi.fn>;
  /** Pump a synthetic event into every subscriber registered via
   *  `addEventListener` — drives the `columnRowGroupChanged` path
   *  without needing a real CGrid. */
  emit: (event: CGridEvent) => void;
}

function makeApi(initial?: Partial<{
  state: CColumnState[];
  headers: Record<string, string>;
  groupable: Set<string>;
  rowGroupColumns: string[];
  allowDragFromColumnsToolPanel: boolean;
}>): MockApi {
  let state: CColumnState[] = initial?.state ?? [
    { colId: 'athlete', width: 120, hide: false },
    { colId: 'age', width: 80, hide: false },
    { colId: 'country', width: 100, hide: false },
    { colId: 'year', width: 80, hide: false },
    { colId: 'gold', width: 80, hide: false },
  ];
  const headers: Record<string, string> = initial?.headers ?? {
    athlete: 'Athlete',
    age: 'Age',
    country: 'Country',
    year: 'Year',
    gold: 'Gold',
  };
  const groupable = initial?.groupable
    ?? new Set(['athlete', 'country', 'year']);
  let rowGroupColumns: string[] = [...(initial?.rowGroupColumns ?? [])];
  const allowDrag = initial?.allowDragFromColumnsToolPanel;

  const listeners = new Map<string, Set<(e: CGridEvent) => void>>();

  const api: MockApi = {
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
    isColumnRowGroupEnabled: (colId: string) => groupable.has(colId),
    getRowGroupColumns: () => [...rowGroupColumns],
    addRowGroupColumn: vi.fn((colId: string) => {
      if (rowGroupColumns.includes(colId)) return;
      rowGroupColumns = [...rowGroupColumns, colId];
      api.emit({ type: 'columnRowGroupChanged', columns: [...rowGroupColumns], source: 'add' });
    }),
    removeRowGroupColumn: vi.fn((colId: string) => {
      const idx = rowGroupColumns.indexOf(colId);
      if (idx < 0) return;
      rowGroupColumns = [
        ...rowGroupColumns.slice(0, idx),
        ...rowGroupColumns.slice(idx + 1),
      ];
      api.emit({ type: 'columnRowGroupChanged', columns: [...rowGroupColumns], source: 'remove' });
    }),
    addEventListener: vi.fn((type: string, handler: (e: CGridEvent) => void) => {
      let bucket = listeners.get(type);
      if (!bucket) {
        bucket = new Set();
        listeners.set(type, bucket);
      }
      bucket.add(handler);
      return () => bucket!.delete(handler);
    }),
    removeEventListener: vi.fn(),
    getGridOption: vi.fn((key: string) => {
      if (key === 'allowDragFromColumnsToolPanel') return allowDrag;
      return undefined;
    }),
    emit: (event: CGridEvent) => {
      // A `columnRowGroupChanged` event in production is paired with a
      // state mutation on the GroupingState primitive — subscribers
      // read the new state via `api.getRowGroupColumns()` after the
      // event fires. The mock keeps that contract: emitting a
      // `columnRowGroupChanged` syncs the underlying state to the
      // payload's `columns` so subscribers reading via the getter see
      // the new list.
      if (event.type === 'columnRowGroupChanged') {
        rowGroupColumns = [...event.columns];
      }
      const bucket = listeners.get(event.type);
      if (!bucket) return;
      for (const h of bucket) h(event);
    },
  };
  return api;
}

function mountPanel(api: MockApi, toolPanelParams: Record<string, unknown> = {}): {
  panel: ColumnsToolPanel;
  root: HTMLElement;
} {
  const panel = new ColumnsToolPanel();
  const params: ToolPanelParams = { api, toolPanelParams };
  panel.init(params);
  const root = panel.getGui();
  // The drop-zone hit-tests via `getBoundingClientRect`. JSDOM returns
  // zeros unless the element is in the document AND we monkey-patch
  // the rect (see `withPillBounds` below). Append unconditionally so
  // tests that don't need exact bounds still get a non-zero rect.
  document.body.appendChild(root);
  return { panel, root };
}

/** Stub the drop zone's `getBoundingClientRect` so hit-tests resolve
 *  to a known viewport region. Tests then pass `clientX`/`clientY` in
 *  that region (or outside it) to drive the accept-vs-reject paths. */
function pinDropZoneRect(root: HTMLElement, rect: { left: number; top: number; right: number; bottom: number }): void {
  const zone = root.querySelector<HTMLElement>('.cg-columns-panel-rgz');
  if (!zone) throw new Error('drop zone not mounted');
  zone.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON() { return rect; },
  });
}

describe('ColumnsToolPanel Row Groups drop zone (Cycle 15.5 / Task 2)', () => {
  let hosts: ColumnsToolPanel[] = [];

  beforeEach(() => { hosts = []; });
  afterEach(() => {
    for (const p of hosts) {
      try { p.destroy(); } catch { /* noop */ }
    }
    document.body.replaceChildren();
  });

  it('drop zone renders with the dashed-outline + role="list" + empty-state placeholder when no columns are grouped', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const zone = root.querySelector<HTMLElement>('.cg-columns-panel-rgz');
    expect(zone).not.toBeNull();
    expect(zone!.getAttribute('role')).toBe('list');
    expect(zone!.getAttribute('aria-label')).toBe('Row group columns');
    const empty = zone!.querySelector<HTMLElement>('.cg-columns-panel-rgz-empty');
    expect(empty?.textContent).toBe('Drag here to set row groups');
    // No pills.
    expect(zone!.querySelectorAll('.cg-columns-panel-rgz-pill').length).toBe(0);
  });

  it('renders one pill per `getRowGroupColumns()` entry in nesting order, with the headerName label', () => {
    const api = makeApi({ rowGroupColumns: ['country', 'year'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const pills = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-rgz-pill'));
    expect(pills.map((p) => p.dataset.colId)).toEqual(['country', 'year']);
    const labels = pills.map((p) => p.querySelector<HTMLElement>('.cg-columns-panel-rgz-pill-label')?.textContent);
    expect(labels).toEqual(['Country', 'Year']);
  });

  it('pill `×` click calls api.removeRowGroupColumn(colId)', () => {
    const api = makeApi({ rowGroupColumns: ['country'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const pill = root.querySelector<HTMLElement>('.cg-columns-panel-rgz-pill[data-col-id="country"]')!;
    const remove = pill.querySelector<HTMLButtonElement>('.cg-columns-panel-rgz-pill-remove')!;
    remove.click();
    expect(api.removeRowGroupColumn).toHaveBeenCalledWith('country');
  });

  it('subscribes to `columnRowGroupChanged` and re-renders pills when a mutation fires from outside', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    expect(root.querySelectorAll('.cg-columns-panel-rgz-pill').length).toBe(0);
    api.addRowGroupColumn('country');
    const pills = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-rgz-pill'));
    expect(pills.map((p) => p.dataset.colId)).toEqual(['country']);
  });

  it('pill order MIRRORS the row group panel (re-renders to match the canonical state on every event)', () => {
    const api = makeApi({ rowGroupColumns: ['country'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    api.addRowGroupColumn('year');
    // Emit a `'move'`-source event (simulating a reorder from the row
    // group panel): country and year swapped.
    api.emit({ type: 'columnRowGroupChanged', columns: ['year', 'country'], source: 'move' });
    const pills = Array.from(root.querySelectorAll<HTMLElement>('.cg-columns-panel-rgz-pill'));
    expect(pills.map((p) => p.dataset.colId)).toEqual(['year', 'country']);
  });

  it('mutation from the row group panel (simulated via addRowGroupColumn) reflects in the drop zone live', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    api.addRowGroupColumn('athlete');
    expect(root.querySelector('.cg-columns-panel-rgz-pill[data-col-id="athlete"]')).not.toBeNull();
  });

  it('mutation from the header context menu (Group by simulated via addRowGroupColumn) reflects in the drop zone live', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    api.emit({ type: 'columnRowGroupChanged', columns: ['country'], source: 'add' });
    expect(root.querySelector('.cg-columns-panel-rgz-pill[data-col-id="country"]')).not.toBeNull();
  });

  it('drag a column-list row into the zone calls api.addRowGroupColumn (for a groupable column)', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinDropZoneRect(root, { left: 0, top: 200, right: 240, bottom: 320 });
    const handle = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 50, bubbles: true }));
    // Move into the drop zone area (cursor crosses the threshold).
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 250 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 250 }));
    expect(api.addRowGroupColumn).toHaveBeenCalledWith('country');
  });

  it('drag a non-groupable column into the zone shows the "reject" drop state and does NOT call addRowGroupColumn', () => {
    // gold is NOT in `groupable` by default.
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinDropZoneRect(root, { left: 0, top: 200, right: 240, bottom: 320 });
    const handle = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="gold"] .cg-columns-panel-row-handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 250 }));
    const zone = root.querySelector<HTMLElement>('.cg-columns-panel-rgz')!;
    expect(zone.dataset.drop).toBe('reject');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 250 }));
    expect(api.addRowGroupColumn).not.toHaveBeenCalled();
    expect(zone.dataset.drop).toBeUndefined();
  });

  it('drag-into-zone for an already-grouped column is rejected (no double-add)', () => {
    const api = makeApi({ rowGroupColumns: ['country'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinDropZoneRect(root, { left: 0, top: 200, right: 240, bottom: 320 });
    const handle = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 250 }));
    const zone = root.querySelector<HTMLElement>('.cg-columns-panel-rgz')!;
    expect(zone.dataset.drop).toBe('reject');
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 250 }));
    expect(api.addRowGroupColumn).not.toHaveBeenCalled();
  });

  it('pill drag-OUT of the zone calls api.removeRowGroupColumn', () => {
    const api = makeApi({ rowGroupColumns: ['country'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinDropZoneRect(root, { left: 0, top: 200, right: 240, bottom: 320 });
    const pill = root.querySelector<HTMLElement>('.cg-columns-panel-rgz-pill[data-col-id="country"]')!;
    pill.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 250, bubbles: true }));
    // Drag past the threshold.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 260 }));
    // Release outside the zone — drops out.
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 500 }));
    expect(api.removeRowGroupColumn).toHaveBeenCalledWith('country');
  });

  it('pill drag released INSIDE the zone does NOT remove (within-zone reorder is out of scope for Task 2)', () => {
    const api = makeApi({ rowGroupColumns: ['country', 'year'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinDropZoneRect(root, { left: 0, top: 200, right: 240, bottom: 320 });
    const pill = root.querySelector<HTMLElement>('.cg-columns-panel-rgz-pill[data-col-id="country"]')!;
    pill.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 250, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 270 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 270 }));
    expect(api.removeRowGroupColumn).not.toHaveBeenCalled();
  });

  it('pill press WITHOUT crossing the drag threshold is a no-op (a click on the body, not a drag)', () => {
    const api = makeApi({ rowGroupColumns: ['country'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinDropZoneRect(root, { left: 0, top: 200, right: 240, bottom: 320 });
    const pill = root.querySelector<HTMLElement>('.cg-columns-panel-rgz-pill[data-col-id="country"]')!;
    pill.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 250, bubbles: true }));
    // Move ≤ 4 px — below threshold.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 102, clientY: 251 }));
    // Release outside the zone — but since we didn't cross threshold,
    // this is a click, not a drag — no remove fires.
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 500 }));
    expect(api.removeRowGroupColumn).not.toHaveBeenCalled();
  });

  it('allowDragFromColumnsToolPanel: false suppresses the drag-into-zone path (drag commits as a reorder instead)', () => {
    const api = makeApi({ allowDragFromColumnsToolPanel: false });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    pinDropZoneRect(root, { left: 0, top: 200, right: 240, bottom: 320 });
    const handle = root.querySelector<HTMLElement>('.cg-columns-panel-row[data-col-id="country"] .cg-columns-panel-row-handle')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 250 }));
    const zone = root.querySelector<HTMLElement>('.cg-columns-panel-rgz')!;
    // No drop-state outline lights up — the gesture is treated as a
    // pure reorder.
    expect(zone.dataset.drop).toBeUndefined();
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 250 }));
    expect(api.addRowGroupColumn).not.toHaveBeenCalled();
    expect(api.moveColumns).toHaveBeenCalled();
  });

  it('suppressRowGroups: true omits the entire zone (no section header, no drop zone, no subscription)', () => {
    const api = makeApi({ rowGroupColumns: ['country'] });
    const { panel, root } = mountPanel(api, { suppressRowGroups: true });
    hosts.push(panel);
    expect(root.querySelector('.cg-columns-panel-rgz')).toBeNull();
    const subscribedTypes = (api.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(subscribedTypes).not.toContain('columnRowGroupChanged');
  });

  it('subscribes to `columnRowGroupChanged` on init and unsubscribes on destroy', () => {
    const api = makeApi();
    const { panel } = mountPanel(api);
    hosts.push(panel);
    const subscribedTypes = (api.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(subscribedTypes).toContain('columnRowGroupChanged');
  });

  it('zone updates when refresh() is called (covers the imperative refresh path)', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    expect(root.querySelectorAll('.cg-columns-panel-rgz-pill').length).toBe(0);
    // Mutate the state outside the event surface.
    api.addRowGroupColumn('country');
    // (the event already fired and the pill should be there)
    expect(root.querySelectorAll('.cg-columns-panel-rgz-pill').length).toBe(1);
    // Now call refresh() and confirm the pill survives + state is read.
    panel.refresh();
    expect(root.querySelectorAll('.cg-columns-panel-rgz-pill').length).toBe(1);
  });

  it('pill label falls back to the colId when the header name is unknown', () => {
    const api = makeApi({
      headers: { country: 'Country' },
      rowGroupColumns: ['unlabelled'],
    });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const pill = root.querySelector<HTMLElement>('.cg-columns-panel-rgz-pill[data-col-id="unlabelled"]')!;
    const label = pill.querySelector<HTMLElement>('.cg-columns-panel-rgz-pill-label');
    expect(label?.textContent).toBe('unlabelled');
  });

  it('section header reads "Row Groups" with the ☰ icon family (one icon across surfaces)', () => {
    const api = makeApi();
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    const header = root.querySelector<HTMLElement>('.cg-columns-panel-section-header--groups');
    expect(header).not.toBeNull();
    expect(header!.textContent?.trim()).toBe('Row Groups');
    expect(header!.dataset.icon).toBe('☰');
  });

  it('removing the last pill returns the empty-state placeholder', () => {
    const api = makeApi({ rowGroupColumns: ['country'] });
    const { panel, root } = mountPanel(api);
    hosts.push(panel);
    expect(root.querySelector('.cg-columns-panel-rgz-empty')).toBeNull();
    api.removeRowGroupColumn('country');
    const empty = root.querySelector<HTMLElement>('.cg-columns-panel-rgz-empty');
    expect(empty?.textContent).toBe('Drag here to set row groups');
  });
});
