// RuleEngine — setRules compile + indexes, evaluateCell fold, theme
// resolution, resolveRuleRef. Match counts / transactions land in Task 4;
// expiry + flash directives in Task 5 (their methods still throw here).
//
// Authoritative reference:
// docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §3.5 + §4.2.

import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import { compileFormat } from '@wellsfargo-starui/velocity-grid-format';
import type { FormatProgram } from '@wellsfargo-starui/velocity-grid-format';
import { compileCondition, validateRuleShape } from './conditionCompiler';
import type { CompiledCondition } from './conditionCompiler';
import { ExpiryHeap } from './expiryHeap';
import { MatchCounter } from './matchCounter';
import type {
  ConditionalStyleRule,
  FlashDirective,
  RowChangeSet,
  RuleCellResult,
  RuleEvalContext,
  RuleIndicator,
  RuleValidationError,
  SetRulesResult,
  StyleRule,
  StyleSlice,
  ThemeAwareStyle,
  ThemeKind,
  Unsubscribe,
} from './types';

interface IndexedRule {
  rule: StyleRule;
  condition: CompiledCondition;
  /** Compiled valueFormatter (style rules only); null when absent. */
  formatProgram: FormatProgram | null;
  /** Position in the setRules array — stable tiebreak for equal priority. */
  order: number;
}

function byPriority(a: IndexedRule, b: IndexedRule): number {
  return a.rule.priority - b.rule.priority || a.order - b.order;
}

/** base ⊕ theme slice, per-property (ThemeAwareStyle contract, spec §3.1). */
function resolveThemeStyle(style: ThemeAwareStyle, theme: ThemeKind): StyleSlice | null {
  const slice = theme === 'dark' ? style.dark : style.light;
  if (!style.base) return slice ?? null;
  if (!slice) return style.base;
  return { ...style.base, ...slice };
}

const EMPTY_MATCHED: string[] = [];
Object.freeze(EMPTY_MATCHED);

/** Shared zero-allocation result for cells no rule matches (spec §4.2). */
const EMPTY_RESULT: RuleCellResult = Object.freeze({
  matched: EMPTY_MATCHED,
  style: null,
  indicator: null,
  formatProgram: null,
});

export class RuleEngine {
  #schema: Schema | undefined;
  /** Full supplied set — incl. invalid + disabled (serializable snapshot). */
  #rules: StyleRule[] = [];
  /** Enabled, valid, compiled rules — priority asc, stable. */
  #indexed: IndexedRule[] = [];
  #byId = new Map<string, IndexedRule>();
  #cellByColId = new Map<string, IndexedRule[]>();
  #rowScope: IndexedRule[] = [];
  /** Lazily merged (row-scope + cell-scope) candidate lists per colId. */
  #mergedByColId = new Map<string, IndexedRule[]>();
  /** Row-scope condition memo, keyed by rowId (paint pass). The kernel
   *  mutates row objects in place — same identity across updates — so a
   *  WeakMap keyed by object identity would serve stale booleans after a
   *  mutation. Keying by rowId lets applyChanges/removal invalidate
   *  precisely; the stored `row` reference guards against a rowId being
   *  reused with a genuinely different row object without an explicit
   *  invalidation call. */
  #rowMemo = new Map<string, { row: Record<string, unknown>; matches: Map<string, boolean> }>();
  /** Eval errors per ruleId since last setRules (getter ships in Task 4). */
  #evalErrors = new Map<string, number>();
  #counter = new MatchCounter();
  /** Tick-scoped diff map: rowId → { [colId]: { old } } (spec §3.4).
   *  First oldValue of the tick wins — '.old' = value at tick start. */
  #diffByRowId = new Map<string, Record<string, { old: unknown }>>();
  /** Merged { ...row, __cgridDiff } per rowId within a tick. */
  #mergedRowCache = new Map<string, { source: Record<string, unknown>; merged: Record<string, unknown> }>();
  /** Style rules with flash?.enabled or activeDurationMs — the only
   *  consumers of activations. */
  #activationTracked: IndexedRule[] = [];
  /** Currently-true (rule → rows) pairs for activation-tracked rules only.
   *  Memory bound: O(tracked rules × matching rows). */
  #lastMatch = new Map<string, Set<string>>();
  /** Activations collected during applyChanges. Task 5 fills directives from these. */
  #activations: Array<{ rule: ConditionalStyleRule; rowId: string }> = [];
  #now: () => number;
  #expiry: ExpiryHeap;
  #expireSubs = new Set<(cells: Array<{ rowId: string; colId: string | null }>) => void>();

  constructor(opts?: {
    schema?: Schema;
    /** Injectable clock. Default is a lazy performance.now wrapper — the
     *  engine stays Date-free (Global Constraints). */
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
  }) {
    this.#schema = opts?.schema;
    this.#now = opts?.now ?? (() => globalThis.performance?.now() ?? 0);
    this.#expiry = new ExpiryHeap({
      now: this.#now,
      setTimer: opts?.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts?.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    });
    this.#expiry.onExpire((expired) => {
      const cells = expired.map((e) => ({ rowId: e.rowId, colId: e.colId }));
      for (const fn of [...this.#expireSubs]) fn(cells);
    });
  }

  /** Replace the rule set. Invalid rules are skipped + reported; valid rules apply. */
  setRules(rules: StyleRule[]): SetRulesResult {
    const errors: RuleValidationError[] = [];
    const indexed: IndexedRule[] = [];
    for (let order = 0; order < rules.length; order++) {
      // noUncheckedIndexedAccess types this as possibly-undefined even
      // though the loop bound guarantees it; guard explicitly rather than
      // asserting (same pattern as conditionCompiler's rewriteField).
      const rule = rules[order];
      if (rule === undefined) continue;
      const ruleErrors = validateRuleShape(rule);
      let formatProgram: FormatProgram | null = null;
      if (rule.kind === 'style' && typeof rule.valueFormatter === 'string') {
        const fmt = compileFormat(rule.valueFormatter);
        if (fmt.ok) {
          formatProgram = fmt.program;
        } else {
          ruleErrors.push({
            ruleId: rule.id,
            code: 'format-compile',
            message: fmt.error.message,
            loc: fmt.error.loc,
          });
        }
      }
      let condition: CompiledCondition | null = null;
      if (typeof rule.condition === 'string' && rule.condition.trim().length > 0) {
        const res = compileCondition(rule.condition, rule.id, this.#schema, {
          onEvalError: () =>
            this.#evalErrors.set(rule.id, (this.#evalErrors.get(rule.id) ?? 0) + 1),
        });
        if (res.ok) condition = res.compiled;
        else ruleErrors.push(res.error);
      }
      if (ruleErrors.length > 0 || condition === null) {
        errors.push(...ruleErrors);
        continue; // invalid rule skipped; valid ones still apply
      }
      if (rule.enabled) indexed.push({ rule, condition, formatProgram, order });
    }
    indexed.sort(byPriority);

    this.#rules = rules.slice();
    this.#indexed = indexed;
    this.#byId = new Map(indexed.map((ir) => [ir.rule.id, ir]));
    this.#cellByColId = new Map();
    this.#rowScope = [];
    for (const ir of indexed) {
      if (ir.rule.scope.kind === 'row') {
        this.#rowScope.push(ir);
      } else {
        for (const colId of ir.rule.scope.columnIds) {
          let list = this.#cellByColId.get(colId);
          if (!list) {
            list = [];
            this.#cellByColId.set(colId, list);
          }
          list.push(ir);
        }
      }
    }
    this.#activationTracked = indexed.filter(
      (ir) =>
        ir.rule.kind === 'style' &&
        (ir.rule.flash?.enabled === true || ir.rule.activeDurationMs != null),
    );
    this.#mergedByColId = new Map();
    this.#rowMemo = new Map();
    this.#evalErrors = new Map();
    this.#counter.resetAll(); // caller re-seeds via recount (bridge does, Task 15)
    this.#lastMatch = new Map();
    this.#activations = [];
    this.#expiry.clear(); // replaced rules void their active windows
    return { ok: errors.length === 0, errors };
  }

  getRules(): StyleRule[] {
    return this.#rules.slice();
  }

  /** Paint-path entry. Pure w.r.t. engine state; cheap when no rules target the cell. */
  evaluateCell(ctx: RuleEvalContext): RuleCellResult {
    const candidates = this.#candidatesFor(ctx.colId);
    if (candidates.length === 0) return EMPTY_RESULT;
    let matched: string[] | null = null;
    let style: StyleSlice | null = null;
    let indicator: RuleIndicator | null = null;
    let formatProgram: FormatProgram | null = null;
    for (const ir of candidates) {
      if (!this.#ruleMatches(ir, ctx)) continue;
      (matched ??= []).push(ir.rule.id);
      if (ir.rule.kind === 'style') {
        const slice = resolveThemeStyle(ir.rule.style, ctx.theme);
        // TS narrowing note: reassigning `style` inside this loop body
        // defeats control-flow narrowing on the ternary condition across
        // iterations (loop-local widening quirk) — use Object.assign into a
        // fresh object instead of a `prev ? {...prev,...slice} : {...slice}`
        // spread ternary so the compiler doesn't need to narrow `style`.
        if (slice) style = Object.assign({}, style, slice);
        if (ir.rule.indicator) indicator = ir.rule.indicator;
        if (ir.formatProgram) formatProgram = ir.formatProgram;
      } else {
        indicator = ir.rule.indicator; // last matching indicator wins
      }
    }
    if (matched === null) return EMPTY_RESULT;
    return { matched, style, indicator, formatProgram };
  }

  /** rule:<ruleId> color accessor for @wellsfargo-starui/velocity-grid-format (Task 9 threads it).
   *  Condition-level match — scope column targeting governs where the rule
   *  paints, not whether a format rule-ref may read its color. */
  resolveRuleRef(ruleId: string, ctx: RuleEvalContext): string | null {
    const ir = this.#byId.get(ruleId); // only enabled+valid rules are indexed
    if (!ir || ir.rule.kind !== 'style') return null;
    if (!this.#ruleMatches(ir, ctx)) return null;
    const slice = resolveThemeStyle(ir.rule.style, ctx.theme);
    return slice?.color ?? null;
  }

  #candidatesFor(colId: string | null): IndexedRule[] {
    if (colId === null) return this.#rowScope;
    let merged = this.#mergedByColId.get(colId);
    if (merged === undefined) {
      const cell = this.#cellByColId.get(colId);
      if (!cell || cell.length === 0) merged = this.#rowScope;
      else if (this.#rowScope.length === 0) merged = cell;
      else merged = [...this.#rowScope, ...cell].sort(byPriority);
      this.#mergedByColId.set(colId, merged);
    }
    return merged;
  }

  /** Single matching gate for evaluateCell + resolveRuleRef. An
   *  activeDurationMs rule stays matched for its window after activation,
   *  even once endTick cleared the tick's diff (spec §3.1 blink-on-change);
   *  after expiry it stops matching and onExpire notifies for repaint. */
  #ruleMatches(ir: IndexedRule, ctx: RuleEvalContext): boolean {
    if (ir.rule.kind === 'style' && ir.rule.activeDurationMs != null) {
      const activeColId = ir.rule.scope.kind === 'row' ? null : ctx.colId;
      if (this.#expiry.isActive(ctx.rowId, activeColId, ir.rule.id)) return true;
    }
    return this.#conditionMatches(ir, ctx.rowId, ctx.row);
  }

  /** Shared by the paint path and the eager counting path. */
  #conditionMatches(ir: IndexedRule, rowId: string, row: Record<string, unknown>): boolean {
    if (ir.condition.diffAware) {
      // Diff-aware rules never match quiescent rows (spec §3.4) and skip
      // the row-scope memo — their inputs are tick-scoped.
      const diff = this.#diffByRowId.get(rowId);
      if (diff === undefined) return false;
      return ir.condition.matches(this.#evalRow(rowId, row, diff));
    }
    if (ir.rule.scope.kind === 'row') {
      let entry = this.#rowMemo.get(rowId);
      if (!entry || entry.row !== row) {
        // Different (or first-seen) row object for this rowId — stale
        // entries (e.g. a rowId reused for a new object without an explicit
        // invalidation) must not leak matches from the old object.
        entry = { row, matches: new Map() };
        this.#rowMemo.set(rowId, entry);
      }
      const hit = entry.matches.get(ir.rule.id);
      if (hit !== undefined) return hit;
      const res = ir.condition.matches(row);
      entry.matches.set(ir.rule.id, res);
      return res;
    }
    return ir.condition.matches(row);
  }

  /** { ...row, __cgridDiff } — built once per (rowId, row-reference) per tick. */
  #evalRow(
    rowId: string,
    row: Record<string, unknown>,
    diff: Record<string, { old: unknown }>,
  ): Record<string, unknown> {
    const cached = this.#mergedRowCache.get(rowId);
    if (cached && cached.source === row) return cached.merged;
    const merged = { ...row, __cgridDiff: diff };
    this.#mergedRowCache.set(rowId, { source: row, merged });
    return merged;
  }

  // ─── Task 4 ────────────────────────────────────────────────────────────

  /** Live "APP N" count over the dataset last supplied via recount/applyChanges.
   *  Reflects CONDITION matches; Task 5's activeDurationMs paint windows do
   *  not inflate counts. */
  matchCount(ruleId: string): number {
    return this.#counter.count(ruleId);
  }

  evalErrorCount(ruleId: string): number {
    return this.#evalErrors.get(ruleId) ?? 0;
  }

  /** Full-dataset scan (rule change / initial wire). Rebuilds all match counts. */
  recount(rows: Iterable<{ rowId: string; row: Record<string, unknown> }>): void {
    this.#counter.resetAll();
    for (const { rowId, row } of rows) this.#recountRow(rowId, row);
  }

  #recountRow(rowId: string, row: Record<string, unknown>): void {
    for (const ir of this.#indexed) {
      this.#counter.setRowMatches(ir.rule.id, rowId, this.#contribution(ir, rowId, row));
    }
  }

  /** Cells this rule matches on this row: row scope → 1; cell scope → one
   *  per scoped colId (the condition is row-level — all or none). */
  #contribution(ir: IndexedRule, rowId: string, row: Record<string, unknown>): number {
    if (!this.#conditionMatches(ir, rowId, row)) return 0;
    return ir.rule.scope.kind === 'row' ? 1 : ir.rule.scope.columnIds.length;
  }

  /** Transaction feed: updates the tick-scoped diff map, match counts
   *  (incremental), and activation state. Flash directives land in Task 5. */
  applyChanges(changes: RowChangeSet): FlashDirective[] {
    // (a) Diff map — the '__cgridDiff' object the rewritten conditions read.
    // Shape: { [colId]: { old } }. First old of the tick wins.
    for (const u of changes.updated) {
      // The kernel mutates row objects in place (same identity across
      // updates), so the row-scope memo — keyed by rowId, gated by object
      // identity — would otherwise serve the pre-mutation booleans it
      // cached under the old field values. Drop it unconditionally for
      // every reported update, before recount/activation detection reads
      // through #conditionMatches below.
      this.#rowMemo.delete(u.rowId);
      if (u.cells.length === 0) continue;
      let diff = this.#diffByRowId.get(u.rowId);
      if (!diff) {
        diff = {};
        this.#diffByRowId.set(u.rowId, diff);
      }
      for (const cell of u.cells) {
        if (!(cell.colId in diff)) diff[cell.colId] = { old: cell.oldValue };
      }
      this.#mergedRowCache.delete(u.rowId); // row reference changed — rebuild lazily
    }

    // (b) + (c) incremental recount with activation detection. Added rows
    // whose condition matches count as activations (false→true from absence).
    for (const a of changes.added) {
      this.#detectActivations(a.rowId, a.row);
      this.#recountRow(a.rowId, a.row);
    }
    for (const u of changes.updated) {
      this.#detectActivations(u.rowId, u.row);
      this.#recountRow(u.rowId, u.row);
    }
    for (const r of changes.removed) {
      this.#counter.dropRow(r.rowId);
      this.#diffByRowId.delete(r.rowId);
      this.#mergedRowCache.delete(r.rowId);
      this.#rowMemo.delete(r.rowId);
      for (const rowStates of this.#lastMatch.values()) rowStates.delete(r.rowId);
    }

    // (d) activations → expiry entries + flash directives (spec §1.1 items 5+8).
    const directives: FlashDirective[] = [];
    for (const { rule, rowId } of this.#activations) {
      const scopedColIds = rule.scope.kind === 'row' ? null : rule.scope.columnIds;
      if (rule.activeDurationMs != null && rule.activeDurationMs > 0) {
        const deadline = this.#now() + rule.activeDurationMs;
        if (scopedColIds === null) {
          this.#expiry.push({ deadline, rowId, colId: null, ruleId: rule.id });
        } else {
          for (const colId of scopedColIds) {
            this.#expiry.push({ deadline, rowId, colId, ruleId: rule.id });
          }
        }
      }
      if (rule.flash?.enabled) {
        directives.push({
          rowId,
          // cell target → the rule's matched cell set; row target → whole row.
          colIds:
            rule.flash.target === 'row' || scopedColIds === null ? null : scopedColIds.slice(),
          color: rule.flash.color,
          mode: rule.flash.mode,
          durationMs: rule.flash.durationMs,
        });
      }
    }
    this.#activations.length = 0;
    return directives;
  }

  #detectActivations(rowId: string, row: Record<string, unknown>): void {
    for (const ir of this.#activationTracked) {
      const matchesNow = this.#conditionMatches(ir, rowId, row);
      let rowStates = this.#lastMatch.get(ir.rule.id);
      const prev = rowStates?.has(rowId) === true;
      if (matchesNow && !prev) {
        // #activationTracked only holds style rules (see setRules filter).
        this.#activations.push({ rule: ir.rule as ConditionalStyleRule, rowId });
      }
      if (matchesNow) {
        if (!rowStates) {
          rowStates = new Set();
          this.#lastMatch.set(ir.rule.id, rowStates);
        }
        rowStates.add(rowId);
      } else {
        rowStates?.delete(rowId);
      }
    }
  }

  /** Clears the tick-scoped diff map. Bridge calls after the post-transaction
   *  repaint (Task 15). Paint-side, diff-aware matches decay naturally: their
   *  conditions read [col.old] → null once cleared (and the quiescent-row
   *  gate skips them). Counts are eager state, so force diff-aware
   *  contributions back to zero for affected rows; lastMatch resets so the
   *  next tick's change re-activates. */
  endTick(): void {
    if (this.#diffByRowId.size === 0) return;
    const affected = [...this.#diffByRowId.keys()];
    this.#diffByRowId.clear();
    this.#mergedRowCache.clear();
    for (const ir of this.#indexed) {
      if (!ir.condition.diffAware) continue;
      const rowStates = this.#lastMatch.get(ir.rule.id);
      for (const rowId of affected) {
        this.#counter.setRowMatches(ir.rule.id, rowId, 0);
        rowStates?.delete(rowId);
      }
    }
  }

  // ─── Task 5 ────────────────────────────────────────────────────────────

  /** activeDurationMs expiries → bridge repaints those cells. */
  onExpire(fn: (cells: Array<{ rowId: string; colId: string | null }>) => void): Unsubscribe {
    this.#expireSubs.add(fn);
    return () => {
      this.#expireSubs.delete(fn);
    };
  }

  // ─── Task 15 ───────────────────────────────────────────────────────────

  /** Union of every enabled rule's condition-referenced colIds plus
   *  cell-scope columnIds. The bridge diffs exactly these columns. */
  watchedColIds(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const ir of this.#indexed) {
      for (const colId of ir.condition.watchedColIds) out.add(colId);
      if (ir.rule.scope.kind === 'cell') {
        for (const colId of ir.rule.scope.columnIds) out.add(colId);
      }
    }
    return out;
  }
}
