// Cycle 21c / Task 14 — tooltip provider hook.
//
// Registry roundtrip + debounce semantics on the TooltipProvider
// feature (drive onCellHover / onCellLeave directly — no DOM events).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerTooltipProvider,
  unregisterTooltipProvider,
  getTooltipProvider,
  TooltipProvider,
  _resetTooltipProviders_forTests,
} from '../src/interaction/features/tooltipProvider';

const rect = { x: 0, y: 0, w: 10, h: 10 };

describe('Tooltip provider registry', () => {
  beforeEach(() => _resetTooltipProviders_forTests());

  it('register + get roundtrip', () => {
    const fn = () => ({ plain: 'hello' });
    registerTooltipProvider('x', fn);
    expect(getTooltipProvider('x')).toBe(fn);
  });

  it('unregister removes', () => {
    registerTooltipProvider('x', () => ({ plain: 'hello' }));
    unregisterTooltipProvider('x');
    expect(getTooltipProvider('x')).toBeUndefined();
  });

  it('re-register overwrites', () => {
    const first = () => ({ plain: 'first' });
    const second = () => ({ plain: 'second' });
    registerTooltipProvider('x', first);
    registerTooltipProvider('x', second);
    expect(getTooltipProvider('x')).toBe(second);
  });

  it('unregister of unknown colId is a no-op', () => {
    expect(() => unregisterTooltipProvider('nope')).not.toThrow();
  });
});

describe('TooltipProvider feature — debounce', () => {
  beforeEach(() => {
    _resetTooltipProviders_forTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call provider until 500ms elapses', () => {
    const fn = vi.fn(() => ({ plain: 'x' }));
    registerTooltipProvider('c', fn);
    const feature = new TooltipProvider();
    feature.onCellHover({ colId: 'c', row: {}, rect });
    vi.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets timer on subsequent hover before debounce elapses', () => {
    const fn = vi.fn(() => ({ plain: 'x' }));
    registerTooltipProvider('c', fn);
    const feature = new TooltipProvider();
    feature.onCellHover({ colId: 'c', row: {}, rect });
    vi.advanceTimersByTime(400);
    feature.onCellHover({ colId: 'c', row: {}, rect });
    vi.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('onCellLeave cancels pending debounce', () => {
    const fn = vi.fn(() => ({ plain: 'x' }));
    registerTooltipProvider('c', fn);
    const feature = new TooltipProvider();
    feature.onCellHover({ colId: 'c', row: {}, rect });
    feature.onCellLeave();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('provider receives row + colId + rect', () => {
    const fn = vi.fn(() => null);
    registerTooltipProvider('c', fn);
    const feature = new TooltipProvider();
    const row = { symbol: 'AAPL' };
    feature.onCellHover({ colId: 'c', row, rect: { x: 5, y: 7, w: 100, h: 24 } });
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledWith({
      row,
      colId: 'c',
      rect: { x: 5, y: 7, w: 100, h: 24 },
    });
  });

  it('null payload shows no tooltip', () => {
    registerTooltipProvider('c', () => null);
    const feature = new TooltipProvider();
    const show = vi.spyOn(feature, 'showTooltip');
    feature.onCellHover({ colId: 'c', row: {}, rect });
    vi.advanceTimersByTime(500);
    expect(show).not.toHaveBeenCalled();
  });

  it('shows tooltip with payload after debounce', () => {
    registerTooltipProvider('c', () => ({ plain: 'tip!' }));
    const feature = new TooltipProvider();
    const show = vi.spyOn(feature, 'showTooltip').mockImplementation(() => {});
    feature.onCellHover({ colId: 'c', row: {}, rect });
    vi.advanceTimersByTime(500);
    expect(show).toHaveBeenCalledWith({ plain: 'tip!' }, rect);
  });
});

describe('TooltipProvider feature — DOM tooltip', () => {
  beforeEach(() => {
    _resetTooltipProviders_forTests();
    document.getElementById('cgrid-tooltip-provider')?.remove();
  });

  it('plain payload renders via textContent (no HTML injection)', () => {
    const feature = new TooltipProvider();
    feature.showTooltip({ plain: '<b>not html</b>' }, rect);
    const el = document.getElementById('cgrid-tooltip-provider')!;
    expect(el.textContent).toBe('<b>not html</b>');
    expect(el.querySelector('b')).toBeNull();
  });

  it('html payload renders markup', () => {
    const feature = new TooltipProvider();
    feature.showTooltip({ html: '<b>bold</b>' }, rect);
    const el = document.getElementById('cgrid-tooltip-provider')!;
    expect(el.querySelector('b')).not.toBeNull();
  });

  it('element is pooled across shows; hide sets display:none', () => {
    const feature = new TooltipProvider();
    feature.showTooltip({ plain: 'a' }, rect);
    const first = document.getElementById('cgrid-tooltip-provider');
    feature.showTooltip({ plain: 'b' }, rect);
    expect(document.getElementById('cgrid-tooltip-provider')).toBe(first);
    feature.hideTooltip();
    expect(first!.style.display).toBe('none');
  });

  it('positions at rect.x + rect.w / rect.y', () => {
    const feature = new TooltipProvider();
    feature.showTooltip({ plain: 'a' }, { x: 100, y: 40, w: 12, h: 0 });
    const el = document.getElementById('cgrid-tooltip-provider')!;
    expect(el.style.left).toBe('112px');
    expect(el.style.top).toBe('40px');
  });
});
