/**
 * Cycle 21i — normalized flat working model for the Column Groups editor.
 *
 * The editor never mutates the nested CColGroupDef tree directly. It works
 * over a flat Node[] where every edit is an O(1) field write; `project()`
 * folds the flat model back to the nested `columnDefs` on Apply, and
 * `flatten()` seeds the model from `api.getColumnGroupDefs()`. Preserving
 * every non-structural CColDef field is done by keeping the original leaf
 * def keyed by colId — only headerName/hide/order are editor-owned.
 */
import type { CColDef, CColGroupDef, ColCellOverrides, HeaderClass } from '../../types';

export interface GroupNode {
  id: string;
  kind: 'group';
  parentId: string | null;
  order: number;
  headerName: string;
  openByDefault?: boolean;
  marryChildren?: boolean;
  headerStyle?: ColCellOverrides;
  headerClass?: HeaderClass;
}
export interface ColumnNode {
  id: string;
  kind: 'column';
  parentId: string | null;
  order: number;
  colId: string;
  headerName: string;
  hide?: boolean;
  /** Frozen reference to the original leaf def — every non-editor field
   *  (field, cellRenderer, valueFormatter, width…) is carried through
   *  project() unchanged. */
  readonly def: CColDef;
}
export type Node = GroupNode | ColumnNode;

const isGroupDef = (d: CColDef | CColGroupDef): d is CColGroupDef =>
  Array.isArray((d as CColGroupDef).children);

let seq = 0;
const nextGroupId = (existing?: string) => existing ?? `cg-grp-${++seq}`;

export function flatten(defs: (CColDef | CColGroupDef)[]): Node[] {
  const out: Node[] = [];
  const walk = (list: (CColDef | CColGroupDef)[], parentId: string | null) => {
    list.forEach((d, order) => {
      if (isGroupDef(d)) {
        const id = nextGroupId(d.groupId);
        out.push({
          id, kind: 'group', parentId, order,
          headerName: d.headerName ?? '',
          openByDefault: d.openByDefault,
          marryChildren: d.marryChildren,
          headerStyle: d.headerStyle as ColCellOverrides | undefined,
          headerClass: d.headerClass,
        });
        walk(d.children, id);
      } else {
        const cid = d.colId ?? d.field!;
        out.push({
          id: cid, kind: 'column', parentId, order,
          colId: cid, headerName: d.headerName ?? cid,
          hide: d.hide, def: d,
        });
      }
    });
  };
  walk(defs, null);
  return out;
}

export function project(nodes: Node[]): (CColDef | CColGroupDef)[] {
  const childrenOf = (parentId: string | null): (CColDef | CColGroupDef)[] =>
    nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((n) => {
        if (n.kind === 'group') {
          const g: CColGroupDef = { groupId: n.id, headerName: n.headerName, children: childrenOf(n.id) };
          if (n.openByDefault !== undefined) g.openByDefault = n.openByDefault;
          if (n.marryChildren !== undefined) g.marryChildren = n.marryChildren;
          if (n.headerStyle !== undefined) g.headerStyle = n.headerStyle;
          if (n.headerClass !== undefined) g.headerClass = n.headerClass;
          return g;
        }
        const leaf: CColDef = { ...n.def };
        // Only stamp headerName if it diverges from the def's own default
        // (headerName ?? colId) — this keeps round-trip identity exact for
        // defs that never had an explicit headerName (e.g. field-only cols).
        const defaultHeaderName = n.def.headerName ?? n.colId;
        if (n.headerName !== defaultHeaderName) leaf.headerName = n.headerName;
        if (n.hide !== undefined) leaf.hide = n.hide;
        return leaf;
      });
  return childrenOf(null);
}

const clone = (nodes: Node[]): Node[] => nodes.map((n) => ({ ...n }));
const reindex = (nodes: Node[]): Node[] => {
  const perParent = new Map<string | null, Node[]>();
  for (const n of nodes) {
    const arr = perParent.get(n.parentId) ?? [];
    arr.push(n);
    perParent.set(n.parentId, arr);
  }
  for (const arr of perParent.values()) arr.sort((a, b) => a.order - b.order).forEach((n, i) => { n.order = i; });
  return nodes;
};

export function createGroup(nodes: Node[], parentId: string | null, headerName: string): Node[] {
  const next = clone(nodes);
  const siblings = next.filter((n) => n.parentId === parentId).length;
  next.push({ id: nextGroupId(), kind: 'group', parentId, order: siblings, headerName });
  return reindex(next);
}

export function renameGroup(nodes: Node[], id: string, headerName: string): Node[] {
  return clone(nodes).map((n) => (n.id === id && n.kind === 'group' ? { ...n, headerName } : n));
}

export function deleteGroup(nodes: Node[], id: string): Node[] {
  const target = nodes.find((n) => n.id === id);
  if (!target || target.kind !== 'group') return nodes;
  const next = clone(nodes)
    .map((n) => (n.parentId === id ? { ...n, parentId: target.parentId } : n))
    .filter((n) => n.id !== id);
  return reindex(next);
}

/**
 * Reparents/reorders `id` under `newParentId`.
 *
 * `newOrder` contract: it is the index — within the destination parent's
 * CURRENT sibling ordering (i.e. before the moved node is spliced in) — of
 * the sibling the moved node should land BEFORE. Pass `siblings.length` to
 * append at the end. E.g. for siblings [a, b, c], moveNode(..., a, parent, 2)
 * moves `a` to land before index 2 (`c`), producing [b, a, c].
 */
export function moveNode(nodes: Node[], id: string, newParentId: string | null, newOrder: number): Node[] {
  if (!canDrop(nodes, id, newParentId)) return nodes;
  const next = clone(nodes).map((n) => (n.id === id ? { ...n, parentId: newParentId, order: newOrder - 0.5 } : n));
  return reindex(next);
}

export function setHidden(nodes: Node[], colId: string, hide: boolean): Node[] {
  return clone(nodes).map((n) => (n.kind === 'column' && n.colId === colId ? { ...n, hide } : n));
}

export function setColumnHeaderName(nodes: Node[], colId: string, headerName: string): Node[] {
  return clone(nodes).map((n) => (n.kind === 'column' && n.colId === colId ? { ...n, headerName } : n));
}

export function setGroupStyle(
  nodes: Node[], id: string,
  patch: Partial<Pick<GroupNode, 'headerStyle' | 'headerClass' | 'openByDefault' | 'marryChildren'>>,
): Node[] {
  return clone(nodes).map((n) => (n.id === id && n.kind === 'group' ? { ...n, ...patch } : n));
}

export function canDrop(nodes: Node[], dragId: string, targetParentId: string | null): boolean {
  if (dragId === targetParentId) return false;
  // Walk up from the target; if we reach dragId, the drop would create a cycle.
  let cur: string | null = targetParentId;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  while (cur) {
    if (cur === dragId) return false;
    cur = byId.get(cur)?.parentId ?? null;
  }
  // marryChildren: a column may not leave a marry-children group.
  const drag = byId.get(dragId);
  if (drag && drag.kind === 'column' && drag.parentId) {
    const parent = byId.get(drag.parentId);
    if (parent && parent.kind === 'group' && parent.marryChildren && targetParentId !== drag.parentId) return false;
  }
  return true;
}

export function validate(nodes: Node[]): { ok: true } | { ok: false; groupId: string; message: string } {
  for (const n of nodes) {
    if (n.kind === 'group') {
      const hasChild = nodes.some((c) => c.parentId === n.id);
      if (!hasChild) return { ok: false, groupId: n.id, message: 'Group has no columns' };
    }
  }
  return { ok: true };
}
