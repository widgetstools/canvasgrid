import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

interface LargeTextParams {
  maxLength?: number;
  rows?: number;
  cols?: number;
}

export class LargeTextCellEditor implements ICellEditor<unknown, string> {
  private textarea!: HTMLTextAreaElement;
  private params!: ICellEditorParams<unknown, string>;
  private keydownHandler!: (e: KeyboardEvent) => void;

  init(params: ICellEditorParams<unknown, string>): void {
    this.params = params;
    const ltParams = (params.params ?? {}) as LargeTextParams;
    const textarea = document.createElement('textarea');
    textarea.className = 'cg-cell-editor cg-cell-editor--large-text';
    textarea.value = params.charPress ?? (params.value == null ? '' : String(params.value));
    textarea.maxLength = ltParams.maxLength ?? 200;
    textarea.rows = ltParams.rows ?? 10;
    textarea.cols = ltParams.cols ?? 60;
    // Popup-only editor (isPopup() === true) — size from rows/cols so the
    // textarea has an intrinsic footprint instead of stretching to fill the
    // editor host. PopupHost positions it; we don't want width: 100% there.
    textarea.style.cssText =
      'box-sizing:border-box; ' +
      'border:0; padding:6px 8px; margin:0; resize:none; ' +
      'background:var(--cg-cell-editor-bg, var(--cg-bg-color, #fff)); color:var(--cg-text-color, var(--cg-fg-color, #111)); ' +
      'font-family:var(--cg-font-family, inherit); font-size:var(--cg-font-size, inherit); ' +
      'outline:2px solid var(--cg-focus-ring-color, #4a90e2);';
    this.keydownHandler = (e: KeyboardEvent) => {
      // Ctrl/Cmd+Enter commits; bare Enter inserts a newline (default).
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        this.params.stopEditing(false);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        this.params.stopEditing(true);
      }
    };
    textarea.addEventListener('keydown', this.keydownHandler);
    this.textarea = textarea;
  }

  getGui(): HTMLElement { return this.textarea; }
  getValue(): string { return this.textarea.value; }
  isPopup(): boolean { return true; }

  destroy(): void {
    this.textarea.removeEventListener('keydown', this.keydownHandler);
  }

  afterGuiAttached(): void {
    this.textarea.focus();
    if (this.params.charPress == null) this.textarea.select();
    else this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
  }
}
