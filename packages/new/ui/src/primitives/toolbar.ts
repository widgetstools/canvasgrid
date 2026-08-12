import { el, type Disposable } from './dom';

export function mountToolbar(host: HTMLElement): Disposable & {
  root: HTMLElement;
  addSeparator(): void;
} {
  const root = el('div', 'vgn-toolbar');
  host.appendChild(root);
  return {
    root,
    addSeparator() { root.appendChild(el('div', 'vgn-toolbar__sep')); },
    destroy() { root.remove(); },
  };
}
