// Cycle 19 / Task 6 — group handler.
//
// Owns the grouping model + expanded-keys + descendant emission slice
// of the worker protocol:
//   setGroupModel, setExpandedKeys, setEmitGroupDescendants.

import type { HandlerCtx } from '../dispatch';
import type { WorkerRequest } from '../protocol';

export type GroupRequest = Extract<WorkerRequest, {
  type:
    | 'setGroupModel'
    | 'setExpandedKeys'
    | 'setEmitGroupDescendants';
}>;

export async function handleGroup(
  ctx: HandlerCtx,
  req: GroupRequest,
): Promise<void> {
  const { state, post, helpers } = ctx;
  switch (req.type) {
    case 'setGroupModel': {
      // Race fix (HIGH) — a rebuild already in flight (external-filter /
      // postSortRows round-trip) reads `state.group` on both sides of an
      // `await`; mutating it here first would let that resume into a
      // hybrid stale/fresh pass. See `awaitPipelineIdle`'s doc.
      await helpers.awaitPipelineIdle();
      // Cycle 15 / Task 1 — replace the group model; reject
      // unknown / duplicate colIds at the set-site so malformed input
      // surfaces as an `error` envelope instead of a silently broken
      // tree.
      try {
        state.group.setModel(req.payload);
      } catch (err) {
        post({ id: req.id, type: 'error', error: String((err as Error).message ?? err) });
        return;
      }
      // Cycle 15 / Task 7 — reset to the "default = all expanded"
      // sentinel before the pipeline runs; Task 9 below re-seeds the
      // explicit set off the freshly-built tree when configured.
      state.expandedKeys = null;
      state.visibleCache = null;
      state.visibleCachePromise = null;
      // Build the visible cache (populates `groupOutput`) before we ask
      // GroupPass to compute the default expansion.
      const visibleCount0 = await helpers.invalidateAndCount();
      // Cycle 15 / Task 9 — seed `state.expandedKeys` from the
      // default-expansion rule.
      const groupRoots = state.groupOutput?.roots ?? [];
      const defaultExpandedKeys = state.group.computeDefaultExpandedKeys(groupRoots);
      // AG parity 2026-07-21 — an empty tree means data hasn't arrived
      // yet; the first non-empty build re-seeds (see buildVisibleAsync).
      state.pendingDefaultExpandSeed =
        req.payload.rowGroupCols.length > 0 && groupRoots.length === 0;
      let visibleCount = visibleCount0;
      if (defaultExpandedKeys !== null) {
        state.expandedKeys = defaultExpandedKeys;
        visibleCount = await helpers.invalidateAndCount();
      }
      post({
        id: req.id,
        type: 'groupKeysSnapshot',
        count: state.store.size(),
        visibleCount,
        groupKeys: helpers.currentGroupKeys(),
        groupDescendants: state.emitGroupDescendants
          ? helpers.collectGroupDescendantRowIds()
          : undefined,
        // Cycle 15 / Task 9 — ship the materialised set when the
        // default-expansion rule resolves to anything other than the
        // all-expanded sentinel; `null` means "default-all sentinel".
        expandedKeys: defaultExpandedKeys === null ? null : Array.from(defaultExpandedKeys),
      });
      return;
    }

    case 'setExpandedKeys': {
      const payload = req.payload;
      const isToggle = 'toggle' in payload;
      if (isToggle) {
        // Delta. Main only sends this once it holds an explicit set, so the
        // all-expanded sentinel is never resolved on two sides independently.
        const set = state.expandedKeys ?? new Set(helpers.currentGroupKeys());
        if (payload.toggle.expanded) set.add(payload.toggle.key);
        else set.delete(payload.toggle.key);
        state.expandedKeys = set;
      } else {
        state.expandedKeys = payload.keys === null ? null : new Set(payload.keys);
      }
      // Expansion changes neither the data nor the tree, so the pipeline
      // result still stands — only the flat order needs re-counting.
      const visibleCount = await helpers.countAfterExpansionChange();
      post({
        id: req.id,
        type: 'groupKeysSnapshot',
        count: state.store.size(),
        visibleCount,
        // A toggle changes which rows are VISIBLE, never the tree, so the
        // caller's key list and descendant map are still current.
        groupKeys: isToggle ? undefined : helpers.currentGroupKeys(),
        groupDescendants: !isToggle && state.emitGroupDescendants
          ? helpers.collectGroupDescendantRowIds()
          : undefined,
      });
      return;
    }

    case 'setEmitGroupDescendants': {
      // Cycle 15 / Task 8 — toggle the descendant-shipment flag.
      state.emitGroupDescendants = req.payload.enabled;
      post({
        id: req.id,
        type: 'groupKeysSnapshot',
        count: state.store.size(),
        visibleCount: await helpers.invalidateAndCount(),
        groupKeys: helpers.currentGroupKeys(),
        groupDescendants: state.emitGroupDescendants
          ? helpers.collectGroupDescendantRowIds()
          : undefined,
      });
      return;
    }
  }
}
