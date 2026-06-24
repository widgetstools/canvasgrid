// Cycle 5 / Task 4 — EditTrigger feature.
//
// Covers the mouse + keyboard surface that decides when an edit starts:
// - singleClickEdit (grid + per-column override; column wins)
// - suppressClickEdit (blocks both single + double click)
// - suppressKeyboardEvent (early-exit for the focused column)
// - dblclick → openEditor (default behavior)
// - editable predicate (callback receives `{ data, colId, rowIndex, value }`)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditTrigger } from '../src/interaction/features/editTrigger';
import type { CGridLike, CGridEventCtx, EditingFlags, SuppressKeyboardEventFn } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';

interface FakeGridOverrides {
  flags?: Partial<EditingFlags>;
  isCellEditable?: (rowIndex: number, colId: string) => boolean;
  singleClickEditPerCol?: Map<string, boolean | undefined>;
  suppressKeyboardEventPerCol?: Map<string, SuppressKeyboardEventFn | undefined>;
  isEditing?: () => boolean;
  rowDataAt?: (rowIndex: number) => unknown;
}

function fakeGrid(o: FakeGridOverrides = {}): {
  grid: CGridLike;
  openEditor: ReturnType<typeof vi.fn>;
  stopEditing: ReturnType<typeof vi.fn>;
} {
  const openEditor = vi.fn();
  const stopEditing = vi.fn();
  const flags: EditingFlags = {
    singleClickEdit: false,
    suppressClickEdit: false,
    enterNavigatesVertically: false,
    enterNavigatesVerticallyAfterEdit: false,
    suppressStartEditOnTab: false,
    enableCellEditingOnBackspace: false,
    ...o.flags,
  };
  const grid = {
    canvas: { canvas: document.createElement('canvas') },
    selection: { state: { focusedRowIndex: 0, focusedColId: 'a' } },
    hitTester: {},
    visibleRowIndices: () => [0],
    allColIds: () => ['a', 'b'],
    totalRowCount: () => 1,
    resizeColumn: () => {},
    cycleSort: () => {},
    toggleColumnGroup: () => {},
    scrollBy: () => {},
    emitCellClicked: () => {},
    emitCellDoubleClicked: () => {},
    getEditingFlags: () => flags,
    isCellEditable: o.isCellEditable ?? (() => true),
    isColSingleClickEdit: (colId: string) => o.singleClickEditPerCol?.get(colId),
    getColSuppressKeyboardEvent: (colId: string) => o.suppressKeyboardEventPerCol?.get(colId),
    getRowDataAt: o.rowDataAt ?? (() => ({})),
    isEditing: o.isEditing ?? (() => false),
    openEditor,
    stopEditing,
    nextEditableCell: () => null,
  } as unknown as CGridLike;
  return { grid, openEditor, stopEditing };
}

function cellHit(rowIndex: number, colId: string): Hit {
  return { kind: 'cell', rowIndex, colId } as Hit;
}

function clickCtx(grid: CGridLike, hit: Hit): CGridEventCtx {
  return { grid, hit, point: { x: 0, y: 0 }, raw: new MouseEvent('click') };
}

function dblClickCtx(grid: CGridLike, hit: Hit): CGridEventCtx {
  return { grid, hit, point: { x: 0, y: 0 }, raw: new MouseEvent('dblclick') };
}

function keyCtx(grid: CGridLike, key: string): CGridEventCtx {
  const hit: Hit = { kind: 'none' } as Hit;
  return { grid, hit, point: { x: 0, y: 0 }, raw: new KeyboardEvent('keydown', { key }) };
}

describe('EditTrigger — click', () => {
  let trigger: EditTrigger;
  beforeEach(() => { trigger = new EditTrigger(); });

  it('singleClickEdit + editable opens the editor on click', () => {
    const { grid, openEditor } = fakeGrid({ flags: { singleClickEdit: true } });
    trigger.handleClick(clickCtx(grid, cellHit(2, 'a')));
    expect(openEditor).toHaveBeenCalledWith(2, 'a');
  });

  it('singleClickEdit OFF leaves a click alone (dblclick handles the edit)', () => {
    const { grid, openEditor } = fakeGrid({ flags: { singleClickEdit: false } });
    trigger.handleClick(clickCtx(grid, cellHit(2, 'a')));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('per-column singleClickEdit=true wins over grid=false', () => {
    const { grid, openEditor } = fakeGrid({
      flags: { singleClickEdit: false },
      singleClickEditPerCol: new Map([['a', true]]),
    });
    trigger.handleClick(clickCtx(grid, cellHit(0, 'a')));
    expect(openEditor).toHaveBeenCalledWith(0, 'a');
  });

  it('per-column singleClickEdit=false wins over grid=true', () => {
    const { grid, openEditor } = fakeGrid({
      flags: { singleClickEdit: true },
      singleClickEditPerCol: new Map([['a', false]]),
    });
    trigger.handleClick(clickCtx(grid, cellHit(0, 'a')));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('suppressClickEdit blocks single-click even when singleClickEdit is on', () => {
    const { grid, openEditor } = fakeGrid({
      flags: { singleClickEdit: true, suppressClickEdit: true },
    });
    trigger.handleClick(clickCtx(grid, cellHit(0, 'a')));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('skips when isCellEditable returns false', () => {
    const { grid, openEditor } = fakeGrid({
      flags: { singleClickEdit: true },
      isCellEditable: () => false,
    });
    trigger.handleClick(clickCtx(grid, cellHit(0, 'a')));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('ignores non-cell hits', () => {
    const { grid, openEditor } = fakeGrid({ flags: { singleClickEdit: true } });
    trigger.handleClick({
      grid, hit: { kind: 'header', colId: 'a' } as Hit,
      point: { x: 0, y: 0 }, raw: new MouseEvent('click'),
    });
    expect(openEditor).not.toHaveBeenCalled();
  });
});

describe('EditTrigger — double-click', () => {
  let trigger: EditTrigger;
  beforeEach(() => { trigger = new EditTrigger(); });

  it('opens editor on a cell dblclick when editable', () => {
    const { grid, openEditor } = fakeGrid();
    trigger.handleDoubleClick(dblClickCtx(grid, cellHit(3, 'b')));
    expect(openEditor).toHaveBeenCalledWith(3, 'b');
  });

  it('suppressClickEdit blocks dblclick', () => {
    const { grid, openEditor } = fakeGrid({ flags: { suppressClickEdit: true } });
    trigger.handleDoubleClick(dblClickCtx(grid, cellHit(0, 'a')));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('does not re-open when already editing', () => {
    const { grid, openEditor } = fakeGrid({ isEditing: () => true });
    trigger.handleDoubleClick(dblClickCtx(grid, cellHit(0, 'a')));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('passes data, colId, rowIndex, value into the editable callback', () => {
    const cb = vi.fn().mockReturnValue(true);
    const { grid } = fakeGrid({
      rowDataAt: (r) => ({ idx: r }),
      isCellEditable: (r, c) => cb({ data: { idx: r }, colId: c, rowIndex: r, value: undefined }),
    });
    trigger.handleDoubleClick(dblClickCtx(grid, cellHit(7, 'b')));
    expect(cb).toHaveBeenCalledWith({ data: { idx: 7 }, colId: 'b', rowIndex: 7, value: undefined });
  });
});

describe('EditTrigger — suppressKeyboardEvent', () => {
  let trigger: EditTrigger;
  beforeEach(() => { trigger = new EditTrigger(); });

  it('callback returning true short-circuits downstream key handlers', () => {
    const next = { handleKeyDown: vi.fn() };
    trigger.next = next as never;
    const cb: SuppressKeyboardEventFn = vi.fn().mockReturnValue(true);
    const { grid } = fakeGrid({
      suppressKeyboardEventPerCol: new Map([['a', cb]]),
    });
    trigger.handleKeyDown(keyCtx(grid, 'Tab'));
    expect(cb).toHaveBeenCalled();
    expect(next.handleKeyDown).not.toHaveBeenCalled();
  });

  it('callback returning false forwards normally', () => {
    const next = { handleKeyDown: vi.fn() };
    trigger.next = next as never;
    const cb: SuppressKeyboardEventFn = vi.fn().mockReturnValue(false);
    const { grid } = fakeGrid({
      suppressKeyboardEventPerCol: new Map([['a', cb]]),
    });
    trigger.handleKeyDown(keyCtx(grid, 'ArrowDown'));
    expect(next.handleKeyDown).toHaveBeenCalled();
  });

  it('no callback configured: forwards', () => {
    const next = { handleKeyDown: vi.fn() };
    trigger.next = next as never;
    const { grid } = fakeGrid();
    trigger.handleKeyDown(keyCtx(grid, 'ArrowDown'));
    expect(next.handleKeyDown).toHaveBeenCalled();
  });
});
