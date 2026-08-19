/**
 * Cross-module workflow badges — Phase 4d.
 * Card-style links that open another Customize settings module via
 * `ctx.events.emit({ type: 'open-settings', id })`.
 */

export interface WorkflowLinkOpts {
  /** Button label, e.g. "View audit trail" */
  label: string;
  /** Lucide icon name */
  icon?: string;
  /** Target settings-module id (e.g. `data-change-history`) */
  moduleId: string;
  /** Ext event bus — emits `open-settings` */
  events: { emit(e: { type: string; id?: string }): void };
  /** Optional Lucide renderer from cockpit */
  lucideSvg?: (name: string, size?: number) => string;
  /** Optional short hint under the label */
  hint?: string;
}

/**
 * Build a workflow badge that navigates to a related customize module.
 */
export function workflowLink(opts: WorkflowLinkOpts): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ckp-workflow-link';
  btn.setAttribute('data-module-id', opts.moduleId);

  const iconEl = document.createElement('span');
  iconEl.className = 'ckp-workflow-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  if (opts.icon && opts.lucideSvg) iconEl.innerHTML = opts.lucideSvg(opts.icon, 14);

  const copyEl = document.createElement('span');
  copyEl.className = 'ckp-workflow-copy';
  const labelEl = document.createElement('span');
  labelEl.className = 'ckp-workflow-label';
  labelEl.textContent = opts.label;
  copyEl.appendChild(labelEl);
  if (opts.hint) {
    const hintEl = document.createElement('span');
    hintEl.className = 'ckp-workflow-hint';
    hintEl.textContent = opts.hint;
    copyEl.appendChild(hintEl);
  }

  const chevronEl = document.createElement('span');
  chevronEl.className = 'ckp-workflow-chevron';
  chevronEl.setAttribute('aria-hidden', 'true');
  if (opts.lucideSvg) chevronEl.innerHTML = opts.lucideSvg('chevron-right', 14);
  else chevronEl.textContent = '›';

  btn.append(iconEl, copyEl, chevronEl);

  btn.addEventListener('click', () => {
    opts.events.emit({ type: 'open-settings', id: opts.moduleId });
  });
  return btn;
}

/** Stack one or more workflow links under a module header. */
export function workflowStrip(links: HTMLElement[]): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'ckp-workflow-strip';
  for (const link of links) strip.appendChild(link);
  return strip;
}
