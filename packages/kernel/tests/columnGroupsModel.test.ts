import { describe, it, expect } from 'vitest';
import {
  flatten, project, createGroup, createGroupWithColumns, deleteGroup, moveNode, setHidden,
  setColumnHeaderName, setGroupStyle, canDrop, validate, renameGroup,
  resolveDrop, rehydrate, setColumnGroupShow, setGroupHidden, descendantColumnIds,
  type Node, type GroupNode, type SerializedNode,
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

  it('createGroup never reuses an existing cg-grp-N id (post-Apply remount)', () => {
    // Simulate seed after Apply: defs already carry synthesized group ids, and
    // the module seq may be behind those ids (fresh page / remount).
    const seeded = flatten([
      {
        groupId: 'cg-grp-1',
        headerName: 'Trade',
        children: [
          { colId: 'bid', field: 'bid', headerName: 'Bid' },
          { colId: 'ask', field: 'ask', headerName: 'Ask' },
        ],
      },
    ]);
    const next = createGroup(seeded, null, 'New Group');
    const ids = next.filter((n) => n.kind === 'group').map((n) => n.id);
    expect(ids).toEqual(['cg-grp-1', 'cg-grp-2']);
    expect(new Set(ids).size).toBe(2);

    const created = next.find((n) => n.kind === 'group' && n.headerName === 'New Group') as GroupNode;
    expect(created.id).toBe('cg-grp-2');
    // New group starts empty — columns stay under the original group.
    expect(next.filter((n) => n.kind === 'column' && n.parentId === created.id)).toHaveLength(0);
    expect(next.filter((n) => n.kind === 'column' && n.parentId === 'cg-grp-1')).toHaveLength(2);

    const renamed = renameGroup(next, created.id, 'Risk');
    expect((renamed.find((n) => n.id === 'cg-grp-1') as GroupNode).headerName).toBe('Trade');
    expect((renamed.find((n) => n.id === 'cg-grp-2') as GroupNode).headerName).toBe('Risk');
  });

  it('createGroupWithColumns creates a group and moves the given columns into it', () => {
    const nodes = createGroupWithColumns(flatten(nested), ['sym', 'last'], 'Risk');
    const g = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Risk') as GroupNode;
    expect(g).toBeDefined();
    expect(g.parentId).toBeNull();
    const sym = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'sym')!;
    const last = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'last')!;
    expect(sym.parentId).toBe(g.id);
    expect(last.parentId).toBe(g.id);
    expect(sym.order).toBeLessThan(last.order);
    // bid stays under Prices (not requested)
    const bid = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'bid')!;
    expect(bid.parentId).not.toBe(g.id);
  });

  it('moveNode reparents a column into a group', () => {
    let nodes = flatten(nested);
    const risk = createGroup(nodes, null, 'Risk');
    const riskId = (risk.find((n) => (n as GroupNode).headerName === 'Risk') as GroupNode).id;
    const last = risk.find((n) => n.kind === 'column' && (n as any).colId === 'last')!;
    const moved = moveNode(risk, last.id, riskId, 0);
    expect(moved.find((n) => n.id === last.id)!.parentId).toBe(riskId);
  });

  it('moveNode reorders within the same parent (insert-before-index contract)', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { groupId: 'g', headerName: 'G', children: [
        { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
    ];
    const nodes = flatten(defs);
    const g = nodes.find((n) => n.kind === 'group')!;
    const a = nodes.find((n) => (n as any).colId === 'a')!;
    // move 'a' to land before 'c' (index 2) → order a,b,c becomes b,a,c
    const moved = moveNode(nodes, a.id, g.id, 2);
    const order = project(moved)[0] as CColGroupDef;
    expect(order.children.map((c) => (c as CColDef).colId)).toEqual(['b', 'a', 'c']);
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

  it('renameGroup changes only that group headerName', () => {
    const nodes0 = flatten(nested);
    const trade = nodes0.find((n) => (n as GroupNode).headerName === 'Trade') as GroupNode;
    const prices = nodes0.find((n) => (n as GroupNode).headerName === 'Prices') as GroupNode;
    const nodes = renameGroup(nodes0, trade.id, 'Deals');
    const tradeAfter = nodes.find((n) => n.id === trade.id) as GroupNode;
    const pricesAfter = nodes.find((n) => n.id === prices.id) as GroupNode;
    expect(tradeAfter.headerName).toBe('Deals');
    expect(tradeAfter.parentId).toBe(trade.parentId);
    expect(tradeAfter.order).toBe(trade.order);
    // untouched sibling/other-field state
    expect(pricesAfter.headerName).toBe('Prices');
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

describe('colId-less columns (field-only)', () => {
  it('round-trips a column defined by field only (no colId)', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { field: 'pnl', headerName: 'P&L' },
      { groupId: 'g', headerName: 'G', children: [{ field: 'qty' }] },
    ];
    expect(project(flatten(defs))).toEqual(defs);
  });

  it('flatten derives id/colId from field when colId is absent', () => {
    const defs: (CColDef | CColGroupDef)[] = [{ field: 'pnl', headerName: 'P&L' }];
    const nodes = flatten(defs);
    const pnl = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'pnl');
    expect(pnl).toBeDefined();
  });

  it('rename/move keyed on a field-only column works (id-keyed lookups do not collide)', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { field: 'pnl', headerName: 'P&L' },
      { field: 'qty', headerName: 'Qty' },
    ];
    let nodes = flatten(defs);
    nodes = setColumnHeaderName(nodes, 'pnl', 'Profit & Loss');
    const risk = createGroup(nodes, null, 'Risk');
    const riskId = (risk.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Risk') as GroupNode).id;
    const pnl = risk.find((n) => n.kind === 'column' && (n as any).colId === 'pnl')!;
    const moved = moveNode(risk, pnl.id, riskId, 0);
    expect(moved.find((n) => n.id === pnl.id)!.parentId).toBe(riskId);
    const defsOut = project(moved);
    const g = defsOut.find((d): d is CColGroupDef => (d as any).groupId === riskId)!;
    expect((g.children[0] as CColDef).headerName).toBe('Profit & Loss');
    // 'qty' remains untouched and distinguishable — proves no id collision
    const qty = moved.find((n) => n.kind === 'column' && (n as any).colId === 'qty')!;
    expect(qty.id).not.toBe(pnl.id);
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

  it('canDrop rejects a column leaving a marryChildren:true group', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { groupId: 'm', headerName: 'Married', marryChildren: true, children: [
        { colId: 'x', field: 'x' }, { colId: 'y', field: 'y' },
      ] },
    ];
    const nodes = flatten(defs);
    const x = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'x')!;
    expect(canDrop(nodes, x.id, null)).toBe(false);
    expect(canDrop(nodes, x.id, null, { bypassMarryChildren: true })).toBe(true);
    const moved = moveNode(nodes, x.id, null, 0, { bypassMarryChildren: true });
    expect(moved.find((n) => n.id === x.id)!.parentId).toBeNull();
  });

  it('validate returns ok:true when every group has at least one child', () => {
    const res = validate(flatten(nested));
    expect(res).toEqual({ ok: true });
  });
});

describe('resolveDrop', () => {
  const abc: (CColDef | CColGroupDef)[] = [
    { groupId: 'g', headerName: 'G', children: [
      { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
    ] },
  ];

  it('same-parent FORWARD reorder: dragging first item onto the last is NOT a no-op', () => {
    const nodes = flatten(abc);
    const a = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'a')!;
    const c = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'c')!;
    const resolved = resolveDrop(nodes, a.id, c.id, false)!;
    expect(resolved).not.toBeNull();
    const moved = moveNode(nodes, a.id, resolved.parentId, resolved.order);
    const g = project(moved)[0] as CColGroupDef;
    const order = g.children.map((ch) => (ch as CColDef).colId);
    // must actually move 'a' — not a no-op — landing at/after 'b'
    expect(order).not.toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['b', 'a', 'c']);
  });

  it('same-parent BACKWARD reorder: dragging last item onto the first', () => {
    const nodes = flatten(abc);
    const a = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'a')!;
    const c = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'c')!;
    const resolved = resolveDrop(nodes, c.id, a.id, false)!;
    const moved = moveNode(nodes, c.id, resolved.parentId, resolved.order);
    const g = project(moved)[0] as CColGroupDef;
    const order = g.children.map((ch) => (ch as CColDef).colId);
    expect(order).toEqual(['c', 'a', 'b']);
  });

  it('cross-parent move: dropping a top-level column between two group children', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { colId: 'sym', field: 'sym' },
      { groupId: 'g', headerName: 'G', children: [
        { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' },
      ] },
    ];
    const nodes = flatten(defs);
    const sym = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'sym')!;
    const b = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'b')!;
    const resolved = resolveDrop(nodes, sym.id, b.id, false)!;
    expect(resolved.parentId).toBe((nodes.find((n) => n.kind === 'group') as GroupNode).id);
    const moved = moveNode(nodes, sym.id, resolved.parentId, resolved.order);
    const g = project(moved).find((d): d is CColGroupDef => (d as any).groupId === 'g')!;
    expect(g.children.map((ch) => (ch as CColDef).colId)).toEqual(['a', 'sym', 'b']);
  });

  it('drop onto a group header appends inside it', () => {
    const nodes = flatten(abc);
    const g = nodes.find((n) => n.kind === 'group') as GroupNode;
    const risk = createGroup(nodes, null, 'Risk');
    const riskId = (risk.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Risk') as GroupNode).id;
    const a = risk.find((n) => n.kind === 'column' && (n as any).colId === 'a')!;
    const resolved = resolveDrop(risk, a.id, riskId, true)!;
    expect(resolved.parentId).toBe(riskId);
    expect(resolved.order).toBe(0); // Risk starts empty
    const moved = moveNode(risk, a.id, resolved.parentId, resolved.order);
    const riskDef = project(moved).find((d): d is CColGroupDef => (d as any).groupId === riskId)!;
    expect(riskDef.children.map((ch) => (ch as CColDef).colId)).toEqual(['a']);
    // sanity: 'g' still has b, c only
    const gDef = project(moved).find((d): d is CColGroupDef => (d as any).groupId === g.id)!;
    expect(gDef.children.map((ch) => (ch as CColDef).colId)).toEqual(['b', 'c']);
  });

  it('returns null when target does not exist or equals dragId', () => {
    const nodes = flatten(abc);
    const a = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'a')!;
    expect(resolveDrop(nodes, a.id, a.id, false)).toBeNull();
    expect(resolveDrop(nodes, a.id, 'nope', false)).toBeNull();
  });
});

describe('columnGroupShow round-trip + mutation', () => {
  const defs: (CColDef | CColGroupDef)[] = [
    { groupId: 'g', headerName: 'G', children: [
      { colId: 'a', field: 'a', columnGroupShow: 'open' },
      { colId: 'b', field: 'b' }, // absent = always visible
    ] },
  ];
  it('round-trips columnGroupShow through flatten/project', () => {
    expect(project(flatten(defs))).toEqual(defs);
  });
  it('flatten carries columnGroupShow onto the ColumnNode', () => {
    const a = flatten(defs).find((n) => n.kind === 'column' && (n as any).colId === 'a') as any;
    expect(a.columnGroupShow).toBe('open');
  });
  it('setColumnGroupShow updates one column and projects it', () => {
    const nodes = setColumnGroupShow(flatten(defs), 'b', 'closed');
    const g = project(nodes)[0] as CColGroupDef;
    const b = g.children.find((c) => (c as CColDef).colId === 'b') as CColDef;
    expect(b.columnGroupShow).toBe('closed');
  });
  it('setting back to null (always) is representable', () => {
    const nodes = setColumnGroupShow(flatten(defs), 'a', null);
    const g = project(nodes)[0] as CColGroupDef;
    const a = g.children.find((c) => (c as CColDef).colId === 'a') as CColDef;
    expect(a.columnGroupShow ?? null).toBeNull();
  });
});

describe('rehydrate (persist overlay → nodes)', () => {
  const base: (CColDef | CColGroupDef)[] = [
    { colId: 'a', field: 'a', valueFormatter: () => 'X' }, // function survives
    { colId: 'b', field: 'b' },
    { colId: 'c', field: 'c' },
  ];
  it('reattaches def by colId and round-trips through project', () => {
    // overlay: group g wraps b+c, a stays ungrouped
    const overlay: SerializedNode[] = [
      { id: 'a', kind: 'column', parentId: null, order: 0, colId: 'a', headerName: 'a' },
      { id: 'g', kind: 'group', parentId: null, order: 1, headerName: 'G' },
      { id: 'b', kind: 'column', parentId: 'g', order: 0, colId: 'b', headerName: 'b' },
      { id: 'c', kind: 'column', parentId: 'g', order: 1, colId: 'c', headerName: 'c' },
    ];
    const defs = project(rehydrate(overlay, base));
    const g = defs.find((d): d is CColGroupDef => (d as any).groupId === 'g')!;
    expect(g.children.map((c) => (c as CColDef).colId)).toEqual(['b', 'c']);
    // the function-valued field on 'a' is preserved (came from baseDefs, not overlay)
    const a = defs.find((d) => (d as CColDef).colId === 'a') as CColDef;
    expect(typeof a.valueFormatter).toBe('function');
  });
  it('drops overlay entries whose colId no longer exists in base', () => {
    const overlay: SerializedNode[] = [
      { id: 'gone', kind: 'column', parentId: null, order: 0, colId: 'gone', headerName: 'gone' },
      { id: 'a', kind: 'column', parentId: null, order: 1, colId: 'a', headerName: 'a' },
    ];
    const defs = project(rehydrate(overlay, base));
    expect(defs.some((d) => (d as CColDef).colId === 'gone')).toBe(false);
  });
  it('appends base leaves missing from the overlay as ungrouped', () => {
    const overlay: SerializedNode[] = [
      { id: 'a', kind: 'column', parentId: null, order: 0, colId: 'a', headerName: 'a' },
    ]; // b, c missing
    const defs = project(rehydrate(overlay, base));
    expect(defs.some((d) => (d as CColDef).colId === 'b')).toBe(true);
    expect(defs.some((d) => (d as CColDef).colId === 'c')).toBe(true);
  });
  it('prunes nested empty groups to a fixpoint (grandparent also empties out)', () => {
    // outer wraps inner wraps 'gone' only — once 'gone' is dropped, 'inner'
    // becomes empty, and once 'inner' is pruned, 'outer' becomes empty too.
    const overlay: SerializedNode[] = [
      { id: 'outer', kind: 'group', parentId: null, order: 0, headerName: 'Outer' },
      { id: 'inner', kind: 'group', parentId: 'outer', order: 0, headerName: 'Inner' },
      { id: 'gone', kind: 'column', parentId: 'inner', order: 0, colId: 'gone', headerName: 'gone' },
      { id: 'a', kind: 'column', parentId: null, order: 1, colId: 'a', headerName: 'a' },
    ];
    const nodes = rehydrate(overlay, base);
    expect(nodes.some((n) => n.id === 'outer')).toBe(false);
    expect(nodes.some((n) => n.id === 'inner')).toBe(false);
    const defs = project(nodes);
    // every base leaf still surfaces (b, c appended ungrouped; a present)
    expect(defs.some((d) => (d as CColDef).colId === 'a')).toBe(true);
    expect(defs.some((d) => (d as CColDef).colId === 'b')).toBe(true);
    expect(defs.some((d) => (d as CColDef).colId === 'c')).toBe(true);
  });
});

describe('setGroupHidden', () => {
  it('cascades hide onto every descendant leaf and nested group', () => {
    const nodes = setGroupHidden(flatten(nested), 'trade', true);
    const trade = nodes.find((n) => n.id === 'trade') as GroupNode;
    const prices = nodes.find((n) => n.id === 'prices') as GroupNode;
    expect(trade.hide).toBe(true);
    expect(prices.hide).toBe(true);
    for (const colId of descendantColumnIds(nodes, 'trade')) {
      const col = nodes.find((n) => n.kind === 'column' && n.colId === colId)!;
      expect(col.hide).toBe(true);
    }
    const sym = nodes.find((n) => n.kind === 'column' && n.colId === 'sym')!;
    expect(sym.hide).toBeUndefined();
  });

  it('project round-trips group.hide onto CColGroupDef and leaf hide', () => {
    const projected = project(setGroupHidden(flatten(nested), 'trade', true));
    const trade = projected.find((d) => (d as CColGroupDef).groupId === 'trade') as CColGroupDef;
    expect(trade.hide).toBe(true);
    const prices = trade.children.find((d) => (d as CColGroupDef).groupId === 'prices') as CColGroupDef;
    expect(prices.hide).toBe(true);
    expect((prices.children[0] as CColDef).hide).toBe(true);
    expect(flatten(projected).find((n) => n.id === 'trade')!.hide).toBe(true);
  });

  it('unhiding clears hide on the group subtree', () => {
    const hidden = setGroupHidden(flatten(nested), 'trade', true);
    const shown = setGroupHidden(hidden, 'trade', false);
    expect((shown.find((n) => n.id === 'trade') as GroupNode).hide).toBe(false);
    expect(shown.find((n) => n.kind === 'column' && n.colId === 'bid')!.hide).toBe(false);
  });
});
