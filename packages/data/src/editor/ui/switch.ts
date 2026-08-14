import { el } from './dom';

/** Canonical boolean — kernel `.vg-checkbox`. */
export function createSwitch(
  checked: boolean,
  onChange: (on: boolean) => void,
): HTMLInputElement {
  const box = el('input', {
    type: 'checkbox',
    className: 'vg-checkbox',
  }) as HTMLInputElement;
  box.checked = checked;
  box.addEventListener('click', () => onChange(box.checked));
  return box;
}

/** Settings row: label + help left, checkbox right. */
export function createSwitchField(opts: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  help?: string;
}): HTMLElement {
  const block = el('div', 'vg-dp-field');
  const lab = el('div', 'vg-dp-field__label');
  const title = el('span', 'vg-dp-field__title', opts.label);
  lab.appendChild(title);
  if (opts.help) lab.appendChild(el('p', 'vg-dp-field__help', opts.help));
  const sw = createSwitch(opts.checked, opts.onChange);
  title.style.cursor = 'pointer';
  title.addEventListener('click', () => sw.click());
  const main = el('div', 'vg-dp-field__main');
  main.appendChild(sw);
  block.append(lab, main);
  return block;
}
