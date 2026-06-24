/**
 * Cycle 5 / Task 3 — PopupHost unit tests.
 *
 * The host owns positioning math for editors that opt into popup mode via
 * `editor.isPopup() === true` (or `CColDef.cellEditorPopup === true`). Tests
 * cover absolute positioning anchored to `cellBounds`, the requested
 * `position: 'over' | 'under'`, the collision-flip rule, AND the
 * stay-inside-the-container clamping on both axes.
 */
import { describe, it, expect } from 'vitest';
import { PopupHost } from '../src/interaction/editors/popupHost';

function makeGui(width: number, height: number): HTMLDivElement {
  const gui = document.createElement('div');
  Object.defineProperty(gui, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(gui, 'offsetHeight', { value: height, configurable: true });
  return gui;
}

describe('PopupHost', () => {
  it('mounts the gui absolutely positioned at the cell bounds (over, fits)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(120, 40);
    popup.mount(gui, {
      cellBounds: { x: 50, y: 100, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(host.contains(gui)).toBe(true);
    expect(gui.style.position).toBe('absolute');
    expect(gui.style.left).toBe('50px');
    expect(gui.style.top).toBe('100px');
  });

  it('position=under offsets the popup top to sit below the cell', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(120, 40);
    popup.mount(gui, {
      cellBounds: { x: 0, y: 100, w: 120, h: 22 },
      position: 'under',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(gui.style.top).toBe('122px');
  });

  it('flips position=under → over when under would clip the bottom and over fits', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    // Popup 200px tall, cell at y=580 (h=22). under top=602; 602+200=802 > 600 → flip.
    // Over flip = cell.y - popupH = 580 - 200 = 380. 380 ≥ 0 → use it.
    const gui = makeGui(120, 200);
    popup.mount(gui, {
      cellBounds: { x: 0, y: 580, w: 120, h: 22 },
      position: 'under',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(gui.style.top).toBe('380px');
  });

  it('keeps position=over when over fits even with cell near the top', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(120, 200);
    popup.mount(gui, {
      // y=10, popupH=200 → 10+200=210 ≤ 600 → over fits, no flip.
      cellBounds: { x: 0, y: 10, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(gui.style.top).toBe('10px');
  });

  it('over → under when over overflows bottom AND under fits', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(120, 100);
    // Cell at y=520, h=22. over top=520; 520+100=620>600 → overflow.
    // under top=542; 542+100=642>600 → still overflow.
    // Fall through to clamp: viewportH - popupH = 600 - 100 = 500.
    popup.mount(gui, {
      cellBounds: { x: 0, y: 520, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    // With cell at y=520, over=520 overflows; under=542 overflows too;
    // clamp wins.
    expect(gui.style.top).toBe('500px');
  });

  it('over-mode: under fits even when over does not → uses under top', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(120, 60);
    // Cell at y=560, h=22. over top=560; 560+60=620>600 → overflow.
    // under top=582; 582+60=642>600 → still overflow.
    // → clamp to 600 - 60 = 540.
    popup.mount(gui, {
      cellBounds: { x: 0, y: 560, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(gui.style.top).toBe('540px');
  });

  it('horizontal clamp: shifts left so right edge fits inside the container', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(320, 60);
    // Cell near the right edge of an 800-wide container: x=600, popup w=320.
    // 600 + 320 = 920 > 800 → shift to 800 - 320 = 480.
    popup.mount(gui, {
      cellBounds: { x: 600, y: 50, w: 100, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(gui.style.left).toBe('480px');
  });

  it('horizontal clamp: never goes below 0 when popup is wider than the container', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(1000, 60);
    popup.mount(gui, {
      cellBounds: { x: 100, y: 0, w: 100, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(gui.style.left).toBe('0px');
  });

  it('horizontal: no shift needed when popup already fits at the cell', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(120, 40);
    popup.mount(gui, {
      cellBounds: { x: 100, y: 50, w: 80, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(gui.style.left).toBe('100px');
  });

  it('unmount removes the gui from the host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = makeGui(120, 40);
    popup.mount(gui, {
      cellBounds: { x: 0, y: 0, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(host.contains(gui)).toBe(true);
    popup.unmount();
    expect(host.contains(gui)).toBe(false);
  });

  it('mount a second time after unmount works (idempotent host)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui1 = makeGui(120, 40);
    popup.mount(gui1, {
      cellBounds: { x: 0, y: 0, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    popup.unmount();
    const gui2 = makeGui(80, 40);
    popup.mount(gui2, {
      cellBounds: { x: 10, y: 20, w: 80, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(host.contains(gui1)).toBe(false);
    expect(host.contains(gui2)).toBe(true);
    expect(gui2.style.left).toBe('10px');
    expect(gui2.style.top).toBe('20px');
  });
});
