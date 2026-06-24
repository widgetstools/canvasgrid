import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

interface NumberParams {
  min?: number;
  max?: number;
  precision?: number;
  step?: number;
  showStepperButtons?: boolean;
  preventStepping?: boolean;
}

export class NumberCellEditor implements ICellEditor<unknown, number> {
  private input!: HTMLInputElement;
  private params!: ICellEditorParams<unknown, number>;
  private numberParams!: NumberParams;
  private keydownHandler!: (e: KeyboardEvent) => void;

  init(params: ICellEditorParams<unknown, number>): void {
    this.params = params;
    this.numberParams = (params.params ?? {}) as NumberParams;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'cg-cell-editor cg-cell-editor--number';
    const initial = params.charPress ?? (params.value == null ? '' : String(params.value));
    input.value = initial;
    if (this.numberParams.min != null) input.min = String(this.numberParams.min);
    if (this.numberParams.max != null) input.max = String(this.numberParams.max);
    if (this.numberParams.step != null) input.step = String(this.numberParams.step);
    if (this.numberParams.preventStepping) {
      input.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    }
    input.style.cssText =
      'box-sizing:border-box; width:100%; height:100%; ' +
      'border:0; padding:0 8px; margin:0; ' +
      'background:var(--cg-cell-editor-bg, var(--cg-bg-color, #fff)); color:var(--cg-text-color, var(--cg-fg-color, #111)); ' +
      'font-family:var(--cg-font-family, inherit); font-size:var(--cg-font-size, inherit); ' +
      'outline:2px solid var(--cg-focus-ring-color, #4a90e2); text-align:right;';
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

  getValue(): number | null {
    const raw = this.input.value.trim();
    if (raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    let v = n;
    const { min, max, precision } = this.numberParams;
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    if (precision != null && precision >= 0) {
      const f = Math.pow(10, precision);
      v = Math.round(v * f) / f;
    }
    return v;
  }

  destroy(): void {
    this.input.removeEventListener('keydown', this.keydownHandler);
  }

  afterGuiAttached(): void {
    this.input.focus();
    if (this.params.charPress == null) this.input.select();
  }

  focusIn(): void {
    this.input.focus();
    this.input.select();
  }

  focusOut(): void { this.input.blur(); }
}
