// Cycle 19 / Task 6 — clipboard handler.
//
// Owns the clipboard serialize / deserialize slice of the worker
// protocol:
//   clipboardDeserialize, clipboardSerialize.

import type { HandlerCtx } from '../dispatch';
import type { WorkerRequest } from '../protocol';
import { serializeRanges, deserializeTsv } from '../passes/clipboardPass';

export type ClipboardRequest = Extract<WorkerRequest, {
  type: 'clipboardDeserialize' | 'clipboardSerialize';
}>;

export async function handleClipboard(
  ctx: HandlerCtx,
  req: ClipboardRequest,
): Promise<void> {
  const { state, post, helpers } = ctx;
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
      const { ranges, delimiter } = req.payload;
      const visIds = await helpers.visibleAsync();
      const rows: Array<Record<string, unknown> | undefined> = [];
      for (const r of ranges) {
        const end = Math.min(r.rowEnd, visIds.length - 1);
        for (let i = r.rowStart; i <= end; i++) {
          if (i < 0) continue;
          if (rows[i] !== undefined) continue;
          const rowId = visIds[i];
          if (rowId === undefined) continue;
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
