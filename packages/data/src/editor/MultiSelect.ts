/**
 * MultiSelect — Markets-style multi-value dropdown (vanilla DOM).
 *
 * Trigger shows selected values as removable chips; opens a searchable
 * checklist. Selection order is preserved (important for composite keys).
 * Built on the shared editor UI kit (`createSearchInput`).
 */

import { createSearchInput } from './ui/input';

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Optional helper (e.g. cell type) shown on the right of each option. */
  hint?: string;
};

export type MultiSelectOptions = {
  host: HTMLElement;
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange(next: string[]): void;
  placeholder?: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
};

export type MultiSelectHandle = {
  destroy(): void;
  setValue(next: readonly string[]): void;
};

export function mountMultiSelect(opts: MultiSelectOptions): MultiSelectHandle {
  const {
    host,
    options,
    onChange,
    placeholder = 'Select column(s)…',
    emptyMessage = 'No columns — add fields on the Fields tab',
    searchPlaceholder = 'Search columns…',
    disabled = false,
  } = opts;

  let value = [...opts.value];
  let open = false;
  let search = '';
  let docClose: ((e: MouseEvent) => void) | null = null;

  const root = document.createElement('div');
  root.className = 'vg-dp-ms';
  host.appendChild(root);

  const optionByValue = (): Map<string, MultiSelectOption> => {
    const m = new Map<string, MultiSelectOption>();
    for (const o of options) m.set(o.value, o);
    return m;
  };

  const setOpen = (next: boolean): void => {
    if (disabled) return;
    open = next;
    render();
    if (open) {
      const input = root.querySelector<HTMLInputElement>('.vg-dp-ms__search');
      input?.focus();
    }
  };

  const toggle = (v: string): void => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    value = next;
    onChange(next);
    render();
  };

  const remove = (v: string): void => {
    const next = value.filter((x) => x !== v);
    value = next;
    onChange(next);
    render();
  };

  const bindDocClose = (): void => {
    unbindDocClose();
    docClose = (e: MouseEvent) => {
      if (!root.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', docClose, true);
  };

  const unbindDocClose = (): void => {
    if (docClose) {
      document.removeEventListener('mousedown', docClose, true);
      docClose = null;
    }
  };

  const render = (): void => {
    unbindDocClose();
    root.replaceChildren();
    const by = optionByValue();

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'vg-dp-ms__trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-expanded', String(open));
    trigger.disabled = disabled;

    const chips = document.createElement('div');
    chips.className = 'vg-dp-ms__chips';
    if (value.length === 0) {
      const ph = document.createElement('span');
      ph.className = 'vg-dp-ms__placeholder';
      ph.textContent = options.length === 0 ? emptyMessage : placeholder;
      chips.appendChild(ph);
    } else {
      for (const v of value) {
        const chip = document.createElement('span');
        chip.className = 'vg-dp-ms__chip';
        const label = document.createElement('span');
        label.className = 'vg-dp-mono';
        label.textContent = by.get(v)?.label ?? v;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'vg-dp-ms__chip-x';
        x.setAttribute('aria-label', `Remove ${by.get(v)?.label ?? v}`);
        x.textContent = '×';
        x.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          remove(v);
        });
        chip.append(label, x);
        chips.appendChild(chip);
      }
    }

    const caret = document.createElement('span');
    caret.className = 'vg-dp-ms__caret';
    caret.textContent = '▾';
    trigger.append(chips, caret);
    trigger.addEventListener('click', () => setOpen(!open));
    root.appendChild(trigger);

    if (open) {
      bindDocClose();
      const panel = document.createElement('div');
      panel.className = 'vg-dp-ms__panel';
      panel.setAttribute('role', 'listbox');

      const searchInput = createSearchInput({
        value: search,
        placeholder: searchPlaceholder,
        className: 'vg-dp-ms__search',
        onInput: (v) => {
          search = v;
          renderPanelBody(panel);
        },
      });
      // Keep focus / open state when interacting inside the panel.
      searchInput.addEventListener('mousedown', (e) => e.stopPropagation());
      panel.appendChild(searchInput);

      const body = document.createElement('div');
      body.className = 'vg-dp-ms__options';
      panel.appendChild(body);
      renderPanelBody(panel);
      root.appendChild(panel);
    }
  };

  const renderPanelBody = (panel: HTMLElement): void => {
    const body = panel.querySelector('.vg-dp-ms__options');
    if (!(body instanceof HTMLElement)) return;
    body.replaceChildren();
    const q = search.trim().toLowerCase();
    const filtered = options.filter((o) => {
      if (!q) return true;
      return (
        o.value.toLowerCase().includes(q)
        || o.label.toLowerCase().includes(q)
        || (o.hint ?? '').toLowerCase().includes(q)
      );
    });
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'vg-dp-ms__empty';
      empty.textContent = emptyMessage;
      body.appendChild(empty);
      return;
    }
    for (const opt of filtered) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vg-dp-ms__option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(value.includes(opt.value)));
      const check = document.createElement('span');
      check.className = 'vg-dp-ms__check';
      check.textContent = value.includes(opt.value) ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'vg-dp-mono';
      label.textContent = opt.label;
      row.append(check, label);
      if (opt.hint) {
        const hint = document.createElement('span');
        hint.className = 'vg-dp-ms__hint';
        hint.textContent = opt.hint;
        row.appendChild(hint);
      }
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(opt.value);
      });
      body.appendChild(row);
    }
  };

  render();

  return {
    setValue(next) {
      value = [...next];
      render();
    },
    destroy() {
      unbindDocClose();
      root.remove();
    },
  };
}
