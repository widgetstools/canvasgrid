// Ribbon quick column configuration — Task 1: column-config def flags ride
// the own-template pipeline exactly like editable/hide/width. Mirrors the
// local fixture idiom of autoTemplateOnEdit.test.ts / calcEngine.test.ts:
// a bare engine + resolvedPatchFor readback; saveTemplate takes a single
// `{ ..., now }` object, applyTemplate takes `(templateId, colIds[])`.

import { describe, it, expect } from 'vitest';
import { CalcEngine } from '../src/calcEngine';

const makeEngine = () => new CalcEngine();

describe('editColumn — column-config def flags', () => {
  it('merges every flag into the own template and resolvedPatchFor forwards them', () => {
    const e = makeEngine();
    const res = e.editColumn('px', {
      floatingFilter: true,
      filter: 'set',
      enableRowGroup: true,
      enablePivot: false,
      sortable: false,
      resizable: false,
      suppressAggFuncInHeader: true,
    }, { now: 1 });
    expect(res.ok).toBe(true);
    const patch = e.resolvedPatchFor('px', 'number')!;
    expect(patch.floatingFilter).toBe(true);
    expect(patch.filter).toBe('set');
    expect(patch.enableRowGroup).toBe(true);
    expect(patch.enablePivot).toBe(false);   // defined-falsy must land
    expect(patch.sortable).toBe(false);
    expect(patch.resizable).toBe(false);
    expect(patch.suppressAggFuncInHeader).toBe(true);
  });

  it('filter: null removes the stored key (format/cellIcon parity)', () => {
    const e = makeEngine();
    e.editColumn('px', { filter: 'set' }, { now: 1 });
    expect(e.resolvedPatchFor('px', 'number')!.filter).toBe('set');
    e.editColumn('px', { filter: null }, { now: 2 });
    // Removing the only stored key leaves the own template empty —
    // resolvedPatchFor legitimately returns null here (format-null parity,
    // see autoTemplateOnEdit.test.ts), so read optionally rather than `!`.
    expect(e.resolvedPatchFor('px', 'number')?.filter).toBeUndefined();
  });

  it('flags fold through shared template chains (later layer wins, defined-falsy wins)', () => {
    const e = makeEngine();
    e.saveTemplate({ id: 't1', name: 'T1', overrides: { enableRowGroup: true, sortable: true }, now: 1 });
    e.applyTemplate('t1', ['px']);
    e.editColumn('px', { sortable: false }, { now: 2 }); // own template folds highest
    const patch = e.resolvedPatchFor('px', 'number')!;
    expect(patch.enableRowGroup).toBe(true);
    expect(patch.sortable).toBe(false);
  });

  it('partial patches leave unrelated flags untouched', () => {
    const e = makeEngine();
    e.editColumn('px', { floatingFilter: true }, { now: 1 });
    e.editColumn('px', { enableRowGroup: true }, { now: 2 });
    const patch = e.resolvedPatchFor('px', 'number')!;
    expect(patch.floatingFilter).toBe(true);
    expect(patch.enableRowGroup).toBe(true);
  });
});
