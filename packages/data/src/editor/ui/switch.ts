import { el } from './dom';

/** Toggle switch control (Markets Public / Behaviour knobs). */
export function createSwitch(
  checked: boolean,
  onChange: (on: boolean) => void,
): HTMLButtonElement {
  const btn = el('button', {
    type: 'button',
    className: `vg-dp-switch${checked ? ' is-on' : ''}`,
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
  });
  const knob = el('span', 'vg-dp-switch__knob');
  btn.appendChild(knob);
  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('is-on');
    btn.classList.toggle('is-on', next);
    btn.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  });
  return btn;
}

/** Label + switch (+ optional help) field block. */
export function createSwitchField(opts: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  help?: string;
}): HTMLElement {
  const block = el('div', 'vg-dp-field');
  const row = el('div', 'vg-dp-editor__switch-row');
  const sw = createSwitch(opts.checked, opts.onChange);
  const lab = el('label', 'vg-dp-field__label', opts.label);
  lab.style.cursor = 'pointer';
  lab.addEventListener('click', () => sw.click());
  row.append(sw, lab);
  block.appendChild(row);
  if (opts.help) {
    block.appendChild(el('p', 'vg-dp-field__help', opts.help));
  }
  return block;
}
