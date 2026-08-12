import { el, clear, type Disposable } from './dom';

export type SplitListItem = { id: string; label: string; detail?: string };

export function mountSplitList(
  host: HTMLElement,
  opts: {
    items: SplitListItem[];
    activeId?: string;
    onSelect: (id: string) => void;
    renderDetail: (host: HTMLElement, id: string) => Disposable | void;
  },
): Disposable & { setActive(id: string): void; setItems(items: SplitListItem[]): void } {
  const root = el('div', 'vgn-split');
  const list = el('div', 'vgn-split__list');
  const detail = el('div', 'vgn-split__detail');
  root.append(list, detail);
  host.appendChild(root);

  let items = opts.items.slice();
  let active = opts.activeId ?? items[0]?.id ?? '';
  let detailDispos: Disposable | null = null;

  const paintDetail = (): void => {
    detailDispos?.destroy();
    detailDispos = null;
    clear(detail);
    if (!active) return;
    const d = opts.renderDetail(detail, active);
    if (d) detailDispos = d;
  };

  const paintList = (): void => {
    clear(list);
    for (const item of items) {
      const btn = el('button', 'vgn-split__item', item.label);
      btn.type = 'button';
      if (item.id === active) btn.setAttribute('aria-current', 'true');
      if (item.detail) btn.title = item.detail;
      btn.addEventListener('click', () => {
        active = item.id;
        paintList();
        paintDetail();
        opts.onSelect(item.id);
      });
      list.appendChild(btn);
    }
  };

  paintList();
  paintDetail();

  return {
    setActive(id: string) { active = id; paintList(); paintDetail(); },
    setItems(next: SplitListItem[]) {
      items = next.slice();
      if (!items.some((i) => i.id === active)) active = items[0]?.id ?? '';
      paintList();
      paintDetail();
    },
    destroy() {
      detailDispos?.destroy();
      root.remove();
    },
  };
}
