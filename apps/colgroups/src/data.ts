import type { ValueFormatterParams } from 'ag-grid-community';

export interface PositionRow {
  positionId: string;
  instrument: string;
  cusip: string;
  assetClass: string;
  book: string;
  desk: string;
  trader: string;
  region: string;
  price: number;
  mtm: number;
  prevClose: number;
  currency: string;
  notional: number;
  marketValue: number;
  dayPnl: number;
  mtdPnl: number;
  ytdPnl: number;
  dv01: number;
  cr01: number;
  duration: number;
  grossExp: number;
  netExp: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  up100bp: number;
  down100bp: number;
  sector: string;
  rating: string;
  maturity: string;
  updatedAt: string;
}

// Small deterministic PRNG (mulberry32) so demo data is stable across renders.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INSTRUMENTS = ['UST 10Y', 'UST 2Y', 'BUND 10Y', 'GILT 30Y', 'AAPL', 'MSFT', 'JPM 5Y CDS', 'XOM', 'IG CDX', 'HY CDX'];
const ASSET = ['Rates', 'Credit', 'Equity', 'Equity', 'Credit'];
const BOOKS = ['RATES-1', 'RATES-2', 'CREDIT-1', 'EQ-US', 'EQ-EU'];
const DESKS = ['Govvies', 'Flow Credit', 'Cash Equity', 'Index'];
const TRADERS = ['A. Rao', 'J. Diaz', 'M. Chen', 'S. Patel', 'L. Weber'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CCY = ['USD', 'EUR', 'GBP'];
const SECTORS = ['Government', 'Financials', 'Technology', 'Energy', 'Index'];
const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB'];

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

export function makeRows(count = 200): PositionRow[] {
  const r = rng(0xc0ffee);
  const rows: PositionRow[] = [];
  for (let i = 0; i < count; i++) {
    const price = 80 + r() * 60;
    const notional = Math.round((0.5 + r() * 9.5) * 1_000_000);
    const dayPnl = Math.round((r() - 0.45) * 60_000);
    const mv = Math.round(notional * (price / 100));
    const year = 2026 + Math.floor(r() * 10);
    const month = String(1 + Math.floor(r() * 12)).padStart(2, '0');
    const day = String(1 + Math.floor(r() * 28)).padStart(2, '0');
    rows.push({
      positionId: `POS-${String(1000 + i)}`,
      instrument: pick(INSTRUMENTS, r),
      cusip: `${Math.floor(r() * 900000000 + 100000000)}`,
      assetClass: pick(ASSET, r),
      book: pick(BOOKS, r),
      desk: pick(DESKS, r),
      trader: pick(TRADERS, r),
      region: pick(REGIONS, r),
      price: Number(price.toFixed(2)),
      mtm: Number((price + (r() - 0.5) * 1.5).toFixed(2)),
      prevClose: Number((price + (r() - 0.5) * 2).toFixed(2)),
      currency: pick(CCY, r),
      notional,
      marketValue: mv,
      dayPnl,
      mtdPnl: Math.round(dayPnl * (2 + r() * 8)),
      ytdPnl: Math.round(dayPnl * (5 + r() * 30)),
      dv01: Number((r() * 5000).toFixed(0)),
      cr01: Number((r() * 3000).toFixed(0)),
      duration: Number((r() * 12).toFixed(2)),
      grossExp: Math.round(notional * (0.9 + r() * 0.2)),
      netExp: Math.round(notional * (r() - 0.5) * 1.5),
      delta: Number((r() * 2 - 1).toFixed(3)),
      gamma: Number((r() * 0.5).toFixed(3)),
      vega: Number((r() * 1000).toFixed(0)),
      theta: Number((-r() * 500).toFixed(0)),
      up100bp: Number((r() * 40 - 20).toFixed(2)),
      down100bp: Number((r() * 40 - 20).toFixed(2)),
      sector: pick(SECTORS, r),
      rating: pick(RATINGS, r),
      maturity: `${year}-${month}-${day}`,
      updatedAt: `2026-07-04T${String(9 + Math.floor(r() * 8)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`,
    });
  }
  return rows;
}

function num(p: ValueFormatterParams): number | null {
  return p.value == null || Number.isNaN(Number(p.value)) ? null : Number(p.value);
}

export function fmtCcy(p: ValueFormatterParams): string {
  const v = num(p);
  return v == null ? '' : `$${Math.round(v).toLocaleString('en-US')}`;
}

export function fmtSignedCcy(p: ValueFormatterParams): string {
  const v = num(p);
  if (v == null) return '';
  const sign = v >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
}

export function fmtNum(p: ValueFormatterParams): string {
  const v = num(p);
  return v == null ? '' : v.toLocaleString('en-US');
}

export function fmtBp(p: ValueFormatterParams): string {
  const v = num(p);
  return v == null ? '' : `${v.toFixed(2)} bp`;
}
