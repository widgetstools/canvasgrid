/**
 * Cycle 13 / Task 3 — `agAggregationComponent`.
 *
 * A single status panel that summarises the active selection inline:
 * `Count: 23 · Sum: 1,234 · Min: 12 · Max: 89 · Avg: 54`. The five stats
 * are pure functions of the selected cell values (see `../aggMath.ts`);
 * this file owns the DOM, the event subscriptions, and the render
 * vocabulary declared in the design notes for Task 3.
 *
 * Two source-of-truth references:
 *
 * - `docs/superpowers/plans/notes/cycle-13-statusbar-design.md` § Task 3
 *   — the design decisions that drive every rendering choice (empty-
 *   state contract, canonical stat order, em-dash for N/A, no chrome).
 * - `docs/catalog/18-status-bar.md` § `IAggregationStatusPanelParams` —
 *   the public params surface (`aggFuncs`, `valueFormatter`).
 *
 * Render path:
 *
 *   refresh() → readSelectedValues() → aggregate() → renderStats()
 *
 * Each step is independently testable; the unit suite drives each in
 * isolation. Inside `refresh()` the panel performs zero canvas-side
 * work (the perf gate "status updates MUST NOT trigger
 * cgridCanvas.requestRepaint" holds because the only mutation is
 * `textContent` on a few spans + a `hidden` flag toggle on the root).
 */
import type { VelocityGridEvent, SelectionRange } from '../../../types';
import { aggregate, CANONICAL_AGG_ORDER, type AggFunc, type AggregateResult } from '../aggMath';
import type { IStatusPanelComp, StatusPanelParams } from '../types';

/** Default fraction digits for `Intl.NumberFormat` on Sum / Min / Max /
 *  Avg. Differs from the count panel's "0 fraction digits" because the
 *  agg panel typically aggregates price / P&L columns where truncation
 *  to integer would be a wrong number. `Count` is always integer; the
 *  formatter for `count` is a separate Intl instance with 0 fraction
 *  digits to avoid `Count: 23.00`. */
const DEFAULT_DECIMAL_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});
const COUNT_FORMATTER = new Intl.NumberFormat('en-US');

/** Em-dash U+2014. Rendered for any stat whose aggregate result is NaN —
 *  i.e. the numeric aggregates over a selection that contains no finite
 *  numeric values (design notes decision 5). Count is always defined so
 *  the em-dash never appears for it. */
const EM_DASH = '—';

/** Middle-dot U+00B7. Inter-stat separator declared by Task 1 +
 *  reserved by Task 2 for the agg family specifically. */
const MIDDLE_DOT = '·';

/** Human-readable label per func. Sentence case + colon — matches the
 *  count panels' `Label:` vocabulary verbatim (design decision 1). */
const FUNC_LABELS: Record<AggFunc, string> = {
  count: 'Count:',
  sum: 'Sum:',
  min: 'Min:',
  max: 'Max:',
  avg: 'Avg:',
};

/** The public params shape — kept here next to the implementation rather
 *  than at `src/types.ts` so consumers import it from the same module
 *  that owns the behaviour. `src/types.ts` re-exports it for the public
 *  API surface (see the bottom of this file). */
export interface IAggregationStatusPanelParams {
  /** Subset of agg funcs to render. When absent, every func in
   *  `CANONICAL_AGG_ORDER` renders. Order in this array is ignored — the
   *  panel renders in canonical order regardless (decision 3). */
  aggFuncs?: AggFunc[];
  /** Custom formatter for the numeric values. Receives the aggregated
   *  number AND the func that produced it, so an app can format `count`
   *  differently from `sum` (e.g. "23 rows" vs "$1,234.56"). Returns
   *  the display string. The em-dash placeholder for NaN is handled
   *  upstream — the formatter is never called with NaN. */
  valueFormatter?: (params: { value: number; func: AggFunc }) => string;
}

/** The subset of `VelocityGridApi` this panel touches. Typed inline (same
 *  pattern as `panels/counts.ts`) to avoid a circular dep through
 *  `velocityGrid.ts` and to make the test-side fake api narrower. */
interface AggPanelApi {
  getCellRanges(): SelectionRange[];
  getSelectedRowIds(): string[];
  /** Raw cell value from the current viewport chunk. May return
   *  `null` for rows outside the chunk; the panel treats that as a
   *  non-numeric value (skipped from aggregates, still counted). */
  getCellValue(rowIndex: number, colId: string): unknown;
  addEventListener<K extends VelocityGridEvent['type']>(
    type: K,
    handler: (event: Extract<VelocityGridEvent, { type: K }>) => void,
  ): () => void;
}

/** Pull every cell value referenced by `ranges`. `rowEnd` is inclusive
 *  (matches `SelectionRange`'s contract); `colIds` is the ordered list
 *  of columns the range covers. Disjoint ranges are flattened into a
 *  single value array — Sum / Min / Max / Avg aggregate over the union,
 *  which matches the spreadsheet expectation when you Ctrl-click two
 *  separate rectangles.
 *
 *  Pre-sized array allocation: we compute the total cell count up front
 *  so the values array is allocated once and indexed assigned, no
 *  `.push()` resize overhead. This keeps the read path constant per
 *  cell, which is half of why the perf gate (≤ 500 cells in ≤ 1 ms)
 *  holds. */
export function readRangeValues(
  ranges: readonly SelectionRange[],
  api: Pick<AggPanelApi, 'getCellValue'>,
): unknown[] {
  let total = 0;
  for (const r of ranges) {
    total += (r.rowEnd - r.rowStart + 1) * r.colIds.length;
  }
  if (total === 0) return [];
  const values: unknown[] = new Array(total);
  let idx = 0;
  for (const r of ranges) {
    for (let row = r.rowStart; row <= r.rowEnd; row++) {
      for (const colId of r.colIds) {
        values[idx++] = api.getCellValue(row, colId);
      }
    }
  }
  return values;
}

/** Resolve the func list this panel should render. `params.aggFuncs`
 *  (if a non-empty array) filters; absence or empty array falls back to
 *  the full canonical order. Always returns funcs in canonical order
 *  regardless of input order (decision 3). */
function resolveFuncs(params: IAggregationStatusPanelParams | undefined): AggFunc[] {
  const requested = params?.aggFuncs;
  if (!Array.isArray(requested) || requested.length === 0) {
    return CANONICAL_AGG_ORDER.slice();
  }
  const requestedSet = new Set(requested);
  return CANONICAL_AGG_ORDER.filter((f) => requestedSet.has(f));
}

/** Resolve the value formatter. The default delegates to either the
 *  count-only `Intl.NumberFormat` or the 2-fraction-digit decimal
 *  formatter depending on the func. A caller-supplied formatter wins
 *  for every func; the formatter is never invoked with NaN (the em-
 *  dash branch upstream handles N/A). */
function resolveFormatter(
  params: IAggregationStatusPanelParams | undefined,
): (value: number, func: AggFunc) => string {
  const custom = params?.valueFormatter;
  if (typeof custom === 'function') {
    return (value, func) => custom({ value, func });
  }
  return (value, func) => {
    if (func === 'count') return COUNT_FORMATTER.format(value);
    return DEFAULT_DECIMAL_FORMATTER.format(value);
  };
}

/** Build the DOM scaffold for one stat: `<span class="vg-status-panel-
 *  agg-stat"><span class="…-label">Label:</span><span class="…-value">
 *  </span></span>`. Returns the root + the value setter so refresh()
 *  can update without re-querying. */
function buildStat(label: string): {
  root: HTMLElement;
  setValue: (text: string) => void;
} {
  const root = document.createElement('span');
  root.className = 'vg-status-panel-agg-stat';
  const labelEl = document.createElement('span');
  labelEl.className = 'vg-status-panel-agg-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'vg-status-panel-agg-value';
  root.append(labelEl, valueEl);
  return { root, setValue: (text) => { valueEl.textContent = text; } };
}

/** Build a presentational `·` separator. `aria-hidden` so a screen
 *  reader hears `Count: 5, Sum: 1,234` rather than `Count: 5 middle
 *  dot Sum: 1,234`. */
function buildSeparator(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'vg-status-panel-agg-separator';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = MIDDLE_DOT;
  return span;
}

/** `agAggregationComponent` — five stats inline, hides when there's
 *  nothing to summarise. Subscribes to `cellSelectionChanged` +
 *  `selectionChanged` (decision 8 — NOT `rangeSelectionChanged`, the
 *  mid-drag firehose; we want the settled-selection signal, which
 *  Task 5 will further collapse via rAF batching). */
export class AgAggregationPanel implements IStatusPanelComp {
  private api: AggPanelApi | null = null;
  private funcs: AggFunc[] = CANONICAL_AGG_ORDER.slice();
  private formatter: (value: number, func: AggFunc) => string = (v) =>
    DEFAULT_DECIMAL_FORMATTER.format(v);
  private readonly gui: HTMLElement;
  /** Setters keyed by func, populated in `init()` after the funcs list
   *  resolves. Funcs not in the list don't get an entry. */
  private setters: Partial<Record<AggFunc, (text: string) => void>> = {};
  private unsubscribers: Array<() => void> = [];

  constructor() {
    this.gui = document.createElement('span');
    this.gui.className = 'vg-status-panel-agg';
    // Start hidden — decision 4. The first `refresh()` in `init()`
    // will un-hide it iff there's a selection.
    this.gui.hidden = true;
  }

  init(params: StatusPanelParams): void {
    this.api = params.api as AggPanelApi;
    const aggParams = params.statusPanelParams as
      | IAggregationStatusPanelParams
      | undefined;
    this.funcs = resolveFuncs(aggParams);
    this.formatter = resolveFormatter(aggParams);
    this.buildScaffold();
    this.unsubscribers.push(
      this.api.addEventListener('cellSelectionChanged', () => this.refresh()),
      this.api.addEventListener('selectionChanged', () => this.refresh()),
    );
    this.refresh();
  }

  getGui(): HTMLElement { return this.gui; }

  refresh(): void {
    if (!this.api) return;
    const ranges = this.api.getCellRanges();
    const selectedRowIds = this.api.getSelectedRowIds();
    const hasRanges = ranges.length > 0;
    const hasRowSelection = selectedRowIds.length > 0;

    if (!hasRanges && !hasRowSelection) {
      // Decision 4 — hide entirely when there's nothing to summarise.
      this.gui.hidden = true;
      return;
    }
    this.gui.hidden = false;

    let result: AggregateResult;
    if (hasRanges) {
      const values = readRangeValues(ranges, this.api);
      result = aggregate(values, this.funcs);
    } else {
      // Row-only selection — `Count: N` is defined, numeric stats are
      // N/A because we don't have a column to aggregate over. Build
      // the result by hand: numericCount = 0 → min/max/avg = NaN per
      // aggregate()'s contract.
      result = aggregate(new Array(selectedRowIds.length).fill(null), this.funcs);
    }
    this.renderStats(result);
  }

  destroy(): void {
    for (const off of this.unsubscribers) {
      try { off(); } catch (e) { console.error(e); }
    }
    this.unsubscribers = [];
    this.api = null;
    this.setters = {};
  }

  // ---- internals --------------------------------------------------

  private buildScaffold(): void {
    this.gui.replaceChildren();
    this.setters = {};
    for (let i = 0; i < this.funcs.length; i++) {
      const func = this.funcs[i]!;
      if (i > 0) this.gui.appendChild(buildSeparator());
      const { root, setValue } = buildStat(FUNC_LABELS[func]);
      this.setters[func] = setValue;
      this.gui.appendChild(root);
    }
  }

  private renderStats(result: AggregateResult): void {
    for (const func of this.funcs) {
      const setter = this.setters[func];
      if (!setter) continue;
      const value = result[func];
      // Decision 5 — em-dash for any stat whose result is NaN. Count
      // never lands here (always finite ≥ 0); Sum is `0` for empty
      // numeric input (per aggMath contract) so it shows `0` not `—`;
      // Min/Max/Avg show `—` when there are no finite numerics.
      const display = Number.isFinite(value)
        ? this.formatter(value, func)
        : EM_DASH;
      setter(display);
    }
  }
}
