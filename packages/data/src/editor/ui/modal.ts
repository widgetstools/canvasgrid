import { el } from './dom';
import { createButton } from './button';

export type ModalAction = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  testId?: string;
};

export type ModalOpts = {
  title: string;
  description?: string;
  body?: HTMLElement | string;
  actions: ModalAction[];
  onBackdropClose?: () => void;
  testId?: string;
  /** Create nodes in this document (DataProvider popout vs opener). */
  document?: Document;
};

/** Centered modal overlay + dialog. Caller appends the returned overlay. */
export function createModal(opts: ModalOpts): HTMLElement {
  const doc = opts.document ?? document;
  const overlay = el('div', {
    className: 'vg-dp-modal-overlay',
    'data-testid': opts.testId,
  }, undefined, doc);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) opts.onBackdropClose?.();
  });

  const dialog = el('div', {
    className: 'vg-dp-modal',
    role: 'dialog',
    'aria-modal': 'true',
  }, undefined, doc);

  const header = el('div', 'vg-dp-modal__header', undefined, doc);
  header.appendChild(el('h3', null, opts.title, doc));
  if (opts.description) {
    header.appendChild(el('p', null, opts.description, doc));
  }
  dialog.appendChild(header);

  if (opts.body) {
    const body = el('div', 'vg-dp-modal__body', undefined, doc);
    if (typeof opts.body === 'string') body.textContent = opts.body;
    else body.appendChild(opts.body);
    dialog.appendChild(body);
  }

  const footer = el('div', 'vg-dp-modal__footer', undefined, doc);
  for (const a of opts.actions) {
    footer.appendChild(createButton({
      label: a.label,
      onClick: a.onClick,
      variant: a.variant ?? 'secondary',
      disabled: a.disabled,
      testId: a.testId,
      document: doc,
    }));
  }
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  return overlay;
}
