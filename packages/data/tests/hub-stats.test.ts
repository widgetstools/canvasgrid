import { afterEach, describe, expect, it } from 'vitest';
import { ProviderClientAdapter } from '../src/client/ProviderClientAdapter';
import { _resetHubConnectionForTests } from '../src/client/hubConnection';
import { _resetTransportRegistryForTests } from '../src/registry/transports';
import { _resetDefaultTransportsFlagForTests } from '../src/transports/registerDefaults';
import type { DataProviderConfig } from '../src/types';
import { buildEndTokenMatcher } from '../src/transports/stomp';

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
      rowCount: 20,
      tickMs: 0,
      shape: 'positions',
      throttleEnabled: false,
    },
  };
}

describe('hub getStats', () => {
  it('returns live row/message/publish stats after start', async () => {
    reset();
    const provider = new ProviderClientAdapter(mockCfg('stats-1'), { inProcess: true });
    await provider.start();
    await new Promise((r) => setTimeout(r, 30));

    const stats = await provider.getStats();
    expect(stats.rowCount).toBe(20);
    expect(stats.msgCount).toBeGreaterThan(0);
    expect(stats.publishCount).toBeGreaterThan(0);
    expect(stats.subscriberCount).toBeGreaterThanOrEqual(1);
    expect(stats.snapshotFetchMs).not.toBeNull();
    expect(stats.status).toBe('ready');
    expect(stats.startedAt).not.toBeNull();

    await provider.stop();
    provider.destroy();
  });

  it('stop leaves provider idle; restart recovers rows', async () => {
    reset();
    const provider = new ProviderClientAdapter(mockCfg('stats-2'), { inProcess: true });
    await provider.start();
    await new Promise((r) => setTimeout(r, 20));
    await provider.stop();
    expect(provider.getStatus()).toBe('disconnected');

    await provider.restart({ __refresh: 1 });
    await new Promise((r) => setTimeout(r, 30));
    const stats = await provider.getStats();
    expect(stats.rowCount).toBe(20);
    expect(stats.status).toBe('ready');

    provider.destroy();
  });
});

describe('STOMP end-token matcher', () => {
  it('matches case-insensitive substrings', () => {
    const re = buildEndTokenMatcher('Success');
    expect(re?.test('Success')).toBe(true);
    expect(re?.test('success')).toBe(true);
    expect(re?.test('DONE:Success')).toBe(true);
    expect(re?.test('SUCCESS:ok')).toBe(true);
    expect(re?.test('fail')).toBe(false);
  });
});
