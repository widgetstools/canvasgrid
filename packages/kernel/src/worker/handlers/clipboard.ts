// Cycle 19 / Task 6 — clipboard handler.
//
// Owns the clipboard serialize / deserialize slice of the worker
// protocol:
//   clipboardDeserialize, clipboardSerialize.

import type { HandlerCtx } from '../dispatch';
import type { WorkerRequest } from '../protocol';
import { serializeRanges, deserializeTsv } from '../passes/clipboardPass';
import { buildVisibleIndexResolver } from '../visibleIndexResolver';

export type ClipboardRequest = Extract<WorkerRequest, {
  type: 'clipboardDeserialize' | 'clipboardSerialize';
}>;

export async function handleClipboard(
  ctx: HandlerCtx,
  req: ClipboardRequest,
): Promise<void> {
  const { state, post } = ctx;
  switch (req.type) {
    case 'clipboardDeserialize': {
      // Cycle 10 / Task 4 — TSV / CSV parse off the main thread.
      const { text, delimiter } = req.payload;
      const rows = deserializeTsv(text, delimiter);
      post({ id: req.id, type: 'clipboardDeserializeResult', rows });
      return;
    }

    case 'clipboardSerialize': {
      // Cycle 10 / Task 3 — TSV / CSV encode the supplied ranges off
      // the main thread.
      // Production hardening (Task 2 / A-C1) — `range.rowStart..rowEnd`
      // is expressed in the same GROUP-VISIBLE index space the main
      // thread's selection model uses; resolve through the shared
      // grouping-aware resolver instead of the flat leaf array.
      const { ranges, delimiter } = req.payload;
      const resolver = await buildVisibleIndexResolver(ctx);
      const rows: Array<Record<string, unknown> | undefined> = [];
      for (const r of ranges) {
        const end = Math.min(r.rowEnd, resolver.length - 1);
        for (let i = r.rowStart; i <= end; i++) {
          if (i < 0) continue;
          if (rows[i] !== undefined) continue;
          const rowId = resolver.leafIdAt(i);
          if (rowId === null) continue; // group-header slot — blank cell.
          const data = state.store.getById(rowId);
          if (data !== undefined) rows[i] = data as Record<string, unknown>;
        }
      }
      const colsById = new Map<string, { field?: string }>();
      for (const c of state.columns) colsById.set(c.colId, { field: c.field });
      const tsv = serializeRanges(rows, colsById, ranges, delimiter);
      post({ id: req.id, type: 'clipboardSerializeResult', tsv });
      return;
    }
  }
}
