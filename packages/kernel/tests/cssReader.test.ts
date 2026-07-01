import { describe, it, expect, beforeEach } from 'vitest';
import { CssReader } from '../src/theming/cssReader';

describe('CssReader', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = `
      --cg-font-family: Inter;
      --cg-font-size: 14px;
      --cg-row-height: 32px;
      --cg-header-height: 36px;
      --cg-fg-color: #111;
      --cg-bg-color: #fff;
      --cg-row-alt-bg: #fafafa;
      --cg-header-bg: #eee;
      --cg-header-fg: #111;
      --cg-border-color: #ccc;
      --cg-grid-line-color: #eee;
      --cg-row-hover-bg: #f5f5f5;
      --cg-row-selected-bg: rgba(0,0,0,0.1);
      --cg-focus-ring-color: #08f;
      --cg-focus-ring-width: 2px;
      --cg-flash-from-color: yellow;
      --cg-flash-to-color: transparent;
      --cg-resizer-hot-zone: 4px;
    `;
    document.body.appendChild(container);
  });

  it('reads tokens into a ResolvedTheme', () => {
    const r = new CssReader(container).read();
    expect(r.fg).toBe('#111');
    expect(r.bg).toBe('#fff');
    expect(r.rowHeight).toBe(32);
    expect(r.headerHeight).toBe(36);
    expect(r.font).toContain('14px');
    expect(r.font).toContain('Inter');
    expect(r.focusRingWidth).toBe(2);
    expect(r.resizerHotZone).toBe(4);
  });
});
