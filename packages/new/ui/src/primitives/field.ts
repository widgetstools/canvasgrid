import { el, type Disposable } from './dom';

export function mountField(
  host: HTMLElement,
  opts: {
    label: string;
    value?: string;
    type?: string;
    placeholder?: string;
    onChange?: (value: string) => void;
  },
): Disposable & { input: HTMLInputElement; getValue(): string; setValue(v: string): void } {
  const wrap = el('label', 'vgn-field');
  wrap.appendChild(el('span', 'vgn-field__label', opts.label));
  const input = el('input', 'vgn-field__control');
  input.type = opts.type ?? 'text';
  if (opts.value != null) input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  const onChange = opts.onChange;
  if (onChange) input.addEventListener('input', () => onChange(input.value));
  wrap.appendChild(input);
  host.appendChild(wrap);
  return {
    input,
    getValue: () => input.value,
    setValue(v: string) { input.value = v; },
    destroy() { wrap.remove(); },
  };
}

export function mountSelect(
  host: HTMLElement,
  opts: {
    label: string;
    options: Array<{ value: string; label: string }>;
    value?: string;
    onChange?: (value: string) => void;
  },
): Disposable & {
  select: HTMLSelectElement;
  getValue(): string;
  setValue(v: string): void;
  setOptions(options: Array<{ value: string; label: string }>): void;
} {
  const wrap = el('label', 'vgn-field');
  wrap.appendChild(el('span', 'vgn-field__label', opts.label));
  const select = el('select', 'vgn-field__control');
  const fill = (options: Array<{ value: string; label: string }>): void => {
    const prev = select.value;
    select.replaceChildren();
    for (const o of options) {
      const opt = el('option', undefined, o.label);
      opt.value = o.value;
      select.appendChild(opt);
    }
    if (options.some((o) => o.value === prev)) select.value = prev;
    else if (opts.value != null && options.some((o) => o.value === opts.value)) {
      select.value = opts.value;
    }
  };
  fill(opts.options);
  if (opts.value != null) select.value = opts.value;
  const onChange = opts.onChange;
  if (onChange) select.addEventListener('change', () => onChange(select.value));
  wrap.appendChild(select);
  host.appendChild(wrap);
  return {
    select,
    getValue: () => select.value,
    setValue(v: string) { select.value = v; },
    setOptions: fill,
    destroy() { wrap.remove(); },
  };
}
