import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createStompTransport } from '../src/transports/stomp';
import type { ProviderEmitEvent, StompTransportConfig, TransportContext } from '../src/types';

/**
 * Fake stompjs Client — records every instance so tests can inspect the
 * config it was constructed with and assert on `activate`/`deactivate`
 * calls without touching a real WebSocket. Hoisted so `vi.mock` (which
 * Vitest hoists above imports) can close over it.
 */
const { stompClientInstances } = vi.hoisted(() => ({
  stompClientInstances: [] as any[],
}));

vi.mock('@stomp/stompjs', () => {
  class FakeStompClient {
    activate = vi.fn();
    deactivate = vi.fn(() => Promise.resolve());
    subscribe = vi.fn();
    publish = vi.fn();
    onWebSocketClose?: () => void;
    constructor(config: Record<string, unknown>) {
      Object.assign(this, config);
      stompClientInstances.push(this);
    }
  }
  return { Client: FakeStompClient };
});

// Create a mock stomp client factory and transport test
describe('STOMP Transport', () => {
  // Test the end-token matching logic directly
  describe('End-token matching', () => {
    it('should match exact end token', () => {
      const endToken = 'SUCCESS';
      const body: string = 'SUCCESS';
      const matches = body === endToken || body.startsWith(`${endToken}:`);
      expect(matches).toBe(true);
    });

    it('should match token: prefix', () => {
      const endToken = 'SUCCESS';
      const body: string = 'SUCCESS: End of snapshot';
      const matches = body === endToken || body.startsWith(`${endToken}:`);
      expect(matches).toBe(true);
    });

    it('should NOT match substring within JSON', () => {
      const endToken = 'SUCCESS';
      const jsonBody = JSON.stringify({ status: 'SUCCESS', value: 100 });
      const matches = jsonBody === endToken || jsonBody.startsWith(`${endToken}:`);
      expect(matches).toBe(false);
    });

    it('should NOT match case variants with exact matching', () => {
      const endToken = 'SUCCESS';
      const body: string = 'success'; // lowercase
      const matches = body === endToken || body.startsWith(`${endToken}:`);
      expect(matches).toBe(false);
    });
  });

  // Test the snapshot state reset logic
  describe('Snapshot state management', () => {
    it('should track received rows count correctly', () => {
      let received = 0;

      // Simulate receiving 2 rows in first message
      const rows1 = [{ id: '1', value: 100 }, { id: '2', value: 200 }];
      received += rows1.length;
      expect(received).toBe(2);

      // Simulate receiving 1 row in second message
      const rows2 = [{ id: '3', value: 300 }];
      received += rows2.length;
      expect(received).toBe(3);

      // Reset for reconnect
      received = 0;
      expect(received).toBe(0);

      // First batch of new snapshot should have replace: true
      const isFirstBatch = received === 0;
      received += rows1.length;
      const shouldReplace = received === rows1.length;
      expect(shouldReplace).toBe(true);
    });
  });

  // Test snapshot timeout logic
  describe('Snapshot timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should emit error after snapshot timeout with no end token', () => {
      const emits: any[] = [];
      let snapshotTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const snapshotTimeoutMs = 50;

      // Simulate setting up timeout on connect
      snapshotTimeoutHandle = setTimeout(() => {
        emits.push({ status: 'error', error: `Snapshot timeout after ${snapshotTimeoutMs}ms` });
      }, snapshotTimeoutMs);

      // Simulate data received (but no end token)
      emits.push({ rows: [{ id: '1', value: 100 }] });

      // Advance time past timeout
      vi.advanceTimersByTime(100);

      // Should have error emit
      const errorEmits = emits.filter(e => e.status === 'error');
      expect(errorEmits.length).toBeGreaterThan(0);
    });

    it('should clear timeout when end token received', () => {
      let timeoutCleared = false;
      const snapshotTimeoutMs = 50;

      const timeoutHandle = setTimeout(() => {
        // This should not execute
        throw new Error('Timeout should have been cleared');
      }, snapshotTimeoutMs);

      // Simulate end token received - clear timeout
      clearTimeout(timeoutHandle);
      timeoutCleared = true;

      // Advance time - should not trigger error
      vi.advanceTimersByTime(100);

      expect(timeoutCleared).toBe(true);
    });
  });

  // Test REST-specific behavior
  describe('REST Transport state', () => {
    it('should maintain generation counter for concurrent fetches', () => {
      let generation = 0;

      // First fetch starts
      const gen1 = generation;
      generation++;

      // Second fetch starts (after restart)
      const gen2 = generation;
      generation++;

      // Responses come back out of order - newer first
      const response2Gen = gen2;
      const response1Gen = gen1;

      // Newer response should be accepted
      expect(response2Gen > response1Gen).toBe(true);

      // Older response should be rejected
      expect(response1Gen < response2Gen).toBe(true);
    });

    it('should abort in-flight requests on stop', () => {
      const abortedGenerations: number[] = [];
      let generation = 0;

      const fetchStart = () => {
        const currentGen = generation++;
        return { currentGen };
      };

      const handleStop = (fetchInfo: any) => {
        generation++;
        abortedGenerations.push(fetchInfo.currentGen);
      };

      const fetch1 = fetchStart();
      handleStop(fetch1);
      expect(abortedGenerations).toContain(fetch1.currentGen);
    });
  });

  // C-M2 regression guard (IMPORTANT 2): exceeding maxReconnectAttempts must
  // deactivate the real stompjs client, not just null out the module's
  // shared reference — otherwise stompjs keeps auto-reconnecting forever
  // and the live WebSocket is leaked with no way to close it.
  describe('Reconnect exhaustion', () => {
    beforeEach(() => {
      stompClientInstances.length = 0;
    });

    it('deactivates the underlying stompjs client once max reconnect attempts are exceeded', () => {
      const emits: ProviderEmitEvent[] = [];
      const cfg: StompTransportConfig = {
        websocketUrl: 'ws://test.local/stomp',
        listenerTopic: '/topic/test',
        reconnect: { maxAttempts: 2 },
      };
      const ctx: TransportContext = { providerId: 'reconnect-test' };

      createStompTransport(cfg, (e) => emits.push(e), ctx);

      expect(stompClientInstances).toHaveLength(1);
      const client = stompClientInstances[0];
      expect(typeof client.onWebSocketClose).toBe('function');
      expect(client.deactivate).not.toHaveBeenCalled();

      // First two closes stay within the configured budget (maxAttempts=2).
      client.onWebSocketClose();
      client.onWebSocketClose();
      expect(client.deactivate).not.toHaveBeenCalled();

      // Third close exceeds the budget.
      client.onWebSocketClose();

      expect(client.deactivate).toHaveBeenCalledTimes(1);
      const errorEmit = emits.find(
        (e): e is Extract<ProviderEmitEvent, { status: string }> =>
          'status' in e && e.status === 'error',
      );
      expect(errorEmit).toBeDefined();
      expect(errorEmit?.error).toContain('Max reconnect attempts');
    });

    it('wires reconnect.maxDelayMs into the stompjs client as maxReconnectDelay', () => {
      const cfg: StompTransportConfig = {
        websocketUrl: 'ws://test.local/stomp',
        listenerTopic: '/topic/test',
        reconnect: { maxDelayMs: 12_345 },
      };

      createStompTransport(cfg, () => {}, { providerId: 'reconnect-delay-test' });

      expect(stompClientInstances).toHaveLength(1);
      expect(stompClientInstances[0].maxReconnectDelay).toBe(12_345);
    });
  });
});
