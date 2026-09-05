/**
 * The SSRM feed, running inside the SharedWorker that hosts the engine.
 *
 * Today's arrangement shares the engine but not the transport: rows arrive on
 * one elected tab's main thread and are pushed across into the shared table.
 * Moving the transport here removes the election, the takeover gap, the
 * `BroadcastChannel` that exists only to reach the leading tab, and the
 * 30s `waitForSharedSnapshot` fallback — not by handling those cases better
 * but by not having them: there is one worker, so there is one feed, so there
 * is nothing to elect. It also deletes a cross-thread hop, since the rows are
 * already on the side of the wire the table lives on.
 *
 * Two things had to be established before any of that was possible, and both
 * are worth knowing because neither is obvious from the library's docs:
 *
 * 1. **The worker can hold a real `Table` API against the engine it hosts.**
 *    `@perspective-dev/client` speaks the same protobuf protocol over any
 *    `MessagePort`, so the worker makes an internal `MessageChannel`, attaches
 *    one end as an engine session exactly as a page's port is attached, and
 *    points a `Client` at the other. No second engine, no socket, no copy.
 *
 * 2. **`getCompiledClientWasm()` is not the way in.** Its documentation
 *    offers precisely this use — a structured-cloneable module so a worker can
 *    build its own `Client` without refetching — but `init_client` in this
 *    build dispatches on argument TYPE and has no `WebAssembly.Module` branch:
 *    a Module falls through to the "already-initialised namespace" case and
 *    the client comes out undefined. So the page sends the wasm URL and the
 *    worker fetches it, served from the cache the page just filled. One fetch
 *    per ORIGIN, where the old arrangement paid one per tab.
 */

/// <reference lib="webworker" />

import perspective from '@perspective-dev/client';
import type { Client, Table } from '@perspective-dev/client';
import { Client as StompClient, type IMessage } from '@stomp/stompjs';
import { boundUpdateBuffer, updateBufferCap } from './updateBuffer';
import { rowIdentity } from './rowIdentity';
import type {
  WorkerFeedConfig,
  WorkerFeedPhase,
  WorkerFeedState,
} from './workerFeedProtocol';

/**
 * `@perspective-dev/client` probes for a mounted `<perspective-viewer>` on
 * every wasm lookup, and `customElements` does not exist in a worker — the
 * probe throws a ReferenceError before it can reach the branch that reads the
 * wasm we initialised. A worker genuinely has no such element, so answering
 * "no element" is the truthful shim rather than a workaround, but it has to be
 * installed before the first client call.
 */
function shimCustomElements(): void {
  const g = self as unknown as { customElements?: { get(name: string): unknown } };
  if (typeof g.customElements === 'undefined') {
    g.customElements = { get: () => undefined };
  }
}

/** What the host needs from the engine it is running inside. */
export interface FeedEngineBridge {
  /** Attach a `MessagePort` as an engine session — the same call a page's
   *  port goes through, so the worker's own client is just another client. */
  attachPort(port: MessagePort): void;
  /**
   * The decompressed server wasm the first page handed over on `init`.
   * `perspective.worker()` insists on posting an init frame of its own, and
   * `init_server` must therefore have something to give it. The engine is
   * already up by then and `ensureEngine` is memoised, so the bytes are
   * never instantiated a second time.
   */
  serverWasm(): WebAssembly.Module | ArrayBuffer | null;
}

let hostClientPromise: Promise<Client> | null = null;

/** One `Client` for the whole worker, against the engine already running in
 *  it. Memoised: a second feed joins the same client. */
function hostClient(bridge: FeedEngineBridge, clientWasmUrl: string): Promise<Client> {
  if (hostClientPromise) return hostClientPromise;
  hostClientPromise = (async () => {
    shimCustomElements();
    const serverWasm = bridge.serverWasm();
    if (serverWasm === null) {
      throw new Error('engine is not initialised — no page has sent the server wasm yet');
    }
    // `true` = skip stage 0. These bytes were decompressed by the page before
    // it sent them; running the decompressor over them again would fail.
    perspective.init_server(serverWasm as ArrayBuffer, true);
    perspective.init_client(fetch(clientWasmUrl));
    const channel = new MessageChannel();
    bridge.attachPort(channel.port1);
    return await perspective.worker(Promise.resolve(channel.port2));
  })().catch((err) => {
    hostClientPromise = null;   // a failed build must not poison later starts
    throw err;
  });
  return hostClientPromise;
}

/** Rows out of a STOMP frame body: an array of them, or a single object. */
function extractRows(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as Array<Record<string, unknown>>;
  }
  if (parsed && typeof parsed === 'object') return [parsed as Record<string, unknown>];
  return [];
}

/** How long a control port may go unheard-from before it stops counting as a
 *  subscriber. Matched to the engine's session reaper: a blotter can sit idle
 *  for minutes, and a hidden tab's timers are throttled to about one a
 *  minute. */
const SUBSCRIBER_IDLE_TIMEOUT_MS = 300_000;
/** Push cadence for state that changes continuously (row counts, rates).
 *  Phase changes bypass it — those are what a caller is waiting on. */
const STATE_PUSH_THROTTLE_MS = 250;

type StateListener = (state: WorkerFeedState) => void;

/**
 * One upstream connection, one physical table.
 *
 * Deliberately narrower than `PerspectiveBook`: there are no views here and
 * nothing to notify per view, because the pages own their own views against
 * the same engine and hear about writes through the engine's realtime poll.
 * All this owns is "bytes in, `table.update` out".
 */
class WorkerFeed {
  private table: Table | null = null;
  private stomp: StompClient | null = null;
  private buffer: Array<Record<string, unknown>> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;
  private liveWindow: Array<{ t: number; n: number }> = [];
  private destroyed = false;

  private phase: WorkerFeedPhase = 'idle';
  private snapshotComplete = false;
  private snapshotRowsLoaded = 0;
  private bookSize = 0;
  private liveBatches = 0;
  private liveRowsIn = 0;
  private droppedRowCount = 0;
  private stopped = false;
  private lastError: string | null = null;
  private startedAt: number | null = null;

  /** Control ports holding this feed open, with their last sign of life. */
  private readonly subscribers = new Map<MessagePort, number>();
  private lastPushAt = 0;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  /** See {@link emit} — the trailing push that lets a rate fall to zero. */
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly bridge: FeedEngineBridge,
    readonly config: WorkerFeedConfig,
    private readonly onState: StateListener,
  ) {}

  state(): WorkerFeedState {
    const now = Date.now();
    this.liveWindow = this.liveWindow.filter((s) => now - s.t < 1000);
    return {
      tableName: this.config.tableName,
      phase: this.phase,
      snapshotRowsLoaded: this.snapshotRowsLoaded,
      snapshotComplete: this.snapshotComplete,
      bookSize: this.bookSize,
      liveBatches: this.liveBatches,
      liveRowsIn: this.liveRowsIn,
      liveRowsPerSec: this.liveWindow.reduce((a, s) => a + s.n, 0),
      droppedRowCount: this.droppedRowCount,
      subscribers: this.subscribers.size,
      stopped: this.stopped,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  addSubscriber(port: MessagePort): void {
    this.subscribers.set(port, Date.now());
  }

  touch(port: MessagePort): void {
    if (this.subscribers.has(port)) this.subscribers.set(port, Date.now());
  }

  /** @returns true when nobody is left holding this feed open. */
  removeSubscriber(port: MessagePort): boolean {
    this.subscribers.delete(port);
    return this.subscribers.size === 0;
  }

  /** @returns true when reaping left nobody holding this feed open. */
  reapSubscribers(now: number): boolean {
    const cutoff = now - SUBSCRIBER_IDLE_TIMEOUT_MS;
    for (const [port, seen] of [...this.subscribers]) {
      if (seen < cutoff) this.subscribers.delete(port);
    }
    return this.subscribers.size === 0;
  }

  eachSubscriber(fn: (port: MessagePort) => void): void {
    for (const port of this.subscribers.keys()) fn(port);
  }

  async start(): Promise<void> {
    if (this.destroyed || this.stopped) return;
    if (this.stomp) return;                      // already feeding — a join
    this.startedAt ??= Date.now();
    this.setPhase('connecting');
    try {
      await this.ensureTable();
    } catch (err) {
      this.fail(err);
      return;
    }
    if (this.destroyed || this.stopped) return;
    this.activateStomp();
  }

  stop(): void {
    this.stopped = true;
    this.teardownStomp();
    this.setPhase('disconnected');
  }

  restart(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.snapshotComplete = false;
    this.snapshotRowsLoaded = 0;
    this.liveBatches = 0;
    this.liveRowsIn = 0;
    this.liveWindow = [];
    this.buffer = [];
    void this.start();
  }

  destroy(): void {
    this.destroyed = true;
    this.teardownStomp();
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.flushTimer = null;
    this.pushTimer = null;
    this.settleTimer = null;
    this.table = null;
    this.subscribers.clear();
  }

  private async ensureTable(): Promise<Table> {
    if (this.table) return this.table;
    const client = await hostClient(this.bridge, this.config.clientWasmUrl);
    const { tableName, schema, index } = this.config;
    // Open-or-create, same contract as the page's `openOrCreatePositionsTable`:
    // a page may well have created the table already while asking for a feed.
    try {
      const names = await client.get_hosted_table_names();
      if (names.includes(tableName)) {
        this.table = await client.open_table(tableName);
        return this.table;
      }
    } catch { /* older engine without listing — fall through to create */ }
    this.table = await client.table(
      { ...schema } as Parameters<Client['table']>[0],
      { index, name: tableName },
    );
    return this.table;
  }

  private activateStomp(): void {
    if (this.destroyed || this.stopped || this.stomp) return;
    this.snapshotComplete = false;
    this.snapshotRowsLoaded = 0;
    this.liveBatches = 0;
    this.liveRowsIn = 0;
    this.liveWindow = [];
    this.buffer = [];

    const client = new StompClient({
      brokerURL: this.config.wsUrl,
      reconnectDelay: 2000,
      heartbeatIncoming: 0,
      heartbeatOutgoing: 0,
      onConnect: () => {
        if (this.destroyed || this.stopped) {
          try { void client.deactivate(); } catch { /* swallow */ }
          return;
        }
        this.onConnected();
      },
      onStompError: (frame) => this.fail(frame.headers.message ?? 'STOMP error'),
      onWebSocketError: () => this.fail('WebSocket error'),
      onWebSocketClose: () => {
        if (this.destroyed || this.stopped) return;
        this.setPhase('disconnected');
      },
    });
    this.stomp = client;
    client.activate();
    this.push();
  }

  private teardownStomp(): void {
    const c = this.stomp;
    this.stomp = null;
    if (c) {
      try { void c.deactivate(); } catch { /* swallow */ }
    }
  }

  private onConnected(): void {
    if (!this.stomp) return;
    // Fires on RECONNECT as well as first connect, and either way what
    // follows is a fresh snapshot request — so the snapshot latch has to be
    // cleared here rather than where the client is constructed. Leaving it
    // set makes `onMessage` ignore the end token (`if (this.snapshotComplete)
    // return`), and the feed then sits in `snapshot` forever while rows flow
    // perfectly well underneath it.
    //
    // `snapshotRowsLoaded` deliberately keeps its value: the table still
    // holds the previous rows, the re-snapshot upserts over them, and zeroing
    // it would blank every subscriber's row count mid-reconnect.
    this.snapshotComplete = false;
    this.setPhase('snapshot');
    const cfg = this.config;
    const topic = cfg.snapshotTopic ?? `/snapshot/positions/${cfg.clientId}`;
    const trigger = cfg.triggerTopic ?? `${topic}/${cfg.rate}/${cfg.batchSize}`;
    this.stomp.subscribe(topic, (msg: IMessage) => void this.onMessage(msg));
    const headers: Record<string, string> = {
      'snapshot-rows': String(cfg.snapshotRows),
      'updates-per-tick': String(cfg.updatesPerTick),
    };
    if (cfg.sparse) headers['live-mode'] = 'sparse';
    this.stomp.publish({ destination: trigger, body: trigger, headers });
  }

  private async onMessage(msg: IMessage): Promise<void> {
    const body = msg.body?.trim() ?? '';
    if (!body) return;

    // Exact match: a data row that happens to contain the token in a text
    // field must not end the snapshot early. The `{token}: …` prefixed
    // variant some brokers send is accepted too.
    const endToken = this.config.snapshotEndToken;
    if (body === endToken || body.startsWith(`${endToken}:`)) {
      if (this.snapshotComplete) return;
      await this.flush(true);
      this.snapshotComplete = true;
      await this.readBookSize();
      this.snapshotRowsLoaded = this.bookSize;
      this.setPhase('live');
      return;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return; }
    const deltas = extractRows(parsed);
    if (deltas.length === 0) return;

    // Identity comes from the configured keyColumn, single or composite, and
    // is written onto the physical index column so indexed upserts land as
    // last-write-wins.
    const { keyColumn, index } = this.config;
    const rows: Array<Record<string, unknown>> = [];
    for (const delta of deltas) {
      const id = rowIdentity(delta, keyColumn);
      if (id == null) {
        this.droppedRowCount++;
        continue;
      }
      rows.push({ ...delta, [index]: id });
    }
    if (rows.length === 0) return;

    const isSnapshot = !this.snapshotComplete || msg.headers['message-type'] === 'snapshot';
    if (!isSnapshot) {
      this.liveRowsIn += rows.length;
      this.liveWindow.push({ t: Date.now(), n: rows.length });
    }
    this.enqueue(rows);
    if (this.buffer.length >= this.config.batchSize) {
      // Snapshot awaits the drain so chunks reach WASM in order; live never
      // does — overlapping awaits from the socket callback let the buffer
      // grow without bound while a flush is stuck.
      if (isSnapshot) await this.flush();
      else void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** Append and hard-cap the pending write queue (LWW per keyColumn). */
  private enqueue(rows: Array<Record<string, unknown>>): void {
    if (rows.length === 0) return;
    this.buffer.push(...rows);
    const cap = updateBufferCap({
      snapshotComplete: this.snapshotComplete,
      batchSize: this.config.batchSize,
      snapshotRows: this.config.snapshotRows,
    });
    if (this.buffer.length <= cap) return;
    const before = this.buffer.length;
    this.buffer = boundUpdateBuffer(this.buffer, cap, this.config.keyColumn);
    this.droppedRowCount += before - this.buffer.length;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 32);
  }

  private async flush(force = false): Promise<void> {
    if (this.flushInFlight) {
      if (!force) return;
      // A forced drain (snapshot end) has to see its rows actually applied,
      // so wait out the in-flight round rather than returning early.
      while (this.flushInFlight) await new Promise((r) => setTimeout(r, 8));
    }
    this.flushInFlight = true;
    try {
      for (;;) {
        // Captured ONCE: everything below awaits and `destroy()` nulls it.
        const table = this.table;
        if (!table || this.destroyed || this.buffer.length === 0) break;
        const batch = this.buffer.splice(0);
        try {
          await table.update(batch as Parameters<Table['update']>[0]);
        } catch (err) {
          if (this.destroyed) break;
          this.fail(err);
          break;
        }
        if (this.destroyed) break;
        if (this.snapshotComplete) this.liveBatches++;
        else {
          await this.readBookSize();
          this.snapshotRowsLoaded = this.bookSize;
        }
        this.push();
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  private async readBookSize(): Promise<void> {
    try {
      this.bookSize = Number(await this.table?.size() ?? 0);
    } catch { /* table gone — leave the last known size */ }
  }

  private setPhase(phase: WorkerFeedPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    if (phase !== 'error') this.lastError = null;
    this.push(true);
  }

  private fail(err: unknown): void {
    this.lastError = err instanceof Error ? err.message : String(err);
    this.phase = 'error';
    this.push(true);
  }

  /** Throttled unless `now` — continuous counters must not flood every tab
   *  with a postMessage per batch, but a phase change is what a caller
   *  waiting to render is actually blocked on. */
  private push(now = false): void {
    if (now) {
      if (this.pushTimer !== null) {
        clearTimeout(this.pushTimer);
        this.pushTimer = null;
      }
      this.emit();
      return;
    }
    if (this.pushTimer !== null) return;
    const due = this.lastPushAt + STATE_PUSH_THROTTLE_MS - Date.now();
    if (due <= 0) {
      this.emit();
      return;
    }
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.emit();
    }, due);
  }

  /**
   * Send state, and arm a trailing send if the rate was non-zero.
   *
   * `liveRowsPerSec` is a one-second WINDOW, so it only falls to zero when
   * someone recomputes it — and pushes are driven by rows arriving. Without
   * the trailing send, the last push before a feed goes quiet reports
   * whatever rate it had at that instant, and every subscribed tab keeps
   * displaying that number forever. A feed stopped from Diagnostics sat there
   * claiming 40 rows/s; so would one whose broker had dropped.
   *
   * Costs at most one extra message per quiet period: any real push
   * reschedules it, so a running feed never pays for it.
   */
  private emit(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    const state = this.state();
    this.lastPushAt = Date.now();
    this.onState(state);
    if (state.liveRowsPerSec > 0 && !this.destroyed) {
      // Just past the window, so the recomputed rate is genuinely zero
      // rather than a partial tail.
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        this.emit();
      }, 1_100);
    }
  }
}

/** How often idle control ports are swept. */
const SUBSCRIBER_REAP_INTERVAL_MS = 60_000;

/**
 * Every feed this worker is running, keyed by physical table name.
 *
 * The key is the whole of the election replacement: `feed:start` for a table
 * already being fed is a JOIN that returns the running feed's state. Two apps,
 * ten tabs, one broker connection — with no lock, no takeover and no window
 * during which nobody is feeding.
 */
export class WorkerFeedRegistry {
  private readonly feeds = new Map<string, WorkerFeed>();

  constructor(private readonly bridge: FeedEngineBridge) {
    const reap = setInterval(() => {
      const now = Date.now();
      for (const [name, feed] of [...this.feeds]) {
        // A control port whose page crashed cannot send `feed:release`. Left
        // alone, its feed would hold a broker connection open for the life of
        // the worker — which, being per-origin, is a long time.
        if (feed.reapSubscribers(now)) this.dropFeed(name);
      }
    }, SUBSCRIBER_REAP_INTERVAL_MS);
    (reap as unknown as { unref?: () => void }).unref?.();
  }

  /** Start or join. The caller's port becomes a subscriber either way. */
  async start(port: MessagePort, config: WorkerFeedConfig): Promise<WorkerFeedState> {
    let feed = this.feeds.get(config.tableName);
    if (!feed) {
      feed = new WorkerFeed(this.bridge, config, (state) => {
        feed!.eachSubscriber((p) => {
          try { p.postMessage({ feed: 'state', state }); } catch { /* port gone */ }
        });
      });
      this.feeds.set(config.tableName, feed);
    }
    feed.addSubscriber(port);
    await feed.start();
    return feed.state();
  }

  stop(tableName: string): WorkerFeedState | null {
    const feed = this.feeds.get(tableName);
    if (!feed) return null;
    feed.stop();
    return feed.state();
  }

  restart(tableName: string): WorkerFeedState | null {
    const feed = this.feeds.get(tableName);
    if (!feed) return null;
    feed.restart();
    return feed.state();
  }

  state(tableName: string): WorkerFeedState | null {
    return this.feeds.get(tableName)?.state() ?? null;
  }

  touch(port: MessagePort): void {
    for (const feed of this.feeds.values()) feed.touch(port);
  }

  /** One port stops holding a feed open; the last one out shuts it down. */
  release(port: MessagePort, tableName?: string): void {
    for (const [name, feed] of [...this.feeds]) {
      if (tableName !== undefined && name !== tableName) continue;
      if (feed.removeSubscriber(port)) this.dropFeed(name);
    }
  }

  /** Feeds currently running, for diagnostics. */
  summary(): WorkerFeedState[] {
    return [...this.feeds.values()].map((f) => f.state());
  }

  private dropFeed(name: string): void {
    const feed = this.feeds.get(name);
    if (!feed) return;
    this.feeds.delete(name);
    feed.destroy();
  }
}
