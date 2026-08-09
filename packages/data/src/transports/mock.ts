import type {
  MockTransportConfig,
  ProviderEmit,
  TransportContext,
  TransportHandle,
} from '../types';

function makeRow(i: number, shape: MockTransportConfig['shape']): Record<string, unknown> {
  const positionId = `POS-${String(i).padStart(6, '0')}`;
  const base = {
    /** Alias for grids that use getRowId: r => r.id (e.g. CSRM lab). */
    id: positionId,
    positionId,
    ticker: ['AAPL', 'MSFT', 'GOOG', 'TSLA', 'IBM'][i % 5],
    desk: ['RATES', 'CREDIT', 'EQ'][i % 3],
    notional: 1_000_000 + (i % 50) * 10_000,
    pnl: ((i % 17) - 8) * 1250.5,
    region: ['US', 'EU', 'APAC'][i % 3],
  };
  if (shape === 'trades') {
    const tradeId = `T-${i}`;
    return { ...base, id: tradeId, tradeId, qty: 100 + (i % 20) * 10 };
  }
  if (shape === 'orders') {
    const orderId = `O-${i}`;
    return { ...base, id: orderId, orderId, side: i % 2 ? 'BUY' : 'SELL' };
  }
  return base;
}

export function createMockTransport(
  cfg: MockTransportConfig,
  emit: ProviderEmit,
  _ctx: TransportContext,
): TransportHandle {
  const rowCount = cfg.rowCount ?? 1_000;
  const tickMs = cfg.tickMs ?? 250;
  const updatesPerTick = cfg.updatesPerTick ?? 5;
  const shape = cfg.shape ?? 'positions';
  if (cfg.keyColumn == null) {
    cfg.keyColumn = shape === 'trades' ? 'tradeId' : shape === 'orders' ? 'orderId' : 'positionId';
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const rows = Array.from({ length: rowCount }, (_, i) => makeRow(i, shape));

  const start = (): void => {
    if (stopped) return;
    emit({ status: 'connecting' });
    emit({ status: 'snapshot' });
    emit({ rows, replace: true });
    emit({ rowsReceived: rows.length });
    emit({ status: 'ready' });
    if (tickMs > 0) {
      timer = setInterval(() => {
        if (stopped) return;
        const patch: Record<string, unknown>[] = [];
        for (let u = 0; u < updatesPerTick; u++) {
          const i = Math.floor(Math.random() * rows.length);
          const row = { ...rows[i]!, pnl: (rows[i]!.pnl as number) + (Math.random() - 0.5) * 100 };
          rows[i] = row;
          patch.push(row);
        }
        emit({ rows: patch });
      }, tickMs);
    }
  };

  // Auto-start mock (no network).
  queueMicrotask(start);

  return {
    stop() {
      stopped = true;
      if (timer != null) clearInterval(timer);
      timer = null;
      emit({ status: 'disconnected' });
    },
    restart() {
      if (timer != null) clearInterval(timer);
      timer = null;
      stopped = false;
      start();
    },
  };
}
