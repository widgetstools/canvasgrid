// Header parity — headerCell renders content slots + decorators
// (Cycle 27 machinery, previously data-cell-only).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { headerCell } from '../src/renderer/cellRenderers/registry';
import { registerIcon } from '../src/renderer/icons';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

function fakeGc(): any {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    measureText: () => ({ width: 40 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(t, k) { return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx;
}

function headerConfig(overrides: Record<string, unknown> = {}): any {
  return {
    value: 'Price', valueFormatted: 'Price',
    bounds: { x: 0, y: 0, w: 120, h: 32 },
    fg: '#111', bg: '#eee', font: '12px Inter', halign: 'left',
    borderColor: '#ccc', prefillColor: '#eee',
    isFocused: false, isSelected: false, isHovered: false, isHeader: true,
    ...overrides,
  };
}

describe('headerCell content slot', () => {
  it('renders content text INSTEAD of the caption', () => {
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({ content: { kind: 'text', value: 'OVERRIDE' } }));
    const texts = gc.fillText.mock.calls.map((c: unknown[]) => c[0]);
    expect(texts).toContain('OVERRIDE');
    expect(texts).not.toContain('Price');
  });

  it('renders an emoji content slot', () => {
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({ content: { kind: 'emoji', value: '📈' } }));
    const texts = gc.fillText.mock.calls.map((c: unknown[]) => c[0]);
    expect(texts).toContain('📈');
    expect(texts).not.toContain('Price');
  });

  it('header checkbox wins over content (early return)', () => {
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({
      headerCheckboxState: 'none',
      content: { kind: 'text', value: 'OVERRIDE' },
    }));
    const texts = gc.fillText.mock.calls.map((c: unknown[]) => c[0]);
    expect(texts).not.toContain('OVERRIDE');
  });
});

describe('headerCell decorators', () => {
  it('paints an emoji decorator at each of the 6 positions', () => {
    for (const position of ['tl', 'tr', 'bl', 'br', 'ml', 'mr'] as const) {
      const gc = fakeGc();
      headerCell.paint(gc, headerConfig({
        decorators: [{ position, kind: 'emoji', value: '⚠️' }],
      }));
      const texts = gc.fillText.mock.calls.map((c: unknown[]) => c[0]);
      expect(texts, position).toContain('⚠️');
      expect(texts, position).toContain('Price'); // caption still paints — overlay, not replacement
    }
  });

  it('paints a dot decorator via arc+fill', () => {
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({
      decorators: [{ position: 'tr', kind: 'dot', color: '#f00' }],
    }));
    expect(gc.arc).toHaveBeenCalled();
    expect(gc.fill).toHaveBeenCalled();
  });

  it('paints a registered-icon decorator AND the sort chevron (both draw; no auto-avoid)', () => {
    registerIcon('test-star', 'M12 2l3 7h7l-5 5 2 7-7-4-7 4 2-7-5-5h7z');
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({
      sortDirection: 'asc',
      decorators: [{ position: 'mr', kind: 'icon', icon: 'test-star', color: '#0af' }],
    }));
    // chevron stroke + decorator icon stroke both happened
    expect(gc.stroke.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
