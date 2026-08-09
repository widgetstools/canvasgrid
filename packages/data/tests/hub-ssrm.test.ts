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
  it('pages getRows and soft-refreshes on ticks', async () => {
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
});
