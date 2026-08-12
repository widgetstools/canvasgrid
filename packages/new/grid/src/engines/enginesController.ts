import {
  EnginesHost,
  type AlertEvent,
  type AlertRule,
  type CalcColumn,
  type EditOp,
  type FormatPatch,
  type StyleRule,
} from '@wellsfargo-starui/vg-new-engines';

/**
 * Grid-side engines controller — owns EnginesHost lifecycle + paint helpers.
 */
export class EnginesController {
  readonly host: EnginesHost;
  private expressionHost: unknown | null = null;
  private expressionOutputs: string[] = [];

  constructor(opts?: { onAlert?: (ev: AlertEvent) => void }) {
    this.host = new EnginesHost({ onAlert: opts?.onAlert });
  }

  applyFormat(patch: FormatPatch): void {
    this.host.applyFormat(patch);
  }

  undoFormat(): boolean {
    return this.host.format.undo();
  }

  redoFormat(): boolean {
    return this.host.format.redo();
  }

  clearFormat(): void {
    this.host.format.clear();
  }

  setStyleRules(rules: StyleRule[]): void {
    this.host.setStyleRules(rules);
  }

  setCalcColumns(cols: CalcColumn[]): void {
    this.host.setCalcColumns(cols);
    this.expressionOutputs = this.host.calcOutputIds();
  }

  setAlertRules(rules: AlertRule[]): void {
    this.host.setAlertRules(rules);
  }

  formatCell(colId: string, value: unknown): string {
    return this.host.formatValue(colId, value);
  }

  styleCell(
    row: Record<string, unknown>,
    colId: string,
  ): { backgroundColor?: string; color?: string; fontWeight?: string } | undefined {
    const rule = this.host.cellStyle(row, colId);
    if (!rule) return undefined;
    return {
      backgroundColor: rule.backgroundColor,
      color: rule.color,
      fontWeight: rule.fontWeight,
    };
  }

  enrichRow(row: Record<string, unknown>): Record<string, unknown> {
    return this.host.enrichRow(row);
  }

  applyEdit(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
    colId: string,
    rowIds: string[],
    op: EditOp,
  ): Array<Record<string, unknown>> {
    return this.host.applyEdit(rows, getId, colId, rowIds, op);
  }

  undoEdit(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
  ): Array<Record<string, unknown>> {
    return this.host.edit.undo(rows, getId);
  }

  redoEdit(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
  ): Array<Record<string, unknown>> {
    return this.host.edit.redo(rows, getId);
  }

  evaluateAlerts(row: Record<string, unknown>, rowId: string): AlertEvent[] {
    return this.host.evaluateAlerts(row, rowId);
  }

  unreadAlertCount(): number {
    return this.host.unreadAlertCount();
  }

  setSsrmExpressionHost(host: unknown | null): void {
    this.expressionHost = host;
  }

  getSsrmExpressionHost(): unknown | null {
    return this.expressionHost;
  }

  setSsrmExpressionOutputs(ids: readonly string[]): void {
    this.expressionOutputs = ids.slice();
  }

  getSsrmExpressionOutputs(): string[] {
    return this.expressionOutputs.slice();
  }

  /** Format resolve for paint — bold/align/colors from ribbon patches. */
  resolveColFormat(colId: string) {
    return this.host.resolveFormat(colId);
  }
}
