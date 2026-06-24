import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

export class TextCellEditor implements ICellEditor<unknown, string> {
  private input!: HTMLInputElement;
  private params!: ICellEditorParams<unknown, string>;
  private keydownHandler!: (e: KeyboardEvent) => void;

  init(params: ICellEditorParams<unknown, string>): void {
    this.params = params;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cg-cell-editor cg-cell-editor--text';
    input.value = params.charPress ?? (params.value == null ? '' : String(params.value));
    input.style.cssText =
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
    if (this.params.charPress == null) this.input.select();
    else this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  focusIn(): void {
    this.input.focus();
    this.input.select();
  }

  focusOut(): void { this.input.blur(); }
}
