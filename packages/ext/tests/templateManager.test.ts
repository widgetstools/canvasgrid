import { describe, it, expect, afterEach, vi } from 'vitest';
import { ownTemplateId, type ColumnTemplate } from '@wellsfargo-starui/velocity-grid/calc';
import {
  activeLibraryTemplateId,
  applyLibraryTemplate,
  buildTemplateManagerPanel,
  capturableFieldLabels,
  libraryTemplates,
  snapshotOwnOverrides,
  templateManagerMenu,
  type TemplateManagerGrid,
  type TemplateManagerHost,
} from '../src/toolbar/templateManager';

afterEach(() => { document.body.replaceChildren(); });

function tpl(partial: Partial<ColumnTemplate> & Pick<ColumnTemplate, 'id' | 'name'>): ColumnTemplate {
  return {
    description: '',
    overrides: {},
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

class FakeTplGrid implements TemplateManagerGrid {
  templates: ColumnTemplate[] = [];
  /** colId → template id chain (own + library). */
  assignments = new Map<string, string[]>();

  getTemplates(): ColumnTemplate[] {
    return this.templates;
  }
  getState() {
    return {
      modules: {
        columnOverrides: {
          data: [...this.assignments.entries()].map(([colId, templateIds]) => ({ colId, templateIds })),
        },
      },
    };
  }
  saveTemplate(spec: { id: string; name: string; overrides: ColumnTemplate['overrides'] }): void {
    const i = this.templates.findIndex((t) => t.id === spec.id);
    const next = tpl({ id: spec.id, name: spec.name, overrides: structuredClone(spec.overrides) });
    if (i >= 0) this.templates[i] = next;
    else this.templates.push(next);
  }
  renameTemplate(templateId: string, name: string): void {
    const t = this.templates.find((x) => x.id === templateId);
    if (t) t.name = name;
  }
  deleteTemplate(templateId: string): void {
    this.templates = this.templates.filter((t) => t.id !== templateId);
    for (const [colId, ids] of this.assignments) {
      this.assignments.set(colId, ids.filter((id) => id !== templateId));
    }
  }
  applyTemplate(colId: string, templateId: string): void {
    const cur = this.assignments.get(colId) ?? [];
    if (!cur.includes(templateId)) this.assignments.set(colId, [...cur, templateId]);
  }
  removeTemplate(colId: string, templateId: string): void {
    const cur = this.assignments.get(colId) ?? [];
    this.assignments.set(colId, cur.filter((id) => id !== templateId));
  }
}

function mountPanel(host?: Partial<TemplateManagerHost> & { grid?: FakeTplGrid }) {
  const grid = host?.grid ?? new FakeTplGrid();
  const close = vi.fn();
  const onApplied = vi.fn();
  const h: TemplateManagerHost = {
    targetCols: host?.targetCols ?? (() => ['px']),
    grid,
    defaultSaveName: host?.defaultSaveName ?? (() => 'Price Style'),
    onApplied: host?.onApplied ?? onApplied,
  };
  const panel = buildTemplateManagerPanel(h, close);
  document.body.appendChild(panel);
  return { panel, host: h, grid, close, onApplied };
}

describe('libraryTemplates / activeLibraryTemplateId', () => {
  it('lists host templates A→Z and skips own forks', () => {
    const g = new FakeTplGrid();
    g.templates = [
      tpl({ id: 'b', name: 'Zebra' }),
      tpl({ id: ownTemplateId('px'), name: 'px_template', overrides: { format: '#,##0' } }),
      tpl({ id: 'a', name: 'Alpha' }),
    ];
    expect(libraryTemplates(g).map((t) => t.name)).toEqual(['Alpha', 'Zebra']);
  });

  it('reads the first non-own template id on a column', () => {
    const g = new FakeTplGrid();
    g.assignments.set('px', [ownTemplateId('px'), 'lib-1']);
    expect(activeLibraryTemplateId(g, 'px')).toBe('lib-1');
    expect(activeLibraryTemplateId(g, 'missing')).toBeUndefined();
  });
});

describe('snapshotOwnOverrides / capturableFieldLabels', () => {
  it('clones own overrides and labels capturable slices', () => {
    const g = new FakeTplGrid();
    g.templates = [
      tpl({
        id: ownTemplateId('px'),
        name: 'px_template',
        overrides: { cellStyle: { fg: '#fff' }, format: '#,##0.00' },
      }),
    ];
    const snap = snapshotOwnOverrides(g, 'px')!;
    expect(snap.format).toBe('#,##0.00');
    expect(snap).not.toBe(g.templates[0]!.overrides);
    expect(capturableFieldLabels(snap)).toEqual(['Cell style', 'Formatter']);
    expect(capturableFieldLabels(null)).toEqual([]);
  });
});

describe('applyLibraryTemplate', () => {
  it('clears own fork + other library refs, then applies', () => {
    const g = new FakeTplGrid();
    const own = ownTemplateId('px');
    g.templates = [
      tpl({ id: own, name: 'px_template', overrides: { format: '0%' } }),
      tpl({ id: 'lib-a', name: 'A' }),
      tpl({ id: 'lib-b', name: 'B' }),
    ];
    g.assignments.set('px', [own, 'lib-a']);
    applyLibraryTemplate(g, ['px'], 'lib-b');
    expect(g.templates.find((t) => t.id === own)).toBeUndefined();
    expect(g.assignments.get('px')).toEqual(['lib-b']);
  });
});

describe('template manager panel', () => {
  it('empty library shows a hint; save disabled without selection', () => {
    const { panel } = mountPanel({ targetCols: () => [] });
    expect(panel.querySelector('.vgext-tpl-empty')!.textContent).toContain('Select a cell');
    expect(panel.querySelector<HTMLInputElement>('.vgext-tpl-save-input')!.disabled).toBe(true);
  });

  it('lists templates and apply closes + notifies', () => {
    const grid = new FakeTplGrid();
    grid.templates = [tpl({ id: 't1', name: 'Bold Price', overrides: { cellStyle: { fontWeight: 'bold' } } })];
    const { panel, close, onApplied } = mountPanel({ grid });
    expect(panel.querySelector('.vgext-tpl-name')!.textContent).toBe('Bold Price');
    panel.querySelector<HTMLElement>('.vgext-tpl-row')!.click();
    expect(grid.assignments.get('px')).toEqual(['t1']);
    expect(onApplied).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('save-as snapshots own overrides, applies, and flashes', () => {
    const grid = new FakeTplGrid();
    grid.templates = [
      tpl({
        id: ownTemplateId('px'),
        name: 'px_template',
        overrides: { format: '$#,##0.00', cellStyle: { fg: '#0a0' } },
      }),
    ];
    const { panel, onApplied } = mountPanel({ grid });
    expect(panel.querySelector('.vgext-tpl-hint')!.textContent).toContain('Will save:');
    const input = panel.querySelector<HTMLInputElement>('.vgext-tpl-save-input')!;
    input.value = 'Money';
    input.dispatchEvent(new Event('input'));
    panel.querySelector<HTMLButtonElement>('.vgext-tpl-save .vgext-tpl-iconbtn')!.click();
    expect(onApplied).toHaveBeenCalled();
    const saved = grid.templates.find((t) => t.name === 'Money');
    expect(saved?.overrides.format).toBe('$#,##0.00');
    expect(grid.assignments.get('px')).toContain(saved!.id);
  });

  it('two-step delete removes the library template', () => {
    const grid = new FakeTplGrid();
    grid.templates = [tpl({ id: 't1', name: 'Doomed' })];
    const { panel, onApplied } = mountPanel({ grid });
    const row = panel.querySelector<HTMLElement>('.vgext-tpl-row')!;
    const trash = row.querySelectorAll<HTMLButtonElement>('.vgext-tpl-iconbtn.is-danger')[0]!;
    trash.click();
    // Confirm button appears after pending delete.
    const confirm = panel.querySelectorAll<HTMLButtonElement>('.vgext-tpl-iconbtn.is-danger')[0]!;
    confirm.click();
    expect(grid.templates.find((t) => t.id === 't1')).toBeUndefined();
    expect(onApplied).toHaveBeenCalled();
  });

  it('templateManagerMenu mounts under .vgext-menu.vgext-tpl-menu', () => {
    const grid = new FakeTplGrid();
    grid.templates = [tpl({ id: 't1', name: 'X' })];
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const m = templateManagerMenu(anchor, {
      targetCols: () => ['px'],
      grid,
      defaultSaveName: () => 'Style',
      onApplied: () => {},
    });
    m.toggle();
    expect(document.querySelector('.vgext-menu.vgext-tpl-menu')).not.toBeNull();
    m.destroy();
  });
});
