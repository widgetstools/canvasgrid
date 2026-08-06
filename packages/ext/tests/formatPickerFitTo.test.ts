import { describe, it, expect, afterEach } from 'vitest';
import { formatPickerMenu } from '../src/toolbar/formatPicker';
import { FakeFormatHost } from './formatPickerHarness';

describe('formatPickerMenu fitTo container', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    for (const d of disposers.splice(0)) d();
    document.body.replaceChildren();
  });

  it('clamps width into the fitTo container and enables compact layout when narrow', () => {
    const pane = document.createElement('div');
    pane.className = 'ckp-pane';
    Object.defineProperty(pane, 'getBoundingClientRect', {
      value: () => ({
        left: 100, top: 40, right: 420, bottom: 700,
        width: 320, height: 660, x: 100, y: 40, toJSON: () => ({}),
      }),
    });
    const anchor = document.createElement('button');
    pane.appendChild(anchor);
    document.body.appendChild(pane);

    const host = new FakeFormatHost();
    const m = formatPickerMenu(anchor, host, { fitTo: () => pane });
    disposers.push(() => m.destroy());
    m.toggle();

    const panel = document.querySelector<HTMLElement>('.cgext-menu.cgext-fmt')!;
    expect(panel).toBeTruthy();
    expect(panel.classList.contains('is-compact')).toBe(true);
    // 320px pane − 16px margins = 304px max
    expect(parseFloat(panel.style.width)).toBeLessThanOrEqual(304);
    const left = parseFloat(panel.style.getPropertyValue('--cgext-menu-left'));
    expect(left).toBeGreaterThanOrEqual(108); // pane.left + 8
    expect(left + parseFloat(panel.style.width)).toBeLessThanOrEqual(412); // pane.right − 8
  });

  it('keeps the ribbon-sized panel when fitTo is omitted', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    Object.defineProperty(anchor, 'getBoundingClientRect', {
      value: () => ({
        left: 800, top: 40, right: 900, bottom: 68,
        width: 100, height: 28, x: 800, y: 40, toJSON: () => ({}),
      }),
    });
    const host = new FakeFormatHost();
    const m = formatPickerMenu(anchor, host);
    disposers.push(() => m.destroy());
    m.toggle();
    const panel = document.querySelector<HTMLElement>('.cgext-menu.cgext-fmt')!;
    expect(panel.classList.contains('is-compact')).toBe(false);
    expect(parseFloat(panel.style.width)).toBe(456);
  });
});
