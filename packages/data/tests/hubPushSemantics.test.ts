import { afterEach, describe, expect, it } from 'vitest';
import { ProviderClientAdapter } from '../src/client/ProviderClientAdapter';
import { bindProviderToGrid } from '../src/client/bind';
import { _resetHubConnectionForTests, connectHub } from '../src/client/hubConnection';
import { registerTransport, _resetTransportRegistryForTests } from '../src/registry/transports';
import { _resetDefaultTransportsFlagForTests } from '../src/transports/registerDefaults';
import type { DataProviderConfig, ProviderEmit } from '../src/types';

function reset(): void {
  _resetHubConnectionForTests();
  _resetTransportRegistryForTests();
  _resetDefaultTransportsFlagForTests();
}

afterEach(reset);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Mock CSRM grid that faithfully models the kernel worker's transaction
 * semantics: `add` inserts, `update` mutates ONLY existing rows (unknown-id
 * updates are dropped — dataPipeline.ts:95-102), `remove` deletes by id.
 */
function makeGrid(keyField: string): {
  setRowData(rows: Record<string, unknown>[]): void;
  applyTransactionAsync(tx: {
    add?: Record<string, unknown>[];
    update?: Record<string, unknown>[];
    remove?: string[];
  }): void;
  count(): number;
} {
  const rows = new Map<string, Record<string, unknown>>();
  const keyOf = (r: Record<string, unknown>): string => String(r[keyField]);
  return {
    setRowData(rs) {
      rows.clear();
      for (const r of rs) rows.set(keyOf(r), r);
    },
    applyTransactionAsync(tx) {
      for (const r of tx.add ?? []) rows.set(keyOf(r), r);
      for (const r of tx.update ?? []) {
        const id = keyOf(r);
        // Kernel drops unknown-id updates — model it.
        if (rows.has(id)) rows.set(id, { ...rows.get(id)!, ...r });
      }
      for (const id of tx.remove ?? []) rows.delete(id);
    },
    count: () => rows.size,
  };
}

function restartCfg(id: string): DataProviderConfig {
  return {
    providerId: id,
    name: id,
    providerType: 'mock',
    rowModel: 'clientSide',
    config: {
      keyColumn: 'positionId',
      rowCount: 1200,
      snapshotChunkSize: 500,
      tickMs: 0,
      shape: 'positions',
      throttleEnabled: false,
    },
  };
}

describe('hub push semantics — restart truncation (C-C3)', () => {
  it('re-fills BOTH clients to 1200 rows after restart (remote tab not truncated to 500)', async () => {
    reset();
    const cfg = restartCfg('restart-book');

    const a = new ProviderClientAdapter(cfg, { inProcess: true });
    const b = new ProviderClientAdapter(cfg, { inProcess: true });
    const gridA = makeGrid('positionId');
    const gridB = makeGrid('positionId');
    const detachA = bindProviderToGrid(a, gridA);
    const detachB = bindProviderToGrid(b, gridB);

    await a.start();
    await sleep(30);
    await b.start();
    await sleep(30);

    // Both painted the full book at least once.
    expect(gridA.count()).toBe(1200);
    expect(gridB.count()).toBe(1200);

    // Restart from A — the whole snapshot re-fans as chunked replace to BOTH.
    await a.restart();
    await sleep(40);

    expect(gridA.count()).toBe(1200);
    expect(gridB.count()).toBe(1200);

    detachA();
    detachB();
    a.destroy();
    b.destroy();
  });
});

describe('hub push semantics — invisible adds (C-C3)', () => {
  it('paints a brand-new id arriving in a live tick as an add (4 rows total)', async () => {
    reset();
    // Manual transport we can drive tick-by-tick.
    let emit: ProviderEmit | null = null;
    // Constructing the adapter first spins up the in-process hub singleton
    // (which registers the default transports); register ours afterwards so
    // the reset+default-register cycle doesn't clear it.
    const cfg: DataProviderConfig = {
      providerId: 'adds-book',
      name: 'adds-book',
      providerType: 'manual-adds',
      rowModel: 'clientSide',
      config: {
        keyColumn: 'id',
        throttleEnabled: false,
      },
    };
    const provider = new ProviderClientAdapter(cfg, { inProcess: true });
    // Ensure the hub singleton exists before registering (connectHub is idempotent).
    connectHub({ inProcess: true });
    registerTransport('manual-adds', (_c, e) => {
      emit = e;
      return { stop() {}, restart() {} };
    });

    const grid = makeGrid('id');
    const detach = bindProviderToGrid(provider, grid);

    await provider.start();
    await sleep(10);
    expect(emit).not.toBeNull();

    // Snapshot of 3 rows.
    emit!({ status: 'connecting' });
    emit!({ status: 'snapshot' });
    emit!({ rows: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }], replace: true });
    emit!({ status: 'ready' });
    await sleep(20);
    expect(grid.count()).toBe(3);

    // Live tick: 1 update (existing 'a') + 1 brand-new id ('d').
    emit!({ rows: [{ id: 'a', v: 2 }, { id: 'd', v: 1 }] });
    await sleep(20);

    // 'd' must land as an add, not a dropped update.
    expect(grid.count()).toBe(4);

    detach();
    provider.destroy();
  });
});
