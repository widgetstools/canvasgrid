import { CGrid } from 'cgrid';
import type { CColDef } from 'cgrid';
import type { Feature } from './index';

/**
 * Cycle 21 / Tasks 1-3 — sparkline showcase.
 *
 * 10 tickers, each with a synthetic 60-day random-walk price history.
 * The fourth column renders the history as an inline sparkline; a
 * toolbar cycles the variant (`line` / `column` / `area` / `bar` /
 * `pie`) so visitors can compare the five painters on the same data
 * without leaving the page. Hovering a sparkline cell anchors the
 * shared DOM-overlay tooltip at the closest data point.
 */

type SparklineVariant = 'line' | 'column' | 'area' | 'bar' | 'pie';

interface SparklineRow {
  id: string;
  ticker: string;
  last: number;
  change: number;
  priceHistory: number[];
}

const TICKERS = [
  { sym: 'AAPL', start: 187 },
  { sym: 'MSFT', start: 428 },
  { sym: 'GOOG', start: 174 },
  { sym: 'AMZN', start: 184 },
  { sym: 'NVDA', start: 124 },
  { sym: 'META', start: 502 },
  { sym: 'TSLA', start: 252 },
  { sym: 'NFLX', start: 698 },
  { sym: 'AMD',  start: 162 },
  { sym: 'CRM',  start: 295 },
];

function buildRow(seed: number, sym: string, start: number): SparklineRow {
  const history: number[] = [];
  let price = start;
  let s = seed;
  for (let i = 0; i < 60; i++) {
    // Deterministic pseudo-random walk so screenshots / E2E runs match
    // across reloads. ~±2% step, bounded so prices stay positive.
    s = (s * 9301 + 49297) % 233280;
    const drift = (s / 233280 - 0.5) * 0.04 * price;
    price = Math.max(1, price + drift);
    history.push(Number(price.toFixed(2)));
  }
  const last = history[history.length - 1]!;
  const first = history[0]!;
  return {
    id: sym,
    ticker: sym,
    last,
    change: ((last - first) / first) * 100,
    priceHistory: history,
  };
}

function makeSparklineRows(): SparklineRow[] {
  return TICKERS.map((t, i) => buildRow(i * 9973 + 7, t.sym, t.start));
}

const VARIANT_LABELS: Record<SparklineVariant, string> = {
  line: 'Line',
  column: 'Column',
  area: 'Area',
  bar: 'Bar',
  pie: 'Pie',
};

// Each variant gets its own swatch from a tight palette so the demo
// reads at a glance instead of every chart bleeding into the same hue.
const OPTIONS_BY_VARIANT: Record<SparklineVariant, Record<string, unknown>> = {
  line:   { lineColor: '#60a5fa', lineWidth: 1.5 },
  column: { fill: '#60a5fa', gap: 1 },
  area:   { lineColor: '#60a5fa', fill: 'rgba(96,165,250,0.25)', lineWidth: 1.5 },
  bar:    { fill: '#34d399', gap: 1 },
  pie:    { fill: '#60a5fa', trackColor: 'rgba(148,163,184,0.25)' },
};

export const sparkline: Feature = {
  id: 'sparkline',
  label: 'Sparklines',
  description:
    'Cycle 21 / Tasks 1-3 — five inline sparkline variants painted by ' +
    'cgrid\'s canvas renderer (line / column / area / bar / pie). The ' +
    'toolbar swaps cellRendererParams.sparkline.type live; the shared ' +
    'DOM-overlay tooltip mounts on hover without repainting the canvas.',

  mount(gridHost, controls, theme) {
    let variant: SparklineVariant = 'line';

    // One column for all five variants — the dispatcher in the
    // sparkline renderer cycles via `cellRendererParams.sparkline.type`.
    // Distinct options per variant let each painter pick a visually
    // appropriate fill / line color against the dark-mode default.
    const sparkColumn = (type: SparklineVariant): CColDef<SparklineRow> => ({
      colId: 'priceHistory',
      field: 'priceHistory',
      headerName: type === 'pie' ? 'vs. rolling high' : '60-day history',
      cellRenderer: 'sparkline',
      cellRendererParams: { sparkline: { type, options: OPTIONS_BY_VARIANT[type] } },
      width: 240,
      sortable: false,
    });

    const columnDefsFor = (v: SparklineVariant): CColDef<SparklineRow>[] => [
      { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 100 },
      {
        colId: 'last', field: 'last', headerName: 'Last',
        cellDataType: 'number', width: 100,
        valueFormatter: ({ value }) => (typeof value === 'number' ? value.toFixed(2) : ''),
      },
      {
        colId: 'change', field: 'change', headerName: 'Change',
        cellDataType: 'number', width: 110,
        valueFormatter: ({ value }) => {
          if (typeof value !== 'number') return '';
          return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
        },
        cellStyle: ({ value }) =>
          typeof value === 'number' && value >= 0 ? { fg: '#16a34a' } : { fg: '#dc2626' },
      },
      sparkColumn(v),
    ];

    const grid = new CGrid<SparklineRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: columnDefsFor(variant),
      theme,
      rowHeight: 36,
    });

    grid.setRowData(makeSparklineRows());

    // ─── Variant pills ─────────────────────────────────────────────

    const label = document.createElement('span');
    label.className = 'ctrl-label';
    label.textContent = 'Variant';
    controls.appendChild(label);

    const buttons: Record<SparklineVariant, HTMLButtonElement> = {} as any;

    const setVariant = (next: SparklineVariant) => {
      variant = next;
      grid.updateGridOptions({ columnDefs: columnDefsFor(variant) });
      for (const v of Object.keys(buttons) as SparklineVariant[]) {
        buttons[v].classList.toggle('primary', v === variant);
      }
    };

    for (const v of Object.keys(VARIANT_LABELS) as SparklineVariant[]) {
      const btn = document.createElement('button');
      btn.className = 'ctrl-btn' + (v === variant ? ' primary' : '');
      btn.textContent = VARIANT_LABELS[v];
      btn.setAttribute('data-testid', `btn-spark-${v}`);
      btn.addEventListener('click', () => setVariant(v));
      controls.appendChild(btn);
      buttons[v] = btn;
    }

    return grid as unknown as CGrid<any>;
  },
};
