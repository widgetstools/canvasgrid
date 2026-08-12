import { describe, it, expect, vi } from 'vitest';
import {
  EditController,
  type EditControllerDeps,
  type EditOptions,
} from '../src/core/editController';
import { DisposableRegistry } from '../src/core/disposable';
import { TypedEventEmitter } from '../src/core/eventEmitter';
import type { VelocityGridEvent } from '../src/types';
import type { ResolvedColDef } from '../src/core/propertyChain';

/**
 * Cycle 19 / Task 4 — focused unit coverage of the extracted EditController.
 *
 * Coverage:
 *   • openEditor lifecycle: emits `cellEditingStarted`, mounts EditorOverlay,
 *     runs the commit-back pipeline through `getRowByIndex` + `applyTransaction`
 *     + `valueParser` / `valueSetter`, emits `cellValueChanged` +
 *     `cellEditingStopped`, and returns focus to the canvas.
 *   • cancel path: emits `cellEditingStopped` with `valueChanged: false` and
 *     no worker round-trip.
 *   • `isCellEditable`: static bool, function callback, false for unknown col,
 *     safe on predicate throw.
 *   • `nextEditableCell`: forward + backward wrap, editable filter, returns
 *     null when no candidate exists.
 *   • `stopEditing`: single-cell + full-row dispatch.
 *   • `syncOpenEditorPosition`: no-op when no editor; commits + closes when
 *     bounds is `null` (cell scrolled out of band).
 *   • `registerCellEditor`: proxies into the underlying registry so a
 *     `cellEditor: name` column dispatches to the registered ctor.
 *   • Keydown matrix: Escape cancels, Enter commits + optional descend,
 *     Tab commits + advances (with `suppressStartEditOnTab` honoured),
 *     Excel-mode ArrowDown commits + moves focus.
 *   • Excel-mode mousedown flip: a click inside editorContainer flips
 *     `activeEdit.mode` from `'enter'` to `'edit'` (verified indirectly
 *     via the ArrowDown handler no longer firing after the flip).
 *   • Destroy: EditorOverlay + RowEditCoordinator close on dispose so a
 *     late `close()` can't paint into a torn-down container.
 */

// ── Fake ResolvedColDef helpers ──────────────────────────────────────────────

function editableCol(
  colId: string,
  overrides: Partial<ResolvedColDef<Record<string, unknown>>> = {},
): ResolvedColDef<Record<string, unknown>> {
  // Only the fields the controller touches — the rest is filler to satisfy
  // the ResolvedColDef shape. Cast through unknown to avoid enumerating the
  // 60+ fields the resolver would normally populate.
  return {
    colId,
    field: colId,
    headerName: colId,
    minWidth: 0,
    maxWidth: 9999,
    cellDataType: 'text',
    cellRenderer: 'text',
    sortable: false,
    resizable: false,
    editable: true,
    suppressFloatingFilterButton: false,
    columnGroupShow: null,
    suppressMovable: false,
    lockPosition: null,
    ...overrides,
  } as unknown as ResolvedColDef<Record<string, unknown>>;
}

// ── Harness ──────────────────────────────────────────────────────────────────

interface Harness {
  controller: EditController<Record<string, unknown>>;
  deps: EditControllerDeps<Record<string, unknown>>;
  disposables: DisposableRegistry;
  events: TypedEventEmitter<VelocityGridEvent>;
  root: HTMLDivElement;
  editorContainer: HTMLDivElement;
  columns: ResolvedColDef<Record<string, unknown>>[];
  rowData: Record<number, Record<string, unknown>>;
  focus: { rowIndex: number | null; colId: string | null };
  applyTransaction: ReturnType<typeof vi.fn>;
  getRowByIndex: ReturnType<typeof vi.fn>;
  focusCanvas: ReturnType<typeof vi.fn>;
  options: EditOptions;
  seen: VelocityGridEvent[];
}

function makeHarness(opts: {
  columns?: ResolvedColDef<Record<string, unknown>>[];
  rows?: Record<number, Record<string, unknown>>;
  options?: EditOptions;
  rowCount?: number;
  pivotMode?: boolean;
} = {}): Harness {
  const root = document.createElement('div');
  const editorContainer = document.createElement('div');
  editorContainer.style.cssText = 'position:absolute';
  root.appendChild(editorContainer);
  document.body.appendChild(root);

  const columns = opts.columns ?? [
    editableCol('name'),
    editableCol('age', { cellDataType: 'number' }),
  ];
  const rowData: Record<number, Record<string, unknown>> = opts.rows ?? {
    0: { name: 'Ada', age: 36 },
    1: { name: 'Ben', age: 42 },
  };
  const rowCount = opts.rowCount ?? 2;

  const disposables = new DisposableRegistry();
  const events = new TypedEventEmitter<VelocityGridEvent>();
  const seen: VelocityGridEvent[] = [];
  // Cast to `any` to sidestep the discriminated-union `handler(ev: T & { type })`
  // narrowing — the test collects every event type uniformly for assertions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events.on('cellEditingStarted' as any, ((e: VelocityGridEvent) => { seen.push(e); }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events.on('cellEditingStopped' as any, ((e: VelocityGridEvent) => { seen.push(e); }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events.on('cellValueChanged' as any, ((e: VelocityGridEvent) => { seen.push(e); }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events.on('rowEditingStarted' as any, ((e: VelocityGridEvent) => { seen.push(e); }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events.on('rowEditingStopped' as any, ((e: VelocityGridEvent) => { seen.push(e); }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events.on('rowValueChanged' as any, ((e: VelocityGridEvent) => { seen.push(e); }) as any);

  const focus: Harness['focus'] = { rowIndex: null, colId: null };
  const focusCanvas = vi.fn();
  // Simulate the worker returning the row-shaped data — the commit pipeline
  // mutates `rowData` in place so the assertions can read the new value.
  const getRowByIndex = vi.fn(
    (rowIndex: number) => Promise.resolve({
      rowId: `row-${rowIndex}`,
      data: rowData[rowIndex] ?? null,
    }),
  );
  const applyTransaction = vi.fn(() => Promise.resolve({}));

  const options: EditOptions = opts.options ?? {};

  const deps: EditControllerDeps<Record<string, unknown>> = {
    disposables,
    events,
    root,
    editorContainer,
    getColumnDef: (colId) => columns.find((c) => c.colId === colId),
    isPivotMode: () => opts.pivotMode === true,
    getColumnOrder: () => columns,
    getRowCount: () => rowCount,
    getVisibleColumns: () => columns.map((c, i) => ({
      colId: c.colId, left: i * 100, width: 100,
    })),
    getVisibleRows: () => Array.from({ length: rowCount }, (_, i) => ({
      subgrid: { isData: true },
      localRowIndex: i,
      top: i * 30,
      height: 30,
    })),
    getCellAt: (rowIndex, colId) => {
      const row = rowData[rowIndex];
      if (!row || !(colId in row)) return null;
      return { value: row[colId], valueFormatted: String(row[colId] ?? '') };
    },
    getRowIdAt: (rowIndex) => `row-${rowIndex}`,
    getRowDataSnapshotAt: (rowIndex) => ({ ...(rowData[rowIndex] ?? {}) }),
    getCanvasBounds: () => ({ width: 800, height: 600 }),
    getVisibleCellBounds: (rowIndex, colId) => {
      const col = columns.findIndex((c) => c.colId === colId);
      if (col < 0 || rowIndex < 0 || rowIndex >= rowCount) return null;
      return { x: col * 100, y: rowIndex * 30, w: 100, h: 30 };
    },
    setFocus: (rowIndex, colId) => { focus.rowIndex = rowIndex; focus.colId = colId; },
    setFocusAndCollapseRanges: (rowIndex, colId) => {
      focus.rowIndex = rowIndex;
      focus.colId = colId;
    },
    getFocus: () => ({ rowIndex: focus.rowIndex, colId: focus.colId }),
    focusCanvas,
    getRowByIndex,
    applyTransaction,
    isDestroyed: () => false,
  };

  const controller = new EditController<Record<string, unknown>>(deps, () => options);
  return {
    controller, deps, disposables, events, root, editorContainer,
    columns, rowData, focus, applyTransaction, getRowByIndex, focusCanvas,
    options, seen,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EditController — isCellEditable', () => {
  it('returns true for a static-editable column', () => {
    const h = makeHarness();
    expect(h.controller.isCellEditable(0, 'name')).toBe(true);
  });

  it('returns false for an unknown column', () => {
    const h = makeHarness();
    expect(h.controller.isCellEditable(0, 'no-such-col')).toBe(false);
  });

  it('invokes the callback form with the cell context and returns its result', () => {
    const editable = vi.fn((p: { data: unknown; colId: string; rowIndex: number; value: unknown }) => (
      (p.data as Record<string, unknown>).name === 'Ada'
    ));
    const h = makeHarness({
      columns: [editableCol('name', { editable })],
    });
    expect(h.controller.isCellEditable(0, 'name')).toBe(true);
    expect(h.controller.isCellEditable(1, 'name')).toBe(false);
    expect(editable).toHaveBeenCalledWith(expect.objectContaining({ colId: 'name', rowIndex: 0 }));
  });

  it('swallows a callback throw and returns false — never surfaces the throw upstream', () => {
    const h = makeHarness({
      columns: [editableCol('name', { editable: () => { throw new Error('boom'); } })],
    });
    expect(h.controller.isCellEditable(0, 'name')).toBe(false);
  });

  it('returns false for every cell in pivot mode (Cycle 21i — pivot is read-only)', () => {
    const h = makeHarness({ pivotMode: true });
    // 'name' is statically editable, but pivot mode gates it off.
    expect(h.controller.isCellEditable(0, 'name')).toBe(false);
  });
});

describe('EditController — nextEditableCell', () => {
  it('walks forward across columns, wrapping to the next row at the right edge', () => {
    const h = makeHarness();
    // Start at (0, 'name'); forward should land on (0, 'age').
    expect(h.controller.nextEditableCell(0, 'name', 'forward'))
      .toEqual({ rowIndex: 0, colId: 'age' });
    // Wrapping: from (0, 'age') forward should hit (1, 'name').
    expect(h.controller.nextEditableCell(0, 'age', 'forward'))
      .toEqual({ rowIndex: 1, colId: 'name' });
  });

  it('walks backward, wrapping to the previous row at the left edge', () => {
    const h = makeHarness();
    expect(h.controller.nextEditableCell(1, 'name', 'backward'))
      .toEqual({ rowIndex: 0, colId: 'age' });
  });

  it('skips non-editable columns on the walk', () => {
    const h = makeHarness({
      columns: [
        editableCol('name'),
        editableCol('locked', { editable: false }),
        editableCol('age', { cellDataType: 'number' }),
      ],
    });
    expect(h.controller.nextEditableCell(0, 'name', 'forward'))
      .toEqual({ rowIndex: 0, colId: 'age' });
  });

  it('returns null when the walk exhausts all rows without finding an editable cell', () => {
    const h = makeHarness({
      columns: [editableCol('name', { editable: false })],
    });
    expect(h.controller.nextEditableCell(0, 'name', 'forward')).toBeNull();
  });

  it('returns null for an unknown starting column', () => {
    const h = makeHarness();
    expect(h.controller.nextEditableCell(0, 'no-such-col', 'forward')).toBeNull();
  });
});

describe('EditController — openEditor + commit pipeline', () => {
  it('emits cellEditingStarted synchronously with the initial value + rowId', () => {
    const h = makeHarness();
    h.controller.openEditor(0, 'name');
    const started = h.seen.find((e) => e.type === 'cellEditingStarted');
    expect(started).toMatchObject({
      type: 'cellEditingStarted',
      rowIndex: 0,
      rowId: 'row-0',
      colId: 'name',
      value: 'Ada',
    });
  });

  it('drives focus to the edited cell before the editor mounts', () => {
    const h = makeHarness();
    h.controller.openEditor(1, 'age');
    expect(h.focus).toEqual({ rowIndex: 1, colId: 'age' });
  });

  it('no-ops when the cell is not editable', () => {
    const h = makeHarness({
      columns: [editableCol('name', { editable: false })],
    });
    h.controller.openEditor(0, 'name');
    expect(h.controller.isOpen()).toBe(false);
    expect(h.seen).toHaveLength(0);
  });

  it('no-ops when an edit is already open on another cell', () => {
    const h = makeHarness();
    h.controller.openEditor(0, 'name');
    expect(h.controller.isOpen()).toBe(true);
    const seenBefore = h.seen.length;
    h.controller.openEditor(1, 'age');
    // Second call bailed out; no new started event.
    expect(h.seen.length).toBe(seenBefore);
  });

  it('commit fires cellValueChanged + cellEditingStopped + applyTransaction, then returns canvas focus', async () => {
    const h = makeHarness();
    h.controller.openEditor(0, 'name');
    // Reach into the underlying EditorOverlay via the isOpen surface then
    // simulate a commit through stopEditing(false). The EditorOverlay's
    // commit() invokes the onCommit closure the controller wired up.
    h.controller.stopEditing(false);
    // Drain the microtask chain the commit-back promise runs through.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.focusCanvas).toHaveBeenCalled();
    expect(h.applyTransaction).toHaveBeenCalledTimes(1);
    const changed = h.seen.find((e) => e.type === 'cellValueChanged');
    expect(changed).toBeDefined();
    const stopped = h.seen.find((e) => e.type === 'cellEditingStopped');
    expect(stopped).toMatchObject({
      type: 'cellEditingStopped',
      colId: 'name',
      rowIndex: 0,
    });
    // The `updates` array carries the mutated row so the worker re-runs
    // filter/sort/agg against the new value.
    expect(h.applyTransaction.mock.calls[0]![0]).toMatchObject({
      update: [h.rowData[0]],
      async: false,
    });
  });

  it('cancel fires cellEditingStopped with valueChanged:false and NO worker round-trip', async () => {
    const h = makeHarness();
    h.controller.openEditor(0, 'name');
    h.seen.length = 0;
    h.controller.stopEditing(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(h.focusCanvas).toHaveBeenCalled();
    expect(h.applyTransaction).not.toHaveBeenCalled();
    const stopped = h.seen.find((e) => e.type === 'cellEditingStopped');
    expect(stopped).toMatchObject({
      type: 'cellEditingStopped',
      valueChanged: false,
    });
  });

  it('honours valueParser + valueSetter in the commit pipeline', async () => {
    const parsedRows: unknown[] = [];
    const setterCalls: unknown[] = [];
    const h = makeHarness({
      columns: [editableCol('age', {
        cellDataType: 'number',
        valueParser: ({ newValue }) => {
          const n = Number(newValue);
          parsedRows.push(n);
          return n;
        },
        valueSetter: ({ data, newValue }) => {
          setterCalls.push(newValue);
          (data as Record<string, unknown>).age = newValue;
          return true;
        },
      })],
      rows: { 0: { age: 30 } },
    });
    h.controller.openEditor(0, 'age');
    h.controller.stopEditing(false);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // The commit fires with the editor's current value — for the built-in
    // text editor with no keystrokes, that's the initial value re-parsed.
    // We just verify the parser + setter ran (their outputs flow into the
    // applyTransaction payload the pipeline emits).
    expect(parsedRows.length).toBe(1);
    expect(setterCalls.length).toBe(1);
  });
});

describe('EditController — full-row edit', () => {
  it('routes openEditor to the row-edit coordinator when editType is fullRow', () => {
    const h = makeHarness({ options: { editType: 'fullRow' } });
    h.controller.openEditor(0, 'name');
    const started = h.seen.find((e) => e.type === 'rowEditingStarted');
    expect(started).toMatchObject({ type: 'rowEditingStarted', rowIndex: 0, rowId: 'row-0' });
    // The single-cell overlay is NOT open — full-row went through the
    // RowEditCoordinator surface instead.
    expect(h.controller.isOpen()).toBe(true);
  });

  it('cancelling a full-row edit emits rowEditingStopped with the pre-edit snapshot', async () => {
    const h = makeHarness({ options: { editType: 'fullRow' } });
    h.controller.openEditor(0, 'name');
    h.seen.length = 0;
    h.controller.stopEditing(true);
    await new Promise((r) => setTimeout(r, 0));
    const stopped = h.seen.find((e) => e.type === 'rowEditingStopped');
    expect(stopped).toMatchObject({ type: 'rowEditingStopped', rowIndex: 0 });
  });
});

describe('EditController — syncOpenEditorPosition', () => {
  it('is a no-op when no editor is open', () => {
    const h = makeHarness();
    // No throw + no side effect.
    expect(() => h.controller.syncOpenEditorPosition()).not.toThrow();
  });

  it('commits + closes the editor when getVisibleCellBounds returns null (scrolled out of band)', async () => {
    const h = makeHarness();
    h.controller.openEditor(0, 'name');
    expect(h.controller.isOpen()).toBe(true);
    // Stub deps to simulate the cell scrolling out of its band.
    h.deps.getVisibleCellBounds = () => null;
    h.controller.syncOpenEditorPosition();
    // The controller called `editor.commit()`, which triggers the
    // commit-back pipeline; drain and assert the overlay closed.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.controller.isOpen()).toBe(false);
  });
});

describe('EditController — keydown matrix', () => {
  function fireKey(root: HTMLElement, key: string, opts: Partial<KeyboardEventInit> = {}): void {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
    root.dispatchEvent(ev);
  }

  it('Escape cancels the open single-cell editor without a worker round-trip', async () => {
    const h = makeHarness();
    h.controller.openEditor(0, 'name');
    h.seen.length = 0;
    fireKey(h.root, 'Escape');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.applyTransaction).not.toHaveBeenCalled();
    expect(h.controller.isOpen()).toBe(false);
  });

  it('Enter commits + descends one row when enterNavigatesVerticallyAfterEdit is on', async () => {
    const h = makeHarness({ options: { enterNavigatesVerticallyAfterEdit: true } });
    h.controller.openEditor(0, 'name');
    fireKey(h.root, 'Enter');
    await new Promise((r) => setTimeout(r, 0));
    // Focus descended to row 1 (bounded by rowCount - 1).
    expect(h.focus).toEqual({ rowIndex: 1, colId: 'name' });
    expect(h.controller.isOpen()).toBe(false);
  });

  it('Excel-mode Enter commits + descends one row (Shift+Enter ascends)', async () => {
    const h = makeHarness({ options: { enableExcelEditing: true } });
    h.controller.openEditor(0, 'name');
    fireKey(h.root, 'Enter');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.focus).toEqual({ rowIndex: 1, colId: 'name' });
    expect(h.controller.isOpen()).toBe(false);

    // Shift+Enter ascends.
    h.controller.openEditor(1, 'name');
    fireKey(h.root, 'Enter', { shiftKey: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.focus).toEqual({ rowIndex: 0, colId: 'name' });
  });

  it('Tab commits + advances to the next editable cell, then re-opens the editor (default)', async () => {
    const h = makeHarness();
    h.controller.openEditor(0, 'name');
    fireKey(h.root, 'Tab');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.focus).toEqual({ rowIndex: 0, colId: 'age' });
    // The default path opens the next editor immediately after focus lands.
    expect(h.controller.isOpen()).toBe(true);
  });

  it('Tab does NOT re-open the editor when suppressStartEditOnTab is on', async () => {
    const h = makeHarness({ options: { suppressStartEditOnTab: true } });
    h.controller.openEditor(0, 'name');
    fireKey(h.root, 'Tab');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.focus).toEqual({ rowIndex: 0, colId: 'age' });
    expect(h.controller.isOpen()).toBe(false);
  });

  it('Excel-mode ArrowDown commits + moves focus one row down (only when mode is enter)', async () => {
    const h = makeHarness({ options: { enableExcelEditing: true } });
    // 'enter' mode simulates a type-to-edit start (KeyPaging printable key).
    h.controller.openEditor(0, 'name', null, 'enter');
    fireKey(h.root, 'ArrowDown');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.focus).toEqual({ rowIndex: 1, colId: 'name' });
    expect(h.controller.isOpen()).toBe(false);
  });

  it('Excel-mode ArrowDown does NOT fire in default edit mode (arrows are caret-move)', async () => {
    const h = makeHarness({ options: { enableExcelEditing: true } });
    h.controller.openEditor(0, 'name'); // default mode: 'edit'
    fireKey(h.root, 'ArrowDown');
    // The editor stays open — no commit, no focus move.
    expect(h.controller.isOpen()).toBe(true);
  });

  it('full-row mode: Escape cancels the whole row', async () => {
    const h = makeHarness({ options: { editType: 'fullRow' } });
    h.controller.openEditor(0, 'name');
    fireKey(h.root, 'Escape');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.controller.isOpen()).toBe(false);
  });

  it('full-row mode: Enter commits the whole row', async () => {
    const h = makeHarness({ options: { editType: 'fullRow' } });
    h.controller.openEditor(0, 'name');
    fireKey(h.root, 'Enter');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.controller.isOpen()).toBe(false);
  });
});

describe('EditController — Excel-mode mousedown flip', () => {
  it("a mousedown on editorContainer flips activeEdit.mode from 'enter' to 'edit'", () => {
    const h = makeHarness({ options: { enableExcelEditing: true } });
    h.controller.openEditor(0, 'name', null, 'enter');
    // Fire mousedown; the flip is observable indirectly — after the flip,
    // the Excel-mode ArrowDown branch no longer fires (default edit mode
    // suppresses the commit + focus move).
    h.editorContainer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    h.root.dispatchEvent(ev);
    // Editor is still open because the ArrowDown didn't hit the Excel branch.
    expect(h.controller.isOpen()).toBe(true);
  });
});

describe('EditController — registerCellEditor', () => {
  it('proxies into the shared registry so custom editors are dispatchable', () => {
    const h = makeHarness();
    class Custom {
      init() {}
      getGui() { return document.createElement('input'); }
      getValue() { return 'custom!'; }
      destroy() {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h.controller.registerCellEditor('my-custom', Custom as any);
    expect(h.controller.getCellEditorRegistry().has('my-custom')).toBe(true);
  });
});

describe('EditController — teardown', () => {
  it('dispose() closes the editor + rowEdit overlays via the DisposableRegistry hook', () => {
    const h = makeHarness();
    h.controller.openEditor(0, 'name');
    expect(h.controller.isOpen()).toBe(true);
    h.disposables.dispose();
    // After dispose, both editor + rowEdit are closed. `isOpen()` reflects
    // this — the hook the controller registered ran + closed both.
    expect(h.controller.isOpen()).toBe(false);
    expect(h.disposables.isDisposed()).toBe(true);
  });

  it('keydown listener is unregistered by dispose', () => {
    const h = makeHarness();
    const removeSpy = vi.spyOn(h.root, 'removeEventListener');
    h.disposables.dispose();
    // Confirms the capture-phase keydown listener leaves with the registry.
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });
});
