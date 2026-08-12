import type { DataProviderConfig } from '../catalog/ConfigBackend';

export type MockTick = {
  updates: Array<Record<string, unknown>>;
};

export type MockTransportHandle = {
  stop: () => void;
  restart: () => void;
  getSnapshot: () => Array<Record<string, unknown>>;
};

/**
 * In-process mock feed — snapshot + live ticks for CSRM bind demos.
 */
export function startMockTransport(
  cfg: DataProviderConfig,
  opts: {
    onTick?: (tick: MockTick) => void;
    rowCount?: number;
    intervalMs?: number;
  } = {},
): MockTransportHandle {
  const n = opts.rowCount
    ?? Number(cfg.connection?.rowCount)
    ?? 200;
  const intervalMs = opts.intervalMs
    ?? Number(cfg.connection?.intervalMs)
    ?? 250;

  let rows = buildRows(cfg, n);
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const start = (): void => {
    if (timer || stopped) return;
    timer = setInterval(() => {
      if (stopped || !rows.length) return;
      const updates: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 3; i++) {
        const idx = Math.floor(Math.random() * rows.length);
        const prev = rows[idx]!;
        const next = {
          ...prev,
          pnl: Math.round((Math.random() - 0.5) * 100000) / 100,
        };
        rows[idx] = next;
        updates.push(next);
      }
      opts.onTick?.({ updates });
    }, intervalMs);
  };

  start();

  return {
    getSnapshot: () => rows.slice(),
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    restart: () => {
      stopped = false;
      if (!rows.length) rows = buildRows(cfg, n);
      start();
    },
  };
}

function buildRows(
  cfg: DataProviderConfig,
  n: number,
): Array<Record<string, unknown>> {
  const cols = cfg.columnDefinitions?.length
    ? cfg.columnDefinitions
    : [
      { field: 'id', type: 'string' },
      { field: 'desk', type: 'string' },
      { field: 'ticker', type: 'string' },
      { field: 'pnl', type: 'number' },
      { field: 'dailyPnl', type: 'number' },
    ];
  const desks = ['EQ', 'FX', 'FI'];
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {};
    for (const c of cols) {
      if (c.field === 'id' || c.field === 'positionId') {
        row[c.field] = `M${String(i).padStart(4, '0')}`;
      } else if (c.field === 'desk') {
        row.desk = desks[i % desks.length];
      } else if (c.field === 'ticker') {
        row.ticker = `T${i % 40}`;
      } else if (c.type === 'number' || c.field === 'pnl' || c.field === 'dailyPnl') {
        row[c.field] = Math.round((Math.random() - 0.5) * 50000) / 100;
      } else {
        row[c.field] = `${c.field}-${i}`;
      }
    }
    if (!('id' in row) && !('positionId' in row)) row.id = `M${i}`;
    out.push(row);
  }
  return out;
}
