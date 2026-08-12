/**
 * CSRM pipeline passes — Filter → QuickFilter → Sort.
 * (Group → Pivot → Agg land in Phase 5; order documented here.)
 */
import type { ColDef, FilterModel, FilterModelEntry, SortModel } from '../types/options';

export type PipelineRow = Record<string, unknown>;

export function runCsrmPipeline<T extends PipelineRow>(opts: {
  rows: T[];
  filterModel: FilterModel;
  quickFilterText: string;
  sortModel: SortModel;
  columns: ColDef<T>[];
}): T[] {
  let rows = opts.rows;
  rows = applyFilterPass(rows, opts.filterModel);
  rows = applyQuickFilterPass(rows, opts.quickFilterText, opts.columns);
  rows = applySortPass(rows, opts.sortModel);
  return rows;
}

export function applyFilterPass<T extends PipelineRow>(
  rows: T[],
  filterModel: FilterModel,
): T[] {
  const entries = Object.entries(filterModel);
  if (entries.length === 0) return rows;
  return rows.filter((row) => entries.every(([colId, f]) => matchFilter(row[colId], f)));
}

function matchFilter(raw: unknown, f: FilterModelEntry): boolean {
  if (f.filterType === 'text') {
    const s = String(raw ?? '').toLowerCase();
    const needle = String(f.filter ?? '').toLowerCase();
    switch (f.type) {
      case 'contains': return !needle || s.includes(needle);
      case 'notContains': return !needle || !s.includes(needle);
      case 'equals': return s === needle;
      case 'notEqual': return s !== needle;
      case 'startsWith': return !needle || s.startsWith(needle);
      case 'endsWith': return !needle || s.endsWith(needle);
      case 'blank': return s === '';
      case 'notBlank': return s !== '';
      default: return true;
    }
  }
  if (f.filterType === 'number') {
    const n = Number(raw);
    const v = Number(f.filter);
    const v2 = f.filterTo != null ? Number(f.filterTo) : NaN;
    if (Number.isNaN(n) && f.type !== 'blank') return false;
    switch (f.type) {
      case 'equals': return n === v;
      case 'notEqual': return n !== v;
      case 'greaterThan': return n > v;
      case 'greaterThanOrEqual': return n >= v;
      case 'lessThan': return n < v;
      case 'lessThanOrEqual': return n <= v;
      case 'inRange': return n >= v && n <= v2;
      case 'blank': return raw == null || raw === '';
      case 'notBlank': return raw != null && raw !== '';
      default: return true;
    }
  }
  if (f.filterType === 'set') {
    return f.values.map(String).includes(String(raw ?? ''));
  }
  return true;
}

export function applyQuickFilterPass<T extends PipelineRow>(
  rows: T[],
  text: string,
  columns: ColDef<T>[],
): T[] {
  const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  const fields = columns.map((c) => c.field ?? c.colId).filter(Boolean) as string[];
  return rows.filter((row) => {
    const hay = fields.map((f) => String(row[f] ?? '')).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function applySortPass<T extends PipelineRow>(rows: T[], sortModel: SortModel): T[] {
  if (sortModel.length === 0) return rows;
  const model = sortModel;
  return rows.slice().sort((a, b) => {
    for (const s of model) {
      const av = a[s.colId];
      const bv = b[s.colId];
      let cmp = 0;
      if (av == null && bv == null) cmp = 0;
      else if (av == null) cmp = -1;
      else if (bv == null) cmp = 1;
      else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return s.direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}
