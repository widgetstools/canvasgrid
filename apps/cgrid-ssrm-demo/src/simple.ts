/**
 * Minimal consumer of `@wellsfargo-starui/velocity-grid-perspective`.
 *
 * Query params (for e2e / demos):
 *   ?feed=seed|stomp     default seed (no broker)
 *   ?wsUrl=ws://…        STOMP broker (default ws://localhost:8082)
 *   ?clientId=TRADER001
 *   ?rows=5000
 *   ?worker=dedicated    avoid SharedWorker flake in Playwright
 */
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import '@wellsfargo-starui/velocity-grid/style.css';
import { StompPerspectiveProvider } from '@wellsfargo-starui/velocity-grid-perspective';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';

const qs = new URLSearchParams(location.search);
const feed = (qs.get('feed') === 'stomp' ? 'stomp' : 'seed') as 'seed' | 'stomp';
const snapshotRows = Number(qs.get('rows') ?? 5_000) || 5_000;
const wsUrl = qs.get('wsUrl') ?? 'ws://localhost:8082';
const clientId = qs.get('clientId') ?? 'TRADER001';

const provider = new StompPerspectiveProvider({
  feed,
  snapshotRows,
  rate: Number(qs.get('rate') ?? 40) || 40,
  batchSize: Number(qs.get('batch') ?? 200) || 200,
  label: feed === 'stomp' ? 'STOMP Perspective SSRM' : 'Seed Perspective SSRM',
  ...(feed === 'stomp' ? { wsUrl, clientId } : {}),
});

const grid = new VelocityGrid(document.getElementById('grid')!, {
  theme: 'vg-theme-quartz-dark',
  enableCellChangeFlash: true,
  cellSelection: { suppressHeader: true },
  rowSelection: 'multiple',
  sideBar: { toolPanels: ['columns', 'filters'] },
  statusBar: {
    statusPanels: [
      { statusPanel: 'agTotalAndFilteredRowCountComponent' },
      { statusPanel: 'agSelectedRowCountComponent' },
    ],
  },
  ...provider.gridOptions(),
});

wireFormat(grid);
const { calc } = wireCalc(grid);
const { rules, alerts } = wireRules(grid);

const detach = provider.attach(grid);

type SimpleApi = {
  provider: typeof provider;
  grid: typeof grid;
  calc: typeof calc;
  rules: typeof rules;
  alerts: typeof alerts;
  feed: typeof feed;
  /** Wait until SSRM has hydrated at least `min` displayed rows. */
  waitForRows: (min?: number, timeoutMs?: number) => Promise<number>;
  waitPaintSettled: (stableFrames?: number, maxMs?: number) => Promise<void>;
  getChunkWindow: () => { rowStart: number; rowCount: number } | null;
  /**
   * Register a Perspective ExprTK expression, ensure a column def, soft-refresh.
   * Alias becomes a projected SSRM field (column windowing active).
   */
  addPerspectiveCalc: (opts: {
    colId: string;
    expression: string;
    headerName?: string;
    format?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Patch a hydrated row via SSRM tx + feed rules/alerts (seed/live ticks
   * already flow through attach; this is deterministic for e2e).
   */
  simulateLiveTick: (
    patch: Record<string, unknown> & { positionId: string },
  ) => { rowId: string; flashed: number };
  probeBodyPaint: () => {
    width: number;
    height: number;
    blackRatio: number;
    maxBlackRun: number;
    uniqueApprox: number;
    signature: string;
    nonEmptyCells: number;
    chunkRowStart: number;
  };
};

const api: SimpleApi = {
  provider,
  grid,
  calc,
  rules,
  alerts,
  feed,
  async waitForRows(min = 1, timeoutMs = 90_000) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const total = grid.getDisplayedRowCount?.() ?? 0;
      const cell = grid.getCellValue?.(0, 'positionId');
      if (total >= min && cell != null && cell !== '') return total;
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }
    throw new Error(`waitForRows: no rows after ${timeoutMs}ms (feed=${feed})`);
  },
  waitPaintSettled(stableFrames = 4, maxMs = 2_000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let last = -1;
      let stable = 0;
      const tick = () => {
        const paints = (grid.getPaintStats?.() as { paints?: number } | undefined)?.paints ?? 0;
        if (paints === last) stable++;
        else {
          last = paints;
          stable = 0;
        }
        // Seed/live ticks keep painting — bound wait so e2e can't hang.
        if (stable >= stableFrames || performance.now() - t0 >= maxMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  },
  getChunkWindow() {
    const chunk = (grid as unknown as { chunk?: { rowStart: number; rowCount: number } }).chunk;
    if (!chunk) return null;
    return { rowStart: chunk.rowStart, rowCount: chunk.rowCount };
  },
  async addPerspectiveCalc(opts) {
    const alias = opts.colId.trim();
    const raw = opts.expression.trim();
    const source = raw.includes('//') ? raw : `// ${alias}\n${raw}`;
    try {
      const validated = await provider.validateExpressions({ [alias]: source });
      const err = validated.errors?.[alias];
      if (err) return { ok: false, error: String(err) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const next = { ...provider.getExpressions(), [alias]: source };
    await provider.setExpressions(next);

    // Merge expression output into columnDefs (not in POSITION_COLUMNS).
    const map = (grid as unknown as {
      columnDefsMap?: Map<string, { colId: string }>;
    }).columnDefsMap;
    const existing: unknown[] = [];
    if (map) {
      for (const def of map.values()) existing.push({ ...def });
    } else {
      existing.push(...(provider.columnDefs as unknown[]));
    }
    const without = existing.filter(
      (d) => (d as { colId?: string; field?: string }).colId !== alias
        && (d as { field?: string }).field !== alias,
    );
    without.push({
      colId: alias,
      field: alias,
      headerName: opts.headerName ?? alias,
      cellDataType: 'number',
      width: 120,
      ...(opts.format ? { valueFormatter: opts.format } : {}),
    });
    grid.updateGridOptions({ columnDefs: without as never });
    await new Promise((r) => setTimeout(r, 80));
    return { ok: true };
  },
  simulateLiveTick(patch) {
    const rowId = String(patch.positionId);
    const mirror = (grid as unknown as {
      rowDataById?: Map<string, Record<string, unknown>>;
    }).rowDataById?.get(rowId);
    const prev: Record<string, unknown> = { ...(mirror ?? {}) };
    const next: Record<string, unknown> = { ...prev, ...patch, positionId: rowId };
    // Kernel SSRM txs emit `rowsChanged` → rules/alerts bridge (flash + alerts).
    grid.applyServerSideTransaction({ update: [next] });
    return { rowId, flashed: -1 };
  },
  probeBodyPaint() {
    const canvas = document.querySelector('.vg-canvas, #grid canvas') as HTMLCanvasElement | null;
    const empty = {
      width: 0,
      height: 0,
      blackRatio: 1,
      maxBlackRun: 0,
      uniqueApprox: 0,
      signature: '0',
      nonEmptyCells: 0,
      chunkRowStart: 0,
    };
    if (!canvas) return empty;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ...empty, width: canvas.width, height: canvas.height };
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const dpr = canvas.width / Math.max(1, cssW);
    const topCss = 72;
    const bottomPadCss = 28;
    const sx = Math.floor(8 * dpr);
    const sy = Math.floor(topCss * dpr);
    const sw = Math.max(1, Math.floor((cssW - 16) * dpr));
    const sh = Math.max(1, Math.floor((cssH - topCss - bottomPadCss) * dpr));
    const img = ctx.getImageData(
      Math.min(sx, canvas.width - 1),
      Math.min(sy, canvas.height - 1),
      Math.min(sw, canvas.width - sx),
      Math.min(sh, canvas.height - sy),
    );
    const data = img.data;
    let black = 0;
    let maxRun = 0;
    let run = 0;
    const uniq = new Set<number>();
    let h32 = 0x811c9dc5 >>> 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const isVoid = r <= 6 && g <= 6 && b <= 6;
      if (isVoid) {
        black++;
        run++;
        if (run > maxRun) maxRun = run;
      } else run = 0;
      uniq.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      if ((i & 63) === 0) {
        h32 = Math.imul(h32 ^ r, 0x01000193) >>> 0;
        h32 = Math.imul(h32 ^ g, 0x01000193) >>> 0;
        h32 = Math.imul(h32 ^ b, 0x01000193) >>> 0;
      }
    }
    const chunk = (grid as unknown as { chunk?: { rowStart: number; rowCount: number } }).chunk;
    const rowStart = chunk?.rowStart ?? 0;
    const rowCount = chunk?.rowCount ?? 0;
    let nonEmptyCells = 0;
    for (let i = 0; i < Math.min(40, rowCount); i++) {
      const v = grid.getCellValue?.(rowStart + i, 'positionId');
      if (v != null && v !== '') nonEmptyCells++;
    }
    return {
      width: img.width,
      height: img.height,
      blackRatio: black / (data.length / 4 || 1),
      maxBlackRun: maxRun,
      uniqueApprox: uniq.size,
      signature: h32.toString(16),
      nonEmptyCells,
      chunkRowStart: rowStart,
    };
  },
};

(window as unknown as { __simple: SimpleApi }).__simple = api;

window.addEventListener('beforeunload', () => {
  detach();
  provider.destroy();
  grid.destroy();
});

console.info(
  `[cgrid-ssrm-demo/simple] StompPerspectiveProvider feed=${feed}`
  + (feed === 'stomp' ? ` · ${wsUrl}` : ' · seed book')
  + ` · rows=${snapshotRows}`,
);
