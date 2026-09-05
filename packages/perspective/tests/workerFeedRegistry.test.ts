import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerFeedRegistry } from '../src/workerFeedHost';
import type { WorkerFeedConfig } from '../src/workerFeedProtocol';

/**
 * Who keeps a worker-side feed alive, and who lets it go.
 *
 * This is the bookkeeping that replaced the Web-Lock election, and it carries
 * the two failure modes the election never had:
 *
 *   - **Start twice, feed twice.** If `feed:start` for a table already being
 *     fed created a second feed, every tab would open its own broker
 *     connection and the whole change would be pointless. Joining is the
 *     entire mechanism — there is no lock deciding anything.
 *   - **A feed nobody wants, running forever.** The worker is per-ORIGIN and
 *     long-lived, so a feed that outlives its last blotter holds a broker
 *     connection for hours. `pagehide` covers the ordinary case; the reaper
 *     covers a renderer that crashed without running any script.
 *
 * Driven through the real registry with fake timers rather than through a
 * test-only seam, so the reap INTERVAL is exercised too — a reaper that never
 * fires is the failure worth catching, and a hand-called `reapNow()` would
 * pass happily without one.
 *
 * The bridge deliberately reports no engine, so `hostClient()` fails fast and
 * the feed settles in `error` without touching Perspective or a socket. That
 * is the point: subscriber lifetime is independent of whether the feed ever
 * connected, and asserting it without a WASM engine keeps this a unit test.
 */

const bridge = { attachPort: () => {}, serverWasm: () => null };

const config = (tableName: string): WorkerFeedConfig => ({
  tableName,
  schema: { positionId: 'string', pnl: 'float' },
  index: 'positionId',
  keyColumn: 'positionId',
  wsUrl: 'ws://localhost:0',
  clientId: 'test',
  snapshotEndToken: 'Success',
  snapshotRows: 10,
  rate: 1,
  batchSize: 1,
  updatesPerTick: 1,
  clientWasmUrl: 'http://localhost/perspective-js.wasm',
});

/** Distinct `MessagePort`s — a port is what the worker counts subscribers by,
 *  one per page rather than one per blotter. */
const ports = (): MessagePort[] => {
  const a = new MessageChannel();
  const b = new MessageChannel();
  return [a.port1, b.port1];
};

let registry: WorkerFeedRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  // After the fake clock is installed: the registry arms its reap interval in
  // its constructor.
  registry = new WorkerFeedRegistry(bridge);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('worker feed subscribers', () => {
  it('joins a running feed instead of starting a second one', async () => {
    const [a, b] = ports();
    await registry.start(a!, config('positions'));
    await registry.start(b!, config('positions'));

    expect(registry.summary(), 'one feed, not one per caller').toHaveLength(1);
    expect(registry.state('positions')?.subscribers, 'both ports on it').toBe(2);
  });

  it('keeps distinct tables on distinct feeds', async () => {
    const [a, b] = ports();
    await registry.start(a!, config('positions'));
    await registry.start(b!, config('trades'));

    expect(registry.summary()).toHaveLength(2);
    expect(registry.state('positions')?.subscribers).toBe(1);
    expect(registry.state('trades')?.subscribers).toBe(1);
  });

  it('stops the feed only when the LAST subscriber releases it', async () => {
    const [a, b] = ports();
    await registry.start(a!, config('positions'));
    await registry.start(b!, config('positions'));

    registry.release(a!, 'positions');
    expect(registry.state('positions')?.subscribers, 'one tab left, feed lives').toBe(1);

    registry.release(b!, 'positions');
    expect(registry.state('positions'), 'last one out stops the feed').toBeNull();
  });

  it('releases every feed a port held when the port is dropped wholesale', async () => {
    // The no-tableName form is what a closing PORT triggers, as opposed to a
    // page letting go of one provider.
    const [a] = ports();
    await registry.start(a!, config('positions'));
    await registry.start(a!, config('trades'));
    expect(registry.summary()).toHaveLength(2);

    registry.release(a!);
    expect(registry.summary(), 'the port held both, and took both with it').toHaveLength(0);
  });
});

describe('worker feed subscriber reaper', () => {
  it('reaps a port that went silent, and stops its feed', async () => {
    const [a] = ports();
    await registry.start(a!, config('positions'));
    expect(registry.state('positions')).not.toBeNull();

    // Under the 5-minute idle timeout nothing may be reclaimed: a blotter
    // with no scrolling and no interaction is legitimately silent, and a
    // hidden tab's heartbeat can be throttled to roughly one a minute.
    await vi.advanceTimersByTimeAsync(240_000);
    expect(registry.state('positions'), 'a quiet blotter is not a dead one').not.toBeNull();

    await vi.advanceTimersByTimeAsync(180_000);
    expect(registry.state('positions'), 'a page that crashed cannot say pagehide').toBeNull();
  });

  it('never reaps a port that is still beating', async () => {
    const [a] = ports();
    await registry.start(a!, config('positions'));

    // `feed:ping` every 45s, as the page sends it.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(45_000);
      registry.touch(a!);
    }
    expect(
      registry.state('positions'),
      'fifteen minutes of heartbeats and it was reaped anyway',
    ).not.toBeNull();
    expect(registry.state('positions')?.subscribers).toBe(1);
  });

  it('reaps only the silent port, leaving the live one feeding', async () => {
    const [a, b] = ports();
    await registry.start(a!, config('positions'));
    await registry.start(b!, config('positions'));

    // `a` keeps beating, `b` crashed.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(45_000);
      registry.touch(a!);
    }
    const state = registry.state('positions');
    expect(state, 'the live tab lost its feed with the dead one').not.toBeNull();
    expect(state?.subscribers, 'only the silent port was dropped').toBe(1);
  });
});
