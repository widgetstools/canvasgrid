import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class DateCellEditor implements ICellEditor<unknown, Date> {
  private input!: HTMLInputElement;
  private params!: ICellEditorParams<unknown, Date>;
  private keydownHandler!: (e: KeyboardEvent) => void;

  init(params: ICellEditorParams<unknown, Date>): void {
    this.params = params;
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'cg-cell-editor cg-cell-editor--date';
    if (params.value instanceof Date && !Number.isNaN(params.value.getTime())) {
      input.value = formatDate(params.value);
    } else if (typeof params.value === 'string') {
      input.value = params.value;
    }
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

  getValue(): Date | null {
    const raw = this.input.value;
    if (!raw) return null;
    // Parse the date as UTC midnight to avoid timezone shift on the boundary.
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  destroy(): void {
    this.input.removeEventListener('keydown', this.keydownHandler);
  }

  afterGuiAttached(): void {
    this.input.focus();
  }
}
