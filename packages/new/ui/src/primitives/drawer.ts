import { el, type Disposable } from './dom';
import { mountButton } from './button';

export function mountDrawer(
  host: HTMLElement,
  opts: {
    title: string;
    onClose?: () => void;
  },
): Disposable & {
  root: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  setOpen(open: boolean): void;
  setTitle(title: string): void;
} {
  const root = el('aside', 'vgn-drawer');
  root.dataset.open = 'false';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', opts.title);

  const header = el('div', 'vgn-drawer__header');
  const titleEl = el('span', undefined, opts.title);
  header.appendChild(titleEl);
  const closeHost = el('div');
  header.appendChild(closeHost);
  const closeBtn = mountButton(closeHost, {
    label: 'Close',
    variant: 'ghost',
    onClick: () => {
      root.dataset.open = 'false';
      opts.onClose?.();
    },
  });

  const bodyWrap = el('div', 'vgn-drawer__body');
  const body = el('div', 'vgn-drawer__panel');
  bodyWrap.appendChild(body);
  const footer = el('div', 'vgn-drawer__footer');

  root.append(header, bodyWrap, footer);
  host.appendChild(root);

  return {
    root,
    body,
    footer,
    setOpen(open: boolean) { root.dataset.open = open ? 'true' : 'false'; },
    setTitle(title: string) { titleEl.textContent = title; },
    destroy() {
      closeBtn.destroy();
      root.remove();
    },
  };
}
