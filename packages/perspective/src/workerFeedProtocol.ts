/**
 * Wire types for the in-worker SSRM feed.
 *
 * Today the SSRM engine is shared but its *transport* is not: rows arrive on
 * one elected tab's main thread and are pushed across into the shared table.
 * That costs a leader-election layer, a takeover gap when the leading tab
 * closes, a `BroadcastChannel` whose only job is reaching whichever tab is
 * leading, and a feed whose freshness depends on the health of a tab nobody
 * may be looking at. See `docs/ssrm-shared-engine-architecture.md` §4.
 *
 * These messages move the transport into the SharedWorker that already hosts
 * the engine, which removes all four at once — there is one feed because
 * there is one worker, so there is nothing to elect.
 *
 * Carried on a DEDICATED control port, not the Perspective client's port.
 * That port speaks a protobuf protocol and its message handler forwards
 * everything it receives into the WASM client; anything else on it is at best
 * tolerated. `readSharedEngineStats` already opens its own port for the same
 * reason. A control port never sends `{ cmd: 'init' }`, so it creates no
 * engine session and does not skew `SharedEngineStats.sessions`.
 */

/**
 * The FIRST engine protocol that understands `feed:*`.
 *
 * Deliberately not "the current version": this is a floor, and it must stay
 * at 2 even as `SHARED_ENGINE_PROTOCOL` moves on. A page compares the
 * deployed worker's version against it to decide whether delegating its feed
 * is possible at all — unknown commands have always been ignored silently, so
 * asking an older worker for a feed would strand a blotter waiting for a
 * snapshot nobody is going to send.
 */
export const WORKER_FEED_PROTOCOL = 2;

/**
 * Everything the worker needs to run a feed, resolved by the page.
 *
 * AppData `{{token}}` substitution happens on the page (`resolveProviderConfig`),
 * so what crosses here is always fully resolved — the worker never interprets
 * a token and never needs the app's session state.
 */
export interface WorkerFeedConfig {
  /** Physical Perspective table, from `tableNameForSchema(schema, identity)`. */
  tableName: string;
  schema: Record<string, string>;
  /** Perspective `table({ index })` column — `resolveTableIndexField(keyColumn)`. */
  index: string;
  keyColumn: string | string[];
  wsUrl: string;
  clientId: string;
  snapshotTopic?: string;
  triggerTopic?: string;
  snapshotEndToken: string;
  snapshotRows: number;
  rate: number;
  batchSize: number;
  updatesPerTick: number;
  sparse?: boolean;
  /**
   * Absolute URL of `perspective-js.wasm`, so the worker can build its own
   * `Client` against the engine it already hosts.
   *
   * The page sends a URL rather than the compiled module even though
   * `getCompiledClientWasm()` exists and its documentation offers exactly
   * that: `init_client` in this build dispatches on argument TYPE and has no
   * `WebAssembly.Module` branch — a Module lands in the "already-initialised
   * namespace" case and the client comes out undefined. A URL takes the
   * `Response` path, which works. The extra fetch is served from the HTTP
   * cache the page just filled, and happens once per ORIGIN rather than once
   * per tab.
   */
  clientWasmUrl: string;
}

/**
 * The config reduced to what actually decides WHAT DATA a feed carries.
 *
 * Used to answer "did the app that just joined ask for the same thing as the
 * app already being fed?" — see {@link workerFeedConfigMismatch}. Compared on
 * EFFECTIVE values, because the defaults are where the disagreements hide: a
 * page that sets no `snapshotTopic` derives one from its `clientId`, which is
 * random per page, so comparing the raw fields would report a mismatch on
 * every join while comparing the resolved topics reports one only when the
 * two are genuinely listening to different places.
 *
 * `clientWasmUrl` is deliberately absent. It is each app's own hashed asset
 * path and legitimately differs between apps that should share a feed; it
 * says nothing about the data.
 */
function feedConfigFingerprint(c: WorkerFeedConfig): Record<string, string> {
  const topic = c.snapshotTopic ?? `/snapshot/positions/${c.clientId}`;
  const trigger = c.triggerTopic ?? `${topic}/${c.rate}/${c.batchSize}`;
  return {
    wsUrl: c.wsUrl,
    snapshotTopic: topic,
    triggerTopic: trigger,
    snapshotEndToken: c.snapshotEndToken,
    keyColumn: JSON.stringify(c.keyColumn),
    index: c.index,
    schema: JSON.stringify(Object.entries(c.schema).sort()),
    snapshotRows: String(c.snapshotRows),
    rate: String(c.rate),
    batchSize: String(c.batchSize),
    updatesPerTick: String(c.updatesPerTick),
    sparse: String(c.sparse ?? false),
  };
}

/**
 * Fields on which a joiner disagrees with the feed already running.
 *
 * This is the sharp edge of keying a feed on table name. Table identity folds
 * in `providerId` but NOT the resolved config, so two apps that resolve one
 * `providerId` to different topics — an AppData `{{token}}` standing for a
 * different desk, say — land on the same physical table and therefore the
 * same feed. One of them then renders data it did not ask for.
 *
 * Joining is still the right behaviour: two feeds writing one table would be
 * strictly worse than one feed serving both. But it must not be SILENT, which
 * is what it was. The real fix is table identity that folds in the resolved
 * config, and that is a decision with its own blast radius — a changed table
 * name splits books that are meant to be shared — so this reports rather than
 * resolves.
 */
export function workerFeedConfigMismatch(
  running: WorkerFeedConfig,
  joining: WorkerFeedConfig,
): string[] {
  const a = feedConfigFingerprint(running);
  const b = feedConfigFingerprint(joining);
  return Object.keys(a).filter((k) => a[k] !== b[k]);
}

export type WorkerFeedPhase =
  | 'idle'
  | 'connecting'
  | 'snapshot'
  | 'live'
  | 'error'
  | 'disconnected';

/** The worker's view of one feed. Pushed to every subscribed port on change. */
export interface WorkerFeedState {
  tableName: string;
  phase: WorkerFeedPhase;
  snapshotRowsLoaded: number;
  snapshotComplete: boolean;
  /** Unfiltered row count of the physical table. */
  bookSize: number;
  liveBatches: number;
  liveRowsIn: number;
  liveRowsPerSec: number;
  /** Rows that never reached the table: unresolvable identity at ingest, plus
   *  over-cap evictions from the update buffer. */
  droppedRowCount: number;
  /** Control ports currently holding this feed open. */
  subscribers: number;
  /** Stopped by an explicit `feed:stop` (Diagnostics), not by an error. */
  stopped: boolean;
  lastError: string | null;
  startedAt: number | null;
  /**
   * Fields on which some joiner asked for something different from what this
   * feed is actually carrying — see {@link workerFeedConfigMismatch}. `null`
   * while everyone agrees.
   *
   * Accumulated rather than per-joiner, and reported to EVERY subscriber on
   * purpose: the app that started the feed is the one whose data another app
   * is now reading, and it has as much reason to know as the joiner does.
   */
  configMismatch: string[] | null;
}

export type WorkerFeedRequest =
  /** Start, or JOIN if this table is already being fed. Idempotent by
   *  `tableName`: the second caller gets the running feed's state, not a
   *  second broker connection. This is what replaces the election. */
  | { cmd: 'feed:start'; id: number; config: WorkerFeedConfig }
  /** Diagnostics Stop — for every tab at once, because there is one feed. */
  | { cmd: 'feed:stop'; id: number; tableName: string }
  | { cmd: 'feed:restart'; id: number; tableName: string }
  /** This port no longer needs the feed (sent on `pagehide`). */
  | { cmd: 'feed:release'; tableName: string }
  | { cmd: 'feed:state'; id: number; tableName: string }
  /** Liveness for the subscriber reaper — a blotter can be legitimately
   *  silent for minutes. */
  | { cmd: 'feed:ping' };

export type WorkerFeedReply =
  | { id: number; ok: true; state: WorkerFeedState }
  | { id: number; ok: false; error: string }
  | { id: number; state: WorkerFeedState | null }
  /** Unsolicited push on change. */
  | { feed: 'state'; state: WorkerFeedState };

/** Narrow a control-port message, which also carries protobuf ArrayBuffers. */
export function isWorkerFeedPush(
  data: unknown,
): data is { feed: 'state'; state: WorkerFeedState } {
  return typeof data === 'object' && data !== null
    && (data as { feed?: unknown }).feed === 'state';
}
