/** Format engine — value formatters + ribbon style patches with undo. */

import { compileFormat, type FormatterFn } from './formatters';

export {
  compileFormat,
  createNumberFormatter,
  createCurrencyFormatter,
  createPercentFormatter,
  createDateFormatter,
  type FormatterFn,
} from './formatters';

export type FormatPatch = {
  colIds: string[];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  format?: string;
  foreground?: string;
  background?: string;
};

export type ResolvedColFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  foreground?: string;
  background?: string;
  format?: string;
  formatter?: FormatterFn;
};

export class FormatEngine {
  private patches: FormatPatch[] = [];
  private undoStack: FormatPatch[][] = [];
  private redoStack: FormatPatch[][] = [];
  private resolved = new Map<string, ResolvedColFormat>();

  apply(patch: FormatPatch): void {
    this.undoStack.push(this.clonePatches());
    this.redoStack = [];
    this.patches.push({ ...patch, colIds: [...patch.colIds] });
    this.rebuild();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.clonePatches());
    this.patches = prev;
    this.rebuild();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.clonePatches());
    this.patches = next;
    this.rebuild();
    return true;
  }

  getPatches(): FormatPatch[] {
    return this.clonePatches();
  }

  clear(): void {
    this.undoStack.push(this.clonePatches());
    this.redoStack = [];
    this.patches = [];
    this.rebuild();
  }

  /** Merged style + formatter for a column (last patch wins per field). */
  resolve(colId: string): ResolvedColFormat {
    return this.resolved.get(colId) ?? {};
  }

  formatValue(colId: string, value: unknown): string {
    const r = this.resolve(colId);
    if (r.formatter) return r.formatter(value);
    return value == null ? '' : String(value);
  }

  private clonePatches(): FormatPatch[] {
    return this.patches.map((p) => ({ ...p, colIds: [...p.colIds] }));
  }

  private rebuild(): void {
    this.resolved.clear();
    for (const patch of this.patches) {
      for (const colId of patch.colIds) {
        const cur = { ...(this.resolved.get(colId) ?? {}) };
        if (patch.bold !== undefined) cur.bold = patch.bold;
        if (patch.italic !== undefined) cur.italic = patch.italic;
        if (patch.underline !== undefined) cur.underline = patch.underline;
        if (patch.align !== undefined) cur.align = patch.align;
        if (patch.foreground !== undefined) cur.foreground = patch.foreground;
        if (patch.background !== undefined) cur.background = patch.background;
        if (patch.format !== undefined) {
          cur.format = patch.format;
          cur.formatter = compileFormat(patch.format);
        }
        this.resolved.set(colId, cur);
      }
    }
  }
}
