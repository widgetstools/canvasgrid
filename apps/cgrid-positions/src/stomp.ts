import { Client, type IMessage } from '@stomp/stompjs';

export interface Position {
  positionId: string;
  cusip: string;
  ticker: string;
  notionalAmount: number;
  marketValue: number;
  currentPrice: number;
  pnl: number;
  dailyPnl: number;
  unrealizedPnl: number;
  yield: number;
  spread: number;
  dv01: number;
  pv01: number;
}

export interface StompCallbacks {
  onSnapshot: (rows: Position[]) => void;
  onLiveUpdate: (updates: Position[]) => void;
  onPhase: (phase: 'connecting' | 'snapshot' | 'live' | 'error' | 'disconnected') => void;
}

const DEFAULTS = {
  wsUrl: 'ws://localhost:8081',
  clientId: 'TRADER001',
  snapshotRows: 3000,
  rate: 7,
  batchSize: 50,
  sparse: true,
  updatesPerTick: 100,
};

export function connectStomp(cb: StompCallbacks) {
  cb.onPhase('connecting');
  const buffer: Position[] = [];
  const client = new Client({
    brokerURL: DEFAULTS.wsUrl,
    reconnectDelay: 2000,
  });

  client.onConnect = () => {
    cb.onPhase('snapshot');
    const snapshotDest = `/snapshot/positions/${DEFAULTS.clientId}`;
    const liveDest = `/topic/positions/${DEFAULTS.clientId}`;

    client.subscribe(snapshotDest, (msg: IMessage) => {
      const rows = JSON.parse(msg.body) as Position[];
      cb.onSnapshot(rows);
      cb.onPhase('live');
    }, {
      'snapshot-rows': String(DEFAULTS.snapshotRows),
      'sparse': String(DEFAULTS.sparse),
      'rate': String(DEFAULTS.rate),
      'updates-per-tick': String(DEFAULTS.updatesPerTick),
    });

    client.subscribe(liveDest, (msg: IMessage) => {
      const updates = JSON.parse(msg.body) as Position[];
      buffer.push(...updates);
      if (buffer.length >= DEFAULTS.batchSize) {
        cb.onLiveUpdate(buffer.splice(0));
      }
    });
  };

  client.onStompError = (frame) => {
    console.error('[stomp] error:', frame.headers['message']);
    cb.onPhase('error');
  };

  client.onWebSocketClose = () => cb.onPhase('disconnected');

  client.activate();
  return { client, disconnect: () => client.deactivate() };
}
