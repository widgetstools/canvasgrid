// Grid Layouts — Phase B / B3: engine additions behind the VelocityGridApi
// template surface — `renameTemplate` (grid-wide unique name) and
// `removeTemplate(colId, templateId)` (unassign a template from a column).
//
// The existing template ops (saveTemplate/deleteTemplate/listTemplates/
// applyTemplate) are covered by templates.test.ts + calcEngine.test.ts;
// this file covers ONLY the two B3 additions.
import { describe, expect, it } from 'vitest';
import { CalcEngine } from '../src/calcEngine';

function seed(): CalcEngine {
  const calc = new CalcEngine({});
  calc.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' }, now: 1_000 });
  return calc;
}

describe('CalcEngine.renameTemplate — grid-wide unique name', () => {
  it('renames, preserving createdAt and bumping updatedAt', () => {
    const calc = seed();
    calc.renameTemplate('money', 'Currency', { now: 2_000 });
    const t = calc.listTemplates().find((x) => x.id === 'money')!;
    expect(t.name).toBe('Currency');
    expect(t.createdAt).toBe(1_000); // preserved
    expect(t.updatedAt).toBe(2_000); // bumped
    expect(t.overrides).toEqual({ format: '#,##0.00' }); // untouched
  });

  it('throws on an unknown template id', () => {
    const calc = seed();
    expect(() => calc.renameTemplate('nope', 'X', { now: 2_000 })).toThrow(/not found/);
  });

  it('throws on an empty / whitespace name', () => {
    const calc = seed();
    expect(() => calc.renameTemplate('money', '   ', { now: 2_000 })).toThrow();
  });

  it('rejects a name already used by another template (case-insensitive, trimmed)', () => {
    const calc = seed();
    calc.saveTemplate({ id: 'compact', name: 'Compact', overrides: { width: 90 }, now: 1_000 });
    expect(() => calc.renameTemplate('compact', '  money  ', { now: 2_000 })).toThrow(/in use/);
    // unchanged after the failed rename
    expect(calc.listTemplates().find((x) => x.id === 'compact')!.name).toBe('Compact');
  });

  it('allows renaming a template to its own current name (no-op-safe)', () => {
    const calc = seed();
    expect(() => calc.renameTemplate('money', 'Money', { now: 2_000 })).not.toThrow();
    expect(calc.listTemplates().find((x) => x.id === 'money')!.name).toBe('Money');
  });
});

describe('CalcEngine.removeTemplate — unassign a template from a column', () => {
  it('drops the template id from that column’s templateIds chain', () => {
    const calc = seed();
    calc.saveTemplate({ id: 'compact', name: 'Compact', overrides: { width: 90 }, now: 1_000 });
    calc.applyTemplate('money', ['px']);
    calc.applyTemplate('compact', ['px']);
    expect(calc.getOverrides().find((o) => o.colId === 'px')!.templateIds).toEqual(['money', 'compact']);

    calc.removeTemplate('px', 'money');
    expect(calc.getOverrides().find((o) => o.colId === 'px')!.templateIds).toEqual(['compact']);
  });

  it('leaves an explicit empty chain ([]) when the last template is removed (opts out of typeDefault)', () => {
    const calc = seed();
    calc.applyTemplate('money', ['px']);
    calc.removeTemplate('px', 'money');
    expect(calc.getOverrides().find((o) => o.colId === 'px')!.templateIds).toEqual([]);
  });

  it('is a no-op when the column has no override', () => {
    const calc = seed();
    calc.removeTemplate('px', 'money');
    expect(calc.getOverrides()).toEqual([]);
  });

  it('is a no-op when the id is not in the column’s chain', () => {
    const calc = seed();
    calc.applyTemplate('money', ['px']);
    calc.removeTemplate('px', 'compact'); // not assigned
    expect(calc.getOverrides().find((o) => o.colId === 'px')!.templateIds).toEqual(['money']);
  });

  it('does not affect OTHER columns that reference the same template', () => {
    const calc = seed();
    calc.applyTemplate('money', ['px', 'qty']);
    calc.removeTemplate('px', 'money');
    expect(calc.getOverrides().find((o) => o.colId === 'px')!.templateIds).toEqual([]);
    expect(calc.getOverrides().find((o) => o.colId === 'qty')!.templateIds).toEqual(['money']);
  });
});

describe('CalcEngine.saveTemplate — caption is never templated (M6)', () => {
  it('strips headerName from a template’s overrides regardless of entry path', () => {
    const calc = new CalcEngine({});
    calc.saveTemplate({ id: 't', name: 'T', overrides: { headerName: 'Foo', width: 90 } as any, now: 1 });
    const stored = calc.listTemplates().find((x) => x.id === 't')!;
    expect(stored.overrides).toEqual({ width: 90 }); // headerName dropped
    expect((stored.overrides as any).headerName).toBeUndefined();
  });
});

describe('CalcEngine.clearOverrides — drop the entire override layer (B4 module restore)', () => {
  it('removes all column overrides', () => {
    const calc = seed();
    calc.applyTemplate('money', ['px', 'qty']);
    expect(calc.getOverrides()).toHaveLength(2);
    calc.clearOverrides();
    expect(calc.getOverrides()).toEqual([]);
  });

  it('is a no-op when there are no overrides', () => {
    const calc = seed();
    expect(() => calc.clearOverrides()).not.toThrow();
    expect(calc.getOverrides()).toEqual([]);
  });

  it('supports clear-then-reapply REPLACE semantics (module restore)', () => {
    const calc = seed();
    calc.applyOverrides([{ colId: 'a', width: 80 }, { colId: 'b', width: 90 }]);
    calc.clearOverrides();
    calc.applyOverrides([{ colId: 'c', templateIds: ['money'] }]);
    expect(calc.getOverrides().map((o) => o.colId)).toEqual(['c']);
  });
});
