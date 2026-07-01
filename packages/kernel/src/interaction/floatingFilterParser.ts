import type {
  CFilterModelEntry, CMultiConditionFilterModel,
  CTextFilterModel, CNumberFilterModel, CDateFilterModel,
} from '../types';

/**
 * Floating-filter input parser. Converts the user's typed text into a
 * v2 `CFilterModelEntry` based on the column's resolved filter type.
 * Returns `null` when the input is empty or unparseable — the caller
 * (FloatingFilterOverlay) clears the column's filter on `null` while
 * leaving the input text intact (no silent misfilter).
 *
 * # Grammar (LL(1), no operator precedence)
 *
 * ```
 *   expr      := orExpr
 *   orExpr    := andExpr ((',' | 'OR' | '||') andExpr)*
 *   andExpr   := atom (('AND' | '&&') atom)*
 *   atom      := comparison | range | bareValue
 * ```
 *
 * Top-level `,` acts as OR — a CSV like `1,2,3` produces an OR-of-equals
 * for numeric columns, OR-of-contains for text columns. Mixed-CSV like
 * `>100, <50` produces OR(>100, <50). AND binds tighter than OR.
 *
 * # Operator surface per column type
 *
 * - **text:** bareValue → `contains`. AND/OR compose contains expressions.
 *   No comparison operators (text has no `<` / `>` ordering in v1).
 * - **number:** `>N`, `<N`, `>=N`, `<=N`, `=N`, `==N`, `!=N`, `<>N`,
 *   `N..M`, `N-M` (range), CSV → OR-of-equals, AND/OR compose.
 *   Bare numeric value → `equals`.
 * - **date:** comparison operators + `D..D` range + CSV → OR-of-equals.
 *   No `-` separator for ranges (conflicts with ISO date format) —
 *   use `..` instead. Bare ISO date → `equals`.
 *
 * # Unparseable input
 *
 * Returns `null` when:
 *  - The input is empty / whitespace-only
 *  - A number column receives a non-numeric token
 *  - A date column receives a non-ISO token
 *  - The expression is structurally broken (dangling AND/OR, etc.)
 *
 * Cycle 7 / Task 1 (parser enhancement).
 */

export type FilterColumnType = 'text' | 'number' | 'date';

interface Atom {
  /** The single comparison/range produced by `parseAtom`. */
  entry: CTextFilterModel | CNumberFilterModel | CDateFilterModel;
}

/** Pre-compiled token splitter for top-level OR. Matches `,`, ` OR `,
 *  ` or `, `||` — case-insensitive. The whitespace around `OR`/`or`
 *  is required so it doesn't collide with values that contain those
 *  letters. */
const OR_SPLIT_RE = /\s+OR\s+|\s*,\s*|\s*\|\|\s*/i;
/** Same for top-level AND: `AND`, `and`, `&&`. */
const AND_SPLIT_RE = /\s+AND\s+|\s*&&\s*/i;

export function parseFloatingFilterInput(
  raw: string,
  columnType: FilterColumnType,
): CFilterModelEntry | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const orParts = splitTopLevel(trimmed, OR_SPLIT_RE);
  if (orParts.length > 1) {
    const conditions: Array<CTextFilterModel | CNumberFilterModel | CDateFilterModel> = [];
    for (const part of orParts) {
      const child = parseAndExpr(part.trim(), columnType);
      if (!child) return null;
      pushFlattenedConditions(conditions, child, 'OR');
    }
    return collapseMulti('OR', conditions);
  }
  return parseAndExpr(trimmed, columnType);
}

function parseAndExpr(
  input: string, columnType: FilterColumnType,
): CFilterModelEntry | null {
  const andParts = splitTopLevel(input, AND_SPLIT_RE);
  if (andParts.length > 1) {
    const conditions: Array<CTextFilterModel | CNumberFilterModel | CDateFilterModel> = [];
    for (const part of andParts) {
      const atom = parseAtom(part.trim(), columnType);
      if (!atom) return null;
      conditions.push(atom.entry);
    }
    return collapseMulti('AND', conditions);
  }
  const atom = parseAtom(input.trim(), columnType);
  return atom ? atom.entry : null;
}

function parseAtom(input: string, columnType: FilterColumnType): Atom | null {
  if (input === '') return null;

  // Range:  N..M  (works for number + date)
  if (input.includes('..')) {
    const [lo, hi] = input.split('..').map((s) => s.trim());
    if (lo == null || hi == null) return null;
    if (columnType === 'number') {
      const a = parseNumber(lo), b = parseNumber(hi);
      if (a === null || b === null) return null;
      return { entry: { filterType: 'number', type: 'inRange', filter: a, filterTo: b } };
    }
    if (columnType === 'date') {
      if (!isIsoDate(lo) || !isIsoDate(hi)) return null;
      return { entry: { filterType: 'date', type: 'inRange', filter: lo, filterTo: hi } };
    }
    return null;
  }

  // Number-only range:  N-M  (dates use `..` to avoid the ISO conflict).
  if (columnType === 'number' && /^-?\d[\d.]*-\d/.test(input)) {
    const dashIdx = input.indexOf('-', 1);
    const lo = input.slice(0, dashIdx).trim();
    const hi = input.slice(dashIdx + 1).trim();
    const a = parseNumber(lo), b = parseNumber(hi);
    if (a !== null && b !== null) {
      return { entry: { filterType: 'number', type: 'inRange', filter: a, filterTo: b } };
    }
  }

  // Comparison operators (number + date).
  if (columnType !== 'text') {
    const opMatch = /^(>=|<=|!=|<>|==|=|>|<)\s*(.*)$/.exec(input);
    if (opMatch) {
      const op = opMatch[1]!;
      const rest = opMatch[2]!.trim();
      if (rest === '') return null;
      const type = OPERATOR_NAMES[op]!;
      if (columnType === 'number') {
        const n = parseNumber(rest);
        if (n === null) return null;
        return { entry: { filterType: 'number', type, filter: n } };
      }
      // date
      if (!isIsoDate(rest)) return null;
      return { entry: { filterType: 'date', type, filter: rest } };
    }
  }

  // Bare value:  contains (text)  or  equals (number / date).
  if (columnType === 'text') {
    return { entry: { filterType: 'text', type: 'contains', filter: input } };
  }
  if (columnType === 'number') {
    const n = parseNumber(input);
    if (n === null) return null;
    return { entry: { filterType: 'number', type: 'equals', filter: n } };
  }
  // date
  if (!isIsoDate(input)) return null;
  return { entry: { filterType: 'date', type: 'equals', filter: input } };
}

/** Map symbolic comparison operators to their ag-grid type names. Used
 *  by both number and date columns (same operator surface). */
const OPERATOR_NAMES: Record<string, 'equals' | 'notEqual' | 'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual'> = {
  '=':  'equals',
  '==': 'equals',
  '!=': 'notEqual',
  '<>': 'notEqual',
  '>':  'greaterThan',
  '<':  'lessThan',
  '>=': 'greaterThanOrEqual',
  '<=': 'lessThanOrEqual',
};

/** Parse a numeric literal. Returns `null` for inputs that aren't a
 *  finite number. Accepts standard JS number syntax. */
function parseNumber(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Loose ISO date validation: `YYYY-MM-DD` or full ISO timestamp.
 *  Strict enough to reject bare numbers / words / partial dates, lax
 *  enough to accept the formats Date.parse handles. */
function isIsoDate(s: string): boolean {
  const trimmed = s.trim();
  // Require at least YYYY-MM-DD prefix.
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return false;
  const t = Date.parse(trimmed);
  return !Number.isNaN(t);
}

/** Split `input` on `re`, but only at the top level (not inside a future
 *  parenthesised sub-expression). For the v1 grammar parens aren't
 *  supported, so this collapses to a straight `split`; kept as its own
 *  function so Task 6's nested multi-condition can swap in real
 *  top-level-only splitting without touching callers. */
function splitTopLevel(input: string, re: RegExp): string[] {
  return input.split(re).filter((p) => p.length > 0);
}

/** Flatten nested multi-condition entries of the same operator into a
 *  single conditions array. `A OR (B OR C)` becomes `OR(A, B, C)` so
 *  the worker walks one array instead of recursing. */
function pushFlattenedConditions(
  out: Array<CTextFilterModel | CNumberFilterModel | CDateFilterModel>,
  entry: CFilterModelEntry,
  parentOp: 'AND' | 'OR',
): void {
  if (entry.filterType === 'multi' && entry.operator === parentOp) {
    for (const c of entry.conditions) out.push(c);
    return;
  }
  // The grammar only produces leaf entries inside multi.conditions, so
  // a non-matching multi at the top of an OR clause means an AND
  // sub-tree — keep it as a single condition (worker handles nested
  // multi-entries via matchesV2's recursion).
  out.push(entry as CTextFilterModel | CNumberFilterModel | CDateFilterModel);
}

/** Collapse a 1-element multi-condition back to the bare leaf entry.
 *  Idiomatic for parsers that always go through the OR/AND layers —
 *  avoids wrapping `>100` in a useless `multi { conditions:[>100] }`. */
function collapseMulti(
  operator: 'AND' | 'OR',
  conditions: Array<CTextFilterModel | CNumberFilterModel | CDateFilterModel>,
): CFilterModelEntry | null {
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0]!;
  const out: CMultiConditionFilterModel = { filterType: 'multi', operator, conditions };
  return out;
}
