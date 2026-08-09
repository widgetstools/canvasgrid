import type { HubMessage, HubRequest, HubResponse, HubPush } from '../protocol/messages';
import { DataServicesHub } from '../hub/DataServicesHub';

export type HubConnection = {
  post(msg: HubRequest): Promise<HubResponse>;
  onPush(handler: (msg: HubPush) => void): () => void;
  close(): void;
};

let inProcessHub: DataServicesHub | null = null;
let sharedWorker: SharedWorker | null = null;
let sharedWorkerPort: MessagePort | null = null;
let sharedWorkerState: PortState | null = null;

type PortState = {
  port: MessagePort;
  pending: Map<string, { resolve: (r: HubResponse) => void; reject: (e: Error) => void }>;
  pushHandlers: Set<(msg: HubPush) => void>;
  reqSeq: number;
};

function attachPort(port: MessagePort): PortState {
  const state: PortState = {
    port,
    pending: new Map(),
    pushHandlers: new Set(),
    reqSeq: 0,
  };
  port.onmessage = (ev: MessageEvent<HubMessage>) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'push' || data.type === 'status' || data.type === 'rowsReceived' || data.type === 'tickNotify') {
      for (const h of state.pushHandlers) h(data);
      return;
    }
    if ('id' in data) {
      const p = state.pending.get(data.id);
      if (p) {
        state.pending.delete(data.id);
        if (data.type === 'error') p.reject(new Error(data.error));
        else p.resolve(data as HubResponse);
      }
    }
  };
  port.start?.();
  return state;
}

function createConnection(state: PortState): HubConnection {
  const localPush = new Set<(msg: HubPush) => void>();
  const bridge = (msg: HubPush): void => {
    for (const h of localPush) h(msg);
  };
  state.pushHandlers.add(bridge);

  return {
    post(msg: HubRequest): Promise<HubResponse> {
      const id = msg.id || `r${++state.reqSeq}`;
      const full = { ...msg, id, v: 1 as const };
      return new Promise((resolve, reject) => {
        state.pending.set(id, { resolve, reject });
        state.port.postMessage(full);
        setTimeout(() => {
          if (state.pending.has(id)) {
            state.pending.delete(id);
            reject(new Error(`Hub request timeout: ${msg.type}`));
          }
        }, 60_000);
      });
    },
    onPush(handler) {
      localPush.add(handler);
      return () => { localPush.delete(handler); };
    },
    close() {
      localPush.clear();
      state.pushHandlers.delete(bridge);
    },
  };
}

/**
 * Connect to the SharedWorker hub, or an in-process hub when SharedWorker
 * is unavailable (tests / dedicated fallback).
 *
 * In-process mode: each call gets its own MessagePort into a singleton hub
 * (simulates multi-window fan-out in one page).
 *
 * SharedWorker mode: one port per browsing context (browser-managed).
 */
export function connectHub(opts?: {
  workerUrl?: URL | string;
  inProcess?: boolean;
}): HubConnection {
  if (opts?.inProcess || typeof SharedWorker === 'undefined') {
    if (!inProcessHub) inProcessHub = new DataServicesHub();
    const channel = new MessageChannel();
    const state = attachPort(channel.port1);
    inProcessHub.addPort(channel.port2);
    return createConnection(state);
  }

  if (!sharedWorker || !sharedWorkerPort || !sharedWorkerState) {
    const url = opts?.workerUrl ?? new URL('../worker.ts', import.meta.url);
    sharedWorker = new SharedWorker(url, { type: 'module', name: 'vg-data-hub' });
    sharedWorkerPort = sharedWorker.port;
    sharedWorkerState = attachPort(sharedWorkerPort);
  }
  return createConnection(sharedWorkerState);
}

/** Test helper — reset singleton hub/worker. */
export function _resetHubConnectionForTests(): void {
  inProcessHub = null;
  sharedWorker = null;
  sharedWorkerPort = null;
  sharedWorkerState = null;
}
