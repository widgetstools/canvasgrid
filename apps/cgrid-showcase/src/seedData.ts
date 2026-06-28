export interface ShowcaseRow {
  id: string;
  ticker: string;
  desk: string;
  region: string;
  sector: string;
  pnl: number;
  notional: number;
}

const DESKS = ['APAC', 'EMEA', 'AMER', 'LATAM'] as const;
const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'AMZN'] as const;
const SECTORS = ['Tech', 'Finance', 'Energy'] as const;
const REGIONS = ['Asia', 'Europe', 'Americas'] as const;

export function makeRows(n = 100): ShowcaseRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `R${i}`,
    ticker: TICKERS[i % TICKERS.length]!,
    desk: DESKS[i % DESKS.length]!,
    region: REGIONS[i % REGIONS.length]!,
    sector: SECTORS[i % SECTORS.length]!,
    pnl: (i % 50 - 25) * 1000,
    notional: (i + 1) * 10_000,
  }));
}
