/**
 * Cycle 7 / Task 6 — MultiConditionWrapper.
 *
 * Small DOM primitive that hosts up to two condition rows in a filter
 * popup. The wrapper itself knows nothing about text / number / date —
 * the caller passes a `buildConditionRow` factory that owns the per-type
 * UI (operator <select> + value <input>(s) + per-type extras). The
 * wrapper's responsibilities:
 *
 *   1. Mount `numAlwaysVisibleConditions` rows on initial open.
 *   2. Reveal the next row once the previous row reports a non-null
 *      condition (so a user typing into row 1 gets row 2 + the AND/OR
 *      radio "for free"). Clearing row 1 unmounts row 2.
 *   3. Mount the AND / OR join radio between consecutive rows; flipping
 *      it fires `onChange` with the new operator.
 *   4. `maxNumConditions: 1` keeps the popup single-condition: no join
 *      radio, no second row.
 *   5. Emit `{ operator, conditions }` via `onChange` on every row /
 *      operator mutation. Callers reconcile this with their own Apply
 *      semantics — when there's exactly one filled condition the
 *      caller can collapse the multi shape back to the bare single
 *      condition for back-compat.
 *
 * The wrapper does NOT call `onChange` during construction; only user
 * input fires it. Initial state is fully described by `initial`.
 */

import type { CFilterModelEntry } from '../../types';

export type MultiConditionJoin = 'AND' | 'OR';

export type MultiConditionRowFactory = (
  initial: CFilterModelEntry | null,
  onChange: (next: CFilterModelEntry | null) => void,
) => HTMLElement;

export interface MultiConditionWrapperDeps {
  buildConditionRow: MultiConditionRowFactory;
  initial: { operator: MultiConditionJoin; conditions: CFilterModelEntry[] };
  maxNumConditions: number;
  numAlwaysVisibleConditions: number;
  onChange: (next: {
    operator: MultiConditionJoin;
    conditions: CFilterModelEntry[];
  }) => void;
}

let RADIO_GROUP_SEQ = 0;

interface Slot {
  /** Current per-slot model value; null when the user has cleared the
   *  row's UI back to empty. Persists across reveal/unmount so a quick
   *  refill restores the value the factory would have read. */
  value: CFilterModelEntry | null;
  /** Mounted wrapper element when revealed; null when unmounted. */
  el: HTMLElement | null;
  /** The join row that precedes this slot (slot 0 has none). */
  joinEl: HTMLElement | null;
}

export class MultiConditionWrapper {
  private destroyed = false;
  private slots: Slot[] = [];
  private operator: MultiConditionJoin;
  /** Highest slot index currently mounted in the DOM. */
  private revealedUpTo: number;
  private host: HTMLElement;
  private deps: MultiConditionWrapperDeps;
  private readonly radioGroup: string;
  private readonly max: number;
  private readonly alwaysVisible: number;

  constructor(host: HTMLElement, deps: MultiConditionWrapperDeps) {
    this.host = host;
    this.deps = deps;
    this.operator = deps.initial.operator;
    this.radioGroup = `cg-multi-join-${++RADIO_GROUP_SEQ}`;
    this.max = Math.max(1, deps.maxNumConditions);
    this.alwaysVisible = Math.min(
      Math.max(1, deps.numAlwaysVisibleConditions),
      this.max,
    );
    const seeds = deps.initial.conditions.slice(0, this.max);
    for (let i = 0; i < this.max; i++) {
      this.slots.push({ value: seeds[i] ?? null, el: null, joinEl: null });
    }
    // Reveal `alwaysVisible` rows OR the highest-index seeded row,
    // whichever is greater.
    this.revealedUpTo = Math.max(this.alwaysVisible - 1, seeds.length - 1);
    if (this.revealedUpTo < 0) this.revealedUpTo = 0;
    for (let i = 0; i <= this.revealedUpTo; i++) this.mountSlot(i);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const slot of this.slots) {
      slot.el?.remove();
      slot.joinEl?.remove();
      slot.el = null;
      slot.joinEl = null;
    }
  }

  /** Mount slot `idx` into the DOM. Joins above slot ≥ 1 mount alongside
   *  the slot wrapper. Idempotent — re-mounting an already mounted slot
   *  is a no-op. */
  private mountSlot(idx: number): void {
    const slot = this.slots[idx];
    if (!slot || slot.el) return;
    if (idx >= 1) {
      const joinEl = this.buildJoinRow();
      this.host.appendChild(joinEl);
      slot.joinEl = joinEl;
    }
    const slotWrap = document.createElement('div');
    slotWrap.className = 'cg-filter-popup-condition-slot';
    slotWrap.setAttribute('data-cg-multi-slot', String(idx));
    const row = this.deps.buildConditionRow(slot.value, (next) => {
      slot.value = next;
      this.handleSlotChange(idx);
    });
    slotWrap.appendChild(row);
    this.host.appendChild(slotWrap);
    slot.el = slotWrap;
  }

  private unmountSlot(idx: number): void {
    const slot = this.slots[idx];
    if (!slot || !slot.el) return;
    slot.el.remove();
    slot.joinEl?.remove();
    slot.el = null;
    slot.joinEl = null;
    slot.value = null;
  }

  private buildJoinRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cg-filter-popup-row cg-filter-popup-join';
    for (const value of ['AND', 'OR'] as const) {
      const label = document.createElement('label');
      label.className = 'cg-filter-popup-join-label';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = this.radioGroup;
      radio.value = value;
      radio.checked = this.operator === value;
      radio.setAttribute('data-cg-filter-join', value);
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.operator = value;
        this.syncJoinRadios();
        this.emit();
      });
      label.appendChild(radio);
      const text = document.createElement('span');
      text.textContent = value;
      label.appendChild(text);
      row.appendChild(label);
    }
    return row;
  }

  /** Mirror the operator across every currently-mounted join row so a
   *  second-row radio reflects the choice made on the first one. The
   *  current build only ever mounts one join row at a time (we cap at
   *  two conditions), but the loop is cheap and future-proof. */
  private syncJoinRadios(): void {
    for (const slot of this.slots) {
      if (!slot.joinEl) continue;
      const radios = Array.from(
        slot.joinEl.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      );
      for (const r of radios) r.checked = r.value === this.operator;
    }
  }

  private handleSlotChange(_slotIdx: number): void {
    // Compute the new revealed range: at least `alwaysVisible - 1` slots
    // and at least one slot beyond the highest filled, capped at max - 1.
    let lastFilled = -1;
    for (let i = 0; i < this.max; i++) {
      if (this.slots[i]!.value != null) lastFilled = i;
    }
    let target = Math.max(this.alwaysVisible - 1, lastFilled + 1);
    if (target > this.max - 1) target = this.max - 1;
    if (target > this.revealedUpTo) {
      for (let i = this.revealedUpTo + 1; i <= target; i++) this.mountSlot(i);
    } else if (target < this.revealedUpTo) {
      for (let i = this.revealedUpTo; i > target; i--) this.unmountSlot(i);
    }
    this.revealedUpTo = target;
    this.emit();
  }

  private emit(): void {
    this.deps.onChange(this.getValue());
  }

  /** Read the current composite model — exposed so callers can compose
   *  the bare single-shape model on Apply (collapsing a one-condition
   *  multi back to a CTextFilterModel / CNumberFilterModel for back-
   *  compat). */
  getValue(): { operator: MultiConditionJoin; conditions: CFilterModelEntry[] } {
    const conditions: CFilterModelEntry[] = [];
    for (let i = 0; i <= this.revealedUpTo; i++) {
      const v = this.slots[i]!.value;
      if (v != null) conditions.push(v);
    }
    return { operator: this.operator, conditions };
  }
}
