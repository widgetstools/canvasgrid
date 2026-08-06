/**
 * Session undo/redo for ribbon formatting (styles, formats, templates,
 * column-override assignments). Distinct from `@cgrid/edit`'s cell-value
 * journal — this stack snapshots calc `templates` + `columnOverrides` and
 * restores them via `setState`, matching stern-bak's column-customization
 * HistoryStack. Cleared when a layout is saved / switched.
 */
export interface FormatHistorySnapshot {
  templates: unknown[];
  overrides: unknown[];
}

export interface FormatHistoryGrid {
  getTemplates(): unknown[];
  getState(): { modules?: Record<string, { data?: unknown }> };
  setState(snapshot: { version: number; modules: Record<string, { version: number; data: unknown }> }): void;
}

/** Bounded past/future stacks — same shape as stern-bak HistoryStack. */
export class HistoryStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private readonly limit = 50) {}

  push(snapshot: T): void {
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past = this.past.slice(this.past.length - this.limit);
    this.future = [];
  }

  undo(current: T): T | undefined {
    if (this.past.length === 0) return undefined;
    const previous = this.past.pop()!;
    this.future.push(current);
    if (this.future.length > this.limit) {
      this.future = this.future.slice(this.future.length - this.limit);
    }
    return previous;
  }

  redo(current: T): T | undefined {
    if (this.future.length === 0) return undefined;
    const next = this.future.pop()!;
    this.past.push(current);
    if (this.past.length > this.limit) {
      this.past = this.past.slice(this.past.length - this.limit);
    }
    return next;
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }
  reset(): void { this.past = []; this.future = []; }
}

export function captureFormatSnapshot(grid: FormatHistoryGrid): FormatHistorySnapshot {
  let templates: unknown[] = [];
  try { templates = structuredClone(grid.getTemplates() ?? []); } catch { templates = []; }
  let overrides: unknown[] = [];
  try {
    const data = grid.getState()?.modules?.columnOverrides?.data;
    overrides = Array.isArray(data) ? structuredClone(data) : [];
  } catch { overrides = []; }
  return { templates, overrides };
}

export function restoreFormatSnapshot(grid: FormatHistoryGrid, snap: FormatHistorySnapshot): void {
  grid.setState({
    version: 4,
    modules: {
      templates: { version: 1, data: snap.templates },
      columnOverrides: { version: 1, data: snap.overrides },
    },
  });
}

export interface FormatHistoryController {
  /** Snapshot current formatting state onto the past stack (call BEFORE mutate). */
  push(): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  reset(): void;
  subscribe(fn: () => void): () => void;
}

export function createFormatHistory(grid: FormatHistoryGrid): FormatHistoryController {
  const stack = new HistoryStack<FormatHistorySnapshot>();
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const fn of listeners) { try { fn(); } catch { /* ignore */ } } };

  return {
    push() {
      stack.push(captureFormatSnapshot(grid));
      notify();
    },
    undo() {
      const prev = stack.undo(captureFormatSnapshot(grid));
      if (prev === undefined) return false;
      restoreFormatSnapshot(grid, prev);
      notify();
      return true;
    },
    redo() {
      const next = stack.redo(captureFormatSnapshot(grid));
      if (next === undefined) return false;
      restoreFormatSnapshot(grid, next);
      notify();
      return true;
    },
    canUndo: () => stack.canUndo(),
    canRedo: () => stack.canRedo(),
    reset() { stack.reset(); notify(); },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
