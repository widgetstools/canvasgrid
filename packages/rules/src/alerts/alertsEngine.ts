// AlertsEngine — trigger evaluation, debounce, token bucket, history ring.
// Spec: docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §4.3.
// Evaluation modes (throttled queue) + settings surface complete in Task 8.
import { compile, evaluate, parse, type Compiled, type Schema } from '@cgrid/expression';
import { DEFAULT_ALERTS_SETTINGS } from '../types';
import type {
  AlertEvent, AlertRule, AlertsSettings, AlertTrigger,
  RowChangeSet, RuleValidationError, SetRulesResult, Unsubscribe,
} from '../types';
import { renderMessage } from './messageTemplate';
import { TokenBucket } from './tokenBucket';

interface CompiledAlertRule {
  rule: AlertRule;
  /** Compiled dataChange expression; null for relativeChange/rowChange. */
  compiled: Compiled | null;
}

/** One trigger match, pre-pipeline. */
interface AlertHit {
  rowId: string;
  colId: string | null;
  value: unknown;
  prev: unknown;
}

type RelativeChangeTrigger = Extract<AlertTrigger, { kind: 'relativeChange' }>;

function mergeSettings(
  base: AlertsSettings,
  patch: Partial<AlertsSettings> | undefined,
): AlertsSettings {
  if (!patch) return { ...base, enabledChannels: { ...base.enabledChannels } };
  return {
    ...base,
    ...patch,
    // Per-key channel merge: a partial record only overrides the keys given.
    enabledChannels: { ...base.enabledChannels, ...(patch.enabledChannels ?? {}) },
  };
}

function checkShape(rule: AlertRule): RuleValidationError | null {
  const bad = (message: string): RuleValidationError => ({
    ruleId: typeof (rule as { id?: unknown } | null)?.id === 'string' ? rule.id : '<unknown>',
    code: 'bad-shape',
    message,
    loc: null,
  });
  if (!rule || typeof rule !== 'object') return bad('rule must be an object');
  if (typeof rule.id !== 'string' || rule.id === '') return bad('rule.id must be a non-empty string');
  if (typeof rule.name !== 'string') return bad('rule.name must be a string');
  if (typeof rule.message !== 'string') return bad('rule.message must be a string');
  if (!Array.isArray(rule.channels)) return bad('rule.channels must be an array');
  const trigger = rule.trigger as AlertTrigger | undefined;
  if (!trigger || typeof trigger !== 'object') return bad('rule.trigger is required');
  switch (trigger.kind) {
    case 'dataChange':
      if (typeof trigger.expression !== 'string' || trigger.expression === '') {
        return bad('dataChange trigger requires an expression string');
      }
      return null;
    case 'relativeChange':
      if (typeof trigger.colId !== 'string' || trigger.colId === '') {
        return bad('relativeChange trigger requires colId');
      }
      if (trigger.mode !== 'ANY_CHANGE' && trigger.mode !== 'ABSOLUTE_CHANGE' && trigger.mode !== 'PERCENT_CHANGE') {
        return bad('relativeChange mode must be PERCENT_CHANGE | ABSOLUTE_CHANGE | ANY_CHANGE');
      }
      if (trigger.mode !== 'ANY_CHANGE' && typeof trigger.threshold !== 'number') {
        return bad(`relativeChange ${trigger.mode} requires a numeric threshold`);
      }
      if (trigger.direction !== 'up' && trigger.direction !== 'down' && trigger.direction !== 'both') {
        return bad('relativeChange direction must be up | down | both');
      }
      return null;
    case 'rowChange':
      if (trigger.mode !== 'ROW_ADDED' && trigger.mode !== 'ROW_REMOVED') {
        return bad('rowChange mode must be ROW_ADDED | ROW_REMOVED');
      }
      return null;
    default:
      return bad('rule.trigger.kind must be dataChange | relativeChange | rowChange');
  }
}

function relativeChangeFires(trigger: RelativeChangeTrigger, oldV: number, newV: number): boolean {
  if (trigger.direction === 'up' && !(newV > oldV)) return false;
  if (trigger.direction === 'down' && !(newV < oldV)) return false;
  switch (trigger.mode) {
    case 'ANY_CHANGE':
      return oldV !== newV;
    case 'ABSOLUTE_CHANGE':
      return Math.abs(newV - oldV) >= trigger.threshold; // boundary equality fires
    case 'PERCENT_CHANGE':
      // old = 0 → percent change undefined → never fires (spec §4.3).
      return oldV !== 0 && (Math.abs(newV - oldV) / Math.abs(oldV)) * 100 >= trigger.threshold;
  }
}

export class AlertsEngine {
  private settings: AlertsSettings;
  private compiledRules: CompiledAlertRule[] = [];
  private readonly nowFn: () => number;
  private readonly bucket: TokenBucket;
  private readonly listeners = new Set<(alert: AlertEvent) => void>();
  /** Debounce stamps: `ruleId rowId` → last pass-through time (ms).
   *  Kept across setRules — re-setting rules must not reopen windows. */
  private readonly debounceLast = new Map<string, number>();
  private seqCounter = 0;
  private dropped = 0;
  private unread = 0;
  // History ring — O(1) push, no shifting. `ring` is a circular buffer of at
  // most settings.historyLimit events, stored oldest-first while filling
  // (append; oldest at index 0). Once full, `nextWrite` marks the oldest
  // slot, which each push overwrites in place. getHistory() walks backward
  // from the newest slot to materialize newest-first.
  private ring: AlertEvent[] = [];
  private nextWrite = 0;
  /** Throttled-mode queue: one coalesced RowChangeSet (arrival-order concat).
   *  Row-level squashing is deliberately NOT done — each queued update keeps
   *  its own ChangeRecords so relativeChange deltas stay per-tick. */
  private pending: RowChangeSet | null = null;

  constructor(opts?: { settings?: Partial<AlertsSettings>; schema?: Schema; now?: () => number }) {
    this.settings = mergeSettings(DEFAULT_ALERTS_SETTINGS, opts?.settings);
    // Injectable clock (Global Constraints: Date-free engines). Default wraps
    // performance.now(); the bridge (Task 15) passes its own wrapper.
    this.nowFn = opts?.now ?? (() => performance.now());
    this.bucket = new TokenBucket({
      capacityPerSecond: this.settings.maxNotificationsPerSecond,
      now: this.nowFn,
    });
  }

  setRules(rules: AlertRule[]): SetRulesResult {
    const errors: RuleValidationError[] = [];
    const valid: CompiledAlertRule[] = [];
    for (const rule of rules) {
      const shapeError = checkShape(rule);
      if (shapeError) {
        errors.push(shapeError);
        continue;
      }
      let compiled: Compiled | null = null;
      if (rule.trigger.kind === 'dataChange') {
        // Plain expressions — deliberately NOT conditionCompiler: alert
        // conditions have no .old/.new rewrite (relativeChange covers deltas).
        const parsed = parse(rule.trigger.expression);
        if (!parsed.ok) {
          errors.push({ ruleId: rule.id, code: 'parse', message: parsed.error.message, loc: parsed.error.loc });
          continue;
        }
        const compiledResult = compile(parsed.ast);
        if (!compiledResult.ok) {
          errors.push({
            ruleId: rule.id,
            code: compiledResult.error.code, // 'unknown-fn' | 'arity' | 'not-yet-implemented'
            message: compiledResult.error.message,
            loc: compiledResult.error.loc,
          });
          continue;
        }
        compiled = compiledResult.compiled;
      }
      valid.push({ rule, compiled });
    }
    valid.sort((a, b) => a.rule.priority - b.rule.priority); // stable — array order breaks ties
    this.compiledRules = valid;
    return { ok: errors.length === 0, errors };
  }

  getRules(): AlertRule[] {
    return this.compiledRules.map((entry) => entry.rule);
  }

  getSettings(): AlertsSettings {
    // Defensive copy — one level deep is the whole shape (scalars + the
    // enabledChannels record); callers can never mutate engine state.
    return { ...this.settings, enabledChannels: { ...this.settings.enabledChannels } };
  }

  setSettings(patch: Partial<AlertsSettings>): void {
    const prev = this.settings;
    const next = mergeSettings(prev, patch);
    if (next.historyLimit !== prev.historyLimit) {
      // Rebuild the ring at the new size keeping the newest events. Must run
      // BEFORE the settings swap: getHistory() reads prev.historyLimit.
      const kept = this.getHistory().slice(0, next.historyLimit);
      this.ring = kept.reverse(); // ring stores oldest-first
      this.nextWrite = 0;
    }
    this.settings = next;
    if (next.maxNotificationsPerSecond !== prev.maxNotificationsPerSecond) {
      this.bucket.setCapacity(next.maxNotificationsPerSecond);
    }
    if (prev.evaluationMode === 'throttled' && next.evaluationMode === 'realtime') {
      // The only auto-flushing transition (spec §4.3). paused transitions
      // never drop or flush the queue; paused → realtime leaves it for an
      // explicit flushThrottled().
      this.flushThrottled();
    }
  }

  applyChanges(changes: RowChangeSet): void {
    if (!this.settings.enabled) return; // global kill-switch — nothing queues either
    switch (this.settings.evaluationMode) {
      case 'paused':
        return; // no-op — a queued throttled batch stays untouched
      case 'throttled':
        this.enqueue(changes);
        return;
      case 'realtime':
        this.process(changes);
        return;
    }
  }

  onAlert(fn: (alert: AlertEvent) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Newest-first snapshot of the bounded history ring. */
  getHistory(): AlertEvent[] {
    const n = this.ring.length;
    if (n === 0) return [];
    const newest = n < this.settings.historyLimit ? n - 1 : (this.nextWrite - 1 + n) % n;
    const out: AlertEvent[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.ring[(newest - i + n) % n]!; // index math keeps this in-bounds
    return out;
  }

  /** Drop the session notification ring and reset the unread counter.
   *  Rules + settings are untouched. */
  clearHistory(): void {
    this.ring = [];
    this.nextWrite = 0;
    this.unread = 0;
  }

  unreadCount(): number {
    return this.unread;
  }

  markAllRead(): void {
    this.unread = 0;
  }

  /** Token-bucket drops since construction (diagnostic, spec §4.3). */
  droppedCount(): number {
    return this.dropped;
  }

  /** Throttled mode: the bridge (Task 15) calls this once per animation
   *  frame. Processes the coalesced batch through the same pipeline, then
   *  clears. Safe to call in any mode (no-op when nothing is queued). */
  flushThrottled(): void {
    const batch = this.pending;
    this.pending = null;
    if (batch === null || !this.settings.enabled) return;
    this.process(batch);
  }

  // ── pipeline ─────────────────────────────────────────────────────────

  private enqueue(changes: RowChangeSet): void {
    if (this.pending === null) {
      this.pending = {
        added: [...changes.added],
        updated: [...changes.updated],
        removed: [...changes.removed],
      };
      return;
    }
    this.pending.added.push(...changes.added);
    this.pending.updated.push(...changes.updated);
    this.pending.removed.push(...changes.removed);
  }

  private process(changes: RowChangeSet): void {
    if (!this.settings.enabled) return; // re-checked for Task 8's flush path
    for (const entry of this.compiledRules) {
      if (!entry.rule.enabled) continue;
      for (const hit of this.evaluateTrigger(entry, changes)) {
        this.dispatch(entry.rule, hit);
      }
    }
  }

  private evaluateTrigger(entry: CompiledAlertRule, changes: RowChangeSet): AlertHit[] {
    const trigger = entry.rule.trigger;
    const hits: AlertHit[] = [];
    if (trigger.kind === 'dataChange') {
      const cond = entry.compiled as Compiled; // always set for validated dataChange rules
      if (trigger.columnIds !== undefined) {
        // Restricted: per changed cell in the listed columns; the event colId
        // is that cell's. NOTE: an empty columnIds array restricts to zero
        // columns (never fires), and added rows carry no ChangeRecords, so
        // restricted rules never fire on adds.
        const watched = new Set(trigger.columnIds);
        for (const upd of changes.updated) {
          for (const cell of upd.cells) {
            if (!watched.has(cell.colId)) continue;
            if (!this.matches(cond, upd.row)) continue;
            hits.push({ rowId: upd.rowId, colId: cell.colId, value: cell.newValue, prev: cell.oldValue });
          }
        }
      } else {
        // Unrestricted: once per updated row AND once per added row, against
        // the post-change row. No single triggering cell → colId/value/prev null.
        for (const upd of changes.updated) {
          if (this.matches(cond, upd.row)) hits.push({ rowId: upd.rowId, colId: null, value: null, prev: null });
        }
        for (const add of changes.added) {
          if (this.matches(cond, add.row)) hits.push({ rowId: add.rowId, colId: null, value: null, prev: null });
        }
      }
    } else if (trigger.kind === 'relativeChange') {
      for (const upd of changes.updated) {
        for (const cell of upd.cells) {
          if (cell.colId !== trigger.colId) continue;
          const oldV = cell.oldValue;
          const newV = cell.newValue;
          if (typeof oldV !== 'number' || typeof newV !== 'number') continue;
          if (!Number.isFinite(oldV) || !Number.isFinite(newV)) continue;
          if (!relativeChangeFires(trigger, oldV, newV)) continue;
          hits.push({ rowId: upd.rowId, colId: cell.colId, value: newV, prev: oldV });
        }
      }
    } else {
      const source = trigger.mode === 'ROW_ADDED' ? changes.added : changes.removed;
      for (const rec of source) hits.push({ rowId: rec.rowId, colId: null, value: null, prev: null });
    }
    return hits;
  }

  /** Strict-boolean condition check. Evaluation errors (EvalError or anything
   *  else) → non-matching: evaluators never throw (StarUI doc 04). */
  private matches(cond: Compiled, row: Record<string, unknown>): boolean {
    try {
      return evaluate(cond, { row }) === true;
    } catch {
      return false;
    }
  }

  private dispatch(rule: AlertRule, hit: AlertHit): void {
    // 1. Channel filter — an event whose channels are all disabled is
    //    suppressed BEFORE any debounce/bucket accounting (spec §4.3). The
    //    emitted event carries the enabled intersection: the host must never
    //    be handed a disabled channel to route to.
    const channels = rule.channels.filter((c) => this.settings.enabledChannels[c]);
    if (channels.length === 0) return;

    // 2. Debounce on (ruleId, rowId). debounceMs 0/undefined falls back to
    //    defaultDebounceMs (spec §3.2 — hence `||`, not `??`). Passing the
    //    gate stamps the window even when the bucket then drops: pipeline
    //    order is debounce → bucket (spec §4.3), which prevents retry storms.
    const windowMs = rule.debounceMs || this.settings.defaultDebounceMs;
    const key = `${rule.id} ${hit.rowId}`;
    const nowMs = this.nowFn();
    const last = this.debounceLast.get(key);
    if (last !== undefined && nowMs - last < windowMs) return;
    this.debounceLast.set(key, nowMs);

    // 3. Global token bucket.
    if (!this.bucket.tryTake()) {
      this.dropped += 1;
      return;
    }

    // 4. Render, record, emit.
    const message = renderMessage(rule.message, {
      rule: rule.name,
      rowId: hit.rowId,
      column: hit.colId,
      value: hit.value,
      prev: hit.prev,
    });
    const event: AlertEvent = {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      message,
      rowId: hit.rowId,
      colId: hit.colId,
      value: hit.value,
      prev: hit.prev,
      channels,
      seq: ++this.seqCounter, // monotonic, starts at 1; hosts stamp wall-clock
    };
    this.pushHistory(event);
    this.unread += 1;
    // A throwing subscriber must not block later subscribers or abort the
    // rest of applyChanges (Task 7 review fix). Swallow and keep going.
    for (const fn of [...this.listeners]) {
      try {
        fn(event);
      } catch {
        // Diagnostic-only; subscribers own their own error reporting.
      }
    }
  }

  private pushHistory(event: AlertEvent): void {
    const limit = this.settings.historyLimit;
    if (limit <= 0) return;
    if (this.ring.length < limit) {
      this.ring.push(event);
    } else {
      this.ring[this.nextWrite] = event;
      this.nextWrite = (this.nextWrite + 1) % limit;
    }
  }
}
