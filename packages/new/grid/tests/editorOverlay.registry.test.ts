import { describe, it, expect, vi } from 'vitest';
import { EditorOverlay } from '../src/interaction/editorOverlay';
import { CellEditorRegistry } from '../src/interaction/editors/registry';

describe('EditorOverlay (registry-driven)', () => {
  it('asks the registry for the editor by name + mounts getGui()', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    const onCommit = vi.fn();
    overlay.open({
      editorName: 'text',
      rowData: { name: 'init' }, colId: 'name',
      value: 'init', cellBounds: { x: 10, y: 20, w: 120, h: 22 },
      params: {}, charPress: null,
      onCommit, onCancel: vi.fn(),
    });
    expect(host.querySelector('input.vg-cell-editor--text')).not.toBeNull();
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'new';
    overlay.commit();
    expect(onCommit).toHaveBeenCalledWith('new');
    overlay.close();
    expect(host.querySelector('input.vg-cell-editor--text')).toBeNull();
  });

  it('opens with charPress as the initial value (type-to-edit)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    overlay.open({
      editorName: 'text',
      rowData: { v: 'old' }, colId: 'v',
      value: 'old', cellBounds: { x: 0, y: 0, w: 100, h: 22 },
      params: {}, charPress: 'X',
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('X');
  });

  it('cancel() does not invoke onCommit', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    overlay.open({
      editorName: 'text', rowData: {}, colId: 'a', value: 'x',
      cellBounds: { x: 0, y: 0, w: 50, h: 20 }, params: {}, charPress: null,
      onCommit, onCancel,
    });
    overlay.cancel();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('Enter keystroke inside the editor commits via stopEditing', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    const onCommit = vi.fn();
    overlay.open({
      editorName: 'text', rowData: {}, colId: 'a', value: 'old',
      cellBounds: { x: 0, y: 0, w: 50, h: 20 }, params: {}, charPress: null,
      onCommit, onCancel: vi.fn(),
    });
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'new';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCommit).toHaveBeenCalledWith('new');
    expect(overlay.isOpen()).toBe(false);
  });

  it('dispatches to PopupHost when editor.isPopup() returns true', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    overlay.open({
      // 'largeText' editor returns isPopup() === true by default.
      editorName: 'largeText', rowData: {}, colId: 'notes', value: 'hello',
      cellBounds: { x: 5, y: 10, w: 80, h: 22 }, params: {}, charPress: null,
      viewportBounds: { width: 800, height: 600 },
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    // PopupHost mounts the textarea directly on the host (not inside a
    // vg-editor-overlay wrapper). Inline mode would put a wrapper between
    // the host and the gui; popup mode does not.
    const wrapper = host.querySelector('.vg-editor-overlay');
    expect(wrapper).toBeNull();
    const ta = host.querySelector('textarea.vg-cell-editor--large-text') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.parentElement).toBe(host);
    expect(ta.style.position).toBe('absolute');
  });

  it('dispatches to PopupHost when col-def opts.cellEditorPopup is true (text editor)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    overlay.open({
      // 'text' editor never returns isPopup() true on its own; the col-def
      // flag must be the dispatcher.
      editorName: 'text', rowData: {}, colId: 'a', value: 'x',
      cellBounds: { x: 0, y: 0, w: 60, h: 20 }, params: {}, charPress: null,
      cellEditorPopup: true,
      viewportBounds: { width: 800, height: 600 },
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    const wrapper = host.querySelector('.vg-editor-overlay');
    expect(wrapper).toBeNull();
    const input = host.querySelector('input.vg-cell-editor--text') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.parentElement).toBe(host);
  });

  it('close() in popup mode removes the gui from the host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    overlay.open({
      editorName: 'largeText', rowData: {}, colId: 'notes', value: '',
      cellBounds: { x: 0, y: 0, w: 80, h: 22 }, params: {}, charPress: null,
      viewportBounds: { width: 800, height: 600 },
      onCommit: vi.fn(), onCancel: vi.fn(),
    });
    expect(host.querySelector('textarea.vg-cell-editor--large-text')).not.toBeNull();
    overlay.close();
    expect(host.querySelector('textarea.vg-cell-editor--large-text')).toBeNull();
  });

  it('Escape keystroke inside the editor cancels via stopEditing', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    overlay.open({
      editorName: 'text', rowData: {}, colId: 'a', value: 'old',
      cellBounds: { x: 0, y: 0, w: 50, h: 20 }, params: {}, charPress: null,
      onCommit, onCancel,
    });
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(overlay.isOpen()).toBe(false);
  });

  it('marks the wrapper with the Excel mode class + flips via setMode', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    const overlay = new EditorOverlay(host, reg);
    overlay.open({
      editorName: 'text', rowData: {}, colId: 'a', value: 'v',
      cellBounds: { x: 0, y: 0, w: 50, h: 20 }, params: {}, charPress: 'v',
      modeClass: 'enter', onCommit: vi.fn(), onCancel: vi.fn(),
    });
    const wrapper = host.querySelector('.vg-editor-overlay') as HTMLElement;
    expect(wrapper.classList.contains('vg-editor--enter')).toBe(true);
    // One-way promotion enter → edit.
    overlay.setMode('edit');
    expect(wrapper.classList.contains('vg-editor--enter')).toBe(false);
    expect(wrapper.classList.contains('vg-editor--edit')).toBe(true);
    overlay.close();
  });

  it('keeps the editor open + flags invalid when isValid() is false', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    // price32 rejects unparseable text via isValid().
    const overlay = new EditorOverlay(host, reg);
    const onCommit = vi.fn();
    overlay.open({
      editorName: 'price32', rowData: {}, colId: 'p', value: 101.5,
      cellBounds: { x: 0, y: 0, w: 50, h: 20 }, params: {}, charPress: null,
      modeClass: 'edit', onCommit, onCancel: vi.fn(),
    });
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = '101-99'; // out-of-range ticks → invalid
    overlay.commit();
    expect(onCommit).not.toHaveBeenCalled();
    expect(overlay.isOpen()).toBe(true);
    const wrapper = host.querySelector('.vg-editor-overlay') as HTMLElement;
    expect(wrapper.classList.contains('vg-editor--invalid')).toBe(true);
    // Correcting the value lets the commit through, clearing the flag.
    input.value = '101-16';
    overlay.commit();
    expect(onCommit).toHaveBeenCalledWith(101.5);
  });
});
