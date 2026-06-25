/**
 * Cycle 7 / Task 4 — DateFilterPopup.
 *
 * Renders the popup body the FilterPopupHost mounts when the user clicks
 * the floating-filter expand button on a date column. Mirrors
 * ag-grid's `agDateColumnFilter` — structurally identical to
 * NumberFilterPopup (same operator surface, same buttons, same Apply /
 * Clear / Reset semantics) — the inputs are `<input type="date">` and
 * the model carries ISO-string `filter` / `filterTo` instead of numbers.
 *
 * - `<select>` operator dropdown (9 options — equals / notEqual /
 *   lessThan / lessThanOrEqual / greaterThan / greaterThanOrEqual /
 *   inRange / blank / notBlank)
 * - one or two date `<input>` elements (the second only shows for
 *   `inRange`; both hide for `blank` / `notBlank` since operator is
 *   the entire model)
 * - up to three buttons: Apply, Clear, Reset (configurable via
 *   `buttons` param — defaults to all three)
 *
 * Apply commits the resolved `CDateFilterModel` via `onApply` and,
 * when `closeOnApply: true`, also calls `onClose`. Clear empties the
 * inputs without committing. Reset empties the inputs AND commits
 * `null` (removes any active filter for the column).
 *
 * The worker's `matchesDate` (in `worker/dataPipeline.ts`) already
 * parses both sides via `Date.parse` and compares numerically, so the
 * popup's only contract is to emit ISO strings — the exact format a
 * native `<input type="date">.value` produces (`YYYY-MM-DD`).
 */

import type { CDateFilterModel, CDateFilterOp } from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';

export type DateFilterButton = 'apply' | 'clear' | 'reset' | 'cancel';

export interface DateFilterPopupDeps {
  initialModel: CDateFilterModel | null;
  onApply: (model: CDateFilterModel | null) => void;
  onClose: () => void;
  buttons?: DateFilterButton[];
  closeOnApply?: boolean;
}

const OPERATOR_OPTIONS: ReadonlyArray<{ value: CDateFilterOp; label: string }> = [
  { value: 'equals',              label: 'Equals' },
  { value: 'notEqual',            label: 'Not equal' },
  { value: 'lessThan',            label: 'Before' },
  { value: 'lessThanOrEqual',     label: 'On or before' },
  { value: 'greaterThan',         label: 'After' },
  { value: 'greaterThanOrEqual',  label: 'On or after' },
  { value: 'inRange',             label: 'In range' },
  { value: 'blank',               label: 'Blank' },
  { value: 'notBlank',            label: 'Not blank' },
];

const DEFAULT_OP: CDateFilterOp = 'equals';

export class DateFilterPopup implements FilterPopupFactory {
  private gui: HTMLDivElement | null = null;
  private select!: HTMLSelectElement;
  private primary!: HTMLInputElement;
  private secondary!: HTMLInputElement;
  private destroyed = false;

  constructor(private deps: DateFilterPopupDeps) {}

  buildGui(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cg-filter-popup cg-filter-popup-date';

    const opRow = document.createElement('div');
    opRow.className = 'cg-filter-popup-row';
    const select = document.createElement('select');
    select.className = 'cg-filter-popup-operator';
    for (const { value, label } of OPERATOR_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    }
    select.value = this.deps.initialModel?.type ?? DEFAULT_OP;
    opRow.appendChild(select);
    root.appendChild(opRow);

    const inputsRow = document.createElement('div');
    inputsRow.className = 'cg-filter-popup-row cg-filter-popup-inputs';
    const primary = document.createElement('input');
    primary.type = 'date';
    primary.className = 'cg-filter-popup-input';
    primary.setAttribute('data-cg-filter-input', 'primary');
    if (this.deps.initialModel?.filter != null) primary.value = this.deps.initialModel.filter;
    inputsRow.appendChild(primary);

    const secondary = document.createElement('input');
    secondary.type = 'date';
    secondary.className = 'cg-filter-popup-input';
    secondary.setAttribute('data-cg-filter-input', 'secondary');
    if (this.deps.initialModel?.filterTo != null) secondary.value = this.deps.initialModel.filterTo;
    inputsRow.appendChild(secondary);
    root.appendChild(inputsRow);

    const buttonsRow = document.createElement('div');
    buttonsRow.className = 'cg-filter-popup-row cg-filter-popup-buttons';
    const buttons = this.deps.buttons ?? ['apply', 'clear', 'reset'];
    for (const kind of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cg-filter-popup-button cg-filter-popup-button-${kind}`;
      btn.setAttribute('data-cg-filter-action', kind);
      btn.textContent = labelFor(kind);
      btn.addEventListener('click', () => this.handleAction(kind));
      buttonsRow.appendChild(btn);
    }
    root.appendChild(buttonsRow);

    this.select = select;
    this.primary = primary;
    this.secondary = secondary;
    this.gui = root;

    select.addEventListener('change', () => this.syncInputVisibility());
    this.syncInputVisibility();
    return root;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gui = null;
  }

  /** Show / hide the primary + secondary inputs based on the current
   *  operator. `inRange` shows both; `blank` / `notBlank` hides both
   *  (operator alone is the model); everything else shows only the
   *  primary. The secondary stays in the DOM either way so the user's
   *  typed `filterTo` survives a quick swap back to `inRange`. */
  private syncInputVisibility(): void {
    const op = this.select.value as CDateFilterOp;
    const isBlank = op === 'blank' || op === 'notBlank';
    const isRange = op === 'inRange';
    this.primary.style.display = isBlank ? 'none' : '';
    this.secondary.style.display = isRange ? '' : 'none';
  }

  private handleAction(kind: DateFilterButton): void {
    if (kind === 'apply') {
      this.deps.onApply(this.buildModel());
      if (this.deps.closeOnApply) this.deps.onClose();
      return;
    }
    if (kind === 'clear') {
      this.primary.value = '';
      this.secondary.value = '';
      return;
    }
    if (kind === 'reset') {
      this.primary.value = '';
      this.secondary.value = '';
      this.select.value = DEFAULT_OP;
      this.syncInputVisibility();
      this.deps.onApply(null);
      return;
    }
    if (kind === 'cancel') {
      this.deps.onClose();
      return;
    }
  }

  /** Compose the v2 `CDateFilterModel` from the current UI state.
   *  Returns `null` when the operator needs a date value but none was
   *  picked (treating an empty Apply as "no filter"). Native
   *  `<input type="date">.value` already returns the ISO `YYYY-MM-DD`
   *  format the worker expects. */
  private buildModel(): CDateFilterModel | null {
    const op = this.select.value as CDateFilterOp;
    if (op === 'blank' || op === 'notBlank') {
      return { filterType: 'date', type: op };
    }
    const primaryRaw = this.primary.value;
    if (primaryRaw === '') return null;
    if (op === 'inRange') {
      const secondaryRaw = this.secondary.value;
      if (secondaryRaw === '') return null;
      return {
        filterType: 'date', type: 'inRange',
        filter: primaryRaw, filterTo: secondaryRaw,
      };
    }
    return { filterType: 'date', type: op, filter: primaryRaw };
  }
}

function labelFor(kind: DateFilterButton): string {
  switch (kind) {
    case 'apply':  return 'Apply';
    case 'clear':  return 'Clear';
    case 'reset':  return 'Reset';
    case 'cancel': return 'Cancel';
  }
}
