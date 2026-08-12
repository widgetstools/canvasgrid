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

/** Per-call overrides for `sizeColumnsToFit`. Cycle 6 / Task 3. */
export interface SizeColumnsToFitParams {
  /** Width to fit to. Defaults to the container width passed by the
   *  caller — the API surface passes the canvas drawable width (already
   *  excludes the vertical-scrollbar gutter). */
  width?: number;
  defaultMinWidth?: number;
  defaultMaxWidth?: number;
  columnLimits?: Array<{ key: string; minWidth?: number; maxWidth?: number }>;
}

/** Pure helper for `VelocityGridApi.sizeColumnsToFit`. Returns the new widths
 *  keyed by `colId`. Honors `suppressSizeToFit` (the leaf keeps its
 *  current width and the remainder distributes among the rest), per-column
 *  `minWidth` / `maxWidth` (overridden by `params.columnLimits`, then by
 *  `params.defaultMinWidth` / `params.defaultMaxWidth`), and flex weight
 *  (flex columns contribute their flex value to the share pool; non-flex
 *  columns contribute their current width).
 *
 *  Clamp-and-redistribute loop bounded at 5 passes — converges fast.
 *  Floors widths to integers; the rounding remainder lands on the
 *  right-most unclamped leaf so the sum equals the target width exactly.
 *
 *  Pure — does not mutate `cols`. The caller is responsible for writing
 *  the resolved widths back onto the resolved col defs.
 *
 *  Cycle 6 / Task 3. */
export function sizeColumnsToFit<TRow>(
  cols: ResolvedColDef<TRow>[],
  containerWidth: number,
  params: SizeColumnsToFitParams = {},
): Map<string, number> {
  const target = params.width ?? containerWidth;
  const limits = new Map<string, { min?: number; max?: number }>();
  for (const lim of params.columnLimits ?? []) {
    limits.set(lim.key, { min: lim.minWidth, max: lim.maxWidth });
  }
  const defaultMin = params.defaultMinWidth;
  const defaultMax = params.defaultMaxWidth;

  const resolvedMin = (c: ResolvedColDef<TRow>): number => {
    const lim = limits.get(c.colId);
    if (lim?.min != null) return lim.min;
    if (defaultMin != null) return Math.max(defaultMin, c.minWidth);
    return c.minWidth;
  };
  const resolvedMax = (c: ResolvedColDef<TRow>): number => {
    const lim = limits.get(c.colId);
    if (lim?.max != null) return lim.max;
    if (defaultMax != null) return Math.min(defaultMax, c.maxWidth);
    return c.maxWidth;
  };

  const widths = new Map<string, number>();

  // Suppressed leaves keep their current width; their total consumes
  // part of the target.
  let suppressedTotal = 0;
  for (const c of cols) {
    if (c.suppressSizeToFit) {
      const held = c.width ?? 100;
      widths.set(c.colId, held);
      suppressedTotal += held;
    }
  }

  const flexible = cols.filter((c) => !c.suppressSizeToFit);
  let available = target - suppressedTotal;

  // Clamp loop: each pass distributes `available` over `unpinned` by
  // share weight. Columns that clamp to min/max are pinned for the next
  // pass, the clamped widths are subtracted from `available`, and the
  // remaining columns are redistributed. Bounded to 5 passes — converges
  // fast in practice (typically 1-2 passes).
  const pinned = new Set<string>();
  const shareOf = (c: ResolvedColDef<TRow>): number =>
    c.flex != null ? c.flex : Math.max(c.width ?? 100, resolvedMin(c));
  for (let pass = 0; pass < 5; pass++) {
    const unpinned = flexible.filter((c) => !pinned.has(c.colId));
    if (unpinned.length === 0) break;
    let totalShare = 0;
    for (const c of unpinned) totalShare += shareOf(c);
    if (totalShare <= 0) break;
    const newPins: string[] = [];
    let clampedTotal = 0;
    for (const c of unpinned) {
      const targetW = (shareOf(c) / totalShare) * available;
      const min = resolvedMin(c);
      const max = resolvedMax(c);
      if (targetW < min) {
        widths.set(c.colId, min);
        newPins.push(c.colId);
        clampedTotal += min;
      } else if (targetW > max) {
        widths.set(c.colId, max);
        newPins.push(c.colId);
        clampedTotal += max;
      } else {
        widths.set(c.colId, targetW);
      }
    }
    if (newPins.length === 0) break;
    for (const id of newPins) pinned.add(id);
    available -= clampedTotal;
  }

  // Floor to integers; carry the rounding remainder onto the right-most
  // unclamped flexible leaf so the sum equals the target exactly.
  let rounded = 0;
  for (const c of flexible) {
    const w = Math.floor(widths.get(c.colId) ?? 0);
    widths.set(c.colId, w);
    rounded += w;
  }
  const remainder = (target - suppressedTotal) - rounded;
  if (remainder !== 0) {
    for (let i = flexible.length - 1; i >= 0; i--) {
      const c = flexible[i]!;
      if (pinned.has(c.colId)) continue;
      widths.set(c.colId, (widths.get(c.colId) ?? 0) + remainder);
      break;
    }
  }

  return widths;
}
