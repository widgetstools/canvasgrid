/**
 * Convert VelocityGrid / ag-grid-compatible FilterModel entries into
 * Perspective View `filter` tuples (+ optional quick-filter haystack /
 * multi-OR contains ExprTK expressions).
 *
 * Perspective joins filter terms with AND by default. Set filters use `in`.
 * Quick filter uses a synthetic string-concat expression so OR-across-columns
 * composes cleanly with per-column AND filters. Multi-OR text `contains`
 * uses a boolean ExprTK column (`indexof` + capture groups).
 */
import type { FilterModel, FilterModelEntry } from '@wellsfargo-starui/velocity-grid';

/** Perspective filter term — scalar or `in`/`not in` array. */
export type PspFilterTerm = string | number | boolean | null | readonly (string | number | boolean | null)[];
export type PspFilter = [string, string, PspFilterTerm];

export const QUICK_FILTER_HAYSTACK_ALIAS = '__vg_qf_haystack';

/** Prefix for boolean ExprTK aliases that OR-match contains needles. */
export const OR_CONTAINS_ALIAS_PREFIX = '__vg_or_contains_';

export type OrContainsMatcher = {
  colId: string;
  needles: string[];
};

export type CgridFilterConversion = {
  filters: PspFilter[];
  /** Ephemeral ExprTK expressions to merge into the View. */
  expressions: Record<string, string>;
  /**
   * Client-side OR-contains predicates (alias → source col + needles).
   * Used to gate live tick patches — feed rows lack expression columns.
   */
  orContains: Record<string, OrContainsMatcher>;
};

function emptyConversion(): CgridFilterConversion {
  return { filters: [], expressions: {}, orContains: {} };
}

function mergeConversions(...parts: CgridFilterConversion[]): CgridFilterConversion {
  const out = emptyConversion();
  for (const p of parts) {
    out.filters.push(...p.filters);
    Object.assign(out.expressions, p.expressions);
    Object.assign(out.orContains, p.orContains);
  }
  return out;
}

function isLegacy(entry: FilterModelEntry): entry is Extract<FilterModelEntry, { type: 'text' | 'number' }> {
  return 'op' in entry && !('filterType' in entry);
}

function textOpToPsp(op: string): string {
  switch (op) {
    case 'equals': return '==';
    case 'notEqual': return '!=';
    case 'startsWith': return 'begins with';
    case 'endsWith': return 'ends with';
    case 'notContains': return 'not contains';
    case 'contains':
    default:
      return 'contains';
  }
}

function numberOpToPsp(op: string): string | null {
  switch (op) {
    case 'equals': return '==';
    case 'notEqual': return '!=';
    case 'greaterThan': return '>';
    case 'greaterThanOrEqual': return '>=';
    case 'lessThan': return '<';
    case 'lessThanOrEqual': return '<=';
    default: return null;
  }
}

/** Stable Perspective expression alias for OR-contains on `colId`. */
export function orContainsAlias(colId: string): string {
  const safe = colId.replace(/[^a-zA-Z0-9_]/g, '_');
  return `${OR_CONTAINS_ALIAS_PREFIX}${safe}`;
}

/** Escape a literal for Perspective's capture-group regex engine. */
export function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Boolean ExprTK: true when `colId` contains any needle (case-insensitive).
 * Uses `indexof` with a capture group — Perspective only matches captures.
 */
export function buildOrContainsExpression(colId: string, needles: string[]): string {
  const alias = orContainsAlias(colId);
  const parts = needles.map((n) => {
    const pat = escapeRegexLiteral(n.toLowerCase());
    return `(indexof(lower(string("${colId}")), '(${pat})', v) >= 0)`;
  });
  return `// ${alias}\nvar v[2] := {-1,-1};\n${parts.join(' or ')}`;
}

function filtersOnly(filters: PspFilter[]): CgridFilterConversion {
  return { filters, expressions: {}, orContains: {} };
}

/** Convert one leaf / multi / set entry into Perspective filters (+ exprs). */
export function entryToPspConversion(colId: string, entry: FilterModelEntry): CgridFilterConversion {
  if (!entry || typeof entry !== 'object') return emptyConversion();

  if (isLegacy(entry)) {
    if (entry.type === 'text') {
      const needle = String(entry.value ?? '');
      if (!needle) return emptyConversion();
      const op = entry.op === 'equals' ? '=='
        : entry.op === 'startsWith' ? 'begins with'
          : 'contains';
      return filtersOnly([[colId, op, needle]]);
    }
    if (entry.type === 'number') {
      if (entry.op === 'between' && entry.value2 != null) {
        return filtersOnly([
          [colId, '>=', entry.value],
          [colId, '<=', entry.value2],
        ]);
      }
      const op = entry.op === 'gt' ? '>' : entry.op === 'lt' ? '<' : '==';
      return filtersOnly([[colId, op, entry.value]]);
    }
    return emptyConversion();
  }

  const e = entry as unknown as Record<string, unknown>;
  const filterType = String(e.filterType ?? '');

  if (filterType === 'set') {
    const values = Array.isArray(e.values) ? (e.values as unknown[]).map((v) => String(v)) : [];
    // Empty set usually means the set-filter popup had no distinct values
    // (sparse SSRM) and Apply was pressed — treat as no filter rather than
    // match-nothing, which zeroes the blotter (Total Rows: 0).
    if (values.length === 0) return emptyConversion();
    if (values.length === 1) return filtersOnly([[colId, '==', values[0]!]]);
    return filtersOnly([[colId, 'in', values]]);
  }

  if (filterType === 'multi') {
    const operator = e.operator === 'OR' ? 'OR' : 'AND';
    const conditions = Array.isArray(e.conditions) ? e.conditions as FilterModelEntry[] : [];
    if (conditions.length === 0) return emptyConversion();

    if (operator === 'AND') {
      return mergeConversions(...conditions.map((c) => entryToPspConversion(colId, c)));
    }

    // OR — collapse equals leaves into a single `in` when possible.
    const equalsValues: string[] = [];
    const numberEquals: number[] = [];
    const containsNeedles: string[] = [];
    let allEquals = true;
    let allContains = true;
    for (const c of conditions) {
      if (!c || typeof c !== 'object') { allEquals = false; allContains = false; break; }
      const leaf = c as Record<string, unknown>;
      if (leaf.filterType === 'text' && leaf.type === 'equals') {
        allContains = false;
        equalsValues.push(String(leaf.filter ?? ''));
      } else if (leaf.filterType === 'text' && leaf.type === 'contains') {
        allEquals = false;
        containsNeedles.push(String(leaf.filter ?? ''));
      } else if (leaf.filterType === 'number' && leaf.type === 'equals') {
        allContains = false;
        const n = Number(leaf.filter);
        if (!Number.isFinite(n)) { allEquals = false; allContains = false; break; }
        numberEquals.push(n);
      } else if (leaf.filterType === 'date' && leaf.type === 'equals') {
        allContains = false;
        equalsValues.push(String(leaf.filter ?? ''));
      } else {
        allEquals = false;
        allContains = false;
        break;
      }
    }
    if (allEquals && numberEquals.length === conditions.length) {
      return filtersOnly(numberEquals.length === 1
        ? [[colId, '==', numberEquals[0]!]]
        : [[colId, 'in', numberEquals]]);
    }
    if (allEquals && equalsValues.length === conditions.length) {
      const nonempty = equalsValues.filter((v) => v !== '');
      if (nonempty.length === 0) return emptyConversion();
      return filtersOnly(nonempty.length === 1
        ? [[colId, '==', nonempty[0]!]]
        : [[colId, 'in', nonempty]]);
    }
    // OR of contains — true substring match via boolean ExprTK column.
    if (allContains && containsNeedles.length === conditions.length) {
      const nonempty = containsNeedles.filter((v) => v !== '');
      if (nonempty.length === 0) return emptyConversion();
      if (nonempty.length === 1) return filtersOnly([[colId, 'contains', nonempty[0]!]]);
      const alias = orContainsAlias(colId);
      return {
        filters: [[alias, '==', true]],
        expressions: {
          [alias]: buildOrContainsExpression(colId, nonempty),
        },
        orContains: { [alias]: { colId, needles: nonempty } },
      };
    }

    // Fallback: take the first condition only (better than inventing `in`
    // from mixed operators).
    return entryToPspConversion(colId, conditions[0]!);
  }

  if (filterType === 'text' || (typeof e.filter === 'string' && !filterType)) {
    const op = String(e.type ?? 'contains');
    if (op === 'blank') return filtersOnly([[colId, 'is null', null]]);
    if (op === 'notBlank') return filtersOnly([[colId, 'is not null', null]]);
    const needle = String(e.filter ?? '');
    if (!needle && op !== 'blank' && op !== 'notBlank') return emptyConversion();
    return filtersOnly([[colId, textOpToPsp(op), needle]]);
  }

  if (filterType === 'number' || typeof e.filter === 'number') {
    const op = String(e.type ?? 'equals');
    if (op === 'blank') return filtersOnly([[colId, 'is null', null]]);
    if (op === 'notBlank') return filtersOnly([[colId, 'is not null', null]]);
    if (op === 'inRange') {
      const lo = Number(e.filter);
      const hi = Number(e.filterTo);
      const out: PspFilter[] = [];
      if (Number.isFinite(lo)) out.push([colId, '>=', lo]);
      if (Number.isFinite(hi)) out.push([colId, '<=', hi]);
      return filtersOnly(out);
    }
    const n = Number(e.filter);
    if (!Number.isFinite(n)) return emptyConversion();
    const pspOp = numberOpToPsp(op) ?? '==';
    return filtersOnly([[colId, pspOp, n]]);
  }

  if (filterType === 'date') {
    const op = String(e.type ?? 'equals');
    if (op === 'blank') return filtersOnly([[colId, 'is null', null]]);
    if (op === 'notBlank') return filtersOnly([[colId, 'is not null', null]]);
    if (op === 'inRange') {
      const lo = String(e.filter ?? '');
      const hi = String(e.filterTo ?? '');
      const out: PspFilter[] = [];
      if (lo) out.push([colId, '>=', lo]);
      if (hi) out.push([colId, '<=', hi]);
      return filtersOnly(out);
    }
    const v = String(e.filter ?? '');
    if (!v) return emptyConversion();
    const pspOp = numberOpToPsp(op) ?? '==';
    return filtersOnly([[colId, pspOp, v]]);
  }

  return emptyConversion();
}

/** Convert one entry into Perspective filter triples (expressions discarded). */
export function entryToPspFilters(colId: string, entry: FilterModelEntry): PspFilter[] {
  return entryToPspConversion(colId, entry).filters;
}

/** Build ExprTK expression that concatenates column string forms for quick filter. */
export function buildQuickFilterHaystackExpression(columns: readonly string[]): string {
  const usable = columns.filter((c) => c && c !== QUICK_FILTER_HAYSTACK_ALIAS);
  if (usable.length === 0) return `// ${QUICK_FILTER_HAYSTACK_ALIAS}\n''`;
  const parts = usable.map((c) => `string("${c}")`);
  return `// ${QUICK_FILTER_HAYSTACK_ALIAS}\n${parts.join(" + ' ' + ")}`;
}

/**
 * Convert a full grid FilterModel (+ optional quick-filter text) into
 * Perspective View filters and ephemeral expressions.
 */
export function cgridFilterToPsp(
  filterModel: FilterModel,
  opts?: {
    quickFilterText?: string;
    /** Columns included in the quick-filter haystack (schema fields). */
    quickFilterColumns?: readonly string[];
  },
): CgridFilterConversion {
  const parts: CgridFilterConversion[] = [];
  for (const [colId, entry] of Object.entries(filterModel ?? {})) {
    if (!entry) continue;
    parts.push(entryToPspConversion(colId, entry as FilterModelEntry));
  }

  const expressions: Record<string, string> = {};
  const filters: PspFilter[] = [];
  const orContains: Record<string, OrContainsMatcher> = {};
  for (const p of parts) {
    filters.push(...p.filters);
    Object.assign(expressions, p.expressions);
    Object.assign(orContains, p.orContains);
  }

  const raw = (opts?.quickFilterText ?? '').trim();
  if (raw) {
    const terms = raw.split(/\s+/).filter(Boolean);
    const cols = opts?.quickFilterColumns ?? [];
    if (terms.length > 0 && cols.length > 0) {
      expressions[QUICK_FILTER_HAYSTACK_ALIAS] = buildQuickFilterHaystackExpression(cols);
      for (const term of terms) {
        filters.push([QUICK_FILTER_HAYSTACK_ALIAS, 'contains', term]);
      }
    }
  }

  return { filters, expressions, orContains };
}

/** Map VelocityGrid / AG aggFunc names onto Perspective aggregate ops. */
export function mapAggFuncToPerspective(aggFunc: string): string {
  switch (String(aggFunc ?? '').toLowerCase()) {
    case 'sum': return 'sum';
    case 'avg':
    case 'average':
    case 'mean': return 'avg';
    case 'min': return 'min';
    case 'max': return 'max';
    case 'count': return 'count';
    case 'first': return 'first';
    case 'last': return 'last';
    case 'median': return 'median';
    case 'unique': return 'unique';
    case 'dominant': return 'dominant';
    default: return 'sum';
  }
}
