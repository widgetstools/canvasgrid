import { el } from './dom';

/** Labeled field with optional help text under the control. */
export function createField(opts: {
  label: string;
  control: HTMLElement;
  help?: string | Node;
  required?: boolean;
  className?: string;
}): HTMLElement {
  const block = el('div', opts.className ?? 'vg-dp-field');
  const lab = el(
    'label',
    'vg-dp-field__label',
    opts.required ? `${opts.label} *` : opts.label,
  );
  block.append(lab, opts.control);
  if (opts.help) {
    const help = el('p', 'vg-dp-field__help');
    if (typeof opts.help === 'string') help.textContent = opts.help;
    else help.appendChild(opts.help);
    block.appendChild(help);
  }
  return block;
}

/** Number field with label + help (Behaviour tab). */
export function createNumberField(opts: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  help?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}): HTMLElement {
  const input = el('input', {
    type: 'number',
    min: opts.min,
    max: opts.max,
    step: opts.step,
    disabled: opts.disabled || undefined,
  });
  input.value = String(opts.value);
  if (opts.disabled) input.disabled = true;
  input.addEventListener('change', () => opts.onChange(Number(input.value) || 0));
  return createField({
    label: opts.label,
    control: input,
    help: opts.help,
  });
}
