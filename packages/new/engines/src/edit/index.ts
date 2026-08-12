/** Smart edit / bulk / nudge / shortcuts / history. */

export type EditOp =
  | { type: 'multiply'; factor: number }
  | { type: 'add'; delta: number }
  | { type: 'set'; value: unknown };

export type EditEntry = {
  at: number;
  colId: string;
  rowIds: string[];
  op: EditOp;
  previous: Array<{ id: string; value: unknown }>;
};

export class EditEngine {
  private history: EditEntry[] = [];
  private suspended = false;
  private shortcuts = new Map<string, EditOp>();

  setSuspended(v: boolean): void {
    this.suspended = v;
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  bindShortcut(key: string, op: EditOp): void {
    this.shortcuts.set(key.toLowerCase(), op);
  }

  getShortcut(key: string): EditOp | undefined {
    return this.shortcuts.get(key.toLowerCase());
  }

  apply(
    rows: Array<Record<string, unknown>>,
    getId: (r: Record<string, unknown>) => string,
    colId: string,
    rowIds: string[],
    op: EditOp,
  ): Array<Record<string, unknown>> {
    if (this.suspended) return rows;
    const idSet = new Set(rowIds);
    const previous: EditEntry['previous'] = [];
    const next = rows.map((r) => {
      const id = getId(r);
      if (!idSet.has(id)) return r;
      previous.push({ id, value: r[colId] });
      const cur = Number(r[colId]);
      let value: unknown = r[colId];
      if (op.type === 'set') value = op.value;
      else if (!Number.isNaN(cur)) {
        if (op.type === 'multiply') value = cur * op.factor;
        if (op.type === 'add') value = cur + op.delta;
      }
      return { ...r, [colId]: value };
    });
    this.history.push({ at: Date.now(), colId, rowIds, op, previous });
    return next;
  }

  undo(rows: Array<Record<string, unknown>>, getId: (r: Record<string, unknown>) => string): Array<Record<string, unknown>> {
    const entry = this.history.pop();
    if (!entry) return rows;
    const byId = new Map(entry.previous.map((p) => [p.id, p.value]));
    return rows.map((r) => {
      const id = getId(r);
      if (!byId.has(id)) return r;
      return { ...r, [entry.colId]: byId.get(id) };
    });
  }

  getHistory(): EditEntry[] {
    return this.history.slice();
  }
}
