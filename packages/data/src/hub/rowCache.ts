import type { PipelineConfig } from '../types/pipeline';

export function composeRowId(
  row: Record<string, unknown>,
  keyColumn: string | readonly string[] | undefined,
): string | null {
  if (keyColumn == null) return null;
  if (typeof keyColumn === 'string') {
    const v = row[keyColumn];
    return v == null ? null : String(v);
  }
  if (keyColumn.length === 0) return null;
  // Composite key: return null if any part is nullish; join with space separator for unambiguous distinction
  const parts: string[] = [];
  for (const k of keyColumn) {
    const v = row[k];
    if (v == null) return null;
    parts.push(String(v));
  }
  return parts.join(' ');
}

export class RowCache {
  private order: string[] = [];
  private byId = new Map<string, Record<string, unknown>>();
  private keyColumn: string | readonly string[] | undefined;

  setKeyColumn(key: string | readonly string[] | undefined): void {
    this.keyColumn = key;
  }

  get size(): number {
    return this.byId.size;
  }

  clear(): void {
    this.order = [];
    this.byId.clear();
  }

  /** Full replace. */
  replace(rows: readonly unknown[]): void {
    this.clear();
    this.upsert(rows);
  }

  /** Keyed upsert; appends new keys in arrival order. */
  upsert(rows: readonly unknown[]): Record<string, unknown>[] {
    const touched: Record<string, unknown>[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const id = composeRowId(row, this.keyColumn);
      if (id == null) continue;
      const prev = this.byId.get(id);
      const next = prev ? { ...prev, ...row } : { ...row };
      if (!this.byId.has(id)) this.order.push(id);
      this.byId.set(id, next);
      touched.push(next);
    }
    return touched;
  }

  /** Drop rows by id; returns the ids that were actually present. */
  remove(ids: readonly string[]): string[] {
    const removed: string[] = [];
    for (const id of ids) {
      if (this.byId.delete(id)) removed.push(id);
    }
    if (removed.length) {
      const drop = new Set(removed);
      this.order = this.order.filter((id) => !drop.has(id));
    }
    return removed;
  }

  get(id: string): Record<string, unknown> | undefined {
    return this.byId.get(id);
  }

  getAll(): Record<string, unknown>[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  getPage(startRow: number, endRow: number): { rowData: Record<string, unknown>[]; rowCount: number } {
    const all = this.getAll();
    const start = Math.max(0, startRow);
    const end = Math.max(start, endRow);
    return { rowData: all.slice(start, end), rowCount: all.length };
  }
}

/** Trailing-edge throttle + optional key conflation for live ticks. */
export class LivePipeline {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, Record<string, unknown>>();
  private pendingList: Record<string, unknown>[] = [];

  constructor(
    private readonly cfg: PipelineConfig,
    private readonly flush: (rows: Record<string, unknown>[]) => void,
  ) {}

  push(rows: readonly unknown[]): void {
    const throttleOn = this.cfg.throttleEnabled !== false && (this.cfg.throttleMs ?? 0) > 0;
    const conflateOn = this.cfg.conflateEnabled !== false;
    const conflateKey = this.cfg.conflateByKey
      ?? (typeof this.cfg.keyColumn === 'string' ? this.cfg.keyColumn : undefined);

    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      if (conflateOn && conflateKey) {
        const id = String(row[conflateKey] ?? '');
        if (id) this.pending.set(id, { ...this.pending.get(id), ...row });
        else this.pendingList.push(row);
      } else {
        this.pendingList.push(row);
      }
    }

    if (!throttleOn) {
      this.drain();
      return;
    }
    if (this.timer != null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, this.cfg.throttleMs!);
  }

  private drain(): void {
    const rows = [...this.pending.values(), ...this.pendingList];
    this.pending.clear();
    this.pendingList = [];
    if (rows.length) this.flush(rows);
  }

  destroy(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.pendingList = [];
  }
}
