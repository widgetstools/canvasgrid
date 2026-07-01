/**
 * Cycle 7 / Task 3 — FilterPopupHost unit tests.
 *
 * The host owns the open/close orchestration for filter popups (number,
 * date, text, multi-condition, set). It wraps Cycle 5's PopupHost with
 * filter-specific behaviour: exactly one popup is active at a time,
 * opening a second column closes the first one (running its `destroy`
 * teardown), the host tracks the current `openColId()` for dedupe, and
 * `close()` is a no-op when nothing is mounted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FilterPopupHost, type FilterPopupFactory } from '../src/interaction/filters/filterPopupHost';
import { PopupHost } from '../src/interaction/editors/popupHost';

function makeFactory(testId: string): FilterPopupFactory {
  const gui = document.createElement('div');
  gui.setAttribute('data-cg-filter-popup', testId);
  Object.defineProperty(gui, 'offsetWidth', { value: 120, configurable: true });
  Object.defineProperty(gui, 'offsetHeight', { value: 80, configurable: true });
  return {
    buildGui: () => gui,
    destroy: vi.fn(),
  };
}

const ANCHOR = {
  cellBounds: { x: 0, y: 0, w: 100, h: 28 },
  viewportBounds: { width: 800, height: 600 },
};

describe('FilterPopupHost', () => {
  let host: HTMLElement;
  let popupHost: PopupHost;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    popupHost = new PopupHost(host);
  });

  it('open mounts the factory GUI into the host DOM', () => {
    const fph = new FilterPopupHost(host, popupHost);
    const f = makeFactory('one');
    fph.open('colA', ANCHOR, f);
    expect(host.querySelector('[data-cg-filter-popup="one"]')).not.toBeNull();
    expect(fph.isOpen()).toBe(true);
    expect(fph.openColId()).toBe('colA');
  });

  it('close unmounts the GUI and calls factory.destroy', () => {
    const fph = new FilterPopupHost(host, popupHost);
    const f = makeFactory('two');
    fph.open('colA', ANCHOR, f);
    fph.close();
    expect(host.querySelector('[data-cg-filter-popup="two"]')).toBeNull();
    expect(f.destroy).toHaveBeenCalledTimes(1);
    expect(fph.isOpen()).toBe(false);
    expect(fph.openColId()).toBeNull();
  });

  it('opening a second column closes the previous popup first', () => {
    const fph = new FilterPopupHost(host, popupHost);
    const f1 = makeFactory('first');
    const f2 = makeFactory('second');
    fph.open('colA', ANCHOR, f1);
    fph.open('colB', ANCHOR, f2);
    expect(host.querySelector('[data-cg-filter-popup="first"]')).toBeNull();
    expect(host.querySelector('[data-cg-filter-popup="second"]')).not.toBeNull();
    expect(f1.destroy).toHaveBeenCalledTimes(1);
    expect(fph.openColId()).toBe('colB');
  });

  it('close is a no-op when nothing is mounted', () => {
    const fph = new FilterPopupHost(host, popupHost);
    expect(() => fph.close()).not.toThrow();
    expect(fph.isOpen()).toBe(false);
  });

  it('clicking outside the popup closes it', () => {
    const fph = new FilterPopupHost(host, popupHost);
    const f = makeFactory('outside-test');
    fph.open('colA', ANCHOR, f);
    expect(fph.isOpen()).toBe(true);
    // Synthesize a mousedown on document.body (outside the popup).
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(fph.isOpen()).toBe(false);
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the popup does NOT close it', () => {
    const fph = new FilterPopupHost(host, popupHost);
    const f = makeFactory('inside-test');
    fph.open('colA', ANCHOR, f);
    const gui = host.querySelector('[data-cg-filter-popup="inside-test"]') as HTMLElement;
    gui.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(fph.isOpen()).toBe(true);
    expect(f.destroy).not.toHaveBeenCalled();
  });

  it('Escape key closes the open popup', () => {
    const fph = new FilterPopupHost(host, popupHost);
    const f = makeFactory('esc-test');
    fph.open('colA', ANCHOR, f);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fph.isOpen()).toBe(false);
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroy tears down listeners and any active popup', () => {
    const fph = new FilterPopupHost(host, popupHost);
    const f = makeFactory('destroy-test');
    fph.open('colA', ANCHOR, f);
    fph.destroy();
    expect(fph.isOpen()).toBe(false);
    expect(f.destroy).toHaveBeenCalledTimes(1);
    // After destroy, outside-click listener is gone — opening fresh on a
    // destroyed host is a no-op (idempotent).
    fph.open('colB', ANCHOR, makeFactory('after-destroy'));
    expect(fph.isOpen()).toBe(false);
  });
});
