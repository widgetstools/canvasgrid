import { CGrid } from '@cgrid/kernel';
import type { CColDef } from '@cgrid/kernel';
import { wireIntoKernel as wireFormat } from '@cgrid/format';
import { wireIntoKernel as wireRules } from '@cgrid/rules';
import type { RuleEngine, StyleRule } from '@cgrid/rules';
import type { Feature } from './index';

/**
 * Cycle 21e / Task 16 — Conditional styling demo.
 *
 * Four rules over a ticking equity blotter:
 *   • neg-pnl    — theme-aware cell color (light/dark slices).
 *   • big-qty    — row-scope threshold: bold + wash on block positions.
 *   • up-tick    — diff-aware ([price.old]) flash-on-change, pulse,
 *                  activeDurationMs auto-expire.
 *   • stale-row  — indicator badge (Lucide triangle-alert) at row start.
 *
 * The composite Summary column proves the Cycle 21c reserve: fragment
 * style color '[rule:neg-pnl]' resolves to the LIVE rule color per row
 * (the bracket shorthand is required — see @cgrid/format's
 * fragmentResolver.extractDynamic, which only treats a fragment style
 * value as dynamic when it is wrapped in `[...]`). Match counts render
 * as chips in the controls bar (engine.matchCount).
 */

interface BlotterRow {
  symbol: string;
  desk: string;
  price: number;
  pnl: number;
  qty: number;
  status: 'LIVE' | 'STALE';
}

const START_ROWS: BlotterRow[] = [
  { symbol: 'AAPL', desk: 'Equities', price: 150.25, pnl: 1250, qty: 300, status: 'LIVE' },
  { symbol: 'GOOG', desk: 'Equities', price: 2850.10, pnl: -840, qty: 120, status: 'LIVE' },
  { symbol: 'MSFT', desk: 'Equities', price: 305.50, pnl: 410, qty: 650, status: 'LIVE' },
  { symbol: 'AMZN', desk: 'Equities', price: 3320.00, pnl: -2150, qty: 80, status: 'STALE' },
  { symbol: 'TSLA', desk: 'Equities', price: 720.85, pnl: 95, qty: 900, status: 'LIVE' },
  { symbol: 'NVDA', desk: 'Equities', price: 495.20, pnl: 3120, qty: 540, status: 'LIVE' },
];

const RULES: StyleRule[] = [
  // Theme-aware negative-value coloring (cell scope).
  {
    kind: 'style', id: 'neg-pnl', name: 'Negative P&L', enabled: true, priority: 10,
    condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
    style: { light: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
  },
  // Row-scope threshold: block positions get bold + a subtle wash.
  {
    kind: 'style', id: 'big-qty', name: 'Block position', enabled: true, priority: 20,
    condition: '[qty] > 500', scope: { kind: 'row' },
    style: {
      base: { fontWeight: 'bold' },
      light: { backgroundColor: '#fff8e1' },
      dark: { backgroundColor: '#3a3320' },
    },
  },
  // Diff-aware flash-on-change: matches only inside the tick that
  // raised the price; pulse flash + 1.5s auto-expire. Infix boolean
  // connective is `&&` (no infix AND/OR in @cgrid/expression).
  {
    kind: 'style', id: 'up-tick', name: 'Price up-tick', enabled: true, priority: 30,
    condition: '[price.old] != null && [price] > [price.old]',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: { base: { color: '#16a34a' } },
    flash: { enabled: true, target: 'cell', mode: 'pulse', color: '#16a34a', durationMs: 600 },
    activeDurationMs: 1500,
  },
  // Indicator badge rule: stale rows carry a warning triangle.
  // Equality is `==` (no bare `=`).
  {
    kind: 'indicator', id: 'stale-row', name: 'Stale row', enabled: true, priority: 40,
    condition: '[status] == "STALE"', scope: { kind: 'row' },
    indicator: { iconName: 'triangle-alert', color: '#f59e0b', target: 'row-start', position: 'before' },
  },
];

const COLUMNS: CColDef<BlotterRow>[] = [
  { colId: 'symbol', field: 'symbol', headerName: 'Symbol', cellDataType: 'text', width: 100 },
  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 110 },
  { colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number', width: 110, valueFormatter: '$#,##0.00' },
  { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 110, valueFormatter: '#,##0;-#,##0' },
  { colId: 'qty', field: 'qty', headerName: 'Qty', cellDataType: 'number', width: 90, valueFormatter: '#,##0' },
  { colId: 'status', field: 'status', headerName: 'Status', cellDataType: 'text', width: 90 },
  // Cycle 21c reserve, now live: '[rule:neg-pnl]' resolves the fragment
  // color from the matching rule's theme-resolved style.color. The
  // brackets are required — a bare 'rule:neg-pnl' string would render
  // as a literal (invalid) CSS color instead of a dynamic bracket.
  {
    colId: 'summary', type: 'composite', headerName: 'Summary', width: 240,
    align: 'left', overflow: 'ellipsis',
    fragments: [
      { expr: '[symbol]', style: { weight: 'bold' } },
      { text: '  ' },
      { expr: '[pnl]', format: '+#,##0;-#,##0', style: { color: '[rule:neg-pnl]' } },
    ],
  },
];

const RULE_CHIP_COLORS: Record<string, string> = {
  'neg-pnl': '#ef5350',
  'big-qty': '#f5b84a',
  'up-tick': '#22c55e',
  'stale-row': '#f59e0b',
};

export const conditionalStyling: Feature = {
  id: 'conditional-styling',
  label: 'Conditional Styling',
  description:
    'Cycle 21e — @cgrid/rules conditional styling. Theme-aware style ' +
    'rules ([pnl] < 0), a row-scope threshold rule ([qty] > 500), a ' +
    'diff-aware flash rule ([price.old] comparison, pulse, 1.5s ' +
    'auto-expire), an indicator badge for stale rows, and a composite ' +
    'column whose fragment color is [rule:neg-pnl] — the Cycle 21c ' +
    'reserve resolving live. Match counts update as the data ticks.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<BlotterRow>(gridHost, {
      getRowId: (r) => r.symbol,
      columnDefs: [COLUMNS[0]!],
      theme,
      rowHeight: 32,
      headerHeight: 36,
    });

    // Wire format (composite compiler) AND rules BEFORE the full defs
    // resolve — same re-issue pattern as formatDSL.ts. Rule-driven
    // flash owns the flash channel, so enableCellChangeFlash stays off.
    wireFormat(grid);
    const { rules } = wireRules(grid, { rules: RULES });
    grid.updateGridOptions({ columnDefs: COLUMNS });
    grid.setRowData(START_ROWS);

    // The bridge seeds match counts from grid.forEachRow at WIRE time
    // (Task 15 step 4), which ran with zero rows since wireRules is
    // called before setRowData — the format-compiler ordering
    // constraint (columns must resolve after the compiler registers)
    // forces rules to wire early too. setRowData itself only emits
    // 'modelUpdated', which the bridge doesn't consume, so re-seed the
    // match counters directly against the now-loaded dataset.
    rules.recount(START_ROWS.map((r) => ({ rowId: r.symbol, row: r as unknown as Record<string, unknown> })));

    // E2E probe surface (mirrors window.__cgrid in main.ts).
    (window as unknown as { __cgridRules: RuleEngine }).__cgridRules = rules;

    // ─── Ticking mutator ─────────────────────────────────────────────
    const data = new Map(START_ROWS.map((r) => [r.symbol, { ...r }]));
    const round2 = (n: number): number => Math.round(n * 100) / 100;

    /** Deterministic single tick for the E2E: AAPL price UP (fires the
     *  up-tick flash rule) + GOOG pnl sign flip (moves the neg-pnl
     *  match count 2 → 1 → 2 → …). */
    const tickOnce = (): void => {
      const aapl = data.get('AAPL')!;
      aapl.price = round2(aapl.price + 1.25);
      const goog = data.get('GOOG')!;
      goog.pnl = -goog.pnl;
      grid.applyTransaction({ update: [{ ...aapl }, { ...goog }] });
      renderCounts();
    };

    const tickRandom = (): void => {
      const symbols = [...data.keys()];
      const updates: BlotterRow[] = [];
      for (let i = 0; i < 2; i += 1) {
        const row = data.get(symbols[Math.floor(Math.random() * symbols.length)]!)!;
        row.price = round2(Math.max(1, row.price * (1 + (Math.random() - 0.45) * 0.02)));
        row.pnl = Math.round(row.pnl + (Math.random() - 0.5) * 600);
        updates.push({ ...row });
      }
      grid.applyTransaction({ update: updates });
      renderCounts();
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const setTicking = (on: boolean): void => {
      if (on && timer === null) timer = setInterval(tickRandom, 600);
      if (!on && timer !== null) { clearInterval(timer); timer = null; }
      tickBtn.textContent = on ? 'Pause ticking' : 'Start ticking';
      tickBtn.classList.toggle('primary', !on);
    };

    // ─── Controls: tick buttons + live match-count chips ─────────────
    const tickBtn = document.createElement('button');
    tickBtn.className = 'ctrl-btn primary';
    tickBtn.setAttribute('data-testid', 'btn-cs-tick');
    tickBtn.addEventListener('click', () => setTicking(timer === null));

    const tickOnceBtn = document.createElement('button');
    tickOnceBtn.className = 'ctrl-btn';
    tickOnceBtn.textContent = 'Tick once';
    tickOnceBtn.setAttribute('data-testid', 'btn-cs-tick-once');
    tickOnceBtn.addEventListener('click', tickOnce);

    const chips = new Map<string, HTMLSpanElement>();
    for (const rule of RULES) {
      const chip = document.createElement('span');
      chip.className = 'ctrl-btn';
      chip.style.cursor = 'default';
      chip.style.borderLeft = `3px solid ${RULE_CHIP_COLORS[rule.id] ?? '#888'}`;
      chip.setAttribute('data-testid', `match-count-${rule.id}`);
      chips.set(rule.id, chip);
    }
    const renderCounts = (): void => {
      for (const [ruleId, chip] of chips) {
        const rule = RULES.find((r) => r.id === ruleId)!;
        chip.textContent = `${rule.name} · APP ${rules.matchCount(ruleId)}`;
      }
    };
    renderCounts();
    const countTimer = setInterval(renderCounts, 800);

    controls.append(tickBtn, tickOnceBtn, ...chips.values());
    setTicking(false);

    // Cleanup piggybacks on destroy (realtimeStomp.ts pattern).
    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      if (timer !== null) clearInterval(timer);
      clearInterval(countTimer);
      origDestroy();
    };

    return grid;
  },
};
