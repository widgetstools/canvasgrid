import { describe, it, expect, vi } from 'vitest';
import { EditorOverlay } from '../src/interaction/editorOverlay';

const cd: any = { colId: 'c', headerName: 'C', type: 'text', cellRenderer: 'text', cellEditor: 'text', sortable: true, resizable: true, editable: true, minWidth: 30, maxWidth: Infinity };

describe('EditorOverlay', () => {
  it('opens an <input> and seeds the initial value', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const overlay = new EditorOverlay();
    overlay.open({
      container: root, bounds: { x: 10, y: 20, w: 100, h: 30 },
      colDef: cd, initialValue: 'hi',
      onCommit: () => {}, onCancel: () => {},
    });
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('hi');
  });

  it('commits on Enter', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const onCommit = vi.fn();
    const overlay = new EditorOverlay();
    overlay.open({
      container: root, bounds: { x: 0, y: 0, w: 100, h: 30 },
      colDef: cd, initialValue: 'a',
      onCommit, onCancel: () => {},
    });
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'b';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCommit).toHaveBeenCalledWith('b');
    expect(overlay.isOpen()).toBe(false);
  });

  it('cancels on Escape', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const overlay = new EditorOverlay();
    overlay.open({
      container: root, bounds: { x: 0, y: 0, w: 100, h: 30 },
      colDef: cd, initialValue: 'a',
      onCommit, onCancel,
    });
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'b';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('number editor type=number', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const overlay = new EditorOverlay();
    overlay.open({
      container: root, bounds: { x: 0, y: 0, w: 100, h: 30 },
      colDef: { ...cd, cellEditor: 'number' },
      initialValue: 42, onCommit: () => {}, onCancel: () => {},
    });
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('number');
  });
});
