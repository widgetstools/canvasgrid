import type { Page } from '@playwright/test';

// Cycle 12 / Task 4 — visual-regression harness. The matrix in Task 5 calls
// `seedGrid(page, rowCount)` to push a deterministic dataset into the demo
// grid via the existing `window.__cgrid.setRowData(...)` hook. No STOMP, no
// Date.now, no random — every cell value is a pure function of its row index
// so baselines diff cleanly across machines.

/** Imperative grid surface the visual-regression specs reach into. Kept
 *  intentionally narrow — only the methods the matrix actually drives. */
export interface VisualGridSurface {
  setRowData: (rows: unknown[]) => void;
  setTheme: (themeClass: string) => void;
  setSideBarPosition: (pos: 'left' | 'right') => void;
  openToolPanel: (id: string) => void;
  startEditingCell: (rowIndex: number, colId: string) => void;
  addCellRange: (range: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
  ensureColumnVisible: (colId: string, position?: 'auto' | 'start' | 'middle' | 'end') => void;
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  getScroller: () => HTMLElement;
}

/** Park the page for `n` rAF ticks. The grid paints on rAF so callers
 *  use this to wait out the redraw after a state-changing call (seed,
 *  scroll, side-bar open, theme flip). Mirrors the `waitForFrames`
 *  helper shared by every functional spec in `../e2e/`. */
export async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = (): void => {
        i += 1;
        if (i >= count) res();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

/** Navigate to the demo with a deterministic URL (no `?stress=...` so the
 *  Cycle 12 visual harness never depends on STOMP — `seedGrid` below is
 *  the sole source of row data) and wait for `window.__cgrid` to mount.
 *  Does NOT wait for `__cgridReady` (firstDataRendered) — that fires
 *  AFTER the first `setRowData`, which the caller drives via
 *  `seedGrid` next. */
export async function gridReady(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    undefined,
    { timeout: 20_000 },
  );
}

/** Navigate with a query string (e.g. `?statusBar=mounted`) so the demo
 *  factory opts into the optional surface under test. Mirrors `gridReady`
 *  semantics — waits for `window.__cgrid` to mount but NOT for
 *  firstDataRendered. Cycle 13 / Task 1 — used by visual cell 14 to mount
 *  the status bar (empty in Task 1; counts + agg panels populate in
 *  Tasks 2 + 3). */
export async function gridReadyWithQuery(page: Page, query: string): Promise<void> {
  const path = query.startsWith('?') ? `/${query}` : `/?${query}`;
  await page.goto(path);
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    undefined,
    { timeout: 20_000 },
  );
}

/** Push `rowCount` deterministic rows into the demo grid. Resolves once the
 *  rows are seeded — caller waits for paint completion separately. */
export async function seedGrid(page: Page, rowCount: number): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgrid?: unknown }).__cgrid != null);
  await page.evaluate((count) => {
    const w = window as unknown as { __cgrid: { setRowData: (rows: unknown[]) => void } };
    const TICKERS = [
      'AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'BRK', 'JPM', 'XOM',
      'JNJ',  'WMT',  'V',    'UNH',  'MA',   'HD',   'PG',   'KO',  'BAC', 'PFE',
    ];
    // Cycle 15 / Task 5 — deterministic ticker → sector + subSector
    // derivation. Seeds the multipleColumns visual cell (cell 21) +
    // any future grouping-by-sector demo. Values are extra fields on
    // each row object; they're silently ignored when no column declares
    // them as `field`, so existing visual cells (which don't declare
    // sector/subSector columns by default) remain byte-stable.
    const SECTOR_BY_TICKER: Record<string, string> = {
      AAPL: 'Tech', MSFT: 'Tech', GOOG: 'Tech', NVDA: 'Tech', META: 'Tech',
      AMZN: 'Consumer', WMT: 'Consumer', HD: 'Consumer', KO: 'Consumer', PG: 'Consumer',
      TSLA: 'Industrial', UNH: 'Health', JNJ: 'Health', PFE: 'Health',
      BRK: 'Financial', JPM: 'Financial', BAC: 'Financial', V: 'Financial', MA: 'Financial',
      XOM: 'Energy',
    };
    const SUBSECTOR_BY_TICKER: Record<string, string> = {
      AAPL: 'Devices', MSFT: 'Software', GOOG: 'Software', NVDA: 'Semis', META: 'Internet',
      AMZN: 'E-commerce', WMT: 'Retail', HD: 'Retail', KO: 'Beverage', PG: 'Goods',
      TSLA: 'EV', UNH: 'Insurance', JNJ: 'Pharma', PFE: 'Pharma',
      BRK: 'Holding', JPM: 'Banks', BAC: 'Banks', V: 'Payments', MA: 'Payments',
      XOM: 'Integrated',
    };
    const cusipFor = (i: number): string => {
      const hex = ((i * 0x9e3779b9) >>> 0).toString(16).toUpperCase().padStart(8, '0');
      return hex.slice(0, 9).padEnd(9, '0');
    };
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < count; i++) {
      const ticker = TICKERS[i % TICKERS.length];
      const a = ((i * 2654435761) >>> 0) / 0x1_0000_0000;
      const b = (((i + 1) * 2246822519) >>> 0) / 0x1_0000_0000;
      const price = Math.round((50 + a * 450) * 100) / 100;
      const notional = Math.round((1_000 + b * 99_000) / 100) * 100;
      const marketValue = Math.round(price * notional * 100) / 100;
      const pnl = Math.round((a - 0.5) * 20_000 * 100) / 100;
      const dailyPnl = Math.round((b - 0.5) * 5_000 * 100) / 100;
      const unrealizedPnl = Math.round((pnl - dailyPnl) * 100) / 100;
      rows.push({
        positionId: `POS-${String(i).padStart(6, '0')}`,
        cusip: cusipFor(i),
        ticker,
        sector: SECTOR_BY_TICKER[ticker!] ?? 'Other',
        subSector: SUBSECTOR_BY_TICKER[ticker!] ?? 'Other',
        notionalAmount: notional,
        marketValue,
        currentPrice: price,
        pnl,
        dailyPnl,
        unrealizedPnl,
        yield: Math.round((1 + a * 9) * 100) / 100,
        spread: Math.round((5 + b * 95) * 100) / 100,
        dv01: Math.round((10 + a * 90) * 100) / 100,
        pv01: Math.round((10 + b * 90) * 100) / 100,
      });
    }
    w.__cgrid.setRowData(rows);
  }, rowCount);
}

/** Common navigate → seed → settle pattern shared by every matrix spec.
 *  Resolves once the grid is mounted, rows are seeded, and the paint
 *  has had ≥ `settleFrames` rAF ticks to land. */
export async function setupGrid(page: Page, rowCount: number, settleFrames = 12): Promise<void> {
  await gridReady(page);
  await seedGrid(page, rowCount);
  await waitForFrames(page, settleFrames);
}

/** Drive the scroller to (`scrollLeft`, `scrollTop`) via the public
 *  `getScroller()` debug accessor. Uses the same channel the
 *  Cycle 9 range-drag specs use, so a layout change that breaks one
 *  breaks both. */
export async function scrollTo(page: Page, scrollLeft: number, scrollTop: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const g = (window as unknown as { __cgrid: VisualGridSurface }).__cgrid;
      const s = g.getScroller();
      s.scrollLeft = x;
      s.scrollTop = y;
    },
    { x: scrollLeft, y: scrollTop },
  );
}

/** Hide the blinking caret in any editor input + textarea so the
 *  snapshot is byte-stable across runs. CSS-only — does not change
 *  focus, so the editor still asserts its presence semantically. */
export async function silenceCaret(page: Page): Promise<void> {
  await page.addStyleTag({
    content: 'input, textarea, [contenteditable] { caret-color: transparent !important; }',
  });
}
