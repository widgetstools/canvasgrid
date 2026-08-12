/**
 * CSRM GroupPass — hierarchical row grouping + flatOrder (ported from legacy).
 */

export type GroupNode = {
  key: string;
  value: unknown;
  depth: number;
  colId: string;
  /** Indices into the post-filter input id array (leaf groups only). */
  childIndices: number[];
  childGroups: GroupNode[];
  childCount: number;
};

export type FlatOrderEntry =
  | { kind: 'group'; key: string; depth: number }
  | { kind: 'row'; rowIndex: number; depth: number }
  | { kind: 'footer'; key: string; depth: number };

export type GroupPassOutput = {
  roots: GroupNode[];
  flatOrder: FlatOrderEntry[];
  bypassed: boolean;
};

type BuildBucket = {
  node: GroupNode;
  childByKey: Map<string, BuildBucket>;
  leafIndices: number[] | null;
};

export type GroupPassOptions = {
  rowGroupCols: string[];
  includeFooter?: boolean;
  includeTotalFooter?: boolean;
  removeSingleChildren?: boolean | 'leafGroupsOnly';
};

export function applyGroupPass<T extends Record<string, unknown>>(
  rows: readonly T[],
  getRowId: (row: T) => string,
  opts: GroupPassOptions,
): GroupPassOutput & { inputIds: string[] } {
  const cols = opts.rowGroupCols;
  const inputIds = rows.map((r) => getRowId(r));
  if (cols.length === 0) {
    return { roots: [], flatOrder: [], bypassed: true, inputIds };
  }

  const deepest = cols.length - 1;
  const root: BuildBucket = {
    node: {
      key: '', value: null, depth: -1, colId: '',
      childIndices: [], childGroups: [], childCount: 0,
    },
    childByKey: new Map(),
    leafIndices: null,
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let parent = root;
    for (let d = 0; d < cols.length; d++) {
      const colId = cols[d]!;
      const raw = row[colId];
      const keyPart = raw == null ? '' : String(raw);
      let bucket = parent.childByKey.get(keyPart);
      if (!bucket) {
        const key = parent.node.depth < 0
          ? `${colId}:${keyPart}`
          : `${parent.node.key}::${colId}:${keyPart}`;
        bucket = {
          node: {
            key,
            value: raw ?? '',
            depth: d,
            colId,
            childIndices: [],
            childGroups: [],
            childCount: 0,
          },
          childByKey: new Map(),
          leafIndices: d === deepest ? [] : null,
        };
        parent.childByKey.set(keyPart, bucket);
        parent.node.childGroups.push(bucket.node);
      }
      if (d === deepest) bucket.leafIndices!.push(i);
      parent = bucket;
    }
  }

  const finalize = (bucket: BuildBucket): number => {
    if (bucket.leafIndices) {
      bucket.node.childIndices = bucket.leafIndices;
      bucket.node.childCount = bucket.leafIndices.length;
      return bucket.node.childCount;
    }
    let n = 0;
    for (const child of bucket.childByKey.values()) n += finalize(child);
    bucket.node.childCount = n;
    return n;
  };
  finalize(root);

  const includeFooter = opts.includeFooter === true;
  const includeTotalFooter = includeFooter && opts.includeTotalFooter === true;
  const elide = opts.removeSingleChildren ?? false;

  const flatOrder: FlatOrderEntry[] = [];
  const emit = (node: GroupNode): void => {
    const isLeaf = node.childGroups.length === 0;
    const shouldElide = elide === true
      ? node.childCount === 1
      : elide === 'leafGroupsOnly' && isLeaf && node.childCount === 1;

    if (!shouldElide) {
      flatOrder.push({ kind: 'group', key: node.key, depth: node.depth });
    }

    if (isLeaf) {
      for (const idx of node.childIndices) {
        flatOrder.push({ kind: 'row', rowIndex: idx, depth: cols.length });
      }
    } else {
      for (const child of node.childGroups) emit(child);
    }

    if (includeFooter && !shouldElide) {
      flatOrder.push({ kind: 'footer', key: node.key, depth: node.depth + 1 });
    }
  };

  for (const child of root.node.childGroups) emit(child);
  if (includeTotalFooter) {
    flatOrder.push({ kind: 'footer', key: '', depth: 0 });
  }

  return {
    roots: root.node.childGroups,
    flatOrder,
    bypassed: false,
    inputIds,
  };
}

/** Collect leaf row ids under a group (cascade selection). */
export function collectDescendantRowIds(
  node: GroupNode,
  inputIds: readonly string[],
): string[] {
  const out: string[] = [];
  const walk = (n: GroupNode): void => {
    if (n.childGroups.length > 0) {
      for (const c of n.childGroups) walk(c);
      return;
    }
    for (const idx of n.childIndices) {
      const id = inputIds[idx];
      if (id !== undefined) out.push(id);
    }
  };
  walk(node);
  return out;
}

export function findGroupNode(roots: readonly GroupNode[], key: string): GroupNode | null {
  const walk = (nodes: readonly GroupNode[]): GroupNode | null => {
    for (const n of nodes) {
      if (n.key === key) return n;
      const hit = walk(n.childGroups);
      if (hit) return hit;
    }
    return null;
  };
  return walk(roots);
}
