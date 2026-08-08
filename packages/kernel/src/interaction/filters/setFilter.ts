/**
 * Cycle 7 / Task 9 — SetFilterPopup.
 *
 * Renders the popup body the FilterPopupHost mounts when the user clicks
 * the expand button on a column whose `filter` is `'set'`. Mirrors
 * ag-grid's `agSetColumnFilter`:
 *
 *   - tri-state Select All checkbox at the top
 *   - mini-search input (`suppressMiniFilter: true` hides it) that
 *     narrows the visible checkbox list inline + preserves scroll
 *   - virtualised checkbox list — backed by `VirtualList<string>` so a
 *     10k-distinct-value column costs ~17 mounted checkboxes per frame
 *   - the canonical selection state lives in a `Set<string>`, NOT in
 *     DOM; off-window rows are unmounted so reading DOM at Apply
 *     time would only see the visible window. Toggling a row
 *     programmatically + scrolling it back into view paints the
 *     correct checked state because every renderRow call reads from
 *     the Set.
 *   - Apply commits a `CSetFilterModel` via `onApply`; Clear empties
 *     the Set without committing; Reset wipes + commits `null`
 *     (clears the column's filter).
 *
 * Distinct values arrive from the caller — `cgrid.showColumnFilter`
 * fetches them via `WorkerClient.getDistinctValues` first, then
 * instantiates this popup with the resolved array. This separation
 * keeps the popup synchronous + testable; the worker round-trip lives
 * one layer up.
 */

import type { FilterPopupFactory } from './filterPopupHost';
import { VirtualList } from '../ui/virtualList';
import type { CSetFilterModel } from '../../types';

export type SetFilterButton = 'apply' | 'clear' | 'reset' | 'cancel';

export interface SetFilterPopupDeps {
  /** Pre-resolved distinct stringified values. The caller fetches these
   *  from `WorkerClient.getDistinctValues` before instantiating. */
  values: string[];
  initialModel: CSetFilterModel | null;
  onApply: (model: CSetFilterModel | null) => void;
  onClose: () => void;
  buttons?: SetFilterButton[];
  closeOnApply?: boolean;
  /** Cycle 7 / Task 9 — hides the inline search box. */
  suppressMiniFilter?: boolean;
  /** Hides the tri-state Select All checkbox. */
  suppressSelectAll?: boolean;
  /** Mini-search comparison case-sensitivity. Defaults to false. */
  caseSensitive?: boolean;
  /** Cycle 7 / Task 9 — invoked on every popup-internal mutation
   *  (checkbox toggle, Select All flip, mini-search update). Wires to
   *  the `filterModified` event on `VelocityGridApi`. Optional. */
  onModified?: () => void;
}

const ROW_HEIGHT = 24;

export class SetFilterPopup implements FilterPopupFactory {
  private destroyed = false;
  private gui: HTMLDivElement | null = null;
  private list: HTMLDivElement | null = null;
  private search: HTMLInputElement | null = null;
  private selectAll: HTMLInputElement | null = null;
  /** Canonical selection state — a row passes when its value is in this
   *  Set. Initialised from `initialModel` (or "all selected" when
   *  null). Off-window rows are unmounted so DOM is NEVER the
   *  source of truth — every renderRow callback reads from this Set. */
  private selected = new Set<string>();
  /** Currently-displayed value list — equals `deps.values` when the
   *  mini-search is empty; otherwise a filtered subset. The Set state
   *  spans the FULL `deps.values` set so an off-window toggle still
   *  participates in Select All / Apply correctness. */
  private displayed: string[] = [];
  private vlist: VirtualList<string> | null = null;

  constructor(private deps: SetFilterPopupDeps) {
    if (deps.initialModel) {
      for (const v of deps.initialModel.values) this.selected.add(v);
    } else {
      // No prior filter ⇒ every value is selected (the popup state mirrors
      // "no constraint"). When the user then unchecks any subset, Apply
      // commits the trimmed set.
      for (const v of deps.values) this.selected.add(v);
    }
    this.displayed = deps.values.slice();
  }

  buildGui(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'vg-filter-popup vg-filter-popup-set';

    if (this.deps.suppressMiniFilter !== true) {
      const searchRow = document.createElement('div');
      searchRow.className = 'vg-filter-popup-row vg-filter-popup-set-search';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Search…';
      input.className = 'vg-set-filter-search';
      input.setAttribute('data-vg-set-filter-search', '');
      input.addEventListener('input', () => this.applyMiniSearch(input.value));
      searchRow.appendChild(input);
      root.appendChild(searchRow);
      this.search = input;
    }

    if (this.deps.suppressSelectAll !== true) {
      const allRow = document.createElement('div');
      allRow.className = 'vg-filter-popup-row vg-filter-popup-set-select-all';
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'vg-checkbox vg-set-filter-select-all';
      cb.setAttribute('data-vg-set-filter-select-all', '');
      cb.addEventListener('change', () => this.handleSelectAllToggle(cb.checked));
      const text = document.createElement('span');
      text.textContent = '(Select All)';
      label.appendChild(cb);
      label.appendChild(text);
      allRow.appendChild(label);
      root.appendChild(allRow);
      this.selectAll = cb;
    }

    const listHost = document.createElement('div');
    listHost.className = 'vg-set-filter-list';
    listHost.setAttribute('data-vg-set-filter-list', '');
    // Caller (velocityGrid.ts) sizes the popup; the list takes a fixed inner
    // height by default so VirtualList has a viewport size even before
    // the popup is in a fully-styled host (covered by tokens.css).
    listHost.style.height = '200px';
    listHost.style.width = '100%';
    root.appendChild(listHost);
    this.list = listHost;

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
    this.rebuildList();
    this.syncSelectAllTriState();
    return root;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.vlist?.destroy();
    this.vlist = null;
    this.gui = null;
    this.list = null;
    this.search = null;
    this.selectAll = null;
  }

  /** Test seam — programmatically flip a value's selection state.
   *  Mirrors what a checkbox click would do without forcing the test
   *  to scroll the row into view first. The state survives
   *  virtualisation because it lives in `selected`, not DOM. */
  setValueChecked(value: string, checked: boolean): void {
    if (checked) this.selected.add(value);
    else         this.selected.delete(value);
    this.syncSelectAllTriState();
    this.vlist?.refresh();
  }

  /** Test seam — scroll the row containing `value` into view. No-op
   *  when `value` isn't in the current displayed list (mini-search
   *  may have filtered it out). */
  scrollValueIntoView(value: string): void {
    const idx = this.displayed.indexOf(value);
    if (idx < 0) return;
    this.vlist?.scrollToIndex(idx);
  }

  /** Test seam — force a re-mount of the VirtualList after the host
   *  size has been monkey-patched (happy-dom doesn't lay out so a test
   *  must drive clientHeight + then ask the list to recompute). Call
   *  AFTER setting `clientHeight` via `Object.defineProperty`. */
  rebuildList(): void {
    if (!this.list) return;
    this.vlist?.destroy();
    this.vlist = new VirtualList<string>(this.list, {
      rowHeight: ROW_HEIGHT,
      renderRow: (value) => this.renderValue(value),
    });
    this.vlist.setItems(this.displayed);
  }

  /** Build one row's checkbox + label. Reads `selected` so an
   *  off-window toggle paints correctly when the row is re-mounted. */
  private renderValue(value: string): HTMLElement {
    const row = document.createElement('label');
    row.className = 'vg-set-filter-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';
    row.style.padding = '0 8px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'vg-checkbox';
    cb.value = value;
    cb.setAttribute('data-vg-set-filter-value', '');
    cb.checked = this.selected.has(value);
    cb.addEventListener('change', () => this.handleValueToggle(value, cb.checked));
    const text = document.createElement('span');
    text.textContent = value;
    row.appendChild(cb);
    row.appendChild(text);
    return row;
  }

  private handleValueToggle(value: string, checked: boolean): void {
    if (checked) this.selected.add(value);
    else         this.selected.delete(value);
    this.syncSelectAllTriState();
    this.deps.onModified?.();
  }

  private handleSelectAllToggle(checked: boolean): void {
    // Select All operates over the displayed subset — when a mini-search
    // narrows the visible list, the toggle only affects the matches.
    // This matches ag-grid's behaviour: searched-out values keep their
    // current state.
    if (checked) {
      for (const v of this.displayed) this.selected.add(v);
    } else {
      for (const v of this.displayed) this.selected.delete(v);
    }
    this.vlist?.refresh();
    this.syncSelectAllTriState();
    this.deps.onModified?.();
  }

  /** Tri-state Select All. Indeterminate when partial; checked when
   *  every displayed value is selected; unchecked when none are. */
  private syncSelectAllTriState(): void {
    if (!this.selectAll) return;
    let on = 0;
    let off = 0;
    for (const v of this.displayed) {
      if (this.selected.has(v)) on++;
      else                       off++;
    }
    if (on === 0) {
      this.selectAll.checked = false;
      this.selectAll.indeterminate = false;
    } else if (off === 0) {
      this.selectAll.checked = true;
      this.selectAll.indeterminate = false;
    } else {
      this.selectAll.checked = false;
      this.selectAll.indeterminate = true;
    }
  }

  private applyMiniSearch(rawQuery: string): void {
    const cs = this.deps.caseSensitive === true;
    const q = cs ? rawQuery : rawQuery.toLowerCase();
    if (q === '') {
      this.displayed = this.deps.values.slice();
    } else {
      this.displayed = this.deps.values.filter((v) => {
        const s = cs ? v : v.toLowerCase();
        return s.includes(q);
      });
    }
    this.vlist?.setItems(this.displayed, { preserveScroll: true });
    this.syncSelectAllTriState();
    this.deps.onModified?.();
  }

  private handleAction(kind: SetFilterButton): void {
    if (kind === 'apply') {
      this.deps.onApply(this.composeModel());
      if (this.deps.closeOnApply !== false) this.deps.onClose();
      return;
    }
    if (kind === 'clear') {
      // Clear empties the selection without committing — the next
      // Apply ships an empty values array (deselect-all). Matches
      // ag-grid where Clear leaves the user staring at an empty list
      // until they pick something + hit Apply.
      this.selected.clear();
      this.vlist?.refresh();
      this.syncSelectAllTriState();
      this.deps.onModified?.();
      return;
    }
    if (kind === 'reset') {
      // Reset wipes the popup state back to "all selected" AND
      // commits `null` (the column has no active filter). Match the
      // text-filter precedent.
      this.selected.clear();
      for (const v of this.deps.values) this.selected.add(v);
      // Also clear the mini-search so the visible list is the full
      // distinct set again.
      if (this.search) this.search.value = '';
      this.displayed = this.deps.values.slice();
      this.vlist?.setItems(this.displayed);
      this.syncSelectAllTriState();
      this.deps.onApply(null);
      return;
    }
    if (kind === 'cancel') {
      this.deps.onClose();
      return;
    }
  }

  /** Build the model to commit on Apply. Ships the literal set of
   *  checked values — including the all-selected case (the matcher
   *  treats a fully-permissive set identically to "no filter", but the
   *  emitted model still reflects what the user did so
   *  `filterChanged.columns` correctly reports the column). Reset is
   *  the canonical "clear the column's filter" path; it commits `null`
   *  directly. Values are ordered by their position in `deps.values`
   *  so the worker matcher reads a deterministic shape. */
  private composeModel(): CSetFilterModel | null {
    const values: string[] = [];
    for (const v of this.deps.values) {
      if (this.selected.has(v)) values.push(v);
    }
    return { filterType: 'set', values };
  }
}

function labelFor(kind: SetFilterButton): string {
  switch (kind) {
    case 'apply':  return 'Apply';
    case 'clear':  return 'Clear';
    case 'reset':  return 'Reset';
    case 'cancel': return 'Cancel';
  }
}
