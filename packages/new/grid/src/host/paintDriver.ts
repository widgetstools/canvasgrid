/**
 * Paint driver — the host's frame pipeline.
 *
 * Owns damage requests, the retained-pixel surfaces (paint-cache layer, Tier-2
 * row-strip cache, cell bitmap cache), the layer viewport memo, the flash alpha
 * mask rebuild, and paint telemetry. Extracted from `velocityGrid.ts` as part
 * of splitting the god object (SPEC.md §3 module boundaries).
 *
 * This is a re-seaming, not a redesign: the method bodies are the legacy ones
 * verbatim, so paint order and coordinate spaces (SPEC.md §1.1) stay exactly as
 * the renderer defines them. The driver never re-derives geometry — it asks the
 * host, which owns the single `renderSurface`.
 *
 * The seam is the fat {@link PaintDriverHost} interface, the same `Deps`
 * pattern the ported coordinators (`ColumnStateManagerDeps`,
 * `PivotEngineDeps`, `GroupingCoordinatorDeps`) already use. Retained-paint
 * state stays on the host because ~60 call sites elsewhere in the host read and
 * write it; moving it would have spread this change across the whole file
 * rather than isolating the pipeline.
 */

import type { VelocityGridOptions } from '../types';
import type { PaintStats } from '../types/api';
import { applyCellProps, type ResolvedColDef } from '../core/propertyChain';
import type { ColumnLayout } from '../core/layout';
import { computeViewport, type ViewportState } from '../core/viewport';
import type { RowHeightIndex } from '../core/rowHeightIndex';
import {
  DamageLedger,
  dataRectToScreen,
  screenYToContentY,
  type DamageResolveCtx,
  type Rect,
} from '../core/damageLedger';
import { getRuleEngine } from '../core/ruleEngineSlot';
import { getCalcProvider } from '../core/calcSlot';
import { PaintCacheLayer, defaultCanvasFactory, type LayerGeometry } from '../core/paintCache';
import type { FlashRegistry } from '../core/flashRegistry';
import { buildFlashAlphaMask } from '../core/flashAlphaMask';
import type { VelocityGridCanvas } from '../core/canvas';
import { PinnedRowsSubgrid, type Subgrid } from '../core/subgrid';
import { RasterBudget, CellBitmapCache, RowStripCache } from '../renderer/rasterCache';
import type { RasterCellsCtx, RasterStripsCtx } from '../renderer/painters/types';
import type { CellRendererRegistry, CellPaintConfig } from '../renderer/cellRenderers/registry';
import type { CachedContext2D } from '../renderer/gc';
import type { Renderer } from '../renderer/renderer';
import { resolveDrawableCellIcon } from '../renderer/painters/byRows';
import type { ResolvedTheme } from '../theming/cssReader';
import type { SelectionModel } from '../interaction/selectionModel';
import type { ViewportChunk, StickyAncestor } from '../worker/protocol';

/**
 * Host seam. Every member the paint pipeline reaches for, and nothing else.
 * `VelocityGrid` satisfies this structurally.
 */
export interface PaintDriverHost<TRow = any> {
  // ── surfaces + geometry ──────────────────────────────────────────────
  readonly root: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  cgridCanvas: VelocityGridCanvas;
  canvasBounds: { width: number; height: number };
  viewport: ViewportState;
  subgrids: Subgrid[];
  renderer: Renderer;
  theme: ResolvedTheme;
  getThemeKind(): 'light' | 'dark';

  // ── options + column model ───────────────────────────────────────────
  options: VelocityGridOptions<TRow>;
  readonly columnLayout: ColumnLayout[];
  columnDefsMap: Map<string, ResolvedColDef<TRow>>;
  cellRenderers: CellRendererRegistry;
  columnResizeDragActive: boolean;

  // ── data window ──────────────────────────────────────────────────────
  chunk: ViewportChunk | null;
  rowHeightIndex: RowHeightIndex | null;
  rowHeightAt(localRowIndex: number): number;
  stringRowIdAt(rowIndex: number): string | null;
  rowDataById: Map<string, TRow>;
  rowDataSnapshotAt(rowIndex: number): Record<string, unknown>;
  cellAt(rowIndex: number, colId: string): {
    value: unknown;
    valueFormatted: string;
    flashAlpha?: number;
    flashColor?: string;
  } | null;
  stickyAncestors: StickyAncestor[];
  quickFilterLowerTerms: readonly string[];
  hoveredRowIndex: number | null;
  selection: SelectionModel;

  // ── retained paint state (owned by the host, driven from here) ───────
  readonly damageLedger: DamageLedger;
  paintStats: PaintStats;
  layoutPaintEpoch: number;
  paintCacheLayer: PaintCacheLayer | null;
  paintCacheLayerAnchored: boolean;
  paintCacheDeferLayer: boolean;
  layerViewportCache: {
    vs: ViewportState;
    layerTop: number;
    layerHeight: number;
    layoutPaintEpoch: number;
    result: ViewportState;
  } | null;
  rasterBudget: RasterBudget | null;
  rasterCells: CellBitmapCache | null;
  rasterCellsDpr: number;
  rasterStrips: RowStripCache | null;
  rasterStripsCtxMemoHolder?: never;
  stripsCtxMemo: RasterStripsCtx | null;
  stripLayoutEpoch: number;
  stripScrollLeft: number;
  rowVersionByRowId: Map<string, number>;

  // ── flash ────────────────────────────────────────────────────────────
  flashRegistry: FlashRegistry;
  flashAlphaMask: Float32Array | null;
  flashAlphaMaskColIds: string[];
  flashAlphaMaskColIndex: Map<string, number>;
  flashAlphaMaskOut: Float32Array | undefined;
}

export class PaintDriver<TRow = any> {
  constructor(private readonly host: PaintDriverHost<TRow>) {}

  /**
   * Damage-region rendering — record a full-surface repaint on the ledger
   * and request the next frame. Equivalent to today's `refresh()`/
   * `requestRepaint()` but goes through the ledger so a `suppressPartialRepaint`
   * flip mid-frame-batch can't leave stale partial damage queued underneath
   * a full one (`DamageLedger.add({kind:'full'})` clears any pending entries).
   */
  repaintFull(): void {
    this.host.damageLedger.add({ kind: 'full' });
    this.host.cgridCanvas?.requestRepaint();
  }

  /**
   * Damage-region rendering — record damage for a set of DATA-row indices
   * (same index space as `cellAt`'s `rowIndex` / the chunk's `rowStart`-
   * relative local index) and request the next frame. `suppressPartialRepaint`
   * degrades this to a full repaint. No call site migrates to this helper
   * in this task — it's plumbed for later tasks (hover/selection/scroll).
   */
  repaintRows(rowIndices: number[]): void {
    // Cycle 22 / Task 3 — rowVersionByRowId contract: 'rows' damage bumps
    // every damaged row's strip version, so a Tier-2 strip captured before
    // this damage can never be consumed again (the next layer raster of
    // the row paints live and re-captures). Deliberately ABOVE the
    // suppressPartialRepaint short-circuit: while suppressed the grid
    // paints through the legacy full path (strips dormant), but retained
    // strips + versions must keep tracking damage or flipping the option
    // back off would consume pre-flip pixels at matching versions. Zero
    // cost when strips are off.
    if (this.host.rasterStrips !== null) {
      for (const r of rowIndices) {
        const id = this.host.stringRowIdAt(r);
        if (id !== null && id !== '') {
          this.host.rowVersionByRowId.set(id, (this.host.rowVersionByRowId.get(id) ?? 0) + 1);
        }
      }
    }
    if (this.host.options.suppressPartialRepaint) { this.repaintFull(); return; }
    this.host.damageLedger.add({ kind: 'rows', rowIndices });
    this.host.cgridCanvas.requestRepaint();
  }

  /**
   * Damage-region rendering — record damage for a set of (rowId, colId)
   * cells and request the next frame. `suppressPartialRepaint` degrades
   * this to a full repaint. No call site migrates to this helper in this
   * task — it's plumbed for later tasks (flash, cell edits, formula recalc).
   */
  repaintCells(cells: Array<{ rowId: number; colId: string }>): void {
    // Cycle 22 / Task 3 — rowVersionByRowId contract ('cells' damage) +
    // patch-on-tick. Runs BEFORE the ledger add / repaint request, so the
    // layer raster that consumes the resolved cell rects on the next frame
    // already sees the advanced versions (and, when the patch succeeded,
    // an up-to-date strip that HITS at the new version instead of forcing
    // a full row re-raster). ABOVE the suppressPartialRepaint
    // short-circuit for the same reason as `repaintRows` — retained
    // strips must keep tracking damage while suppressed.
    if (this.host.rasterStrips !== null && cells.length > 0) {
      this.applyStripCellDamage(cells);
    }
    if (this.host.options.suppressPartialRepaint) { this.repaintFull(); return; }
    this.host.damageLedger.add({ kind: 'cells', cells });
    this.host.cgridCanvas.requestRepaint();
  }

  /**
   * Cycle 22 / closeout I-4 — the flash-fade per-rAF repaint path.
   * Identical to `repaintCells` MINUS the Tier-2 strip bookkeeping: a fade
   * frame carries NO content change — the ORIGINAL tick's damage already
   * bumped the row version and patched (or dropped) the strip — so per-rAF
   * version bumps and re-patches of the same settled span (~90 frames per
   * 1.5s fade, `localByNumericId` rebuilt O(chunk) each) are pure hot-path
   * waste, and a version bump WITHOUT the matching patch would force a
   * needless full-row re-raster at fade settle. While the fade runs the
   * row is strip-ineligible (live flash) and paints live; at settle the
   * strip patched at tick time hits at the still-current version. Visible
   * fade behavior is untouched — same ledger damage, same repaint request.
   * (`api.flashCells` without a data change is also correct here: nothing
   * changed, so the retained strip's settled pixels stay valid.)
   */
  repaintCellsFlashFade(cells: Array<{ rowId: number; colId: string }>): void {
    if (this.host.options.suppressPartialRepaint) { this.repaintFull(); return; }
    this.host.damageLedger.add({ kind: 'cells', cells });
    this.host.cgridCanvas.requestRepaint();
  }

  /**
   * Cycle 22 / closeout I-3 — re-capture seam for rows whose tick-time
   * strip patch BAILED (icon cell, last-in-band damaged column, fractional
   * geometry — the strip was dropped, correctly). While such a row keeps
   * flashing it is strip-ineligible, and once settled nothing ever damages
   * it full-width again: cell-sized fade rects can never re-capture, so
   * the row would paint live at EVERY subsequent raster — the exact
   * "stripPatches = 0 and strips stay cold under steady ticking" shape the
   * closeout measured on the live feed. Called from the flash registry
   * when a row's last flash expires (it is eligible again): if the strip
   * is still current (the tick-time patch SUCCEEDED), do nothing — a row
   * repaint would only bump the version and waste the patch. Otherwise
   * issue one row-level repaint; the resulting full-width raster of the
   * settled row re-captures it, and every later raster HITS.
   */
  recaptureSettledFlashRows(rowIds: number[]): void {
    const strips = this.host.rasterStrips;
    const chunk = this.host.chunk;
    if (strips === null || !strips.available || chunk === null) return;
    let rowIndices: number[] | null = null;
    for (const nid of rowIds) {
      // O(chunk) per settled row is fine: settle batches are small (a few
      // rows per flash generation) and this runs once per generation, not
      // per rAF.
      let local = -1;
      for (let i = 0; i < chunk.rowCount; i++) {
        if (chunk.rowIds[i] === nid) { local = i; break; }
      }
      if (local === -1) continue; // scrolled out of the window — nothing retained to warm
      const sid = chunk.stringRowIds?.[local];
      if (sid === undefined || sid === null || sid === '') continue;
      const version = this.host.rowVersionByRowId.get(sid) ?? 0;
      if (strips.get(sid, version, this.host.stripLayoutEpoch) !== null) continue; // patched & current — keep it
      (rowIndices ??= []).push(chunk.rowStart + local);
    }
    if (rowIndices !== null) this.repaintRows(rowIndices);
  }

  /**
   * Cycle 22 / Task 3 — the cell-damage half of the Tier-2 bookkeeping.
   * For every damaged (numeric rowId, colId) cell that resolves into the
   * current chunk window:
   *  1. bump the row's `rowVersionByRowId` entry (once per row per call);
   *  2. when a strip is retained for the row, PATCH the damaged cell spans
   *     in place — repaint just those spans inside the strip via the live
   *     cell painter (flash suppressed: a strip must only ever hold the
   *     row's SETTLED pixels) and advance the stored version so the next
   *     consume hits without a full row re-raster;
   *  3. when ANY span can't be patched safely (column not fully visible in
   *     its band, last-in-band right edge, icon/rule-indicator cell,
   *     fractional geometry, a live cross-column dependency — see
   *     `stripPatchCrossColumnSafe`), drop the strip instead — a bypass is
   *     a perf miss, a stale strip is a bug.
   */
  applyStripCellDamage(cells: Array<{ rowId: number; colId: string }>): void {
    const strips = this.host.rasterStrips;
    const chunk = this.host.chunk;
    if (strips === null || chunk === null) return;
    // numeric rowId → chunk-local index (numeric ids are the damage keys;
    // strips + versions key on string rowIds).
    const localByNumericId = new Map<number, number>();
    for (let i = 0; i < chunk.rowCount; i++) localByNumericId.set(chunk.rowIds[i]!, i);
    const colsByLocal = new Map<number, string[]>();
    for (const c of cells) {
      const local = localByNumericId.get(c.rowId);
      if (local === undefined) continue;
      const list = colsByLocal.get(local);
      if (list === undefined) colsByLocal.set(local, [c.colId]);
      else if (!list.includes(c.colId)) list.push(c.colId);
    }
    // Carry-forward (Task 1): `patch` maps CSS-px spans onto the strip's
    // device backing store — it MUST receive the LIVE dpr or strips
    // corrupt at dpr≠1. Same read discipline as `getRasterCellsCtx`.
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // Cycle 22 / closeout I-2 (adjudicated BYPASS) — at non-integer dpr the
    // patch rounds its span origin (`x0 = round(xCss*dpr)`), so painter
    // output can land sub-pixel-shifted vs the live raster. Never patch:
    // drop the strip instead (versions keep tracking; the next full-row
    // raster re-captures). Capture/consume stay on — they are pure
    // integer-device-px copies of the layer's own raster.
    const dprPatchable = Number.isInteger(dpr);
    // Cycle 22 / closeout N-1 — cross-column dependency bail. The damage
    // this helper receives is RAW-FIELD-granular (the tick seam derives it
    // from the worker's flashMask = diffRowFields ∧ column.field), yet a
    // committed patch advances the strip to FULL-ROW validity at the final
    // version. Any column whose pixels can change WITHOUT its own field
    // being flagged — a calc column computed from the ticked field
    // (fieldless, never flagged by construction) or a row-scope rule STYLE
    // repainting an unflagged span (the `ruleIndicator` bail in
    // `patchStripCells` covers indicators only) — would keep PRE-TICK
    // pixels in its span, and the settle/scroll consume would serve them
    // at rest. While either hazard is live, never patch: drop the strip
    // (versions keep tracking; the `onRowsSettled` recapture heals the row
    // with one full-width raster — Run C measured recapture alone as
    // sufficient to sustain the Tier-2 win). A bypass is a perf miss, a
    // stale strip is a bug.
    const crossColumnSafe = this.stripPatchCrossColumnSafe();
    for (const [local, colIds] of colsByLocal) {
      const rowId = chunk.stringRowIds?.[local];
      if (rowId === undefined || rowId === null || rowId === '') continue;
      const rowIndex = chunk.rowStart + local;
      const newVersion = (this.host.rowVersionByRowId.get(rowId) ?? 0) + 1;
      this.host.rowVersionByRowId.set(rowId, newVersion);
      if (!strips.available || !strips.has(rowId)) continue;
      if (!dprPatchable || !crossColumnSafe
        || !this.patchStripCells(strips, rowIndex, rowId, newVersion, colIds, dpr)) {
        strips.invalidateRow(rowId);
      }
    }
  }

  /**
   * Cycle 22 / closeout N-1 — is a cell-granular strip patch safe against
   * cross-column dependencies? `false` (BYPASS — the caller drops the
   * strip instead of patching) whenever:
   *  - a calc-column provider is registered AND at least one of its
   *    synthesized (fieldless) calc columns is VISIBLE: its value can
   *    change when a raw input field ticks, but the flashMask never flags
   *    it, so its span would survive a patch with pre-tick pixels;
   *  - a rule engine is registered with ≥1 rule — row-scope rule styles
   *    can repaint spans whose own field never ticked. An engine that
   *    doesn't expose `getRules` (a paint-only adapter) has an UNKNOWN
   *    rule set — ambiguous, and ambiguous means BYPASS;
   *  - ANY visible column carries a compiled format program (string-DSL
   *    `_formatProgram` or composite `_compositeProgram`): every program
   *    evaluates against the FULL row (`FormatEvalCtxShape.row` — e.g.
   *    `[color=[qty] > 100]` on the price column), so a tick on field A
   *    can restyle column B's span without B ever being flagged. The
   *    `tiers` flags CANNOT prove row-independence — the `=expr`
   *    value-formatter form is tier0-flagged yet evaluates against the
   *    row — so per the house rule (ambiguous means BYPASS) ANY compiled
   *    program bails; a compile-time `usesRowFields` flag on
   *    `FormatProgramShape` (precedented by `hasRuleRefs`) is the filed
   *    refinement that would re-enable patching for value-only programs.
   * Cheap: runs once per damage batch (not per span); the format scan is
   * O(visible columns), and all three slots are empty for grids that
   * never wire @wellsfargo-starui/velocity-grid-format / @wellsfargo-starui/velocity-grid-calc / @wellsfargo-starui/velocity-grid-rules.
   */
  stripPatchCrossColumnSafe(): boolean {
    const engine = getRuleEngine();
    if (engine !== null) {
      const rules = engine.getRules?.();
      if (rules === undefined || rules.length > 0) return false;
    }
    const visible = this.host.viewport.visibleColumns;
    for (const col of visible) {
      const def = this.host.columnDefsMap.get(col.colId);
      if (def !== undefined
        && (def._formatProgram !== undefined || def._compositeProgram !== undefined)) {
        return false;
      }
    }
    const provider = getCalcProvider();
    if (provider !== null) {
      const synthesized = provider.synthesizedColDefs();
      if (synthesized.length > 0) {
        for (const def of synthesized) {
          const colId = def.colId;
          if (typeof colId === 'string' && visible.some((c) => c.colId === colId)) return false;
        }
      }
    }
    return true;
  }

  /**
   * Cycle 22 / Task 3 — patch every damaged cell span of one retained
   * strip in place. Reproduces EXACTLY what the live layer raster lays
   * down for that span, in the same order: row bg fill → cell painter
   * (the Tier-1/live cell paint, bounds rebased to the span origin, flash
   * suppressed) → the span's slice of the row's bottom horizontal
   * gridline → the column's interior right-edge vertical. Returns `false`
   * on ANY ambiguity — the caller drops the strip so it can never go
   * stale (the version was already bumped; the next full-row raster
   * re-captures).
   */
  patchStripCells(
    strips: RowStripCache,
    rowIndex: number,
    rowId: string,
    newVersion: number,
    colIds: string[],
    dpr: number,
  ): boolean {
    const vs = this.host.viewport;
    const theme = this.host.theme;
    // NOTE: deliberately NOT gated on `stripRowEligible` — a FLASHING
    // row's strip is exactly what patch-on-tick exists for: the row
    // paints live (bypass) while the flash runs, and the patched strip
    // (settled pixels, new version) hits the moment the flash fades. An
    // active quick filter can't reach here: activating it bumps the
    // layout epoch (wiping every strip), so `strips.has()` upstream
    // already returned false.
    const hCss = this.host.rowHeightAt(rowIndex);
    // The strip's device height must match what this row's patch assumes,
    // and the gridline math below assumes integer CSS geometry (the
    // overwhelmingly common case — fractional layouts bypass).
    if (!Number.isInteger(hCss) || hCss <= 0) return false;
    // Closeout M-3 — the capture rounds its DEVICE origin from the row's
    // absolute top, while the patch paints its bottom hairline at
    // span-local `hCss - 1`: with a FRACTIONAL row top (measured/wrapped
    // heights somewhere above this row) the two roundings can disagree by
    // one device px at dpr > 1. Same conservative bypass as fractional
    // heights — a bail is a perf miss, a shifted hairline is a bug.
    const rowTopCss = this.host.rowHeightIndex !== null
      ? this.host.rowHeightIndex.topOf(rowIndex)
      : rowIndex * (this.host.options.rowHeight ?? this.host.theme.rowHeight);
    if (!Number.isInteger(rowTopCss)) return false;
    // Band split mirrors byRows: a column's interior right-edge vertical
    // only exists for non-last-in-band columns; the last column's right
    // edge is a band boundary (pinned-edge borderColor line / canvas edge)
    // — conservative bypass rather than reproducing that logic here.
    const leftPinned: typeof vs.visibleColumns = [];
    const center: typeof vs.visibleColumns = [];
    const rightPinned: typeof vs.visibleColumns = [];
    for (const col of vs.visibleColumns) {
      if (col.pinned === 'left') leftPinned.push(col);
      else if (col.pinned === 'right') rightPinned.push(col);
      else center.push(col);
    }
    const rowData = this.host.rowDataSnapshotAt(rowIndex);
    const ruleRow = (this.host.rowDataById.get(rowId) as Record<string, unknown> | undefined) ?? rowData;
    // Closeout I-3 — count spans locally and commit to PaintStats only when
    // the WHOLE row patched: a later column's bail drops the strip, so
    // spans painted before it never serve a pixel. Committing per-span
    // inflated `stripPatches` on rows that ultimately bailed (the live-feed
    // probe run showed 55 "patches" from rows that all bailed last-in-band
    // — semantically zero).
    let patchedSpans = 0;
    for (const colId of colIds) {
      const col = vs.visibleColumns.find((c) => c.colId === colId);
      if (col === undefined) return false; // column not visible → span unknown
      const band = col.pinned === 'left' ? leftPinned : col.pinned === 'right' ? rightPinned : center;
      if (band[band.length - 1] === col) return false; // last-in-band → band-edge line, bypass
      // Center-band cells clipped at a pinned boundary paint partially
      // live — a full-span patch would repaint clipped pixels. Bypass.
      if (col.pinned === undefined && (col.left < vs.bodyLeft || col.right > vs.bodyRight)) return false;
      if (!Number.isInteger(col.left) || !Number.isInteger(col.width)) return false;
      const def = this.host.columnDefsMap.get(colId);
      if (def === undefined) return false;
      const cell = this.host.cellAt(rowIndex, colId);
      const value = cell?.value ?? '';
      const valueFormatted = cell?.valueFormatted ?? '';
      // Closeout I-3 — bail only when a cell icon WOULD DRAW for this
      // cell's current value (byRows' exact decision, shared via
      // `resolveDrawableCellIcon`): the icon draws OVER the painter at
      // live coords, which the patch closure does not reproduce. The old
      // `typeof def.cellIcon === 'function'` existence test killed
      // patch-on-tick in production (stripPatches=0 on the live feed):
      // format-compiled columns synthesize the fn on EVERY def — it
      // returns null unless the format carries an icon() — and every
      // ticking numeric column is format-compiled, so the first tick
      // dropped the strip and cell-sized rasters could never recapture.
      if (resolveDrawableCellIcon(def as ResolvedColDef, {
        value, data: (rowData ?? {}) as never, colId,
        rowId, themeKind: this.host.getThemeKind(),
      }) !== null) return false; // icon draws over the painter — live only
      let rendererName: string;
      let params: unknown;
      if (def.cellRendererSelector) {
        const selected = def.cellRendererSelector({ value, colId, data: null });
        rendererName = selected?.component ?? def.cellRenderer;
        params = selected?.params !== undefined ? selected.params : def.cellRendererParams;
      } else {
        rendererName = def.cellRenderer;
        params = def.cellRendererParams;
      }
      // Strip rows are eligible-only (plain data rows), so the bg is the
      // plain zebra — never hover/selection (those rows have no strips).
      const rowBg = rowIndex % 2 === 1 ? theme.rowAltBg : theme.bg;
      const config: CellPaintConfig = {
        value: '', valueFormatted: '',
        bounds: { x: 0, y: 0, w: 0, h: 0 },
        font: '', fg: '', bg: '', borderColor: '',
        halign: 'left', prefillColor: '',
        isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      };
      applyCellProps(config, {
        theme,
        colDef: def as ResolvedColDef,
        value,
        valueFormatted,
        // Span-origin bounds — the patch CTM (`setTransform(dpr,0,0,dpr,
        // x0,0)`) lands (0,0,w,h) exactly on the cell's device span, the
        // same rebase discipline as a Tier-1 miss render.
        x: 0, y: 0, w: col.width, h: hCss,
        rowBg,
        prefillColor: rowBg,
        isFocused: false, isSelected: false, isHovered: false, isHeader: false,
        iconColor: theme.focusRingColor,
        // Flash suppressed by contract: the strip holds the SETTLED cell.
        // While the flash is live the row is ineligible and paints live;
        // once it fades, the next consume blits this settled patch.
        flashAlpha: undefined,
        params,
        rowData,
        rowIndex,
        rowId,
        ruleRow,
        themeKind: this.host.getThemeKind(),
      });
      if (config.ruleIndicator !== undefined) return false; // indicator icon → live only
      const painter = this.host.cellRenderers.get(rendererName);
      const wCss = col.width;
      const colLeft = col.left;
      const colRight = col.right;
      const gridLineColor = theme.gridLineColor;
      const ok = strips.patch(rowId, newVersion, colLeft, wCss, (sgc) => {
        // Task 4 — flatten over the opaque surface first (the Tier-1 miss
        // scratch's exact discipline, see `paintCellThroughCache`):
        // `patch` CLEARS the span to transparent, so opening directly
        // with a translucent rowBg (cursor-dark's 2%-alpha zebra) would
        // store double-composited premultiplied pixels that diverge from
        // the live raster by a few LSB at the next consume. The live
        // layer raster's op order is: band `theme.bg` fill → row-bg
        // bundle (only when the row bg differs) → cell painter →
        // gridlines on top; reproduce it verbatim.
        sgc.cache.fillStyle = theme.bg;
        sgc.fillRect(0, 0, wCss, hCss);
        if (rowBg !== theme.bg) {
          sgc.cache.fillStyle = rowBg;
          sgc.fillRect(0, 0, wCss, hCss);
        }
        painter.paint(sgc, config);
        sgc.cache.fillStyle = gridLineColor;
        // The row's bottom horizontal hairline slice (every in-body data
        // row paints one at round(row.bottom)-1 → span-local hCss-1).
        sgc.fillRect(0, hCss - 1, wCss, 1);
        // The column's interior right-edge vertical at round(col.right)-1
        // — span-local, exact against the patch's own x0 rounding.
        const lineX = (dpr * (Math.round(colRight) - 1) - Math.round(colLeft * dpr)) / dpr;
        sgc.fillRect(lineX, 0, 1, hCss);
      }, dpr);
      if (!ok) return false;
      patchedSpans++;
    }
    this.host.paintStats.stripPatches += patchedSpans;
    return true;
  }

  /**
   * Damage-region rendering — builds the live-viewport resolution context
   * the ledger needs to turn semantic damage (row indices / rowId+colId
   * cells) into merged clip rects at paint time. Reading `this.viewport` /
   * `this.chunk` / `this.canvasBounds` fresh on every paint (rather than
   * caching) means damage recorded before a scroll or column resize still
   * resolves against CURRENT geometry.
   */
  buildDamageResolveCtx(): DamageResolveCtx {
    const vs = this.host.viewport;
    // M3 (closeout review, SKIPPED — not cheap) — assumes every sticky
    // ancestor row paints at the uniform `theme.rowHeight`. Under
    // variable/autoHeight row heights, a taller ancestor row makes this
    // underestimate the band, so the scroll-redamage band
    // (`DamageLedger.takeResolved`'s unconditional sticky-band push) can
    // fall short and leave a stale lower sticky row for one frame. A real
    // fix needs a source row index on `StickyAncestor` (currently only
    // `depth`/`key`/`colId`/`value`/`childCount`/`isExpanded` — see
    // `worker/protocol.ts`) threaded from the worker's
    // `computeStickyAncestors` so this could sum `RowHeightIndex` entries
    // instead of multiplying by a constant — a worker↔main wire-protocol
    // change out of scope for this fix wave's Minor-severity bar. The
    // renderer's own `paintStickyGroups` makes the identical
    // uniform-height assumption (`ancestors.length * rowH`), so this stays
    // internally consistent (the redamage band matches what's painted)
    // even though both are wrong together under autoHeight groups.
    const stickyBandBottom = this.host.stickyAncestors.length > 0
      ? vs.bodyTop + this.host.stickyAncestors.length * this.host.theme.rowHeight
      : null;
    return {
      canvasWidth: this.host.canvasBounds.width,
      canvasHeight: this.host.canvasBounds.height,
      dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      bodyTop: vs.bodyTop,
      bodyBottom: vs.bodyBottom,
      bodyLeft: vs.bodyLeft,
      bodyRight: vs.bodyRight,
      // Two-domain damage (Task 2/4) — `scrollTop` pivots the screen↔
      // content transform (`screenYToContentY`/`dataRectToScreen`).
      // `layerTop`/`layerHeight` feed the data-domain area cap
      // (`DamageLedger.takeResolved`) against the LAYER's real extent —
      // when the retained layer is active this frame, the paint closure
      // has already applied this paint's `planLayer` decision (reset/
      // shift geometry mutation) BEFORE calling this method, so
      // `this.paintCacheLayer.geometry()` reflects the anchor THIS
      // frame's raster/present will actually use. When the layer isn't
      // active (option off, unavailable, or construction-time default),
      // this degrades to the Task-2 placeholder — `layerTop` mirrors the
      // live scroll position and `layerHeight` mirrors today's body
      // height, exactly reproducing pre-Task-4 behavior.
      scrollTop: vs.scrollTop,
      layerTop: this.paintCacheActive() ? this.host.paintCacheLayer!.geometry().layerTop : vs.scrollTop,
      layerHeight: this.paintCacheActive()
        ? this.host.paintCacheLayer!.geometry().layerHeight
        : vs.bodyBottom - vs.bodyTop,
      // Task 4 — gates the ledger's scroll-exposed-band push (see
      // `DamageResolveCtx.paintCacheLayerActive`'s doc). While hybrid-
      // deferred or un-anchored the layer is NOT serving pixels — treat
      // it inactive so scroll/partial damage still expands correctly and
      // cannot assume a valid retained present.
      paintCacheLayerActive: this.paintCacheActive()
        && this.host.paintCacheLayerAnchored
        && !this.host.paintCacheDeferLayer,
      stickyBandBottom,
      // Task 5 — totals-row / static-pinned-row bands (top or bottom
      // position), derived from the live viewport's non-data subgrid rows.
      pinnedBandRects: this.buildPinnedBandRects(vs),
      rowBand: (localRowIndex) => {
        const row = vs.visibleRows.find(
          (r) => r.subgrid.isData && r.localRowIndex === localRowIndex,
        );
        return row ? { top: row.top, bottom: row.bottom } : null;
      },
      rowIndexForRowId: (rowId) => {
        const chunk = this.host.chunk;
        if (!chunk) return null;
        for (let i = 0; i < chunk.rowIds.length; i++) {
          if (chunk.rowIds[i] === rowId) return chunk.rowStart + i;
        }
        return null;
      },
      colBounds: (colId) => {
        const col = vs.visibleColumns.find((c) => c.colId === colId);
        return col ? { x: col.left, w: col.width } : null;
      },
      // Task 6 (pixel-invariance harness fix) — any visible row (not just
      // data rows, unlike `rowBand` above) whose band strictly contains
      // `y`. Lets `DamageLedger.expand()` snap a bleed-expanded edge that
      // lands mid-row out to that row's full bounds instead of clipping
      // through the middle of its content.
      rowBoundsAtY: (y) => {
        const row = vs.visibleRows.find((r) => y > r.top && y < r.bottom);
        return row ? { top: row.top, bottom: row.bottom } : null;
      },
      // I1 fix — horizontal mirror of `rowBoundsAtY`: the visible column
      // whose bounds strictly contain `x`, so `DamageLedger.expand()` can
      // snap a bleed-expanded vertical edge out to full column bounds.
      colBoundsAtX: (x) => {
        const col = vs.visibleColumns.find((c) => x > c.left && x < c.right);
        return col ? { left: col.left, right: col.right } : null;
      },
    };
  }

  /** Task 5 — pinned/totals band rects for the damage-resolve ctx. Any
   *  non-data subgrid whose rows are a totals row OR a static pinned row
   *  (top or bottom position — see `rebuildSubgridStack`'s stack-order
   *  comment) contributes one full-width rect spanning the min/max
   *  top/bottom of its visible rows THIS frame. Header + floating-filter
   *  subgrids are excluded — they sit entirely above `bodyTop`, never
   *  touched by the scroll blit, so redamaging them every scroll frame
   *  would be pure waste. Returns `[]` when the grid has neither (the
   *  common case) so the ledger's band-atomic-extend logic (§4.4) and the
   *  Task 5 unconditional-scroll-redamage are both no-ops. */
  buildPinnedBandRects(vs: ViewportState): Rect[] {
    const bands = new Map<Subgrid, { top: number; bottom: number }>();
    for (const row of vs.visibleRows) {
      const sg = row.subgrid;
      if (sg.isData) continue;
      if (!sg.isTotals && !(sg instanceof PinnedRowsSubgrid)) continue;
      const cur = bands.get(sg);
      if (!cur) bands.set(sg, { top: row.top, bottom: row.bottom });
      else {
        if (row.top < cur.top) cur.top = row.top;
        if (row.bottom > cur.bottom) cur.bottom = row.bottom;
      }
    }
    const rects: Rect[] = [];
    for (const b of bands.values()) {
      rects.push({ x: 0, y: b.top, w: this.host.canvasBounds.width, h: b.bottom - b.top });
    }
    return rects;
  }

  /**
   * Wipe retained surfaces that embed absolute column x / cell style
   * (paint-cache layer pixels + layer-viewport memo) and advance
   * `layoutPaintEpoch` so `recomputeViewport` keeps re-queuing full
   * paints until a real full frame lands. Does not itself request a
   * repaint — callers pair with `repaintFull()`.
   */
  invalidateRetainedPaintForColumnLayout(): void {
    this.host.layoutPaintEpoch++;
    this.host.layerViewportCache = null;
    this.host.paintCacheLayerAnchored = false;
    // Stay on legacy for the whole resize drag — clearing defer here would
    // let the next frame rebuild/present the layer with mixed widths.
    this.host.paintCacheDeferLayer = this.host.columnResizeDragActive ? true : false;
    const layer = this.host.paintCacheLayer;
    if (layer?.available) {
      layer.reset(layer.geometry().layerTop);
    }
  }

  /** Task 4 (paint-cache layer) — `true` when the retained layer is
   *  actually usable THIS paint: the option isn't explicitly `false` AND
   *  the layer's own offscreen-canvas construction succeeded. Every call
   *  site that decides between the retained-layer frame algorithm and the
   *  legacy `Renderer.paint()` escape hatch gates on this, never on a bare
   *  `this.paintCacheLayer !== null` (which stays non-null even for an
   *  inert, construction-failed instance). */
  paintCacheActive(): boolean {
    return this.host.options.paintCache !== false && (this.host.paintCacheLayer?.available ?? false);
  }

  /** Task 4 (paint-cache layer) — runtime `paintCache` / `paintCacheOverscan`
   *  flip handler (wired via `RuntimeOptionTarget.resetPaintCacheLayer`).
   *  Disposes any existing layer instance and, when the option is now
   *  active, constructs a fresh one — a flip is treated as a full
   *  teardown/rebuild per the spec (`paintCacheOverscan` changing the
   *  layer's target height is ALSO a `planLayer` reset condition on its
   *  own, but disposing here is simpler than trying to reuse a
   *  differently-sized backing store across an option change apps make
   *  rarely, if ever, at runtime). `paintCacheLayerAnchored = false` +
   *  `repaintFull()` force the next paint through a full layer reset +
   *  full chrome raster, so the flip is never a stale-present frame. */
  resetPaintCacheLayer(): void {
    this.host.paintCacheLayer?.dispose();
    this.host.paintCacheLayer = this.host.options.paintCache !== false ? new PaintCacheLayer() : null;
    this.host.paintCacheLayerAnchored = false;
    this.host.paintCacheDeferLayer = false;
    this.host.layerViewportCache = null;
    this.host.layoutPaintEpoch++;
    this.repaintFull();
  }

  /** Cycle 22 / Task 2 — construct both raster-cache tiers from ONE
   *  shared `RasterBudget` sized by `rasterCacheBudgetMB` (default 48).
   *  Both stores use the same platform-canvas policy the paint-cache
   *  layer uses (`defaultCanvasFactory`); construction never throws. */
  buildRasterCaches(): void {
    const mb = this.host.options.rasterCacheBudgetMB ?? 48;
    const budget = new RasterBudget(Math.max(1, mb) * 1024 * 1024);
    this.host.rasterBudget = budget;
    this.host.rasterCells = new CellBitmapCache(budget, defaultCanvasFactory);
    this.host.rasterStrips = new RowStripCache(budget, defaultCanvasFactory);
    this.host.rasterCellsDpr = 0;
  }

  /** Cycle 22 / Task 2 — the per-paint Tier-1 handle for the byRows cell
   *  seam. `null` (⇒ every cell paints live, the exact shipped pipeline)
   *  when `rasterCache: false` or the store's canvas construction failed.
   *  Also owns the DPR epoch: a devicePixelRatio change invalidates every
   *  cached bitmap (they were rasterized at the old dpr — blitting them
   *  under the new CTM would scale/blur, the C1 lesson's cousin). Reads
   *  `window.devicePixelRatio` fresh (NOT `cgridCanvas.devicePixelRatio`)
   *  because the paint closure can run synchronously from inside
   *  `VelocityGridCanvas`'s own constructor, before `this.cgridCanvas` exists —
   *  the same gotcha the layer's own dpr read documents. */
  getRasterCellsCtx(): RasterCellsCtx | null {
    const cache = this.host.rasterCells;
    if (this.host.options.rasterCache === false || cache === null || !cache.available) return null;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // Cycle 22 / closeout I-2 (adjudicated BYPASS) — at non-integer dpr
    // (Windows 125%/150% scaling) the hit blit's CSS-px dest rect maps to a
    // FRACTIONAL device origin, so `drawImage` resamples: hit pixels would
    // not be byte-identical to a live paint. Tier 1 goes fully dormant
    // (every cell paints live — the shipped pipeline). Gated BEFORE the
    // dpr-epoch tracking below so an integer→fractional→same-integer round
    // trip keeps its still-valid integer-dpr bitmaps. Strip capture/consume
    // stay on at any dpr (integer-device-px copies of the layer's own
    // raster); the strip PATCH path carries its own gate — see
    // `applyStripCellDamage`. A bypass is a perf miss, a stale blit is a bug.
    if (!Number.isInteger(dpr)) return null;
    if (dpr !== this.host.rasterCellsDpr) {
      if (this.host.rasterCellsDpr !== 0) this.rasterCacheEpochBump();
      this.host.rasterCellsDpr = dpr;
    }
    // Task 4 — `surfaceBg` (the opaque base the miss scratch flattens
    // over) is read fresh per paint; it only moves on a theme swap, which
    // already bumps the epoch, so stale bitmaps can never be served
    // against a new surface color.
    return { cache, dpr, surfaceBg: this.host.theme.bg, stats: this.host.paintStats };
  }

  /** Cycle 22 / Task 2 — theme/dpr epoch: invalidate EVERY cached raster
   *  in both tiers (bytes return to the shared budget immediately; the
   *  backing canvases land in the reuse pools). Wired at the same sites
   *  the paint-cache layer already resets on: every theme re-read
   *  (`setTheme` / `setThemeMode` / `setThemeParams` / `setDensity` /
   *  `setState`'s themeParams clear) and a devicePixelRatio change
   *  (detected in `getRasterCellsCtx`). Theme-scoped colors deliberately
   *  OUTSIDE `cellStyleSignature`'s key (`checkboxCheckedBg/Fg`,
   *  `group*`, `emptyFg`, `palette`) ride exactly this epoch. */
  rasterCacheEpochBump(): void {
    this.host.rasterCells?.epochBump();
    // Cycle 22 / Task 3 — layoutEpoch contract: THEME changes (every
    // caller of this method) and DPR changes (`getRasterCellsCtx`'s
    // detector) stale every strip's pixels; `stripLayoutEpochBump` both
    // advances the epoch counter and drops the store.
    this.stripLayoutEpochBump();
  }

  /** Cycle 22 / Task 3 — advance the Tier-2 strip layout epoch AND drop
   *  every retained strip. THE single mechanism behind every "layoutEpoch
   *  contract" call site: column width/order/visibility/pin (the
   *  `columnLayout` setter), column-group open/close
   *  (`subscribeColumnGroupState`), theme + dpr (`rasterCacheEpochBump`),
   *  canvas width (`setBounds`), horizontal scroll
   *  (`getRasterStripsCtx`), quick-filter term change
   *  (`applyQuickFilter`), sort change (`setSortModel`), def-level
   *  rule/format/renderer changes (`rebuildColumns`), and the
   *  unknown-diff chunk wipe (`handleViewportChunk`). */
  stripLayoutEpochBump(): void {
    this.host.stripLayoutEpoch++;
    this.host.rasterStrips?.layoutEpochBump();
  }

  /** Cycle 22 / Task 3 — the per-paint Tier-2 handle for the retained
   *  layer's band raster. `null` (⇒ the strip path is fully dormant,
   *  byte-identical call sequence to the shipped pipeline) when
   *  `rasterCache: false` or the store's canvas construction failed.
   *  Also owns the HORIZONTAL-SCROLL layoutEpoch bump: strips are
   *  absolute-x device-px snapshots of full layer rows, and `scrollLeft`
   *  shifts every column's pixels, so any change stales the whole store
   *  (the vertical axis needs no such bump — strips are re-anchored per
   *  row at blit time). Checked here, at the consume site, so no scroll
   *  entry point can be missed. */
  getRasterStripsCtx(): RasterStripsCtx | null {
    const cache = this.host.rasterStrips;
    if (this.host.options.rasterCache === false || cache === null || !cache.available) return null;
    // layoutEpoch contract — horizontal scroll.
    const sl = this.host.viewport.scrollLeft;
    if (sl !== this.host.stripScrollLeft) {
      this.host.stripScrollLeft = sl;
      this.stripLayoutEpochBump();
    }
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    let ctx = this.host.stripsCtxMemo;
    if (ctx === null || ctx.cache !== cache) {
      ctx = {
        cache,
        dpr,
        rowVersionOf: (rowIndex) => {
          const id = this.host.stringRowIdAt(rowIndex);
          if (id === null || id === '') return null;
          return this.host.rowVersionByRowId.get(id) ?? 0;
        },
        stringRowIdAt: (rowIndex) => this.host.stringRowIdAt(rowIndex),
        eligible: (rowIndex) => this.stripRowEligible(rowIndex),
        layoutEpoch: () => this.host.stripLayoutEpoch,
        stats: this.host.paintStats,
      };
      this.host.stripsCtxMemo = ctx;
    } else {
      ctx.dpr = dpr;
      // `resetPaintStats` swaps the whole object — re-point every read.
      ctx.stats = this.host.paintStats;
    }
    return ctx;
  }

  /** Cycle 22 / Task 3 — the BINDING Tier-2 eligibility contract,
   *  enforced identically on capture and consume (the renderer calls this
   *  once per candidate row per layer raster). A row is strip-cacheable
   *  only when it is a PLAIN data row:
   *   - no active quick-filter terms (the match tint is data+term
   *     dependent, not captured in the version key);
   *   - inside the current chunk window with rowKind 0 (group=1 and
   *     footer=3 rows carry structural chrome; totals/pinned/sticky rows
   *     never reach here — they are not DataSubgrid rows);
   *   - NOT immediately above a footer row (`groupFooterBorderTop`
   *     overpaints this row's bottom pixel line with the footer border —
   *     that line must never ride a strip);
   *   - not holding the focused cell, not selected, not hovered;
   *   - no live flash on any of its cells.
   *  Anything else paints live: a bypass is a perf miss, a stale strip is
   *  a bug. */
  stripRowEligible(rowIndex: number): boolean {
    if (this.host.quickFilterLowerTerms.length > 0) return false;
    const chunk = this.host.chunk;
    if (chunk === null) return false;
    const local = rowIndex - chunk.rowStart;
    if (local < 0 || local >= chunk.rowCount) return false;
    if ((chunk.rowKinds[local] ?? 0) !== 0) return false;
    if (local + 1 < chunk.rowCount && (chunk.rowKinds[local + 1] ?? 0) === 3) return false;
    const sel = this.host.selection.state;
    if (sel.focusedRowIndex === rowIndex) return false;
    if (sel.selectedRowIndices.has(rowIndex)) return false;
    if (!this.host.options.suppressRowHoverHighlight && this.host.hoveredRowIndex === rowIndex) return false;
    if (this.host.flashRegistry.size() > 0) {
      const nid = chunk.rowIds[local];
      if (nid !== undefined && this.host.flashRegistry.hasRow(nid)) return false;
    }
    return true;
  }

  /** Cycle 22 / Task 2 — runtime `rasterCache` / `rasterCacheBudgetMB`
   *  flip handler (wired via `RuntimeOptionTarget.resetRasterCache`).
   *  Disposes BOTH tiers (every byte credited back, stores permanently
   *  inert) and, when the option is now active, rebuilds them under a
   *  fresh shared budget. `repaintFull()` so the flip lands on the next
   *  frame either way. */
  resetRasterCache(): void {
    this.host.rasterCells?.dispose();
    this.host.rasterStrips?.dispose();
    this.host.rasterCells = null;
    this.host.rasterStrips = null;
    this.host.rasterBudget = null;
    this.host.rasterCellsDpr = 0;
    // Cycle 22 / Task 3 — Tier-2 bookkeeping restarts with the stores.
    this.host.rowVersionByRowId.clear();
    this.host.stripsCtxMemo = null;
    this.host.stripLayoutEpoch++;
    if (this.host.options.rasterCache !== false) {
      this.buildRasterCaches();
    }
    this.repaintFull();
  }

  /** Task 3 (paint-cache layer, spec §1 "Layer layout") — the synthetic
   *  second `computeViewport` call that lays out rows for the retained
   *  offscreen layer, independent of the on-screen viewport. Mirrors the
   *  real recompute's argument construction (`ViewportManager.
   *  computeCurrentViewport`) — same columnLayout / subgrids / scrollLeft /
   *  dataRowHeightIndex / column-virtualisation suppression — but re-
   *  anchored to the layer's own coverage: `scrollTop: layerTop`,
   *  `containerHeight: bodyTop + layerHeight` (so the returned
   *  `bodyHeight` is exactly `layerHeight`), `overscanRows: 0` (the
   *  layer's own extent IS its buffer — no additional row padding), and
   *  `suppressRowVirtualisation: false` (unlike whatever the live grid
   *  option says — the layer always virtualises to its own bounded
   *  coverage, never "every row").
   *
   *  Memoized on (the live `this.viewport` object reference, `layerTop`,
   *  `layerHeight`) — `recomputeViewport()` always assigns a NEW
   *  `ViewportState` object, so reference equality alone detects "the real
   *  viewport changed since the last build" without a separate generation
   *  counter. Returns the same object back-to-back for the same geometry
   *  against the same real-viewport snapshot. */
  buildLayerViewport(geometry: LayerGeometry): ViewportState {
    const vs = this.host.viewport;
    const cached = this.host.layerViewportCache;
    const layoutPaintEpoch = this.host.layoutPaintEpoch;
    if (
      cached
      && cached.vs === vs
      && cached.layerTop === geometry.layerTop
      && cached.layerHeight === geometry.layerHeight
      && cached.layoutPaintEpoch === layoutPaintEpoch
    ) {
      return cached.result;
    }
    const containerWidth =
      this.host.canvasBounds.width || this.host.scroller.clientWidth || this.host.root.clientWidth || 800;
    const result = computeViewport({
      columnLayout: this.host.columnLayout,
      subgrids: this.host.subgrids,
      containerWidth,
      containerHeight: vs.bodyTop + geometry.layerHeight,
      scrollLeft: vs.scrollLeft,
      scrollTop: geometry.layerTop,
      overscanRows: 0,
      suppressColumnVirtualisation:
        this.host.options.suppressColumnVirtualisation || this.host.options.domLayout === 'print',
      suppressRowVirtualisation: false,
      dataRowHeightIndex: this.host.rowHeightIndex ?? undefined,
    });
    this.host.layerViewportCache = {
      vs,
      layerTop: geometry.layerTop,
      layerHeight: geometry.layerHeight,
      layoutPaintEpoch,
      result,
    };
    return result;
  }

  /** Closeout directive B / M-2 — row-align a CONTENT-space band (a
   *  shift's newly-exposed edge, or a chunk carved off during the
   *  budgeted drain) to the FULL bounds of whichever row(s) its edges
   *  land inside, using the same widened live-viewport row list
   *  `rowBand`/`rowBoundsAtY` already resolve against
   *  (`this.viewport.visibleRows` — Task 3's overscan-widened set, which
   *  by the fetch-window-coupling design already spans the retained
   *  layer's own coverage). Snapping OUTWARD only (never inward) keeps
   *  every layer raster row-atomic, avoiding the T6 mid-glyph clip-AA
   *  class this same widening already fixed for the damage ledger's own
   *  bleed expansion (`DamageLedger.expand`'s row-atomic-bleed comment).
   *  A boundary that resolves to no row (an edge case right at the very
   *  top/bottom of data, or outside the widened viewport's own range) is
   *  left unsnapped — fails open, the same conservatism `rowBoundsAtY`
   *  itself already uses. */
  snapContentBandToRows(top: number, bottom: number): { top: number; bottom: number } {
    if (bottom <= top) return { top, bottom };
    const vs = this.host.viewport;
    const t = { scrollTop: vs.scrollTop, bodyTop: vs.bodyTop };
    const topScreen = dataRectToScreen({ x: 0, y: top, w: 0, h: 0 }, t).y;
    const bottomScreen = dataRectToScreen({ x: 0, y: bottom, w: 0, h: 0 }, t).y;
    const topRow = vs.visibleRows.find((r) => topScreen >= r.top && topScreen < r.bottom);
    // `bottom` is an EXCLUSIVE band edge — look up the row containing the
    // last INCLUDED px (a hair below `bottomScreen`) so an edge already
    // exactly on a row seam doesn't spuriously pull in the row below.
    const lastIncludedScreen = bottomScreen - 0.01;
    const bottomRow = vs.visibleRows.find((r) => lastIncludedScreen >= r.top && lastIncludedScreen < r.bottom);
    const snappedTopScreen = topRow ? Math.min(topScreen, topRow.top) : topScreen;
    const snappedBottomScreen = bottomRow ? Math.max(bottomScreen, bottomRow.bottom) : bottomScreen;
    return {
      top: screenYToContentY(snappedTopScreen, t),
      bottom: screenYToContentY(snappedBottomScreen, t),
    };
  }

  /** Closeout directive B.2 — the present-safety sync-fill invariant.
   *  Runs unconditionally right before `presentLayer`, on every cache-on
   *  frame: intersects the about-to-be-presented range
   *  (`[scrollTop, scrollTop+bodyHeight]`, widened by one row-height
   *  margin each side per the directive) against the layer's pending-band
   *  ledger, and rasters SYNCHRONOUSLY whatever overlaps THIS frame,
   *  before the present blit runs. This is the hard guarantee ("unrastered
   *  content is thus never presentable BY CONSTRUCTION") — it does not
   *  depend on the budgeted drain (`drainLayerPendingBands`) having caught
   *  up; a scroll that outruns the drain's own budget just pays for a
   *  bigger synchronous fill here instead of ever presenting stale/blank
   *  pixels. Counted via `PaintStats.layerSyncFills` — the "scroll outran
   *  the budget" signal. */
  syncFillLayerPending(
    layer: PaintCacheLayer, layerCtx: CachedContext2D, vsNow: ViewportState, layerVs: ViewportState,
  ): void {
    if (!layer.hasPendingBands()) return;
    const rowFallback = this.host.options.rowHeight ?? this.host.theme.rowHeight;
    const queryTop = vsNow.scrollTop - rowFallback;
    const queryBottom = vsNow.scrollTop + vsNow.bodyHeight + rowFallback;
    let pieces: Array<{ top: number; bottom: number }>;
    try {
      pieces = layer.takePendingIntersecting(queryTop, queryBottom);
    } catch {
      // Conservative fallback (directive B.2) — any ambiguity drains the
      // FULL pending set rather than risk presenting unrastered content.
      pieces = layer.takeAllPending();
    }
    if (pieces.length === 0) return;
    this.host.paintStats.layerSyncFills++;
    const geom = layer.geometry();
    const rects = pieces
      .map((p) => this.snapContentBandToRows(p.top, p.bottom))
      .filter((p) => p.bottom > p.top)
      .map((p) => ({ x: 0, y: p.top, w: this.host.canvasBounds.width, h: p.bottom - p.top }));
    if (rects.length === 0) return;
    const localRects = rects.map((r) => dataRectToScreen(r, { scrollTop: geom.layerTop, bodyTop: vsNow.bodyTop }));
    layerCtx.cache.save();
    layerCtx.translate(0, -vsNow.bodyTop);
    this.host.renderer.paintLayer(layerCtx, layerVs, false, localRects);
    layerCtx.cache.restore();
  }

  /** Closeout directive B.3 — the budgeted drain. Runs AFTER present +
   *  chrome (so it never delays what's actually on-screen this frame),
   *  spending a small (~3ms) time budget rastering pending bands
   *  nearest-viewport-first, in row-aligned chunks of at least 4 rows
   *  (`PaintCacheLayer.takePendingNearest`). Requests another frame
   *  (`cgridCanvas.requestRepaint()`) while any backlog remains so the
   *  grid keeps draining at idle — REQUIRED so `waitSettled`/pixel-
   *  invariance still observe a fully-converged grid (a "settled" grid
   *  must have zero pending; see the paint-cache closeout review,
   *  adjudication B, point 3). */
  drainLayerPendingBands(
    layer: PaintCacheLayer, layerCtx: CachedContext2D, vsNow: ViewportState, layerVs: ViewportState,
  ): void {
    const BUDGET_MS = 3;
    const rowFallback = this.host.options.rowHeight ?? this.host.theme.rowHeight;
    const minChunkPx = Math.max(4 * rowFallback, 1);
    const anchor = vsNow.scrollTop + vsNow.bodyHeight / 2;
    const geom = layer.geometry();
    const t0 = performance.now();
    while (layer.hasPendingBands() && (performance.now() - t0) < BUDGET_MS) {
      const chunk = layer.takePendingNearest(anchor, minChunkPx);
      if (!chunk) break;
      const snapped = this.snapContentBandToRows(chunk.top, chunk.bottom);
      const h = snapped.bottom - snapped.top;
      if (h <= 0) continue;
      const rect = { x: 0, y: snapped.top, w: this.host.canvasBounds.width, h };
      const localRect = dataRectToScreen(rect, { scrollTop: geom.layerTop, bodyTop: vsNow.bodyTop });
      layerCtx.cache.save();
      layerCtx.translate(0, -vsNow.bodyTop);
      this.host.renderer.paintLayer(layerCtx, layerVs, false, [localRect]);
      layerCtx.cache.restore();
    }
    if (layer.hasPendingBands()) {
      this.host.cgridCanvas.requestRepaint();
    }
  }


  /** Damage-region rendering — snapshot of cumulative paint telemetry. See
   *  `PaintStats` for field semantics. Returns a shallow copy so callers
   *  can't mutate the live counters. */
  getPaintStats(): PaintStats {
    return { ...this.host.paintStats };
  }

  /** Damage-region rendering — zero the running `PaintStats` counters. */
  resetPaintStats(): void {
    this.host.paintStats = {
      paints: 0, fullPaints: 0, partialPaints: 0, blits: 0,
      presents: 0, layerShifts: 0, layerResets: 0, layerRasterMs: 0,
      lastRects: 0, lastAreaPct: 100, avgPaintMs: 0, worstPaintMs: 0,
      layerSyncFills: 0, layerBacklogPx: 0,
      cellCacheHits: 0, cellCacheMisses: 0, cellCacheBypasses: 0,
      stripHits: 0, stripMisses: 0, stripMissesUncoverable: 0, stripCaptures: 0, stripPatches: 0,
      rasterCacheBytes: 0, rasterCachePooledBytes: 0,
    };
  }

  /**
   * Cycle 25 / Task 7 — build (or reuse) the per-paint flash alpha mask
   * for the current chunk × visible columns. No-op when flash is off or
   * there is no chunk.
   */
  rebuildFlashAlphaMaskForPaint(): void {
    if (!this.host.chunk || !this.host.options.enableCellChangeFlash) {
      this.host.flashAlphaMask = null;
      return;
    }
    const colIds = this.host.viewport.visibleColumns.map((c) => c.colId);
    if (colIds.length === 0) {
      this.host.flashAlphaMask = null;
      return;
    }
    // Rebuild the colId → index map only when the visible set changes.
    let colsChanged = colIds.length !== this.host.flashAlphaMaskColIds.length;
    if (!colsChanged) {
      for (let i = 0; i < colIds.length; i++) {
        if (colIds[i] !== this.host.flashAlphaMaskColIds[i]) {
          colsChanged = true;
          break;
        }
      }
    }
    if (colsChanged) {
      this.host.flashAlphaMaskColIds = colIds;
      this.host.flashAlphaMaskColIndex = new Map(colIds.map((id, i) => [id, i]));
    }
    this.host.flashAlphaMask = buildFlashAlphaMask({
      registry: this.host.flashRegistry,
      rowIds: this.host.chunk.rowIds,
      colIds,
      now: performance.now(),
      out: this.host.flashAlphaMaskOut,
    });
    this.host.flashAlphaMaskOut = this.host.flashAlphaMask;
  }
}
