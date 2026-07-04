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
  /** Excel-style edit sub-mode. When set, the editor wrapper carries a
   *  `cg-editor--enter` / `cg-editor--edit` class so the border can signal
   *  which mode is active (enter = quick-entry, arrows commit; edit =
   *  caret navigation). Undefined leaves the wrapper unmarked. */
  modeClass?: 'enter' | 'edit';
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

  /** The element that carries the mode / validity classes — the wrapper in
   *  inline mode, the editor GUI in popup mode. */
  private frame(): HTMLElement | null {
    if (!this.current) return null;
    return this.current.kind === 'inline' ? this.current.wrapper : this.current.gui;
  }

  /** Flip the Excel edit sub-mode on the open editor. Called by the host
   *  when a click inside an `enter`-mode editor promotes it to `edit`
   *  (one-way). No-op when no editor is open. */
  setMode(mode: 'enter' | 'edit'): void {
    const frame = this.frame();
    if (!frame) return;
    frame.classList.remove('cg-editor--enter', 'cg-editor--edit');
    frame.classList.add(`cg-editor--${mode}`);
  }

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
      if (opts.modeClass) gui.classList.add(`cg-editor--${opts.modeClass}`);
      editor.afterGuiAttached?.();
      return;
    }

    // Inline mode — wrap the editor body in an absolutely-positioned container
    // so the editor itself can size to 100%/100% without absolute math.
    const wrapper = document.createElement('div');
    wrapper.className = 'cg-editor-overlay';
    if (opts.modeClass) wrapper.classList.add(`cg-editor--${opts.modeClass}`);
    wrapper.style.cssText =
      `position:absolute; left:${opts.cellBounds.x}px; top:${opts.cellBounds.y}px;` +
      ` width:${opts.cellBounds.w}px; height:${opts.cellBounds.h}px; z-index:10; pointer-events:auto;`;
    wrapper.appendChild(gui);
    this.host.appendChild(wrapper);
    this.current = { kind: 'inline', editor, opts, wrapper };
    editor.afterGuiAttached?.();
  }

  /** Move the open editor to follow its cell. Called by the host grid on
   *  scroll / viewport change so an inline editor tracks the focused
   *  cell as it moves. Popup editors are anchored independently and
   *  re-anchored via the same call. No-op when no editor is open. */
  reposition(bounds: { x: number; y: number; w: number; h: number }): void {
    if (!this.current) return;
    if (this.current.kind === 'inline') {
      const s = this.current.wrapper.style;
      s.left = `${bounds.x}px`;
      s.top = `${bounds.y}px`;
      s.width = `${bounds.w}px`;
      s.height = `${bounds.h}px`;
    } else {
      // Popup mode re-anchors against the cell bounds via PopupHost.
      this.current.popup.reposition?.({ cellBounds: bounds });
    }
  }

  /** Read getValue from the editor and dispatch onCommit. Host is responsible
   *  for routing through valueParser / valueSetter (cgrid.ts does that). */
  commit(): void {
    if (!this.current) return;
    const { editor, opts } = this.current;
    // Validation gate — when the editor reports itself invalid we keep the
    // editor open and flag it (Excel behaviour: a bad entry doesn't commit
    // or navigate away). The flag clears on the next successful commit path.
    if (editor.isValid?.() === false) {
      this.frame()?.classList.add('cg-editor--invalid');
      return;
    }
    this.frame()?.classList.remove('cg-editor--invalid');
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
