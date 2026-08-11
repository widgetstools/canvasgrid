import type { FilterModel, SortModel } from '../types';
import type {
  IServerSideDatasource,
  LoadSuccessParams,
  RefreshServerSideParams,
  ServerSideTransaction,
} from '../types/ssrm';

export interface SsrmHost<TRow> {
  getRowId(row: TRow): string;
  getSortModel(): SortModel;
  getFilterModel(): FilterModel;
  getRowGroupCols(): string[];
  getGroupKeys(): string[];
  getExpandedGroupKeys(): string[];
  /**
   * Optional column projection for getRows / getLeafRows. When omitted or
   * empty, datasources return full rows (legacy behaviour).
   */
  getColumnKeys?(): string[] | undefined;
  mergeGroupKeys?(keys: string[]): void;
  setRowCount(count: number, prevCount?: number): void;
  /** Row range to reload on soft refresh — typically the current viewport overscan. */
  getRefreshRange?(): { rowStart: number; rowEnd: number };
  /** Sparse hydrate into the worker — rows cover [startRow, startRow+rows.length). */
  hydrateWindow(startRow: number, rows: TRow[], rowCount: number, reset?: boolean): Promise<void>;
  /** Patch rows already present in the worker store (live ticks). */
  applyTransaction(tx: {
    add?: TRow[];
    update?: TRow[];
    remove?: TRow[];
  }): void;
  requestViewport(): void;
  isDestroyed(): boolean;
}

interface BlockState<TRow> {
  startRow: number;
  rows: TRow[];
  state: 'loading' | 'loaded' | 'failed';
}

/**
 * Main-thread SSRM controller: block cache + datasource fan-in.
 * Worker holds only a sparse window for paint (see `ssrmHydrate`).
 */
export class ServerSideRowModelController<TRow = any> {
  private datasource: IServerSideDatasource<TRow> | null = null;
  private readonly blocks = new Map<number, BlockState<TRow>>();
  private rowCount = 0;
  private generation = 0;
  private inflight = 0;
  private readonly pending = new Set<number>();
  private readonly cacheBlockSize: number;
  private readonly maxConcurrent: number;
  /** Serialize refresh/ensure so purge cannot race a later hydrate. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: SsrmHost<TRow>,
    opts: { cacheBlockSize?: number; maxConcurrentDatasourceRequests?: number } = {},
  ) {
    this.cacheBlockSize = Math.max(1, opts.cacheBlockSize ?? 100);
    this.maxConcurrent = Math.max(1, opts.maxConcurrentDatasourceRequests ?? 2);
  }

  setDatasource(ds: IServerSideDatasource<TRow> | null): void {
    this.datasource?.destroy?.();
    this.datasource = ds;
    void this.refresh({ purge: true });
  }

  getRowCount(): number {
    return this.rowCount;
  }

  /** Ensure blocks covering [rowStart, rowEnd) are loaded, then hydrate worker. */
  ensureRange(rowStart: number, rowEnd: number): Promise<void> {
    return this.enqueue(() => this.ensureRangeInner(rowStart, rowEnd));
  }

  /**
   * Load every block for the current `rowCount` and reset-hydrate the
   * worker so the CSRM pipeline can run over the full book (grouping,
   * pivot, client sort/filter, totals). Always resolves true: the v1
   * block model can fully hydrate in any state (the boolean exists for
   * signature parity with v2, whose grouped path must refuse).
   */
  async ensureFullyHydrated(): Promise<boolean> {
    await this.enqueue(() => this.ensureFullyHydratedInner());
    return true;
  }

  private async ensureFullyHydratedInner(): Promise<void> {
    if (this.host.isDestroyed()) return;
    // Discover size if still unknown.
    if (this.rowCount <= 0) {
      await this.ensureRangeInner(0, this.cacheBlockSize);
    }
    if (this.host.isDestroyed() || this.rowCount <= 0) return;

    const gen = this.generation;
    const lastBlock = Math.floor((this.rowCount - 1) / this.cacheBlockSize);
    const needed: number[] = [];
    for (let b = 0; b <= lastBlock; b++) {
      const cur = this.blocks.get(b);
      if (!cur || cur.state !== 'loaded' || cur.rows.length === 0) needed.push(b);
    }
    if (needed.length > 0) {
      await Promise.all(needed.map((b) => this.loadBlock(b, gen)));
    }
    if (gen !== this.generation || this.host.isDestroyed()) return;

    const rows: TRow[] = [];
    for (let i = 0; i < this.rowCount; i++) {
      const b = Math.floor(i / this.cacheBlockSize);
      const block = this.blocks.get(b);
      if (!block || block.state !== 'loaded') break;
      const row = block.rows[i - block.startRow];
      if (row === undefined) break;
      rows.push(row);
    }
    await this.host.hydrateWindow(0, rows, this.rowCount, true);
  }

  refresh(params: RefreshServerSideParams = {}): Promise<void> {
    // Conflate soft refreshes — live ticks can outpace the refresh op, and
    // one queued op per tick grows the chain without bound (see the v2
    // controller's sibling comment). While one soft refresh is queued,
    // later ticks ride it.
    const soft = params.purge === false;
    if (soft && this.pendingSoftRefresh !== null) {
      return this.pendingSoftRefresh;
    }
    const p: Promise<void> = this.enqueue(async () => {
      if (soft && this.pendingSoftRefresh === p) this.pendingSoftRefresh = null;
      await this.refreshInner(params);
    });
    if (soft) this.pendingSoftRefresh = p;
    return p;
  }

  /** Conflation handle — at most one QUEUED soft refresh at a time. */
  private pendingSoftRefresh: Promise<void> | null = null;

  /**
   * Soft refresh for expansion-state changes. An expand/collapse shifts the
   * flattened index of every row below the toggled group, so every cached
   * block is suspect — drop the whole cache (not just the viewport band),
   * then refetch the band. Rows keep painting until the new data lands
   * (no purge flash).
   */
  refreshExpansion(): Promise<void> {
    return this.enqueue(() => this.refreshInner({ purge: false }, true));
  }

  applyServerSideTransaction(tx: ServerSideTransaction<TRow>): void {
    if (tx.rowCount !== undefined) {
      const prev = this.rowCount;
      this.rowCount = Math.max(0, tx.rowCount);
      this.host.setRowCount(this.rowCount, prev);
    }

    if (tx.update?.length || tx.remove?.length) {
      const removeIds = new Set(
        (tx.remove ?? []).map((r) => {
          try { return this.host.getRowId(r); } catch { return ''; }
        }).filter(Boolean),
      );
      const updatesById = new Map<string, TRow>();
      for (const row of tx.update ?? []) {
        try { updatesById.set(this.host.getRowId(row), row); } catch { /* skip */ }
      }

      for (const block of this.blocks.values()) {
        if (block.state !== 'loaded') continue;
        for (let i = 0; i < block.rows.length; i++) {
          const row = block.rows[i]!;
          let id = '';
          try { id = this.host.getRowId(row); } catch { continue; }
          if (removeIds.has(id)) continue;
          const next = updatesById.get(id);
          if (next) block.rows[i] = next;
        }
      }
    }

    this.host.applyTransaction({
      add: tx.add,
      update: tx.update,
      remove: tx.remove,
    });
    this.host.requestViewport();
  }

  destroy(): void {
    this.datasource?.destroy?.();
    this.datasource = null;
    this.blocks.clear();
    this.generation++;
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op, op);
    // Keep the chain alive even if an op fails.
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async refreshInner(
    params: RefreshServerSideParams,
    invalidateAllBlocks = false,
  ): Promise<void> {
    this.generation++;
    const gen = this.generation;
    if (params.purge !== false) {
      this.blocks.clear();
      this.pending.clear();
      // Await reset so it cannot land after a subsequent data hydrate.
      await this.host.hydrateWindow(0, [], Math.max(this.rowCount, 0), true);
    } else {
      // Soft refresh — re-run getRows for the visible band. Keep painted
      // rows on screen while reloading (delete-then-fetch blanked the band).
      const range = this.host.getRefreshRange?.() ?? { rowStart: 0, rowEnd: this.cacheBlockSize };
      if (invalidateAllBlocks) {
        // Expansion structure changed — flattened indices shifted; drop all.
        this.blocks.clear();
        this.pending.clear();
      } else {
        const firstBlock = Math.floor(Math.max(0, range.rowStart) / this.cacheBlockSize);
        const lastBlock = Math.floor(
          Math.max(range.rowStart, range.rowEnd - 1) / this.cacheBlockSize,
        );
        const reloads: Array<Promise<void>> = [];
        for (let b = firstBlock; b <= lastBlock; b++) {
          reloads.push(this.loadBlock(b, gen, true));
        }
        await Promise.all(reloads);
      }
      if (gen !== this.generation || this.host.isDestroyed()) return;
      await this.ensureRangeInner(range.rowStart, range.rowEnd);
      if (gen !== this.generation || this.host.isDestroyed()) return;
      this.host.requestViewport();
      return;
    }
    if (gen !== this.generation || this.host.isDestroyed()) return;
    // Always pull at least the first block — viewport may still be 0-height
    // on the first paint of a flex panel.
    await this.ensureRangeInner(0, this.cacheBlockSize);
    if (gen !== this.generation || this.host.isDestroyed()) return;
    this.host.requestViewport();
  }

  private async ensureRangeInner(rowStart: number, rowEnd: number): Promise<void> {
    if (!this.datasource || this.host.isDestroyed()) return;
    const start = Math.max(0, Math.floor(rowStart));
    // Collapsed viewport (end <= start) still needs block 0 once a book exists
    // or to discover rowCount from the datasource.
    const end = Math.max(start + 1, Math.ceil(rowEnd));
    const firstBlock = Math.floor(start / this.cacheBlockSize);
    const lastBlock = Math.floor(Math.max(start, end - 1) / this.cacheBlockSize);
    const gen = this.generation;

    const needed: number[] = [];
    const waiting: Array<Promise<void>> = [];
    for (let b = firstBlock; b <= lastBlock; b++) {
      const cur = this.blocks.get(b);
      if (cur?.state === 'loading' || this.pending.has(b)) {
        waiting.push(this.waitUntil(
          () => (!this.pending.has(b) && this.blocks.get(b)?.state !== 'loading')
            || gen !== this.generation,
        ));
        continue;
      }
      if (!cur || cur.state === 'failed') {
        needed.push(b);
        continue;
      }
      // Empty "loaded" block from a pre-snapshot / empty-book getRows —
      // reload once we believe rows exist (or always when count unknown).
      const blockStart = b * this.cacheBlockSize;
      if (
        cur.state === 'loaded'
        && cur.rows.length === 0
        && (this.rowCount === 0 || blockStart < this.rowCount)
      ) {
        needed.push(b);
      }
    }
    // Dedupe
    const uniq = [...new Set(needed)];

    if (uniq.length > 0 || waiting.length > 0) {
      await Promise.all([
        ...uniq.map((b) => this.loadBlock(b, gen)),
        ...waiting,
      ]);
    }
    if (gen !== this.generation || this.host.isDestroyed()) return;
    await this.hydrateLoadedRange(start, end, gen);
  }

  private blockStart(blockIndex: number): number {
    return blockIndex * this.cacheBlockSize;
  }

  private loadBlock(blockIndex: number, gen: number, force = false): Promise<void> {
    if (this.pending.has(blockIndex)) {
      return this.waitUntil(() => !this.pending.has(blockIndex) || gen !== this.generation);
    }
    const ds = this.datasource;
    if (!ds) return Promise.resolve();

    const existing = this.blocks.get(blockIndex);
    if (existing?.state === 'loaded' && !force) {
      return Promise.resolve();
    }

    const startRow = this.blockStart(blockIndex);
    const endRow = startRow + this.cacheBlockSize;
    const preserved = existing?.rows ?? [];
    this.blocks.set(blockIndex, { startRow, rows: preserved, state: 'loading' });
    this.pending.add(blockIndex);

    const run = (): Promise<void> => new Promise<void>((resolve) => {
      if (gen !== this.generation || this.host.isDestroyed()) {
        this.pending.delete(blockIndex);
        resolve();
        return;
      }
      this.inflight++;
      ds.getRows({
        request: {
          startRow,
          endRow,
          sortModel: this.host.getSortModel(),
          filterModel: this.host.getFilterModel(),
          rowGroupCols: this.host.getRowGroupCols(),
          groupKeys: this.host.getGroupKeys(),
          expandedGroupKeys: this.host.getExpandedGroupKeys(),
        },
        success: (result: LoadSuccessParams<TRow>) => {
          this.inflight = Math.max(0, this.inflight - 1);
          this.pending.delete(blockIndex);
          if (gen !== this.generation || this.host.isDestroyed()) {
            resolve();
            return;
          }
          if (typeof result.rowCount === 'number' && Number.isFinite(result.rowCount)) {
            const prev = this.rowCount;
            this.rowCount = Math.max(0, result.rowCount);
            this.host.setRowCount(this.rowCount, prev);
            // A changed total means flattened indices moved (server-side
            // add/remove, or an expansion change that reached the server
            // outside refreshExpansion). Blocks loaded under the old total
            // would rehydrate stale rows at shifted offsets — drop them so
            // scroll refetches. Skip initial discovery (prev === 0) and
            // in-flight loads (issued against the current model; they land
            // under this generation with fresh data).
            if (prev > 0 && prev !== this.rowCount) {
              for (const [idx, blk] of this.blocks) {
                if (idx !== blockIndex && blk.state === 'loaded') {
                  this.blocks.delete(idx);
                }
              }
            }
          } else if (result.rowData.length > 0) {
            const prev = this.rowCount;
            this.rowCount = Math.max(this.rowCount, startRow + result.rowData.length);
            this.host.setRowCount(this.rowCount, prev);
          }
          if (result.groupKeys?.length) {
            this.host.mergeGroupKeys?.(result.groupKeys);
          }
          // Field-merge onto rows kept visible during reload.
          const prevRows = this.blocks.get(blockIndex)?.rows ?? preserved;
          const merged: TRow[] = result.rowData.slice();
          for (let i = 0; i < merged.length; i++) {
            const prev = prevRows[i] as Record<string, unknown> | undefined;
            const next = merged[i] as Record<string, unknown>;
            if (prev && next) merged[i] = { ...prev, ...next } as TRow;
          }
          // A window shorter than the (just-updated) rowCount implies the
          // server is still settling — cache it RETRYABLE ('failed'), not
          // 'loaded': a partially short mid-book block cached as 'loaded'
          // was never refetched, leaving a permanent blank band. When the
          // reply omits rowCount, a short window means end-of-book (the
          // count was inferred above) and stays 'loaded'.
          const expected = this.rowCount > 0
            ? Math.max(0, Math.min(this.cacheBlockSize, this.rowCount - startRow))
            : merged.length;
          this.blocks.set(blockIndex, {
            startRow,
            rows: merged.length > 0 ? merged : prevRows,
            state: merged.length >= expected ? 'loaded' : 'failed',
          });
          resolve();
        },
        fail: () => {
          this.inflight = Math.max(0, this.inflight - 1);
          this.pending.delete(blockIndex);
          this.blocks.set(blockIndex, { startRow, rows: preserved, state: 'failed' });
          resolve();
        },
      });
    });

    if (this.inflight >= this.maxConcurrent) {
      return this.waitUntil(() => this.inflight < this.maxConcurrent || gen !== this.generation)
        .then(run);
    }
    return run();
  }

  private async hydrateLoadedRange(rowStart: number, rowEnd: number, gen: number): Promise<void> {
    if (gen !== this.generation || this.host.isDestroyed()) return;

    let start = Math.max(0, rowStart);
    let end = Math.max(start, Math.ceil(rowEnd));

    // Zero-height panels often request an empty window; still hydrate block 0.
    if (end <= start) {
      if (this.rowCount <= 0) {
        // Try to discover size via whatever is already loaded.
        const b0 = this.blocks.get(0);
        if (b0?.state === 'loaded' && b0.rows.length > 0) {
          start = 0;
          end = b0.rows.length;
        } else {
          return;
        }
      } else {
        start = 0;
        end = Math.min(this.rowCount, this.cacheBlockSize);
      }
    }

    if (this.rowCount > 0) {
      end = Math.min(this.rowCount, end);
    }

    // Contiguous loaded runs only — skip gaps instead of aborting the
    // whole window, and never push an empty hydrate that races paint.
    let run: TRow[] = [];
    let runStart = start;
    const flush = async (): Promise<void> => {
      if (run.length === 0) return;
      await this.host.hydrateWindow(runStart, run, Math.max(this.rowCount, runStart + run.length), false);
      run = [];
    };
    for (let i = start; i < end; i++) {
      if (gen !== this.generation || this.host.isDestroyed()) return;
      const b = Math.floor(i / this.cacheBlockSize);
      const block = this.blocks.get(b);
      const local = block ? i - block.startRow : -1;
      const row = block && (block.state === 'loaded' || block.rows.length > 0)
        ? block.rows[local]
        : undefined;
      if (row === undefined) {
        await flush();
        runStart = i + 1;
        continue;
      }
      if (run.length === 0) runStart = i;
      run.push(row);
    }
    await flush();
  }

  private waitUntil(pred: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const tick = (): void => {
        if (pred()) resolve();
        else setTimeout(tick, 4);
      };
      tick();
    });
  }
}
