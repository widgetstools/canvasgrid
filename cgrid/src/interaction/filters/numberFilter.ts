/**
 * Cycle 7 / Task 3 — NumberFilterPopup.
 *
 * Renders the popup body the FilterPopupHost mounts when the user clicks
 * the floating-filter expand button on a numeric column. Mirrors
 * ag-grid's `agNumberColumnFilter`:
 *
 * - `<select>` operator dropdown (9 options)
 * - one or two numeric `<input>` elements (the second only shows for
 *   `inRange`; both hide for `blank` / `notBlank` since operator is
 *   the entire model)
 * - up to three buttons: Apply, Clear, Reset (configurable via
 *   `buttons` param — defaults to all three)
 *
 * Apply commits the resolved `CNumberFilterModel` via `onApply` and,
 * when `closeOnApply: true`, also calls `onClose`. Clear empties the
 * inputs without committing. Reset empties the inputs AND commits
 * `null` (removes any active filter for the column).
 *
 * The popup writes the v2 model shape directly into `onApply` — the
 * caller passes that straight to `cgrid.setColumnFilterModel(colId,
 * model)`, where the worker's matcher already evaluates the full
 * operator surface (matchesNumber in `worker/dataPipeline.ts`).
 */

import type { CNumberFilterModel, CNumberFilterOp } from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';

export type NumberFilterButton = 'apply' | 'clear' | 'reset' | 'cancel';

export interface NumberFilterPopupDeps {
  initialModel: CNumberFilterModel | null;
  onApply: (model: CNumberFilterModel | null) => void;
  onClose: () => void;
  buttons?: NumberFilterButton[];
  closeOnApply?: boolean;
}

const OPERATOR_OPTIONS: ReadonlyArray<{ value: CNumberFilterOp; label: string }> = [
  { value: 'equals',              label: 'Equals' },
  { value: 'notEqual',            label: 'Not equal' },
  { value: 'lessThan',            label: 'Less than' },
  { value: 'lessThanOrEqual',     label: 'Less than or equal' },
  { value: 'greaterThan',         label: 'Greater than' },
  { value: 'greaterThanOrEqual',  label: 'Greater than or equal' },
  { value: 'inRange',             label: 'In range' },
  { value: 'blank',               label: 'Blank' },
  { value: 'notBlank',            label: 'Not blank' },
];

const DEFAULT_OP: CNumberFilterOp = 'equals';

export class NumberFilterPopup implements FilterPopupFactory {
  private gui: HTMLDivElement | null = null;
  private select!: HTMLSelectElement;
  private primary!: HTMLInputElement;
  private secondary!: HTMLInputElement;
  private destroyed = false;

  constructor(private deps: NumberFilterPopupDeps) {}

  buildGui(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cg-filter-popup cg-filter-popup-number';

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
    primary.type = 'number';
    primary.className = 'cg-filter-popup-input';
    primary.setAttribute('data-cg-filter-input', 'primary');
    primary.placeholder = 'Filter...';
    if (this.deps.initialModel?.filter != null) primary.value = String(this.deps.initialModel.filter);
    inputsRow.appendChild(primary);

    const secondary = document.createElement('input');
    secondary.type = 'number';
    secondary.className = 'cg-filter-popup-input';
    secondary.setAttribute('data-cg-filter-input', 'secondary');
    secondary.placeholder = 'To...';
    if (this.deps.initialModel?.filterTo != null) secondary.value = String(this.deps.initialModel.filterTo);
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
    const op = this.select.value as CNumberFilterOp;
    const isBlank = op === 'blank' || op === 'notBlank';
    const isRange = op === 'inRange';
    this.primary.style.display = isBlank ? 'none' : '';
    this.secondary.style.display = isRange ? '' : 'none';
  }

  private handleAction(kind: NumberFilterButton): void {
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

  /** Compose the v2 `CNumberFilterModel` from the current UI state.
   *  Returns `null` when the operator needs a numeric filter value but
   *  none was typed (treating an empty Apply as "no filter"). */
  private buildModel(): CNumberFilterModel | null {
    const op = this.select.value as CNumberFilterOp;
    if (op === 'blank' || op === 'notBlank') {
      return { filterType: 'number', type: op };
    }
    const primaryRaw = this.primary.value.trim();
    if (primaryRaw === '') return null;
    const primaryNum = Number(primaryRaw);
    if (!Number.isFinite(primaryNum)) return null;
    if (op === 'inRange') {
      const secondaryRaw = this.secondary.value.trim();
      if (secondaryRaw === '') return null;
      const secondaryNum = Number(secondaryRaw);
      if (!Number.isFinite(secondaryNum)) return null;
      return {
        filterType: 'number', type: 'inRange',
        filter: primaryNum, filterTo: secondaryNum,
      };
    }
    return { filterType: 'number', type: op, filter: primaryNum };
  }
}

function labelFor(kind: NumberFilterButton): string {
  switch (kind) {
    case 'apply':  return 'Apply';
    case 'clear':  return 'Clear';
    case 'reset':  return 'Reset';
    case 'cancel': return 'Cancel';
  }
}
