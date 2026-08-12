/**
 * Cycle 13 / Task 2 — built-in count status panel tests.
 *
 * Four panels live in `cgrid/src/interaction/statusBar/panels/counts.ts`:
 *   - `AgTotalRowCountPanel`            (`Total Rows: N`)
 *   - `AgFilteredRowCountPanel`         (`Rows: N`)
 *   - `AgSelectedRowCountPanel`         (`Selected: N`, never collapses)
 *   - `AgTotalAndFilteredRowCountPanel` (`Total Rows: T  Rows: F`)
 *
 * Each panel subscribes to its trigger events in `init()` and
 * re-renders synchronously on every fire. Task 5 will wrap these
 * subscriptions in an rAF-batched dispatcher; for Task 2 the
 * synchronous shape is the test surface.
 *
 * The fake api here is a minimal `CountPanelApi` plus a typed
 * event-bus mock. It does NOT use the real `VelocityGridApi` because (a)
 * standing up a full VelocityGrid in a unit test is wasteful, and (b) the
 * panels intentionally read only a four-method subset — the test
 * proves that subset is the contract.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgFilteredRowCountPanel,
  AgSelectedRowCountPanel,
  AgTotalAndFilteredRowCountPanel,
  AgTotalRowCountPanel,
  COUNT_PANEL_CONSTRUCTORS,
} from '../src/interaction/statusBar/panels/counts';
import { StatusBarHost } from '../src/interaction/statusBar/host';
import { StatusPanelRegistry, BUILT_IN_STATUS_PANEL_KEYS } from '../src/interaction/statusBar/registry';
import type { StatusBarPosition } from '../src/interaction/statusBar/types';
import type { VelocityGridEvent } from '../src/types';

type EventType = VelocityGridEvent['type'];
type AnyHandler = (event: VelocityGridEvent) => void;

/** Minimal VelocityGridApi mock that captures listener registrations so the
 *  test can fire events synchronously + assert the unsubscribe path
 *  releases them. Implements only the four methods the count panels
 *  touch — exactly the `CountPanelApi` slice. */
class FakeApi {
  totalRows = 0;
  displayedRows = 0;
  selectedRowIds: string[] = [];
  private listeners: Map<EventType, Set<AnyHandler>> = new Map();

  getTotalRowCount(): number { return this.totalRows; }
  getDisplayedRowCount(): number { return this.displayedRows; }
  getSelectedRowIds(): string[] { return this.selectedRowIds.slice(); }

  addEventListener<K extends EventType>(
    type: K,
    handler: (event: Extract<VelocityGridEvent, { type: K }>) => void,
  ): () => void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(handler as AnyHandler);
    return () => {
      this.listeners.get(type)?.delete(handler as AnyHandler);
    };
  }

  emit(event: VelocityGridEvent): void {
    const bucket = this.listeners.get(event.type);
    if (!bucket) return;
    for (const h of Array.from(bucket)) h(event);
  }

  listenerCount(type: EventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function getLabels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.vg-status-panel-count-label'))
    .map((el) => el.textContent ?? '');
}
function getValues(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.vg-status-panel-count-value'))
    .map((el) => el.textContent ?? '');
}

describe('built-in count status panels', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = new FakeApi();
  });

  it('AgTotalRowCountPanel: init renders "Total Rows: <N>" with the design vocabulary classes', () => {
    api.totalRows = 3000;
    const panel = new AgTotalRowCountPanel();
    panel.init({ api });
    const gui = panel.getGui();
    expect(gui.className).toBe('vg-status-panel-count');
    expect(getLabels(gui)).toEqual(['Total Rows:']);
    expect(getValues(gui)).toEqual(['3,000']);
    panel.destroy();
  });

  it('AgTotalRowCountPanel: refreshes after a modelUpdated event', () => {
    api.totalRows = 100;
    const panel = new AgTotalRowCountPanel();
    panel.init({ api });
    expect(getValues(panel.getGui())[0]).toBe('100');
    api.totalRows = 250;
    api.emit({ type: 'modelUpdated', visibleRowCount: 250 });
    expect(getValues(panel.getGui())[0]).toBe('250');
    panel.destroy();
  });

  it('AgFilteredRowCountPanel: init renders "Rows: <N>" with displayed-row count', () => {
    api.displayedRows = 1234;
    const panel = new AgFilteredRowCountPanel();
    panel.init({ api });
    const gui = panel.getGui();
    expect(getLabels(gui)).toEqual(['Rows:']);
    expect(getValues(gui)).toEqual(['1,234']);
    panel.destroy();
  });

  it('AgFilteredRowCountPanel: refreshes after both filterChanged and modelUpdated events', () => {
    api.displayedRows = 100;
    const panel = new AgFilteredRowCountPanel();
    panel.init({ api });
    expect(getValues(panel.getGui())[0]).toBe('100');
    // filterChanged tick — typical for a per-column filter mutation.
    api.displayedRows = 42;
    api.emit({ type: 'filterChanged', filterModel: {} });
    expect(getValues(panel.getGui())[0]).toBe('42');
    // modelUpdated tick — typical for a setRowData / transaction.
    api.displayedRows = 500;
    api.emit({ type: 'modelUpdated', visibleRowCount: 500 });
    expect(getValues(panel.getGui())[0]).toBe('500');
    panel.destroy();
  });

  it('AgSelectedRowCountPanel: init renders "Selected: 0" for an empty selection (no collapse)', () => {
    const panel = new AgSelectedRowCountPanel();
    panel.init({ api });
    const gui = panel.getGui();
    expect(getLabels(gui)).toEqual(['Selected:']);
    expect(getValues(gui)).toEqual(['0']);
    expect(gui.isConnected).toBe(false); // not appended yet, but visible-by-default
    // Confirm zero-flicker contract — the panel root exists even when
    // the count is zero.
    expect(gui.children.length).toBe(2);
    panel.destroy();
  });

  it('AgSelectedRowCountPanel: refreshes after a selectionChanged event', () => {
    const panel = new AgSelectedRowCountPanel();
    panel.init({ api });
    expect(getValues(panel.getGui())[0]).toBe('0');
    api.selectedRowIds = ['row-1', 'row-2', 'row-3'];
    api.emit({ type: 'selectionChanged', selectedRowIds: api.selectedRowIds });
    expect(getValues(panel.getGui())[0]).toBe('3');
    // Clearing the selection re-renders 0 — never disappears.
    api.selectedRowIds = [];
    api.emit({ type: 'selectionChanged', selectedRowIds: [] });
    expect(getValues(panel.getGui())[0]).toBe('0');
    panel.destroy();
  });

  it('AgTotalAndFilteredRowCountPanel: renders both label-value pairs with the combined modifier', () => {
    api.totalRows = 3000;
    api.displayedRows = 1234;
    const panel = new AgTotalAndFilteredRowCountPanel();
    panel.init({ api });
    const gui = panel.getGui();
    expect(gui.classList.contains('vg-status-panel-count')).toBe(true);
    expect(gui.classList.contains('vg-status-panel-count--combined')).toBe(true);
    // Two .vg-status-panel-count-pair wrappers.
    const pairs = gui.querySelectorAll('.vg-status-panel-count-pair');
    expect(pairs.length).toBe(2);
    expect(getLabels(gui)).toEqual(['Total Rows:', 'Rows:']);
    expect(getValues(gui)).toEqual(['3,000', '1,234']);
    panel.destroy();
  });

  it('AgTotalAndFilteredRowCountPanel: refreshes both values on filterChanged / modelUpdated', () => {
    api.totalRows = 100;
    api.displayedRows = 100;
    const panel = new AgTotalAndFilteredRowCountPanel();
    panel.init({ api });
    expect(getValues(panel.getGui())).toEqual(['100', '100']);
    // A filter lands — total stays, displayed drops.
    api.displayedRows = 27;
    api.emit({ type: 'filterChanged', filterModel: {} });
    expect(getValues(panel.getGui())).toEqual(['100', '27']);
    // A transaction lands — both can move.
    api.totalRows = 150;
    api.displayedRows = 40;
    api.emit({ type: 'modelUpdated', visibleRowCount: 40 });
    expect(getValues(panel.getGui())).toEqual(['150', '40']);
    panel.destroy();
  });

  it('default value formatter uses en-US grouping (3000 → "3,000", 1234567 → "1,234,567")', () => {
    api.totalRows = 1_234_567;
    const panel = new AgTotalRowCountPanel();
    panel.init({ api });
    expect(getValues(panel.getGui())[0]).toBe('1,234,567');
    panel.destroy();
  });

  it('statusPanelParams.numberFormatter overrides the default formatter', () => {
    api.displayedRows = 1234;
    const panel = new AgFilteredRowCountPanel();
    // Accountancy-style formatter — wraps in parens for negative,
    // K-suffix for thousands. The point is just "any function the
    // caller hands in is used verbatim".
    const fancyFormatter = (n: number): string => `${(n / 1000).toFixed(1)}K`;
    panel.init({ api, statusPanelParams: { numberFormatter: fancyFormatter } });
    expect(getValues(panel.getGui())[0]).toBe('1.2K');
    api.displayedRows = 5_678;
    api.emit({ type: 'filterChanged', filterModel: {} });
    expect(getValues(panel.getGui())[0]).toBe('5.7K');
    panel.destroy();
  });

  it('destroy unsubscribes every listener — events after destroy do NOT re-render the gui', () => {
    api.displayedRows = 10;
    const panel = new AgTotalAndFilteredRowCountPanel();
    panel.init({ api });
    // init wires `modelUpdated` + `filterChanged` — confirm BEFORE
    // destroy then assert both empty AFTER.
    expect(api.listenerCount('modelUpdated')).toBe(1);
    expect(api.listenerCount('filterChanged')).toBe(1);
    panel.destroy();
    expect(api.listenerCount('modelUpdated')).toBe(0);
    expect(api.listenerCount('filterChanged')).toBe(0);
    // Firing the events post-destroy must be safe + must NOT touch
    // the panel's gui. Capture the pre-destroy values; assert they
    // stay frozen.
    const valuesBefore = getValues(panel.getGui());
    api.totalRows = 99999;
    api.displayedRows = 99999;
    api.emit({ type: 'modelUpdated', visibleRowCount: 99999 });
    expect(getValues(panel.getGui())).toEqual(valuesBefore);
  });

  it('StatusBarHost mounts the count panels under the canonical built-in keys', () => {
    // Confirms the registry → host wiring: pass the four canonical
    // keys via `statusPanels`, expect the host to resolve each one to
    // its real ctor (not the stub), and expect each rendered root to
    // carry `.vg-status-panel-count`. This is the contract the demo +
    // visual cell 15 rely on.
    const registry = new StatusPanelRegistry();
    registry.seedBuiltIns();
    // Sanity check — every built-in key is registered (count keys
    // resolve to the real ctors, agg key resolves to the stub).
    for (const key of BUILT_IN_STATUS_PANEL_KEYS) {
      expect(registry.resolve(key)).not.toBeNull();
    }
    const reserveCalls: Array<{ side: StatusBarPosition; height: number }> = [];
    const root = document.createElement('div');
    Object.assign(root.style, { width: '800px', height: '600px', position: 'relative' });
    document.body.appendChild(root);
    const host = new StatusBarHost(root, {
      registry,
      api,
      setReservedSpace: (side, height) => reserveCalls.push({ side, height }),
    }, {
      statusPanels: [
        { key: 'agTotalRowCountComponent', statusPanel: 'agTotalRowCountComponent' },
        { key: 'agFilteredRowCountComponent', statusPanel: 'agFilteredRowCountComponent' },
        { key: 'agSelectedRowCountComponent', statusPanel: 'agSelectedRowCountComponent' },
        { key: 'agTotalAndFilteredRowCountComponent', statusPanel: 'agTotalAndFilteredRowCountComponent' },
      ],
    });
    const rightZone = root.querySelector('.vg-status-bar-zone--right') as HTMLElement;
    expect(rightZone.children.length).toBe(4);
    const panelRoots = rightZone.querySelectorAll('.vg-status-panel-count');
    expect(panelRoots.length).toBe(4);
    // Combined panel carries the modifier.
    const combinedRoots = rightZone.querySelectorAll('.vg-status-panel-count--combined');
    expect(combinedRoots.length).toBe(1);
    host.destroy();
    root.parentElement?.removeChild(root);
  });

  it('COUNT_PANEL_CONSTRUCTORS exports a stable map keyed by every count component string', () => {
    // Stable contract for Task 4 (custom panel API) + future cycles
    // that may want to compose the built-ins. The four keys here are
    // the strings registered as built-ins (excluding agAggregation,
    // which lands in Task 3).
    expect(Object.keys(COUNT_PANEL_CONSTRUCTORS).sort()).toEqual([
      'agFilteredRowCountComponent',
      'agSelectedRowCountComponent',
      'agTotalAndFilteredRowCountComponent',
      'agTotalRowCountComponent',
    ]);
    expect(COUNT_PANEL_CONSTRUCTORS.agTotalRowCountComponent).toBe(AgTotalRowCountPanel);
    expect(COUNT_PANEL_CONSTRUCTORS.agFilteredRowCountComponent).toBe(AgFilteredRowCountPanel);
    expect(COUNT_PANEL_CONSTRUCTORS.agSelectedRowCountComponent).toBe(AgSelectedRowCountPanel);
    expect(COUNT_PANEL_CONSTRUCTORS.agTotalAndFilteredRowCountComponent).toBe(AgTotalAndFilteredRowCountPanel);
  });
});
