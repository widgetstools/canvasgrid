/**
 * vg-new — SharedWorker host for the Perspective WASM server.
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
 *   in : { cmd: 'close' }                        — page unload courtesy close.
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

class EngineSession {
  constructor(
    private readonly engine: Engine,
    readonly clientId: number,
  ) {}

  async handleRequest(bytes: Uint8Array): Promise<void> {
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

  constructor(readonly mod: MainModule) {
    // realtime flag on: the engine requests polls (live table updates fan
    // out to every session's client without an explicit request).
    this.server = mod._psp_new_server(1);
  }

  makeSession(send: SendFn): EngineSession {
    const clientId = this.mod._psp_new_session(this.server);
    this.clients.set(clientId, send);
    return new EngineSession(this, clientId);
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
      const d = ev.data as InitMessage | { cmd: 'close' } | ArrayBuffer;
      try {
        if (d instanceof ArrayBuffer) {
          if (session) await session.handleRequest(new Uint8Array(d));
          return;
        }
        if (d?.cmd === 'init') {
          const engine = await ensureEngine(d.args[0]);
          close();
          session = engine.makeSession(send);
          port.postMessage({ id: d.id });
          return;
        }
        if (d?.cmd === 'close') close();
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
