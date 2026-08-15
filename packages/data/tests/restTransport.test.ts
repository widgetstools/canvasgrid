import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRestTransport } from '../src/transports/rest';
import type { RestTransportConfig, ProviderEmit } from '../src/types';

describe('REST Transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const createTestConfig = (overrides: Partial<RestTransportConfig> = {}): RestTransportConfig => ({
    baseUrl: 'http://localhost:8080',
    endpoint: '/api/data',
    pollInterval: 0, // Disable polling by default in tests
    ...overrides,
  });

  const createEmit = () => {
    const calls: any[] = [];
    const emit: ProviderEmit = (event) => {
      calls.push(event);
    };
    return { emit, calls };
  };

  it('should not emit status/rows after stop is called mid-fetch', async () => {
    const { emit, calls } = createEmit();
    const cfg = createTestConfig();

    let resolveFetch: any;
    const fetchPromise = new Promise<Response>(resolve => {
      resolveFetch = resolve;
    });

    (global.fetch as any).mockReturnValue(fetchPromise);

    const transport = createRestTransport(cfg, emit, { providerId: 'test-provider' });

    // Stop the transport before fetch resolves
    vi.advanceTimersByTime(10);
    transport.stop();

    // Now resolve the fetch
    resolveFetch(new Response(JSON.stringify([{ id: '1', value: 100 }]), { status: 200 }));

    // Advance to allow pending microtasks
    await vi.runAllTimersAsync();

    // Verify no rows were emitted after stop
    const rowsEmits = calls.filter(c => c.rows);
    expect(rowsEmits).toHaveLength(0);
  });

  it('should resume polling after restart', () => {
    const { emit, calls } = createEmit();
    const cfg = createTestConfig({ pollInterval: 100 });

    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify([{ id: '1', value: 100 }]), { status: 200 })
    );

    const transport = createRestTransport(cfg, emit, { providerId: 'test-provider' });

    // At this point, initial fetch should be in progress
    const initialFetchCount = (global.fetch as any).mock.calls.length;

    // Stop the transport
    transport.stop();

    // Verify status changed to disconnected
    const disconnectEmits = calls.filter(c => c.status === 'disconnected');
    expect(disconnectEmits.length).toBeGreaterThan(0);

    // Restart should trigger a new fetch
    transport.restart();

    // After restart, there should be at least one more fetch call
    expect((global.fetch as any).mock.calls.length).toBeGreaterThanOrEqual(initialFetchCount + 1);
  });

  it('should ignore stale responses when generation changes', async () => {
    const { emit, calls } = createEmit();
    const cfg = createTestConfig();

    const fetchResponses: any[] = [];
    const resolvers: ((value: any) => void)[] = [];

    (global.fetch as any).mockImplementation(() => {
      return new Promise(resolve => {
        resolvers.push(resolve);
        fetchResponses.push(resolve);
      });
    });

    const transport = createRestTransport(cfg, emit, { providerId: 'test-provider' });

    // Start first fetch
    vi.advanceTimersByTime(1);

    // Start second fetch (by calling restart which increments generation)
    const oldResolvers = [...resolvers];
    resolvers.length = 0;
    transport.restart();

    // Now resolve them in reverse order (newer first, then older)
    const newResolve = resolvers[0];
    if (!newResolve) throw new Error('expected a pending fetch resolver after restart');
    newResolve(new Response(JSON.stringify([{ id: '1', value: 200 }]), { status: 200 }));

    // Resolve the old/stale fetch last
    const oldResolve = oldResolvers[0];
    if (!oldResolve) throw new Error('expected a pending resolver for the original fetch');
    oldResolve(new Response(JSON.stringify([{ id: '1', value: 100 }]), { status: 200 }));

    // Let microtasks settle
    await vi.runAllTimersAsync();

    // The final rows should be from the newer fetch (200), not the stale one (100)
    const rowsEmits = calls.filter(c => c.rows && c.rows.length > 0);
    expect(rowsEmits.length).toBeGreaterThan(0);
    const lastRows = rowsEmits[rowsEmits.length - 1];
    expect(lastRows.rows[0]?.value).toBe(200);
  });
});
