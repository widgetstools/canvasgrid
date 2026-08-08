import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wireRibbonOverflow } from '../src/toolbar/ribbonOverflow';

describe('wireRibbonOverflow', () => {
  let track: HTMLElement;
  let button: HTMLButtonElement;
  let items: HTMLElement[];

  beforeEach(() => {
    track = document.createElement('div');
    track.style.display = 'flex';
    track.style.flexWrap = 'wrap';
    track.style.width = '200px';
    document.body.appendChild(track);

    items = [1, 2, 3, 4].map((n) => {
      const el = document.createElement('div');
      el.dataset.id = String(n);
      el.textContent = `G${n}`;
      // Force each "group" wide enough that 4 cannot sit in 1–2 rows of 200px.
      el.style.width = '120px';
      el.style.height = '40px';
      el.style.flex = '0 0 auto';
      track.appendChild(el);
      return el;
    });

    button = document.createElement('button');
    button.type = 'button';
    document.body.appendChild(button);

    // jsdom layout is limited — stub geometry so exceedsBudget can fire.
    let widths = [200];
    Object.defineProperty(track, 'clientWidth', { configurable: true, get: () => widths[0] });
    Object.defineProperty(track, 'scrollHeight', {
      configurable: true,
      get: () => {
        const n = track.childElementCount;
        const perRow = Math.max(1, Math.floor(widths[0] / 120));
        return Math.ceil(n / perRow) * 40;
      },
    });
    for (const el of items) {
      Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => 40 });
      Object.defineProperty(el, 'offsetTop', {
        configurable: true,
        get: () => {
          const kids = Array.from(track.children);
          const idx = kids.indexOf(el);
          if (idx < 0) return 0;
          const perRow = Math.max(1, Math.floor(widths[0] / 120));
          return Math.floor(idx / perRow) * 40;
        },
      });
    }
    (track as any).__setWidth = (w: number) => { widths[0] = w; };
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('moves highest-priority items into stash when over the row budget', () => {
    const handle = wireRibbonOverflow({
      track,
      button,
      maxRows: 2,
      items: [
        { el: items[0]!, priority: 0 },
        { el: items[1]!, priority: 0 },
        { el: items[2]!, priority: 2 },
        { el: items[3]!, priority: 4 },
      ],
    });
    handle.reflow();

    // 200px fits ~1 item/row → 2-row budget keeps 2 in track; priority 4 then 2 overflow.
    expect(track.childElementCount).toBeLessThanOrEqual(2);
    expect(button.hidden).toBe(false);
    expect(items[3]!.parentElement === track).toBe(false);
    handle.destroy();
  });

  it('hides the overflow button when everything fits', () => {
    (track as any).__setWidth(600);
    const handle = wireRibbonOverflow({
      track,
      button,
      maxRows: 2,
      items: items.map((el, i) => ({ el, priority: i === 3 ? 4 : 0 })),
    });
    handle.reflow();
    expect(track.childElementCount).toBe(4);
    expect(button.hidden).toBe(true);
    handle.destroy();
  });

  it('opens a panel with stashed groups and restores them on close', () => {
    const handle = wireRibbonOverflow({
      track,
      button,
      maxRows: 1,
      items: [
        { el: items[0]!, priority: 0 },
        { el: items[1]!, priority: 1 },
        { el: items[2]!, priority: 2 },
        { el: items[3]!, priority: 3 },
      ],
    });
    handle.reflow();
    expect(button.hidden).toBe(false);

    button.click();
    const panel = document.querySelector('.vgext-rb-overflow-panel');
    expect(panel).toBeTruthy();
    expect(panel!.childElementCount).toBeGreaterThan(0);

    // Click away closes and parks nodes back out of the track.
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.querySelector('.vgext-rb-overflow-panel')).toBeNull();

    handle.destroy();
  });
});
