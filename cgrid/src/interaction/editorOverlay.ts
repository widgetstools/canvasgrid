import type { ResolvedColDef } from '../core/propertyChain';

export interface EditorAttachOpts {
  container: HTMLElement;
  bounds: { x: number; y: number; w: number; h: number };
  colDef: ResolvedColDef;
  initialValue: unknown;
  onCommit: (newValue: unknown) => void;
  onCancel: () => void;
}

export class EditorOverlay {
  private wrapper: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private opts: EditorAttachOpts | null = null;

  isOpen(): boolean { return this.wrapper !== null; }

  open(opts: EditorAttachOpts): void {
    this.close();
    this.opts = opts;
    const w = document.createElement('div');
    w.className = 'cg-editor-overlay';
    w.style.cssText = `position:absolute; left:${opts.bounds.x}px; top:${opts.bounds.y}px; width:${opts.bounds.w}px; height:${opts.bounds.h}px; z-index:10`;
    const input = document.createElement('input');
    const editorType = opts.colDef.cellEditor ?? (opts.colDef.type === 'number' ? 'number' : 'text');
    input.type = editorType === 'number' ? 'number' : 'text';
    input.value = String(opts.initialValue ?? '');
    input.style.cssText = 'width:100%; height:100%; box-sizing:border-box; padding:0 4px; border:1px solid #0d9488; font: inherit; outline: none;';
    input.addEventListener('keydown', this.keydown);
    input.addEventListener('blur', this.blur);
    w.appendChild(input);
    opts.container.appendChild(w);
    this.wrapper = w;
    this.input = input;
    input.focus();
    input.select();
  }

  close(): void {
    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
    this.wrapper = null;
    this.input = null;
    this.opts = null;
  }

  private keydown = (e: KeyboardEvent) => {
    if (!this.opts || !this.input) return;
    if (e.key === 'Enter') {
      const raw = this.input.value;
      const value = this.opts.colDef.type === 'number' ? Number(raw) : raw;
      this.opts.onCommit(value);
      this.close();
    } else if (e.key === 'Escape') {
      this.opts.onCancel();
      this.close();
    }
  };

  private blur = () => {
    if (!this.opts || !this.input) return;
    const raw = this.input.value;
    const value = this.opts.colDef.type === 'number' ? Number(raw) : raw;
    this.opts.onCommit(value);
    this.close();
  };
}
