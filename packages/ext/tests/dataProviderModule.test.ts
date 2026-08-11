import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryConfigBackend,
  _resetHubConnectionForTests,
  _resetTransportRegistryForTests,
  _resetDefaultTransportsFlagForTests,
  registerDefaultTransports,
} from '@wellsfargo-starui/velocity-grid-data';
import { DataProviderController } from '../src/modules/dataProviderController';
import { dataProviderModule } from '../src/modules/dataProvider';
import type { VelocityGridExtContext } from '../src/extension/types';

function reset(): void {
  _resetHubConnectionForTests();
  _resetTransportRegistryForTests();
  _resetDefaultTransportsFlagForTests();
}

afterEach(reset);

function mockCtx(grid: Record<string, unknown>): VelocityGridExtContext {
  const modules = new Map<string, { get: () => unknown; set: (d: unknown, v: number) => void }>();
  return {
    grid: grid as unknown as VelocityGridExtContext['grid'],
    getState: () => ({}) as never,
    setState: () => {},
    registerStateModule: (m) => {
      modules.set(m.id, m);
      return () => { modules.delete(m.id); };
    },
    modal: { open() {}, close() {}, isOpen: () => false },
    events: { on: () => () => {}, emit() {} },
    profiles: {
      activeId: () => 'default',
      isDirty: () => false,
      markDirty: vi.fn(),
      onDirtyChange: () => () => {},
      onListChange: () => () => {},
      save: vi.fn(async () => {}),
      saveAs: async () => 'x',
      discard: async () => {},
      rename: async () => {},
      remove: async () => {},
      switchTo: async () => {},
      bootstrap: async () => {},
      list: async () => [],
    },
    _modules: modules,
  } as VelocityGridExtContext & { _modules: typeof modules };
}

describe('DataProviderController', () => {
  it('persists activeProviderId via StateModule and binds CSRM', async () => {
    reset();
    registerDefaultTransports();
    const catalog = new MemoryConfigBackend();
    await catalog.save({
      providerId: 'pos',
      name: 'Positions',
      providerType: 'mock',
      rowModel: 'clientSide',
      config: { keyColumn: 'positionId', rowCount: 12, tickMs: 0, throttleEnabled: false },
    });

    const rows: unknown[][] = [];
    const grid = {
      setRowData: (r: unknown[]) => { rows.push(r); },
      applyTransaction: vi.fn(),
      whenReady: async () => {},
    };
    const ctx = mockCtx(grid);
    const ctl = new DataProviderController({ catalog, inProcess: true });
    ctl.attach(ctx);

    await ctl.setActiveProvider('pos');
    await new Promise((r) => setTimeout(r, 30));

    expect(ctl.getActiveProviderId()).toBe('pos');
    expect(rows.at(-1)?.length).toBe(12);
    expect(ctx.profiles.markDirty).toHaveBeenCalled();
    expect(ctx.profiles.save).toHaveBeenCalled();

    const mod = (ctx as unknown as { _modules: Map<string, { get: () => unknown }> })._modules.get('data-provider');
    expect(mod?.get()).toEqual({ activeProviderId: 'pos' });

    ctl.detach();
  });

  it('restores activeProviderId from StateModule set (reload path)', async () => {
    reset();
    registerDefaultTransports();
    const catalog = new MemoryConfigBackend();
    await catalog.save({
      providerId: 'pos',
      name: 'Positions',
      providerType: 'mock',
      rowModel: 'clientSide',
      config: { keyColumn: 'positionId', rowCount: 8, tickMs: 0, throttleEnabled: false },
    });

    const rows: unknown[][] = [];
    const grid = {
      setRowData: (r: unknown[]) => { rows.push(r); },
      whenReady: async () => {},
    };
    const ctx = mockCtx(grid);
    const ctl = new DataProviderController({ catalog, inProcess: true });
    ctl.attach(ctx);

    const mod = (ctx as unknown as {
      _modules: Map<string, { set: (d: unknown, v: number) => void }>;
    })._modules.get('data-provider');
    mod?.set({ activeProviderId: 'pos' }, 1);
    await new Promise((r) => setTimeout(r, 40));

    expect(ctl.getActiveProviderId()).toBe('pos');
    expect(rows.at(-1)?.length).toBe(8);
    expect(ctx.profiles.save).not.toHaveBeenCalled();

    ctl.detach();
  });

  it('restores a CSRM provider without waiting on SSRM whenReady', async () => {
    reset();
    registerDefaultTransports();
    const catalog = new MemoryConfigBackend();
    await catalog.save({
      providerId: 'csrm-pos',
      name: 'CSRM Positions',
      providerType: 'mock',
      rowModel: 'clientSide',
      config: { keyColumn: 'positionId', rowCount: 20, tickMs: 0, throttleEnabled: false },
    });

    const rows: unknown[][] = [];
    const grid = {
      setRowData: (r: unknown[]) => { rows.push(r); },
      applyTransactionAsync: vi.fn(),
    };
    const ctx = mockCtx(grid);
    const ctl = new DataProviderController({ catalog, inProcess: true });
    ctl.attach(ctx);

    await ctl.setActiveProvider('csrm-pos', { fromState: true });
    await new Promise((r) => setTimeout(r, 40));

    expect(ctl.getActiveProviderId()).toBe('csrm-pos');
    expect(rows.length).toBeGreaterThan(0);
    expect(ctx.profiles.save).not.toHaveBeenCalled();

    ctl.detach();
  });

  it('coalesces duplicate fromState restores of the same provider', async () => {
    reset();
    registerDefaultTransports();
    const catalog = new MemoryConfigBackend();
    await catalog.save({
      providerId: 'pos',
      name: 'Positions',
      providerType: 'mock',
      rowModel: 'clientSide',
      config: { keyColumn: 'positionId', rowCount: 5, tickMs: 0, throttleEnabled: false },
    });

    const rows: unknown[][] = [];
    const grid = {
      setRowData: (r: unknown[]) => { rows.push(r); },
      whenReady: async () => {},
    };
    const ctx = mockCtx(grid);
    const ctl = new DataProviderController({ catalog, inProcess: true });
    ctl.attach(ctx);

    await Promise.all([
      ctl.setActiveProvider('pos', { fromState: true }),
      ctl.setActiveProvider('pos', { fromState: true }),
      ctl.setActiveProvider('pos', { fromState: true }),
    ]);
    await new Promise((r) => setTimeout(r, 40));

    expect(ctl.getActiveProviderId()).toBe('pos');
    expect(rows.at(-1)?.length).toBe(5);
    // Restores must not rewrite the profile.
    expect(ctx.profiles.save).not.toHaveBeenCalled();

    ctl.detach();
  });
});

describe('dataProviderModule', () => {
  it('mounts Customize selector without embedding the full editor', async () => {
    reset();
    registerDefaultTransports();
    const catalog = new MemoryConfigBackend();
    await catalog.save({
      providerId: 'a',
      name: 'A',
      providerType: 'mock',
      rowModel: 'clientSide',
      config: { keyColumn: 'positionId', rowCount: 1, tickMs: 0 },
    });
    const ctl = new DataProviderController({ catalog, inProcess: true });
    const mod = dataProviderModule({ controller: ctl });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ctx = mockCtx({
      setRowData: () => {},
      applyTransaction: () => {},
      whenReady: async () => {},
    });
    mod.init(ctx);
    const inst = mod.mount(host, ctx);
    await new Promise((r) => setTimeout(r, 20));
    expect(host.querySelector('.vgext-dp')).toBeTruthy();
    expect(host.querySelector('select')).toBeTruthy();
    expect(host.querySelector('.vg-dp-editor')).toBeNull();
    expect(host.querySelector('.vg-dp-shell')).toBeNull();
    const buttons = Array.from(host.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Apply');
    expect(buttons).toContain('Edit…');
    expect(buttons).toContain('Manage…');
    inst.destroy();
    mod.dispose?.();
    host.remove();
  });
});
