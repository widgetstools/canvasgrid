/**
 * A synthetic fixed-income book, and a feed that moves it.
 *
 * Self-contained on purpose. The other provider demos need a STOMP fixture
 * running before they show anything; this one is meant to be the shortest
 * path to seeing the Rust hub actually drive a grid, so it generates its own
 * book and ticks it in-process.
 *
 * Shaped like a credit desk's blotter rather than generic rows, because the
 * thing worth demonstrating — weighted averages over computed columns — only
 * means something if the columns are the ones a desk reads.
 */

export interface Position {
  id: string;
  desk: string;
  region: string;
  tenor: string;
  ticker: string;
  rating: string;
  notional: number;
  /** Basis points over the benchmark curve. */
  spread: number;
  /** Price value of a basis point — the weight in a weighted average. */
  dv01: number;
  pnl: number;
}

const DESKS = ['Rates', 'IG Credit', 'HY Credit', 'EM', 'Munis'];
const REGIONS = ['Americas', 'EMEA', 'APAC'];
const TENORS = ['2Y', '5Y', '10Y', '30Y'];
const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B'];

/** Deterministic, so a reload shows the same book. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function makeBook(n: number, seed = 7): Position[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const desk = DESKS[i % DESKS.length]!;
    // Spread scales with credit risk, so the grouped averages differ visibly
    // between desks instead of all landing on the same number.
    const riskiness = DESKS.indexOf(desk) / (DESKS.length - 1);
    return {
      id: `POS-${String(i).padStart(6, '0')}`,
      desk,
      region: REGIONS[Math.floor(r() * REGIONS.length)]!,
      tenor: TENORS[Math.floor(r() * TENORS.length)]!,
      ticker: `TICK${String(Math.floor(r() * 900) + 100)}`,
      rating: RATINGS[Math.min(RATINGS.length - 1, Math.floor(riskiness * 4 + r() * 2))]!,
      notional: Math.round((r() * 45 + 5) * 1e6),
      spread: Math.round((riskiness * 320 + r() * 90 + 8) * 10) / 10,
      dv01: Math.round((r() * 480 + 20) * 10) / 10,
      pnl: Math.round((r() - 0.48) * 900_000),
    };
  });
}

/**
 * Move a slice of the book, the way a feed would.
 *
 * Returns whole rows: the engine's ingest is an upsert by key, and a partial
 * row would blank the columns it omits.
 */
export function tickRows(book: readonly Position[], count: number, clock: number): Position[] {
  const out: Position[] = [];
  const r = rng(clock * 2654435761);
  for (let k = 0; k < count; k++) {
    const i = Math.floor(r() * book.length);
    const row = book[i]!;
    const drift = (r() - 0.5) * 6;
    out.push({
      ...row,
      spread: Math.max(1, Math.round((row.spread + drift) * 10) / 10),
      pnl: row.pnl + Math.round((r() - 0.5) * 120_000),
    });
  }
  return out;
}

/** Column metadata, in the plane's structural config shape. */
export const COLUMN_DEFINITIONS = [
  { field: 'id', headerName: 'Position' },
  { field: 'desk', headerName: 'Desk' },
  { field: 'region', headerName: 'Region' },
  { field: 'tenor', headerName: 'Tenor' },
  { field: 'ticker', headerName: 'Ticker' },
  { field: 'rating', headerName: 'Rating' },
  { field: 'notional', headerName: 'Notional', cellDataType: 'number' },
  { field: 'spread', headerName: 'Spread (bp)', cellDataType: 'number' },
  { field: 'dv01', headerName: 'DV01', cellDataType: 'number' },
  { field: 'pnl', headerName: 'P&L', cellDataType: 'number' },
] as const;
