import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

interface DateStringParams {
  min?: string | Date;
  max?: string | Date;
  step?: number | string;
  includeTime?: boolean;
}

function toIsoDateString(v: string | Date): string {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v;
}

export class DateStringCellEditor implements ICellEditor<unknown, string> {
  private input!: HTMLInputElement;
  private params!: ICellEditorParams<unknown, string>;
  private keydownHandler!: (e: KeyboardEvent) => void;

  init(params: ICellEditorParams<unknown, string>): void {
    this.params = params;
    const dsParams = (params.params ?? {}) as DateStringParams;
    const input = document.createElement('input');
    input.type = dsParams.includeTime ? 'datetime-local' : 'date';
    input.className = 'vg-cell-editor vg-cell-editor--date-string';
    input.value = params.value == null ? '' : String(params.value);
    if (dsParams.min != null) input.min = toIsoDateString(dsParams.min);
    if (dsParams.max != null) input.max = toIsoDateString(dsParams.max);
    if (dsParams.step != null) input.step = String(dsParams.step);
    input.style.cssText =
      'box-sizing:border-box; width:100%; height:100%; ' +
      'border:0; padding:0 8px; margin:0; ' +
      'background:var(--vg-cell-editor-bg, var(--vg-bg-color, #fff)); color:var(--vg-text-color, var(--vg-fg-color, #111)); ' +
      'font-family:var(--vg-font-family, inherit); font-size:var(--vg-font-size, inherit); ' +
      'outline:2px solid var(--vg-focus-ring-color, #4a90e2);';
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        this.params.stopEditing(false);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        this.params.stopEditing(true);
      }
    };
    input.addEventListener('keydown', this.keydownHandler);
    this.input = input;
  }

  getGui(): HTMLElement { return this.input; }
  getValue(): string { return this.input.value; }

  destroy(): void {
    this.input.removeEventListener('keydown', this.keydownHandler);
  }

  afterGuiAttached(): void {
    this.input.focus();
  }

  focusIn(): void { this.input.focus(); }
  focusOut(): void { this.input.blur(); }
}
