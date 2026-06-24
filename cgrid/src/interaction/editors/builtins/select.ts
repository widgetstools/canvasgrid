import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

interface SelectParams<TValue> {
  values: TValue[];
  valueListMaxHeight?: number | string;
  valueListMaxWidth?: number | string;
}

function toCssLength(v: number | string | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

export class SelectCellEditor<TValue = unknown> implements ICellEditor<unknown, TValue> {
  private select!: HTMLSelectElement;
  private params!: ICellEditorParams<unknown, TValue>;
  private values: TValue[] = [];
  private keydownHandler!: (e: KeyboardEvent) => void;
  private changeHandler!: () => void;

  init(params: ICellEditorParams<unknown, TValue>): void {
    this.params = params;
    const selectParams = (params.params ?? {}) as unknown as SelectParams<TValue>;
    this.values = Array.isArray(selectParams.values) ? selectParams.values : [];
    const select = document.createElement('select');
    select.className = 'cg-cell-editor cg-cell-editor--select';
    for (let i = 0; i < this.values.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(this.values[i]);
      select.appendChild(opt);
    }
    const initialIdx = this.values.findIndex((v) => v === params.value);
    if (initialIdx >= 0) select.selectedIndex = initialIdx;
    const maxH = toCssLength(selectParams.valueListMaxHeight);
    if (maxH != null) select.style.maxHeight = maxH;
    const maxW = toCssLength(selectParams.valueListMaxWidth);
    if (maxW != null) select.style.maxWidth = maxW;
    select.style.cssText +=
      'box-sizing:border-box; width:100%; height:100%; ' +
      'border:0; padding:0 8px; margin:0; ' +
      'background:var(--cg-cell-editor-bg, var(--cg-bg-color, #fff)); color:var(--cg-text-color, var(--cg-fg-color, #111)); ' +
      'font-family:var(--cg-font-family, inherit); font-size:var(--cg-font-size, inherit); ' +
      'outline:2px solid var(--cg-focus-ring-color, #4a90e2);';
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        this.params.stopEditing(false);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        this.params.stopEditing(true);
      }
    };
    // Single-click select commit — ag-grid's default behaviour. The user
    // shouldn't have to press Enter after picking an option.
    this.changeHandler = () => this.params.stopEditing(false);
    select.addEventListener('keydown', this.keydownHandler);
    select.addEventListener('change', this.changeHandler);
    this.select = select;
  }

  getGui(): HTMLElement { return this.select; }

  getValue(): TValue | null {
    const idx = this.select.selectedIndex;
    if (idx < 0 || idx >= this.values.length) return null;
    return this.values[idx] as TValue;
  }

  destroy(): void {
    this.select.removeEventListener('keydown', this.keydownHandler);
    this.select.removeEventListener('change', this.changeHandler);
  }

  afterGuiAttached(): void {
    this.select.focus();
  }

  focusIn(): void { this.select.focus(); }
  focusOut(): void { this.select.blur(); }
}
