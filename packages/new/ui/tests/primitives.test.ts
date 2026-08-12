import { describe, expect, it } from 'vitest';
import {
  confirmDialog,
  injectVgNewStyles,
  mountSplitList,
  mountTabs,
  showToast,
} from '../src/index';

describe('vg-new-ui primitives', () => {
  it('tabs change active', () => {
    injectVgNewStyles(document);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const seen: string[] = [];
    const tabs = mountTabs(host, {
      tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      onChange: (id) => seen.push(id),
    });
    expect(host.querySelectorAll('.vgn-tabs__tab')[0]!.getAttribute('aria-selected')).toBe('true');
    (host.querySelectorAll('.vgn-tabs__tab')[1] as HTMLButtonElement).click();
    expect(seen).toEqual(['b']);
    expect(host.querySelectorAll('.vgn-tabs__tab')[1]!.getAttribute('aria-selected')).toBe('true');
    tabs.destroy();
  });

  it('split list renders detail', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const split = mountSplitList(host, {
      items: [{ id: '1', label: 'One' }, { id: '2', label: 'Two' }],
      onSelect: () => {},
      renderDetail: (h, id) => {
        h.textContent = `detail:${id}`;
      },
    });
    expect(host.textContent).toContain('detail:1');
    (host.querySelectorAll('.vgn-split__item')[1] as HTMLButtonElement).click();
    expect(host.textContent).toContain('detail:2');
    split.destroy();
  });

  it('toast mounts and dialog resolves', async () => {
    injectVgNewStyles(document);
    const t = showToast('hi', { tone: 'ok', ms: 10 });
    expect(document.querySelector('.vgn-toast')?.textContent).toBe('hi');
    t.destroy();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const p = confirmDialog(host, {
      title: 'Sure?',
      body: 'Discard?',
      confirmLabel: 'Discard',
    });
    const confirm = host.querySelector('.vgn-btn--primary, .vgn-btn--danger') as HTMLButtonElement
      ?? [...host.querySelectorAll('.vgn-btn')].find((b) => b.textContent === 'Discard') as HTMLButtonElement;
    confirm.click();
    await expect(p).resolves.toBe(true);
  });
});
