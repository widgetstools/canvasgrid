// Cycle 19 / Task 6 — pivot handler.
//
// Owns the pivot model + runtime option flip slice of the worker
// protocol:
//   setStrictPivotColumnOrder, setPivotMaxGeneratedColumns, setPivotModel.

import type { HandlerCtx } from '../dispatch';
import type { WorkerRequest } from '../protocol';
import type { PivotModel } from '../passes/pivotPass';

export type PivotRequest = Extract<WorkerRequest, {
  type:
    | 'setStrictPivotColumnOrder'
    | 'setPivotMaxGeneratedColumns'
    | 'setPivotModel';
}>;

export async function handlePivot(
  ctx: HandlerCtx,
  req: PivotRequest,
): Promise<void> {
  const { state, post, helpers } = ctx;
  switch (req.type) {
    case 'setStrictPivotColumnOrder': {
      // Cycle 18 / Task 8c — push the strict-order flag into the
      // PivotPass. Cycle 18 / Task 8d — PivotPass now runs inside
      // `buildVisibleAsync`; invalidate the visible cache so the next
      // viewport rebuilds with the new flag.
      state.pivot.setStrictPivotColumnOrder(req.payload === true);
      const vc = await helpers.invalidateAndCount();
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: vc });
      return;
    }

    case 'setPivotMaxGeneratedColumns': {
      // Cycle 18 / Task 8a — push the cap into PivotPass.
      state.pivot.setMaxGeneratedColumns(req.payload as number | undefined);
      const vc = await helpers.invalidateAndCount();
      post({
        id: req.id,
        type: 'rowCount',
        count: state.store.size(),
        visibleCount: vc,
      });
      return;
    }

    case 'setPivotModel': {
      // Cycle 18 / Task 3 — install / replace the pivot model.
      try {
        state.pivot.setModel(req.payload as PivotModel);
      } catch (err) {
        post({ id: req.id, type: 'error', error: String((err as Error).message ?? err) });
        return;
      }
      post({
        id: req.id,
        type: 'rowCount',
        count: state.store.size(),
        visibleCount: await helpers.invalidateAndCount(),
      });
      return;
    }
  }
}
