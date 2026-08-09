/**
 * Main-thread Test Connection + Infer Fields (Markets useProviderProbe parity).
 * Does not require the SharedWorker — uses transport factories / @stomp/stompjs.
 */
import { Client } from '@stomp/stompjs';
import type {
  DataProviderConfig,
  FieldInfo,
  MockTransportConfig,
  RestTransportConfig,
  StompTransportConfig,
  TransportConfig,
} from '../types';
import { createMockTransport } from '../transports/mock';
import { createRestTransport } from '../transports/rest';
import { createStompTransport } from '../transports/stomp';
import { inferFieldsFromRows, fieldsToColumnDefinitions } from '../schema/infer';
import type { ColumnDefinition } from '../types';

export type ProbeResult = {
  ok: boolean;
  rows?: readonly unknown[];
  error?: string;
};

export type ProbeOpts = {
  maxRows?: number;
  timeoutMs?: number;
};

export type TestResult = { success: boolean; rowCount?: number; error?: string };

export type InferenceSummary = {
  rowsFetched: number;
  rowsUsed: number;
  fieldsDetected: number;
};

export type ProviderProbe = {
  testing: boolean;
  testResult: TestResult | null;
  inferring: boolean;
  inferredFields: FieldInfo[];
  inferenceSummary: InferenceSummary | null;
  inferenceError: string | null;
  test(): Promise<void>;
  infer(opts?: { sampleSize?: number }): Promise<void>;
  reset(): void;
  /** Subscribe to state changes (for DOM re-render). */
  subscribe(listener: () => void): () => void;
};

export async function connectStomp(
  cfg: StompTransportConfig,
  opts: ProbeOpts = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  if (!cfg.websocketUrl || cfg.websocketUrl.includes('{{')) {
    return {
      ok: false,
      error: `Unresolved or missing WebSocket URL: ${cfg.websocketUrl || '(empty)'}`,
    };
  }
  let settled = false;
  let client: Client | null = null;
  return new Promise((resolve) => {
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { void client?.deactivate(); } catch { /* */ }
      client = null;
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: `Connection timed out after ${timeoutMs}ms` }),
      timeoutMs,
    );
    try {
      client = new Client({
        brokerURL: cfg.websocketUrl,
        reconnectDelay: 0,
        heartbeatIncoming: cfg.heartbeat?.incoming ?? 4000,
        heartbeatOutgoing: cfg.heartbeat?.outgoing ?? 4000,
        onConnect: () => finish({ ok: true }),
        onWebSocketError: () => finish({ ok: false, error: 'WebSocket connection failed' }),
        onStompError: (frame) =>
          finish({ ok: false, error: frame.headers['message'] ?? 'STOMP error' }),
      });
      client.activate();
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export async function probeStomp(
  cfg: StompTransportConfig,
  opts: ProbeOpts = {},
): Promise<ProbeResult> {
  const max = opts.maxRows ?? 200;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const collected: unknown[] = [];
  let settled = false;
  return new Promise((resolve) => {
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { handle.stop(); } catch { /* */ }
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: `Probe timed out after ${timeoutMs}ms` }),
      timeoutMs,
    );
    const handle = createStompTransport(
      { ...cfg, autoStart: true, throttleEnabled: false },
      (event) => {
        if ('rows' in event && event.rows) {
          for (const r of event.rows) {
            collected.push(r);
            if (collected.length >= max) {
              finish({ ok: true, rows: collected });
              return;
            }
          }
        }
        if ('status' in event) {
          if (event.status === 'ready') finish({ ok: true, rows: collected });
          if (event.status === 'error') {
            finish({ ok: false, error: event.error ?? 'Unknown STOMP error' });
          }
        }
      },
      { providerId: 'probe' },
    );
  });
}

export async function probeRest(cfg: RestTransportConfig): Promise<ProbeResult> {
  const collected: unknown[] = [];
  return new Promise((resolve) => {
    const handle = createRestTransport(
      { ...cfg, pollInterval: 0 },
      (event) => {
        if ('rows' in event && event.rows) {
          collected.push(...event.rows);
        }
        if ('status' in event) {
          if (event.status === 'ready') {
            handle.stop();
            resolve({ ok: true, rows: collected });
          }
          if (event.status === 'error') {
            handle.stop();
            resolve({ ok: false, error: event.error ?? 'REST error' });
          }
        }
      },
      { providerId: 'probe' },
    );
  });
}

export async function probeMock(
  cfg: MockTransportConfig,
  opts: ProbeOpts = {},
): Promise<ProbeResult> {
  const max = opts.maxRows ?? 200;
  const collected: unknown[] = [];
  return new Promise((resolve) => {
    const handle = createMockTransport(
      { ...cfg, rowCount: Math.min(cfg.rowCount ?? max, max), tickMs: 0 },
      (event) => {
        if ('rows' in event && event.rows) collected.push(...event.rows);
        if ('status' in event && event.status === 'ready') {
          handle.stop();
          resolve({ ok: true, rows: collected.slice(0, max) });
        }
      },
      { providerId: 'probe' },
    );
  });
}

async function testConnectionOnce(
  type: string,
  cfg: TransportConfig,
  opts: ProbeOpts,
): Promise<ProbeResult> {
  switch (type) {
    case 'stomp':
      return connectStomp(cfg as unknown as StompTransportConfig, opts);
    case 'rest':
      return probeRest(cfg as unknown as RestTransportConfig);
    case 'mock':
      return probeMock(cfg as unknown as MockTransportConfig, { maxRows: opts.maxRows ?? 5 });
    default:
      return { ok: false, error: `Test not implemented for ${type}` };
  }
}

async function probeOnce(
  type: string,
  cfg: TransportConfig,
  opts: ProbeOpts,
): Promise<ProbeResult> {
  switch (type) {
    case 'stomp':
      return probeStomp(cfg as unknown as StompTransportConfig, opts);
    case 'rest':
      return probeRest(cfg as unknown as RestTransportConfig);
    case 'mock':
      return probeMock(cfg as unknown as MockTransportConfig, opts);
    default:
      return { ok: false, error: `Probe not implemented for ${type}` };
  }
}

/** Build column defs from selected inferred field paths (Markets FieldsTab.buildColumns). */
export function buildColumnsFromFields(
  fields: FieldInfo[],
  selected: readonly string[],
): ColumnDefinition[] {
  const byPath = new Map(fields.map((f) => [f.path, f]));
  return selected
    .map((path) => byPath.get(path))
    .filter((f): f is FieldInfo => Boolean(f))
    .filter((f) => f.inferredType !== 'object')
    .map((f) => {
      const cell = f.inferredType === 'date'
        ? 'date'
        : f.inferredType === 'unknown'
          ? 'text'
          : f.inferredType;
      return {
        field: f.path,
        headerName: f.path.split('.').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' '),
        cellDataType: cell as ColumnDefinition['cellDataType'],
        filter: true,
        sortable: true,
        resizable: true,
      };
    });
}

export function createProviderProbe(
  getConfig: () => Pick<DataProviderConfig, 'providerType' | 'config'>,
): ProviderProbe {
  let testing = false;
  let testResult: TestResult | null = null;
  let inferring = false;
  let inferredFields: FieldInfo[] = [];
  let inferenceSummary: InferenceSummary | null = null;
  let inferenceError: string | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const api: ProviderProbe = {
    get testing() { return testing; },
    get testResult() { return testResult; },
    get inferring() { return inferring; },
    get inferredFields() { return inferredFields; },
    get inferenceSummary() { return inferenceSummary; },
    get inferenceError() { return inferenceError; },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reset() {
      testing = false;
      testResult = null;
      inferring = false;
      inferredFields = [];
      inferenceSummary = null;
      inferenceError = null;
      notify();
    },
    async test() {
      const { providerType, config } = getConfig();
      testing = true;
      testResult = null;
      notify();
      try {
        const result = await testConnectionOnce(providerType, config, {
          maxRows: 5,
          timeoutMs: 10_000,
        });
        testResult = result.ok
          ? { success: true, rowCount: result.rows?.length }
          : { success: false, error: result.error };
      } catch (err) {
        testResult = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        testing = false;
        notify();
      }
    },
    async infer(opts = {}) {
      const sampleSize = opts.sampleSize ?? 200;
      const { providerType, config } = getConfig();
      inferring = true;
      inferenceError = null;
      notify();
      try {
        const fetchSize = Math.min(Math.max(sampleSize * 2, sampleSize + 50), 1000);
        const result = await probeOnce(providerType, config, {
          maxRows: fetchSize,
          timeoutMs: 30_000,
        });
        if (!result.ok) {
          inferenceError = result.error ?? 'probe failed';
          return;
        }
        const rows = result.rows ?? [];
        const fields = inferFieldsFromRows(rows, { maxRows: sampleSize });
        inferredFields = fields;
        inferenceSummary = {
          rowsFetched: rows.length,
          rowsUsed: Math.min(rows.length, sampleSize),
          fieldsDetected: fields.length,
        };
      } catch (err) {
        inferenceError = err instanceof Error ? err.message : String(err);
      } finally {
        inferring = false;
        notify();
      }
    },
  };
  return api;
}

export { fieldsToColumnDefinitions };
