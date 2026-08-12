/**
 * Cycle 5 / Task 10 — RowEditCoordinator unit coverage.
 *
 * Coordinator mounts N editors (one per editable cell in a row), tracks an
 * activeIndex for Tab navigation, and commits/cancels as a unit. It calls
 * focusIn/focusOut on editors during Tab cycles. Tests exercise:
 *   - open() instantiates one editor per cell spec and mounts each gui
 *   - initial activeIndex resolves from initialColId (falls back to 0)
 *   - focusNext(+1)/focusNext(-1) cycle and wrap within the row
 *   - focusIn / focusOut are invoked on the corresponding editor instances
 *   - commit() gathers every editor's getValue() into onCommit
 *   - cancel() invokes onCancel without onCommit + tears down all editors
 *   - close() removes every editor's gui from the host
 */
import { describe, it, expect, vi } from 'vitest';
import { RowEditCoordinator } from '../src/interaction/editors/rowEditCoordinator';
import { CellEditorRegistry } from '../src/interaction/editors/registry';
import type { ICellEditor, ICellEditorParams } from '../src/interaction/editors/iCellEditor';

class SpyEditor implements ICellEditor<unknown, string> {
  static instances: SpyEditor[] = [];
  static reset(): void { SpyEditor.instances = []; }
  initParams!: ICellEditorParams<unknown, string>;
  gui = document.createElement('input');
  focusInCalls = 0;
  focusOutCalls = 0;
  destroyed = false;
  value = '';
  constructor() {
    this.gui.className = 'spy-editor';
    SpyEditor.instances.push(this);
  }
  init(params: ICellEditorParams<unknown, string>): void {
    this.initParams = params;
    this.value = String(params.value ?? '');
    this.gui.value = this.value;
  }
  getGui(): HTMLElement { return this.gui; }
  getValue(): string { return this.gui.value; }
  destroy(): void { this.destroyed = true; }
  focusIn(): void { this.focusInCalls++; this.gui.focus(); }
  focusOut(): void { this.focusOutCalls++; this.gui.blur(); }
}

function setup() {
  SpyEditor.reset();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const registry = new CellEditorRegistry();
  registry.register('spy', SpyEditor);
  const coord = new RowEditCoordinator(host, registry);
  return { host, registry, coord };
}

const cellSpecs = [
  { colId: 'a', editorName: 'spy', value: 'A1', cellBounds: { x: 0, y: 0, w: 100, h: 22 }, params: {} },
  { colId: 'b', editorName: 'spy', value: 'B1', cellBounds: { x: 100, y: 0, w: 80, h: 22 }, params: {} },
  { colId: 'c', editorName: 'spy', value: 'C1', cellBounds: { x: 180, y: 0, w: 60, h: 22 }, params: {} },
];

describe('RowEditCoordinator', () => {
  it('open() mounts one editor per cell spec + records initial activeIndex from initialColId', () => {
    const { host, coord } = setup();
    coord.open({
      rowIndex: 0, rowId: 'r0', rowData: {},
      cells: cellSpecs, initialColId: 'b',
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    expect(coord.isOpen()).toBe(true);
    expect(host.querySelectorAll('.spy-editor').length).toBe(3);
    expect(coord.getActiveColId()).toBe('b');
    // afterGuiAttached is optional — coordinator calls focusIn on the
    // active editor only. SpyEditor implements both focus hooks so the
    // initial focusIn counter reflects exactly that one call.
    expect(SpyEditor.instances[1]!.focusInCalls).toBe(1);
    expect(SpyEditor.instances[0]!.focusInCalls).toBe(0);
  });

  it('open() falls back to activeIndex 0 when initialColId is omitted', () => {
    const { coord } = setup();
    coord.open({
      rowIndex: 0, rowId: 'r0', rowData: {},
      cells: cellSpecs,
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    expect(coord.getActiveColId()).toBe('a');
  });

  it('focusNext(+1) cycles activeIndex and calls focusOut on prev + focusIn on next', () => {
    const { coord } = setup();
    coord.open({
      rowIndex: 0, rowId: 'r0', rowData: {},
      cells: cellSpecs, initialColId: 'a',
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    coord.focusNext(1);
    expect(coord.getActiveColId()).toBe('b');
    expect(SpyEditor.instances[0]!.focusOutCalls).toBe(1);
    expect(SpyEditor.instances[1]!.focusInCalls).toBe(1);
    coord.focusNext(1);
    expect(coord.getActiveColId()).toBe('c');
    coord.focusNext(1);
    // Wraps within the row back to the first editable cell.
    expect(coord.getActiveColId()).toBe('a');
  });

  it('focusNext(-1) cycles backward and wraps from first → last within the row', () => {
    const { coord } = setup();
    coord.open({
      rowIndex: 0, rowId: 'r0', rowData: {},
      cells: cellSpecs, initialColId: 'a',
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    coord.focusNext(-1);
    expect(coord.getActiveColId()).toBe('c');
    coord.focusNext(-1);
    expect(coord.getActiveColId()).toBe('b');
  });

  it('commit() gathers every editor.getValue() into onCommit + closes all editors', () => {
    const { host, coord } = setup();
    const onCommit = vi.fn();
    coord.open({
      rowIndex: 0, rowId: 'r0', rowData: {},
      cells: cellSpecs, initialColId: 'a',
      onCommit, onCancel: vi.fn(),
    });
    SpyEditor.instances[0]!.gui.value = 'A-EDITED';
    SpyEditor.instances[1]!.gui.value = 'B-EDITED';
    // Leave instance 2 unchanged ('C1') — commit should still include it.
    coord.commit();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toEqual([
      { colId: 'a', newRawValue: 'A-EDITED' },
      { colId: 'b', newRawValue: 'B-EDITED' },
      { colId: 'c', newRawValue: 'C1' },
    ]);
    expect(host.querySelectorAll('.spy-editor').length).toBe(0);
    expect(coord.isOpen()).toBe(false);
    expect(SpyEditor.instances.every((e) => e.destroyed)).toBe(true);
  });

  it('cancel() invokes onCancel without onCommit + tears down all editors', () => {
    const { host, coord } = setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    coord.open({
      rowIndex: 0, rowId: 'r0', rowData: {},
      cells: cellSpecs, initialColId: 'a',
      onCommit, onCancel,
    });
    coord.cancel();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.spy-editor').length).toBe(0);
    expect(coord.isOpen()).toBe(false);
  });

  it('init() forwards a stopEditing callback that commits + cancels the whole row', () => {
    const { coord } = setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    coord.open({
      rowIndex: 0, rowId: 'r0', rowData: {},
      cells: cellSpecs, initialColId: 'b',
      onCommit, onCancel,
    });
    // Calling stopEditing(false) on any cell's params commits the whole row.
    SpyEditor.instances[1]!.initParams.stopEditing(false);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(coord.isOpen()).toBe(false);
  });

  it('opening twice closes the previous mount before re-opening', () => {
    const { host, coord } = setup();
    coord.open({
      rowIndex: 0, rowId: 'r0', rowData: {},
      cells: cellSpecs, initialColId: 'a',
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    expect(host.querySelectorAll('.spy-editor').length).toBe(3);
    coord.open({
      rowIndex: 1, rowId: 'r1', rowData: {},
      cells: cellSpecs.slice(0, 2), initialColId: 'a',
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    // The 2nd open replaces — only 2 mounts remain.
    expect(host.querySelectorAll('.spy-editor').length).toBe(2);
    expect(coord.getRowIndex()).toBe(1);
  });
});
