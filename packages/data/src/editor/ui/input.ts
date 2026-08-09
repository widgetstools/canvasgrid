import { el } from './dom';

export type TextInputOpts = {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onInput?: (value: string) => void;
  className?: string;
  mono?: boolean;
};

export function createTextInput(opts: TextInputOpts = {}): HTMLInputElement {
  const input = el('input', {
    type: 'text',
    className: [opts.className, opts.mono ? 'vg-dp-mono' : ''].filter(Boolean).join(' ') || undefined,
    placeholder: opts.placeholder,
  });
  input.value = opts.value ?? '';
  if (opts.onChange) input.addEventListener('change', () => opts.onChange!(input.value));
  if (opts.onInput) input.addEventListener('input', () => opts.onInput!(input.value));
  return input;
}

export type SearchInputOpts = {
  value?: string;
  placeholder?: string;
  onInput: (value: string) => void;
  className?: string;
};

export function createSearchInput(opts: SearchInputOpts): HTMLInputElement {
  const input = el('input', {
    type: 'search',
    className: opts.className ?? 'vg-dp-search',
    placeholder: opts.placeholder ?? 'Search…',
  });
  input.value = opts.value ?? '';
  input.addEventListener('input', () => opts.onInput(input.value));
  return input;
}

export type NumberInputOpts = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
};

export function createNumberInput(opts: NumberInputOpts): HTMLInputElement {
  const input = el('input', {
    type: 'number',
    className: opts.className,
    min: opts.min,
    max: opts.max,
    step: opts.step,
    disabled: opts.disabled || undefined,
  });
  input.value = String(opts.value);
  if (opts.disabled) input.disabled = true;
  input.addEventListener('change', () => opts.onChange(Number(input.value) || 0));
  return input;
}

export type TextareaOpts = {
  value?: string;
  placeholder?: string;
  rows?: number;
  onChange?: (value: string) => void;
  className?: string;
};

export function createTextarea(opts: TextareaOpts = {}): HTMLTextAreaElement {
  const ta = el('textarea', {
    className: opts.className,
    placeholder: opts.placeholder,
    rows: opts.rows ?? 1,
  });
  ta.value = opts.value ?? '';
  if (opts.onChange) ta.addEventListener('change', () => opts.onChange!(ta.value));
  return ta;
}

export type SelectOpts = {
  value: string;
  options: ReadonlyArray<string | { value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

export function createSelect(opts: SelectOpts): HTMLSelectElement {
  const sel = el('select', {
    className: opts.className,
    disabled: opts.disabled || undefined,
  });
  if (opts.disabled) sel.disabled = true;
  for (const o of opts.options) {
    const value = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    const opt = el('option', { value }, label);
    if (value === opts.value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => opts.onChange(sel.value));
  return sel;
}

export type CheckboxOpts = {
  checked?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function createCheckbox(opts: CheckboxOpts): HTMLInputElement {
  const cb = el('input', {
    type: 'checkbox',
    className: opts.className,
    disabled: opts.disabled || undefined,
  });
  cb.checked = Boolean(opts.checked);
  if (opts.disabled) cb.disabled = true;
  cb.addEventListener('change', () => opts.onChange(cb.checked));
  return cb;
}
