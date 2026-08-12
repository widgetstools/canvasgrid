import { describe, it, expect } from 'vitest';
import { CellEditorRegistry } from '../src/interaction/editors/registry';
import type { ICellEditor, ICellEditorParams } from '../src/interaction/editors/iCellEditor';

class StubEditor implements ICellEditor {
  private val: unknown = null;
  init(p: ICellEditorParams) { this.val = p.value; }
  getGui() { return document.createElement('input'); }
  getValue() { return this.val; }
  destroy() {}
}

describe('CellEditorRegistry', () => {
  it('seeds the built-in "text" editor', () => {
    const reg = new CellEditorRegistry();
    CellEditorRegistry.seed(reg);
    expect(reg.has('text')).toBe(true);
  });

  it('register + resolve round-trips a custom editor', () => {
    const reg = new CellEditorRegistry();
    reg.register('my-custom', StubEditor);
    const Ctor = reg.resolve('my-custom');
    const inst = new Ctor();
    inst.init({
      data: {}, colId: 'a', value: 7, charPress: null,
      params: {}, cellBounds: { x: 0, y: 0, w: 0, h: 0 },
      stopEditing: () => {},
    });
    expect(inst.getValue()).toBe(7);
  });

  it('throws on resolve of unknown name with a descriptive message', () => {
    const reg = new CellEditorRegistry();
    expect(() => reg.resolve('nope')).toThrow(/cellEditor.*'nope'.*not registered/i);
  });

  it('overwrites an existing name on re-register (last wins)', () => {
    const reg = new CellEditorRegistry();
    class A extends StubEditor {}
    class B extends StubEditor {}
    reg.register('x', A);
    reg.register('x', B);
    expect(reg.resolve('x')).toBe(B);
  });
});
