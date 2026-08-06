import { describe, it, expect, vi } from 'vitest';
import {
  HistoryStack,
  captureFormatSnapshot,
  createFormatHistory,
  restoreFormatSnapshot,
  type FormatHistoryGrid,
  type FormatHistorySnapshot,
} from '../src/toolbar/formatHistory';

class FakeGrid implements FormatHistoryGrid {
  templates: unknown[] = [];
  overrides: unknown[] = [];
  setState = vi.fn((snap: { modules: Record<string, { data: unknown }> }) => {
    this.templates = structuredClone(snap.modules.templates?.data as unknown[]) ?? [];
    this.overrides = structuredClone(snap.modules.columnOverrides?.data as unknown[]) ?? [];
  });
  getTemplates() { return this.templates; }
  getState() {
    return {
      modules: {
        columnOverrides: { data: this.overrides },
      },
    };
  }
}

describe('HistoryStack', () => {
  it('push / undo / redo round-trip and clears future on new push', () => {
    const s = new HistoryStack<number>(3);
    s.push(1);
    s.push(2);
    expect(s.undo(3)).toBe(2);
    expect(s.undo(2)).toBe(1);
    expect(s.canUndo()).toBe(false);
    expect(s.redo(1)).toBe(2);
    s.push(2); // before a new mutation — clears redo of 3
    expect(s.canRedo()).toBe(false);
    expect(s.undo(9)).toBe(2);
  });
});

describe('capture / restore', () => {
  it('round-trips templates + overrides through setState', () => {
    const g = new FakeGrid();
    g.templates = [{ id: 't1', name: 'A' }];
    g.overrides = [{ colId: 'px', templateIds: ['t1'] }];
    const snap = captureFormatSnapshot(g);
    g.templates = [];
    g.overrides = [];
    restoreFormatSnapshot(g, snap);
    expect(g.setState).toHaveBeenCalled();
    expect(g.templates).toEqual([{ id: 't1', name: 'A' }]);
    expect(g.overrides).toEqual([{ colId: 'px', templateIds: ['t1'] }]);
  });
});

describe('createFormatHistory', () => {
  it('undo restores the pre-mutation snapshot', () => {
    const g = new FakeGrid();
    const h = createFormatHistory(g);
    expect(h.canUndo()).toBe(false);

    h.push();
    g.templates = [{ id: 'own', name: 'styled' }];
    g.overrides = [{ colId: 'px', templateIds: ['own'] }];

    expect(h.canUndo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(g.templates).toEqual([]);
    expect(g.overrides).toEqual([]);
    expect(h.canRedo()).toBe(true);

    expect(h.redo()).toBe(true);
    expect(g.templates).toEqual([{ id: 'own', name: 'styled' }]);
  });

  it('reset clears both stacks (e.g. after layout save)', () => {
    const g = new FakeGrid();
    const h = createFormatHistory(g);
    const notified = vi.fn();
    h.subscribe(notified);
    h.push();
    g.templates = [1];
    h.reset();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(notified).toHaveBeenCalled();
  });

  it('subscribe notifies on push/undo', () => {
    const g = new FakeGrid();
    const h = createFormatHistory(g);
    const fn = vi.fn();
    const off = h.subscribe(fn);
    h.push();
    expect(fn).toHaveBeenCalledTimes(1);
    g.templates = ['x'];
    h.undo();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    h.push();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('FormatHistorySnapshot typing smoke', () => {
  it('accepts empty snapshots', () => {
    const snap: FormatHistorySnapshot = { templates: [], overrides: [] };
    expect(snap.templates).toHaveLength(0);
  });
});
