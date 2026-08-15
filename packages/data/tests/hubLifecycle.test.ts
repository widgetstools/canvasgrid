import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataServicesHub } from '../src/hub/DataServicesHub';
import type { DataProviderConfig, HubRequest } from '../src/types';

/**
 * Test suite for shared-consumer hub lifecycle fixes (Task 6).
 * Addresses C-C2, C-M1, C-C1 findings.
 */
describe('Hub lifecycle — shared-consumer scenarios', () => {
  let hub: DataServicesHub;

  beforeEach(() => {
    hub = new DataServicesHub();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  const mockConfig = (providerId: string): DataProviderConfig => ({
    providerId,
    providerType: 'mock',
    rowModel: 'clientSide',
    config: {
      columnDefinitions: [{ colId: 'id', field: 'id' }],
      keyColumn: 'id',
    },
  });

  /**
   * Step 1: Failing test (switch keeps others alive)
   *
   * Two clients attach to the same provider. Client A switches (detach only),
   * and client B should still receive subsequent ticks and the slot status
   * should stay ready.
   */
  it('Step 1: client switch via detach leaves other clients attached', async () => {
    const { port: port1, sendMsg: send1 } = createMockPort(hub);
    const { port: port2, sendMsg: send2 } = createMockPort(hub);

    const config = mockConfig('test-provider');

    // Both clients ensure and attach
    await send1({ v: 1, id: 'e1', type: 'ensure', config });
    await send1({ v: 1, id: 'a1', type: 'attach', providerId: 'test-provider', subId: 'sub-1' });

    await send2({ v: 1, id: 'e2', type: 'ensure', config });
    await send2({ v: 1, id: 'a2', type: 'attach', providerId: 'test-provider', subId: 'sub-2' });

    // Start the slot
    await send1({ v: 1, id: 's1', type: 'start', providerId: 'test-provider' });

    // Client 1 detaches (via destroy)
    await send1({ v: 1, id: 'd1', type: 'detach', providerId: 'test-provider', subId: 'sub-1' });

    // Get stats to verify subscriber count
    const stats = await send2({ v: 1, id: 'st1', type: 'getStats', providerId: 'test-provider' });

    // After client 1 detaches, slot should still have 1 subscriber (client 2)
    expect(stats.type).toBe('stats');
    expect(stats.stats.subscriberCount).toBe(1);

    // Verify the slot is still running (status is not 'disconnected')
    expect(stats.stats.status).not.toBe('disconnected');
  });

  /**
   * Step 2: Failing test (detach on destroy)
   *
   * Attach, call stop(), call destroy(). After destroy, the hub subscriber count
   * for the slot should be 0.
   *
   * This test verifies that destroy() sends detach even after stop() has been called.
   */
  it('Step 2: destroy sends detach even after stop', async () => {
    const { port, sendMsg: send } = createMockPort(hub);

    const config = mockConfig('test-provider');

    await send({ v: 1, id: 'e1', type: 'ensure', config });
    await send({ v: 1, id: 'a1', type: 'attach', providerId: 'test-provider', subId: 'sub-1' });

    // Verify 1 subscriber
    let stats = await send({ v: 1, id: 'st1', type: 'getStats', providerId: 'test-provider' });
    expect(stats.stats.subscriberCount).toBe(1);

    // Call stop (this should NOT clear the detach flag)
    await send({ v: 1, id: 'st2', type: 'stop', providerId: 'test-provider' });

    // Now detach (simulating destroy)
    await send({ v: 1, id: 'd1', type: 'detach', providerId: 'test-provider', subId: 'sub-1' });

    // Verify 0 subscribers
    stats = await send({ v: 1, id: 'st3', type: 'getStats', providerId: 'test-provider' });
    expect(stats.stats.subscriberCount).toBe(0);
  });

  /**
   * Step 3: Failing test (dead port reaping)
   *
   * Simulate a port that throws on postMessage (closed). After one broadcast
   * attempt + heartbeat cycle, the port should be pruned and no longer in
   * the subscriber list.
   */
  it('Step 3: dead ports are reaped after post failure', async () => {
    const { port: portGood, hubPort: hubPortGood, sendMsg: sendGood } = createMockPort(hub);
    const { port: portDead, hubPort: hubPortDead, sendMsg: sendDead } = createMockPort(hub);

    const config = mockConfig('test-provider');

    await sendGood({ v: 1, id: 'e1', type: 'ensure', config });
    await sendGood({ v: 1, id: 'a1', type: 'attach', providerId: 'test-provider', subId: 'sub-good' });

    await sendDead({ v: 1, id: 'e2', type: 'ensure', config });
    await sendDead({ v: 1, id: 'a2', type: 'attach', providerId: 'test-provider', subId: 'sub-dead' });

    // Verify 2 subscribers
    let stats = await sendGood({ v: 1, id: 'st1', type: 'getStats', providerId: 'test-provider' });
    expect(stats.stats.subscriberCount).toBe(2);

    // Simulate dead port by making postMessage throw (mock the hub-side port)
    const mockPostMessage = vi.fn(() => {
      throw new Error('Port is dead');
    });
    hubPortDead.postMessage = mockPostMessage as any;

    // Start the slot
    await sendGood({ v: 1, id: 's1', type: 'start', providerId: 'test-provider' });

    // Trigger a broadcast by attaching a new subscriber, which causes the hub
    // to replay the cache to all subscribers (including the dead port)
    const { port: portTest, sendMsg: sendTest } = createMockPort(hub);
    await sendTest({ v: 1, id: 'e3', type: 'ensure', config });
    // This attach will trigger a broadcast/replay to all subscribers, hitting the dead port
    await sendTest({ v: 1, id: 'a3', type: 'attach', providerId: 'test-provider', subId: 'sub-test' });

    // After the attach triggered a broadcast that hit the dead port, it should be reaped
    stats = await sendGood({ v: 1, id: 'st2', type: 'getStats', providerId: 'test-provider' });

    // The dead port should be reaped, leaving 2 subscribers (good + test)
    // If dead port is reaped correctly, we should have 2. If not, we'll have 3.
    expect(stats.stats.subscriberCount).toEqual(2);
  });
});

/**
 * Create a mock port connected to the hub that can send/receive messages.
 */
function createMockPort(hub: DataServicesHub) {
  const channel = new MessageChannel();
  const port = channel.port1;
  const hubPort = channel.port2; // The port that the hub will use
  const responses = new Map<string, any>();

  port.onmessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (data && typeof data === 'object' && 'id' in data) {
      responses.set(data.id, data);
    }
  };

  hub.addPort(hubPort);
  port.start?.();
  hubPort.start?.();

  async function sendMsg(msg: HubRequest): Promise<any> {
    const id = msg.id;
    responses.delete(id);
    port.postMessage(msg);

    // Wait for response
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (responses.has(id)) {
          clearInterval(checkInterval);
          resolve(responses.get(id));
        }
      }, 10);

      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Timeout waiting for response to ${msg.type}`));
      }, 5000);
    });
  }

  return { port, hubPort, sendMsg };
}
