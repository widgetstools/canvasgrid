/**
 * EnginesHost — single facade wired into VelocityGrid / Ext.
 */
import { AlertsEngine, type AlertEvent, type AlertRule } from './alerts/index';
import { CalcEngine, type CalcColumn } from './calc/index';
import { EditEngine, type EditOp } from './edit/index';
import { FormatEngine, type FormatPatch, type ResolvedColFormat } from './format/index';
import { RulesEngine, type StyleRule } from './rules/index';

export type EnginesHostOptions = {
  onAlert?: (ev: AlertEvent) => void;
};

export class EnginesHost {
  readonly format = new FormatEngine();
  readonly rules = new RulesEngine();
  readonly calc = new CalcEngine();
  readonly edit = new EditEngine();
  readonly alerts: AlertsEngine;

  constructor(opts: EnginesHostOptions = {}) {
    this.alerts = new AlertsEngine();
    if (opts.onAlert) this.alerts.setOnFire(opts.onAlert);
  }

  // ── format ──────────────────────────────────────────────────────────
  applyFormat(patch: FormatPatch): void {
    this.format.apply(patch);
  }

  resolveFormat(colId: string): ResolvedColFormat {
    return this.format.resolve(colId);
  }

  formatValue(colId: string, value: unknown): string {
    return this.format.formatValue(colId, value);
  }

  // ── rules ───────────────────────────────────────────────────────────
  setStyleRules(rules: StyleRule[]): void {
    this.rules.setRules(rules);
  }

  hasStyleRules(): boolean {
    return this.rules.getRules().length > 0;
  }

  cellStyle(
    row: Record<string, unknown>,
    colId: string,
  ): StyleRule['style'] | undefined {
    return this.rules.styleFor(row, colId);
  }

  // ── calc ────────────────────────────────────────────────────────────
  setCalcColumns(cols: CalcColumn[]): void {
    this.calc.setColumns(cols);
  }

  enrichRow(row: Record<string, unknown>): Record<string, unknown> {
    return this.calc.enrich(row);
  }

  calcOutputIds(): string[] {
    return this.calc.outputIds();
  }

  toPerspectiveExpressions(): Record<string, string> {
    return this.calc.toPerspectiveExpressions();
  }

  // ── edit ────────────────────────────────────────────────────────────
  applyEdit(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
    colId: string,
    rowIds: string[],
    op: EditOp,
  ): Array<Record<string, unknown>> {
    return this.edit.apply(rows, getId, colId, rowIds, op);
  }

  // ── alerts ──────────────────────────────────────────────────────────
  setAlertRules(rules: AlertRule[]): void {
    this.alerts.setRules(rules);
  }

  evaluateAlerts(
    row: Record<string, unknown>,
    rowId: string,
  ): AlertEvent[] {
    return this.alerts.evaluateRow(row, rowId);
  }

  unreadAlertCount(): number {
    return this.alerts.unreadCount();
  }
}
