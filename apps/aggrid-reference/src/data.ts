/**
 * The SAME dataset VelocityGrid's provider demos show, generated locally and
 * deterministically.
 *
 * Deliberately not the live STOMP feed. A side-by-side comparison is only
 * meaningful if both grids hold identical rows — with a live feed the two
 * would diverge within a tick and every difference would need arguing about.
 * A seeded generator makes any behavioural difference attributable to the
 * grid rather than to the data.
 *
 * Column shape matches `apps/provider-demo-shared/providerCatalog.ts` exactly.
 */

export interface PositionRow {
  positionId: string;
  ticker: string;
  desk: string;
  region: string;
  instrumentType: string;
  notionalAmount: number;
  marketValue: number;
  pnl: number;
  dailyPnl: number;
}

const DESKS = ['FX', 'Rates', 'Credit', 'Equities', 'Commodities'];
const REGIONS = ['EMEA', 'AMER', 'APAC'];
const INSTRUMENTS = ['Bond', 'Swap', 'Future', 'Option', 'Repo'];

/** Deterministic PRNG so both grids and every run see identical rows. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRows(count: number, seed = 42): PositionRow[] {
  const rnd = mulberry32(seed);
  const rows: PositionRow[] = [];
  for (let i = 0; i < count; i++) {
    const notional = Math.round(rnd() * 5_000_000) + 100_000;
    const pnl = Math.round((rnd() - 0.5) * 400_000);
    rows.push({
      positionId: `POS-${String(i).padStart(6, '0')}`,
      ticker: `TICK${Math.floor(rnd() * 900) + 100}`,
      desk: DESKS[Math.floor(rnd() * DESKS.length)]!,
      region: REGIONS[Math.floor(rnd() * REGIONS.length)]!,
      instrumentType: INSTRUMENTS[Math.floor(rnd() * INSTRUMENTS.length)]!,
      notionalAmount: notional,
      marketValue: notional + pnl,
      pnl,
      dailyPnl: Math.round((rnd() - 0.5) * 40_000),
    });
  }
  return rows;
}

// ── Tree data ────────────────────────────────────────────────────────────
// AG Grid tree data is a flat array where each row carries its own path.
// VelocityGrid has no equivalent: `treeData` / `getDataPath` appear nowhere in
// the kernel, so there is nothing to put beside this.

export interface TreeRow extends PositionRow {
  path: string[];
}

export function makeTreeRows(): TreeRow[] {
  const rows = makeRows(240, 7);
  return rows.map((r, i) => ({
    ...r,
    // desk / region / book / position — a real book hierarchy, not a flat group.
    path: [r.desk, r.region, `Book ${(i % 4) + 1}`, r.positionId],
  }));
}

// ── Master detail ────────────────────────────────────────────────────────
// Each master row owns a nested grid of its own child rows.

export interface TradeRow {
  tradeId: string;
  positionId: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  tradeDate: string;
}

export function makeTrades(positionId: string, seed: number): TradeRow[] {
  const rnd = mulberry32(seed);
  const n = 3 + Math.floor(rnd() * 6);
  const out: TradeRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      tradeId: `${positionId}-T${i}`,
      positionId,
      side: rnd() > 0.5 ? 'BUY' : 'SELL',
      quantity: Math.round(rnd() * 10_000) + 100,
      price: Math.round(rnd() * 20_000) / 100,
      tradeDate: new Date(2026, 0, 1 + Math.floor(rnd() * 240)).toISOString().slice(0, 10),
    });
  }
  return out;
}

/** A stable seed per position so expanding the same row twice shows the same
 *  trades — the comparison must not depend on when you clicked. */
export function seedFor(positionId: string): number {
  let h = 0;
  for (let i = 0; i < positionId.length; i++) h = (h * 31 + positionId.charCodeAt(i)) | 0;
  return Math.abs(h);
}
