/**
 * Cycle 21i / Phase 1 (T3) — vanilla settings-form renderer.
 *
 * Renders a `SettingsSection` (bands → fields) as a themed, keyboard-
 * accessible form. One renderer serves every native settings surface:
 * the Grid Options tool panel first, host-registered Custom Settings
 * sections later (decision D-G).
 *
 * Design language (Cycle 21i design pass): quartz-native chrome from
 * `--cg-*` tokens; 11px uppercase band eyebrows; label-left /
 * control-right rows; numeric inputs in the grid's mono face. The
 * signature element is the MODIFIED DIFF RAIL — a 2px accent tick on the
 * left edge of any field whose value differs from its declared default
 * (echoing the grid's cell-change flash), with a hover reset affordance,
 * per-band modified-count chips, and a header-level "modified only"
 * filter driven by the host panel.
 */

import type {
  SettingsBand,
  SettingsField,
  SettingsSection,
} from '../../types/settingsSchema';
import { isFieldModified, resolveFieldDefault } from '../../types/settingsSchema';

interface FieldRow {
  field: SettingsField;
  bandId: string;
  row: HTMLElement;
  /** Sync the control + modified decorations from `field.get()`. */
  sync(): void;
  /** Lower-cased haystack for the text filter. */
  searchText: string;
}

interface BandView {
  band: SettingsBand;
  root: HTMLElement;
  header: HTMLButtonElement;
  body: HTMLElement;
  chip: HTMLElement;
  collapsed: boolean;
}

let idCounter = 0;
const nextId = () => `cg-settings-${++idCounter}`;

export class SettingsForm {
  readonly root: HTMLElement;
  private rows: FieldRow[] = [];
  private bands: BandView[] = [];
  private filterText = '';
  private modifiedOnly = false;
  /** While a text filter is active, bands force-expand; their manual
   *  collapsed state is restored when the filter clears. */
  private filtering = false;

  constructor(section: SettingsSection, private readonly onAfterChange?: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'cg-settings-form';
    this.root.setAttribute('data-section-id', section.id);
    for (const band of section.bands) this.root.appendChild(this.buildBand(band));
    this.applyVisibility();
  }

  /** Free-text filter over band titles + field labels/keys. */
  setFilter(text: string): void {
    this.filterText = text.trim().toLowerCase();
    this.filtering = this.filterText.length > 0;
    this.applyVisibility();
  }

  /** Show only fields whose value differs from their default. */
  setModifiedOnly(on: boolean): void {
    this.modifiedOnly = on;
    this.applyVisibility();
  }

  /** Re-read every field's live value (e.g. after a state restore). */
  refresh(): void {
    for (const r of this.rows) r.sync();
    this.updateChips();
    if (this.modifiedOnly) this.applyVisibility();
  }

  /** Total modified-field count (drives the host panel's header pill). */
  modifiedCount(): number {
    return this.rows.reduce((n, r) => n + (isFieldModified(r.field) ? 1 : 0), 0);
  }

  destroy(): void {
    this.root.remove();
    this.rows = [];
    this.bands = [];
  }

  // ─── build ────────────────────────────────────────────────────────────

  private buildBand(band: SettingsBand): HTMLElement {
    const root = document.createElement('section');
    root.className = 'cg-settings-band';
    root.setAttribute('data-band-id', band.id);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'cg-settings-band-header';
    const chevron = document.createElement('span');
    chevron.className = 'cg-settings-band-chevron';
    const title = document.createElement('span');
    title.className = 'cg-settings-band-title';
    title.textContent = band.title;
    const chip = document.createElement('span');
    chip.className = 'cg-settings-band-chip';
    chip.hidden = true;
    header.append(chevron, title, chip);

    const body = document.createElement('div');
    body.className = 'cg-settings-band-body';

    const view: BandView = { band, root, header, body, chip, collapsed: band.collapsed === true };
    header.setAttribute('aria-expanded', String(!view.collapsed));
    header.addEventListener('click', () => {
      view.collapsed = !view.collapsed;
      this.applyVisibility();
    });

    for (const field of band.fields) body.appendChild(this.buildRow(field, band.id));

    root.append(header, body);
    this.bands.push(view);
    this.updateChip(view);
    return root;
  }

  private buildRow(field: SettingsField, bandId: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cg-settings-row';
    row.setAttribute('data-field-key', field.key);

    const labelWrap = document.createElement('div');
    labelWrap.className = 'cg-settings-row-label';
    const controlId = nextId();
    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = controlId;
    labelWrap.appendChild(label);
    if (field.hint) {
      const hint = document.createElement('span');
      hint.className = 'cg-settings-row-hint';
      hint.textContent = field.hint;
      labelWrap.appendChild(hint);
    }

    const controlWrap = document.createElement('div');
    controlWrap.className = 'cg-settings-row-control';

    // Reset affordance lives in a PERMANENTLY reserved action gutter so
    // its appearance never shifts the control column — every row's edit
    // box shares the same right edge. The button toggles visibility (not
    // layout) and only exists when a concrete default can be restored.
    const actions = document.createElement('span');
    actions.className = 'cg-settings-row-actions';
    let resetBtn: HTMLButtonElement | null = null;
    if (resolveFieldDefault(field) !== undefined) {
      resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'cg-settings-row-reset';
      resetBtn.title = 'Reset to default';
      resetBtn.setAttribute('aria-label', `Reset ${field.label} to default`);
      resetBtn.textContent = '↺';
      resetBtn.setAttribute('data-visible', 'false');
      actions.appendChild(resetBtn);
    }

    // `commit` needs the entry (built below); the control gets a stable
    // wrapper so wiring order doesn't matter.
    let commitFn: (value: unknown) => void = () => {};
    const { control, sync: syncControl } = this.buildControl(field, controlId, (v) => commitFn(v));

    const entry: FieldRow = {
      field,
      bandId,
      row,
      searchText: `${field.label} ${field.key} ${field.hint ?? ''}`.toLowerCase(),
      sync: () => {
        syncControl();
        const modified = isFieldModified(field);
        row.toggleAttribute('data-modified', modified);
        resetBtn?.setAttribute('data-visible', String(modified));
      },
    };

    commitFn = (value: unknown) => {
      try {
        field.set(value);
      } catch (err) {
        console.warn(`[cgrid] settings: failed to set '${field.key}'`, err);
      }
      entry.sync();
      this.updateChips();
      if (this.modifiedOnly) this.applyVisibility();
      this.onAfterChange?.();
    };

    resetBtn?.addEventListener('click', () => commitFn(resolveFieldDefault(field)));

    controlWrap.appendChild(control);
    controlWrap.appendChild(actions);
    row.append(labelWrap, controlWrap);
    this.rows.push(entry);
    entry.sync();
    return row;
  }

  /** Build the typed control. Returns the element + a sync fn that pulls
   *  `field.get()` back into the control (post-commit normalization,
   *  external refresh). `commitRef` defers binding so the row's commit
   *  closure (which needs the entry) can be created after the control. */
  private buildControl(
    field: SettingsField,
    controlId: string,
    commit: (value: unknown) => void,
  ): { control: HTMLElement; sync: () => void } {
    switch (field.type) {
      case 'switch': {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = controlId;
        btn.className = 'cg-settings-toggle';
        btn.setAttribute('aria-label', field.label);
        const knob = document.createElement('span');
        knob.className = 'cg-settings-toggle-knob';
        btn.appendChild(knob);
        btn.addEventListener('click', () => {
          const next = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(next));
          commit(next);
        });
        return {
          control: btn,
          sync: () => btn.setAttribute('aria-pressed', String(field.get() === true)),
        };
      }
      case 'checkbox': {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = controlId;
        input.className = 'cg-settings-checkbox';
        input.addEventListener('change', () => commit(input.checked));
        return { control: input, sync: () => { input.checked = field.get() === true; } };
      }
      case 'number': {
        const input = document.createElement('input');
        input.type = 'number';
        input.id = controlId;
        input.className = 'cg-settings-input cg-settings-input-number';
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        if (field.step !== undefined) input.step = String(field.step);
        if (resolveFieldDefault(field) === undefined) input.placeholder = 'auto';
        input.addEventListener('change', () => {
          if (input.value === '') {
            // Empty = revert to default when one exists; otherwise "auto"
            // (undefined) — the option resolver falls back internally.
            commit(resolveFieldDefault(field));
            return;
          }
          const n = Number(input.value);
          if (!Number.isFinite(n)) return;
          commit(n);
        });
        return {
          control: input,
          sync: () => {
            const v = field.get();
            input.value = typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
          },
        };
      }
      case 'select': {
        const select = document.createElement('select');
        select.id = controlId;
        select.className = 'cg-settings-input cg-settings-select';
        for (const opt of field.options ?? []) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          select.appendChild(o);
        }
        select.addEventListener('change', () => commit(select.value));
        return {
          control: select,
          sync: () => {
            const v = field.get();
            select.value = typeof v === 'string' ? v : String(v ?? '');
          },
        };
      }
      case 'text':
      default: {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = controlId;
        input.className = 'cg-settings-input cg-settings-input-text';
        input.addEventListener('change', () => commit(input.value));
        return {
          control: input,
          sync: () => {
            const v = field.get();
            input.value = v === undefined || v === null ? '' : String(v);
          },
        };
      }
    }
  }

  // ─── visibility ───────────────────────────────────────────────────────

  private rowMatches(entry: FieldRow, bandTitleMatch: boolean): boolean {
    if (this.modifiedOnly && !isFieldModified(entry.field)) return false;
    if (this.filterText.length === 0) return true;
    return bandTitleMatch || entry.searchText.includes(this.filterText);
  }

  private applyVisibility(): void {
    for (const view of this.bands) {
      const bandTitleMatch =
        this.filterText.length > 0 &&
        view.band.title.toLowerCase().includes(this.filterText);
      let visibleRows = 0;
      for (const entry of this.rows) {
        if (entry.bandId !== view.band.id) continue;
        const show = this.rowMatches(entry, bandTitleMatch);
        entry.row.hidden = !show;
        if (show) visibleRows++;
      }
      const bandVisible = visibleRows > 0;
      view.root.hidden = !bandVisible;
      // Filtering force-expands so matches are visible; manual collapse
      // state is preserved for when the filter clears.
      const expanded = this.filtering || this.modifiedOnly ? true : !view.collapsed;
      view.body.hidden = !expanded;
      view.header.setAttribute('aria-expanded', String(expanded));
    }
  }

  private updateChip(view: BandView): void {
    const count = this.rows.filter(
      (r) => r.bandId === view.band.id && isFieldModified(r.field),
    ).length;
    view.chip.hidden = count === 0;
    view.chip.textContent = String(count);
  }

  private updateChips(): void {
    for (const view of this.bands) this.updateChip(view);
  }
}
