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

  const iconHtml = opts.icon && opts.lucideSvg
    ? opts.lucideSvg(opts.icon, 14)
    : '';
  const hintHtml = opts.hint
    ? `<span class="ckp-workflow-hint">${opts.hint}</span>`
    : '';
  btn.innerHTML =
    `<span class="ckp-workflow-icon" aria-hidden="true">${iconHtml}</span>` +
    `<span class="ckp-workflow-copy">` +
    `<span class="ckp-workflow-label">${opts.label}</span>` +
    hintHtml +
    `</span>` +
    `<span class="ckp-workflow-chevron" aria-hidden="true">${opts.lucideSvg?.('chevron-right', 14) ?? '›'}</span>`;

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
