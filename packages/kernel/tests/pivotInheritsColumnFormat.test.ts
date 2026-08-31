import { describe, it, expect } from 'vitest';
import {
  synthesizePivotColumns,
  pickPivotInheritedProps,
  PIVOT_INHERITED_COLDEF_KEYS,
} from '../src/core/pivotColumns';
import type { PivotKeyNode } from '../src/worker/passes/pivotPass';

/**
 * A pivot result column inherits its source value column's presentation.
 *
 * Before this channel existed, a synthesized leaf was built from six
 * hard-coded properties — colId, headerName, cellDataType, aggFunc, sortable,
 * width — and nothing else. Pivot did not consume the resolved column
 * pipeline, it BYPASSED it, so the calc engine (which the format toolbar,
 * Column format… and Auto format all route through) had no way in at all. The
 * only escape hatch was the app hand-writing `processPivotResultColDef`.
 *
 * That is why formatting "worked sometimes": it worked right up until you
 * pivoted, and any fix applied to the primary pipeline was invisible on the
 * other side of the bypass.
 */

const KEY_TREE: PivotKeyNode[] = ['EMEA', 'AMER']
  .map((value) => ({ value, path: [value], children: [] })) as unknown as PivotKeyNode[];

const leafDefs = (out: { defs: unknown[] }): Record<string, any>[] => {
  const acc: Record<string, any>[] = [];
  const walk = (defs: any[]): void => {
    for (const d of defs) {
      if (d?.children?.length) { walk(d.children); continue; }
      acc.push(d);
    }
  };
  walk(out.defs as any[]);
  return acc;
};

function synth(inherit?: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return synthesizePivotColumns({
    keyTree: KEY_TREE,
    valueColumns: [{
      colId: 'pnl', aggFunc: 'sum', headerName: 'P&L', cellDataType: 'number', inherit,
    }],
    ...extra,
  });
}

describe('pickPivotInheritedProps', () => {
  it('takes the presentation properties', () => {
    const picked = pickPivotInheritedProps({
      valueFormatter: '$#,##0.00',
      cellStyle: { halign: 'right' },
      cellRenderer: 'bar',
      minWidth: 60,
    });
    expect(picked).toEqual({
      valueFormatter: '$#,##0.00',
      cellStyle: { halign: 'right' },
      cellRenderer: 'bar',
      minWidth: 60,
    });
  });

  it('refuses identity, layout state and role flags', () => {
    // Copying these across is what would break the cross-tab: a synthesized
    // leaf has its own colId, no field (its value comes from pivotValues),
    // and "can this be pivoted" is meaningless on a pivot result.
    const picked = pickPivotInheritedProps({
      colId: 'pnl', field: 'pnl', hide: true, pinned: 'left',
      enablePivot: true, enableRowGroup: true, rowGroup: true,
      width: 300, sortable: false, aggFunc: 'avg',
      valueFormatter: '#,##0',
    });
    expect(picked).toEqual({ valueFormatter: '#,##0' });
  });

  it('omits undefined rather than writing it', () => {
    // An explicit `undefined` would overwrite a synthesized default with
    // nothing when spread.
    expect(pickPivotInheritedProps({ valueFormatter: undefined })).toEqual({});
    expect(pickPivotInheritedProps(null)).toEqual({});
    expect(pickPivotInheritedProps(undefined)).toEqual({});
  });

  it('every allow-listed key is a real ColDef property', () => {
    // Guards against a typo silently dropping a property forever.
    expect(new Set(PIVOT_INHERITED_COLDEF_KEYS).size).toBe(PIVOT_INHERITED_COLDEF_KEYS.length);
  });
});

describe('synthesized leaves', () => {
  it('carry the inherited formatter onto every pivot result column', () => {
    const out = synth({ valueFormatter: '$#,##0.00' });
    const leaves = leafDefs(out).filter((d) => String(d.colId).startsWith('pivotcol'));
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) expect(leaf.valueFormatter).toBe('$#,##0.00');
  });

  it('carry inherited cell styling too', () => {
    const out = synth({ cellStyle: { halign: 'left' }, cellClass: 'pnl-cell' });
    for (const leaf of leafDefs(out).filter((d) => String(d.colId).startsWith('pivotcol'))) {
      expect(leaf.cellStyle).toEqual({ halign: 'left' });
      expect(leaf.cellClass).toBe('pnl-cell');
    }
  });

  it('never lets inheritance overwrite the synthesized identity', () => {
    // `inherit` is spread FIRST precisely so these cannot be clobbered.
    const out = synth({
      colId: 'WRONG', aggFunc: 'avg', sortable: false, headerName: 'WRONG',
    } as Record<string, unknown>);
    for (const leaf of leafDefs(out).filter((d) => String(d.colId).startsWith('pivotcol'))) {
      expect(leaf.colId).not.toBe('WRONG');
      expect(leaf.aggFunc).toBe('sum');
      expect(leaf.sortable).toBe(true);
      expect(leaf.headerName).toBe('P&L');
    }
  });

  it('still lets processPivotResultColDef win over inheritance', () => {
    // The app hook runs last — it was the ONLY way in before, and it must
    // keep beating the new default rather than being silently overridden.
    const out = synth(
      { valueFormatter: '$#,##0.00' },
      { processPivotResultColDef: (def: Record<string, unknown>) => { def.valueFormatter = 'APP'; } },
    );
    for (const leaf of leafDefs(out).filter((d) => String(d.colId).startsWith('pivotcol'))) {
      expect(leaf.valueFormatter).toBe('APP');
    }
  });

  it('row-total leaves inherit as well — a total of P&L reads like P&L', () => {
    const out = synth({ valueFormatter: '$#,##0.00' }, { pivotRowTotals: 'after' });
    const totals = leafDefs(out).filter((d) => !String(d.colId).startsWith('pivotcol'));
    expect(totals.length).toBeGreaterThan(0);
    for (const leaf of totals) expect(leaf.valueFormatter).toBe('$#,##0.00');
  });

  it('is a no-op when the source column has no presentation to give', () => {
    const out = synth(undefined);
    for (const leaf of leafDefs(out)) expect(leaf.valueFormatter).toBeUndefined();
  });
});
