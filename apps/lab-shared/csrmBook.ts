import type { LabRow } from './columns';

const ASSET_CLASSES = ['IG Credit', 'HY Credit', 'Rates', 'EM', 'Muni'];
const SECTORS = ['Financials', 'Energy', 'Technology', 'Healthcare', 'Utilities', 'Industrials'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];
const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B'];
const BOOKS = ['PROP', 'FLOW', 'HF', 'INS'];
const TRADERS = ['patel', 'okafor', 'lindqvist', 'tanaka', 'reyes', 'novak'];

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLabBook(rowCount: number, seed = 20260807): LabRow[] {
  const rng = mulberry32(seed);
  const rows: LabRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const mid = 80 + rng() * 40;
    const spread = 0.05 + rng() * 0.4;
    const face = Math.round((1 + rng() * 9) * 1_000_000);
    const avgCost = mid - (rng() - 0.5) * 2;
    const marketValue = Math.round(face * (mid / 100));
    const unrealized = Math.round(face * ((mid - avgCost) / 100));
    const daily = Math.round((rng() - 0.5) * 80_000);
    rows.push({
      id: `LAB-${String(i).padStart(5, '0')}`,
      cusip: `${String(100000000 + i).slice(0, 9)}`,
      ticker: `T${String(i % 180).padStart(3, '0')}`,
      instrumentDescription: `${SECTORS[i % SECTORS.length]} ${2028 + (i % 12)} ${RATINGS[i % RATINGS.length]}`,
      assetClass: ASSET_CLASSES[i % ASSET_CLASSES.length]!,
      issuerSector: SECTORS[i % SECTORS.length]!,
      currency: CURRENCIES[i % CURRENCIES.length]!,
      compositeRating: RATINGS[i % RATINGS.length]!,
      book: BOOKS[i % BOOKS.length]!,
      trader: TRADERS[i % TRADERS.length]!,
      bidPrice: mid - spread / 2,
      midPrice: mid,
      askPrice: mid + spread / 2,
      lastPrice: mid + (rng() - 0.5) * 0.2,
      priceChangePct: (rng() - 0.5) * 1.5,
      yieldToMaturity: 3 + rng() * 5,
      oas: 40 + rng() * 220,
      modifiedDuration: 1 + rng() * 12,
      dv01: Math.round(face * 0.0001 * (1 + rng())),
      quantityFace: face,
      marketValue,
      avgCost,
      unrealizedPnL: unrealized,
      dailyPnL: daily,
      mtdPnL: daily * (5 + Math.floor(rng() * 10)),
      ytdPnL: daily * (40 + Math.floor(rng() * 80)),
      maturityDate: `${2027 + (i % 15)}-${String((i % 12) + 1).padStart(2, '0')}-15`,
      lastUpdate: Date.now(),
    });
  }
  return rows;
}

export interface CsrmTickHandle {
  stop: () => void;
  pause: () => void;
  resume: () => void;
  get paused(): boolean;
  get tickMs(): number;
}

export interface CsrmTickOpts {
  rows: LabRow[];
  updateIntervalMs?: number;
  enableUpdates?: boolean;
  /** Apply a batch of updated row copies (host calls applyTransactionAsync). */
  onTick: (update: LabRow[]) => void;
  setTicker?: (cb: () => void, ms: number) => unknown;
  clearTicker?: (handle: unknown) => void;
}

/** Markets startMock–style CSRM ticker: mutate ~1–4% of the book per interval. */
export function startCsrmTicks(opts: CsrmTickOpts): CsrmTickHandle {
  const setTicker = opts.setTicker ?? ((cb, ms) => setInterval(cb, ms));
  const clearTicker = opts.clearTicker ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const interval = opts.updateIntervalMs ?? 500;
  const rng = mulberry32(99);
  let handle: unknown = null;
  let paused = !(opts.enableUpdates ?? true);

  const tick = () => {
    if (paused || opts.rows.length === 0) return;
    const n = Math.max(1, Math.floor(opts.rows.length * (0.01 + rng() * 0.03)));
    const update: LabRow[] = [];
    for (let i = 0; i < n; i++) {
      const row = opts.rows[Math.floor(rng() * opts.rows.length)]!;
      // Drift wide enough that |Δ mid| > 0.05 fires the Diff curriculum often.
      const drift = (rng() - 0.5) * 0.5;
      row.midPrice = Math.max(1, row.midPrice + drift);
      row.bidPrice = row.midPrice - 0.08;
      row.askPrice = row.midPrice + 0.08;
      row.lastPrice = row.midPrice + (rng() - 0.5) * 0.05;
      row.priceChangePct += drift * 0.1;
      row.yieldToMaturity = Math.max(0.1, row.yieldToMaturity + drift * 0.05);
      row.marketValue = Math.round(row.quantityFace * (row.midPrice / 100));
      const pnlDelta = Math.round(drift * 8_000);
      row.dailyPnL += pnlDelta;
      row.unrealizedPnL += pnlDelta;
      row.lastUpdate = Date.now();
      update.push({ ...row });
    }
    opts.onTick(update);
  };

  const start = () => {
    if (handle !== null) return;
    if (!(opts.enableUpdates ?? true)) return;
    handle = setTicker(tick, interval);
  };

  if (!paused) start();

  return {
    stop: () => {
      if (handle !== null) {
        clearTicker(handle);
        handle = null;
      }
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      start();
    },
    get paused() {
      return paused;
    },
    get tickMs() {
      return interval;
    },
  };
}
