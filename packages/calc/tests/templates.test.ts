import { describe, expect, it } from 'vitest';
import { foldTemplateChain } from '../src/templates';
import type { ColumnOverride, ColumnTemplate } from '../src/types';

function tpl(id: string, overrides: ColumnTemplate['overrides']): ColumnTemplate {
  return { id, name: id, overrides, createdAt: 1, updatedAt: 1 };
}

describe('foldTemplateChain — precedence', () => {
  it('bare assignment with no templates folds to itself', () => {
    const merged = foldTemplateChain(null, [], { colId: 'px', headerName: 'Px', width: 90 });
    expect(merged).toEqual({ colId: 'px', headerName: 'Px', width: 90 });
  });

  it('scalar precedence: typeDefault < t1 < t2 < assignment', () => {
    const merged = foldTemplateChain(
      tpl('base', { width: 80, headerName: 'FROM-TYPE-DEFAULT' }),
      [tpl('t1', { width: 100 }), tpl('t2', { width: 110 })],
      { colId: 'px', width: 120 },
    );
    expect(merged.width).toBe(120);                       // assignment wins
    expect(merged.headerName).toBe('FROM-TYPE-DEFAULT');  // untouched by later layers → survives
  });

  it('template layers win over the typeDefault when the assignment is silent', () => {
    const merged = foldTemplateChain(
      tpl('base', { width: 80 }),
      [tpl('t1', { width: 100 }), tpl('t2', { width: 110 })],
      { colId: 'px' },
    );
    expect(merged.width).toBe(110);                       // last template wins
  });

  it('scalar fields replace wholesale (format last-writer-wins)', () => {
    const merged = foldTemplateChain(
      null,
      [tpl('t1', { format: '0.00' }), tpl('t2', { format: '0%' })],
      { colId: 'px' },
    );
    expect(merged.format).toBe('0%');
  });

  it('undefined in a later layer never clobbers an earlier value', () => {
    const merged = foldTemplateChain(
      null,
      [tpl('t1', { width: 100, cellRenderer: 'spark' }), tpl('t2', { headerName: 'H2' })],
      { colId: 'px' },
    );
    expect(merged.width).toBe(100);
    expect(merged.cellRenderer).toBe('spark');
    expect(merged.headerName).toBe('H2');
  });

  it('DEFINED falsy wins (editable: false / hide: false overwrite earlier true)', () => {
    const merged = foldTemplateChain(
      null,
      [tpl('t1', { editable: true, hide: true })],
      { colId: 'px', editable: false, hide: false },
    );
    expect(merged.editable).toBe(false);
    expect(merged.hide).toBe(false);
  });
});

describe('foldTemplateChain — per-key style merge', () => {
  it('cellStyle merges per-key across all four layers', () => {
    const merged = foldTemplateChain(
      tpl('base', { cellStyle: { color: 'red', fontWeight: 'bold' } }),
      [
        tpl('t1', { cellStyle: { backgroundColor: 'black' } }),
        tpl('t2', { cellStyle: { color: 'blue' } }),          // overwrites ONLY color
      ],
      { colId: 'px', cellStyle: { textAlign: 'right' } },
    );
    expect(merged.cellStyle).toEqual({
      color: 'blue',              // t2 wins the key
      fontWeight: 'bold',         // typeDefault key survives
      backgroundColor: 'black',   // t1 key survives
      textAlign: 'right',         // assignment key added
    });
  });

  it('a layer without cellStyle leaves the merged style untouched', () => {
    const merged = foldTemplateChain(
      null,
      [tpl('t1', { cellStyle: { color: 'red' } }), tpl('t2', { width: 100 })],
      { colId: 'px' },
    );
    expect(merged.cellStyle).toEqual({ color: 'red' });
  });
});

describe('foldTemplateChain — output shape', () => {
  it('carries assignment.colId and never a templateIds key', () => {
    const merged = foldTemplateChain(null, [tpl('t1', { width: 90 })], {
      colId: 'px', templateIds: ['t1'],
    });
    expect(merged.colId).toBe('px');
    expect('templateIds' in merged).toBe(false);
  });

  it('does not mutate its inputs', () => {
    const t1 = tpl('t1', { cellStyle: { color: 'red' } });
    const assignment: ColumnOverride = { colId: 'px', cellStyle: { textAlign: 'right' } };
    foldTemplateChain(null, [t1], assignment);
    expect(t1.overrides.cellStyle).toEqual({ color: 'red' });
    expect(assignment.cellStyle).toEqual({ textAlign: 'right' });
  });
});
