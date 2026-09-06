/**
 * Market scenarios — sparse overlays the demo console injects into the live
 * book.
 *
 * Each one is a real thing that happens to a credit desk, and each is chosen
 * to make a specific grid behaviour visible: a rally proves the flash mask and
 * the damage-region repaint, a downgrade proves conditional rules re-evaluate
 * off a non-numeric field, a liquidity gap proves a formatter can widen
 * without relayout. They return only the rows they touch, so the overlay stays
 * a transaction rather than a re-snapshot.
 */
import type { BlotterRow } from './domain';

export interface Scenario {
  id: string;
  title: string;
  description: string;
  tone: 'positive' | 'negative' | 'warning' | 'info';
  apply: (rows: readonly BlotterRow[]) => BlotterRow[];
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Re-derive everything downstream of price so an overlay never leaves the
 *  row internally inconsistent (a yield that disagrees with its price is the
 *  fastest way to lose a fixed-income audience). */
function reprice(row: BlotterRow, mid: number): BlotterRow {
  const half = round(Math.max(0.01, (row.askPrice - row.bidPrice) / 2), 3);
  const marketValue = Math.round((row.quantityFace * mid) / 100);
  return {
    ...row,
    midPrice: round(mid, 3),
    bidPrice: round(mid - half, 3),
    askPrice: round(mid + half, 3),
    lastPrice: round(mid, 3),
    priceChange: round(mid - row.midPrice, 4),
    priceChangePct: round(((mid - row.midPrice) / row.midPrice) * 100, 3),
    yieldToMaturity: round(Math.max(0.1, row.couponRate + (100 - mid) / Math.max(row.modifiedDuration, 1) * 0.9), 3),
    marketValue,
    unrealizedPnL: Math.round(((mid - row.avgCost) / 100) * row.quantityFace),
    lastUpdate: Date.now(),
  };
}

const take = (rows: readonly BlotterRow[], pred: (r: BlotterRow) => boolean, limit: number) =>
  rows.filter(pred).slice(0, limit);

export const SCENARIOS: Scenario[] = [
  {
    id: 'rally',
    title: 'Duration rally',
    description: 'Long-duration paper bid up 1.5 points. Prices rise, yields fall, P&L turns green across the risk columns.',
    tone: 'positive',
    apply: (rows) => take(rows, (r) => r.modifiedDuration > 8, 220).map((r) => reprice(r, r.midPrice + 1.5)),
  },
  {
    id: 'selloff',
    title: 'Credit selloff',
    description: 'High yield gaps 2 points lower. Watch the negative-money format flip to red parentheses.',
    tone: 'negative',
    apply: (rows) =>
      take(rows, (r) => ['BB+', 'BB', 'BB-', 'B+', 'B'].includes(r.compositeRating), 220)
        .map((r) => reprice(r, Math.max(20, r.midPrice - 2))),
  },
  {
    id: 'downgrade',
    title: 'Sector downgrade',
    description: 'Financials cut one notch and spreads widen 35 bps. Nothing numeric moves first — the rating text does.',
    tone: 'warning',
    apply: (rows) => {
      const order = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B'];
      return take(rows, (r) => r.issuerSector === 'Financials', 260).map((r) => {
        const i = order.indexOf(r.compositeRating);
        return {
          ...r,
          compositeRating: order[Math.min(order.length - 1, i + 1)] ?? r.compositeRating,
          oas: round(r.oas + 35, 2),
          zSpread: round(r.zSpread + 35, 2),
          lastUpdate: Date.now(),
        };
      });
    },
  },
  {
    id: 'liquidity',
    title: 'Liquidity gap',
    description: 'Market makers step back: bid/ask widens eightfold and sizes collapse. The B/A column is a derived value, so it recomputes without a round trip.',
    tone: 'warning',
    apply: (rows) =>
      take(rows, (r) => r.assetClass === 'Corporate' || r.assetClass === 'EM', 240).map((r) => {
        const half = round(((r.askPrice - r.bidPrice) / 2) * 8, 3);
        return {
          ...r,
          bidPrice: round(r.midPrice - half, 3),
          askPrice: round(r.midPrice + half, 3),
          bidSize: Math.round(r.bidSize * 0.15),
          askSize: Math.round(r.askSize * 0.15),
          lastUpdate: Date.now(),
        };
      }),
  },
  {
    id: 'curve',
    title: 'Curve steepener',
    description: 'The long end sells off while the front end holds. Key-rate durations diverge — visible in one glance on the KRD chart renderer.',
    tone: 'info',
    apply: (rows) =>
      take(rows, () => true, 300).map((r) => {
        const long = r.modifiedDuration > 7;
        const next = reprice(r, long ? r.midPrice - 0.9 : r.midPrice + 0.15);
        return { ...next, krd10Y: round(r.krd10Y * 1.18, 3), krd30Y: round(r.krd30Y * 1.31, 3) };
      }),
  },
  {
    id: 'settle',
    title: 'Back to normal',
    description: 'Clear the overlay: prices drift back toward where the generator left them.',
    tone: 'info',
    apply: (rows) => take(rows, () => true, 400).map((r) => reprice(r, r.avgCost + (r.midPrice - r.avgCost) * 0.35)),
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);
