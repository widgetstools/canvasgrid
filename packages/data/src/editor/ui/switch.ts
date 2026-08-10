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

/** Cockpit-style row: caps label left, switch (+ help) right. */
export function createSwitchField(opts: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  help?: string;
}): HTMLElement {
  const block = el('div', 'vg-dp-field');
  const lab = el('label', 'vg-dp-field__label', opts.label);
  lab.style.cursor = 'pointer';
  const sw = createSwitch(opts.checked, opts.onChange);
  lab.addEventListener('click', () => sw.click());
  const main = el('div', 'vg-dp-field__main');
  main.appendChild(sw);
  if (opts.help) {
    main.appendChild(el('p', 'vg-dp-field__help', opts.help));
  }
  block.append(lab, main);
  return block;
}
