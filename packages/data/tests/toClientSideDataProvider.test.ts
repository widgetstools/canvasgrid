import { describe, it, expect, vi } from 'vitest';
import { toClientSideDataProvider } from '../src/client/toClientSideDataProvider';
import type { IDataProvider, ProviderDelta } from '../src/types';

/**
 * Adapter from the hub's `IDataProvider` to the kernel's row-only
 * `clientSideDataProvider` contract. Pure shape translation — no hub, no
 * transport, no worker.
 */

interface Row extends Record<string, unknown> { id: string; v: number }

/** Minimal IDataProvider double. `withDelta: false` drops `onDelta` entirely
 *  so the legacy `onTick` fallback is exercised. */
function makeProvider(rows: Row[], withDelta = true) {
  const deltaHandlers = new Set<(d: ProviderDelta<Row>) => void>();
  const tickHandlers = new Set<(rows: Row[]) => void>();
  const snapshotHandlers = new Set<(rows: Row[]) => void>();
  const base = {
    providerId: 'p1',
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    getData: () => rows,
    getConfig: vi.fn(),
    getColumnDefs: () => [],
    getStatus: () => 'live',
    onRowsReceived: () => () => {},
    onSnapshotData(h: (r: Row[]) => void) { snapshotHandlers.add(h); return () => snapshotHandlers.delete(h); },
    onTick(h: (r: Row[]) => void) { tickHandlers.add(h); return () => tickHandlers.delete(h); },
    onError: () => () => {},
    onStatus: () => () => {},
    destroy: vi.fn(),
  } as unknown as IDataProvider<Row>;
  if (withDelta) {
    (base as unknown as { onDelta: unknown }).onDelta = (h: (d: ProviderDelta<Row>) => void) => {
      deltaHandlers.add(h);
      return () => deltaHandlers.delete(h);
    };
  }
  return {
    provider: base,
    emitSnapshot: (r: Row[]) => snapshotHandlers.forEach((h) => h(r)),
    emitDelta: (d: ProviderDelta<Row>) => deltaHandlers.forEach((h) => h(d)),
    emitTick: (r: Row[]) => tickHandlers.forEach((h) => h(r)),
    deltaSubscribers: () => deltaHandlers.size,
    snapshotSubscribers: () => snapshotHandlers.size,
    tickSubscribers: () => tickHandlers.size,
  };
}

describe('toClientSideDataProvider', () => {
  it('proxies getSnapshot to getData', () => {
    const rows: Row[] = [{ id: 'a', v: 1 }];
    const { provider } = makeProvider(rows);
    expect(toClientSideDataProvider(provider).getSnapshot()).toEqual(rows);
  });

  it('proxies onSnapshot to onSnapshotData and returns its unsubscribe', () => {
    const p = makeProvider([]);
    const adapted = toClientSideDataProvider(p.provider);
    const seen: Row[][] = [];
    const stop = adapted.onSnapshot((r) => seen.push(r as Row[]));
    expect(p.snapshotSubscribers()).toBe(1);

    p.emitSnapshot([{ id: 'a', v: 1 }]);
    expect(seen).toEqual([[{ id: 'a', v: 1 }]]);

    stop();
    expect(p.snapshotSubscribers()).toBe(0);
  });

  it('renames adds/updates/removes to add/update/removeIds', () => {
    const p = makeProvider([]);
    const adapted = toClientSideDataProvider(p.provider);
    const seen: unknown[] = [];
    adapted.onDelta!((d) => seen.push(d));

    p.emitDelta({
      adds: [{ id: 'a', v: 1 }],
      updates: [{ id: 'b', v: 2 }],
      removes: ['c'],
    });

    expect(seen).toEqual([{
      add: [{ id: 'a', v: 1 }],
      update: [{ id: 'b', v: 2 }],
      removeIds: ['c'],
    }]);
  });

  it('falls back to onTick as an update-only delta when onDelta is absent', () => {
    const p = makeProvider([], false);
    const adapted = toClientSideDataProvider(p.provider);
    const seen: unknown[] = [];
    const stop = adapted.onDelta!((d) => seen.push(d));
    expect(p.tickSubscribers()).toBe(1);

    p.emitTick([{ id: 'a', v: 1 }]);
    // onTick carries no removal channel — must not invent add/removeIds.
    expect(seen).toEqual([{ update: [{ id: 'a', v: 1 }] }]);

    stop();
    expect(p.tickSubscribers()).toBe(0);
  });

  it('unsubscribing the delta channel releases the underlying handler', () => {
    const p = makeProvider([]);
    const adapted = toClientSideDataProvider(p.provider);
    const stop = adapted.onDelta!(() => {});
    expect(p.deltaSubscribers()).toBe(1);
    stop();
    expect(p.deltaSubscribers()).toBe(0);
  });

  it('does not start, stop or destroy the provider — lifecycle stays with its owner', () => {
    const p = makeProvider([{ id: 'a', v: 1 }]);
    const adapted = toClientSideDataProvider(p.provider);
    adapted.getSnapshot();
    adapted.onSnapshot(() => {});
    adapted.onDelta!(() => {});

    expect(p.provider.start).not.toHaveBeenCalled();
    expect(p.provider.stop).not.toHaveBeenCalled();
    expect(p.provider.destroy).not.toHaveBeenCalled();
  });
});
