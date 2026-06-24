import type { CellEditorRegistry } from './editors/registry';
import type { ICellEditor, ICellEditorParams } from './editors/iCellEditor';

export interface EditorAttachOpts<TRow = unknown, TValue = unknown> {
  editorName: string;
  rowData: TRow;
  colId: string;
  value: TValue;
  cellBounds: { x: number; y: number; w: number; h: number };
  params: Record<string, unknown>;
  charPress: string | null;
  onCommit: (newValue: TValue) => void;
  onCancel: () => void;
}

export class EditorOverlay {
  private current: { editor: ICellEditor; opts: EditorAttachOpts; wrapper: HTMLElement } | null = null;

  constructor(private host: HTMLElement, private registry: CellEditorRegistry) {}

  isOpen(): boolean { return this.current !== null; }

  open(opts: EditorAttachOpts): void {
    if (this.current) this.close();
    const Ctor = this.registry.resolve(opts.editorName);
    const editor = new Ctor();
    const params: ICellEditorParams = {
      data: opts.rowData,
      colId: opts.colId,
      value: opts.value,
      charPress: opts.charPress,
      params: opts.params,
      cellBounds: opts.cellBounds,
      stopEditing: (cancel?: boolean) => { if (cancel) this.cancel(); else this.commit(); },
    };
    editor.init(params);
    if (editor.isCancelBeforeStart?.()) { editor.destroy(); return; }
    const gui = editor.getGui();
    // Wrap the editor body in a positioned container so the editor itself
    // can be styled to 100%/100% without caring about absolute positioning.
    const wrapper = document.createElement('div');
    wrapper.className = 'cg-editor-overlay';
    wrapper.style.cssText =
      `position:absolute; left:${opts.cellBounds.x}px; top:${opts.cellBounds.y}px;` +
      ` width:${opts.cellBounds.w}px; height:${opts.cellBounds.h}px; z-index:10; pointer-events:auto;`;
    wrapper.appendChild(gui);
    this.host.appendChild(wrapper);
    this.current = { editor, opts, wrapper };
    editor.afterGuiAttached?.();
  }

  /** Read getValue from the editor and dispatch onCommit. Host is responsible
   *  for routing through valueParser / valueSetter (cgrid.ts does that). */
  commit(): void {
    if (!this.current) return;
    const { editor, opts } = this.current;
    if (editor.isCancelAfterEnd?.()) { this.cancel(); return; }
    const newValue = editor.getValue();
    // Tear down DOM + clear `current` BEFORE calling onCommit so listeners
    // observing `isOpen()` see the editor closed.
    this.close();
    opts.onCommit(newValue);
  }

  cancel(): void {
    if (!this.current) return;
    const { opts } = this.current;
    this.close();
    opts.onCancel();
  }

  close(): void {
    if (!this.current) return;
    const { editor, wrapper } = this.current;
    wrapper.remove();
    editor.destroy();
    this.current = null;
  }
}
