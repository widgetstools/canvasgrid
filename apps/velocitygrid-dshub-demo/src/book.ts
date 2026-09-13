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

/**
 * Years of duration per tenor, which is what DV01 is proportional to.
 *
 * The whole point of a DV01-weighted spread is that a long bond carries far
 * more risk per dollar than a short one, so it should dominate the average. If
 * DV01 were independent of tenor the weighted and unweighted averages would
 * land on the same number and the demo would demonstrate nothing.
 */
const DURATION: Record<string, number> = { '2Y': 1.9, '5Y': 4.5, '10Y': 8.2, '30Y': 19.5 };
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
    const tenor = TENORS[Math.floor(r() * TENORS.length)]!;
    const years = DURATION[tenor]!;
    const notional = Math.round((r() * 45 + 5) * 1e6);
    return {
      id: `POS-${String(i).padStart(6, '0')}`,
      desk,
      region: REGIONS[Math.floor(r() * REGIONS.length)]!,
      tenor,
      ticker: `TICK${String(Math.floor(r() * 900) + 100)}`,
      rating: RATINGS[Math.min(RATINGS.length - 1, Math.floor(riskiness * 4 + r() * 2))]!,
      notional,
      // Credit curves slope up, so the long end trades wider within a desk.
      // Together with DV01 rising in tenor, this is what separates the
      // weighted average from the plain one — the long, wide, risk-heavy
      // positions pull it up, which is exactly the number a desk wants.
      spread: Math.round((riskiness * 320 + years * 4.5 + r() * 60 + 8) * 10) / 10,
      // DV01 = notional x duration x 1bp, in whole currency units.
      dv01: Math.round(notional * years * 1e-4 * 10) / 10,
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
