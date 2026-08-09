import type { SsrmGetRowsRequest, SsrmGetRowsResult } from '../types/provider';

function matchesFilter(row: Record<string, unknown>, filterModel: Record<string, unknown> | undefined): boolean {
  if (!filterModel || !Object.keys(filterModel).length) return true;
  for (const [colId, raw] of Object.entries(filterModel)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const val = row[colId];
    // Minimal text contains / equals support for hub SSRM demos.
    if (entry.filterType === 'text' || entry.type === 'text') {
      const q = String(entry.filter ?? entry.value ?? '').toLowerCase();
      const s = String(val ?? '').toLowerCase();
      const op = String(entry.type ?? entry.op ?? 'contains');
      if (op === 'equals' || op === 'equals') {
        if (s !== q) return false;
      } else if (!s.includes(q)) return false;
    }
  }
  return true;
}

function applySort(
  rows: Record<string, unknown>[],
  sortModel: SsrmGetRowsRequest['sortModel'],
): Record<string, unknown>[] {
  if (!sortModel?.length) return rows;
  const out = rows.slice();
  out.sort((a, b) => {
    for (const { colId, direction } of sortModel) {
      const av = a[colId];
      const bv = b[colId];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return out;
}

/** Window + filter/sort a cached book for SSRM getRows. */
export function pageCachedRows(
  all: Record<string, unknown>[],
  request: SsrmGetRowsRequest,
): SsrmGetRowsResult {
  let rows = all.filter((r) => matchesFilter(r, request.filterModel));
  rows = applySort(rows, request.sortModel);
  const start = Math.max(0, request.startRow);
  const end = Math.max(start, request.endRow);
  return { rowData: rows.slice(start, end), rowCount: rows.length };
}
