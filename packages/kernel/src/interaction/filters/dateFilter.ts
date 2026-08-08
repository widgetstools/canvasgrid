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
 * Cycle 7 / Task 6 — operator <select> + date inputs extracted into
 * `buildConditionRow` so the popup either renders alone (default) or
 * wraps inside `MultiConditionWrapper` when `maxNumConditions > 1`.
 *
 * The worker's `matchesDate` (in `worker/dataPipeline.ts`) already
 * parses both sides via `Date.parse` and compares numerically, so the
 * popup's only contract is to emit ISO strings — the exact format a
 * native `<input type="date">.value` produces (`YYYY-MM-DD`).
 */

import type {
  CDateFilterModel,
  CDateFilterOp,
  CFilterModelEntry,
  CMultiConditionFilterModel,
} from '../../types';
import type { FilterPopupFactory } from './filterPopupHost';
import { MultiConditionWrapper, type MultiConditionJoin } from './multiCondition';

export type DateFilterButton = 'apply' | 'clear' | 'reset' | 'cancel';

export interface DateFilterPopupDeps {
  initialModel: CDateFilterModel | CMultiConditionFilterModel | null;
  onApply: (model: CDateFilterModel | CMultiConditionFilterModel | null) => void;
  onClose: () => void;
  buttons?: DateFilterButton[];
  closeOnApply?: boolean;
  maxNumConditions?: number;
  numAlwaysVisibleConditions?: number;
  defaultJoinOperator?: MultiConditionJoin;
  /** Cycle 7 / Task 9 — fires on every popup-internal mutation
   *  (operator change, date typed, multi-condition row added). Wires
   *  to the `filterModified` event on `VelocityGridApi`. Optional. */
  onModified?: () => void;
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

interface RowController {
  el: HTMLElement;
  getModel(): CDateFilterModel | null;
  reset(): void;
  clearInputs(): void;
}

export class DateFilterPopup implements FilterPopupFactory {
  private gui: HTMLDivElement | null = null;
  private destroyed = false;
  private singleRow: RowController | null = null;
  private rowControllers: RowController[] = [];
  private wrapper: MultiConditionWrapper | null = null;

  constructor(private deps: DateFilterPopupDeps) {}

  buildGui(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'vg-filter-popup vg-filter-popup-date';

    const maxConditions = this.deps.maxNumConditions ?? 1;
    if (maxConditions > 1) {
      const initial = this.normalizeInitial();
      this.wrapper = new MultiConditionWrapper(root, {
        buildConditionRow: (rowInitial, onChange) => {
          const wrapped = (next: CDateFilterModel | null): void => {
            onChange(next);
            this.deps.onModified?.();
          };
          const ctl = this.buildConditionRow(rowInitial as CDateFilterModel | null, wrapped);
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
    buttonsRow.className = 'vg-filter-popup-row vg-filter-popup-buttons';
    const buttons = this.deps.buttons ?? ['apply', 'clear', 'reset'];
    for (const kind of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vg-filter-popup-button vg-filter-popup-button-${kind}`;
      btn.setAttribute('data-vg-filter-action', kind);
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

  private buildConditionRow(
    initial: CDateFilterModel | null,
    onChange: (next: CDateFilterModel | null) => void,
  ): RowController {
    const row = document.createElement('div');
    row.className = 'vg-filter-popup-condition';

    const opRow = document.createElement('div');
    opRow.className = 'vg-filter-popup-row';
    const select = document.createElement('select');
    select.className = 'vg-filter-popup-operator';
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
    inputsRow.className = 'vg-filter-popup-row vg-filter-popup-inputs';
    const primary = document.createElement('input');
    primary.type = 'date';
    primary.className = 'vg-filter-popup-input';
    primary.setAttribute('data-vg-filter-input', 'primary');
    if (initial?.filter != null) primary.value = initial.filter;
    inputsRow.appendChild(primary);

    const secondary = document.createElement('input');
    secondary.type = 'date';
    secondary.className = 'vg-filter-popup-input';
    secondary.setAttribute('data-vg-filter-input', 'secondary');
    if (initial?.filterTo != null) secondary.value = initial.filterTo;
    inputsRow.appendChild(secondary);
    row.appendChild(inputsRow);

    const syncInputVisibility = (): void => {
      const op = select.value as CDateFilterOp;
      const isBlank = op === 'blank' || op === 'notBlank';
      const isRange = op === 'inRange';
      primary.style.display = isBlank ? 'none' : '';
      secondary.style.display = isRange ? '' : 'none';
    };

    const readModel = (): CDateFilterModel | null => {
      const op = select.value as CDateFilterOp;
      if (op === 'blank' || op === 'notBlank') {
        return { filterType: 'date', type: op };
      }
      const primaryRaw = primary.value;
      if (primaryRaw === '') return null;
      if (op === 'inRange') {
        const secondaryRaw = secondary.value;
        if (secondaryRaw === '') return null;
        return {
          filterType: 'date', type: 'inRange',
          filter: primaryRaw, filterTo: secondaryRaw,
        };
      }
      return { filterType: 'date', type: op, filter: primaryRaw };
    };

    const fire = (): void => onChange(readModel());
    select.addEventListener('change', () => {
      syncInputVisibility();
      fire();
    });
    primary.addEventListener('input', fire);
    primary.addEventListener('change', fire);
    secondary.addEventListener('input', fire);
    secondary.addEventListener('change', fire);

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

  private normalizeInitial(): {
    operator: MultiConditionJoin;
    conditions: CFilterModelEntry[];
  } {
    const m = this.deps.initialModel;
    const defaultJoin: MultiConditionJoin = this.deps.defaultJoinOperator ?? 'AND';
    if (m && m.filterType === 'multi') {
      return { operator: m.operator, conditions: m.conditions };
    }
    if (m && m.filterType === 'date') {
      return { operator: defaultJoin, conditions: [m] };
    }
    return { operator: defaultJoin, conditions: [] };
  }

  private singleInitialModel(): CDateFilterModel | null {
    const m = this.deps.initialModel;
    if (!m) return null;
    if (m.filterType === 'date') return m;
    if (m.filterType === 'multi') {
      const first = m.conditions[0];
      return first && first.filterType === 'date' ? first : null;
    }
    return null;
  }

  private handleAction(kind: DateFilterButton): void {
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

  private composeModel(): CDateFilterModel | CMultiConditionFilterModel | null {
    if (!this.wrapper) {
      return this.singleRow?.getModel() ?? null;
    }
    const models: CDateFilterModel[] = [];
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

function labelFor(kind: DateFilterButton): string {
  switch (kind) {
    case 'apply':  return 'Apply';
    case 'clear':  return 'Clear';
    case 'reset':  return 'Reset';
    case 'cancel': return 'Cancel';
  }
}
