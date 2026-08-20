/**
 * Expressions — settings-sheet lab for the ExpressionEditor foundation.
 * Validates against leaf column fields from the live grid schema.
 */
import { defineChromeComponents, defineExpressionEditor } from '../customizer/index';
import type { Schema } from '@wellsfargo-starui/velocity-grid/expression';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';

function schemaFromGrid(grid: VelocityGridExtContext['grid']): Schema {
  const fields: Schema['fields'] = {};
  const walk = (defs: readonly unknown[]): void => {
    for (const d of defs) {
      const def = d as {
        colId?: string; field?: string; cellDataType?: string; children?: unknown[];
      };
      if (def.children?.length) { walk(def.children); continue; }
      const id = def.colId ?? def.field;
      if (!id) continue;
      const t = def.cellDataType;
      fields[id] =
        t === 'number' || t === 'boolean' || t === 'date' || t === 'text'
          ? (t === 'text' ? 'string' : t)
          : 'unknown';
    }
  };
  try { walk((grid.getGridOption('columnDefs') as unknown[]) ?? []); } catch { /* */ }
  return { fields };
}

export function expressionLabModule(): SettingsModule {
  return {
    id: 'expression-lab',
    kind: 'settings-module',
    title: 'Expressions',
    icon: 'sparkles',
    category: 'data',

    init(): void {
      defineChromeComponents();
      defineExpressionEditor();
    },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      const band = document.createElement('cgc-band');
      band.setAttribute('band-title', 'Expression');
      const field = document.createElement('cgc-field');
      field.setAttribute('label', 'Formula');
      field.setAttribute('hint', 'Uses @wellsfargo-starui/velocity-grid/expression — e.g. [pnl] > 0');

      const editor = document.createElement('cgc-expression-editor') as HTMLElement & {
        schema: Schema;
        value: string;
      };
      editor.schema = schemaFromGrid(ctx.grid);
      editor.value = '';
      editor.addEventListener('cgc-change', () => ctx.profiles.markDirty());

      field.appendChild(editor);
      band.appendChild(field);
      host.appendChild(band);

      return {
        destroy() { host.replaceChildren(); },
        refresh() { editor.schema = schemaFromGrid(ctx.grid); },
      };
    },
  };
}
