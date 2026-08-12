/**
 * Cycle 7 / Task 9 — VirtualList<T> primitive.
 *
 * Generic windowed-list. Mounts only the rows in the visible viewport
 * (overscan configurable, default 3); off-window rows are unmounted (not
 * just hidden). Pool-keyed by index slot. First consumer is the set
 * filter; column chooser + advanced-filter side panel + tool panels in
 * Cycles 9+ reuse the same primitive.
 */
import { describe, it, expect } from 'vitest';
import { VirtualList } from '../src/interaction/ui/virtualList';

function makeHost(height = 240): HTMLElement {
  const host = document.createElement('div');
  host.style.height = `${height}px`;
  host.style.width = '200px';
  document.body.appendChild(host);
  // happy-dom does not perform layout; force clientHeight so the slice
  // math has a real viewport size to read.
  Object.defineProperty(host, 'clientHeight', { value: height, configurable: true });
  return host;
}

function row(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  return el;
}

function mountedRows(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-vg-vlist-row]'));
}

describe('VirtualList', () => {
  it('renders only the visible + overscan window (1000 items, 24px rows, 240px host)', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 1000 }, (_, i) => `row-${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    const mounted = mountedRows(host);
    // 240 / 24 = 10 visible rows; overscan 3 above (clamped to 0 at top)
    // + 3 below ⇒ 13 rows mounted on initial scroll-top mount.
    expect(mounted.length).toBe(13);
    // Far less than the 1000-item count — the virtualisation contract.
    expect(mounted.length).toBeLessThan(50);
    vlist.destroy();
    host.remove();
  });

  it('sizer height equals items.length * rowHeight (full scroll extent)', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 500 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    const sizer = host.querySelector('[data-vg-vlist-sizer]') as HTMLElement;
    expect(sizer).not.toBeNull();
    expect(sizer.style.height).toBe(`${500 * 24}px`);
    vlist.destroy();
    host.remove();
  });

  it('visibleRange returns { first: 0, last: 12 } at scrollTop 0 (1000-item / 24px / 240px)', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 1000 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    const range = vlist.visibleRange();
    expect(range).toEqual({ first: 0, last: 12 });
    vlist.destroy();
    host.remove();
  });

  it('scrollToIndex(500) brings index 500 into the mounted set', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 1000 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    vlist.scrollToIndex(500);
    const range = vlist.visibleRange();
    expect(range.first).toBeLessThanOrEqual(500);
    expect(range.last).toBeGreaterThanOrEqual(500);
    const mounted = mountedRows(host);
    const indices = mounted.map((el) => Number(el.getAttribute('data-vg-vlist-index')));
    expect(indices).toContain(500);
    vlist.destroy();
    host.remove();
  });

  it('scrolling triggers DOM mount/unmount (rows leave the DOM, not just hide)', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 1000 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    // After initial mount, index 999 is not in the DOM at all.
    expect(
      host.querySelector('[data-vg-vlist-row][data-vg-vlist-index="999"]'),
    ).toBeNull();
    vlist.scrollToIndex(999);
    // After scrolling, index 999 IS in the DOM and index 0 is gone.
    expect(
      host.querySelector('[data-vg-vlist-row][data-vg-vlist-index="999"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-vg-vlist-row][data-vg-vlist-index="0"]'),
    ).toBeNull();
    vlist.destroy();
    host.remove();
  });

  it('pool reuse: scrolling by one row reuses the previously-mounted DOM nodes', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 1000 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    // Capture element identity for index 5 before the scroll.
    const before = host.querySelector(
      '[data-vg-vlist-row][data-vg-vlist-index="5"]',
    ) as HTMLElement | null;
    expect(before).not.toBeNull();
    // Scroll by one row (24px). Index 5 stays in the mounted window — pool
    // must return the same element instance, not a fresh one.
    host.scrollTop = 24;
    host.dispatchEvent(new Event('scroll'));
    const after = host.querySelector(
      '[data-vg-vlist-row][data-vg-vlist-index="5"]',
    ) as HTMLElement | null;
    expect(after).toBe(before);
    vlist.destroy();
    host.remove();
  });

  it('setItems with preserveScroll keeps scrollTop constant', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 1000 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    host.scrollTop = 240;
    host.dispatchEvent(new Event('scroll'));
    const newItems = Array.from({ length: 1000 }, (_, i) => `n${i}`);
    vlist.setItems(newItems, { preserveScroll: true });
    expect(host.scrollTop).toBe(240);
    vlist.destroy();
    host.remove();
  });

  it('setItems without preserveScroll resets scrollTop to 0', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 1000 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    host.scrollTop = 240;
    host.dispatchEvent(new Event('scroll'));
    const newItems = Array.from({ length: 1000 }, (_, i) => `n${i}`);
    vlist.setItems(newItems);
    expect(host.scrollTop).toBe(0);
    vlist.destroy();
    host.remove();
  });

  it('refresh re-invokes renderRow on currently-mounted rows', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 100 }, (_, i) => `r${i}`);
    let calls = 0;
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => {
        calls++;
        return row(item);
      },
    });
    vlist.setItems(items);
    const initial = calls;
    expect(initial).toBeGreaterThan(0);
    vlist.refresh();
    // refresh re-mounts every visible row — at least one extra renderRow
    // call per row in the visible range.
    const range = vlist.visibleRange();
    const visibleCount = range.last - range.first + 1;
    expect(calls - initial).toBeGreaterThanOrEqual(visibleCount);
    vlist.destroy();
    host.remove();
  });

  it('destroy empties the host', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 100 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    expect(host.childElementCount).toBeGreaterThan(0);
    vlist.destroy();
    expect(host.childElementCount).toBe(0);
    host.remove();
  });

  it('setItems shrinks scrollTop when previous position exceeds the new content', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 1000 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item) => row(item),
    });
    vlist.setItems(items);
    host.scrollTop = 23000;
    host.dispatchEvent(new Event('scroll'));
    // Switch to a 5-item list while preserveScroll is on; the sizer can no
    // longer support the old scrollTop, so it clamps to the new max.
    const shortList = Array.from({ length: 5 }, (_, i) => `s${i}`);
    vlist.setItems(shortList, { preserveScroll: true });
    expect(host.scrollTop).toBeLessThanOrEqual(5 * 24);
    vlist.destroy();
    host.remove();
  });

  it('renderRow returning null mounts an empty slot (not the renderer crashes)', () => {
    const host = makeHost(240);
    const items = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const vlist = new VirtualList<string>(host, {
      rowHeight: 24,
      renderRow: (item, index) => (index === 0 ? null : row(item)),
    });
    vlist.setItems(items);
    const indices = mountedRows(host).map(
      (el) => Number(el.getAttribute('data-vg-vlist-index')),
    );
    // Index 0 contributes no row; the rest still mount.
    expect(indices).not.toContain(0);
    expect(indices.length).toBeGreaterThan(0);
    vlist.destroy();
    host.remove();
  });
});
