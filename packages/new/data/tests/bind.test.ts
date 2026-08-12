import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetFeedControlRegistryForTests,
  bindProviderToGrid,
  getDataProviderFeedControl,
  registerDataProviderFeedControl,
  resolveProviderConfig,
  DataProviderController,
  MemoryConfigBackend,
  SEED_PROVIDERS,
} from '../src/index';
import { AppDataStore } from '@wellsfargo-starui/vg-new-appdata';

afterEach(() => {
  __resetFeedControlRegistryForTests();
});

describe('feedControl multi-listener', () => {
  it('fans out stop/restart to all registered controls', () => {
    const a = { stop: vi.fn(), restart: vi.fn() };
    const b = { stop: vi.fn(), restart: vi.fn() };
    registerDataProviderFeedControl('p1', a);
    registerDataProviderFeedControl('p1', b);
    getDataProviderFeedControl('p1')!.stop();
    getDataProviderFeedControl('p1')!.restart();
    expect(a.stop).toHaveBeenCalledOnce();
    expect(b.stop).toHaveBeenCalledOnce();
    expect(a.restart).toHaveBeenCalledOnce();
    expect(b.restart).toHaveBeenCalledOnce();
  });
});

describe('resolveProviderConfig', () => {
  it('resolves AppData tokens fail-closed', () => {
    const store = new AppDataStore();
    store.set('env', 'brokerUrl', 'ws://x');
    const resolved = resolveProviderConfig(
      {
        id: 'positions-stomp',
        name: 'S',
        transport: 'stomp',
        connection: { brokerURL: '{{env.brokerUrl}}' },
      },
      store.lookup,
    );
    expect(resolved.connection?.brokerURL).toBe('ws://x');
  });

  it('throws when tokens unresolved', () => {
    expect(() => resolveProviderConfig({
      id: 'x',
      name: 'X',
      transport: 'stomp',
      connection: { brokerURL: '{{env.missing}}' },
    }, () => undefined)).toThrow();
  });
});

describe('bindProviderToGrid', () => {
  it('seeds mock rows and registers feed control', () => {
    vi.useFakeTimers();
    const setRowData = vi.fn();
    const applyTransactionAsync = vi.fn();
    const handle = bindProviderToGrid(
      { setRowData, applyTransactionAsync },
      SEED_PROVIDERS[0]!,
    );
    expect(setRowData).toHaveBeenCalled();
    expect(getDataProviderFeedControl('positions-mock')).toBeTruthy();
    vi.advanceTimersByTime(400);
    expect(applyTransactionAsync).toHaveBeenCalled();
    handle.detach();
    vi.useRealTimers();
  });
});

describe('DataProviderController', () => {
  it('activates provider with epoch gating', async () => {
    const catalog = new MemoryConfigBackend();
    await catalog.save(SEED_PROVIDERS[0]!);
    const setRowData = vi.fn();
    const ctrl = new DataProviderController({ catalog });
    ctrl.attachGrid({ setRowData, applyTransactionAsync: vi.fn() });
    await ctrl.setActiveProvider('positions-mock');
    expect(ctrl.getActiveProviderId()).toBe('positions-mock');
    expect(setRowData).toHaveBeenCalled();
    await ctrl.setActiveProvider(null);
    expect(ctrl.getActiveProviderId()).toBeNull();
    ctrl.destroy();
  });
});
