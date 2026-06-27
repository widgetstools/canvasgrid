import type { Page } from '@playwright/test';

// Cycle 12 / Task 4 — visual-regression harness. The matrix in Task 5 calls
// `seedGrid(page, rowCount)` to push a deterministic dataset into the demo
// grid via the existing `window.__cgrid.setRowData(...)` hook. No STOMP, no
// Date.now, no random — every cell value is a pure function of its row index
// so baselines diff cleanly across machines.

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
