import { describe, expect, it } from 'vitest';
import { applyGroupPass, collectDescendantRowIds, findGroupNode } from '../src/csrm/groupPass';
import { applyAggPass, applyGroupAggPass } from '../src/csrm/aggPass';
import { computeGroupVisibleOrder } from '../src/csrm/visibleOrder';
import { buildGroupMetaLookup, computeStickyAncestors } from '../src/csrm/stickyAncestors';
import { ClientSideRowModel } from '../src/csrm/clientSideRowModel';
import { SelectionModel } from '../src/selection/selectionModel';

type Row = { id: string; desk: string; region: string; pnl: number };

const rows: Row[] = [
  { id: '1', desk: 'EQ', region: 'AMER', pnl: 10 },
  { id: '2', desk: 'EQ', region: 'AMER', pnl: 20 },
  { id: '3', desk: 'EQ', region: 'EMEA', pnl: 5 },
  { id: '4', desk: 'FX', region: 'AMER', pnl: 40 },
];

describe('applyGroupPass', () => {
  it('builds a 2-level tree with correct leaf counts and keys', () => {
    const out = applyGroupPass(rows, (r) => r.id, { rowGroupCols: ['desk', 'region'] });
    expect(out.bypassed).toBe(false);
    expect(out.roots).toHaveLength(2);
    const eq = out.roots.find((r) => r.value === 'EQ')!;
    expect(eq.childCount).toBe(3);
    expect(eq.childGroups).toHaveLength(2);
    expect(eq.key).toBe('desk:EQ');
    const amer = eq.childGroups.find((g) => g.value === 'AMER')!;
    expect(amer.childIndices).toEqual([0, 1]);
    expect(amer.key).toBe('desk:EQ::region:AMER');
  });

  it('emits footer entries when includeFooter is on', () => {
    const out = applyGroupPass(rows, (r) => r.id, {
      rowGroupCols: ['desk'],
      includeFooter: true,
      includeTotalFooter: true,
    });
    const kinds = out.flatOrder.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'footer').length).toBeGreaterThanOrEqual(3); // 2 groups + grand
    expect(out.flatOrder[out.flatOrder.length - 1]).toEqual({ kind: 'footer', key: '', depth: 0 });
  });

  it('bypasses when no rowGroupCols', () => {
    const out = applyGroupPass(rows, (r) => r.id, { rowGroupCols: [] });
    expect(out.bypassed).toBe(true);
    expect(out.flatOrder).toEqual([]);
  });
});

describe('visibleOrder + agg', () => {
  it('collapse removes descendants from visible order', () => {
    const out = applyGroupPass(rows, (r) => r.id, { rowGroupCols: ['desk', 'region'] });
    const collapsed = computeGroupVisibleOrder(out.flatOrder, new Set());
    expect(collapsed.every((e) => e.kind === 'group' && e.depth === 0)).toBe(true);
    expect(collapsed).toHaveLength(2);

    const eqAmer = 'desk:EQ::region:AMER';
    const expanded = new Set(['desk:EQ', eqAmer]);
    const vis = computeGroupVisibleOrder(out.flatOrder, expanded);
    expect(vis.some((e) => e.kind === 'row')).toBe(true);
    expect(vis.filter((e) => e.kind === 'row')).toHaveLength(2);
  });

  it('computes grand and per-group sum(pnl)', () => {
    const grouped = applyGroupPass(rows, (r) => r.id, { rowGroupCols: ['desk'] });
    const grand = applyAggPass(rows, [{ colId: 'pnl', aggFunc: 'sum' }]);
    expect(grand.pnl).toBe(75);
    const per = applyGroupAggPass(
      rows,
      grouped.inputIds,
      grouped,
      [{ colId: 'pnl', aggFunc: 'sum' }],
      (r) => r.id,
    );
    expect(per['desk:EQ']!.pnl).toBe(35);
    expect(per['desk:FX']!.pnl).toBe(40);
  });
});

describe('stickyAncestors', () => {
  it('returns expanded ancestor chain for a scrolled boundary', () => {
    const out = applyGroupPass(rows, (r) => r.id, { rowGroupCols: ['desk', 'region'] });
    const expanded = new Set(out.flatOrder.filter((e) => e.kind === 'group').map((e) => e.key));
    const vis = computeGroupVisibleOrder(out.flatOrder, expanded);
    const meta = buildGroupMetaLookup(out.roots, expanded);
    // First leaf under EQ/AMER is past group rows — pick a rowStart mid-list
    const firstLeaf = vis.findIndex((e) => e.kind === 'row');
    const sticky = computeStickyAncestors(vis, firstLeaf + 1, meta);
    expect(sticky.length).toBeGreaterThan(0);
    expect(sticky[0]!.colId).toBe('desk');
  });
});

describe('ClientSideRowModel grouping integration', () => {
  it('materializes group + leaf rows with footer totals', () => {
    const m = new ClientSideRowModel<Row>((r) => r.id, () => [
      { field: 'desk' },
      { field: 'region' },
      { field: 'pnl', aggFunc: 'sum' },
    ]);
    m.setRowData(rows);
    m.setIncludeFooter(true, true);
    m.setRowGroupColumns(['desk']);
    const view = m.getRows();
    expect(view.some((r) => r.__isGroup)).toBe(true);
    expect(view.some((r) => r.__isFooter)).toBe(true);
    const eqGroup = view.find((r) => r.__groupKey === 'desk:EQ' && r.__isGroup);
    expect(eqGroup?.pnl).toBe(35);
    m.collapseAll();
    expect(m.getRows().every((r) => r.__isGroup || r.__isFooter || r.__isGrandTotal)).toBe(true);
  });
});

describe('SelectionModel cascade', () => {
  it('selects all leaf descendants under a group', () => {
    const grouped = applyGroupPass(rows, (r) => r.id, { rowGroupCols: ['desk'] });
    const eq = findGroupNode(grouped.roots, 'desk:EQ')!;
    const ids = collectDescendantRowIds(eq, grouped.inputIds);
    expect(ids.sort()).toEqual(['1', '2', '3']);
    const sel = new SelectionModel((key) => {
      const n = findGroupNode(grouped.roots, key);
      return n ? collectDescendantRowIds(n, grouped.inputIds) : [];
    });
    sel.setGroupSelected('desk:EQ', true);
    expect(sel.getGroupSelectionState('desk:EQ')).toBe('all');
    sel.setSelected('2', false);
    expect(sel.getGroupSelectionState('desk:EQ')).toBe('partial');
  });
});
