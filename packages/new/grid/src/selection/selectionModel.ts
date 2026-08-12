/**
 * Row selection with group cascade (descendants mode).
 */

export type GroupSelectsMode = 'none' | 'self' | 'descendants';

export class SelectionModel {
  private readonly selected = new Set<string>();
  private groupSelects: GroupSelectsMode = 'descendants';

  constructor(
    private readonly resolveDescendants: (groupKey: string) => string[],
  ) {}

  setGroupSelects(mode: GroupSelectsMode): void {
    this.groupSelects = mode;
  }

  getSelectedIds(): string[] {
    return [...this.selected];
  }

  clear(): void {
    this.selected.clear();
  }

  isSelected(id: string): boolean {
    return this.selected.has(id);
  }

  setSelected(id: string, on: boolean): void {
    if (on) this.selected.add(id);
    else this.selected.delete(id);
  }

  toggle(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  /**
   * Cascade select a group. Returns the leaf ids that changed.
   * `partial` / `all` / `none` tri-state via getGroupSelectionState.
   */
  setGroupSelected(groupKey: string, on: boolean): string[] {
    if (this.groupSelects === 'none') return [];
    const ids = this.groupSelects === 'self' ? [groupKey] : this.resolveDescendants(groupKey);
    for (const id of ids) {
      if (on) this.selected.add(id);
      else this.selected.delete(id);
    }
    return ids;
  }

  getGroupSelectionState(groupKey: string): 'all' | 'none' | 'partial' {
    const ids = this.resolveDescendants(groupKey);
    if (ids.length === 0) return 'none';
    let n = 0;
    for (const id of ids) if (this.selected.has(id)) n++;
    if (n === 0) return 'none';
    if (n === ids.length) return 'all';
    return 'partial';
  }
}
