import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

export class CheckboxCellEditor implements ICellEditor<unknown, boolean> {
  private input!: HTMLInputElement;
  private params!: ICellEditorParams<unknown, boolean>;
  private keydownHandler!: (e: KeyboardEvent) => void;

  init(params: ICellEditorParams<unknown, boolean>): void {
    this.params = params;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cg-cell-editor cg-cell-editor--checkbox';
    input.checked = Boolean(params.value);
    input.style.cssText =
      'box-sizing:border-box; margin:0; padding:0; ' +
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
  getValue(): boolean { return this.input.checked; }

  destroy(): void {
    this.input.removeEventListener('keydown', this.keydownHandler);
  }

  afterGuiAttached(): void {
    this.input.focus();
  }
}
