import type { CellEditorRegistry } from './editors/registry';
import type { ICellEditor, ICellEditorParams } from './editors/iCellEditor';
import { PopupHost } from './editors/popupHost';

export interface EditorAttachOpts<TRow = unknown, TValue = unknown> {
  editorName: string;
  rowData: TRow;
  colId: string;
  value: TValue;
  cellBounds: { x: number; y: number; w: number; h: number };
  params: Record<string, unknown>;
  charPress: string | null;
  /** Force popup mode regardless of `editor.isPopup()`. Matches
   *  `CColDef.cellEditorPopup`. When undefined, the editor's own
   *  `isPopup()` hook decides. */
  cellEditorPopup?: boolean;
  /** Popup position relative to the cell. Defaults to 'over' when
   *  unset. Matches `CColDef.cellEditorPopupPosition`. The editor's
   *  `getPopupPosition()` hook (when present) wins. */
  cellEditorPopupPosition?: 'over' | 'under';
  /** Visible viewport bounds in the editor host's coordinate space.
   *  Used by the PopupHost to flip position on collision. Required when
   *  popup mode is active. */
  viewportBounds?: { width: number; height: number };
  onCommit: (newValue: TValue) => void;
  onCancel: () => void;
}

/** Inline mode: editor mounts inside the cell's pixel rect, wrapped in an
 *  absolutely-positioned container.
 *  Popup mode: editor mounts via PopupHost, floating over (or under) the
 *  cell at the editor's natural size. */
type ActiveMode =
  | { kind: 'inline'; editor: ICellEditor; opts: EditorAttachOpts; wrapper: HTMLElement }
  | { kind: 'popup'; editor: ICellEditor; opts: EditorAttachOpts; popup: PopupHost; gui: HTMLElement };

export class EditorOverlay {
  private current: ActiveMode | null = null;

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

    // Popup mode dispatches via PopupHost. The editor opts in via
    // `isPopup()` OR the column def sets `cellEditorPopup: true` — either
    // wins. Editor's `getPopupPosition()` takes precedence over the col
    // def's `cellEditorPopupPosition`, which falls back to 'over'.
    const isPopup = editor.isPopup?.() === true || opts.cellEditorPopup === true;
    if (isPopup) {
      const position = editor.getPopupPosition?.() ?? opts.cellEditorPopupPosition ?? 'over';
      const viewportBounds = opts.viewportBounds ?? {
        width: this.host.clientWidth || 0,
        height: this.host.clientHeight || 0,
      };
      const popup = new PopupHost(this.host);
      popup.mount(gui, { cellBounds: opts.cellBounds, position, viewportBounds });
      this.current = { kind: 'popup', editor, opts, popup, gui };
      editor.afterGuiAttached?.();
      return;
    }

    // Inline mode — wrap the editor body in an absolutely-positioned container
    // so the editor itself can size to 100%/100% without absolute math.
    const wrapper = document.createElement('div');
    wrapper.className = 'cg-editor-overlay';
    wrapper.style.cssText =
      `position:absolute; left:${opts.cellBounds.x}px; top:${opts.cellBounds.y}px;` +
      ` width:${opts.cellBounds.w}px; height:${opts.cellBounds.h}px; z-index:10; pointer-events:auto;`;
    wrapper.appendChild(gui);
    this.host.appendChild(wrapper);
    this.current = { kind: 'inline', editor, opts, wrapper };
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
    if (this.current.kind === 'inline') {
      this.current.wrapper.remove();
    } else {
      this.current.popup.unmount();
    }
    this.current.editor.destroy();
    this.current = null;
  }
}
