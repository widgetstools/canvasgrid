import { el, type Disposable } from './dom';

export type ToastTone = 'ok' | 'warn' | 'err' | 'default';

let hostEl: HTMLElement | null = null;

function ensureHost(doc: Document): HTMLElement {
  if (hostEl && hostEl.isConnected) return hostEl;
  hostEl = doc.createElement('div');
  hostEl.className = 'vgn-toast-host';
  hostEl.setAttribute('aria-live', 'polite');
  doc.body.appendChild(hostEl);
  return hostEl;
}

export function showToast(
  message: string,
  opts?: { tone?: ToastTone; ms?: number; doc?: Document },
): Disposable {
  const doc = opts?.doc ?? document;
  const host = ensureHost(doc);
  const tone = opts?.tone ?? 'default';
  const cls = tone === 'default' ? 'vgn-toast' : `vgn-toast vgn-toast--${tone}`;
  const node = el('div', cls, message);
  host.appendChild(node);
  const ms = opts?.ms ?? 2800;
  const timer = window.setTimeout(() => destroy(), ms);
  const destroy = (): void => {
    window.clearTimeout(timer);
    node.remove();
  };
  return { destroy };
}
