import { el, type Disposable } from './dom';
import { mountButton } from './button';

export type DialogResult = 'confirm' | 'cancel';

export function mountDialog(
  host: HTMLElement,
  opts: {
    title: string;
    body: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onClose: (result: DialogResult) => void;
  },
): Disposable {
  const doc = host.ownerDocument ?? document;
  const backdrop = el('div', 'vgn-dialog-backdrop');
  backdrop.setAttribute('role', 'presentation');
  const dialog = el('div', 'vgn-dialog');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.appendChild(el('h2', 'vgn-dialog__title', opts.title));
  dialog.appendChild(el('p', undefined, opts.body));
  const actions = el('div', 'vgn-dialog__actions');
  const cancel = mountButton(actions, {
    label: opts.cancelLabel ?? 'Cancel',
    variant: 'ghost',
    onClick: () => finish('cancel'),
  });
  const confirm = mountButton(actions, {
    label: opts.confirmLabel ?? 'Confirm',
    variant: opts.danger ? 'danger' : 'primary',
    onClick: () => finish('confirm'),
  });
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') finish('cancel');
  };
  doc.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) finish('cancel');
  });

  let closed = false;
  const finish = (result: DialogResult): void => {
    if (closed) return;
    closed = true;
    destroy();
    opts.onClose(result);
  };

  const destroy = (): void => {
    doc.removeEventListener('keydown', onKey);
    cancel.destroy();
    confirm.destroy();
    backdrop.remove();
  };

  host.appendChild(backdrop);
  confirm.button.focus();
  return { destroy };
}

/** Promise helper for discard / confirm flows. */
export function confirmDialog(
  host: HTMLElement,
  opts: Omit<Parameters<typeof mountDialog>[1], 'onClose'>,
): Promise<boolean> {
  return new Promise((resolve) => {
    mountDialog(host, {
      ...opts,
      onClose: (r) => resolve(r === 'confirm'),
    });
  });
}
