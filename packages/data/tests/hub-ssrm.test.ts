import { afterEach, describe, expect, it } from 'vitest';
import { ProviderClientAdapter } from '../src/client/ProviderClientAdapter';
import { bindProviderToSsrmGrid } from '../src/client/bind';
import { _resetHubConnectionForTests } from '../src/client/hubConnection';
import { _resetTransportRegistryForTests } from '../src/registry/transports';
import { _resetDefaultTransportsFlagForTests } from '../src/transports/registerDefaults';
import type { DataProviderConfig } from '../src/types';

function reset(): void {
  _resetHubConnectionForTests();
  _resetTransportRegistryForTests();
  _resetDefaultTransportsFlagForTests();
}

afterEach(reset);

describe('hub SSRM query plane', () => {
  it('pages getRows and soft-refreshes on ticks when SSRM txs are unavailable', async () => {
    reset();
    const cfg: DataProviderConfig = {
      providerId: 'ssrm-1',
      name: 'ssrm',
      providerType: 'mock',
      rowModel: 'serverSide',
      blockSize: 10,
      config: {
        keyColumn: 'positionId',
        rowCount: 40,
        tickMs: 20,
        updatesPerTick: 2,
        throttleEnabled: false,
      },
    };
    const provider = new ProviderClientAdapter(cfg, { inProcess: true });
    let refreshed = 0;
    const { detach } = bindProviderToSsrmGrid(provider, {
      setServerSideDatasource() { /* bound */ },
      refreshServerSide() { refreshed += 1; },
    }, { blockSize: 10 });

    await provider.start();
    await new Promise((r) => setTimeout(r, 30));

    const page = await provider.getRows({ startRow: 0, endRow: 10 });
    expect(page.rowCount).toBe(40);
    expect(page.rowData).toHaveLength(10);

    await new Promise((r) => setTimeout(r, 50));
    expect(refreshed).toBeGreaterThan(0);

    detach();
    provider.destroy();
  });

  it('applies live ticks via applyServerSideTransaction when the host supports it', async () => {
    reset();
    const cfg: DataProviderConfig = {
      providerId: 'ssrm-tx',
      name: 'ssrm',
      providerType: 'mock',
      rowModel: 'serverSide',
      blockSize: 10,
      config: {
        keyColumn: 'positionId',
        rowCount: 40,
        tickMs: 20,
        updatesPerTick: 2,
        throttleEnabled: false,
      },
    };
    const provider = new ProviderClientAdapter(cfg, { inProcess: true });
    let refreshed = 0;
    let txUpdates = 0;
    const { detach } = bindProviderToSsrmGrid(provider, {
      setServerSideDatasource() { /* bound */ },
      refreshServerSide() { refreshed += 1; },
      applyServerSideTransaction(tx) {
        txUpdates += tx.update?.length ?? 0;
      },
    }, { blockSize: 10 });

    await provider.start();
    await new Promise((r) => setTimeout(r, 80));
    expect(txUpdates).toBeGreaterThan(0);
    // Soft refresh is skipped when txs are available (avoids wiping flash).
    expect(refreshed).toBe(0);

    detach();
    provider.destroy();
  });

  it('applies provider columnDefinitions onto the grid at SSRM bind', async () => {
    reset();
    const cfg: DataProviderConfig = {
      providerId: 'ssrm-cols',
      name: 'ssrm',
      providerType: 'mock',
      rowModel: 'serverSide',
      blockSize: 10,
      config: {
        keyColumn: 'positionId',
        rowCount: 5,
        tickMs: 0,
        columnDefinitions: [
          { field: 'positionId', headerName: 'Position', width: 120 },
          { field: 'pnl', headerName: 'PnL', cellDataType: 'number', sortable: true },
        ],
      },
    };
    const provider = new ProviderClientAdapter(cfg, { inProcess: true });
    let applied: unknown[] | undefined;
    const { detach } = bindProviderToSsrmGrid(provider, {
      setServerSideDatasource() { /* bound */ },
      setColumnDefs(defs) { applied = defs; },
    });

    expect(applied).toBeTruthy();
    expect(applied).toHaveLength(2);
    expect(applied![0]).toMatchObject({ field: 'positionId', headerName: 'Position', width: 120 });
    expect(applied![1]).toMatchObject({
      field: 'pnl',
      headerName: 'PnL',
      sortable: true,
      cellDataType: 'number',
    });

    detach();
    provider.destroy();
  });
});
