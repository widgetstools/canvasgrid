import { el } from './dom';

/** Labeled field — cockpit row layout (caps label left, control + help right). */
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
  const main = el('div', 'vg-dp-field__main');
  main.appendChild(opts.control);
  if (opts.help) {
    const help = el('p', 'vg-dp-field__help');
    if (typeof opts.help === 'string') help.textContent = opts.help;
    else help.appendChild(opts.help);
    main.appendChild(help);
  }
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
