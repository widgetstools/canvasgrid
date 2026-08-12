import { el, type Disposable } from './dom';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

export function mountButton(
  host: HTMLElement,
  opts: {
    label: string;
    variant?: ButtonVariant;
    disabled?: boolean;
    onClick?: () => void;
  },
): Disposable & { button: HTMLButtonElement; setDisabled(d: boolean): void } {
  const variant = opts.variant ?? 'default';
  const cls = variant === 'default' ? 'vgn-btn' : `vgn-btn vgn-btn--${variant}`;
  const button = el('button', cls, opts.label);
  button.type = 'button';
  button.disabled = !!opts.disabled;
  const onClick = opts.onClick;
  if (onClick) button.addEventListener('click', onClick);
  host.appendChild(button);
  return {
    button,
    setDisabled(d: boolean) { button.disabled = d; },
    destroy() {
      if (onClick) button.removeEventListener('click', onClick);
      button.remove();
    },
  };
}
