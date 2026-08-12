import type { DataProviderConfig } from '../catalog/ConfigBackend';
import { registerDataProviderFeedControl } from '../hub/feedControl';
import { startMockTransport } from '../transports/mock';

export type BindableGrid = {
  setRowData: (rows: Record<string, unknown>[]) => void;
  applyTransaction?: (tx: { update?: Record<string, unknown>[] }) => void;
  applyTransactionAsync?: (tx: { update?: Record<string, unknown>[] }) => void;
  setColumnDefs?: (defs: Array<Record<string, unknown>>) => void;
};

export type BindHandle = {
  detach: () => void;
  providerId: string;
};

/**
 * Bind a resolved provider config to a CSRM grid.
 * Perspective transport is a no-op here — use StompPerspectiveProvider separately.
 */
export function bindProviderToGrid(
  grid: BindableGrid,
  cfg: DataProviderConfig,
): BindHandle {
  if (cfg.transport === 'perspective') {
    return { providerId: cfg.id, detach: () => undefined };
  }

  if (cfg.columnDefinitions?.length && grid.setColumnDefs) {
    grid.setColumnDefs(
      cfg.columnDefinitions.map((c) => ({
        field: c.field,
        headerName: c.field,
        width: 100,
        cellDataType: c.type === 'number' ? 'number' : 'text',
      })),
    );
  }

  if (cfg.transport === 'mock' || cfg.transport === 'rest' || cfg.transport === 'websocket') {
    const handle = startMockTransport(cfg, {
      onTick: (tick) => {
        if (grid.applyTransactionAsync) {
          grid.applyTransactionAsync({ update: tick.updates });
        } else {
          grid.applyTransaction?.({ update: tick.updates });
        }
      },
    });
    grid.setRowData(handle.getSnapshot());
    const unreg = registerDataProviderFeedControl(cfg.id, {
      stop: () => handle.stop(),
      restart: () => handle.restart(),
    });
    return {
      providerId: cfg.id,
      detach: () => {
        handle.stop();
        unreg();
      },
    };
  }

  // STOMP — seed mock until dedicated transport lands fully
  const handle = startMockTransport(cfg, {
    onTick: (tick) => {
      grid.applyTransactionAsync?.({ update: tick.updates })
        ?? grid.applyTransaction?.({ update: tick.updates });
    },
  });
  grid.setRowData(handle.getSnapshot());
  const unreg = registerDataProviderFeedControl(cfg.id, {
    stop: () => handle.stop(),
    restart: () => handle.restart(),
  });
  return {
    providerId: cfg.id,
    detach: () => {
      handle.stop();
      unreg();
    },
  };
}
