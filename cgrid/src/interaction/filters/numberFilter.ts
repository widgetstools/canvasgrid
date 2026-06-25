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
 * Cycle 7 / Task 6 — the operator-select + inputs block is extracted
 * into `buildConditionRow` so the same body can either render alone
 * (default single-condition behaviour) or wrap inside
 * `MultiConditionWrapper` when `filterParams.maxNumConditions > 1`.
 * Apply collapses a one-condition multi back to the bare
 * CNumberFilterModel shape so single-condition popup callers see no
 * change to the committed model.
 *
 * The popup writes the v2 model shape directly into `onApply` — the
 * caller passes that straight to `cgrid.setColumnFilterModel(colId,
 * model)`, where the worker's matcher already evaluates the full
 * operator surface (matchesNumber in `worker/dataPipeline.ts`).
 */

import type {
  CFilterModelEntry,
  CMultiConditionFilterModel,
  CNumberFilterModel,
  CNumberFilterOp,
} from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';
import { MultiConditionWrapper, type MultiConditionJoin } from './multiCondition';

export type NumberFilterButton = 'apply' | 'clear' | 'reset' | 'cancel';

export interface NumberFilterPopupDeps {
  initialModel: CNumberFilterModel | CMultiConditionFilterModel | null;
  onApply: (model: CNumberFilterModel | CMultiConditionFilterModel | null) => void;
  onClose: () => void;
  buttons?: NumberFilterButton[];
  closeOnApply?: boolean;
  maxNumConditions?: number;
  numAlwaysVisibleConditions?: number;
  defaultJoinOperator?: MultiConditionJoin;
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

/** Per-condition row state — the popup's only stateful unit. The
 *  Apply / Clear / Reset buttons reach into the active row(s) through
 *  the controller returned alongside the DOM element. */
interface RowController {
  el: HTMLElement;
  /** Read the current model from the row's live UI state. Returns null
   *  when the operator needs a value but none was typed. */
  getModel(): CNumberFilterModel | null;
  /** Set the row's UI to the default-empty state (operator → 'equals',
   *  inputs cleared). Used by Reset. */
  reset(): void;
  /** Empty both inputs without changing the operator. Used by Clear. */
  clearInputs(): void;
}

export class NumberFilterPopup implements FilterPopupFactory {
  private gui: HTMLDivElement | null = null;
  private destroyed = false;
  /** Active in single-condition mode only. Used by Reset / Clear so the
   *  existing single-popup tests keep working unchanged. */
  private singleRow: RowController | null = null;
  /** Active in multi-condition mode only. Each per-slot controller is
   *  threaded through `buildConditionRow` via the wrapper's factory
   *  callback, then cached so Reset / Clear can fan out across both
   *  slots. */
  private rowControllers: RowController[] = [];
  private wrapper: MultiConditionWrapper | null = null;
  private operator: MultiConditionJoin;

  constructor(private deps: NumberFilterPopupDeps) {
    this.operator = deps.defaultJoinOperator ?? 'AND';
  }

  buildGui(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cg-filter-popup cg-filter-popup-number';

    const maxConditions = this.deps.maxNumConditions ?? 1;
    if (maxConditions > 1) {
      const initial = this.normalizeInitial();
      this.wrapper = new MultiConditionWrapper(root, {
        buildConditionRow: (rowInitial, onChange) => {
          const ctl = this.buildConditionRow(rowInitial as CNumberFilterModel | null, onChange);
          this.rowControllers.push(ctl);
          return ctl.el;
        },
        initial,
        maxNumConditions: maxConditions,
        numAlwaysVisibleConditions: this.deps.numAlwaysVisibleConditions ?? 1,
        onChange: () => { /* live state tracked via row controllers */ },
      });
    } else {
      const initialSingle = this.singleInitialModel();
      this.singleRow = this.buildConditionRow(initialSingle, () => { /* read at apply */ });
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

  /** Cycle 7 / Task 6 — Extracts the operator <select> + primary /
   *  secondary numeric inputs into a self-contained row. Used by both
   *  the single-condition path and the MultiConditionWrapper factory.
   *  The returned controller lets the popup (a) build the v2 model from
   *  the live UI on Apply, (b) Reset / Clear the row UI on demand. */
  private buildConditionRow(
    initial: CNumberFilterModel | null,
    onChange: (next: CNumberFilterModel | null) => void,
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
    primary.type = 'number';
    primary.className = 'cg-filter-popup-input';
    primary.setAttribute('data-cg-filter-input', 'primary');
    primary.placeholder = 'Filter...';
    if (initial?.filter != null) primary.value = String(initial.filter);
    inputsRow.appendChild(primary);

    const secondary = document.createElement('input');
    secondary.type = 'number';
    secondary.className = 'cg-filter-popup-input';
    secondary.setAttribute('data-cg-filter-input', 'secondary');
    secondary.placeholder = 'To...';
    if (initial?.filterTo != null) secondary.value = String(initial.filterTo);
    inputsRow.appendChild(secondary);
    row.appendChild(inputsRow);

    const syncInputVisibility = (): void => {
      const op = select.value as CNumberFilterOp;
      const isBlank = op === 'blank' || op === 'notBlank';
      const isRange = op === 'inRange';
      primary.style.display = isBlank ? 'none' : '';
      secondary.style.display = isRange ? '' : 'none';
    };

    const readModel = (): CNumberFilterModel | null => {
      const op = select.value as CNumberFilterOp;
      if (op === 'blank' || op === 'notBlank') {
        return { filterType: 'number', type: op };
      }
      const primaryRaw = primary.value.trim();
      if (primaryRaw === '') return null;
      const primaryNum = Number(primaryRaw);
      if (!Number.isFinite(primaryNum)) return null;
      if (op === 'inRange') {
        const secondaryRaw = secondary.value.trim();
        if (secondaryRaw === '') return null;
        const secondaryNum = Number(secondaryRaw);
        if (!Number.isFinite(secondaryNum)) return null;
        return {
          filterType: 'number', type: 'inRange',
          filter: primaryNum, filterTo: secondaryNum,
        };
      }
      return { filterType: 'number', type: op, filter: primaryNum };
    };

    const fire = (): void => onChange(readModel());
    select.addEventListener('change', () => {
      syncInputVisibility();
      fire();
    });
    primary.addEventListener('input', fire);
    secondary.addEventListener('input', fire);

    syncInputVisibility();

    return {
      el: row,
      getModel: readModel,
      reset(): void {
        primary.value = '';
        secondary.value = '';
        select.value = DEFAULT_OP;
        syncInputVisibility();
      },
      clearInputs(): void {
        primary.value = '';
        secondary.value = '';
      },
    };
  }

  /** Seed `initial` for the MultiConditionWrapper from `deps.initialModel`.
   *  When the saved model is a CMultiConditionFilterModel, hydrate the
   *  conditions array directly; otherwise treat a single CNumberFilterModel
   *  as a one-element conditions array. */
  private normalizeInitial(): {
    operator: MultiConditionJoin;
    conditions: CFilterModelEntry[];
  } {
    const m = this.deps.initialModel;
    const defaultJoin: MultiConditionJoin = this.deps.defaultJoinOperator ?? 'AND';
    if (m && m.filterType === 'multi') {
      return { operator: m.operator, conditions: m.conditions };
    }
    if (m && m.filterType === 'number') {
      return { operator: defaultJoin, conditions: [m] };
    }
    return { operator: defaultJoin, conditions: [] };
  }

  /** Seed for the single-condition path — only accepts the bare
   *  CNumberFilterModel shape. A persisted multi entry would round-trip
   *  through `initialModel` typed at construction time, but a single-
   *  condition popup config should never be handed a multi model;
   *  defensively flatten the first condition if it happens. */
  private singleInitialModel(): CNumberFilterModel | null {
    const m = this.deps.initialModel;
    if (!m) return null;
    if (m.filterType === 'number') return m;
    if (m.filterType === 'multi') {
      const first = m.conditions[0];
      return first && first.filterType === 'number' ? first : null;
    }
    return null;
  }

  private handleAction(kind: NumberFilterButton): void {
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

  /** Reads the current UI state into a v2 model. Single-condition mode
   *  emits a CNumberFilterModel directly. Multi-condition mode emits a
   *  CMultiConditionFilterModel ONLY when more than one condition is
   *  filled; a one-condition multi collapses back to the bare
   *  CNumberFilterModel for back-compat with single-popup callers. */
  private composeModel(): CNumberFilterModel | CMultiConditionFilterModel | null {
    if (!this.wrapper) {
      return this.singleRow?.getModel() ?? null;
    }
    const models: CNumberFilterModel[] = [];
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

function labelFor(kind: NumberFilterButton): string {
  switch (kind) {
    case 'apply':  return 'Apply';
    case 'clear':  return 'Clear';
    case 'reset':  return 'Reset';
    case 'cancel': return 'Cancel';
  }
}
