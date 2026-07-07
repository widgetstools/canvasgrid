// Grid Layouts — Phase B / B2: auto-template-on-edit.
//
// Editing an editable column attribute writes into that column's OWN template
// (`__cgridOwn:<colId>`, name `<colId>_template`, create-if-absent), referenced
// from the column's `templateIds` as the HIGHEST layer. Shared/applied
// templates are read-only reuse — an edit never mutates them (it forks to the
// column's own). The own template is itself reusable (apply it elsewhere).
// Spec §3.1; worklog B2.

import { describe, it, expect } from 'vitest';
import { CalcEngine } from '../src/calcEngine';

const OWN = (colId: string) => `__cgridOwn:${colId}`;

describe('CalcEngine.editColumn — auto-template-on-edit', () => {
  it('creates the column’s own template on first edit and references it from templateIds', () => {
    const calc = new CalcEngine();
    const res = calc.editColumn('price', { width: 120 }, { now: 10 });
    expect(res.ok).toBe(true);

    const own = calc.listTemplates().find((t) => t.id === OWN('price'));
    expect(own).toMatchObject({ id: OWN('price'), name: 'price_template', overrides: { width: 120 } });
    expect(own!.createdAt).toBe(10);
    expect(own!.updatedAt).toBe(10);

    const override = calc.getOverrides().find((o) => o.colId === 'price');
    expect(override!.templateIds).toContain(OWN('price'));
    expect(calc.resolvedPatchFor('price', 'number')).toEqual({ width: 120 });
  });

  it('merges successive edits into the one own template (cellStyle per-key, scalars last-wins)', () => {
    const calc = new CalcEngine();
    calc.editColumn('price', { cellStyle: { color: 'red' }, width: 100 }, { now: 1 });
    calc.editColumn('price', { cellStyle: { fontWeight: 'bold' }, width: 140 }, { now: 2 });

    const own = calc.listTemplates().find((t) => t.id === OWN('price'))!;
    expect(own.overrides).toEqual({ cellStyle: { color: 'red', fontWeight: 'bold' }, width: 140 });
    expect(own.createdAt).toBe(1); // preserved
    expect(own.updatedAt).toBe(2); // bumped
  });

  it('the own template wins over an applied shared template (cascade: shared → own)', () => {
    const calc = new CalcEngine();
    calc.saveTemplate({ id: 'shared', name: 'Shared', overrides: { width: 90, format: '#,##0' }, now: 1 });
    calc.applyTemplate('shared', ['price']);
    calc.editColumn('price', { width: 200 }, { now: 2 });

    const patch = calc.resolvedPatchFor('price', 'number');
    expect(patch).toMatchObject({ width: 200, valueFormatter: '#,##0' }); // own width wins, shared format shows through
  });

  it('editing NEVER mutates a shared template — it forks to the column’s own', () => {
    const calc = new CalcEngine();
    calc.saveTemplate({ id: 'shared', name: 'Shared', overrides: { width: 90 }, now: 1 });
    calc.applyTemplate('shared', ['price', 'qty']);
    calc.editColumn('price', { width: 200 }, { now: 2 });

    // Shared library entry untouched…
    expect(calc.listTemplates().find((t) => t.id === 'shared')!.overrides.width).toBe(90);
    // …so the OTHER consumer of the shared template is unaffected.
    expect(calc.resolvedPatchFor('qty', 'number')).toEqual({ width: 90 });
    expect(calc.resolvedPatchFor('price', 'number')).toEqual({ width: 200 });
  });

  it('keeps the own template highest even when a shared template is applied AFTER the edit', () => {
    const calc = new CalcEngine();
    calc.saveTemplate({ id: 'shared', name: 'Shared', overrides: { width: 90 }, now: 1 });
    calc.editColumn('price', { width: 200 }, { now: 2 });
    calc.applyTemplate('shared', ['price']); // appended after own → own must still win

    expect(calc.resolvedPatchFor('price', 'number')).toEqual({ width: 200 });
  });

  it('the auto-created own template is reusable on another column', () => {
    const calc = new CalcEngine();
    calc.editColumn('price', { width: 200, cellStyle: { color: 'red' } }, { now: 1 });
    calc.applyTemplate(OWN('price'), ['qty']);

    expect(calc.resolvedPatchFor('qty', 'number')).toEqual({ width: 200, cellStyle: { color: 'red' } });
  });

  it('rejects a non-compiling format without creating / mutating the own template', () => {
    const calc = new CalcEngine();
    const res = calc.editColumn('price', { format: '#,##0' }, { now: 1 });
    expect(res.ok).toBe(true);
    const bad = calc.editColumn('price', { format: '0;0;0;0;0' }, { now: 2 }); // >4 sections → invalid
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatchObject({ colId: 'price', code: 'format-compile' });
    // The good format from the first edit is preserved (bad edit was atomic).
    expect(calc.listTemplates().find((t) => t.id === OWN('price'))!.overrides.format).toBe('#,##0');
  });

  it('never templates headerName (caption is column-unique)', () => {
    const calc = new CalcEngine();
    calc.editColumn('price', { headerName: 'PRICE', width: 120 } as any, { now: 1 });
    const own = calc.listTemplates().find((t) => t.id === OWN('price'))!;
    expect(own.overrides).toEqual({ width: 120 }); // headerName dropped
  });
});

// ─── headerStyle (CGridExt formatting toolbar: Header target) ──────────────
// headerStyle rides the same own-template plumbing as cellStyle: per-key
// merge across successive edits, template-chain fold, and pass-through to
// the kernel patch (kernel CColDef.headerStyle, ColCellOverrides vocabulary).
describe('CalcEngine.editColumn — headerStyle', () => {
  it('merges per-key across edits and reaches resolvedPatchFor', () => {
    const calc = new CalcEngine();
    calc.editColumn('price', { headerStyle: { bg: '#12333a' } }, { now: 1 });
    calc.editColumn('price', { headerStyle: { fg: '#4fd1c5' }, cellStyle: { fontWeight: 'bold' } }, { now: 2 });

    const own = calc.listTemplates().find((t) => t.id === OWN('price'))!;
    expect(own.overrides).toEqual({
      headerStyle: { bg: '#12333a', fg: '#4fd1c5' },
      cellStyle: { fontWeight: 'bold' },
    });
    expect(calc.resolvedPatchFor('price', 'number')).toEqual({
      headerStyle: { bg: '#12333a', fg: '#4fd1c5' },
      cellStyle: { fontWeight: 'bold' },
    });
  });

  it('folds through shared templates (own wins per-key)', () => {
    const calc = new CalcEngine();
    calc.saveTemplate({ id: 'shared', name: 'Shared', overrides: { headerStyle: { bg: '#000000', fontWeight: 'bold' } }, now: 1 });
    calc.applyTemplate('shared', ['price']);
    calc.editColumn('price', { headerStyle: { bg: '#12333a' } }, { now: 2 });
    expect(calc.resolvedPatchFor('price', 'number')).toEqual({
      headerStyle: { bg: '#12333a', fontWeight: 'bold' }, // own bg wins, shared weight survives
    });
  });
});
