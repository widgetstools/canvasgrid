/** Cell / header format ops (ribbon). */

export type FormatPatch = {
  colIds: string[];
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  format?: string;
  foreground?: string;
  background?: string;
};

export class FormatEngine {
  private patches: FormatPatch[] = [];
  private undoStack: FormatPatch[][] = [];

  apply(patch: FormatPatch): void {
    this.undoStack.push(this.patches.map((p) => ({ ...p, colIds: [...p.colIds] })));
    this.patches.push(patch);
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.patches = prev;
    return true;
  }

  getPatches(): FormatPatch[] {
    return this.patches.slice();
  }

  clear(): void {
    this.undoStack.push(this.patches.slice());
    this.patches = [];
  }
}
