import type { DataProviderConfig } from './ConfigBackend';

/** Demo catalog rows for CSRM bind + editor. */
export const SEED_PROVIDERS: DataProviderConfig[] = [
  {
    id: 'positions-mock',
    name: 'Positions (mock)',
    transport: 'mock',
    connection: { rowCount: 300, intervalMs: 300 },
    columnDefinitions: [
      { field: 'id', type: 'string' },
      { field: 'desk', type: 'string' },
      { field: 'ticker', type: 'string' },
      { field: 'pnl', type: 'number' },
      { field: 'dailyPnl', type: 'number' },
    ],
  },
  {
    id: 'positions-stomp',
    name: 'Positions (stomp → mock)',
    transport: 'stomp',
    connection: {
      brokerURL: '{{env.brokerUrl}}',
      topic: '/topic/positions',
      rowCount: 200,
    },
    columnDefinitions: [
      { field: 'id', type: 'string' },
      { field: 'desk', type: 'string' },
      { field: 'ticker', type: 'string' },
      { field: 'pnl', type: 'number' },
    ],
  },
  {
    id: 'positions-perspective',
    name: 'Positions (perspective)',
    transport: 'perspective',
    connection: { table: 'positions' },
  },
];
