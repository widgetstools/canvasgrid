import { el, type Disposable } from './dom';

export function mountBanner(
  host: HTMLElement,
  opts: { text: string; tone?: 'default' | 'warn' },
): Disposable {
  const cls = opts.tone === 'warn' ? 'vgn-banner vgn-banner--warn' : 'vgn-banner';
  const node = el('div', cls, opts.text);
  host.appendChild(node);
  return { destroy() { node.remove(); } };
}

export function mountEmptyState(
  host: HTMLElement,
  opts: { title: string; detail?: string },
): Disposable {
  const node = el('div', 'vgn-empty');
  node.appendChild(el('strong', undefined, opts.title));
  if (opts.detail) node.appendChild(el('div', undefined, opts.detail));
  host.appendChild(node);
  return { destroy() { node.remove(); } };
}
