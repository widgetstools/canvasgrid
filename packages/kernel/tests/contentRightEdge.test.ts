import { describe, it, expect } from 'vitest';
import { contentRightEdge, type ViewportState } from '../src/core/viewport';

function vs(partial: Partial<ViewportState> & Pick<ViewportState, 'visibleColumns' | 'bodyRight'>): ViewportState {
  return {
    visibleRows: [],
    firstRow: 0,
    lastRow: -1,
    scrollLeft: 0,
    scrollTop: 0,
    bodyLeft: 0,
    bodyTop: 0,
    bodyBottom: 100,
    bodyWidth: partial.bodyRight,
    bodyHeight: 100,
    contentWidth: 0,
    contentHeight: 0,
    maxScrollLeft: 0,
    maxScrollTop: 0,
    ...partial,
  };
}

describe('contentRightEdge', () => {
  it('returns the rightmost column edge when columns are narrower than the viewport', () => {
    const state = vs({
      bodyRight: 800,
      visibleColumns: [
        { colId: 'a', index: 0, left: 0, right: 120, width: 120 },
        { colId: 'b', index: 1, left: 120, right: 300, width: 180 },
      ],
    });
    expect(contentRightEdge(state)).toBe(300);
    expect(contentRightEdge(state)).toBeLessThan(state.bodyRight);
  });

  it('falls back to bodyRight when no columns are visible', () => {
    const state = vs({ bodyRight: 640, visibleColumns: [] });
    expect(contentRightEdge(state)).toBe(640);
  });
});
