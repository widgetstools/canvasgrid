import type { CellEditorCtor } from './iCellEditor';
import { TextCellEditor } from './builtins/text';
import { NumberCellEditor } from './builtins/number';
import { DateCellEditor } from './builtins/date';
import { DateStringCellEditor } from './builtins/dateString';
import { SelectCellEditor } from './builtins/select';
import { LargeTextCellEditor } from './builtins/largeText';
import { CheckboxCellEditor } from './builtins/checkbox';

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
    reg.register('number', NumberCellEditor);
    reg.register('date', DateCellEditor);
    reg.register('dateString', DateStringCellEditor);
    reg.register('select', SelectCellEditor as unknown as CellEditorCtor);
    reg.register('largeText', LargeTextCellEditor);
    reg.register('checkbox', CheckboxCellEditor);
  }
}
