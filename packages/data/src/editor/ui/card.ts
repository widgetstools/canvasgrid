import { el } from './dom';

/** Titled section card (Connection / Behaviour / Diagnostics groups). */
export function createCard(
  title: string,
  fill?: (card: HTMLElement) => void,
): HTMLElement {
  const card = el('section', 'vg-dp-card');
  card.appendChild(el('h3', 'vg-dp-card__title', title));
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
