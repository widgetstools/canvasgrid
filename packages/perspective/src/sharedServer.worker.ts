/**
 * Phase 5 — SharedWorker host for the Perspective WASM server.
 *
 * One engine per origin, one session PER CONNECTED PORT (tab). The stock
 * `@perspective-dev/client` inline worker script has SharedWorker `connect`
 * wiring but keeps a single module-global session, so a second tab clobbers
 * the first (requests route into the newest session, replies go to the
 * wrong port). This host is a faithful port of that script's engine
 * machinery with the one structural fix: a session per port.
 *
 * Wire protocol per port (identical to the stock dedicated worker, so the
 * unmodified `perspective.worker(sharedWorker)` client speaks it):
 *   in : { cmd: 'init', id, args: [serverWasm] } — wasm is a compiled
 *         `WebAssembly.Module` (structured-cloned) or an ArrayBuffer.
 *   out: { id }                                  — init ack.
 *   in : ArrayBuffer                             — protobuf request bytes.
 *   out: ArrayBuffer                             — protobuf response bytes.
 *   in : { cmd: 'close' }                        — page is going away.
 *   in : { cmd: 'ping' }                         — liveness, for the reaper.
 *   in : { cmd: 'stats', id }                    — diagnostics.
 *   out: { id, stats }                             (see SharedEngineStats)
 *
 * SESSION LIFETIME is the load-bearing part of this host, because the engine
 * is per-ORIGIN and outlives every page that connects to it. A session the
 * engine still believes is connected keeps everything that session owns —
 * views, their materialised state, their update subscriptions — so a session
 * that is never closed leaks for as long as the worker lives. Three things
 * close one, in descending order of reliability:
 *
 *   1. `{ cmd: 'close' }` from the page's `pagehide` (see
 *      `bootstrap.ts::armSessionRelease`). Perspective's own browser client
 *      sends nothing on unload, so this is ours to do.
 *   2. The MessagePort `close` event — Chrome ≥ 132 only.
 *   3. The idle reaper below, for a renderer that crashed or was discarded
 *      without running any script at all.
 *
 * With a single tab none of this showed: the last disconnect terminates the
 * SharedWorker and takes the engine with it. With two or more open, the
 * worker survives every reload — and before (1) and (3) existed, each page
 * load stranded a session until the shared engine ran the tab out of memory.
 */

/// <reference lib="webworker" />

// Emscripten glue for the server engine. The `./dist/*` export makes this
// importable directly; instantiation goes through our `instantiateWasm`
// hook (fed by the init message's module), so the glue never fetches the
// .wasm itself.
import MainModuleFactory from '@perspective-dev/server/dist/wasm/perspective-server.js';

interface MainModule {
  HEAPU8: Uint8Array;
  _psp_new_server(realtime: number): number;
  _psp_new_session(server: number): number;
  _psp_close_session(server: number, session: number): void;
  _psp_handle_request(server: number, client: number, ptr: number, len: number | bigint): number | bigint | Promise<number | bigint>;
  _psp_poll(server: number): number | bigint | Promise<number | bigint>;
  _psp_alloc(len: number | bigint): number | bigint;
  _psp_free(ptr: number | bigint): void;
  _psp_is_memory64(): number;
}

type SendFn = (data: Uint8Array) => void | Promise<void>;

/** Serialize engine calls — the WASM server is not reentrant. */
class OpQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const t = this.tail.then(fn, fn);
    this.tail = t.then(() => undefined, () => undefined);
    return t;
  }
}

/** Walk + free a `_psp_handle_request` / `_psp_poll` response batch.
 *  Faithful port of the stock script's response iterator, including the
 *  memory64 layouts and the free order. */
async function drainResponses(
  mod: MainModule,
  resultPtr: number | bigint,
  cb: (msg: { clientId: number; data: Uint8Array }) => Promise<void> | void,
): Promise<void> {
  const mem64 = mod._psp_is_memory64() !== 0;
  const header = new DataView(mod.HEAPU8.buffer, Number(resultPtr) >>> 0, mem64 ? 12 : 8);
  const count = header.getUint32(0, true);
  const arrPtr = mem64 ? header.getBigInt64(4, true) : header.getUint32(4, true);
  const entries = new DataView(mod.HEAPU8.buffer, Number(arrPtr), count * (mem64 ? 16 : 12));
  try {
    for (let i = 0; i < count; i++) {
      const [dataPtr, len, clientId] = mem64
        ? [entries.getBigInt64(i * 16, true), entries.getInt32(i * 16 + 8, true), entries.getInt32(i * 16 + 12, true)]
        : [entries.getUint32(i * 12, true), entries.getUint32(i * 12 + 4, true), entries.getInt32(i * 12 + 8, true)];
      const data = new Uint8Array(mod.HEAPU8.buffer, Number(dataPtr), Number(len));
      await cb({ clientId, data });
    }
  } finally {
    for (let i = 0; i < count; i++) {
      const dataPtr = mem64 ? entries.getBigInt64(i * 16, true) : entries.getInt32(i * 12, true);
      mod._psp_free(dataPtr);
    }
    mod._psp_free(mem64 ? BigInt(entries.byteOffset) : entries.byteOffset);
    mod._psp_free(mem64 ? BigInt(header.byteOffset) : header.byteOffset);
  }
}

/** Copy request bytes into WASM memory around `fn`. */
async function withCopiedBytes<T>(
  mod: MainModule,
  bytes: Uint8Array,
  fn: (ptr: number) => Promise<T>,
): Promise<T> {
  const mem64 = mod._psp_is_memory64() !== 0;
  const ptr = mod._psp_alloc(mem64 ? BigInt(bytes.byteLength) : bytes.byteLength);
  mod.HEAPU8.set(bytes, Number(ptr) >>> 0);
  try {
    return await fn(Number(ptr) >>> 0);
  } finally {
    mod._psp_free(ptr);
  }
}

/**
 * How long a session may go without any sign of life before the reaper
 * closes it.
 *
 * Liveness is whatever the page sends: a protobuf request, or the
 * `{ cmd: 'ping' }` heartbeat `bootstrap.ts` sends on a timer for exactly
 * this purpose (an open blotter can be legitimately silent for minutes — no
 * scrolling, no feed — and must never be mistaken for a dead one).
 *
 * The margin is deliberately wide. Chrome throttles a hidden tab's timers to
 * roughly one per minute, so a 45s heartbeat can arrive as slowly as ~60s
 * apart; five minutes leaves room for several missed beats before anything
 * is reclaimed.
 */
const SESSION_IDLE_TIMEOUT_MS = 300_000;
/** How often the reaper looks. */
const SESSION_REAP_INTERVAL_MS = 60_000;

/**
 * Wire-protocol version of this worker, exchanged via `{ cmd: 'hello' }`.
 *
 * This exists because the script is deployed ONCE PER ORIGIN while the apps
 * that talk to it ship on their own cycles — so a rollout genuinely does put
 * an older page and a newer worker on the same port, and the mismatch has to
 * be survivable rather than merely detected.
 *
 * Bump it when the messages, their shapes, or the expectations either side
 * places on the other change. `1` is the first version that says hello at
 * all; a client that never does is pre-1 and is handled explicitly (see the
 * reaper).
 */
const SHARED_ENGINE_PROTOCOL = 1;

class EngineSession {
  /** Last time this session was heard from — see the reaper on `Engine`. */
  lastSeen = Date.now();
  /**
   * Whether this client announced itself (protocol >= 1) and therefore sends
   * heartbeats. Load-bearing for the reaper: a client that never said hello
   * predates the heartbeat and stays silent when idle, so its silence means
   * nothing and MUST NOT be read as death.
   */
  heartbeats = false;
  /** Protocol the client announced, or 0 for a pre-hello client. Reported
   *  through `stats` so a mixed-version origin is visible rather than
   *  inferred from symptoms. */
  clientProtocol = 0;

  constructor(
    private readonly engine: Engine,
    readonly clientId: number,
  ) {}

  async handleRequest(bytes: Uint8Array): Promise<void> {
    this.lastSeen = Date.now();
    const mod = this.engine.mod;
    const mem64 = mod._psp_is_memory64() !== 0;
    const result = await withCopiedBytes(mod, bytes, (ptr) =>
      this.engine.lock.run(() =>
        mod._psp_handle_request(this.engine.server, this.clientId, ptr, mem64 ? BigInt(bytes.byteLength) : bytes.byteLength),
      ),
    );
    await drainResponses(mod, result, async (msg) => {
      await this.engine.clients.get(msg.clientId)?.(msg.data);
    });
    await this.engine.schedulePoll();
  }

  close(): void {
    this.engine.forgetSession(this);
    this.engine.mod._psp_close_session(this.engine.server, this.clientId);
    this.engine.clients.delete(this.clientId);
  }
}

/** One WASM server; sessions map 1:1 to connected ports. */
class Engine {
  readonly clients = new Map<number, SendFn>();
  readonly lock = new OpQueue();
  readonly server: number;
  private pollHandle: Promise<void> | undefined;
  /** Live sessions, so the reaper can find ones whose page is gone. */
  private readonly sessions = new Set<EngineSession>();

  constructor(readonly mod: MainModule) {
    // realtime flag on: the engine requests polls (live table updates fan
    // out to every session's client without an explicit request).
    this.server = mod._psp_new_server(1);
    this.startReaper();
  }

  makeSession(send: SendFn): EngineSession {
    const clientId = this.mod._psp_new_session(this.server);
    this.clients.set(clientId, send);
    const session = new EngineSession(this, clientId);
    this.sessions.add(session);
    return session;
  }

  forgetSession(session: EngineSession): void {
    this.sessions.delete(session);
  }

  /** Distinct protocols across live sessions, ascending. */
  clientProtocols(): number[] {
    return [...new Set([...this.sessions].map((s) => s.clientProtocol))].sort((a, b) => a - b);
  }

  /**
   * Close sessions whose page stopped talking.
   *
   * The explicit `{ cmd: 'close' }` a page sends on `pagehide` covers the
   * ordinary case; this covers the one it cannot — a renderer that crashed,
   * was killed under memory pressure, or was discarded without running any
   * script. Without it a single crashed tab strands its session, and its
   * views, in an engine that never restarts while any other tab is open.
   */
  private startReaper(): void {
    setInterval(() => {
      const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS;
      for (const session of [...this.sessions]) {
        // A client that never said hello predates the heartbeat: it goes
        // quiet when idle and always did. Reaping it would close a LIVE
        // blotter's session out from under it after five minutes — which is
        // exactly what a rollout produces, an older page against this newer
        // worker. Its sessions leak on crash, as they did before this worker
        // existed; that is recoverable, and being killed mid-session is not.
        if (!session.heartbeats) continue;
        if (session.lastSeen >= cutoff) continue;
        try { session.close(); } catch { /* already gone */ }
      }
    }, SESSION_REAP_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    const result = await this.lock.run(() => this.mod._psp_poll(this.server));
    await drainResponses(this.mod, result, async (msg) => {
      await this.clients.get(msg.clientId)?.(msg.data);
    });
  }

  /** Debounced poll — mirrors the stock host's poll-handle dedup so a
   *  burst of requests coalesces into one engine poll per macrotask. */
  schedulePoll(): Promise<void> {
    if (!this.pollHandle) {
      this.pollHandle = new Promise((resolve, reject) =>
        setTimeout(() =>
          this.poll().then(resolve).catch(reject).finally(() => {
            this.pollHandle = undefined;
          }),
        ),
      );
    }
    return this.pollHandle;
  }
}

let enginePromise: Promise<Engine> | null = null;

function ensureEngine(wasm: WebAssembly.Module | ArrayBuffer): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      let modRef: MainModule | null = null;
      const mod: MainModule = await (MainModuleFactory as (opts: unknown) => Promise<MainModule>)({
        instantiateWasm: (
          imports: WebAssembly.Imports,
          done: (instance: WebAssembly.Instance) => void,
        ) => {
          // The client-side dedicated host injects these two beyond what
          // the standalone glue stubs; provide them so either wasm build
          // links (extra imports are ignored).
          const env = imports.env as Record<string, unknown>;
          env.psp_stack_trace ??= () => 0;
          env.psp_heap_size ??= () => modRef?.HEAPU8?.buffer.byteLength ?? 0;
          void (async () => {
            const instance = wasm instanceof WebAssembly.Module
              ? await WebAssembly.instantiate(wasm, imports)
              : (await WebAssembly.instantiate(wasm, imports)).instance;
            done(instance);
          })();
          return {};
        },
      });
      modRef = mod;
      return new Engine(mod);
    })();
  }
  return enginePromise;
}

interface InitMessage {
  cmd: 'init';
  id: number;
  args: [WebAssembly.Module | ArrayBuffer];
}

/**
 * What `{ cmd: 'stats' }` reports back.
 *
 * The engine is per-ORIGIN and outlives every page that talks to it, so its
 * WASM linear memory is the one number that matters when a tab dies with
 * "Out of Memory": it only ever grows, and nothing on a page can see it.
 * `sessions` is the live port count — a reload that fails to close its
 * session shows up here as a count that climbs and never falls.
 */
export interface SharedEngineStats {
  /** WASM linear memory currently committed, in bytes. */
  heapBytes: number;
  /** Sessions the engine still believes are connected. */
  sessions: number;
  /** False before the first `init` — nothing has been measured yet. */
  engineUp: boolean;
  /** Wire protocol this deployed worker speaks. */
  protocol: number;
  /**
   * Protocols announced by the currently-connected clients, ascending and
   * deduped. `0` is a pre-hello client. More than one entry means a rollout
   * is mid-flight on this origin — worth being able to see directly, since
   * every symptom of it otherwise looks like something else.
   */
  clientProtocols: number[];
}

function attachPort(port: MessagePort): void {
  let session: EngineSession | null = null;
  const send: SendFn = (data) => {
    const buf = data.slice().buffer;
    port.postMessage(buf, { transfer: [buf] });
  };
  const close = (): void => {
    try { session?.close(); } catch { /* engine already gone */ }
    session = null;
  };
  port.addEventListener('message', (ev: MessageEvent) => {
    void (async () => {
      const d = ev.data as
        | InitMessage
        | { cmd: 'close' | 'ping' }
        | { cmd: 'stats'; id: number }
        | ArrayBuffer;
      try {
        if (d instanceof ArrayBuffer) {
          if (session) await session.handleRequest(new Uint8Array(d));
          return;
        }
        if ((d as { cmd?: string })?.cmd === 'ping') {
          // Liveness only — no reply, so a heartbeat costs one postMessage.
          if (session) session.lastSeen = Date.now();
          return;
        }
        if ((d as { cmd?: string })?.cmd === 'hello') {
          // Version exchange AND the heartbeat opt-in, deliberately one
          // message: a client that can say hello is by definition one that
          // sends pings, so the reaper's precondition and the version it
          // negotiated can never disagree.
          const msg = d as { id: number; protocol?: number };
          if (session) {
            session.heartbeats = true;
            session.lastSeen = Date.now();
            session.clientProtocol = typeof msg.protocol === 'number' ? msg.protocol : 0;
          }
          port.postMessage({ id: msg.id, protocol: SHARED_ENGINE_PROTOCOL });
          return;
        }
        if (d?.cmd === 'init') {
          const engine = await ensureEngine(d.args[0]);
          close();
          session = engine.makeSession(send);
          port.postMessage({ id: d.id });
          return;
        }
        if (d?.cmd === 'close') { close(); return; }
        if ((d as { cmd?: string })?.cmd === 'stats') {
          // Answerable without a session, so a diagnostic port can connect,
          // ask, and leave without touching the engine's session bookkeeping.
          const engine = enginePromise ? await enginePromise : null;
          const stats: SharedEngineStats = {
            heapBytes: engine?.mod.HEAPU8.buffer.byteLength ?? 0,
            sessions: engine?.clients.size ?? 0,
            engineUp: engine !== null,
            protocol: SHARED_ENGINE_PROTOCOL,
            clientProtocols: engine ? engine.clientProtocols() : [],
          };
          port.postMessage({ id: (d as { id: number }).id, stats });
          return;
        }
      } catch (err) {
        console.error('[psp-shared-worker]', err);
      }
    })();
  });
  // Chrome ≥ 132 fires 'close' when the other end is closed or its
  // document is destroyed — the reliable path for session cleanup.
  try {
    (port as MessagePort & { onclose?: unknown }).addEventListener?.('close', close as EventListener);
  } catch { /* older engines: cmd:'close' + leak-on-crash is the fallback */ }
  port.start();
}

(self as unknown as SharedWorkerGlobalScope).addEventListener('connect', (ev) => {
  attachPort((ev as MessageEvent).ports[0]!);
});
