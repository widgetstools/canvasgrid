import { describe, it, expect } from 'vitest';
import type { ColDef, ColGroupDef } from 'ag-grid-community';
import { columnDefs, GROUP_IDS } from './columnDefs';

type AnyCol = ColDef | ColGroupDef;
const isGroup = (c: AnyCol): c is ColGroupDef => 'children' in c;
const groupById = (id: string): ColGroupDef => {
  const g = columnDefs.find((c) => isGroup(c) && c.groupId === id);
  if (!g || !isGroup(g)) throw new Error(`group ${id} not found`);
  return g;
};
const leaf = (g: ColGroupDef, field: string): ColDef => {
  const c = (g.children as AnyCol[]).find((x) => !isGroup(x) && (x as ColDef).field === field);
  if (!c) throw new Error(`leaf ${field} not found in ${g.groupId}`);
  return c as ColDef;
};

describe('columnDefs structure', () => {
  it('has a flat pinned Position ID column with no group', () => {
    const idCol = columnDefs.find((c) => !isGroup(c) && (c as ColDef).field === 'positionId') as ColDef;
    expect(idCol).toBeTruthy();
    expect(idCol.pinned).toBe('left');
  });

  it('GROUP_IDS lists all six top-level groups in order', () => {
    expect(GROUP_IDS).toEqual([
      'grp-instrument',
      'grp-coverage',
      'grp-valuation',
      'grp-pnl',
      'grp-risk',
      'grp-metadata',
    ]);
  });

  it('Instrument group is fields-only and not open-by-default (no caret)', () => {
    const g = groupById('grp-instrument');
    expect(g.openByDefault).toBeUndefined();
    for (const child of g.children as ColDef[]) {
      expect((child as ColDef).columnGroupShow).toBeUndefined();
    }
  });

  it('Coverage group is closed by default with always/open/closed leaves', () => {
    const g = groupById('grp-coverage');
    expect(g.openByDefault).toBe(false);
    expect(leaf(g, 'book').columnGroupShow).toBeUndefined();
    expect(leaf(g, 'desk').columnGroupShow).toBe('open');
    expect(leaf(g, 'trader').columnGroupShow).toBe('open');
    expect(leaf(g, 'region').columnGroupShow).toBe('closed');
  });

  it('Valuation group is open by default', () => {
    const g = groupById('grp-valuation');
    expect(g.openByDefault).toBe(true);
    expect(leaf(g, 'price').columnGroupShow).toBeUndefined();
    expect(leaf(g, 'mtm').columnGroupShow).toBe('open');
    expect(leaf(g, 'prevClose').columnGroupShow).toBe('closed');
  });

  it('P&L group reveals the three pnl columns only when open', () => {
    const g = groupById('grp-pnl');
    expect(leaf(g, 'marketValue').columnGroupShow).toBeUndefined();
    for (const f of ['dayPnl', 'mtdPnl', 'ytdPnl']) {
      expect(leaf(g, f).columnGroupShow).toBe('open');
    }
  });

  it('Risk group mixes leaf fields AND nested sub-groups, each with a state', () => {
    const g = groupById('grp-risk');
    expect(g.marryChildren).toBe(true);
    // leaf fields in three states
    expect(leaf(g, 'dv01').columnGroupShow).toBeUndefined();
    expect(leaf(g, 'cr01').columnGroupShow).toBe('open');
    expect(leaf(g, 'duration').columnGroupShow).toBe('closed');
    // nested sub-groups in three states
    const subs = (g.children as AnyCol[]).filter(isGroup) as ColGroupDef[];
    const byId = (id: string) => subs.find((s) => s.groupId === id)!;
    expect(byId('grp-exposure').columnGroupShow).toBeUndefined();
    expect(byId('grp-greeks').columnGroupShow).toBe('open');
    expect(byId('grp-scenario').columnGroupShow).toBe('closed');
    // sub-group leaves exist
    expect((byId('grp-greeks').children as ColDef[]).map((c) => c.field)).toEqual(
      ['delta', 'gamma', 'vega', 'theta'],
    );
  });

  it('Metadata group marries its always-visible children', () => {
    const g = groupById('grp-metadata');
    expect(g.marryChildren).toBe(true);
    for (const child of g.children as ColDef[]) {
      expect((child as ColDef).columnGroupShow).toBeUndefined();
    }
  });
});
