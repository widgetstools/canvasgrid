import { describe, it, expect } from 'vitest';
import {
  flatten, project, createGroup, deleteGroup, moveNode, setHidden,
  setColumnHeaderName, setGroupStyle, canDrop, validate,
  type Node, type GroupNode,
} from '../src/interaction/columnGroups/model';
import type { CColDef, CColGroupDef } from '../src/types';

const nested: (CColDef | CColGroupDef)[] = [
  { colId: 'sym', field: 'sym', headerName: 'Symbol' },
  { groupId: 'trade', headerName: 'Trade', children: [
    { groupId: 'prices', headerName: 'Prices', children: [
      { colId: 'bid', field: 'bid', headerName: 'Bid' },
      { colId: 'ask', field: 'ask', headerName: 'Ask' },
    ] },
    { colId: 'last', field: 'last', headerName: 'Last' },
  ] },
];

describe('flatten/project round-trip', () => {
  it('is structurally identity for flat + nested + subgroup trees', () => {
    const out = project(flatten(nested));
    expect(out).toEqual(nested);
  });

  it('flatten emits ungrouped leaves with parentId null', () => {
    const nodes = flatten(nested);
    const sym = nodes.find((n) => n.kind === 'column' && n.colId === 'sym')!;
    expect(sym.parentId).toBeNull();
  });

  it('flatten preserves nesting depth via parentId chain', () => {
    const nodes = flatten(nested);
    const bid = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'bid')!;
    const prices = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Prices')!;
    const trade = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Trade')!;
    expect(bid.parentId).toBe(prices.id);
    expect(prices.parentId).toBe(trade.id);
    expect(trade.parentId).toBeNull();
  });
});

describe('mutations', () => {
  it('createGroup adds an empty top-level group', () => {
    const nodes = createGroup(flatten(nested), null, 'Risk');
    const g = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Risk');
    expect(g).toBeDefined();
    expect(g!.parentId).toBeNull();
  });

  it('moveNode reparents a column into a group', () => {
    let nodes = flatten(nested);
    const risk = createGroup(nodes, null, 'Risk');
    const riskId = (risk.find((n) => (n as GroupNode).headerName === 'Risk') as GroupNode).id;
    const last = risk.find((n) => n.kind === 'column' && (n as any).colId === 'last')!;
    const moved = moveNode(risk, last.id, riskId, 0);
    expect(moved.find((n) => n.id === last.id)!.parentId).toBe(riskId);
  });

  it('deleteGroup reparents children to the group parent (no orphans)', () => {
    const nodes = flatten(nested);
    const prices = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Prices') as GroupNode;
    const after = deleteGroup(nodes, prices.id);
    expect(after.find((n) => n.id === prices.id)).toBeUndefined();
    const bid = after.find((n) => n.kind === 'column' && (n as any).colId === 'bid')!;
    expect(bid.parentId).toBe(prices.parentId); // now under 'trade'
  });

  it('setHidden marks a column hidden and project writes hide:true', () => {
    const nodes = setHidden(flatten(nested), 'ask', true);
    const defs = project(nodes);
    const trade = defs.find((d): d is CColGroupDef => (d as any).groupId === 'trade')!;
    const prices = trade.children.find((d): d is CColGroupDef => (d as any).groupId === 'prices')!;
    const ask = prices.children.find((c) => (c as CColDef).colId === 'ask') as CColDef;
    expect(ask.hide).toBe(true);
  });

  it('setColumnHeaderName rewrites the leaf headerName on project', () => {
    const nodes = setColumnHeaderName(flatten(nested), 'sym', 'Ticker');
    const defs = project(nodes);
    expect((defs[0] as CColDef).headerName).toBe('Ticker');
  });

  it('setGroupStyle writes headerStyle on project', () => {
    const nodes0 = flatten(nested);
    const trade = nodes0.find((n) => (n as GroupNode).headerName === 'Trade') as GroupNode;
    const nodes = setGroupStyle(nodes0, trade.id, { headerStyle: { backgroundColor: '#123' } });
    const defs = project(nodes);
    const g = defs.find((d): d is CColGroupDef => (d as any).groupId === 'trade')!;
    expect((g.headerStyle as any).backgroundColor).toBe('#123');
  });
});

describe('validation', () => {
  it('canDrop rejects dropping a group into its own descendant', () => {
    const nodes = flatten(nested);
    const trade = nodes.find((n) => (n as GroupNode).headerName === 'Trade') as GroupNode;
    const prices = nodes.find((n) => (n as GroupNode).headerName === 'Prices') as GroupNode;
    expect(canDrop(nodes, trade.id, prices.id)).toBe(false);
    expect(canDrop(nodes, prices.id, null)).toBe(true);
  });

  it('validate fails on an empty group', () => {
    const nodes = createGroup(flatten(nested), null, 'Empty');
    const res = validate(nodes);
    expect(res.ok).toBe(false);
  });
});
