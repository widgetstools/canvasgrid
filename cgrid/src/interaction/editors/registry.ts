import type { CellEditorCtor } from './iCellEditor';
import { TextCellEditor } from './builtins/text';

export class CellEditorRegistry {
  private map = new Map<string, CellEditorCtor>();

  register(name: string, ctor: CellEditorCtor): void {
    this.map.set(name, ctor);
  }

  resolve(name: string): CellEditorCtor {
    const ctor = this.map.get(name);
    if (!ctor) {
      throw new Error(`[cgrid] cellEditor '${name}' is not registered`);
    }
    return ctor;
  }

  has(name: string): boolean { return this.map.has(name); }

  static seed(reg: CellEditorRegistry): void {
    reg.register('text', TextCellEditor);
    // Task 2 registers the remaining built-ins (number, date, dateString,
    // select, largeText, checkbox).
  }
}
