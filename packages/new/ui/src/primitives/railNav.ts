import { el, clear, type Disposable } from './dom';

export type RailItem = { id: string; label: string };
export type RailSection = { id: string; label: string; items: RailItem[] };

export function mountRailNav(
  host: HTMLElement,
  opts: {
    sections: RailSection[];
    activeId?: string;
    onSelect: (id: string) => void;
  },
): Disposable & { setActive(id: string): void } {
  const rail = el('nav', 'vgn-rail');
  rail.setAttribute('aria-label', 'Customize');
  let active = opts.activeId ?? opts.sections[0]?.items[0]?.id ?? '';

  const render = (): void => {
    clear(rail);
    for (const section of opts.sections) {
      rail.appendChild(el('div', 'vgn-rail__section', section.label));
      for (const item of section.items) {
        const btn = el('button', 'vgn-rail__item', item.label);
        btn.type = 'button';
        if (item.id === active) btn.setAttribute('aria-current', 'true');
        btn.addEventListener('click', () => {
          active = item.id;
          render();
          opts.onSelect(item.id);
        });
        rail.appendChild(btn);
      }
    }
  };
  render();
  host.appendChild(rail);
  return {
    setActive(id: string) { active = id; render(); },
    destroy() { rail.remove(); },
  };
}
