/**
 * Edit engine — smart/bulk/nudge/shortcuts + undo/redo journal.
 */
import { applyNumericOp, type SmartEditOp } from './numericOps';

export { applyNumericOp, isNumericCellDataType, type SmartEditOp } from './numericOps';

export type EditOp =
  | { type: 'multiply'; factor: number }
  | { type: 'divide'; factor: number }
  | { type: 'add'; delta: number }
  | { type: 'subtract'; delta: number }
  | { type: 'set'; value: unknown }
  | { type: 'nudge'; steps: number; stepSize: number };

export type EditEntry = {
  at: number;
  colId: string;
  rowIds: string[];
  op: EditOp;
  previous: Array<{ id: string; value: unknown }>;
  label?: string;
};

function toSmart(op: EditOp): { smart: SmartEditOp; operand: number } | null {
  switch (op.type) {
    case 'multiply': return { smart: 'multiply', operand: op.factor };
    case 'divide': return { smart: 'divide', operand: op.factor };
    case 'add': return { smart: 'add', operand: op.delta };
    case 'subtract': return { smart: 'subtract', operand: op.delta };
    case 'set': return { smart: 'set', operand: Number(op.value) };
    case 'nudge': return { smart: 'add', operand: op.steps * op.stepSize };
  }
}

export class EditEngine {
  private undoStack: EditEntry[] = [];
  private redoStack: EditEntry[] = [];
  private suspended = false;
  private shortcuts = new Map<string, EditOp>();
  private readonly now: () => number;

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now());
  }

  setSuspended(v: boolean): void {
    this.suspended = v;
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  bindShortcut(key: string, op: EditOp): void {
    this.shortcuts.set(key.toLowerCase(), op);
  }

  unbindShortcut(key: string): void {
    this.shortcuts.delete(key.toLowerCase());
  }

  getShortcut(key: string): EditOp | undefined {
    return this.shortcuts.get(key.toLowerCase());
  }

  /** Bulk / smart / nudge apply — records journal entry. */
  apply(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
    colId: string,
    rowIds: string[],
    op: EditOp,
    label?: string,
  ): Array<Record<string, unknown>> {
    if (this.suspended) return rows;
    const idSet = new Set(rowIds);
    const previous: EditEntry['previous'] = [];
    const smart = toSmart(op);
    const next = rows.map((r) => {
      const id = getId(r);
      if (!idSet.has(id)) return r;
      previous.push({ id, value: r[colId] });
      if (op.type === 'set' && (typeof op.value !== 'number' || !Number.isFinite(Number(op.value)))) {
        // Non-numeric set — allow any value when current path isn't numeric-op.
        if (smart && Number.isNaN(Number(op.value))) {
          return { ...r, [colId]: op.value };
        }
      }
      if (!smart) return r;
      const value = applyNumericOp(r[colId], smart.smart, smart.operand);
      if (value === null && op.type !== 'set') return r;
      if (op.type === 'set' && value === null) {
        return { ...r, [colId]: op.value };
      }
      return { ...r, [colId]: value ?? r[colId] };
    });
    if (previous.length) {
      this.undoStack.push({
        at: this.now(),
        colId,
        rowIds: [...rowIds],
        op,
        previous,
        label,
      });
      this.redoStack = [];
    }
    return next;
  }

  /** Nudge selected cells by ±N steps. */
  nudge(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
    colId: string,
    rowIds: string[],
    steps: number,
    stepSize = 1,
  ): Array<Record<string, unknown>> {
    return this.apply(rows, getId, colId, rowIds, { type: 'nudge', steps, stepSize }, 'nudge');
  }

  undo(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
  ): Array<Record<string, unknown>> {
    const entry = this.undoStack.pop();
    if (!entry) return rows;
    this.redoStack.push(entry);
    const byId = new Map(entry.previous.map((p) => [p.id, p.value]));
    return rows.map((r) => {
      const id = getId(r);
      if (!byId.has(id)) return r;
      return { ...r, [entry.colId]: byId.get(id) };
    });
  }

  redo(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
  ): Array<Record<string, unknown>> {
    const entry = this.redoStack.pop();
    if (!entry) return rows;
    // Re-apply forward
    return this.apply(rows, getId, entry.colId, entry.rowIds, entry.op, entry.label);
  }

  getHistory(): EditEntry[] {
    return this.undoStack.slice();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
