/**
 * Live column state — the durable home for column properties the USER changes
 * at runtime, as opposed to the ones the host declares in `columnDefs`.
 *
 * ## Why this exists
 *
 * `width`, `hide` and `pinned` are mutated in place on the RESOLVED column def
 * (`setColumnWidths`, `setColumnsVisible`, `setColumnsPinned`,
 * `applyColumnState`). The resolved tree is derived — every rebuild throws it
 * away and re-resolves from `options.columnDefs`, which never carried those
 * mutations. So the user's own changes lived only in a value that the next
 * rebuild was guaranteed to discard.
 *
 * Three separate workarounds grew up around that, none of them composing:
 *
 *  1. `rebuildColumns` salvaged `width` (and later `hide`/`pinned`) off the
 *     PREVIOUS tree and stamped it onto the new one.
 *  2. `ColumnStateManager.applyColumnState` applied the state, rebuilt, then
 *     applied it a SECOND time — the code comment records that without the
 *     second pass "the demo's Restore button needed two clicks".
 *  3. `PivotEngine` kept a private `primaryColumnTree` copy so it had
 *     something to restore, which then went stale on every rebuild.
 *
 * Each rescued the case its author needed and missed the others, which is why
 * fixing width did not fix `hide`, and fixing `hide` did not fix pivot.
 *
 * Making the state DURABLE and the tree DERIVED collapses all three: a rebuild
 * is just a re-resolve, and this is one of its inputs.
 *
 * ## What belongs here
 *
 * Only properties the user can change through a grid interaction and that the
 * host also declares in `columnDefs` — i.e. where "who wins?" is a real
 * question. Column ORDER is deliberately not here: reorders are written back
 * into `options.columnDefs` (see `rebuildColumnDefsByLeafOrder`), so the host
 * defs are already the source of truth for it.
 */

/** A column property that can be changed at runtime. */
export type LiveColumnKey = 'width' | 'hide' | 'pinned';

export interface LiveColumnEntry {
  width?: number;
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
}

/** Shape a resolved leaf must expose for {@link LiveColumnState.applyTo}. */
interface LeafLike {
  colId: string;
  width?: number;
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
}

export const LIVE_COLUMN_KEYS: readonly LiveColumnKey[] = ['width', 'hide', 'pinned'];

export class LiveColumnState {
  private byColId = new Map<string, LiveColumnEntry>();

  /**
   * Record a user change. Returns `true` when something actually moved, so
   * callers can skip event emission and repaints on a no-op.
   *
   * `undefined` values are ignored (nothing said about that property);
   * to clear a property back to the host's declared value use {@link clear}.
   */
  set(colId: string, patch: LiveColumnEntry): boolean {
    const prev = this.byColId.get(colId);
    let changed = false;
    const next: LiveColumnEntry = { ...prev };
    for (const key of LIVE_COLUMN_KEYS) {
      const v = patch[key];
      if (v === undefined) continue;
      if (prev?.[key] === v) continue;
      (next as Record<string, unknown>)[key] = v;
      changed = true;
    }
    if (!changed) return false;
    this.byColId.set(colId, next);
    return true;
  }

  get(colId: string): LiveColumnEntry | undefined {
    return this.byColId.get(colId);
  }

  has(colId: string): boolean {
    return this.byColId.has(colId);
  }

  /** Forget one property, or the whole column when no keys are given —
   *  the column then falls back to whatever the host/calc declare. */
  clear(colId: string, keys?: readonly LiveColumnKey[]): void {
    if (!keys) { this.byColId.delete(colId); return; }
    const entry = this.byColId.get(colId);
    if (!entry) return;
    for (const key of keys) delete entry[key];
    if (Object.keys(entry).length === 0) this.byColId.delete(colId);
  }

  /** Forget everything — `columnsReset` / a fresh columnDefs generation. */
  clearAll(): void {
    this.byColId.clear();
  }

  /**
   * Drop entries for columns that no longer exist.
   *
   * Without this a long-lived grid whose columns come and go (a provider
   * rebind, a pivot toggle) accumulates state for dead colIds forever, and —
   * worse — a colId that returns later silently inherits the state it had in
   * a previous life.
   */
  prune(liveColIds: Iterable<string>): void {
    const keep = liveColIds instanceof Set ? liveColIds : new Set(liveColIds);
    for (const colId of [...this.byColId.keys()]) {
      if (!keep.has(colId)) this.byColId.delete(colId);
    }
  }

  /**
   * Stamp the recorded state onto freshly resolved leaves.
   *
   * `skip` names properties another input has already claimed for a column —
   * an explicit calc override, or a host def whose value CHANGED since the
   * last resolve. Both are deliberate statements about that column and outrank
   * a remembered runtime value; a rebuild on its own is not.
   */
  applyTo(
    leaves: Iterable<LeafLike>,
    skip?: (colId: string, key: LiveColumnKey) => boolean,
  ): void {
    for (const leaf of leaves) {
      const entry = this.byColId.get(leaf.colId);
      if (entry === undefined) continue;
      for (const key of LIVE_COLUMN_KEYS) {
        const v = entry[key];
        if (v === undefined) continue;
        if (skip?.(leaf.colId, key)) continue;
        (leaf as unknown as Record<string, unknown>)[key] = v;
      }
    }
  }

  /** Plain snapshot for persistence / tests. */
  snapshot(): Record<string, LiveColumnEntry> {
    const out: Record<string, LiveColumnEntry> = {};
    for (const [colId, entry] of this.byColId) out[colId] = { ...entry };
    return out;
  }

  restore(snapshot: Record<string, LiveColumnEntry> | null | undefined): void {
    this.byColId.clear();
    for (const [colId, entry] of Object.entries(snapshot ?? {})) {
      if (entry && typeof entry === 'object') this.byColId.set(colId, { ...entry });
    }
  }

  get size(): number { return this.byColId.size; }
}
