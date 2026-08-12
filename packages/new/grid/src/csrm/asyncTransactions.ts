/**
 * Async transaction queue with conflation + scroll-defer
 * (Markets / legacy VelocityGrid contract).
 */

export type Tx<T> = {
  add?: T[];
  update?: T[];
  remove?: Array<string | T>;
};

export type AsyncTxOptions<T> = {
  conflate?: boolean;
  deferWhileScrolling?: boolean;
  waitMillis?: number;
  getRowId: (row: T) => string;
  apply: (tx: Tx<T>) => void;
  isScrolling: () => boolean;
};

export class AsyncTransactionQueue<T> {
  private pending: Tx<T>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scrollArmed = false;

  constructor(private readonly opts: AsyncTxOptions<T>) {}

  enqueue(tx: Tx<T>): void {
    this.pending.push(tx);
    if (this.opts.deferWhileScrolling && this.opts.isScrolling()) {
      this.scrollArmed = true;
      return;
    }
    this.schedule();
  }

  /** Call on bodyScrollEnd so deferred txs flush. */
  onScrollEnd(): void {
    if (!this.scrollArmed && this.pending.length === 0) return;
    this.scrollArmed = false;
    this.flush();
  }

  private schedule(): void {
    if (this.timer != null) return;
    const wait = Math.max(0, this.opts.waitMillis ?? 50);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.opts.deferWhileScrolling && this.opts.isScrolling()) {
        this.scrollArmed = true;
        return;
      }
      this.flush();
    }, wait);
  }

  flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    const tx = this.opts.conflate !== false ? conflate(batch, this.opts.getRowId) : mergeSequential(batch);
    this.opts.apply(tx);
  }

  destroy(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.pending = [];
  }
}

function mergeSequential<T>(batch: Tx<T>[]): Tx<T> {
  const out: Tx<T> = { add: [], update: [], remove: [] };
  for (const tx of batch) {
    if (tx.add) out.add!.push(...tx.add);
    if (tx.update) out.update!.push(...tx.update);
    if (tx.remove) out.remove!.push(...tx.remove);
  }
  return out;
}

/** Last write wins per row id across update/add; removes win. */
function conflate<T>(batch: Tx<T>[], getRowId: (row: T) => string): Tx<T> {
  const removed = new Set<string>();
  const byId = new Map<string, T>();
  const adds: T[] = [];

  for (const tx of batch) {
    for (const r of tx.remove ?? []) {
      const id = typeof r === 'string' ? r : getRowId(r);
      removed.add(id);
      byId.delete(id);
    }
    for (const row of tx.update ?? []) {
      const id = getRowId(row);
      if (removed.has(id)) continue;
      byId.set(id, row);
    }
    for (const row of tx.add ?? []) {
      const id = getRowId(row);
      removed.delete(id);
      byId.set(id, row);
      adds.push(row);
    }
  }

  // Prefer update map; adds that weren't later updated stay as add
  const updates = [...byId.values()].filter((r) => !adds.some((a) => getRowId(a) === getRowId(r)));
  const finalAdds = adds.filter((a) => byId.get(getRowId(a)) === a && !removed.has(getRowId(a)));

  return {
    add: finalAdds.length ? finalAdds : undefined,
    update: updates.length ? updates : undefined,
    remove: removed.size ? [...removed] : undefined,
  };
}

export { conflate as conflateTransactions };
