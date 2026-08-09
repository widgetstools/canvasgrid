import { el, setTestId } from './dom';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'default';

export type ButtonOpts = {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
  testId?: string;
  className?: string;
};

/** Shared action button used by footer, toolbar, sidebar, modals. */
export function createButton(opts: ButtonOpts): HTMLButtonElement {
  const variant = opts.variant ?? 'default';
  const className = [
    'vg-dp-btn',
    variant !== 'default' ? `vg-dp-btn--${variant}` : '',
    // Legacy class names still styled in editor CSS / shell.
    variant === 'primary' ? 'primary' : '',
    variant === 'secondary' ? 'secondary' : '',
    opts.className ?? '',
  ].filter(Boolean).join(' ');

  const btn = el('button', {
    type: 'button',
    className,
    title: opts.title,
    disabled: opts.disabled || undefined,
  }, opts.label);
  setTestId(btn, opts.testId);
  if (opts.disabled) btn.disabled = true;
  btn.addEventListener('click', () => {
    if (!btn.disabled) opts.onClick();
  });
  return btn;
}
