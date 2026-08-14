import { el } from './dom';

/** Titled section card (Connection / Behaviour / Diagnostics groups).
 *  Title chevron collapses sibling content — same affordance as cockpit bands. */
export function createCard(
  title: string,
  fill?: (card: HTMLElement) => void,
): HTMLElement {
  const card = el('section', 'vg-dp-card');
  const head = el('button', {
    type: 'button',
    className: 'vg-dp-card__title',
    'aria-expanded': 'true',
  }, title);
  head.addEventListener('click', () => {
    const collapsed = card.classList.toggle('is-collapsed');
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
  card.appendChild(head);
  fill?.(card);
  return card;
}

export function createBadge(
  text: string,
  opts?: { variant?: 'default' | 'outline' | 'accent'; className?: string },
): HTMLElement {
  const variant = opts?.variant ?? 'default';
  return el(
    'span',
    {
      className: [
        'vg-dp-badge',
        variant !== 'default' ? `vg-dp-badge--${variant}` : '',
        opts?.className ?? '',
      ].filter(Boolean).join(' '),
    },
    text,
  );
}
