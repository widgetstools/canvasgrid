// FloatingPanelHost.fitContentHeight — content-fit height unit test.
//
// The Style editor is fixed-height content; `fitContentHeight()` shrinks the
// frame to hug it, dropping any empty lower band left by a restored/oversized
// rect. It measures the body's content children (NOT `body.scrollHeight`,
// which equals the too-tall client height when the frame exceeds its content),
// adds the titlebar + frame chrome, and clamps to bounds/min. jsdom can't lay
// out, so element heights are mocked via defineProperty (same idiom as
// popupHost.test.ts).

import { describe, it, expect } from 'vitest';
import { FloatingPanelHost } from '../src/interaction/floatingPanel/host';

function setH(el: Element, offsetHeight: number, clientHeight?: number): void {
  Object.defineProperty(el, 'offsetHeight', { value: offsetHeight, configurable: true });
  if (clientHeight !== undefined) {
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  }
}

function makeRoot(): HTMLElement {
  const root = document.createElement('div');
  Object.defineProperty(root, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(root, 'clientHeight', { value: 600, configurable: true });
  document.body.appendChild(root);
  return root;
}

describe('FloatingPanelHost.fitContentHeight', () => {
  it('shrinks the frame height to titlebar + content + chrome', () => {
    const root = makeRoot();
    const host = new FloatingPanelHost(root);
    const body = host.open({ title: 'Style', rect: { x: 10, y: 10, w: 300, h: 520 }, onClose: () => {} });
    expect(host.getRect()!.h).toBe(520); // opened tall (restored/oversized rect)

    // Fixed-height content child + measured titlebar / frame chrome.
    const content = document.createElement('div');
    setH(content, 240);
    body.appendChild(content);
    setH(root.querySelector('.vg-floating-panel-titlebar')!, 40);
    const frame = root.querySelector('.vg-floating-panel')!;
    setH(frame, 520, 518); // 2px of top+bottom border chrome

    host.fitContentHeight();

    // 40 (titlebar) + 240 (content) + 2 (chrome) = 282, well within bounds/min.
    expect(host.getRect()!.h).toBe(282);
    // Width + position are untouched.
    expect(host.getRect()!.w).toBe(300);
    expect(host.getRect()!.x).toBe(10);
    expect(host.getRect()!.y).toBe(10);

    host.destroy();
  });

  it('floors the fitted height at the minimum (160)', () => {
    const root = makeRoot();
    const host = new FloatingPanelHost(root);
    const body = host.open({ title: 'Style', rect: { x: 0, y: 0, w: 300, h: 400 }, onClose: () => {} });
    const content = document.createElement('div');
    setH(content, 20); // tiny content
    body.appendChild(content);
    setH(root.querySelector('.vg-floating-panel-titlebar')!, 40);
    const frame = root.querySelector('.vg-floating-panel')!;
    setH(frame, 400, 398);

    host.fitContentHeight();

    // 40 + 20 + 2 = 62 -> floored to MIN_HEIGHT 160.
    expect(host.getRect()!.h).toBe(160);
    host.destroy();
  });

  it('is a no-op when content has not laid out (measures 0)', () => {
    const root = makeRoot();
    const host = new FloatingPanelHost(root);
    host.open({ title: 'Style', rect: { x: 0, y: 0, w: 300, h: 300 }, onClose: () => {} });
    // No content appended; happy-dom offsetHeight is 0.
    host.fitContentHeight();
    expect(host.getRect()!.h).toBe(300); // unchanged
    host.destroy();
  });

  it('does nothing when the panel is closed', () => {
    const root = makeRoot();
    const host = new FloatingPanelHost(root);
    expect(() => host.fitContentHeight()).not.toThrow();
    expect(host.getRect()).toBeNull();
  });
});
