// @cgrid/rules — public types.
// Authoritative reference: docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md
// §3.1 (rule shapes), §3.2 (alert shapes), §4.2 (engine contracts).

import type { Loc } from '@cgrid/expression';
import type { FormatProgram } from '@cgrid/format';

export type ThemeKind = 'light' | 'dark';

export interface StyleSlice {
  color?: string;
  backgroundColor?: string;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  borderColor?: string;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted';
}

/** Theme-aware style: `base` applies to both themes; `light`/`dark`
 *  slices override per-property on top of `base`. */
export interface ThemeAwareStyle {
  base?: StyleSlice;
  light?: StyleSlice;
  dark?: StyleSlice;
}

export interface FlashConfig {
  enabled: boolean;
  target: 'cell' | 'row';
  mode: 'fade' | 'pulse' | 'glow';
  /** CSS color; drives the kernel flash blend for this rule's activations. */
  color: string;
  durationMs: number;
}

export interface RuleIndicator {
  /** Lucide icon name resolved through the kernel icon registry. */
  iconName: string;
  color: string;
  target: 'cell' | 'row-start' | 'row-end';
  position: 'before' | 'after';
}

export type RuleScope =
  | { kind: 'cell'; columnIds: string[] }
  | { kind: 'row' };

export interface RuleBase {
  id: string;
  name: string;
  enabled: boolean;
  /** Lower applies first; later (higher) rules override per-property on conflict. */
  priority: number;
  /** Boolean expression over row fields; supports `[col]`, `[col.old]`, `[col.new]`. */
  condition: string;
  scope: RuleScope;
}

export interface ConditionalStyleRule extends RuleBase {
  kind: 'style';
  style: ThemeAwareStyle;
  flash?: FlashConfig;
  indicator?: RuleIndicator;
  /** Format-DSL string (any tier @cgrid/format compiles); matching cells
   *  render through this program instead of the ColDef formatter. */
  valueFormatter?: string;
  /** Auto-expire: the match stays active this long after activation, then
   *  drops (blink-on-change UX). Activation = condition transitions
   *  false→true for a (rowId, colId) via a change record. */
  activeDurationMs?: number;
}

export interface IndicatorRule extends RuleBase {
  kind: 'indicator';
  indicator: RuleIndicator;
}

export type StyleRule = ConditionalStyleRule | IndicatorRule;

// ─── Alerts ────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'success' | 'warning' | 'critical';
export type AlertChannel = 'toast' | 'badge' | 'openfin';

export type AlertTrigger =
  | { kind: 'dataChange'; expression: string; columnIds?: string[] }
  | {
      kind: 'relativeChange';
      /** Column whose ChangeRecords are watched (repo vocabulary: colId;
       *  the StarUI source doc's `columnId` is not binding here). */
      colId: string;
      mode: 'PERCENT_CHANGE' | 'ABSOLUTE_CHANGE' | 'ANY_CHANGE';
      /** Required for PERCENT_CHANGE (percent points) and ABSOLUTE_CHANGE;
       *  ignored for ANY_CHANGE. */
      threshold: number;
      direction: 'up' | 'down' | 'both';
    }
  | { kind: 'rowChange'; mode: 'ROW_ADDED' | 'ROW_REMOVED' };

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  severity: AlertSeverity;
  trigger: AlertTrigger;
  /** Template with {rule} {rowId} {column} {value} {prev} placeholders. */
  message: string;
  channels: AlertChannel[];
  /** Same rule won't fire twice for the same rowId within this window.
   *  0/undefined → settings.defaultDebounceMs. */
  debounceMs?: number;
}

export interface AlertEvent {
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  /** Rendered message (placeholders substituted). */
  message: string;
  rowId: string;
  /** Column that triggered; null for rowChange + unrestricted dataChange. */
  colId: string | null;
  value: unknown;
  prev: unknown;
  channels: AlertChannel[];
  /** Engine-assigned monotonic sequence (not wall-clock; hosts stamp their own). */
  seq: number;
}

export interface AlertsSettings {
  enabled: boolean;
  defaultDebounceMs: number;
  maxNotificationsPerSecond: number;
  historyLimit: number;
  enabledChannels: Record<AlertChannel, boolean>;
  evaluationMode: 'realtime' | 'throttled' | 'paused';
}

export const DEFAULT_ALERTS_SETTINGS: AlertsSettings = {
  enabled: true,
  defaultDebounceMs: 1000,
  maxNotificationsPerSecond: 10,
  historyLimit: 200,
  enabledChannels: { toast: true, badge: true, openfin: true },
  evaluationMode: 'realtime',
};

// ─── Engine contracts ──────────────────────────────────────────────────

export interface RuleEvalContext {
  row: Record<string, unknown>;
  rowId: string;
  /** null → row-scope evaluation (no cell column). */
  colId: string | null;
  theme: ThemeKind;
}

export interface RuleCellResult {
  /** Matched rule ids in application order (priority asc). Empty = no match. */
  matched: string[];
  /** Folded flat style for the active theme; null when no style rule matched. */
  style: StyleSlice | null;
  indicator: RuleIndicator | null;
  /** Compiled program from the winning rule's valueFormatter; null when none. */
  formatProgram: FormatProgram | null;
}

export interface RuleValidationError {
  ruleId: string;
  code:
    | 'parse'
    | 'unknown-fn'
    | 'arity'
    | 'not-yet-implemented'
    | 'bad-shape'
    | 'format-compile';
  message: string;
  loc: Loc | null;
}

export interface SetRulesResult {
  ok: boolean;
  errors: RuleValidationError[];
}

export interface ChangeRecord {
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface RowChangeSet {
  added: Array<{ rowId: string; row: Record<string, unknown> }>;
  updated: Array<{
    rowId: string;
    row: Record<string, unknown>;
    cells: ChangeRecord[];
  }>;
  removed: Array<{ rowId: string; row: Record<string, unknown> }>;
}

export interface FlashDirective {
  rowId: string;
  /** null → whole row. */
  colIds: string[] | null;
  color: string;
  mode: 'fade' | 'pulse' | 'glow';
  durationMs: number;
}

export type Unsubscribe = () => void;

export interface WireRulesOptions {
  rules?: StyleRule[];
  alertRules?: AlertRule[];
  alertsSettings?: Partial<AlertsSettings>;
  schema?: import('@cgrid/expression').Schema;
}
