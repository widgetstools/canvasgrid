import { el, type Disposable } from './dom';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

export function mountButton(
  host: HTMLElement,
  opts: {
    label: string;
    variant?: ButtonVariant;
    disabled?: boolean;
    icon?: boolean;
    title?: string;
    pressed?: boolean;
    onClick?: () => void;
  },
): Disposable & {
  button: HTMLButtonElement;
  setDisabled(d: boolean): void;
  setPressed(p: boolean): void;
  setLabel(label: string): void;
} {
  const variant = opts.variant ?? 'default';
  const parts = ['vgn-btn'];
  if (variant !== 'default') parts.push(`vgn-btn--${variant}`);
  if (opts.icon) parts.push('vgn-btn--icon');
  if (opts.pressed) parts.push('vgn-btn--pressed');
  const button = el('button', parts.join(' '), opts.label);
  button.type = 'button';
  button.disabled = !!opts.disabled;
  if (opts.title) button.title = opts.title;
  button.setAttribute('aria-label', opts.title ?? opts.label);
  const onClick = opts.onClick;
  if (onClick) button.addEventListener('click', onClick);
  host.appendChild(button);
  return {
    button,
    setDisabled(d: boolean) { button.disabled = d; },
    setPressed(p: boolean) {
      button.classList.toggle('vgn-btn--pressed', p);
      button.setAttribute('aria-pressed', p ? 'true' : 'false');
    },
    setLabel(label: string) {
      button.textContent = label;
      button.setAttribute('aria-label', opts.title ?? label);
    },
    destroy() {
      if (onClick) button.removeEventListener('click', onClick);
      button.remove();
    },
  };
}
