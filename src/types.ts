export interface PositionRow {
  positionId: string;
  cusip: string;
  ticker: string;
  instrumentName: string;
  instrumentType: string;
  productFamily: string;
  bookName: string;
  portfolio: string;
  trader: string;
  desk: string;
  region: string;
  country: string;
  currency: string;
  notionalAmount: number;
  marketValue: number;
  currentPrice: number;
  pnl: number;
  unrealizedPnl: number;
  realizedPnl: number;
  dailyPnl: number;
  mtdPnl: number;
  ytdPnl: number;
  yield: number;
  spread: number;
  dv01: number;
  pv01: number;
  cs01: number;
  rating?: {
    moody?: string;
    sp?: string;
    fitch?: string;
    composite?: string;
  };
  [key: string]: unknown;
}

export type StompPhase =
  | 'idle'
  | 'connecting'
  | 'snapshot'
  | 'live'
  | 'error'
  | 'disconnected';

export interface StompFeedState {
  phase: StompPhase;
  rowsReceived: number;
  liveUpdates: number;
  lastUpdateAt: number | null;
  error: string | null;
}

export interface StompFeedConfig {
  wsUrl: string;
  clientId: string;
  snapshotRows: number;
  /** Trigger rate segment — ~1000/rate ms between live frames */
  rate: number;
  batchSize: number;
  sparse: boolean;
  updatesPerTick: number;
}

export const DEFAULT_STOMP_CONFIG: StompFeedConfig = {
  wsUrl: 'ws://localhost:8081',
  clientId: 'TRADER001',
  snapshotRows: 3000,
  rate: 7,
  batchSize: 50,
  sparse: true,
  updatesPerTick: 100,
};
