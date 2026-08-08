// RowEditCoordinator — full-row edit mount + lifecycle coordinator. Sits
// alongside `EditorOverlay` (single-cell host). The two are mutually
// exclusive at runtime: `editType: 'fullRow'` opens the coordinator,
// otherwise the overlay opens. cgrid.openEditor dispatches between them.
//
// Behaviour (matches catalog 06 "Full-row edit mode"):
//   - One ICellEditor per editable column in the row mounts at construction.
//   - The active cell (tracked by `activeIndex`) receives focus first.
//   - Tab/Shift+Tab cycles `activeIndex` within the row (wrap-around);
//     `focusOut` fires on the previous editor, `focusIn` on the next.
//   - Enter commits every editor's value together; Escape cancels them all.
//   - The host (velocityGrid.ts) routes commit through valueParser → valueSetter
//     and dispatches a single `applyTransaction({ update })` per commit.
//
// The coordinator does NOT know about valueParser / valueSetter / events —
// it surfaces commits as raw `{ colId, newRawValue }` pairs and lets the
// host run the per-column pipeline. Keeps the coordinator's contract
// orthogonal to the data layer.

import type { CellEditorRegistry } from './registry';
import type { ICellEditor, ICellEditorParams } from './iCellEditor';

export interface RowEditCellSpec {
  colId: string;
  editorName: string;
  cellBounds: { x: number; y: number; w: number; h: number };
  /** Pre-edit value forwarded as `ICellEditorParams.value`. */
  value: unknown;
  /** Resolved `cellEditorParams` for the column. Empty when none configured. */
  params: Record<string, unknown>;
}

export interface RowEditOpenOpts {
  rowIndex: number;
  rowId: string;
  /** Row data snapshot forwarded to every editor's `init` as
   *  `ICellEditorParams.data`. Best-effort partial when the chunk hasn't
   *  resolved every column yet — matches the single-cell path. */
  rowData: unknown;
  cells: RowEditCellSpec[];
  /** colId of the editor that should receive initial focus. Falls back to
   *  the first cell when omitted or unknown. */
  initialColId?: string;
  /** Invoked with one entry per editor when the coordinator commits. The
   *  host runs valueParser/valueSetter against each. */
  onCommit: (commits: Array<{ colId: string; newRawValue: unknown }>) => void;
  /** Invoked once on cancel — no commit entries. */
  onCancel: () => void;
}

interface ActiveCell {
  spec: RowEditCellSpec;
  editor: ICellEditor;
  wrapper: HTMLElement;
}

interface ActiveRowEdit {
  rowIndex: number;
  rowId: string;
  cells: ActiveCell[];
  activeIndex: number;
  opts: RowEditOpenOpts;
}

export class RowEditCoordinator {
  private active: ActiveRowEdit | null = null;

  constructor(private host: HTMLElement, private registry: CellEditorRegistry) {}

  isOpen(): boolean { return this.active !== null; }

  /** Row index of the currently-open row edit, or `null` when idle. */
  getRowIndex(): number | null { return this.active?.rowIndex ?? null; }

  /** colId of the editor that currently holds focus, or `null` when idle. */
  getActiveColId(): string | null {
    if (!this.active) return null;
    return this.active.cells[this.active.activeIndex]?.spec.colId ?? null;
  }

  open(opts: RowEditOpenOpts): void {
    if (this.active) this.close();
    const cells: ActiveCell[] = [];
    for (const spec of opts.cells) {
      const Ctor = this.registry.resolve(spec.editorName);
      const editor = new Ctor();
      const params: ICellEditorParams = {
        data: opts.rowData,
        colId: spec.colId,
        value: spec.value,
        // Type-to-edit is single-cell only — full-row never carries a
        // charPress; every editor mounts with its current value selected.
        charPress: null,
        params: spec.params,
        cellBounds: spec.cellBounds,
        stopEditing: (cancel?: boolean) => { if (cancel) this.cancel(); else this.commit(); },
      };
      editor.init(params);
      if (editor.isCancelBeforeStart?.()) { editor.destroy(); continue; }
      const gui = editor.getGui();
      const wrapper = document.createElement('div');
      wrapper.className = 'vg-editor-overlay vg-editor-overlay--row';
      wrapper.dataset.colId = spec.colId;
      wrapper.style.cssText =
        `position:absolute; left:${spec.cellBounds.x}px; top:${spec.cellBounds.y}px;` +
        ` width:${spec.cellBounds.w}px; height:${spec.cellBounds.h}px; z-index:10; pointer-events:auto;`;
      wrapper.appendChild(gui);
      this.host.appendChild(wrapper);
      cells.push({ spec, editor, wrapper });
    }
    if (cells.length === 0) return;
    let activeIndex = 0;
    if (opts.initialColId) {
      const i = cells.findIndex((c) => c.spec.colId === opts.initialColId);
      if (i >= 0) activeIndex = i;
    }
    this.active = { rowIndex: opts.rowIndex, rowId: opts.rowId, cells, activeIndex, opts };
    // afterGuiAttached is per-editor noise (each text editor focuses + selects
    // its own input). Calling it on every editor in order would leave focus on
    // the LAST mounted, not the active one. Skip the auto-focus side-effects
    // and route focus through focusIn on the active cell only — the others
    // wait for Tab. Editors that do non-focus initialization in
    // afterGuiAttached still get the call, just only on the active one.
    cells[activeIndex]!.editor.afterGuiAttached?.();
    this.focusCell(cells[activeIndex]!);
  }

  /** Cycle activeIndex by `direction` (+1 forward, -1 backward), wrapping
   *  within the row. `focusOut` fires on the previous active editor;
   *  `focusIn` fires on the next. No-op when not open. */
  focusNext(direction: 1 | -1): void {
    if (!this.active) return;
    const { cells } = this.active;
    if (cells.length <= 1) return;
    const prev = cells[this.active.activeIndex]!;
    prev.editor.focusOut?.();
    let next = this.active.activeIndex + direction;
    if (next >= cells.length) next = 0;
    else if (next < 0) next = cells.length - 1;
    this.active.activeIndex = next;
    this.focusCell(cells[next]!);
  }

  /** Read getValue from every mounted editor and dispatch onCommit. The
   *  host is responsible for routing each value through the per-column
   *  valueParser → valueSetter pipeline and emitting cellValueChanged /
   *  rowValueChanged events. */
  commit(): void {
    if (!this.active) return;
    const commits: Array<{ colId: string; newRawValue: unknown }> = [];
    for (const cell of this.active.cells) {
      // Per-editor isCancelAfterEnd opt-out: a custom editor can refuse to
      // contribute its value to the row commit. Mirrors ag-grid's behaviour
      // where validation can suppress a single cell's write.
      if (cell.editor.isCancelAfterEnd?.()) continue;
      commits.push({ colId: cell.spec.colId, newRawValue: cell.editor.getValue() });
    }
    const opts = this.active.opts;
    this.close();
    opts.onCommit(commits);
  }

  cancel(): void {
    if (!this.active) return;
    const opts = this.active.opts;
    this.close();
    opts.onCancel();
  }

  close(): void {
    if (!this.active) return;
    for (const cell of this.active.cells) {
      cell.wrapper.remove();
      cell.editor.destroy();
    }
    this.active = null;
  }

  /** Editor instances currently mounted, in column order. Surface for
   *  `api.getCellEditorInstances` (later cycle); used today by debugging /
   *  app-level introspection. */
  getEditorInstances(): ICellEditor[] {
    return this.active ? this.active.cells.map((c) => c.editor) : [];
  }

  /** Route focus to the cell — prefer the editor's optional `focusIn` hook,
   *  fall back to focusing the gui element itself. Keeps the contract honest
   *  for editors that don't implement focusIn (the input is usually the gui
   *  so `gui.focus()` lands the cursor correctly). */
  private focusCell(cell: ActiveCell): void {
    if (cell.editor.focusIn) {
      cell.editor.focusIn();
      return;
    }
    const focusable = cell.editor.getGui() as HTMLElement & { focus?: () => void };
    focusable.focus?.();
  }
}
