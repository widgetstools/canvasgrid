/**
 * The lab's data plane, client-side row model.
 *
 * Two sources, one interface:
 *
 *   local (default) — rows are generated and ticked in this tab. No broker, no
 *     SharedWorker; `npm run dev` just works. This is the honest way to show
 *     what CSRM *is*: the tab holds the whole book and the grid's own worker
 *     does the filtering, sorting and grouping over it.
 *
 *   ?feed=stomp     — rows arrive through `DataServicesHub`, the CSRM data hub
 *     SharedWorker, which owns the socket and a RowCache once per origin and
 *     fans out to every tab. Needs `npm run dev:stomp`.
 *
 * Both deliver a snapshot then a stream of updates, because that is the shape
 * the grid cares about: `setRowData` once, `applyTransactionAsync` forever.
 */
import { makeRng, makeRows, tickRow, type BlotterRow } from './domain';

export type FeedKind = 'local' | 'stomp';

export interface StreamStatus {
  kind: FeedKind;
  phase: 'idle' | 'connecting' | 'snapshot' | 'live' | 'error';
  rowCount: number;
  /** Rows pushed since the snapshot — the "is it actually live?" number. */
  updatesApplied: number;
  updatesPerSec: number;
  error?: string;
}

export interface StreamSink {
  snapshot(rows: BlotterRow[]): void;
  update(rows: BlotterRow[]): void;
  status(s: StreamStatus): void;
}

export interface StreamOptions {
  rowCount?: number;
  tickMs?: number;
  /** Rows touched per tick. Real desks move a slice, not the whole book. */
  rowsPerTick?: number;
  seed?: number;
}

export interface StreamController {
  setPaused(paused: boolean): void;
  setTickMs(ms: number): void;
  /** Overlay a scenario's rows onto the live book (see scenarios.ts). */
  overlay(rows: BlotterRow[]): void;
  /** Current book, for scenarios that need to compute from it. */
  rows(): readonly BlotterRow[];
  stop(): void;
}

export function feedKindFromUrl(search = location.search): FeedKind {
  return new URLSearchParams(search).get('feed') === 'stomp' ? 'stomp' : 'local';
}

/**
 * Local generator. Ticks a random slice of the book on an interval and reports
 * a rolling update rate — the rate is recomputed on every emit rather than
 * derived once, because a rate that only updates when data arrives freezes at
 * its last value the moment the feed stops, which reads as "still live".
 */
export function startLocalStream(sink: StreamSink, opts: StreamOptions = {}): StreamController {
  const rowCount = opts.rowCount ?? 2_000;
  const rowsPerTick = opts.rowsPerTick ?? Math.max(8, Math.round(rowCount * 0.02));
  const rng = makeRng((opts.seed ?? 20260906) ^ 0x5eed);

  let rows = makeRows(rowCount, opts.seed);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let tickMs = opts.tickMs ?? 500;
  let paused = false;
  let applied = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let windowStart = performance.now();
  let windowCount = 0;
  let rate = 0;

  const report = (phase: StreamStatus['phase']) =>
    sink.status({ kind: 'local', phase, rowCount: rows.length, updatesApplied: applied, updatesPerSec: rate });

  const tick = () => {
    if (paused) return;
    const touched: BlotterRow[] = [];
    for (let i = 0; i < rowsPerTick; i++) {
      const idx = Math.floor(rng() * rows.length);
      const next = tickRow(rows[idx]!, rng);
      rows[idx] = next;
      byId.set(next.id, next);
      touched.push(next);
    }
    applied += touched.length;
    windowCount += touched.length;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      rate = Math.round((windowCount * 1000) / (now - windowStart));
      windowStart = now;
      windowCount = 0;
    }
    sink.update(touched);
    report('live');
  };

  const schedule = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, tickMs);
  };

  sink.snapshot(rows);
  report('live');
  schedule();

  return {
    setPaused(v) {
      paused = v;
      if (v) { rate = 0; windowCount = 0; }
      windowStart = performance.now();
      report(v ? 'idle' : 'live');
    },
    setTickMs(ms) { tickMs = ms; schedule(); },
    overlay(next) {
      for (const row of next) { byId.set(row.id, row); }
      rows = rows.map((r) => byId.get(r.id) ?? r);
      sink.update(next);
      report(paused ? 'idle' : 'live');
    },
    rows: () => rows,
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
