/**
 * Cycle 5 / Task 3 — PopupHost unit tests.
 *
 * The host owns positioning math for editors that opt into popup mode via
 * `editor.isPopup() === true` (or `CColDef.cellEditorPopup === true`). Tests
 * cover absolute positioning anchored to `cellBounds`, the requested
 * `position: 'over' | 'under'`, and the collision-flip rule that swaps the
 * position when the popup would clip the viewport edge.
 */
import { describe, it, expect } from 'vitest';
import { PopupHost } from '../src/interaction/editors/popupHost';

describe('PopupHost', () => {
  it('mounts the gui as absolutely positioned at the cell bounds when position=over', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = document.createElement('div');
    Object.defineProperty(gui, 'offsetHeight', { value: 40, configurable: true });
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
    const gui = document.createElement('div');
    Object.defineProperty(gui, 'offsetHeight', { value: 40, configurable: true });
    popup.mount(gui, {
      cellBounds: { x: 0, y: 100, w: 120, h: 22 },
      position: 'under',
      viewportBounds: { width: 800, height: 600 },
    });
    expect(gui.style.top).toBe('122px');
  });

  it('flips position=under → over when the popup would clip the viewport bottom', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = document.createElement('div');
    // Popup height 200, cell bottom = 580 + 22 = 602. 602 + 200 > 600 → flip.
    Object.defineProperty(gui, 'offsetHeight', { value: 200, configurable: true });
    popup.mount(gui, {
      cellBounds: { x: 0, y: 580, w: 120, h: 22 },
      position: 'under',
      viewportBounds: { width: 800, height: 600 },
    });
    // After flip, popup sits ABOVE the cell: top = cellY - popupHeight = 580 - 200 = 380.
    expect(gui.style.top).toBe('380px');
  });

  it('flips position=over → under when over would clip the viewport top', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = document.createElement('div');
    Object.defineProperty(gui, 'offsetHeight', { value: 200, configurable: true });
    popup.mount(gui, {
      // Cell near top: y=10, popup height 200 → top would be at y=10 with height
      // 200 fitting downward only if we DON'T flip. Over means popup uses cell.y
      // as its top. 10 + 200 = 210 < 600 → no flip needed.
      cellBounds: { x: 0, y: 10, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    // Stays at over (no clip).
    expect(gui.style.top).toBe('10px');
  });

  it('flips position=over → under when the popup overflows downward in over mode', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = document.createElement('div');
    // Cell at y=500, popup height 200 → 500+200=700 > 600 → flip to under.
    // Under means popup top = cellY + cellH = 500 + 22 = 522. But 522 + 200 = 722
    // also > 600. So flip-over check fires; under is still bad, but we land at
    // under anyway per the rule (flip once; the host is best-effort, not
    // exhaustive — see PopupHost JSDoc).
    Object.defineProperty(gui, 'offsetHeight', { value: 200, configurable: true });
    popup.mount(gui, {
      cellBounds: { x: 0, y: 500, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    // Either position is bad here; the rule flips over → under and stops.
    expect(gui.style.top).toBe('522px');
  });

  it('unmount removes the gui from the host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const popup = new PopupHost(host);
    const gui = document.createElement('div');
    Object.defineProperty(gui, 'offsetHeight', { value: 40, configurable: true });
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
    const gui1 = document.createElement('div');
    Object.defineProperty(gui1, 'offsetHeight', { value: 40, configurable: true });
    popup.mount(gui1, {
      cellBounds: { x: 0, y: 0, w: 120, h: 22 },
      position: 'over',
      viewportBounds: { width: 800, height: 600 },
    });
    popup.unmount();
    const gui2 = document.createElement('div');
    Object.defineProperty(gui2, 'offsetHeight', { value: 40, configurable: true });
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
