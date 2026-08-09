import { el } from './dom';

export type TabItem<T extends string> = {
  id: T;
  label: string;
};

export type TabsOpts<T extends string> = {
  tabs: ReadonlyArray<TabItem<T> | T>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
  tabClassName?: string;
};

/** Horizontal tab list (`role=tablist`). */
export function createTabs<T extends string>(opts: TabsOpts<T>): HTMLElement {
  const bar = el('div', {
    className: opts.className ?? 'vg-dp-editor__tabs',
    role: 'tablist',
  });
  for (const raw of opts.tabs) {
    const id = (typeof raw === 'string' ? raw : raw.id) as T;
    const label = typeof raw === 'string' ? raw : raw.label;
    const btn = el('button', {
      type: 'button',
      className: opts.tabClassName ?? 'vg-dp-editor__tab',
      role: 'tab',
      'aria-selected': id === opts.active ? 'true' : 'false',
    }, label);
    btn.addEventListener('click', () => {
      if (id !== opts.active) opts.onChange(id);
    });
    bar.appendChild(btn);
  }
  return bar;
}
