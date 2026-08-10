import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wireRibbonOverflow } from '../src/toolbar/ribbonOverflow';

describe('wireRibbonOverflow', () => {
  let track: HTMLElement;
  let button: HTMLButtonElement;
  let items: HTMLElement[];

  beforeEach(() => {
    track = document.createElement('div');
    track.style.display = 'flex';
    track.style.flexWrap = 'nowrap';
    track.style.width = '200px';
    track.style.overflow = 'hidden';
    document.body.appendChild(track);

    items = [1, 2, 3, 4].map((n) => {
      const el = document.createElement('div');
      el.dataset.id = String(n);
      el.textContent = `G${n}`;
      el.style.width = '120px';
      el.style.height = n === 1 ? '48px' : '28px'; // different heights (center-align trap)
      el.style.flex = '0 0 auto';
      track.appendChild(el);
      return el;
    });

    button = document.createElement('button');
    button.type = 'button';
    document.body.appendChild(button);

    let widths = [200];
    Object.defineProperty(track, 'clientWidth', { configurable: true, get: () => widths[0] });
    Object.defineProperty(track, 'scrollWidth', {
      configurable: true,
      get: () => track.childElementCount * 120,
    });
    Object.defineProperty(track, 'scrollHeight', {
      configurable: true,
      get: () => 48,
    });
    // Simulate align-items:center — shorter siblings have a larger offsetTop
    // on the SAME row. Old logic treated this as wrapping and spilled early.
    for (const el of items) {
      const h = el.style.height === '48px' ? 48 : 28;
      Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => h });
      Object.defineProperty(el, 'offsetTop', {
        configurable: true,
        get: () => (h === 48 ? 0 : 10),
      });
    }
    (track as any).__setWidth = (w: number) => { widths[0] = w; };
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('does not spill when scrollWidth fits even if offsetTops differ (center-align)', () => {
    (track as any).__setWidth(500); // 4×120 = 480 ≤ 500
    const handle = wireRibbonOverflow({
      track,
      button,
      maxRows: 1,
      items: [
        { el: items[0]!, priority: 0 },
        { el: items[1]!, priority: 2 },
        { el: items[2]!, priority: 3 },
        { el: items[3]!, priority: 4 },
      ],
    });
    handle.reflow();
    expect(track.childElementCount).toBe(4);
    expect(button.hidden).toBe(true);
    handle.destroy();
  });

  it('spills highest-priority items when scrollWidth exceeds clientWidth', () => {
    (track as any).__setWidth(200);
    const handle = wireRibbonOverflow({
      track,
      button,
      maxRows: 1,
      items: [
        { el: items[0]!, priority: 0 },
        { el: items[1]!, priority: 2 },
        { el: items[2]!, priority: 3 },
        { el: items[3]!, priority: 4 },
      ],
    });
    handle.reflow();
    expect(button.hidden).toBe(false);
    // priority 4 then 3 then 2 until one item (priority 0) fits in 200px
    expect(items[0]!.parentElement).toBe(track);
    expect(items[3]!.parentElement === track).toBe(false);
    handle.destroy();
  });

  it('does not spill when the track is not laid out yet (width 0)', () => {
    (track as any).__setWidth(0);
    const handle = wireRibbonOverflow({
      track,
      button,
      maxRows: 1,
      items: items.map((el, i) => ({ el, priority: i + 1 })),
    });
    handle.reflow();
    expect(track.childElementCount).toBe(4);
    expect(button.hidden).toBe(true);
    handle.destroy();
  });

  it('opens overflow panel with items in toolbar order (Clear last)', () => {
    (track as any).__setWidth(200);
    const handle = wireRibbonOverflow({
      track,
      button,
      maxRows: 1,
      items: [
        { el: items[0]!, priority: 0 },
        { el: items[1]!, priority: 2 }, // Borders-like
        { el: items[2]!, priority: 6 }, // Templates-like (spills first)
        { el: items[3]!, priority: 5 }, // Clear-like (last on strip / in menu)
      ],
    });
    handle.reflow();
    button.click();
    const panel = document.querySelector('.vgext-rb-overflow-panel');
    expect(panel).toBeTruthy();
    const ids = Array.from(panel!.children).map((c) => (c as HTMLElement).dataset.id);
    // Toolbar order among spilled — Clear (G4) is last
    expect(ids[ids.length - 1]).toBe('4');
    handle.destroy();
  });
});
