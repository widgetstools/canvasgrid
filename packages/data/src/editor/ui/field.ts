import { el } from './dom';

/** Labeled field — label + help stacked left, control right on a fixed column edge. */
export function createField(opts: {
  label: string;
  control: HTMLElement;
  help?: string | Node;
  required?: boolean;
  className?: string;
}): HTMLElement {
  const block = el('div', opts.className ?? 'vg-dp-field');
  const lab = el('div', 'vg-dp-field__label');
  lab.appendChild(el('span', 'vg-dp-field__title', opts.required ? `${opts.label} *` : opts.label));
  if (opts.help) {
    const help = el('p', 'vg-dp-field__help');
    if (typeof opts.help === 'string') help.textContent = opts.help;
    else help.appendChild(opts.help);
    lab.appendChild(help);
  }
  const main = el('div', 'vg-dp-field__main');
  main.appendChild(opts.control);
  block.append(lab, main);
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
