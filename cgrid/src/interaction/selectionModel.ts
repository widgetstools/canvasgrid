export type SelectionMode = 'none' | 'single' | 'multiple';

export interface SelectionState {
  focusedRowIndex: number | null;
  focusedColId: string | null;
  selectedRowIndices: Set<number>;
}

export class SelectionModel {
  private _state: SelectionState = {
    focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set(),
  };
  private listeners = new Set<(s: Readonly<SelectionState>) => void>();

  constructor(private mode: SelectionMode) {}

  get state(): Readonly<SelectionState> { return this._state; }

  setFocus(rowIndex: number | null, colId: string | null): void {
    if (this._state.focusedRowIndex === rowIndex && this._state.focusedColId === colId) return;
    this._state.focusedRowIndex = rowIndex;
    this._state.focusedColId = colId;
    this.emit();
  }

  selectSingle(rowIndex: number): void {
    if (this.mode === 'none') return;
    this._state.selectedRowIndices.clear();
    this._state.selectedRowIndices.add(rowIndex);
    this.emit();
  }

  toggleMulti(rowIndex: number): void {
    if (this.mode === 'none') return;
    if (this.mode === 'single') return this.selectSingle(rowIndex);
    if (this._state.selectedRowIndices.has(rowIndex)) this._state.selectedRowIndices.delete(rowIndex);
    else this._state.selectedRowIndices.add(rowIndex);
    this.emit();
  }

  range(fromRowIndex: number, toRowIndex: number): void {
    if (this.mode !== 'multiple') return;
    const lo = Math.min(fromRowIndex, toRowIndex);
    const hi = Math.max(fromRowIndex, toRowIndex);
    for (let i = lo; i <= hi; i++) this._state.selectedRowIndices.add(i);
    this.emit();
  }

  clear(): void {
    this._state.selectedRowIndices.clear();
    this.emit();
  }

  onChange(fn: (s: Readonly<SelectionState>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this._state);
  }
}
