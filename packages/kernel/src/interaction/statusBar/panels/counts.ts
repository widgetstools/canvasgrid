/**
 * Cycle 13 / Task 2 — built-in count status panels.
 *
 * Four panels mirroring ag-grid's count-component family:
 *
 *   - `AgTotalRowCountPanel`           → `Total Rows: 3,000`
 *   - `AgFilteredRowCountPanel`        → `Rows: 1,234`
 *   - `AgSelectedRowCountPanel`        → `Selected: 23`
 *   - `AgTotalAndFilteredRowCountPanel`→ `Total Rows: 3,000  Rows: 1,234`
 *
 * Each panel implements `IStatusPanelComp` (init / getGui / refresh /
 * destroy) and subscribes to its trigger grid events in `init()`. Per
 * the design notes (`cycle-13-statusbar-design.md` § Task 2):
 *
 *   - Hierarchy is carried by COLOUR, never weight. Label uses
 *     `--cg-status-bar-fg-muted` (60% alpha), value uses
 *     `--cg-status-bar-fg`. Mono at 13px can't carry weight.
 *   - `Intl.NumberFormat('en-US')` is the default value formatter;
 *     `statusPanelParams.numberFormatter` is the per-panel escape
 *     hatch (custom locale, accountancy format, etc.).
 *   - `Selected: 0` is shown for an empty selection — the panel
 *     never collapses (zero-flicker target).
 *
 * The host's frame-batched refresh dispatcher lands in Task 5; until
 * then each panel re-renders synchronously off its own subscription.
 * Inside `refresh()` the panels do nothing that triggers a body-canvas
 * repaint (the perf gate in the worklog Architecture section is "the
 * status bar updates must NOT call cgridCanvas.requestRepaint"),
 * which holds because the only mutation is `textContent` on a span.
 */
import type { CGridEvent } from '../../../types';
import type { IStatusPanelComp, StatusPanelParams } from '../types';

/** The subset of `CGridApi` the count panels touch. Typed inline
 *  rather than importing `CGridApi` to avoid forming a circular dep
 *  through `cgrid.ts` (status-bar host is referenced by `cgrid.ts`,
 *  which exports the api). Apps that pass a partial api in a test
 *  harness need only stub these four methods. */
interface CountPanelApi {
  getTotalRowCount(): number;
  getDisplayedRowCount(): number;
  getSelectedRowIds(): string[];
  addEventListener<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): () => void;
}

/** Per-panel value formatter. Receives a count, returns the display
 *  string. The default uses `Intl.NumberFormat('en-US')` so 3000 →
 *  `"3,000"` (matches the screenshot reference + the trader-audience
 *  expectation). Apps swap in a custom formatter via
 *  `statusPanelParams.numberFormatter`. */
export type CountValueFormatter = (count: number) => string;

const enUsFormatter = new Intl.NumberFormat('en-US');
const defaultNumberFormatter: CountValueFormatter = (n) => enUsFormatter.format(n);

/** Resolve the formatter for one panel. Falls back to the en-US
 *  default when `statusPanelParams.numberFormatter` is absent or
 *  isn't a function (defensive — the params bag is `Record<string,
 *  unknown>` so an arbitrary cast could land anything in there). */
function resolveFormatter(params: StatusPanelParams): CountValueFormatter {
  const fn = params.statusPanelParams?.numberFormatter;
  return typeof fn === 'function' ? (fn as CountValueFormatter) : defaultNumberFormatter;
}

/** Build one `<label>: <value>` pair using the design vocabulary
 *  declared in Task 2. Returns the wrapper element AND a setter so
 *  the panel can update the value without a re-query. The wrapper is
 *  re-used both as the root of a single-fact panel AND as the
 *  `.cg-status-panel-count-pair` inside the combined panel — see the
 *  `pair` flag. */
function buildLabelValue(
  label: string,
  asPair: boolean,
): { root: HTMLElement; setValue: (text: string) => void } {
  const root = document.createElement('span');
  root.className = asPair ? 'cg-status-panel-count-pair' : 'cg-status-panel-count';
  const labelEl = document.createElement('span');
  labelEl.className = 'cg-status-panel-count-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'cg-status-panel-count-value';
  root.append(labelEl, valueEl);
  return { root, setValue: (text) => { valueEl.textContent = text; } };
}

/** Shared base for the three single-fact count panels. Owns the
 *  DOM, the formatter resolution, and the unsubscribe bookkeeping;
 *  subclasses provide their own label string, value accessor, and
 *  the trigger-event list. */
abstract class SingleFactCountPanel implements IStatusPanelComp {
  protected api: CountPanelApi | null = null;
  protected formatter: CountValueFormatter = defaultNumberFormatter;
  private readonly gui: HTMLElement;
  private readonly setValue: (text: string) => void;
  private unsubscribers: Array<() => void> = [];

  constructor(label: string) {
    const { root, setValue } = buildLabelValue(label, /* asPair= */ false);
    this.gui = root;
    this.setValue = setValue;
  }

  init(params: StatusPanelParams): void {
    this.api = params.api as CountPanelApi;
    this.formatter = resolveFormatter(params);
    this.subscribe(this.api);
    this.refresh();
  }

  getGui(): HTMLElement { return this.gui; }

  refresh(): void {
    if (!this.api) return;
    this.setValue(this.formatter(this.readValue(this.api)));
  }

  destroy(): void {
    for (const off of this.unsubscribers) {
      try { off(); } catch (e) { console.error(e); }
    }
    this.unsubscribers = [];
    this.api = null;
  }

  /** Subclass hook — pull the count this panel renders. Called once
   *  per `refresh()`. */
  protected abstract readValue(api: CountPanelApi): number;
  /** Subclass hook — register grid-event listeners. Each listener must
   *  call `track(off)` so the off-fn lands in the destroy chain. */
  protected abstract subscribe(api: CountPanelApi): void;

  /** Capture an unsubscribe handle returned by `api.addEventListener`
   *  so `destroy()` releases it. */
  protected track(off: () => void): void {
    this.unsubscribers.push(off);
  }
}

/** `agTotalRowCountComponent` — total pre-filter row count. */
export class AgTotalRowCountPanel extends SingleFactCountPanel {
  constructor() { super('Total Rows:'); }
  protected readValue(api: CountPanelApi): number {
    return api.getTotalRowCount();
  }
  protected subscribe(api: CountPanelApi): void {
    // `modelUpdated` is the only event that signals a change to the
    // raw row inventory in Cycle 13 (it fires after setRowData +
    // applyTransaction land in the worker). filterChanged is NOT
    // tracked here — total is invariant under filter.
    this.track(api.addEventListener('modelUpdated', () => this.refresh()));
  }
}

/** `agFilteredRowCountComponent` — count of rows passing the active
 *  filter (== `getDisplayedRowCount()`). When no filter is set, this
 *  equals the total. */
export class AgFilteredRowCountPanel extends SingleFactCountPanel {
  constructor() { super('Rows:'); }
  protected readValue(api: CountPanelApi): number {
    return api.getDisplayedRowCount();
  }
  protected subscribe(api: CountPanelApi): void {
    // Both events can change the displayed count: filterChanged after
    // a filter mutation, modelUpdated after setRowData / transactions.
    this.track(api.addEventListener('modelUpdated', () => this.refresh()));
    this.track(api.addEventListener('filterChanged', () => this.refresh()));
  }
}

/** `agSelectedRowCountComponent` — count of currently selected rows.
 *  Always renders `Selected: N`, including `Selected: 0` for an empty
 *  selection (zero-flicker — see design notes Task 2 decision 6). */
export class AgSelectedRowCountPanel extends SingleFactCountPanel {
  constructor() { super('Selected:'); }
  protected readValue(api: CountPanelApi): number {
    return api.getSelectedRowIds().length;
  }
  protected subscribe(api: CountPanelApi): void {
    this.track(api.addEventListener('selectionChanged', () => this.refresh()));
  }
}

/** `agTotalAndFilteredRowCountComponent` — two label-value pairs in
 *  one panel, joined by a 2ch flex gap (NOT a typographic separator —
 *  see design notes decision 4). When no filter is active the pairs
 *  display the same number, which is the expected ag-grid behaviour. */
export class AgTotalAndFilteredRowCountPanel implements IStatusPanelComp {
  private api: CountPanelApi | null = null;
  private formatter: CountValueFormatter = defaultNumberFormatter;
  private readonly gui: HTMLElement;
  private readonly setTotal: (text: string) => void;
  private readonly setFiltered: (text: string) => void;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    this.gui = document.createElement('span');
    this.gui.className = 'cg-status-panel-count cg-status-panel-count--combined';
    const total = buildLabelValue('Total Rows:', /* asPair= */ true);
    const filtered = buildLabelValue('Rows:', /* asPair= */ true);
    this.gui.append(total.root, filtered.root);
    this.setTotal = total.setValue;
    this.setFiltered = filtered.setValue;
  }

  init(params: StatusPanelParams): void {
    this.api = params.api as CountPanelApi;
    this.formatter = resolveFormatter(params);
    this.unsubscribers.push(
      this.api.addEventListener('modelUpdated', () => this.refresh()),
      this.api.addEventListener('filterChanged', () => this.refresh()),
    );
    this.refresh();
  }

  getGui(): HTMLElement { return this.gui; }

  refresh(): void {
    if (!this.api) return;
    this.setTotal(this.formatter(this.api.getTotalRowCount()));
    this.setFiltered(this.formatter(this.api.getDisplayedRowCount()));
  }

  destroy(): void {
    for (const off of this.unsubscribers) {
      try { off(); } catch (e) { console.error(e); }
    }
    this.unsubscribers = [];
    this.api = null;
  }
}

/** Map from the canonical built-in key (the strings registered in
 *  `BUILT_IN_STATUS_PANEL_KEYS`) to the count-panel ctor. The
 *  registry pulls from this map in `seedBuiltIns()` so the stub
 *  implementation lands only when no real impl is registered (i.e.
 *  the aggregation key, which Task 3 fills in). */
export const COUNT_PANEL_CONSTRUCTORS = {
  agTotalRowCountComponent: AgTotalRowCountPanel,
  agFilteredRowCountComponent: AgFilteredRowCountPanel,
  agSelectedRowCountComponent: AgSelectedRowCountPanel,
  agTotalAndFilteredRowCountComponent: AgTotalAndFilteredRowCountPanel,
} as const;
