import type { ColumnDefinition } from '../types';

const EXPORT_KIND = 'starui.columnDefs';

const VALID_CELL_TYPES = new Set([
  'text', 'number', 'boolean', 'date', 'dateString', 'object',
]);

export function serializeColumnDefs(columns: readonly ColumnDefinition[]): string {
  return JSON.stringify(structuredClone(columns as ColumnDefinition[]), null, 2);
}

export function exportColumnDefs(columns: readonly ColumnDefinition[]): void {
  const json = serializeColumnDefs(columns);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'starui-column-defs.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function sanitizeColumnDef(raw: Record<string, unknown>): ColumnDefinition | null {
  const field = typeof raw.field === 'string' ? raw.field.trim() : '';
  if (!field) return null;
  const out: ColumnDefinition = {
    field,
    headerName:
      typeof raw.headerName === 'string' && raw.headerName.trim() ? raw.headerName : field,
  };
  if (
    typeof raw.cellDataType === 'string'
    && VALID_CELL_TYPES.has(raw.cellDataType)
  ) {
    // Map Markets dateString → our date when needed.
    const t = raw.cellDataType === 'dateString' || raw.cellDataType === 'object'
      ? (raw.cellDataType === 'dateString' ? 'date' : 'text')
      : raw.cellDataType;
    out.cellDataType = t as ColumnDefinition['cellDataType'];
  }
  if (typeof raw.width === 'number' && Number.isFinite(raw.width)) out.width = raw.width;
  if (typeof raw.filter === 'boolean') out.filter = raw.filter;
  if (typeof raw.sortable === 'boolean') out.sortable = raw.sortable;
  if (typeof raw.resizable === 'boolean') out.resizable = raw.resizable;
  if (typeof raw.hide === 'boolean') out.hide = raw.hide;
  if (typeof raw.valueGetter === 'string' && raw.valueGetter.trim()) {
    out.valueGetter = raw.valueGetter;
  }
  // Capability flags. This sanitizer is an ALLOW-LIST, so anything missing
  // here is silently dropped on import — which would quietly discard an
  // author's explicit `enablePivot: false` and hand the column back to the
  // type heuristic.
  if (typeof raw.enableRowGroup === 'boolean') out.enableRowGroup = raw.enableRowGroup;
  if (typeof raw.enablePivot === 'boolean') out.enablePivot = raw.enablePivot;
  if (typeof raw.enableValue === 'boolean') out.enableValue = raw.enableValue;
  if (typeof raw.aggFunc === 'string' && raw.aggFunc.trim()) out.aggFunc = raw.aggFunc.trim();
  return out;
}

export function parseColumnDefsImport(text: string): ColumnDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  const rawColumns: unknown = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.columns)
      ? parsed.columns
      : null;
  if (!rawColumns) {
    throw new Error('File does not contain a column-definitions array.');
  }
  const columns: ColumnDefinition[] = [];
  for (const item of rawColumns as unknown[]) {
    if (!isRecord(item)) continue;
    const def = sanitizeColumnDef(item);
    if (def) columns.push(def);
  }
  if (columns.length === 0) {
    throw new Error('No valid columns found — each entry needs a "field".');
  }
  return columns;
}

export { EXPORT_KIND };
