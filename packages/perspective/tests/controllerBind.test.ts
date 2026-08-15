import { describe, expect, it, vi } from 'vitest';
import { MemoryConfigBackend, type DataProviderConfig } from '@wellsfargo-starui/velocity-grid-data';
// `vi.mock` calls are hoisted above every import in this file by Vitest's
// transform, so this static import always resolves to the mocked module —
// no need for a dynamic `await import(...)` after the mock registration.
import { PerspectiveDataProviderController } from '../src/controller';

// Task 9 / C-M7 — "Apply lies": bindConfig used to wire the grid to a
// StompPerspectiveProvider without ever awaiting `provider.ready()`, so a
// broker that never connects still reported success. `StompPerspectiveProvider`
// itself talks to real Perspective WASM + STOMP, so it's mocked out here —
// only `bindConfig`'s honesty (await + surfaced failure + rejection) is
// under test, not the provider's own connection machinery.
const { readyControl } = vi.hoisted(() => ({
  readyControl: { fail: false, message: 'stomp connect failed' },
}));

vi.mock('../src/provider', () => {
  class FakeStompPerspectiveProvider {
    ready(): Promise<void> {
      return readyControl.fail
        ? Promise.reject(new Error(readyControl.message))
        : Promise.resolve();
    }
    destroy(): void { /* no-op */ }
    gridOptions(): Record<string, unknown> {
      return {
        rowGroupPanelShow: 'always',
        suppressAggFuncInHeader: true,
        asyncTransactionConflate: true,
        asyncTransactionWaitMillis: 50,
      };
    }
    getExpressions(): Record<string, string> { return {}; }
    setExpressions(): Promise<void> { return Promise.resolve(); }
    attach(): () => void { return () => {}; }
  }
  return {
    StompPerspectiveProvider: FakeStompPerspectiveProvider,
    resolveProviderConfig: (c: unknown) => c,
  };
});

const CFG: DataProviderConfig = {
  providerId: 'p1',
  name: 'Positions',
  providerType: 'stomp',
  rowModel: 'serverSide',
  config: { feed: 'stomp', websocketUrl: 'ws://example.test:9999' },
};

type FakeGridOverrides = {
  updateGridOptions?: (partial: Record<string, unknown>) => void;
  setServerSideDatasource?: (ds: unknown | null) => void;
  whenReady?: () => Promise<void>;
};

function makeGrid(overrides: FakeGridOverrides = {}) {
  return {
    applyServerSideTransaction: (): void => {},
    refreshServerSide: (): void => {},
    getRowGroupColumns: (): string[] => [],
    on: (): (() => void) => () => {},
    ...overrides,
  };
}

function makeCtx(grid: ReturnType<typeof makeGrid>) {
  return {
    grid,
    registerStateModule: () => () => {},
    profiles: { markDirty: () => {}, save: async () => {} },
  };
}

describe('PerspectiveDataProviderController.bindConfig — honest Apply (C-M7)', () => {
  it('rejects and reports an error phase through onActiveChange when provider.ready() rejects', async () => {
    readyControl.fail = true;
    readyControl.message = 'stomp connect failed';

    const backend = new MemoryConfigBackend();
    await backend.save(CFG);

    const changes: Array<{
      id: string | null;
      provider: unknown;
      status?: { phase: 'error'; message: string };
    }> = [];
    const controller = new PerspectiveDataProviderController({
      catalog: backend,
      onActiveChange: (id, provider, status) => { changes.push({ id, provider, status }); },
    });
    controller.attach(makeCtx(makeGrid()));

    await expect(controller.setActiveProvider('p1', { force: true }))
      .rejects.toThrow('stomp connect failed');

    const errorCall = changes.find((c) => c.status != null);
    expect(errorCall).toBeDefined();
    expect(errorCall?.id).toBeNull();
    expect(errorCall?.provider).toBeNull();
    expect(errorCall?.status?.phase).toBe('error');
    expect(errorCall?.status?.message).toBe('stomp connect failed');

    // Failure releases refs — no half-bound state left behind.
    expect(controller.getActiveProviderId()).toBeNull();
    expect(controller.getProvider()).toBeNull();
  });

  it('resolves and reports success (no error status) when provider.ready() resolves', async () => {
    readyControl.fail = false;

    const backend = new MemoryConfigBackend();
    await backend.save(CFG);

    const changes: Array<{
      id: string | null;
      provider: unknown;
      status?: { phase: 'error'; message: string };
    }> = [];
    const controller = new PerspectiveDataProviderController({
      catalog: backend,
      onActiveChange: (id, provider, status) => { changes.push({ id, provider, status }); },
    });
    const grid = makeGrid({ updateGridOptions: () => {}, setServerSideDatasource: () => {} });
    controller.attach(makeCtx(grid));

    await expect(controller.setActiveProvider('p1', { force: true })).resolves.toBeUndefined();

    expect(controller.getActiveProviderId()).toBe('p1');
    expect(controller.getProvider()).not.toBeNull();
    const lastChange = changes.at(-1);
    expect(lastChange?.id).toBe('p1');
    expect(lastChange?.status).toBeUndefined();
  });
});

// IMPORTANT 1 (fix wave 2) — `attach()`'s registered state module `set:`
// handler used to fire `void this.setActiveProvider(id, { fromState: true })`.
// `setActiveProvider`'s returned promise is a distinct object from the
// internal `activateChain` relay; once bindConfig started genuinely
// rejecting on a dead broker (C-M7 "honest Apply"), that bare `void` became
// a real unhandled rejection ~`BIND_READY_TIMEOUT_MS` after every profile
// restore naming a provider whose broker never connects.
describe('PerspectiveDataProviderController — state-restore rejection handling (fix wave 2, IMPORTANT 1)', () => {
  it('a `set:` restore naming a failing provider produces no unhandled rejection AND surfaces the error', async () => {
    readyControl.fail = true;
    readyControl.message = 'stomp connect failed';

    const backend = new MemoryConfigBackend();
    await backend.save(CFG);

    const changes: Array<{
      id: string | null;
      provider: unknown;
      status?: { phase: 'error'; message: string };
    }> = [];
    const controller = new PerspectiveDataProviderController({
      catalog: backend,
      onActiveChange: (id, provider, status) => { changes.push({ id, provider, status }); },
    });

    let restoreState: ((data: unknown, version: number) => void) | null = null;
    controller.attach({
      grid: makeGrid(),
      registerStateModule: (module) => {
        if (module.id === 'perspective-data-provider') restoreState = module.set;
        return () => {};
      },
      profiles: { markDirty: () => {}, save: async () => {} },
    });
    expect(restoreState).not.toBeNull();

    // Install a real `process.on('unhandledRejection')` spy — awaiting the
    // call directly would pass regardless of whether the fire-and-forget
    // path inside `set:` is actually caught, proving nothing.
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      // This is the exact fire-and-forget path under test — `set:` is a
      // synchronous callback (registerStateModule's contract), it cannot
      // be awaited by the caller.
      restoreState!({ activeProviderId: 'p1' }, 2);

      // Drain the microtask/timer queue so a would-be unhandled rejection
      // has every chance to surface before we assert it never fired.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }

    expect(unhandled).toEqual([]);

    const errorCall = changes.find((c) => c.status != null);
    expect(errorCall).toBeDefined();
    expect(errorCall?.id).toBeNull();
    expect(errorCall?.provider).toBeNull();
    expect(errorCall?.status?.phase).toBe('error');
    expect(errorCall?.status?.message).toBe('stomp connect failed');
  });
});
