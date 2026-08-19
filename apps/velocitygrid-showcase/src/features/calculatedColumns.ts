import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import type { CalcEngine, CalculatedColumnDef } from '@wellsfargo-starui/velocity-grid-calc';
import type { Feature } from './index';

/**
 * Cycle 21d / Task 15 — Calculated columns demo.
 *
 * Three calc columns over a ticking positions blotter:
 *   • notional     — row-local Stage A: [qty] * [price], currency-
 *                    formatted ('$#,##0'); sorts/filters/groups like
 *                    an ordinary data column (no settle frame).
 *   • pctOfSector  — aggregate Stage B: [qty] / SUM([qty], 'group'),
 *                    percent-formatted ('0.0%'); re-scopes LIVE when
 *                    grouping by sector toggles — ungrouped, 'group'
 *                    promotes to the whole visible set (one implicit
 *                    group). Aggregates the DATA field [qty] rather
 *                    than the notional calc column: the landed
 *                    CalcEngine rejects calc-on-calc references
 *                    (registerCalculatedColumn, Task 12 review fix —
 *                    the worker's Stage A/B pipeline has no defined
 *                    evaluation order between calc columns within a
 *                    single pass, so aggregating one calc column's
 *                    output from another would be an undebuggable
 *                    ordering hazard). See packages/calc/src/
 *                    calcEngine.ts's module doc.
 *   • pxChange     — PREV: [price] - PREV([price]) — tick-scoped delta
 *                    off the worker's transaction snapshot, driven by
 *                    the interval mutator. Reads 0 until the first
 *                    tick (Float64Array numericCols slot — see
 *                    CALC_COLUMNS doc below for why every calc column
 *                    here uses cellDataType 'number').
 *
 * The template button proves the override fold chain visibly:
 * typeDefault → template (headerName 'Numeric' + width 90 on qty and
 * price) → per-column assignment (price renamed 'Px (compact)') — the
 * assignment layer wins over the template layer.
 */

interface PositionRow {
  symbol: string;
  sector: string;
  qty: number;
  price: number;
}

// Clean-number seed so the E2E asserts exact notionals/ratios:
// Tech qty 350 · Energy qty 500 · Finance qty 325 · grand qty 1175.
// Notional: Tech 85 000 · Energy 55 000 · Finance 70 000 · grand 210 000.
const START_ROWS: PositionRow[] = [
  { symbol: 'AAPL', sector: 'Tech', qty: 200, price: 150 },
  { symbol: 'MSFT', sector: 'Tech', qty: 100, price: 300 },
  { symbol: 'NVDA', sector: 'Tech', qty: 50, price: 500 },
  { symbol: 'XOM', sector: 'Energy', qty: 400, price: 100 },
  { symbol: 'CVX', sector: 'Energy', qty: 100, price: 150 },
  { symbol: 'JPM', sector: 'Finance', qty: 300, price: 200 },
  { symbol: 'GS', sector: 'Finance', qty: 25, price: 400 },
];

// Calc DSL grammar facts: infix booleans && / || only, equality == / !=
// (no AND/OR/bare =); scope is a trailing string literal
// ('all' | 'visible' | 'group' | 'parent'). SUM's aggregate arg must be
// a single bare field ref — [notional] is a calc column, and the
// landed CalcEngine rejects calc-on-calc references, so pctOfSector
// aggregates the data field [qty] instead (see module doc above).
//
// cellDataType is deliberately 'number' (not 'currency'/'percent') on
// BOTH aggregate columns: currency/percent presentation is carried
// entirely by the `format` string (compiled via the kernel's
// registered format compiler, same as qty/price below) — the kernel's
// binary cellDataType (packages/kernel/src/types/column.ts) only picks
// numericCols vs textCols storage and left-align-text vs number cell
// rendering; the paint path only invokes the compiled `valueFormatter`
// for numericCols-backed (cellDataType 'number') columns
// (velocityGrid.ts:cellAt's `numeric` branch calls `formatNumber`; the `text`
// branch renders the raw decoded string with no formatter pass). A
// non-'number' calc cellDataType (kernelCellDataTypeOf degrades
// 'currency'/'percent' to kernel 'text') would ship correctly but
// paint the RAW unformatted number.
const CALC_COLUMNS: CalculatedColumnDef[] = [
  {
    colId: 'notional', headerName: 'Notional',
    expression: '[qty] * [price]',
    format: '$#,##0', cellDataType: 'number', initialWidth: 110,
  },
  {
    colId: 'pctOfSector', headerName: '% of Sector',
    expression: "[qty] / SUM([qty], 'group')",
    format: '0.0%', cellDataType: 'number', initialWidth: 110,
  },
  {
    colId: 'pxChange', headerName: 'Px Δ',
    expression: '[price] - PREV([price])',
    format: '+0.00;-0.00', cellDataType: 'number', initialWidth: 100,
  },
];

const COLUMNS: CColDef<PositionRow>[] = [
  { colId: 'symbol', field: 'symbol', headerName: 'Symbol', cellDataType: 'text', width: 100 },
  { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text', width: 110 },
  { colId: 'qty', field: 'qty', headerName: 'Qty', cellDataType: 'number', width: 90, valueFormatter: '#,##0' },
  { colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number', width: 110, valueFormatter: '$#,##0.00' },
];

export const calculatedColumns: Feature = {
  id: 'calculated-columns',
  label: 'Calculated Columns',
  description:
    'Cycle 21d — @wellsfargo-starui/velocity-grid-calc worker-evaluated calculated columns. ' +
    'Row-local Notional ([qty] * [price]) sorts/filters/groups like a ' +
    "data column; % of Sector ([qty] / SUM([qty], 'group')) re-scopes " +
    'live when grouping by sector toggles; Px Δ ([price] - ' +
    'PREV([price])) ticks with the mutator; the template button folds ' +
    'a compact-numeric template + per-column override onto Qty/Price.',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<PositionRow>(gridHost, {
      getRowId: (r) => r.symbol,
      columnDefs: [COLUMNS[0]!],
      theme,
      rowHeight: 32,
      headerHeight: 36,
      groupDefaultExpanded: 'all',
    });

    // Wire format (calc `format` strings compile via the kernel's
    // registered compiler) AND calc BEFORE the full defs resolve —
    // the formatDSL.ts re-issue pattern. The calc provider must be
    // registered before the rebuild so synthesized columns appear.
    wireFormat(grid);
    const { calc } = wireCalc(grid, { calculatedColumns: CALC_COLUMNS });
    grid.updateGridOptions({ columnDefs: COLUMNS });
    grid.setRowData(START_ROWS);

    // E2E probe surface (mirrors __cgridRules in conditionalStyling.ts).
    (window as unknown as { __cgridCalc: CalcEngine }).__cgridCalc = calc;

    // ─── Ticking mutator ─────────────────────────────────────────────
    const data = new Map(START_ROWS.map((r) => [r.symbol, { ...r }]));
    const round2 = (n: number): number => Math.round(n * 100) / 100;

    /** Deterministic single tick for the E2E: AAPL price +1.25 →
     *  pxChange reads +1.25 via PREV; notional recomputes to 30 250. */
    const tickOnce = (): void => {
      const aapl = data.get('AAPL')!;
      aapl.price = round2(aapl.price + 1.25);
      grid.applyTransaction({ update: [{ ...aapl }] });
    };

    const tickRandom = (): void => {
      const symbols = [...data.keys()];
      const updates: PositionRow[] = [];
      for (let i = 0; i < 2; i += 1) {
        const row = data.get(symbols[Math.floor(Math.random() * symbols.length)]!)!;
        row.price = round2(Math.max(1, row.price * (1 + (Math.random() - 0.45) * 0.02)));
        updates.push({ ...row });
      }
      grid.applyTransaction({ update: updates });
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const setTicking = (on: boolean): void => {
      if (on && timer === null) timer = setInterval(tickRandom, 600);
      if (!on && timer !== null) { clearInterval(timer); timer = null; }
      tickBtn.textContent = on ? 'Pause ticking' : 'Start ticking';
      tickBtn.classList.toggle('primary', !on);
    };

    // ─── Controls ────────────────────────────────────────────────────
    const tickBtn = document.createElement('button');
    tickBtn.className = 'ctrl-btn primary';
    tickBtn.setAttribute('data-testid', 'btn-calc-tick');
    tickBtn.addEventListener('click', () => setTicking(timer === null));

    const tickOnceBtn = document.createElement('button');
    tickOnceBtn.className = 'ctrl-btn';
    tickOnceBtn.textContent = 'Tick once';
    tickOnceBtn.setAttribute('data-testid', 'btn-calc-tick-once');
    tickOnceBtn.addEventListener('click', tickOnce);

    let grouped = false;
    const groupBtn = document.createElement('button');
    groupBtn.className = 'ctrl-btn';
    groupBtn.textContent = 'Group by sector';
    groupBtn.setAttribute('data-testid', 'btn-calc-group');
    groupBtn.addEventListener('click', () => {
      grouped = !grouped;
      grid.setGroupModel({ rowGroupCols: grouped ? ['sector'] : [] });
      groupBtn.textContent = grouped ? 'Ungroup' : 'Group by sector';
    });

    const templateBtn = document.createElement('button');
    templateBtn.className = 'ctrl-btn';
    templateBtn.textContent = 'Apply compact template';
    templateBtn.setAttribute('data-testid', 'btn-calc-template');
    templateBtn.addEventListener('click', () => {
      // Template chain fold, visibly: template (headerName + width) on
      // qty + price, then a per-column override renames price — the
      // assignment layer wins over the template layer, so qty keeps
      // the template header 'Numeric' while price shows 'Px (compact)'.
      calc.saveTemplate({
        id: 'compact-num', name: 'Compact numeric',
        overrides: { headerName: 'Numeric', width: 90 },
        now: Date.now(), // host stamps — engines are Date-free
      });
      calc.applyTemplate('compact-num', ['qty', 'price']);
      // applyOverrides upserts wholesale per colId (CalcEngine's
      // documented "later call replaces that colId wholesale"
      // contract) — carry templateIds forward explicitly so this
      // assignment layers headerName on TOP of the template chain
      // instead of replacing it (which would silently drop price's
      // template-derived width).
      calc.applyOverrides([{ colId: 'price', headerName: 'Px (compact)', templateIds: ['compact-num'] }]);
      templateBtn.disabled = true;
      templateBtn.textContent = 'Template applied';
    });

    controls.append(tickBtn, tickOnceBtn, groupBtn, templateBtn);
    setTicking(false);

    // Cleanup piggybacks on destroy (realtimeStomp.ts pattern).
    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      if (timer !== null) clearInterval(timer);
      origDestroy();
    };

    return grid;
  },
};
