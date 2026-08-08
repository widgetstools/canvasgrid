import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

export class CheckboxCellEditor implements ICellEditor<unknown, boolean> {
  private wrapper!: HTMLDivElement;
  private input!: HTMLInputElement;
  private params!: ICellEditorParams<unknown, boolean>;
  private keydownHandler!: (e: KeyboardEvent) => void;

  init(params: ICellEditorParams<unknown, boolean>): void {
    this.params = params;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'vg-checkbox vg-cell-editor vg-cell-editor--checkbox';
    input.checked = Boolean(params.value);
    input.style.cssText =
      'box-sizing:border-box; margin:0; padding:0; ' +
      'outline:2px solid var(--vg-focus-ring-color, #4a90e2);';
    // The `<input type="checkbox">` is intrinsically sized (~13px) and won't
    // stretch to fill the wrapper EditorOverlay mounts at the cell's full
    // pixel rect — so it defaults to the top-left corner. Wrap it in a
    // flex-centered container so the editor visually replaces the canvas-
    // painted 14×14 checkbox at the same centered position.
    const wrapper = document.createElement('div');
    wrapper.className = 'vg-cell-editor--checkbox-wrapper';
    wrapper.style.cssText =
      'display:flex; align-items:center; justify-content:center; ' +
      'width:100%; height:100%;';
    wrapper.appendChild(input);
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
    this.wrapper = wrapper;
  }

  getGui(): HTMLElement { return this.wrapper; }
  getValue(): boolean { return this.input.checked; }

  destroy(): void {
    this.input.removeEventListener('keydown', this.keydownHandler);
  }

  afterGuiAttached(): void {
    this.input.focus();
  }

  focusIn(): void { this.input.focus(); }
  focusOut(): void { this.input.blur(); }
}
