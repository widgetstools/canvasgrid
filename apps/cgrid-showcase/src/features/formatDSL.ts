import { CGrid } from '@cgrid/kernel';
import type { CColDef } from '@cgrid/kernel';
import { wireIntoKernel, getFormatterTemplate } from '@cgrid/format';
import type { Feature } from './index';

/**
 * Cycle 21c / Task 18 — Format DSL demo.
 *
 * One column per DSL tier:
 *   • Tier 0 — pure Excel format codes (`$#,##0.00`, semicolon
 *     sections with `[Red]` on the negative section).
 *   • Tier 1 — Excel codes + expression brackets: `[color=<expr>]`
 *     for per-row color and `{icon:name|<expr>}` for a conditional
 *     inline Lucide icon.
 *   • Tier 2 — a `type: 'composite'` summary column rendering three
 *     independently-styled fragments in a single cell.
 *
 * The composite column also registers a tooltip provider (hover a
 * summary cell for 500ms) and participates in multi-format clipboard
 * copy (`text/plain` + `text/html`).
 */

interface FormatRow {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  qty: number;
  updated: Date;
}

const ROWS: FormatRow[] = [
  { symbol: 'AAPL', price: 150.25, change: 2.5, changePct: 0.0169, volume: 45_000_000, qty: 150, updated: new Date('2026-07-01T14:30:00') },
  { symbol: 'GOOG', price: 2850.1, change: -12.75, changePct: -0.0045, volume: 12_500_000, qty: 40, updated: new Date('2026-06-30T09:15:00') },
  { symbol: 'MSFT', price: 305.5, change: 0, changePct: 0, volume: 22_000_000, qty: 8, updated: new Date('2026-06-28T16:45:00') },
  { symbol: 'AMZN', price: 3320.0, change: -45.2, changePct: -0.0134, volume: 8_500_000, qty: 220, updated: new Date('2026-06-25T11:00:00') },
  { symbol: 'TSLA', price: 720.85, change: 15.3, changePct: 0.0217, volume: 55_000_000, qty: 75, updated: new Date('2026-07-01T10:05:00') },
];

// Formatter-template demo (programmatic registry, not the string DSL):
// build a function-form valueFormatter from the built-in Currency
// template. Nine built-ins ship: Number / Currency / Percent / Date /
// Time / DateTime / Abbreviated / RelativeTime / Custom.
const eurFormatter = getFormatterTemplate('Currency')!.factory(
  { currency: 'EUR', locale: 'de-DE' } as never,
);
const abbrFormatter = getFormatterTemplate('Abbreviated')!.factory({} as never);

// Fixed widths so the E2E can hover deterministic canvas coordinates.
// summary column x-range: 90+110+120+130+130+110 = 690 → 950.
const COLUMNS: CColDef<FormatRow>[] = [
  { colId: 'symbol', field: 'symbol', headerName: 'Symbol', cellDataType: 'text', width: 90 },

  // Tier 0 — plain Excel currency format.
  {
    colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number', width: 110,
    valueFormatter: '$#,##0.00',
  },

  // Tier 0 — semicolon sections; [Red] applies to the negative section.
  {
    colId: 'change', field: 'change', headerName: 'Change', cellDataType: 'number', width: 120,
    valueFormatter: '$#,##0.00;[Red]-$#,##0.00',
  },

  // Tier 1 — [color=<expr>] resolves a per-row color from the row data.
  {
    colId: 'changeColor', field: 'change', headerName: 'Change (color)', cellDataType: 'number', width: 130,
    valueFormatter: '[color=[change] > 0 ? "#0a7" : "#d33"] $#,##0.00',
  },

  // Tier 1 — {icon:default|<expr>} picks a Lucide icon per row.
  {
    colId: 'changeIcon', field: 'change', headerName: 'Change (icon)', cellDataType: 'number', width: 130,
    valueFormatter: '{icon:trending-up|[change] > 0 ? "trending-up" : "trending-down"} $#,##0.00',
  },

  // Tier 0 — thousands separators.
  {
    colId: 'volume', field: 'volume', headerName: 'Volume', cellDataType: 'number', width: 110,
    valueFormatter: '#,##0',
  },

  // Tier 2 — composite summary: three fragments, each independently
  // formatted + styled, single canvas cell. cellBackground washes the
  // whole cell pale red on down days; align + overflow are the two
  // composite layout knobs.
  {
    colId: 'summary', type: 'composite', headerName: 'Summary', width: 260,
    align: 'left',
    overflow: 'ellipsis',
    cellBackground: '[bg=[change] < 0 ? "#fee2e2" : "transparent"]',
    fragments: [
      { expr: '[symbol]', style: { weight: 'bold' } },
      { text: '  ' },
      { expr: '[price]', format: '$#,##0.00' },
      { text: '  ' },
      {
        expr: '[change]', format: '+0.00;-0.00',
        style: { color: '[[change] > 0 ? "#0a7" : "#d33"]' },
      },
    ],
  },

  // Tier 0 — percent (multiplies by 100).
  {
    colId: 'changePct', field: 'changePct', headerName: 'Change %', cellDataType: 'number', width: 100,
    valueFormatter: '0.0%',
  },

  // Tier 0 — date tokens.
  {
    colId: 'updated', field: 'updated', headerName: 'Updated', width: 110,
    valueFormatter: 'yyyy-mm-dd',
  },

  // Tier 0 — conditional sections: [>N] / [<N] route the value to a
  // section by predicate, each with its own literal prefix.
  {
    colId: 'trend', field: 'change', headerName: 'Trend', cellDataType: 'number', width: 100,
    valueFormatter: '[>10]"UP "0.00;[<0]"DOWN "0.00;0.00',
  },

  // Formatter template (programmatic API) — Intl compact notation via
  // the built-in Abbreviated template (45,000,000 → 45M).
  {
    colId: 'volAbbr', field: 'volume', headerName: 'Vol (abbr)', cellDataType: 'number', width: 100,
    valueFormatter: ({ value }) => abbrFormatter(value),
  },

  // Tier 1 — [bg=<expr>] + [weight=<expr>] combined: large positions
  // get a yellow wash and bold text.
  {
    colId: 'qty', field: 'qty', headerName: 'Qty', cellDataType: 'number', width: 90,
    valueFormatter: '[bg=[qty] > 100 ? "#fff3cd" : "transparent"] [weight=[qty] > 100 ? "bold" : "normal"] #,##0',
  },

  // Tier 1 — [style=<expr>]: negative momentum renders italic.
  {
    colId: 'momentum', field: 'change', headerName: 'Momentum', cellDataType: 'number', width: 100,
    valueFormatter: '[style=[change] < 0 ? "italic" : "normal"] 0.00',
  },

  // Tier 1 — [if <expr>] section selectors: route by predicate, not
  // by the value's sign.
  {
    colId: 'tier', field: 'qty', headerName: 'Size Tier', width: 90,
    valueFormatter: '[if [qty] > 100] "BLOCK";[if [qty] > 50] "LOT"; "ODD"',
  },

  // Formatter template (programmatic API) — Intl-backed Currency
  // template rendering the price in EUR with German locale rules.
  {
    colId: 'priceEur', field: 'price', headerName: 'Price (EUR)', cellDataType: 'number', width: 110,
    valueFormatter: ({ value }) => eurFormatter(value),
  },
];

export const formatDSL: Feature = {
  id: 'format-dsl',
  label: 'Format DSL',
  description:
    'Cycle 21c — unified format DSL. Tier 0 Excel codes ($#,##0.00, ' +
    '[Red] sections, percent, dates, conditional [>1000] sections), ' +
    'Tier 1 expression brackets ([color=], [bg=], [weight=], [style=], ' +
    '[if], {icon:…}), Tier 2 composite fragments with cellBackground, ' +
    'plus the Intl formatter-template registry. Hover a Summary cell ' +
    'for the tooltip; select cells and press Ctrl+C for rich-HTML copy.',

  mount(gridHost, _controls, theme) {
    // Construct with the plain symbol column only — string valueFormatters
    // compile during column resolution, so the format compiler must be
    // registered (wireIntoKernel) BEFORE the DSL columns resolve. The
    // full def list lands via updateGridOptions after wiring.
    const grid = new CGrid<FormatRow>(gridHost, {
      getRowId: (r) => r.symbol,
      columnDefs: [COLUMNS[0]!],
      theme,
      rowHeight: 32,
      headerHeight: 36,
    });

    wireIntoKernel(grid);
    grid.updateGridOptions({ columnDefs: COLUMNS });
    grid.setRowData(ROWS);

    // Tooltip provider for the composite column (Cycle 21c / Task 14).
    grid.registerTooltipProvider('summary', ({ row }) => {
      const r = row as FormatRow | null;
      if (!r) return null;
      return {
        plain: `${r.symbol} — price $${r.price.toFixed(2)}, change ${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}`,
      };
    });

    return grid;
  },
};
