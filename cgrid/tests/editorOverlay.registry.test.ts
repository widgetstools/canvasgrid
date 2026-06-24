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
    expect(host.querySelector('input.cg-cell-editor--text')).not.toBeNull();
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'new';
    overlay.commit();
    expect(onCommit).toHaveBeenCalledWith('new');
    overlay.close();
    expect(host.querySelector('input.cg-cell-editor--text')).toBeNull();
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
});
