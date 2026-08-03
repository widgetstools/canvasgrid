/**
 * In-memory mock trading server for the CGridExt + SSRM demo.
 *
 * Implements the sparse SSRM v2 contract (`IServerSideDatasourceV2`):
 * the KERNEL owns the group tree + flatten index; this "server" answers
 * the two expansion-free queries (`getGroupSkeleton`, `getLeafRows`),
 * the flat window (`getRows`), and the optional selection-cascade query
 * (`getGroupLeafIds`) — all over a deterministic 50k-position book with
 * simulated network latency and live price ticks.
 *
 * No real server, no WASM: everything the wire contract needs is
 * computed here, so the demo exercises the exact same kernel paths as
 * apps/cgrid-ssrm-demo's Perspective book without its dependencies.
 */

import type {
  IServerSideDatasourceV2,
  ServerSideTransaction,
  SkeletonGroup,
  SortModel,
  FilterModel,
} from '@cgrid/kernel';

export interface PositionRow {
  positionId: string;
  desk: string;
  region: string;
  currency: string;
  trader: string;
  ticker: string;
  notional: number;
  marketValue: number;
  price: number;
  pnl: number;
  dailyPnl: number;
  [key: string]: unknown;
}

const DESKS = ['Rates', 'Credit', 'FX', 'Equities', 'Commodities', 'Munis'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD'];
const TRADERS = ['patel', 'okafor', 'lindqvist', 'tanaka', 'reyes', 'novak', 'silva', 'chen'];

/** Fields the demo aggregates (sum) at every group level. */
const AGG_FIELDS = ['notional', 'marketValue', 'pnl', 'dailyPnl'] as const;

/** Deterministic PRNG (public-domain mulberry32) — the same book on every boot. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBook(rowCount: number): PositionRow[] {
  const rng = mulberry32(20260725);
  const rows: PositionRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const notional = Math.round(rng() * 9_000_000 + 1_000_000);
    const price = 90 + rng() * 20;
    rows.push({
      positionId: `POS-${String(i).padStart(6, '0')}`,
      desk: DESKS[Math.floor(rng() * DESKS.length)]!,
      region: REGIONS[Math.floor(rng() * REGIONS.length)]!,
      currency: CURRENCIES[Math.floor(rng() * CURRENCIES.length)]!,
      trader: TRADERS[Math.floor(rng() * TRADERS.length)]!,
      ticker: `TICK${i % 250}`,
      notional,
      marketValue: Math.round(notional * (price / 100)),
      price,
      pnl: Math.round((rng() - 0.5) * 400_000),
      dailyPnl: Math.round((rng() - 0.5) * 60_000),
    });
  }
  return rows;
}

// ─── filter / sort helpers ─────────────────────────────────────────────────

/** Tolerant filter matcher — handles the kernel's common legacy + v2 entry
 *  shapes; anything unrecognized imposes no constraint (demo never breaks
 *  on a new filter type, it just stops narrowing). */
function entryMatches(entry: unknown, value: unknown): boolean {
  if (entry == null || typeof entry !== 'object') return true;
  const e = entry as Record<string, unknown>;
  const asText = String(value ?? '').toLowerCase();
  const asNum = typeof value === 'number' ? value : Number(value);

  if (e.filterType === 'text') {
    const q = String(e.filter ?? '').toLowerCase();
    switch (e.type) {
      case 'equals': return asText === q;
      case 'notEqual': return asText !== q;
      case 'startsWith': return asText.startsWith(q);
      case 'endsWith': return asText.endsWith(q);
      case 'notContains': return !asText.includes(q);
      case 'contains': default: return asText.includes(q);
    }
  }
  if (e.filterType === 'number') {
    const q = Number(e.filter);
    switch (e.type) {
      case 'equals': return asNum === q;
      case 'notEqual': return asNum !== q;
      case 'lessThan': return asNum < q;
      case 'lessThanOrEqual': return asNum <= q;
      case 'greaterThanOrEqual': return asNum >= q;
      case 'inRange': return asNum >= q && asNum <= Number(e.filterTo ?? q);
      case 'greaterThan': default: return asNum > q;
    }
  }
  if (e.filterType === 'set' && Array.isArray(e.values)) {
    return (e.values as unknown[]).map((v) => String(v)).includes(String(value ?? ''));
  }
  // Legacy entry shapes ({ type: 'text' | 'number', op, value, value2 }).
  if (e.type === 'text') {
    const q = String(e.value ?? '').toLowerCase();
    switch (e.op) {
      case 'equals': return asText === q;
      case 'startsWith': return asText.startsWith(q);
      case 'contains': default: return asText.includes(q);
    }
  }
  if (e.type === 'number') {
    const q = Number(e.value);
    switch (e.op) {
      case 'eq': return asNum === q;
      case 'gt': return asNum > q;
      case 'lt': return asNum < q;
      case 'between': return asNum >= q && asNum <= Number(e.value2 ?? q);
      default: return true;
    }
  }
  return true;
}

function applyFilter(rows: readonly PositionRow[], filterModel: FilterModel): PositionRow[] {
  const entries = Object.entries(filterModel ?? {}).filter(([, e]) => e != null);
  if (entries.length === 0) return rows.slice();
  return rows.filter((row) => entries.every(([colId, entry]) => entryMatches(entry, row[colId])));
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function applySort(rows: PositionRow[], sortModel: SortModel): PositionRow[] {
  if (!sortModel?.length) return rows;
  return rows.sort((a, b) => {
    for (const s of sortModel) {
      const c = compareValues(a[s.colId], b[s.colId]);
      if (c !== 0) return s.direction === 'desc' ? -c : c;
    }
    return 0;
  });
}

function sumAggregates(rows: readonly PositionRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of AGG_FIELDS) out[f] = 0;
  for (const row of rows) {
    for (const f of AGG_FIELDS) out[f] = (out[f] ?? 0) + (row[f] as number);
  }
  return out;
}

// ─── the mock server ───────────────────────────────────────────────────────

export interface MockServerOptions {
  rowCount?: number;
  /** Simulated per-request latency window in ms. */
  latency?: [min: number, max: number];
}

export class MockTradingServer {
  private readonly rows: PositionRow[];
  private readonly byId = new Map<string, PositionRow>();
  private readonly latency: [number, number];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private readonly tickRng = mulberry32(7);
  /** Requests served — the demo surfaces this in the title bar. */
  requestCount = 0;

  constructor(opts: MockServerOptions = {}) {
    this.rows = buildBook(opts.rowCount ?? 50_000);
    for (const row of this.rows) this.byId.set(row.positionId, row);
    this.latency = opts.latency ?? [25, 90];
  }

  get bookSize(): number { return this.rows.length; }

  /** Simulated wire hop — every datasource reply goes through this. */
  private respond(fn: () => void): void {
    this.requestCount++;
    const [min, max] = this.latency;
    setTimeout(fn, min + Math.random() * (max - min));
  }

  private groupSubset(groupPath: readonly string[], rowGroupCols: readonly string[], filterModel: FilterModel): PositionRow[] {
    let subset = applyFilter(this.rows, filterModel);
    for (let i = 0; i < groupPath.length && i < rowGroupCols.length; i++) {
      const col = rowGroupCols[i]!;
      const val = groupPath[i]!;
      subset = subset.filter((row) => String(row[col] ?? '') === val);
    }
    return subset;
  }

  /** All group rows at every depth (+ the `path: []` grand-total root),
   *  sibling order = display order (the kernel preserves it). */
  private buildSkeleton(rowGroupCols: readonly string[], sortModel: SortModel, filterModel: FilterModel): SkeletonGroup[] {
    const filtered = applyFilter(this.rows, filterModel);
    const groups: SkeletonGroup[] = [
      { path: [], leafCount: filtered.length, aggregates: sumAggregates(filtered) },
    ];
    const walk = (subset: readonly PositionRow[], path: string[], depth: number): void => {
      if (depth >= rowGroupCols.length) return;
      const col = rowGroupCols[depth]!;
      const buckets = new Map<string, PositionRow[]>();
      for (const row of subset) {
        const key = String(row[col] ?? '');
        const bucket = buckets.get(key);
        if (bucket) bucket.push(row);
        else buckets.set(key, [row]);
      }
      // Sibling order: a sortModel entry on the group column orders by key;
      // one on an aggregated field orders by the aggregate; default key-asc.
      const entries = [...buckets.entries()].map(([key, rows]) => ({
        key, rows, aggregates: sumAggregates(rows),
      }));
      const groupSort = sortModel?.find((s) => s.colId === col);
      const aggSort = sortModel?.find((s) => (AGG_FIELDS as readonly string[]).includes(s.colId));
      entries.sort((a, b) => {
        if (groupSort) {
          const c = compareValues(a.key, b.key);
          return groupSort.direction === 'desc' ? -c : c;
        }
        if (aggSort) {
          const c = (a.aggregates[aggSort.colId] ?? 0) - (b.aggregates[aggSort.colId] ?? 0);
          return aggSort.direction === 'desc' ? -c : c;
        }
        return compareValues(a.key, b.key);
      });
      for (const entry of entries) {
        const childPath = [...path, entry.key];
        groups.push({ path: childPath, leafCount: entry.rows.length, aggregates: entry.aggregates });
        walk(entry.rows, childPath, depth + 1);
      }
    };
    walk(filtered, [], 0);
    return groups;
  }

  /** The `IServerSideDatasourceV2` the grid consumes. */
  datasource(): IServerSideDatasourceV2<PositionRow> {
    return {
      getRows: ({ request, success }) => {
        this.respond(() => {
          const filtered = applyFilter(this.rows, request.filterModel);
          const sorted = applySort(filtered, request.sortModel);
          success({
            rowData: sorted.slice(request.startRow, request.endRow).map((r) => ({ ...r })),
            rowCount: sorted.length,
            grandTotals: sumAggregates(filtered),
          });
        });
      },
      getGroupSkeleton: ({ request, success }) => {
        this.respond(() => {
          success({
            groups: this.buildSkeleton(request.rowGroupCols, request.sortModel, request.filterModel),
          });
        });
      },
      getLeafRows: ({ request, success }) => {
        this.respond(() => {
          const subset = this.groupSubset(request.groupPath, request.rowGroupCols, request.filterModel);
          const sorted = applySort(subset, request.sortModel);
          success({
            rowData: sorted.slice(request.startRow, request.endRow).map((r) => ({ ...r })),
          });
        });
      },
      getGroupLeafIds: ({ request, success }) => {
        this.respond(() => {
          const subset = this.groupSubset(request.groupPath, request.rowGroupCols, request.filterModel);
          success({ ids: applySort(subset, request.sortModel).map((r) => r.positionId) });
        });
      },
    };
  }

  /** Persist a committed cell edit into the authoritative book, so later
   *  block re-hydrates don't revert it. Returns the updated row copy, or
   *  null for unknown / synthetic ids (group rows are not editable). */
  applyEdit(positionId: string, field: string, value: unknown): PositionRow | null {
    const row = this.byId.get(positionId);
    if (!row) return null;
    row[field] = value;
    // Keep derived fields coherent when their inputs change.
    if (field === 'price' || field === 'notional') {
      row.marketValue = Math.round(row.notional * (row.price / 100));
    }
    return { ...row };
  }

  /** Live ticks — mutate a slice of the book and emit an SSRM update
   *  transaction (copies, never the server's own row objects). */
  startTicking(onTransaction: (tx: ServerSideTransaction<PositionRow>) => void, intervalMs = 150, rowsPerTick = 250): void {
    this.stopTicking();
    this.tickTimer = setInterval(() => {
      const update: PositionRow[] = [];
      for (let i = 0; i < rowsPerTick; i++) {
        const row = this.rows[Math.floor(this.tickRng() * this.rows.length)]!;
        const drift = (this.tickRng() - 0.5) * 0.6;
        row.price = Math.max(1, row.price + drift);
        row.marketValue = Math.round(row.notional * (row.price / 100));
        const pnlDelta = Math.round(drift * 10_000);
        row.pnl += pnlDelta;
        row.dailyPnl += pnlDelta;
        update.push({ ...row });
      }
      onTransaction({ update });
    }, intervalMs);
  }

  stopTicking(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
