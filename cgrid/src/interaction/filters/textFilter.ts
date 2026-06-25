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
 * Cycle 7 / Task 6 — operator <select> + text input + caseSensitive
 * checkbox extracted into `buildConditionRow` so the popup either
 * renders alone (default) or wraps inside `MultiConditionWrapper` when
 * `maxNumConditions > 1`. The caseSensitive flag is per-condition (each
 * CTextFilterModel inside the multi shape carries its own
 * `caseSensitive` value).
 *
 * The worker's matchesText() honors the entry-level `caseSensitive`
 * flag and the column-level `textFormatter` ('lowercase' / 'uppercase'
 * / 'trim'); main-side `trimInput` is applied via
 * `applyTrimInputToModel` from `cgrid.setColumnFilterModel` before the
 * model is shipped to the worker.
 */

import type {
  CFilterModelEntry,
  CMultiConditionFilterModel,
  CTextFilterModel,
  CTextFilterOp,
} from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';
import { MultiConditionWrapper, type MultiConditionJoin } from './multiCondition';

export type TextFilterButton = 'apply' | 'clear' | 'reset' | 'cancel';

export interface TextFilterPopupDeps {
  initialModel: CTextFilterModel | CMultiConditionFilterModel | null;
  onApply: (model: CTextFilterModel | CMultiConditionFilterModel | null) => void;
  onClose: () => void;
  buttons?: TextFilterButton[];
  closeOnApply?: boolean;
  /** When false, the caseSensitive checkbox does not render. Defaults
   *  to true. */
  showCaseSensitiveToggle?: boolean;
  maxNumConditions?: number;
  numAlwaysVisibleConditions?: number;
  defaultJoinOperator?: MultiConditionJoin;
  /** Cycle 7 / Task 9 — fires on every popup-internal mutation
   *  (operator change, value typed, caseSensitive toggled, multi-row
   *  added). Wires to the `filterModified` event on `CGridApi`.
   *  Optional. */
  onModified?: () => void;
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

interface RowController {
  el: HTMLElement;
  getModel(): CTextFilterModel | null;
  reset(): void;
  clearInputs(): void;
}

export class TextFilterPopup implements FilterPopupFactory {
  private gui: HTMLDivElement | null = null;
  private destroyed = false;
  private singleRow: RowController | null = null;
  private rowControllers: RowController[] = [];
  private wrapper: MultiConditionWrapper | null = null;

  constructor(private deps: TextFilterPopupDeps) {}

  buildGui(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cg-filter-popup cg-filter-popup-text';

    const maxConditions = this.deps.maxNumConditions ?? 1;
    if (maxConditions > 1) {
      const initial = this.normalizeInitial();
      this.wrapper = new MultiConditionWrapper(root, {
        buildConditionRow: (rowInitial, onChange) => {
          const wrapped = (next: CTextFilterModel | null): void => {
            onChange(next);
            this.deps.onModified?.();
          };
          const ctl = this.buildConditionRow(rowInitial as CTextFilterModel | null, wrapped);
          this.rowControllers.push(ctl);
          return ctl.el;
        },
        initial,
        maxNumConditions: maxConditions,
        numAlwaysVisibleConditions: this.deps.numAlwaysVisibleConditions ?? 1,
        onChange: () => { this.deps.onModified?.(); },
      });
    } else {
      const initialSingle = this.singleInitialModel();
      this.singleRow = this.buildConditionRow(initialSingle, () => {
        this.deps.onModified?.();
      });
      root.appendChild(this.singleRow.el);
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

    this.gui = root;
    return root;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.wrapper?.destroy();
    this.wrapper = null;
    this.rowControllers = [];
    this.singleRow = null;
    this.gui = null;
  }

  /** Cycle 7 / Task 6 — operator <select> + text input + (optional)
   *  caseSensitive checkbox. Used by both the single-condition path
   *  and the MultiConditionWrapper factory. */
  private buildConditionRow(
    initial: CTextFilterModel | null,
    onChange: (next: CTextFilterModel | null) => void,
  ): RowController {
    const row = document.createElement('div');
    row.className = 'cg-filter-popup-condition';

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
    select.value = initial?.type ?? DEFAULT_OP;
    opRow.appendChild(select);
    row.appendChild(opRow);

    const inputsRow = document.createElement('div');
    inputsRow.className = 'cg-filter-popup-row cg-filter-popup-inputs';
    const primary = document.createElement('input');
    primary.type = 'text';
    primary.className = 'cg-filter-popup-input';
    primary.setAttribute('data-cg-filter-input', 'primary');
    primary.placeholder = 'Filter...';
    if (initial?.filter != null) primary.value = initial.filter;
    inputsRow.appendChild(primary);
    row.appendChild(inputsRow);

    let caseSensitive: HTMLInputElement | null = null;
    if (this.deps.showCaseSensitiveToggle !== false) {
      const csRow = document.createElement('div');
      csRow.className = 'cg-filter-popup-row cg-filter-popup-case-sensitive';
      const csLabel = document.createElement('label');
      csLabel.className = 'cg-filter-popup-case-sensitive-label';
      const cs = document.createElement('input');
      cs.type = 'checkbox';
      cs.setAttribute('data-cg-filter-case-sensitive', '');
      cs.checked = initial?.caseSensitive === true;
      const csText = document.createElement('span');
      csText.textContent = 'Case sensitive';
      csLabel.appendChild(cs);
      csLabel.appendChild(csText);
      csRow.appendChild(csLabel);
      row.appendChild(csRow);
      caseSensitive = cs;
    }

    const syncInputVisibility = (): void => {
      const op = select.value as CTextFilterOp;
      const isBlank = op === 'blank' || op === 'notBlank';
      primary.style.display = isBlank ? 'none' : '';
    };

    const readModel = (): CTextFilterModel | null => {
      const op = select.value as CTextFilterOp;
      if (op === 'blank' || op === 'notBlank') {
        return { filterType: 'text', type: op };
      }
      const primaryRaw = primary.value;
      if (primaryRaw === '') return null;
      const model: CTextFilterModel = { filterType: 'text', type: op, filter: primaryRaw };
      if (caseSensitive?.checked) model.caseSensitive = true;
      return model;
    };

    const fire = (): void => onChange(readModel());
    select.addEventListener('change', () => {
      syncInputVisibility();
      fire();
    });
    primary.addEventListener('input', fire);
    caseSensitive?.addEventListener('change', fire);

    syncInputVisibility();

    return {
      el: row,
      getModel: readModel,
      reset(): void {
        primary.value = '';
        select.value = DEFAULT_OP;
        if (caseSensitive) caseSensitive.checked = false;
        syncInputVisibility();
      },
      clearInputs(): void {
        primary.value = '';
      },
    };
  }

  private normalizeInitial(): {
    operator: MultiConditionJoin;
    conditions: CFilterModelEntry[];
  } {
    const m = this.deps.initialModel;
    const defaultJoin: MultiConditionJoin = this.deps.defaultJoinOperator ?? 'AND';
    if (m && m.filterType === 'multi') {
      return { operator: m.operator, conditions: m.conditions };
    }
    if (m && m.filterType === 'text') {
      return { operator: defaultJoin, conditions: [m] };
    }
    return { operator: defaultJoin, conditions: [] };
  }

  private singleInitialModel(): CTextFilterModel | null {
    const m = this.deps.initialModel;
    if (!m) return null;
    if (m.filterType === 'text') return m;
    if (m.filterType === 'multi') {
      const first = m.conditions[0];
      return first && first.filterType === 'text' ? first : null;
    }
    return null;
  }

  private handleAction(kind: TextFilterButton): void {
    if (kind === 'apply') {
      this.deps.onApply(this.composeModel());
      if (this.deps.closeOnApply) this.deps.onClose();
      return;
    }
    if (kind === 'clear') {
      if (this.singleRow) this.singleRow.clearInputs();
      for (const c of this.rowControllers) c.clearInputs();
      return;
    }
    if (kind === 'reset') {
      if (this.singleRow) this.singleRow.reset();
      for (const c of this.rowControllers) c.reset();
      this.deps.onApply(null);
      return;
    }
    if (kind === 'cancel') {
      this.deps.onClose();
      return;
    }
  }

  private composeModel(): CTextFilterModel | CMultiConditionFilterModel | null {
    if (!this.wrapper) {
      return this.singleRow?.getModel() ?? null;
    }
    const models: CTextFilterModel[] = [];
    for (const ctl of this.rowControllers) {
      const m = ctl.getModel();
      if (m) models.push(m);
    }
    if (models.length === 0) return null;
    if (models.length === 1) return models[0]!;
    const wrapperOp = this.wrapper.getValue().operator;
    return {
      filterType: 'multi',
      operator: wrapperOp,
      conditions: models,
    };
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
 *  `filterPass.text.params.test.ts`.
 *
 *  Cycle 7 / Task 6 — also walks `CMultiConditionFilterModel`
 *  conditions, trimming any text-shape children so multi-condition
 *  popups respect `trimInput` per condition. */
export function applyTrimInputToModel(
  model: CFilterModelEntry | null,
  trim: boolean,
): CFilterModelEntry | null {
  if (!model || !trim) return model;
  if (model.filterType === 'multi') {
    return {
      filterType: 'multi',
      operator: model.operator,
      conditions: model.conditions.map((c) => trimNonMultiCondition(c, trim)),
    };
  }
  if (model.filterType !== 'text') return model;
  if (typeof model.filter !== 'string') return model;
  return { ...model, filter: model.filter.trim() };
}

/** Multi-condition `conditions` is strictly text | number | date — no
 *  nested multi. Trims string filters on text entries; passes
 *  number/date entries through unchanged. */
function trimNonMultiCondition(
  c: import('../../types').CTextFilterModel
   | import('../../types').CNumberFilterModel
   | import('../../types').CDateFilterModel,
  trim: boolean,
): import('../../types').CTextFilterModel
 | import('../../types').CNumberFilterModel
 | import('../../types').CDateFilterModel {
  if (!trim) return c;
  if (c.filterType !== 'text') return c;
  if (typeof c.filter !== 'string') return c;
  return { ...c, filter: c.filter.trim() };
}
