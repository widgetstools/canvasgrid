import { el } from './dom';
import { createButton, type ButtonOpts } from './button';

export type EmptyStateOpts = {
  title: string;
  description?: string;
  icon?: string;
  action?: ButtonOpts;
  className?: string;
};

/** Centered empty-state block (Fields / Columns / shell right pane). */
export function createEmptyState(opts: EmptyStateOpts): HTMLElement {
  const wrap = el('div', opts.className ?? 'vg-dp-editor__fields-empty');
  if (opts.icon) {
    wrap.appendChild(el('div', 'vg-dp-editor__fields-empty-icon', opts.icon));
  }
  wrap.appendChild(el('h3', null, opts.title));
  if (opts.description) {
    wrap.appendChild(el('p', null, opts.description));
  }
  if (opts.action) {
    wrap.appendChild(createButton({ ...opts.action, variant: opts.action.variant ?? 'primary' }));
  }
  return wrap;
}
