import type { PainterCtx } from './types';
import type { ViewportColumn } from '../../core/viewport';
import type { CachedContext2D } from '../gc';

/**
 * Paints all grid lines in one pass at the end of a frame.
 *
 * - Verticals: one `fillRect` per column right edge, drawn within each pinned/center
 *   band (clipped, so center cols scrolled past the body don't leak into pinned bands).
 *   Span the full canvas height (0..bodyBottom) so header column separators are
 *   visible too — without this, the header row reads as one merged strip.
 * - Horizontals: one `fillRect` per visible row bottom + every header row bottom,
 *   spanning the full visible width so the line is continuous across pinned bands.
 * - Pinned band edges: one `fillRect` each, using `theme.borderColor` (slightly
 *   heavier than `gridLineColor`) at the right edge of left-pinned and left edge of
 *   right-pinned bands, also spanning the full canvas height.
 *
 * No `strokeRect`, no `stroke()` — every line is a `fillRect` aligned to integer
 * pixels so adjacent lines never re-draw the same pixel.
 *
 * Task 4 (paint-cache layer) — `mode` splits this single pass into its
 * DATA-region half (drawn into the retained layer, against `layerVs`) and
 * its CHROME half (drawn on-screen, against the real `vs`) per spec §3.
 * `undefined` (the default) is the unmodified legacy behavior — one
 * continuous pass, used by `Renderer.paint()` (`paintCache:false` / layer
 * unavailable). Every line this painter draws is a `fillRect` (never a
 * stroked/anti-aliased path), so splitting a continuous line into a
 * chrome-side segment + a data-side segment that share an exact boundary
 * produces bit-identical pixels to the single-pass line — the split is a
 * bookkeeping device, not a visual difference.
 */
export function paintGridLines(gc: CachedContext2D, p: PainterCtx, mode?: 'layer' | 'chrome'): void {
  const { viewport: vs, theme } = p;
  if (vs.visibleColumns.length === 0 && vs.visibleRows.length === 0) return;
  const dataOnly = mode === 'layer';
  const chromeOnly = mode === 'chrome';

  // Full right edge of the painted area: rightmost visible column or the body
  // right (whichever is larger; rightPinned columns extend past bodyRight).
  // Cycle 25 / Task 5 — manual scan to avoid the .map + spread.
  let rightEdge = vs.bodyRight;
  for (let i = 0; i < vs.visibleColumns.length; i++) {
    const r = vs.visibleColumns[i]!.right;
    if (r > rightEdge) rightEdge = r;
  }

  // Locate the LEAF-header row top — the last header subgrid is the leaf
  // header; any rows above it are group-header rows. Collect the group-header
  // rows (those exposing `getGroupIdAt`) top→bottom: the vertical-separator
  // pass below walks them to find where two adjacent columns' group ancestry
  // diverges, which is where their shared merged cell (if any) ends and an
  // explicit border must begin — AG-Grid's "span height" border semantics.
  let leafHeaderTop = 0;
  const groupHeaderRows: GroupHeaderRowRef[] = [];
  for (const row of vs.visibleRows) {
    if (!row.subgrid.isHeader) continue;
    leafHeaderTop = row.top;
    const sg = row.subgrid as { getGroupIdAt?: (colId: string) => string | null };
    if (typeof sg.getGroupIdAt === 'function') {
      groupHeaderRows.push({
        top: row.top,
        bottom: row.bottom,
        getGroupIdAt: sg.getGroupIdAt.bind(sg),
      });
    }
  }

  // Split visible columns into pinned/center bands once — both the
  // horizontal (group-row segments) and vertical passes below are per-band.
  const leftPinned: typeof vs.visibleColumns = [];
  const center: typeof vs.visibleColumns = [];
  const rightPinned: typeof vs.visibleColumns = [];
  for (let i = 0; i < vs.visibleColumns.length; i++) {
    const col = vs.visibleColumns[i]!;
    if (col.pinned === 'left') leftPinned.push(col);
    else if (col.pinned === 'right') rightPinned.push(col);
    else center.push(col);
  }

  // Horizontals — one per visible row bottom for BOTH header and data rows.
  // Group-header rows are the exception (AG-Grid parity): the line below a
  // group row only spans the columns that actually HAVE a group cell at that
  // depth. Columns whose ancestry ended above render as one tall merged leaf
  // cell (span-height) and must not be sliced by a full-width horizontal.
  // Skip data rows whose bottom lands outside the body region (overscan
  // rows above/below). Pinned rows (Cycle 14 / Task 2) paint gridlines too
  // so multi-pinned stacks read as connected member rows; the structural
  // border pass below overpaints the body-side edge with `pinnedRowBorder`
  // so the transition between the pinned stack and the scrollable body
  // reads as a single deliberate hairline.
  gc.cache.fillStyle = theme.gridLineColor;
  for (const row of vs.visibleRows) {
    // Task 4 — region filter: the layer pass draws data-row gridlines
    // only; the chrome pass draws header/pinned (+totals, skipped below)
    // gridlines only.
    if (dataOnly && !row.subgrid.isData) continue;
    if (chromeOnly && row.subgrid.isData) continue;
    if (row.subgrid.isData) {
      if (row.bottom <= vs.bodyTop || row.bottom > vs.bodyBottom) continue;
    } else if (!row.subgrid.isHeader && !row.subgrid.isPinned) {
      continue; // totals/footer skip the per-row gridline (totals draws its own border below)
    }
    const y = Math.round(row.bottom) - 1;
    const sg = row.subgrid as { getGroupIdAt?: (colId: string) => string | null };
    if (row.subgrid.isHeader && typeof sg.getGroupIdAt === 'function') {
      const getGroupIdAt = sg.getGroupIdAt.bind(sg);
      paintGroupRowBottomInBand(gc, leftPinned, 0, vs.bodyLeft, y, getGroupIdAt);
      paintGroupRowBottomInBand(gc, center, vs.bodyLeft, vs.bodyRight, y, getGroupIdAt);
      paintGroupRowBottomInBand(gc, rightPinned, vs.bodyRight, rightEdge, y, getGroupIdAt);
      continue;
    }
    gc.fillRect(0, y, rightEdge, 1);
  }

  // Cycle 14 / Task 1 — totals row top border. The single "hairline lift"
  // signature from the design plan — 1px solid `theme.totalsBorderTop`
  // painted at `Math.round(row.top) - 1`. Mirrors the bodyTop separator
  // idiom further down, so the rule reads as part of the grid's visual
  // grammar (not a one-off). Only the FIRST totals-row in stack gets a
  // top border (a multi-row pinned totals subgrid is rare; if a future
  // task ships one, this loop already handles it because every row's
  // own top gets its rule).
  // Task 4 — totals rows are chrome (never data-subgrid); the layer pass
  // skips this border entirely.
  if (!dataOnly) {
    for (const row of vs.visibleRows) {
      if (!row.subgrid.isTotals) continue;
      gc.cache.fillStyle = theme.totalsBorderTop;
      gc.fillRect(0, Math.round(row.top) - 1, rightEdge, 1);
    }
  }

  // Cycle 15 / Task 12 — per-group footer row top border. Same hairline
  // lift signature as the grand-totals row but painted on inline footer
  // rows (DataSubgrid rows whose `chunk.rowKinds[localIndex] === 3`).
  // Reads `theme.groupFooterBorderTop` so apps can dial the per-group
  // border independently of the grand-total. Painted AFTER the data-row
  // gridline above (drawn at `row.top - 1` so it overpaints the gridline
  // at the row immediately above the footer). Guarded for partial
  // PainterCtx instances built by older tests (the probe is optional).
  // Task 4 — per-group footer rows live inside the DataSubgrid; the
  // chrome pass skips this border entirely.
  const rowKindAt = p.rowKindAt;
  if (rowKindAt && !chromeOnly) {
    for (const row of vs.visibleRows) {
      if (!row.subgrid.isData) continue;
      if (rowKindAt(row.localRowIndex) !== 3) continue;
      gc.cache.fillStyle = theme.groupFooterBorderTop;
      gc.fillRect(0, Math.round(row.top) - 1, rightEdge, 1);
    }
  }

  // Verticals — one band at a time so out-of-band column lines stay clipped.
  // Span from the pair's border top (see `verticalTopForPair`) to the bottom
  // of the LAST rendered row so column separators don't bleed into empty
  // canvas below the data.
  //
  // AG-Grid parity: the separator between two adjacent columns starts at the
  // top of the FIRST header row where their group ancestry diverges — or
  // where both ancestries end (two span-height cells side by side). Inside a
  // shared merged group cell no line paints; at a group boundary the line
  // starts at that group row's top, so every group reads as a bordered
  // island containing its children.

  // Compute the bottom of the last visible non-header row; if there are no
  // data/totals rows yet, fall back to bodyTop (verticals span header only).
  // Task 4 — under `dataOnly`, the layer pass only ever wants DATA rows'
  // bottoms (totals/pinned bands laid out against `layerVs` land at
  // BOGUS y-positions — `buildLayerViewport`'s synthetic `scrollTop:
  // layerTop` only keeps header/floating-filter placement correct;
  // post-data subgrids' position depends on where the real scroll
  // window's data ends, which `layerVs` does NOT reproduce). Under
  // `chromeOnly`, verticals/pinned-edges stop exactly at `vs.bodyTop`
  // (computed via the ternaries below) so this scan is skipped entirely.
  let lastRowBottom = vs.bodyTop;
  if (!chromeOnly) {
    for (const row of vs.visibleRows) {
      if (row.subgrid.isHeader) continue;
      if (dataOnly && !row.subgrid.isData) continue;
      const b = Math.min(row.bottom, vs.bodyBottom);
      if (b > lastRowBottom) lastRowBottom = b;
    }
  }

  // Task 4 — chrome draws the header-region segment only (stops at
  // `vs.bodyTop`, using the real ancestry-divergence tops); the layer
  // draws the data-region segment only (starts at `vs.bodyTop`, straight
  // down — no group-header divergence applies to data rows, so an empty
  // `groupHeaderRows` list makes `verticalTopForPair` fall through to its
  // `leafHeaderTop` fallback, which is `vs.bodyTop` in this branch).
  const vertTop = dataOnly ? vs.bodyTop : leafHeaderTop;
  const vertGroupHeaderRows = dataOnly ? [] : groupHeaderRows;
  const vertBottom = chromeOnly ? vs.bodyTop : lastRowBottom;

  paintVerticalsInBand(gc, leftPinned, 0, vs.bodyLeft, vertTop, vertBottom, theme.gridLineColor, vertGroupHeaderRows);
  paintVerticalsInBand(gc, center, vs.bodyLeft, vs.bodyRight, vertTop, vertBottom, theme.gridLineColor, vertGroupHeaderRows);
  paintVerticalsInBand(gc, rightPinned, vs.bodyRight, rightEdge, vertTop, vertBottom, theme.gridLineColor, vertGroupHeaderRows);

  // Pinned-band edges — heavier line via theme.borderColor. Same chrome/
  // layer split as verticals above, but the edge always starts at
  // absolute 0 on the chrome side (not `leafHeaderTop` — this line has no
  // per-pair divergence math, it always ran from the canvas top).
  const edgeTop = dataOnly ? vs.bodyTop : 0;
  if (leftPinned.length > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(Math.round(vs.bodyLeft) - 1, edgeTop, 1, vertBottom - edgeTop);
  }
  if (rightPinned.length > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(Math.round(vs.bodyRight), edgeTop, 1, vertBottom - edgeTop);
  }

  // Subgrid separator — header→body. The leaf-header bottom already paints a
  // gridLineColor horizontal above; this overlays a slightly heavier borderColor
  // line at exactly bodyTop - 1 so the transition reads clearly.
  // Task 4 — chrome-only (sits entirely above bodyTop, the header/body seam).
  if (!dataOnly && vs.bodyTop > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(0, Math.round(vs.bodyTop) - 1, rightEdge, 1);
  }

  // Header→floating-filter separator. The header row's horizontal gridline
  // already lands at floatingFilterRowTop - 1 (gridLineColor); overpaint with
  // borderColor so the transition reads as a deliberate divider, mirroring
  // the header→body separator at bodyTop above. Task 4 — chrome-only.
  if (!dataOnly && vs.floatingFilterRowTop !== undefined && vs.floatingFilterRowTop > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(0, Math.round(vs.floatingFilterRowTop) - 1, rightEdge, 1);
  }

  // Cycle 14 / Task 2 — pinned stack ↔ data structural border. Painted
  // LAST so it overpaints both the per-row gridline (laid down in the
  // horizontals pass above) AND the bodyTop separator (when pinned-top
  // pushes bodyTop down to the bottom of the pinned stack). This keeps
  // BOTH pinned↔data boundaries — top stack ↔ data and data ↔ bottom
  // stack — at the same `theme.pinnedRowBorder` hairline color, matching
  // the design plan's "same border color on both pinned and totals".
  // The pinned↔totals transition is intentionally NOT drawn here: the
  // totals row paints its own top border above, which is the body-edge
  // boundary for that pair.
  // Task 4 — chrome-only: this is a pinned/data SEAM, always resolved
  // against the REAL `vs` (pinned rows are screen-anchored chrome); the
  // layer pass never draws it.
  if (!dataOnly) {
    for (let r = 0; r < vs.visibleRows.length; r++) {
      const a = vs.visibleRows[r]!;
      const b = vs.visibleRows[r + 1];
      if (!b) continue;
      const aPinned = a.subgrid.isPinned === true;
      const bPinned = b.subgrid.isPinned === true;
      if (aPinned === bPinned) continue;
      if (!(a.subgrid.isData || b.subgrid.isData)) continue;
      gc.cache.fillStyle = theme.pinnedRowBorder;
      gc.fillRect(0, Math.round(a.bottom) - 1, rightEdge, 1);
    }
  }
}

/** One group-header row's geometry + groupId probe, top→bottom ordered. */
interface GroupHeaderRowRef {
  top: number;
  bottom: number;
  getGroupIdAt: (colId: string) => string | null;
}

/** Where the vertical separator between two adjacent columns starts.
 *
 *  Walk the group-header rows top→bottom:
 *  - same non-null groupId on both sides → still inside a shared merged
 *    group cell; keep walking (no border at this depth).
 *  - differing groupIds → ancestry diverges here; the border starts at
 *    this row's top (group boundary, or group vs span-height cell).
 *  - both null → both columns' ancestry ended above; they render as two
 *    adjacent span-height leaf cells from this row down, separated by a
 *    border starting here (AG-Grid `headerColumnBorder` semantics).
 *
 *  Two leaves sharing every group row (same innermost group) divide only
 *  from the leaf-header row down. */
function verticalTopForPair(
  a: ViewportColumn,
  b: ViewportColumn,
  groupHeaderRows: GroupHeaderRowRef[],
  leafHeaderTop: number,
): number {
  for (const row of groupHeaderRows) {
    const ga = row.getGroupIdAt(a.colId);
    const gb = row.getGroupIdAt(b.colId);
    if (ga === gb && ga !== null) continue;
    return row.top;
  }
  return leafHeaderTop;
}

function paintVerticalsInBand(
  gc: CachedContext2D,
  cols: ViewportColumn[],
  bandLeft: number,
  bandRight: number,
  leafHeaderTop: number,
  bottom: number,
  color: string,
  groupHeaderRows: GroupHeaderRowRef[],
): void {
  if (cols.length <= 1) return;
  gc.cache.save();
  gc.beginPath();
  const clipTop = groupHeaderRows.length > 0
    ? Math.min(leafHeaderTop, groupHeaderRows[0]!.top)
    : leafHeaderTop;
  gc.rect(bandLeft, clipTop, bandRight - bandLeft, bottom - clipTop);
  gc.clip();
  gc.cache.fillStyle = color;
  // Skip the last column — its right edge is the band boundary (or the viewport
  // edge for the rightmost band) and is either drawn as a band-edge line or
  // doesn't need one at all.
  for (let i = 0; i < cols.length - 1; i++) {
    const top = verticalTopForPair(cols[i]!, cols[i + 1]!, groupHeaderRows, leafHeaderTop);
    const x = Math.round(cols[i]!.right) - 1;
    gc.fillRect(x, top, 1, bottom - top);
  }
  gc.cache.restore();
}

/** Paint the horizontal line at a group-header row's bottom, but only
 *  across columns that HAVE a group cell at this row's depth. Columns
 *  whose ancestry ended above are span-height leaf cells — the line must
 *  not slice through them. Adjacent grouped columns merge into one run
 *  (the border under two side-by-side group cells is continuous). */
function paintGroupRowBottomInBand(
  gc: CachedContext2D,
  cols: ViewportColumn[],
  bandLeft: number,
  bandRight: number,
  y: number,
  getGroupIdAt: (colId: string) => string | null,
): void {
  if (cols.length === 0) return;
  gc.cache.save();
  gc.beginPath();
  gc.rect(bandLeft, y, bandRight - bandLeft, 1);
  gc.clip();
  let runLeft: number | null = null;
  let runRight = 0;
  for (const col of cols) {
    if (getGroupIdAt(col.colId) !== null) {
      if (runLeft === null) runLeft = col.left;
      runRight = col.right;
    } else if (runLeft !== null) {
      gc.fillRect(Math.round(runLeft), y, Math.round(runRight) - Math.round(runLeft), 1);
      runLeft = null;
    }
  }
  if (runLeft !== null) {
    gc.fillRect(Math.round(runLeft), y, Math.round(runRight) - Math.round(runLeft), 1);
  }
  gc.cache.restore();
}
