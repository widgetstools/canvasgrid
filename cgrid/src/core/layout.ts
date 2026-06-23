import type { ResolvedColDef } from './propertyChain';

export interface ColumnLayout {
  colId: string;
  left: number;
  width: number;
  pinned?: 'left' | 'right';
}

export function resolveColumnWidths<TRow>(
  cols: ResolvedColDef<TRow>[],
  containerWidth: number,
): ColumnLayout[] {
  // Pass 1: assign fixed widths; mark flex columns as -1.
  const widths = cols.map((c) => {
    if (c.width != null) return clamp(c.width, c.minWidth, c.maxWidth);
    if (c.flex == null) return clamp(100, c.minWidth, c.maxWidth); // default 100
    return -1; // marker for flex
  });

  const fixedTotal = widths.reduce((s, w) => s + (w >= 0 ? w : 0), 0);
  const remaining = Math.max(0, containerWidth - fixedTotal);
  const flexSum = cols.reduce(
    (s, c, i) => s + (widths[i] === -1 ? (c.flex ?? 0) : 0),
    0,
  );

  // Pass 2: distribute remaining space over flex columns respecting min/max.
  let leftover = remaining;
  let flexLeft = flexSum;
  for (let i = 0; i < cols.length; i++) {
    if (widths[i] !== -1) continue;
    const col = cols[i]!;
    const share =
      flexLeft > 0 ? Math.floor((leftover * (col.flex ?? 0)) / flexLeft) : 0;
    const w = clamp(share, col.minWidth, col.maxWidth);
    widths[i] = w;
    leftover -= w;
    flexLeft -= col.flex ?? 0;
  }

  // Pass 3: lay out columns in pinned-left → body → pinned-right order.
  const out: ColumnLayout[] = [];
  let left = 0;

  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    if (col.pinned !== 'left') continue;
    const w = widths[i]!;
    out.push({ colId: col.colId, left, width: w, pinned: 'left' });
    left += w;
  }
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    if (col.pinned) continue;
    const w = widths[i]!;
    out.push({ colId: col.colId, left, width: w });
    left += w;
  }
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    if (col.pinned !== 'right') continue;
    const w = widths[i]!;
    out.push({ colId: col.colId, left, width: w, pinned: 'right' });
    left += w;
  }

  return out;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
