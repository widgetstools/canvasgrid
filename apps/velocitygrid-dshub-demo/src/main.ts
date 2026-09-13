/**
 * VelocityGrid driven by the Rust hub as its SSRM engine.
 *
 * The chain is: wasm engine -> SsrmWasmPlane -> DshubSsrmEngine -> a v2
 * server-side datasource -> the grid. Nothing here reaches into the engine
 * directly; the demo only feeds rows in and lets the engine push changes out.
 *
 * Self-contained — no STOMP fixture, no SharedWorker. `npm run dev` and it
 * runs, which is the point: this is the shortest honest demonstration that
 * the integration works.
 *
 * What it is meant to show, in order of how much it matters:
 *
 *   1. MULTI-LEVEL GROUPING. Measured at 4-6ms against Perspective's
 *      112-137ms (docs/dshub-vs-perspective-benchmark.md). Add a second and
 *      third grouping level and the grid stays immediate.
 *   2. WEIGHTED AVERAGES. `SUM(spread x dv01) / SUM(dv01)` as computed
 *      columns with agg nodes — DV01-weighted spread, which a closed set of
 *      aggregates cannot express at all.
 *
 *      Every agg node is folded over the rows of the scope it is read in, so
 *      each group row carries its own number rather than the book's, and a
 *      leaf agrees with the caption above it. Pinned at three layers: the
 *      engine (hub-rust/tests/groupdelta.rs), the plane
 *      (SsrmWasmPlane.wasm.integration.test.ts) and the datasource
 *      (packages/data/tests/dshub/serverSideDatasource.test.ts).
 *   3. LIVE TICKS that repaint without the grid asking, and a still book that
 *      does not repaint at all.
 */
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
// Excel format strings on a column def are COMPILED by an injected compiler —
// the kernel ships the slot, not the implementation. Without this wire the
// kernel calls the string as if it were a formatter function and every cell
// that has one paints empty (`valueFormatter is not a function`, silently,
// 862 times).
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import '@wellsfargo-starui/velocity-grid/style.css';
import { DshubSsrmEngine } from '@wellsfargo-starui/velocity-grid-data';
import { SsrmWasmPlane } from 'dshub-hub/plane/SsrmWasmPlane.js';
import initDshub, { RustHub } from 'dshub-hub/runtime/dshub.js';
import dshubWasmUrl from 'dshub-hub/runtime/dshub_bg.wasm?url';
import { makeBook, tickRows, COLUMN_DEFINITIONS, type Position } from './book';
import './styles.css';

const THEME = 'vg-theme-cursor-dark';
document.documentElement.classList.add(THEME);
document.body.classList.add(THEME);

/** colId -> aggregate. Drives BOTH the engine's group aggregates and the
 *  grid's value columns, so the two cannot disagree about what is summed. */
const VALUE_COLUMNS: Record<string, string> = {
  notional: 'sum', dv01: 'sum', pnl: 'sum', spread: 'avg',
};

/**
 * Excel format strings, per the house convention (see the SSRM lab's FORMATS).
 *
 * Not decoration. A summed notional is twelve digits — unformatted it both
 * overflows the column and is unreadable, and an aggregated spread arrives as
 * 213.12684000000013. Notional scales to millions with Excel's trailing-comma
 * divisor; P&L takes the blotter's parenthesised negative WITHOUT Excel's
 * literal `[Red]`, which would reintroduce the red this codebase replaced
 * with the teal / orange-red semantic pair.
 */
const FORMATS: Record<string, string> = {
  // No scale factor: this compiler tokenizes a trailing comma as a group
  // separator, never as Excel's /1000 divisor, so `#,##0,,"mm"` renders the
  // FULL number with "mm" glued on — a summed notional captioned as millions
  // while showing billions. Wide column, honest number.
  notional: '#,##0',
  spread: '#,##0.0" bp"',
  // A leaf DV01 is 243.6, so rounding to whole units loses the precision the
  // weighted average is actually computed at.
  dv01: '#,##0.0',
  // Parenthesised negatives, the blotter convention — deliberately NOT
  // Excel's `[Red]`, which would undo the teal / orange-red semantic pair.
  pnl: '#,##0;(#,##0)',
};

/** Columns wide enough for their FORMATTED width. A summed notional is
 *  fifteen characters; the default 140 clips it mid-number. */
const WIDTHS: Record<string, number> = {
  id: 170, tenor: 90, ticker: 110, rating: 100,
  notional: 180, spread: 130, dv01: 140, pnl: 150,
};

const BOOK_SIZE = 50_000;
const TICK_ROWS = 400;
const TICK_MS = 100;

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="bar">
    <strong>VelocityGrid</strong>
    <span class="tag">Rust hub · wasm SSRM engine</span>
    <span class="sep"></span>
    <label class="grp">Group
      <select id="grouping">
        <option value="">none</option>
        <option value="desk">desk</option>
        <option value="desk,region" selected>desk → region</option>
        <option value="desk,region,tenor">desk → region → tenor</option>
        <option value="rating,desk,region,tenor">rating → desk → region → tenor</option>
      </select>
    </label>
    <button id="feed" class="btn">Pause feed</button>
    <span class="sep"></span>
    <span class="stat">book <b id="s-rows">—</b></span>
    <span class="stat">groups <b id="s-groups">—</b></span>
    <span class="stat">skeleton <b id="s-skel">—</b></span>
    <span class="stat">repaints/s <b id="s-rp">0</b></span>
    <span class="stat" id="s-path-wrap" title="Polls the group watch served by patching only the rows that moved, rather than rescanning the book. A fall to the slow path is silent otherwise.">fast path <b id="s-path">—</b></span>
  </header>
  <div id="grid" class="grid"></div>
  <footer class="foot">
    <span><b>Wtd Spread</b> is <code>SUM(spread × dv01) / SUM(dv01)</code> — an
    aggregate composed with arithmetic, which a fixed set of aggregate functions
    cannot express. Compare it with <b>AVG Spread</b> beside it: the long end
    carries most of the risk, so the weighted number runs ~24bp wider, and the
    plain average understates every desk. Each group row carries <em>its own</em>
    fold — each desk's is that desk's, each region's is that region's, and none
    of them is the book's.</span>
  </footer>
`;

const $ = (id: string) => document.getElementById(id)!;

const book: Position[] = makeBook(BOOK_SIZE);

/** Built once, applied twice — see the `wireFormat` note below. */
const COLS = COLUMN_DEFINITIONS.map((c) => ({
  colId: c.field,
  field: c.field,
  headerName: c.headerName,
  ...(('cellDataType' in c) ? { cellDataType: c.cellDataType } : {}),
  // The aggregate belongs on the COLUMN DEF. Registering it afterwards with
  // `addValueColumn` puts the column in value state but leaves the paint
  // path with nothing to resolve on a group row, so the engine's aggregates
  // arrive, sit in the row, and render blank — captions showed only the
  // flash wash, no number.
  ...(VALUE_COLUMNS[c.field] ? { aggFunc: VALUE_COLUMNS[c.field] } : {}),
  ...(FORMATS[c.field] ? { valueFormatter: FORMATS[c.field], align: 'right' } : {}),
  enableRowGroup: true,
  enableValue: 'cellDataType' in c,
  width: WIDTHS[c.field] ?? 140,
})).concat([{
  colId: 'wSpread',
  field: 'wSpread',
  headerName: 'Wtd Spread',
  cellDataType: 'number',
  valueFormatter: '#,##0.00" bp"',
  align: 'right',
  // `aggFunc` is what licenses the paint path to render this on a GROUP row;
  // without it the engine's value arrives and the caption stays blank. The
  // kernel does not fold anything here — the value on a group row IS the
  // engine's per-node result — so the header keeps its own name rather than
  // announcing an aggregate the client never performed.
  aggFunc: 'avg',
  suppressAggFuncInHeader: true,
  width: 165,
}] as never) as never;

const grid = new VelocityGrid<Position>($('grid') as HTMLElement, {
  rowModelType: 'serverSide',
  getRowId: (r: Position) => r.id,
  columnDefs: COLS,
  enableCellChangeFlash: true,
  groupDefaultExpanded: 0,
  theme: THEME,
} as never);

/**
 * Load the engine EXPLICITLY rather than letting the plane's default loader
 * find it.
 *
 * That default does `new URL('./dshub_bg.wasm', import.meta.url)`, which is
 * right for rangrez's worker build — esbuild inlines the binary next to the
 * glue — and wrong under a bundler that rewrites module paths: the URL
 * resolves to something vite serves index.html for, and the instantiate
 * fails with `expected magic word ... found 3c 21 64 6f` (`<!do`).
 *
 * `?url` makes vite emit the binary as an asset and hand back its real URL.
 * The plane takes a `RustHubFactory` precisely so a host can do this.
 */
async function rustHub(): Promise<never> {
  await initDshub({ module_or_path: dshubWasmUrl });
  return RustHub.new() as never;
}

/**
 * DV01-weighted average spread, as the engine computes it.
 *
 * `SUM(spread x dv01) / SUM(dv01)` — an aggregate composed with arithmetic.
 * It takes two computed columns because an `agg` node names a COLUMN, so the
 * product has to exist as one before it can be summed; the second then
 * aggregates over the first. That an `agg` may reference another computed
 * column is the whole trick, and it is why a closed set of aggregate
 * functions (sum, avg, min, max, count, …) cannot express this at all.
 *
 * On a credit desk this is the number that actually matters: an unweighted
 * average spread over positions of wildly different risk is meaningless.
 */
const COMPUTED = [
  {
    as: 'wprod',
    version: 1,
    expr: { k: 'bin', op: 'mul', l: { k: 'col', name: 'spread' }, r: { k: 'col', name: 'dv01' } },
  },
  {
    as: 'wSpread',
    version: 1,
    expr: {
      k: 'bin', op: 'div',
      l: { k: 'agg', fn: 'sum', col: 'wprod' },
      r: { k: 'agg', fn: 'sum', col: 'dv01' },
    },
  },
];

const plane = new SsrmWasmPlane(rustHub);

const engine = new DshubSsrmEngine({
  plane: plane as never,
  computedColumns: COMPUTED,
  providerId: 'positions',
  config: { keyColumn: 'id', columnDefinitions: COLUMN_DEFINITIONS as never },
  // Group rows carry the sums the weighted average is built from, plus the
  // plain totals a desk reads directly.
  aggregates: VALUE_COLUMNS,
  tickMs: TICK_MS,
});

// A string `valueFormatter` is compiled to a function during COLUMN
// RESOLUTION, by a compiler the kernel only holds a DI slot for. Wiring the
// bridge after the constructor is too late: the columns have already resolved
// without a compiler, the string survives onto the resolved def, and the paint
// path then calls it — `valueFormatter is not a function`, thrown per frame
// and swallowed, so every formatted cell renders blank. Re-applying the same
// defs once the compiler exists resolves them again, this time compiling.
wireFormat(grid as never);
grid.updateGridOptions({ columnDefs: COLS } as never);

/** Repaints per second — the number that shows the pump is not spamming. */
let repaints = 0;
const realRefresh = grid.refreshServerSide.bind(grid);
grid.refreshServerSide = ((p?: { purge?: boolean }) => { repaints++; return realRefresh(p); }) as never;
setInterval(() => { $('s-rp').textContent = String(repaints); repaints = 0; }, 1000);

/**
 * How many polls the watch served by patching rather than rescanning.
 *
 * The incremental path is ~150x the full scan, and it falls back SILENTLY —
 * an uninvertible aggregate, or a touch log that stopped reaching back to the
 * last poll. Without a readout the only symptom is a blotter that feels slow,
 * which is not a symptom anyone can act on.
 */
interface EngineDiagnostics {
  sessions: Array<{
    groupWatches: Array<{
      stats: { polls: number; incremental: number; rebuilds: Record<string, number> };
      touchLog: { behind: number; cap: number };
    }>;
  }>;
}

setInterval(() => {
  const d = engine.diagnostics() as EngineDiagnostics | null;
  const watch = d?.sessions?.flatMap((x) => x.groupWatches ?? [])[0];
  if (!watch || watch.stats.polls === 0) { $('s-path').textContent = '—'; return; }
  const { polls, incremental, rebuilds } = watch.stats;
  // The first build is a rebuild by definition and always will be; counting it
  // against the ratio would make a healthy watch look like a degraded one.
  const eligible = polls - (rebuilds.first ?? 0);
  const pct = eligible > 0 ? Math.round((incremental / eligible) * 100) : 100;
  const stale = (rebuilds.logBehind ?? 0) + (rebuilds.unsupported ?? 0);
  // `behind` crossing `cap` IS the fallback, so it warns before the rebuild
  // counter moves — which is the difference between noticing and diagnosing.
  const { behind, cap } = watch.touchLog;
  const near = cap > 0 && behind > cap / 2;
  $('s-path').textContent = stale > 0
    ? `${pct}% · ${stale} rescans`
    : near ? `${pct}% · ${behind}/${cap} behind` : `${pct}%`;
  $('s-path').style.color = (pct >= 95 && !near) ? '' : '#FF7043';
}, 1000);

async function boot(): Promise<void> {
  await engine.start();
  await engine.ingest(book);
  engine.attach(grid as never);
  instrumentSkeleton();
  // `aggFunc` on the column def is what makes a GROUP row paint a number;
  // this puts the same columns into value state so the ext panel shows them
  // under Values and a user can drag them out again.
  for (const [colId, fn] of Object.entries(VALUE_COLUMNS)) grid.addValueColumn(colId, fn);
  $('s-rows').textContent = book.length.toLocaleString();
  applyGrouping((($('grouping') as HTMLSelectElement).value));
}

/**
 * Time the SKELETON CALL, not the round trip.
 *
 * Waiting a fixed delay and subtracting would report the delay — the first
 * version of this read 359ms for a 6ms build, which on a demo about grouping
 * speed is worse than showing nothing. So the datasource's own
 * `getGroupSkeleton` is wrapped and timed from call to `success`.
 */
function instrumentSkeleton(): void {
  const ds = engine.datasource;
  if (!ds) return;
  const real = ds.getGroupSkeleton.bind(ds);
  (ds as unknown as { getGroupSkeleton: unknown }).getGroupSkeleton = (params: never) => {
    const t0 = performance.now();
    const p = params as { success(r: unknown): void };
    const success = p.success.bind(p);
    (p as { success: unknown }).success = (r: { groups?: unknown[] }) => {
      $('s-skel').textContent = `${(performance.now() - t0).toFixed(1)} ms`;
      $('s-groups').textContent = (r.groups?.length ?? 0).toLocaleString();
      success(r);
    };
    return real(params);
  };
}

function applyGrouping(spec: string): void {
  const cols = spec ? spec.split(',') : [];
  grid.setGroupModel({ rowGroupCols: cols });
  if (!cols.length) { $('s-skel').textContent = '—'; $('s-groups').textContent = '—'; }
}

($('grouping') as HTMLSelectElement).addEventListener('change', (e) => {
  applyGrouping((e.target as HTMLSelectElement).value);
});

let feeding = true;
let clock = 0;
setInterval(() => {
  if (!feeding) return;
  clock += 1;
  void engine.ingest(tickRows(book, TICK_ROWS, clock));
}, TICK_MS);

$('feed').addEventListener('click', () => {
  feeding = !feeding;
  $('feed').textContent = feeding ? 'Pause feed' : 'Resume feed';
  // With the feed paused the engine pushes nothing, so repaints/s falls to
  // zero — the property that keeps a still grid still.
});

void boot().catch((err) => {
  // A boot failure here is the whole demo, so say so on the page rather than
  // leaving an empty grid and a console nobody opened.
  app.innerHTML = `<pre class="err">Failed to start the Rust hub engine:\n\n${String(err)}</pre>`;
});

// Handy from the console, and what the E2E spec drives.
(window as unknown as { __demo: unknown }).__demo = { grid, engine, book, plane };
