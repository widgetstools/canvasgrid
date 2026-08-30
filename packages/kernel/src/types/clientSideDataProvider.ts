/**
 * Client-side data provider — the CSRM counterpart to
 * {@link import('./ssrm').IServerSideDatasourceV2}.
 *
 * A server-side grid is handed a datasource and the grid drives it. A
 * client-side grid had no equivalent: apps either called `setRowData` /
 * `applyTransactionAsync` imperatively, or wired an external binding helper.
 * This is the symmetric option — hand the grid a live row source and it owns
 * the subscription for its lifetime.
 *
 * Deliberately smaller than a full provider abstraction (no column defs, no
 * status/error channel, no start/stop, no config): those are transport
 * concerns that belong to whoever owns the connection, and pulling them in
 * here would drag transport-shaped types into the kernel's public surface.
 * This interface is row flow, nothing else — like the SSRM datasource
 * contract, it is a plain interface with no imports, so any package (or an
 * app's own object literal) can satisfy it structurally.
 *
 * **Throttling is the grid's, not the provider's.** Deltas land through the
 * same `applyTransactionAsync` path as every other caller, so
 * `asyncTransactionWaitMillis`, `asyncTransactionConflate`,
 * `asyncTransactionThrottleMillis` and `deferAsyncTransactionsWhileScrolling`
 * apply unchanged. A provider that also throttles upstream (e.g. a
 * SharedWorker hub pipeline) stacks with — rather than replaces — these.
 */

/** Incremental change set. Every field is optional; an empty delta is a no-op. */
export interface IClientSideDataProviderDelta<TRow = any> {
  add?: TRow[];
  update?: TRow[];
  /**
   * Row IDS to remove — in the `getRowId` domain, not row objects.
   *
   * Sources classify a removal after dropping the row from their own cache,
   * so the full object is typically no longer available at that point. The
   * grid resolves each id against its own row mirror; ids it never saw are
   * skipped.
   */
  removeIds?: string[];
}

export interface IClientSideDataProvider<TRow = any> {
  /**
   * Rows held right now. Read once at install so a grid attaching to an
   * already-warm provider paints immediately instead of waiting for the next
   * snapshot. Return an empty array when nothing has arrived yet.
   */
  getSnapshot(): readonly TRow[];
  /**
   * Full-replace subscription (initial load, reconnect, resync). Each emission
   * replaces the grid's entire row set. Returns an unsubscribe function.
   */
  onSnapshot(handler: (rows: readonly TRow[]) => void): () => void;
  /**
   * Incremental subscription. Optional — a provider that can only do full
   * replaces omits it, and the grid then relies on {@link onSnapshot} alone.
   * Returns an unsubscribe function.
   */
  onDelta?(handler: (delta: IClientSideDataProviderDelta<TRow>) => void): () => void;
}
