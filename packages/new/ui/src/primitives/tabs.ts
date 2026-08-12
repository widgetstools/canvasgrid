import { el, clear, type Disposable } from './dom';

export type TabItem = { id: string; label: string };

export function mountTabs(
  host: HTMLElement,
  opts: {
    tabs: TabItem[];
    activeId?: string;
    onChange: (id: string) => void;
  },
): Disposable & { setActive(id: string): void } {
  const root = el('div', 'vgn-tabs');
  root.setAttribute('role', 'tablist');
  let active = opts.activeId ?? opts.tabs[0]?.id ?? '';

  const render = (): void => {
    clear(root);
    for (const tab of opts.tabs) {
      const btn = el('button', 'vgn-tabs__tab', tab.label);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', tab.id === active ? 'true' : 'false');
      btn.addEventListener('click', () => {
        active = tab.id;
        render();
        opts.onChange(tab.id);
      });
      root.appendChild(btn);
    }
  };
  render();
  host.appendChild(root);
  return {
    setActive(id: string) { active = id; render(); },
    destroy() { root.remove(); },
  };
}
