import type { ICellEditor, ICellEditorParams } from '../iCellEditor';

// price32 — a reference domain editor for US Treasury / bond prices quoted in
// 32nds. Display form is `WHOLE-TT` (e.g. `101-16` = 101 + 16/32 = 101.5),
// with a trailing `+` denoting a half-tick, i.e. 1/64 (`101-16+` = 101.515625).
// The model value is a plain decimal so sorting / aggregation stay numeric;
// the editor is the only place the 32nds notation lives.

const ONE_TICK = 1 / 32;

/** Parse a 32nds string (or a plain decimal) into a decimal price. Returns
 *  null when the text is neither a valid 32nds quote nor a finite number. */
export function parsePrice32(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const m = /^(-?)(\d+)-(\d{1,2})(\+?)$/.exec(s);
  if (m) {
    const [, sign, whole, ticksStr, plus] = m;
    const ticks = Number(ticksStr);
    if (ticks > 31) return null; // 32nds only run 0–31
    const dec = Number(whole) + (ticks + (plus ? 0.5 : 0)) * ONE_TICK;
    return sign === '-' ? -dec : dec;
  }
  // Fall back to a plain decimal so a user can still type `101.5` directly.
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Format a decimal price as a 32nds quote (`WHOLE-TT` / `WHOLE-TT+`). */
export function formatPrice32(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const frac32 = (abs - whole) * 32;
  // Nudge past floating-point noise before flooring so 16.4999999 → 16.
  let ticks = Math.floor(frac32 + 1e-6);
  const half = frac32 - ticks >= 0.5 - 1e-6;
  // A half-tick at tick 31 stays `31+`; a full carry can't occur because
  // frac32 < 32 by construction.
  if (ticks > 31) ticks = 31;
  return `${sign}${whole}-${String(ticks).padStart(2, '0')}${half ? '+' : ''}`;
}

export class Price32CellEditor implements ICellEditor<unknown, number> {
  private input!: HTMLInputElement;
  private params!: ICellEditorParams<unknown, number>;
  private keydownHandler!: (e: KeyboardEvent) => void;

  init(params: ICellEditorParams<unknown, number>): void {
    this.params = params;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vg-cell-editor vg-cell-editor--price32';
    // Enter mode (charPress) seeds the raw keystroke; edit mode shows the
    // existing value in 32nds notation so the caret lands on real content.
    input.value = params.charPress != null
      ? params.charPress
      : formatPrice32(params.value as number | null | undefined);
    input.style.cssText =
      'box-sizing:border-box; width:100%; height:100%; ' +
      'border:0; padding:0 8px; margin:0; ' +
      'background:var(--vg-cell-editor-bg, var(--vg-bg-color, #fff)); color:var(--vg-text-color, var(--vg-fg-color, #111)); ' +
      'font-family:var(--vg-font-family, inherit); font-size:var(--vg-font-size, inherit); ' +
      'outline:2px solid var(--vg-focus-ring-color, #4a90e2); text-align:right;';
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

  /** Empty is allowed (clears the cell); non-empty must parse to a price. */
  isValid(): boolean {
    const raw = this.input.value.trim();
    return raw === '' || parsePrice32(raw) != null;
  }

  getValue(): number | null {
    return parsePrice32(this.input.value);
  }

  destroy(): void {
    this.input.removeEventListener('keydown', this.keydownHandler);
  }

  afterGuiAttached(): void {
    this.input.focus();
    // Edit mode selects the whole value; enter mode keeps the caret after
    // the seeded keystroke.
    if (this.params.charPress == null) this.input.select();
  }

  focusIn(): void {
    this.input.focus();
    this.input.select();
  }

  focusOut(): void { this.input.blur(); }
}
