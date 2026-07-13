/**
 * cgrid-ext demo — live-STOMP testbed for `@cgrid/ext`.
 *
 * ZERO feature code lives here: this app is a plain consumer that
 * instantiates CGridExt (the batteries-included kernel + extension shell)
 * with cgrid's existing tooling enabled — the StarUI theme, the `sideBar`
 * tool panels (Columns / Filters / Grid Options / Column Groups), the
 * row-group panel, formatted + grouped + conditionally-styled columns — and
 * pipes in the stomp-view-server feed (ws://localhost:8081, run it from
 * /Users/develop/wfh/starui/apps/stomp-view-server). The shell mounts even
 * if the feed never connects; STOMP errors only affect data. Anything not
 * doable through the public @cgrid/ext / @cgrid/kernel API is a gap to fix
 * upstream, never worked around here.
 */
import { CGridExt, titleBarExtensions, ribbonExtensions } from '@cgrid/ext';
import { formatPrice32, type CColDef, type CColGroupDef } from '@cgrid/kernel';
import '@cgrid/kernel/style.css';
import { wireIntoKernel as wireFormat } from '@cgrid/format';
import { wireEditIntoKernel } from '@cgrid/edit';
import { wireIntoKernel as wireCalc } from '@cgrid/calc';
import { wireIntoKernel as wireRules } from '@cgrid/rules';
import { connectStomp, type Position } from './stomp';

// ─── Pixel-invariance test harness ──────────────────────────────────────
// `?paintHarness` swaps the live STOMP feed for a fixed, deterministic
// 200-row dataset and exposes `window.__paintHarness` so an E2E spec can
// hash the live `.cg-canvas` pixels and diff a `suppressPartialRepaint:
// true` run against the default damage-region run. Never default-on:
// `getImageData` on the live canvas can force it off the GPU compositing
// path for the page's whole lifetime (see `snapshot()` below), so this
// path is opt-in and disconnected from the real feed entirely.
const harnessParams = new URLSearchParams(location.search);
const PAINT_HARNESS = harnessParams.has('paintHarness');
const SUPPRESS_PARTIAL = harnessParams.has('suppressPartial');
// Closeout fix wave (I5) — two more harness-only variants, each locking a
// specific bug the base `?paintHarness` boot couldn't reach:
//   `&grouped`  — row-groups the `desk` column (C4: sticky ancestor totals).
//   `&noFlash`  — boots with `enableCellChangeFlash: false`, the DEFAULT
//                 for a real app but never exercised by the base harness,
//                 which always ran with flash on (C3).
const GROUPED = harnessParams.has('grouped');
const NO_FLASH = harnessParams.has('noFlash');
// Task 5 (paint-cache layer) — `&noCache` boots with `paintCache: false`,
// the field escape hatch back to the legacy damage-only pipeline. Paired
// with `?paintHarness` this is the cache-on-vs-cache-off invariance arm:
// two harness pages, one with the retained layer active (default) and one
// without, must produce byte-identical pixels for the same step script.
const NO_CACHE = harnessParams.has('noCache');
// Cycle 22 (raster cache) — `&noRaster` boots with `rasterCache: false`,
// the field escape hatch that keeps the paint-cache layer live but fully
// disables BOTH raster-cache tiers (Tier-1 content-keyed cell bitmaps at
// the byRows seam + Tier-2 retained row strips). Paired with
// `?paintHarness` this is the raster-on-vs-raster-off invariance arm:
// identical step script on both pages, byte-identical pixels required —
// orthogonal to `&suppressPartial` (damage clipping) and `&noCache`
// (the retained layer itself).
const NO_RASTER = harnessParams.has('noRaster');

/** Deterministic PRNG (public-domain mulberry32) — same seed on every boot
 *  so the two harness pages (partial vs. suppressed) see identical data. */
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

/** Fixed 200-row seed, same `Position` shape stomp.ts publishes, ids
 *  `HARNESS-0000`…`HARNESS-0199` (the invariance spec's STEPS reference
 *  a couple of these ids directly). */
function seedHarnessRows(): Position[] {
  const rng = mulberry32(42);
  const rows: Position[] = [];
  for (let i = 0; i < 200; i++) {
    const notional = Math.round(rng() * 9_000_000 + 1_000_000);
    const price = 95 + rng() * 10;
    rows.push({
      positionId: `HARNESS-${String(i).padStart(4, '0')}`,
      cusip: `CUSIP${String(i).padStart(5, '0')}`,
      ticker: `TICK${i % 40}`,
      notionalAmount: notional,
      marketValue: Math.round(notional * (price / 100)),
      currentPrice: price,
      pnl: Math.round((rng() - 0.5) * 200_000),
      dailyPnl: Math.round((rng() - 0.5) * 50_000),
      unrealizedPnl: Math.round((rng() - 0.5) * 100_000),
      yield: rng() * 8,
      spread: rng() * 300,
      dv01: rng() * 5000,
      pv01: rng() * 5000,
    });
  }
  return rows;
}

const DESKS = ['RATES', 'CREDIT', 'FX', 'EQD'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const TRADERS = ['patel', 'okafor', 'lindqvist', 'tanaka', 'reyes'];

/** Deterministic categoricals derived from positionId so grouping affordances
 *  (row-group panel, Columns tool panel) have stable dimensions. */
function decorateWithCategoricals(row: Position): Position {
  let h = 0;
  for (let i = 0; i < row.positionId.length; i++) {
    h = (h * 31 + row.positionId.charCodeAt(i)) >>> 0;
  }
  row.desk = DESKS[h % DESKS.length];
  row.region = REGIONS[(h >>> 2) % REGIONS.length];
  row.currency = CURRENCIES[(h >>> 4) % CURRENCIES.length];
  row.trader = TRADERS[(h >>> 6) % TRADERS.length];
  return row;
}

const num = (headerName: string, field: keyof Position, extra: Partial<CColDef<Position>> = {}): CColDef<Position> => ({
  colId: field,
  field,
  headerName,
  cellDataType: 'number',
  enableValue: true,
  valueFormatter: '#,##0.00',
  ...extra,
});

const cat = (headerName: string, field: keyof Position): CColDef<Position> => ({
  colId: field,
  field,
  headerName,
  cellDataType: 'text',
  enableRowGroup: true,
  enablePivot: true,
});

/** Mode-aware ± sign colouring via theme tokens (resolved per active theme). */
const signStyle = (p: { value: unknown }) => {
  const n = Number(p.value);
  return Number.isFinite(n) && n !== 0
    ? { fg: n > 0 ? 'var(--cg-pos-color)' : 'var(--cg-neg-color)' }
    : {};
};

const columnDefs: (CColDef<Position> | CColGroupDef<Position>)[] = [
  { colId: 'positionId', field: 'positionId', headerName: 'Position', pinned: 'left', width: 130 },
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', enableRowGroup: true, enablePivot: true, width: 90 },
  { colId: 'cusip', field: 'cusip', headerName: 'CUSIP', cellDataType: 'text', width: 110 },
  cat('Desk', 'desk'),
  cat('Region', 'region'),
  cat('Ccy', 'currency'),
  cat('Trader', 'trader'),
  {
    groupId: 'trade',
    headerName: 'Trade',
    openByDefault: true,
    children: [
      {
        groupId: 'valuation',
        headerName: 'Valuation',
        openByDefault: true,
        children: [
          num('Notional', 'notionalAmount', { valueFormatter: '#,##0', aggFunc: 'sum' }),
          num('Mkt Value', 'marketValue', { valueFormatter: '#,##0', aggFunc: 'sum', columnGroupShow: 'open' }),
        ],
      },
      num('P&L', 'pnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)', cellStyle: signStyle }),
      num('Daily P&L', 'dailyPnl', {
        aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)',
        cellStyle: (p: { value: unknown }) => {
          const n = Number(p.value);
          if (!Number.isFinite(n) || n === 0) return {};
          if (n > 0) {
            return {
              fg: 'var(--cg-pos-color)', fontWeight: 700,
              decorators: [{ position: 'tr', kind: 'emoji', value: '▲', color: 'var(--cg-pos-color)', size: 9 }],
            };
          }
          return {
            fg: 'var(--cg-neg-color)', fontWeight: 700,
            border: { left: { width: 3, style: 'solid', color: 'var(--cg-neg-color)' } },
            decorators: [{ position: 'tr', kind: 'emoji', value: '▼', color: 'var(--cg-neg-color)', size: 9 }],
          };
        },
      }),
    ],
  },
  // 32nds bond price: displayed and edited as `101-16`.
  num('Price', 'currentPrice', {
    cellEditor: 'price32',
    valueFormatter: (p: { value: unknown }) => formatPrice32(p.value as number),
  }),
  num('Unrealized', 'unrealizedPnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)', cellStyle: signStyle }),
  {
    groupId: 'risk',
    headerName: 'Risk',
    children: [
      num('DV01', 'dv01', { aggFunc: 'sum' }),
      num('PV01', 'pv01', { aggFunc: 'sum' }),
      num('Yield', 'yield', { valueFormatter: '0.000' }),
      num('Spread', 'spread', { cellStyle: { fg: 'var(--cg-info-color)' } }),
    ],
  },
];

const app = document.querySelector<HTMLDivElement>('#app')!;

// The edit engine is wired just after construction (below); the ribbon's
// Editing toolbar reads it lazily so undo/redo + smart/bulk bind to the real
// handle once it exists.
let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

const ext = new CGridExt<Position>(app, {
  gridId: 'ext-demo',
  persistState: true,
  getRowId: (r) => r.positionId,
  columnDefs,
  theme: 'cg-theme-quartz-dark',
  floatingFilterHeight: 34,
  floatingFilterInsetY: 8,
  defaultColDef: { resizable: true, sortable: true, editable: true, flex: 1, minWidth: 80 },
  rowGroupPanelShow: 'always',
  sideBar: { toolPanels: ['columns', 'filters', 'gridOptions', 'columnGroups'] },
  // `&noFlash` (closeout fix wave, I5/C3) boots with flash OFF — the real
  // default for a plain grid, and the exact configuration C3's bug needed
  // (the base harness always ran with flash on, which happened to mask it).
  enableCellChangeFlash: !NO_FLASH,
  cellSelection: {},
  // `&suppressPartial` (only meaningful alongside `?paintHarness`) forces
  // every repaint to the full-surface path — the invariance spec's control
  // arm for damage-region rendering.
  ...(SUPPRESS_PARTIAL ? { suppressPartialRepaint: true } : {}),
  // `&noCache` (only meaningful alongside `?paintHarness`) disables the
  // retained paint-cache layer — the invariance spec's second control arm,
  // orthogonal to `suppressPartial`.
  ...(NO_CACHE ? { paintCache: false } : {}),
  // `&noRaster` (only meaningful alongside `?paintHarness`) disables both
  // raster-cache tiers (cell bitmaps + row strips) — the invariance spec's
  // third control arm, orthogonal to `suppressPartial` and `noCache`.
  ...(NO_RASTER ? { rasterCache: false } : {}),
  // `&grouped` (closeout fix wave, I5/C4) — every desk group expanded with
  // footer totals on, so a live tick on an aggregated column changes a
  // group's total while scrolling can pin that group's ancestor in the
  // sticky band above the fetch window.
  ...(GROUPED ? { groupIncludeFooter: true, groupDefaultExpanded: 'all' as const } : {}),
  ext: {
    // Replace the spine's bare Settings/Save with the full MarketsGrid-style
    // title bar (brand, search, notifications, profiles, save, date, settings,
    // overflow). The Grid Options module still opens from the settings icon.
    extensions: [
      { remove: 'settings-launcher' },
      { remove: 'save' },
      ...titleBarExtensions({ name: 'MarketsGrid', date: new Date().toISOString().slice(0, 10) }),
      ...ribbonExtensions({ edit: () => editHandle }),
    ],
  },
});

// Wire cgrid's engines onto the owned grid: format (compiles the string
// valueFormatters / DSL above), edit (editors + Smart Edit / Bulk Update),
// calc (calculated columns + styling templates), rules (conditional styles).
wireFormat(ext.grid);
// Re-issue defs so the now-registered format compiler picks up the string
// valueFormatters ('#,##0.00', '[Red]…'). Must run right after wireFormat and
// BEFORE calc/rules wire — re-issuing after calc resets its override baseline
// so later editColumn() edits don't repaint.
ext.grid.updateGridOptions({ columnDefs });
editHandle = wireEditIntoKernel(ext.grid);
(window as unknown as { __edit: unknown }).__edit = editHandle;
wireCalc(ext.grid);
wireRules(ext.grid);

// Expose for console poking + the hermetic E2E suite.
(window as unknown as { __ext: unknown }).__ext = ext;

// cgrid's side-panel rail (Columns / Filters / Grid Options / Column Groups)
// must always be visible on load. persistState can restore it hidden from a
// prior session, and that restore runs async after construction — so force it
// visible now and again after the restore settles.
const showSidebar = () => { try { ext.grid.setSideBarVisible(true); } catch { /* ignore */ } };
showSidebar();
requestAnimationFrame(showSidebar);
setTimeout(showSidebar, 250);

if (PAINT_HARNESS) {
  // ─── Pixel-invariance harness boot ────────────────────────────────────
  // No STOMP feed at all — both the partial and suppressed harness pages
  // must see byte-identical data, so the feed (async, server-driven) is
  // never in the loop.
  const rows = seedHarnessRows();
  rows.forEach(decorateWithCategoricals);
  ext.setRowData(rows);

  // Closeout fix wave (I5 / C4) — `&grouped` row-groups the `desk` column
  // (4 distinct values across 200 harness rows, ~50 rows/group) with every
  // group expanded + footer totals on, so scrolling partway into a group
  // pins its ancestor(s) in the sticky band above the fetch window — the
  // exact "grouped + sticky + live tick" configuration C4 targets. A
  // colDef-level `rowGroup: true` does NOT auto-activate grouping at
  // construction (`GroupingCoordinator` is always seeded with an empty
  // `rowGroupCols` — see cgrid.ts's ctor comment), so this goes through
  // the real runtime API instead, same as a user dragging the column into
  // the row-group panel would.
  if (GROUPED) {
    ext.grid.setRowGroupColumns(['desk']);
  }

  (window as unknown as { __paintHarness: unknown }).__paintHarness = {
    rows,
    snapshot(): string {
      const c = document.querySelector('.cg-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let h = 0; // FNV-1a over every 16th byte — fast, deterministic
      for (let i = 0; i < d.length; i += 16) { h ^= d[i]!; h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    },
    /** Task 5 (paint-cache layer) — same FNV-1a hash as `snapshot()`, but
     *  excludes the bottommost `marginRows` rows of the CANVAS (not just the
     *  data body) from the sample. Exists ONLY for the paint-cache
     *  on-vs-off comparison arms in `paintInvariance.spec.ts`; every
     *  pre-existing arm keeps using the unmodified `snapshot()` above,
     *  completely unaffected by this method's existence.
     *
     *  Root-caused during Task 5 (see the spec's implementation notes):
     *  whenever the LAST row visible at the bottom of the data body is
     *  only PARTIALLY exposed (`bodyHeight` is essentially never an exact
     *  multiple of `rowHeight`, so this is true at almost every scroll
     *  position, including the unscrolled boot state), that row's glyphs
     *  (this harness's negative/positive P&L sign decorators) can differ
     *  by a handful of anti-aliased pixels (single-digit-to-low-20s RGB
     *  delta, ≤9 px observed) between the paint-cache layer's present path
     *  and the legacy direct-paint path. Exhaustively isolated to a
     *  genuine Chromium/Skia rendering trait — NOT a coordinate or damage-
     *  resolution bug in cgrid — via seven independent probes: (1) the
     *  SAME data value at the SAME row is confirmed identical between
     *  pages (rules out a data/value bug); (2) every geometry input
     *  (bodyTop, bodyHeight, scrollTop, layerTop) is an exact integer at
     *  dpr=1, ruling out a `Math.round` truncation theory; (3) forcing the
     *  layer's canvas factory to the detached-`HTMLCanvasElement` fallback
     *  (no `OffscreenCanvas`) reproduces the identical diff, ruling out an
     *  OffscreenCanvas-vs-DOM-canvas backend difference; (4) explicitly
     *  setting `imageSmoothingEnabled = false` on the present blit does
     *  not change it, ruling out resampling; (5) both canvases already
     *  share the same `{ alpha: false }` context attributes, ruling out
     *  an opaque-vs-transparent compositing difference; (6) two LEGACY
     *  (`paintCache:false`) pages compared against each other (one also
     *  `suppressPartialRepaint`) show ZERO diff anywhere on the canvas,
     *  proving the legacy pipeline is internally self-consistent and the
     *  divergence is introduced specifically by the retained layer; (7)
     *  most conclusively, setting `paintCacheOverscan: 0` at runtime (so
     *  the layer's own backing store is EXACTLY `bodyHeight` tall, meaning
     *  the present blit becomes a plain 1:1 full-height copy with no crop
     *  headroom at all) makes the diff disappear completely — proving the
     *  cause is specifically Skia rendering a shape's anti-aliasing
     *  slightly differently depending on whether the shape has additional
     *  canvas area beyond the eventual crop boundary (the layer, which
     *  legitimately rasters `bodyHeight + 2*overscanPx` of content so
     *  future scrolls don't need re-rastering) versus a render target that
     *  ends exactly there (the legacy canvas, or the cache-on canvas at
     *  overscan 0). A parallel probe at the BODY's top edge (a non-row-
     *  aligned scroll, `scrollTop: 16`, so the first visible row is
     *  top-clipped mid-glyph) shows ZERO diff — confirming this is
     *  specifically about a render target's own PHYSICAL boundary (the
     *  canvas's bottom edge, which coincides with `bodyBottom` in this
     *  harness), not clipping in general. This is an inherent trade-off of
     *  ANY "raster taller, present a cropped slice" retained-bitmap
     *  technique — not fixable by an application-level canvas-2D API
     *  change — and is invisible in practice (a row that is ≥94%
     *  scrolled out of view). `marginRows` defaults to 1 (one row height,
     *  read back via `getRowBoundsAt` so it holds under any row-height
     *  setting) — generous enough to always exclude the artifact while
     *  still byte-comparing ~93%+ of the canvas exactly. */
    snapshotSansEdgeRow(marginRows = 1): string {
      const c = document.querySelector('.cg-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const g = ext.grid;
      // Rows 0/1 aren't always resolvable here — several of the NEW Task 5
      // scroll steps (scroll-beyond-overscan, horizontal scroll) can leave
      // the top of the row index scrolled out of `getRowBoundsAt`'s
      // resolvable range. A single row's OWN `.h` (no second row needed)
      // read from whichever nearby index actually resolves is robust to
      // that; 32 is this harness's own known row height, kept only as an
      // absolute last-resort fallback that should never actually trigger.
      let rowH = 32;
      for (let ri = 0; ri < 50; ri++) {
        const b = g.getRowBoundsAt(ri);
        if (b) { rowH = b.h; break; }
      }
      const dpr = window.devicePixelRatio || 1;
      const marginDevicePx = Math.ceil(rowH * marginRows * dpr);
      const sampleHeight = Math.max(0, c.height - marginDevicePx);
      const d = ctx.getImageData(0, 0, c.width, sampleHeight).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 16) { h ^= d[i]!; h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    },
    /** Closeout M-6 — the companion to `snapshotSansEdgeRow`: samples ONLY
     *  the bottom `marginRows` band `snapshotSansEdgeRow` excludes (same
     *  every-16th-byte stride as both hash methods), so the paint-cache
     *  on-vs-off E2E arms are no longer completely BLIND there — exactly
     *  where a real stale/shifted-row bug (as opposed to the adjudication-A
     *  AA trait) would live. Returns the raw sampled byte array (not a
     *  hash) so the caller can bound the actual divergence — a genuine AA
     *  difference is a handful of low-magnitude per-channel deltas; a
     *  stale/shifted row is a wholesale content difference across most of
     *  the band. */
    edgeRowSample(marginRows = 1): number[] {
      const c = document.querySelector('.cg-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const g = ext.grid;
      let rowH = 32;
      for (let ri = 0; ri < 50; ri++) {
        const b = g.getRowBoundsAt(ri);
        if (b) { rowH = b.h; break; }
      }
      const dpr = window.devicePixelRatio || 1;
      const marginDevicePx = Math.ceil(rowH * marginRows * dpr);
      const sampleTop = Math.max(0, c.height - marginDevicePx);
      const sampleHeight = c.height - sampleTop;
      if (sampleHeight <= 0) return [];
      const d = ctx.getImageData(0, sampleTop, c.width, sampleHeight).data;
      const out: number[] = [];
      for (let i = 0; i < d.length; i += 16) out.push(d[i]!);
      return out;
    },
    /** Resolves once `getPaintStats().paints` is unchanged for at least two
     *  consecutive animation frames AND a short quiet window — the "fully
     *  settled" signal the invariance spec waits on before hashing. A pure
     *  frame-count check (e.g. "2 RAFs with no change") is too tight here:
     *  a mutation's repaint often depends on an async worker round-trip
     *  (postMessage for the recomputed viewport chunk) that can still be
     *  in flight after 2 RAFs have already ticked with no visible change,
     *  which would report "settled" before the real repaint ever lands.
     *  The quiet-time floor absorbs that latency regardless of how many
     *  frames it spans. */
    waitSettled(): Promise<void> {
      const QUIET_MS = 250;
      const MAX_MS = 8000;
      return new Promise((resolve) => {
        const g = ext.grid;
        let last = g.getPaintStats().paints;
        let lastChangeTime = performance.now();
        let framesSinceChange = 0;
        const start = performance.now();
        const tick = () => {
          requestAnimationFrame(() => {
            const now = performance.now();
            const cur = g.getPaintStats().paints;
            if (cur !== last) {
              last = cur;
              lastChangeTime = now;
              framesSinceChange = 0;
            } else {
              framesSinceChange++;
            }
            const settled = framesSinceChange >= 2 && (now - lastChangeTime) >= QUIET_MS;
            if (settled || (now - start) > MAX_MS) { resolve(); return; }
            tick();
          });
        };
        tick();
      });
    },
  };
} else {
  // ─── STOMP feed ────────────────────────────────────────────────────────
  // The shell + grid are already mounted above and stay visible regardless
  // of feed state; connectStomp's onPhase('error') only affects these logs.
  connectStomp({
    onPhase: (phase) => { console.info(`[cgrid-ext-demo] stomp phase: ${phase}`); },
    onSnapshot: (rows) => { rows.forEach(decorateWithCategoricals); ext.setRowData(rows); },
    onLiveUpdate: (updates) => { updates.forEach(decorateWithCategoricals); ext.grid.applyTransactionAsync({ update: updates }); },
  });
}
