import { afterEach, describe, expect, it, vi } from 'vitest';
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
const { readyControl, providerReadyOverrides } = vi.hoisted(() => ({
  readyControl: { fail: false, message: 'stomp connect failed' },
  // Per-`providerId` overrides, keyed off `StompPerspectiveProviderConfig.providerId`
  // (set by `dataProviderConfigToPerspective`). Lets a single test run two
  // providers with different `ready()` outcomes/timing at once (fix wave 3's
  // supersession test needs a slow-failing p1 alongside a fast-succeeding
  // p2). Empty by default, so every pre-existing test — which never touches
  // this map — keeps falling back to the shared `readyControl` below,
  // unchanged.
  providerReadyOverrides: new Map<string, { fail: boolean; message: string; delayMs: number }>(),
}));

vi.mock('../src/provider', () => {
  class FakeStompPerspectiveProvider {
    private readonly providerId: string;
    constructor(cfg: { providerId: string }) {
      this.providerId = cfg.providerId;
    }
    ready(): Promise<void> {
      const override = providerReadyOverrides.get(this.providerId);
      const fail = override ? override.fail : readyControl.fail;
      const message = override ? override.message : readyControl.message;
      const delayMs = override?.delayMs ?? 0;
      return new Promise<void>((resolve, reject) => {
        const settle = () => {
          if (fail) reject(new Error(message));
          else resolve();
        };
        if (delayMs > 0) setTimeout(settle, delayMs);
        else settle();
      });
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

// IMPORTANT (fix wave 3) — fix wave 2's own finding for this `.catch` said
// "route the error to the same surface the bind path uses", so it was made
// to call `onActiveChange(null, null, { phase: 'error', message })`
// directly. That was wrong: `bindConfig`'s own catch (`:307-320`) already
// emits exactly that, epoch-guarded. This `.catch`'s only job is to stop
// the unhandled rejection proven above — re-emitting on top double-fires
// for every ordinary failure, and, carrying no epoch guard of its own, can
// fire for an activation already superseded, landing a stale error over
// newer state that `bindConfig`'s guard had already (correctly) left alone.
describe('PerspectiveDataProviderController — set: restore error emission ownership (fix wave 3)', () => {
  afterEach(() => {
    providerReadyOverrides.clear();
  });

  it('a failing `set:` restore fires onActiveChange({ phase: "error" }) exactly once, not twice', async () => {
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

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      restoreState!({ activeProviderId: 'p1' }, 2);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
    expect(unhandled).toEqual([]);

    const errorCalls = changes.filter((c) => c.status?.phase === 'error');
    expect(errorCalls).toHaveLength(1);
  });

  it('a stale rejection from a restore superseded before it settles does not emit an error over the newer, successful activation', async () => {
    // `activateChain` (controller.ts setActiveProvider) fully serializes
    // every call to `setActiveProvider` — a second call queued while one is
    // mid-flight only *runs* once the first has fully settled, so two
    // ordinary `setActiveProvider` calls can never race each other's
    // epoch. The one out-of-band way `activateEpoch` moves out from under
    // an in-flight `bindConfig` is `detach()`, which bumps it directly
    // rather than going through the chain — the "detach() mid-bind" case
    // `bindConfig`'s own guard comment names explicitly. That's what this
    // test drives: p1's restore is left genuinely in flight (awaiting a
    // slow-rejecting `ready()`), the activation is superseded via
    // `detach()` + reattach, and a working p2 is activated in its place —
    // "the user manually switches to p2" from the finding — before p1's
    // rejection ever lands.
    providerReadyOverrides.set('p1', { fail: true, message: 'stomp connect failed', delayMs: 20 });
    providerReadyOverrides.set('p2', { fail: false, message: '', delayMs: 0 });

    const backend = new MemoryConfigBackend();
    await backend.save(CFG);
    await backend.save({ ...CFG, providerId: 'p2', name: 'Positions 2' });

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
    const grid = makeGrid({ updateGridOptions: () => {}, setServerSideDatasource: () => {} });
    controller.attach({
      grid,
      registerStateModule: (module) => {
        if (module.id === 'perspective-data-provider') restoreState = module.set;
        return () => {};
      },
      profiles: { markDirty: () => {}, save: async () => {} },
    });
    expect(restoreState).not.toBeNull();

    // Kick off the slow-failing p1 restore — `bindConfig` is now awaiting
    // `provider.ready()`, which won't settle for 20ms.
    restoreState!({ activeProviderId: 'p1' }, 2);

    // Let the synchronous setup (stopCurrent / catalog lookup / provider
    // construction) run its course so bindConfig is genuinely parked on
    // `provider.ready()`, well before the 20ms rejection fires.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Supersede it: detach (bumps activateEpoch out-of-band — bindConfig's
    // eventual catch for p1 will now see a stale epoch) and reattach, then
    // activate the working p2.
    controller.detach();
    controller.attach({
      grid,
      registerStateModule: (module) => {
        if (module.id === 'perspective-data-provider') restoreState = module.set;
        return () => {};
      },
      profiles: { markDirty: () => {}, save: async () => {} },
    });
    await controller.setActiveProvider('p2', { force: true });

    // p1's slow rejection has, by construction, already landed by the time
    // the above `await` resolves — `setActiveProvider('p2', ...)` is
    // queued behind p1's still-settling activation in the same
    // `activateChain`. Give it a little extra real-clock margin regardless.
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(controller.getActiveProviderId()).toBe('p2');
    const lastChange = changes.at(-1);
    expect(lastChange?.id).toBe('p2');
    expect(lastChange?.status).toBeUndefined();

    // The core assertion: p1 was superseded before it settled, so
    // bindConfig's own epoch-guarded emit is correctly suppressed — and
    // the outer `.catch` (this fix) must not re-emit unguarded on top of
    // it. No error should ever have been recorded for the stale p1.
    const errorCalls = changes.filter((c) => c.status?.phase === 'error');
    expect(errorCalls).toHaveLength(0);
  });
});
