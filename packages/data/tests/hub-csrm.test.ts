import { afterEach, describe, expect, it } from 'vitest';
import { ProviderClientAdapter } from '../src/client/ProviderClientAdapter';
import { bindProviderToGrid } from '../src/client/bind';
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

function mockCfg(id: string): DataProviderConfig {
  return {
    providerId: id,
    name: id,
    providerType: 'mock',
    rowModel: 'clientSide',
    config: {
      keyColumn: 'positionId',
      rowCount: 50,
      tickMs: 0,
      shape: 'positions',
      throttleEnabled: false,
    },
  };
}

describe('hub CSRM + mock transport', () => {
  it('attaches, receives snapshot, binds to grid', async () => {
    reset();
    const provider = new ProviderClientAdapter(mockCfg('mock-csrm-1'), { inProcess: true });
    let snap: readonly Record<string, unknown>[] = [];
    provider.onSnapshotData((rows) => { snap = rows; });

    const gridRows: Record<string, unknown>[][] = [];
    const detach = bindProviderToGrid(provider, {
      setRowData(rows) { gridRows.push(rows); },
      applyTransaction() { /* unused when tickMs=0 */ },
    });

    await provider.start();
    await new Promise((r) => setTimeout(r, 30));

    expect(provider.getStatus()).toBe('ready');
    expect(snap.length).toBe(50);
    expect(provider.getData().length).toBe(50);
    expect(gridRows.at(-1)?.length).toBe(50);

    detach();
    provider.destroy();
  });

  it('classifies live ticks through onDelta (updates for known ids)', async () => {
    reset();
    const cfg = mockCfg('mock-delta');
    cfg.config.tickMs = 5;
    cfg.config.updatesPerTick = 3;
    const provider = new ProviderClientAdapter(cfg, { inProcess: true });

    const deltas: { adds: number; updates: number; removes: number }[] = [];
    provider.onDelta((d) => {
      deltas.push({ adds: d.adds.length, updates: d.updates.length, removes: d.removes.length });
    });

    await provider.start();
    await new Promise((r) => setTimeout(r, 60));

    expect(provider.getData().length).toBe(50);
    // At least one live tick classified as pure updates (ids already known),
    // never adds — a mock tick only mutates existing rows.
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.some((d) => d.updates > 0)).toBe(true);
    expect(deltas.every((d) => d.adds === 0)).toBe(true);

    provider.destroy();
  });

  it('shares one hub slot across two clients', async () => {
    reset();
    const cfg = mockCfg('shared-book');
    const a = new ProviderClientAdapter(cfg, { inProcess: true });
    const b = new ProviderClientAdapter(cfg, { inProcess: true });
    await a.start();
    await new Promise((r) => setTimeout(r, 20));
    await b.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(a.getData().length).toBe(50);
    expect(b.getData().length).toBe(50);
    expect(a.getData()[0]?.positionId).toBe(b.getData()[0]?.positionId);
    a.destroy();
    b.destroy();
  });
});
