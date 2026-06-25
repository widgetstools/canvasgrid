/**
 * Cycle 7 / Task 5 — TextFilterPopup.
 *
 * Renders the popup body the FilterPopupHost mounts when the user clicks
 * the floating-filter expand button on a text column. Mirrors
 * ag-grid's `agTextColumnFilter`:
 *
 * - `<select>` operator dropdown (8 options — contains / notContains /
 *   equals / notEqual / startsWith / endsWith / blank / notBlank)
 * - single `<input type="text">` for the filter value (hides for
 *   `blank` / `notBlank` since operator alone is the model)
 * - `<input type="checkbox">` for the entry-level `caseSensitive` flag,
 *   suppressible via `showCaseSensitiveToggle: false`
 * - up to three buttons: Apply, Clear, Reset (configurable via
 *   `buttons` param — defaults to all three)
 *
 * Apply commits the resolved `CTextFilterModel` via `onApply` and,
 * when `closeOnApply: true`, also calls `onClose`. Clear empties the
 * input without committing. Reset empties the input AND commits
 * `null` (removes any active filter for the column) and clears the
 * caseSensitive toggle back to its default.
 *
 * The worker's matchesText() honors the entry-level `caseSensitive`
 * flag and the column-level `textFormatter` ('lowercase' / 'uppercase'
 * / 'trim'); main-side `trimInput` is applied via
 * `applyTrimInputToModel` from `cgrid.setColumnFilterModel` before the
 * model is shipped to the worker.
 */

import type { CTextFilterModel, CTextFilterOp, CFilterModelEntry } from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';

export type TextFilterButton = 'apply' | 'clear' | 'reset' | 'cancel';

export interface TextFilterPopupDeps {
  initialModel: CTextFilterModel | null;
  onApply: (model: CTextFilterModel | null) => void;
  onClose: () => void;
  buttons?: TextFilterButton[];
  closeOnApply?: boolean;
  /** When false, the caseSensitive checkbox does not render. Defaults
   *  to true. */
  showCaseSensitiveToggle?: boolean;
}

const OPERATOR_OPTIONS: ReadonlyArray<{ value: CTextFilterOp; label: string }> = [
  { value: 'contains',     label: 'Contains' },
  { value: 'notContains',  label: 'Not contains' },
  { value: 'equals',       label: 'Equals' },
  { value: 'notEqual',     label: 'Not equal' },
  { value: 'startsWith',   label: 'Starts with' },
  { value: 'endsWith',     label: 'Ends with' },
  { value: 'blank',        label: 'Blank' },
  { value: 'notBlank',     label: 'Not blank' },
];

const DEFAULT_OP: CTextFilterOp = 'contains';

export class TextFilterPopup implements FilterPopupFactory {
  private gui: HTMLDivElement | null = null;
  private select!: HTMLSelectElement;
  private primary!: HTMLInputElement;
  private caseSensitive: HTMLInputElement | null = null;
  private destroyed = false;

  constructor(private deps: TextFilterPopupDeps) {}

  buildGui(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cg-filter-popup cg-filter-popup-text';

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
    primary.type = 'text';
    primary.className = 'cg-filter-popup-input';
    primary.setAttribute('data-cg-filter-input', 'primary');
    primary.placeholder = 'Filter...';
    if (this.deps.initialModel?.filter != null) primary.value = this.deps.initialModel.filter;
    inputsRow.appendChild(primary);
    root.appendChild(inputsRow);

    if (this.deps.showCaseSensitiveToggle !== false) {
      const csRow = document.createElement('div');
      csRow.className = 'cg-filter-popup-row cg-filter-popup-case-sensitive';
      const csLabel = document.createElement('label');
      csLabel.className = 'cg-filter-popup-case-sensitive-label';
      const cs = document.createElement('input');
      cs.type = 'checkbox';
      cs.setAttribute('data-cg-filter-case-sensitive', '');
      cs.checked = this.deps.initialModel?.caseSensitive === true;
      const csText = document.createElement('span');
      csText.textContent = 'Case sensitive';
      csLabel.appendChild(cs);
      csLabel.appendChild(csText);
      csRow.appendChild(csLabel);
      root.appendChild(csRow);
      this.caseSensitive = cs;
    }

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

  /** Hide the value input for `blank` / `notBlank` — operator alone is
   *  the entire model. Every other operator shows it. The input stays
   *  in the DOM so the user's typed value survives a quick operator
   *  swap. */
  private syncInputVisibility(): void {
    const op = this.select.value as CTextFilterOp;
    const isBlank = op === 'blank' || op === 'notBlank';
    this.primary.style.display = isBlank ? 'none' : '';
  }

  private handleAction(kind: TextFilterButton): void {
    if (kind === 'apply') {
      this.deps.onApply(this.buildModel());
      if (this.deps.closeOnApply) this.deps.onClose();
      return;
    }
    if (kind === 'clear') {
      this.primary.value = '';
      return;
    }
    if (kind === 'reset') {
      this.primary.value = '';
      this.select.value = DEFAULT_OP;
      if (this.caseSensitive) this.caseSensitive.checked = false;
      this.syncInputVisibility();
      this.deps.onApply(null);
      return;
    }
    if (kind === 'cancel') {
      this.deps.onClose();
      return;
    }
  }

  /** Compose the v2 `CTextFilterModel` from the current UI state.
   *  Returns `null` when the operator needs a filter value but none was
   *  typed (treating an empty Apply as "no filter"). Always carries the
   *  caseSensitive flag when the toggle is on — main-side
   *  `applyTrimInputToModel` then handles `trimInput` before the model
   *  reaches the worker. */
  private buildModel(): CTextFilterModel | null {
    const op = this.select.value as CTextFilterOp;
    if (op === 'blank' || op === 'notBlank') {
      return { filterType: 'text', type: op };
    }
    const primaryRaw = this.primary.value;
    if (primaryRaw === '') return null;
    const model: CTextFilterModel = { filterType: 'text', type: op, filter: primaryRaw };
    if (this.caseSensitive?.checked) model.caseSensitive = true;
    return model;
  }
}

function labelFor(kind: TextFilterButton): string {
  switch (kind) {
    case 'apply':  return 'Apply';
    case 'clear':  return 'Clear';
    case 'reset':  return 'Reset';
    case 'cancel': return 'Cancel';
  }
}

/** Cycle 7 / Task 5 — main-side `trimInput` honored at
 *  `setColumnFilterModel` time. When `trim` is true AND `model` is a
 *  text filter with a string `filter`, returns a copy with the filter
 *  trimmed; everything else passes through unchanged. Exported for
 *  cgrid.setColumnFilterModel + unit tests in
 *  `filterPass.text.params.test.ts`. */
export function applyTrimInputToModel(
  model: CFilterModelEntry | null,
  trim: boolean,
): CFilterModelEntry | null {
  if (!model || !trim) return model;
  if (model.filterType !== 'text') return model;
  if (typeof model.filter !== 'string') return model;
  return { ...model, filter: model.filter.trim() };
}
