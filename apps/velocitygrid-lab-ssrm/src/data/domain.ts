/**
 * The lab's subject: a fixed-income credit blotter.
 *
 * Ported from the MarketsGrid lab's domain so the two labs demonstrate the
 * same use case — identifiers, reference data, a two-sided market, yields and
 * spreads, risk analytics, quantities and P&L. Numbers are synthetic but the
 * relationships are not: yield moves inversely to price, DV01 scales with
 * duration and notional, unrealized P&L follows (mid − avg cost) × quantity.
 * A demo that ticks nonsense teaches the grid but not the domain.
 */

export interface BlotterRow {
  id: string;

  // Identifier
  cusip: string;
  isin: string;
  ticker: string;
  instrumentDescription: string;

  // Reference
  assetClass: string;
  issuerSector: string;
  issuerSubSector: string;
  issuerCountryCode: string;
  currency: string;
  compositeRating: string;
  seniority: string;
  couponRate: number;
  issueDate: string;
  maturityDate: string;

  // Pricing (two-sided market)
  bidPrice: number;
  midPrice: number;
  askPrice: number;
  lastPrice: number;
  priceChange: number;
  priceChangePct: number;
  bidSize: number;
  askSize: number;

  // Yields & spreads
  yieldToMaturity: number;
  yieldToWorst: number;
  currentYield: number;
  benchmarkYield: number;
  oas: number;
  zSpread: number;
  iSpread: number;

  // Risk
  modifiedDuration: number;
  dv01: number;
  convexity: number;
  cs01: number;
  krd1Y: number;
  krd2Y: number;
  krd5Y: number;
  krd10Y: number;
  krd30Y: number;

  // Quantities & cost
  quantityFace: number;
  marketValue: number;
  avgCost: number;
  accruedInterest: number;
  avgDailyVolume30d: number;

  // P&L
  unrealizedPnL: number;
  dailyPnL: number;
  mtdPnL: number;
  ytdPnL: number;

  // Status & book
  book: string;
  trader: string;
  accountName: string;
  analyst: string;
  desk: string;
  region: string;
  lastUpdate: number;
}

const ASSET_CLASSES = ['Corporate', 'Sovereign', 'Securitized', 'Municipal', 'Agency', 'EM'];
const SECTORS = ['Financials', 'Energy', 'Technology', 'Healthcare', 'Utilities', 'Industrials', 'Consumer', 'Real Estate'];
const SUB_SECTORS: Record<string, string[]> = {
  Financials: ['Banking', 'Insurance', 'Brokerage'],
  Energy: ['Integrated', 'Midstream', 'Refining'],
  Technology: ['Software', 'Semiconductors', 'Hardware'],
  Healthcare: ['Pharma', 'Providers', 'Devices'],
  Utilities: ['Electric', 'Gas', 'Water'],
  Industrials: ['Aerospace', 'Transport', 'Machinery'],
  Consumer: ['Retail', 'Staples', 'Autos'],
  'Real Estate': ['REIT', 'Development'],
};
const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'JP', 'CA', 'AU', 'NL', 'IT', 'ES'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
// Investment grade through high yield, in credit order — the order matters:
// the rating renderer and the conditional-styling rules both band on it.
export const RATINGS = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B'];
const SENIORITY = ['Senior Unsecured', 'Senior Secured', 'Subordinated', 'Covered'];
const BOOKS = ['CREDIT-01', 'CREDIT-02', 'RATES-01', 'STRUCT-01', 'EM-01'];
const TRADERS = ['A. Okafor', 'M. Lindqvist', 'R. Baptiste', 'S. Nakamura', 'D. Ferreira', 'K. Whitfield'];
const ANALYSTS = ['J. Moreau', 'P. Aggarwal', 'L. Sandoval', 'T. Bergström'];
const ACCOUNTS = ['Prop Trading', 'Client Facilitation', 'Treasury', 'Market Making'];
const DESKS = ['Credit', 'Rates', 'Securitized', 'Emerging Markets'];
const REGIONS = ['Americas', 'EMEA', 'APAC'];

/** Deterministic PRNG — a lab that reshuffles on reload is impossible to
 *  screenshot, diff or write an e2e assertion against. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const pick = <T,>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const between = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo);
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** The one yield formula, shared by the generator and the ticker. */
function yieldFor(coupon: number, mid: number, duration: number): number {
  return round(Math.max(0.1, coupon + ((100 - mid) / Math.max(duration, 1)) * 0.9), 3);
}

function cusip(rng: () => number): string {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 9; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

/** Ratings drive spread: a BB bond does not trade 40 bps over the curve. */
function spreadForRating(rating: string, rng: () => number): number {
  const idx = RATINGS.indexOf(rating);
  const base = 18 + idx * idx * 2.6;
  return round(base * between(rng, 0.75, 1.3), 2);
}

export function makeRow(i: number, rng: () => number, nowMs = Date.now()): BlotterRow {
  const sector = pick(rng, SECTORS);
  const rating = pick(rng, RATINGS);
  const currency = pick(rng, CURRENCIES);
  const assetClass = pick(rng, ASSET_CLASSES);
  const coupon = round(between(rng, 0.5, 8.5), 3);
  const years = Math.round(between(rng, 1, 30));
  const maturity = new Date(Date.UTC(2026 + years, Math.floor(rng() * 12), 1 + Math.floor(rng() * 27)));
  const issue = new Date(Date.UTC(2026 - Math.round(between(rng, 1, 8)), Math.floor(rng() * 12), 1 + Math.floor(rng() * 27)));

  const mid = round(between(rng, 82, 118), 3);
  const halfSpread = round(between(rng, 0.02, 0.45), 3);
  const bid = round(mid - halfSpread, 3);
  const ask = round(mid + halfSpread, 3);
  const priceChange = round(between(rng, -1.6, 1.6), 4);

  // Yield falls as price rises — the single most visible domain invariant on
  // the screen, and the one a fixed-income developer checks first. Duration is
  // resolved BEFORE the yield because both `makeRow` and `tickRow` must divide
  // by the same thing; when they disagreed, the first tick re-based the yield
  // and could move it the same way as the price.
  const duration = round(Math.min(years * 0.82, between(rng, 0.9, 18)), 2);
  const ytm = yieldFor(coupon, mid, duration);
  const benchmarkYield = round(Math.max(0.05, ytm - between(rng, 0.3, 2.4)), 3);

  const face = Math.round(between(rng, 250, 25_000)) * 1000;
  const marketValue = Math.round((face * mid) / 100);
  const avgCost = round(mid - between(rng, -4, 4), 3);
  const dv01 = round((duration * marketValue) / 10_000 / 100, 4);
  const unrealized = Math.round(((mid - avgCost) / 100) * face);

  const oas = spreadForRating(rating, rng);

  return {
    id: `POS-${String(i).padStart(6, '0')}`,
    cusip: cusip(rng),
    isin: `${pick(rng, COUNTRIES)}${cusip(rng)}${Math.floor(rng() * 10)}`,
    ticker: `${sector.slice(0, 2).toUpperCase()}${Math.floor(between(rng, 100, 9999))}`,
    instrumentDescription: `${sector} ${maturity.getUTCFullYear()} ${coupon.toFixed(3)}%`,
    assetClass,
    issuerSector: sector,
    issuerSubSector: pick(rng, SUB_SECTORS[sector] ?? ['General']),
    issuerCountryCode: pick(rng, COUNTRIES),
    currency,
    compositeRating: rating,
    seniority: pick(rng, SENIORITY),
    couponRate: coupon,
    issueDate: issue.toISOString().slice(0, 10),
    maturityDate: maturity.toISOString().slice(0, 10),

    bidPrice: bid,
    midPrice: mid,
    askPrice: ask,
    lastPrice: round(mid + between(rng, -0.1, 0.1), 3),
    priceChange,
    priceChangePct: round((priceChange / mid) * 100, 3),
    bidSize: Math.round(between(rng, 1, 50)) * 100_000,
    askSize: Math.round(between(rng, 1, 50)) * 100_000,

    yieldToMaturity: ytm,
    yieldToWorst: round(ytm + between(rng, 0, 0.4), 3),
    currentYield: round((coupon / mid) * 100, 3),
    benchmarkYield,
    oas,
    zSpread: round(oas + between(rng, -6, 9), 2),
    iSpread: round(oas + between(rng, -9, 6), 2),

    modifiedDuration: duration,
    dv01,
    convexity: round(duration * duration * 0.11, 2),
    cs01: round(dv01 * between(rng, 0.7, 1.25), 4),
    krd1Y: round(duration * 0.05, 3),
    krd2Y: round(duration * 0.12, 3),
    krd5Y: round(duration * 0.28, 3),
    krd10Y: round(duration * 0.34, 3),
    krd30Y: round(duration * 0.21, 3),

    quantityFace: face,
    marketValue,
    avgCost,
    accruedInterest: round((coupon / 2) * between(rng, 0.05, 0.95), 4),
    avgDailyVolume30d: Math.round(between(rng, 0.5, 40)) * 100_000,

    unrealizedPnL: unrealized,
    dailyPnL: Math.round(unrealized * between(rng, -0.16, 0.16)),
    mtdPnL: Math.round(unrealized * between(rng, -0.5, 0.6)),
    ytdPnL: Math.round(unrealized * between(rng, -1.1, 1.4)),

    book: pick(rng, BOOKS),
    trader: pick(rng, TRADERS),
    accountName: pick(rng, ACCOUNTS),
    analyst: pick(rng, ANALYSTS),
    desk: pick(rng, DESKS),
    region: pick(rng, REGIONS),
    lastUpdate: nowMs,
  };
}

/** `nowMs` is a parameter so that "same seed, same rows" is literally true —
 *  a wall-clock read inside the generator would make the book differ on every
 *  call and quietly break every screenshot and assertion built on it. */
export function makeRows(count: number, seed = 20260906, nowMs = Date.now()): BlotterRow[] {
  const rng = makeRng(seed);
  return Array.from({ length: count }, (_, i) => makeRow(i, rng, nowMs));
}

/**
 * One market tick against an existing row: re-price, then recompute everything
 * downstream of price. Returns a NEW object — the grid diffs by row id, and
 * mutating in place would defeat both the flash mask and the raster cache.
 */
export function tickRow(row: BlotterRow, rng: () => number): BlotterRow {
  const drift = between(rng, -0.22, 0.22);
  const mid = round(Math.max(1, row.midPrice + drift), 3);
  const halfSpread = round(Math.max(0.01, (row.askPrice - row.bidPrice) / 2 + between(rng, -0.01, 0.01)), 3);
  const priceChange = round(row.priceChange + drift, 4);
  const ytm = yieldFor(row.couponRate, mid, row.modifiedDuration);
  const marketValue = Math.round((row.quantityFace * mid) / 100);
  const unrealized = Math.round(((mid - row.avgCost) / 100) * row.quantityFace);

  return {
    ...row,
    bidPrice: round(mid - halfSpread, 3),
    midPrice: mid,
    askPrice: round(mid + halfSpread, 3),
    lastPrice: round(mid + between(rng, -0.08, 0.08), 3),
    priceChange,
    priceChangePct: round((priceChange / mid) * 100, 3),
    yieldToMaturity: ytm,
    yieldToWorst: round(ytm + 0.12, 3),
    currentYield: round((row.couponRate / mid) * 100, 3),
    oas: round(Math.max(1, row.oas + between(rng, -2.5, 2.5)), 2),
    zSpread: round(Math.max(1, row.zSpread + between(rng, -2.5, 2.5)), 2),
    marketValue,
    unrealizedPnL: unrealized,
    dailyPnL: Math.round(row.dailyPnL + unrealized * between(rng, -0.03, 0.03)),
    lastUpdate: Date.now(),
  };
}
