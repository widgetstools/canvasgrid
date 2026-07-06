/**
 * Cycle 21i — Column Groups tool panel (built-in `agColumnGroupsToolPanel`,
 * sidebar shortcut `'columnGroups'`). Authors the columnDefs group tree via
 * the normalized flat model; writes to the grid only on Apply.
 *
 * Visual/UX contract mirrors `.cg-settings-panel` (see
 * `packages/kernel/src/theming/tokens.css` — `.cg-colgroups-*` rules sit
 * right after the `.cg-settings-*` block). Selecting a group (via the
 * keyboard-reachable `data-cg-select` button on its row) reveals a
 * per-group Style band (`renderStyle`) built on the Phase 1
 * `SettingsForm` engine, editing `headerStyle`/`headerClass`/
 * `openByDefault`/`marryChildren` on the selected `GroupNode`. Every edit
 * routes through `this.mutate(...)` like any other panel change, so it
 * participates in dirty/Apply — this panel never writes to the grid
 * except on Apply.
 */
import type { ToolPanel, ToolPanelParams } from './types';
import {
  flatten, project, createGroup, deleteGroup, moveNode,
  setHidden, setColumnHeaderName, renameGroup, validate, canDrop, resolveDrop,
  setGroupStyle, setColumnGroupShow,
  type Node, type GroupNode, type ColumnNode,
} from '../columnGroups/model';
import type { CGridApi } from '../../types';
import { ColorPickerControl } from '../settingsForm/colorPicker';
import type { BorderSpec, BorderStyle } from '../../types/cell';
import { cloneDefsTree } from '../../core/columnTree';

type NodeKind = Node['kind'];

/** One editable side of the box-model border editor, or the `all` fallback. */
type BorderEdge = 'all' | 'top' | 'right' | 'bottom' | 'left';

/**
 * Pure — normalize a `BorderSpec` to its lean, canonical form so the model
 * never carries empty husks (which would break round-trip identity and
 * bloat persisted snapshots):
 *  - a side's `width` of `0` / non-positive / non-finite is dropped;
 *  - a `color` that is empty-string is dropped;
 *  - a side that ends with no meaningful facet is removed entirely;
 *  - if every side is removed, the whole spec collapses to `undefined`.
 */
export function pruneBorder(spec: BorderSpec | undefined): BorderSpec | undefined {
  if (!spec) return undefined;
  const out: BorderSpec = {};
  for (const side of ['top', 'right', 'bottom', 'left', 'all'] as const) {
    const s = spec[side];
    if (!s) continue;
    const cleaned: BorderSpec['all'] = {};
    if (typeof s.width === 'number' && Number.isFinite(s.width) && s.width > 0) cleaned.width = s.width;
    if (typeof s.color === 'string' && s.color !== '') cleaned.color = s.color;
    if (s.style !== undefined) cleaned.style = s.style;
    if (cleaned.width !== undefined || cleaned.color !== undefined || cleaned.style !== undefined) {
      out[side] = cleaned;
    }
  }
  return out.top || out.right || out.bottom || out.left || out.all ? out : undefined;
}

/** Pure — the effective spec for one side of a box-model border: an
 *  explicit per-side entry wins over the `all` fallback. Shared by the
 *  border cluster's live preview builder AND `refreshBorderPreview()`'s
 *  no-rebuild live-commit path so both stay in lockstep. */
function effectiveBorderSide(
  border: BorderSpec | undefined,
  side: 'top' | 'right' | 'bottom' | 'left',
): BorderSpec['all'] | undefined {
  return border?.[side] ?? border?.all;
}

/** Pure — CSS shorthand for one border side, or `'none'` when unset/zero. */
function borderSideToCss(s: BorderSpec['all'] | undefined): string {
  if (!s || !s.width || s.width <= 0) return 'none';
  return `${s.width}px ${s.style ?? 'solid'} ${s.color ?? 'currentColor'}`;
}

// ── Icon system ─────────────────────────────────────────────────────────────
// Every interactive glyph in the panel renders as an inline SVG on a shared
// 24-unit viewBox at a single CSS size (`.cg-colgroups-ic`, 14px). Unicode
// glyphs (●/◐/○/⚙/＋/✕) render at inconsistent, font-dependent sizes; SVG on
// one coordinate space + one render size makes every icon identical.
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function icon(...children: SVGElement[]): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  svg.setAttribute('class', 'cg-colgroups-ic');
  children.forEach((c) => svg.appendChild(c));
  return svg;
}
const strokeAttrs = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
/** columnGroupShow state icons. Eye = always visible; the two conditional
 *  states echo the group's own disclosure caret — a DOWN chevron for
 *  "visible only when the group is OPEN (expanded)" and a RIGHT chevron for
 *  "visible only when the group is CLOSED (collapsed)". */
function iconGroupShow(kind: 'always' | 'open' | 'closed'): SVGSVGElement {
  if (kind === 'always') {
    // Eye — always visible.
    return icon(
      svgEl('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', ...strokeAttrs }),
      svgEl('circle', { cx: '12', cy: '12', r: '3', ...strokeAttrs }),
    );
  }
  if (kind === 'open') {
    // Chevron-down — mirrors an OPEN group's caret (shown only when expanded).
    return icon(svgEl('path', { d: 'M6 9l6 6 6-6', ...strokeAttrs }));
  }
  // Chevron-right — mirrors a CLOSED group's caret (shown only when collapsed).
  return icon(svgEl('path', { d: 'M9 6l6 6-6 6', ...strokeAttrs }));
}
function iconGear(): SVGSVGElement {
  return icon(
    svgEl('circle', { cx: '12', cy: '12', r: '3', ...strokeAttrs }),
    svgEl('path', {
      d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      ...strokeAttrs,
    }),
  );
}
function iconPlus(): SVGSVGElement { return icon(svgEl('path', { d: 'M12 5v14M5 12h14', ...strokeAttrs })); }
/** "Pop out" — an arrow escaping a box, reading as "undock this panel
 *  into a floating window". Shares the panel's icon house style. */
function iconPopOut(): SVGSVGElement {
  return icon(
    svgEl('path', { d: 'M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6', ...strokeAttrs }),
    svgEl('path', { d: 'M15 3h6v6', ...strokeAttrs }),
    svgEl('path', { d: 'M10 14 21 3', ...strokeAttrs }),
  );
}
function iconClose(): SVGSVGElement { return icon(svgEl('path', { d: 'M18 6 6 18M6 6l12 12', ...strokeAttrs })); }
function iconGrip(): SVGSVGElement {
  const dots = [[9, 6], [15, 6], [9, 12], [15, 12], [9, 18], [15, 18]]
    .map(([x, y]) => svgEl('circle', { cx: String(x), cy: String(y), r: '1.4', fill: 'currentColor' }));
  return icon(...dots);
}

interface DragState {
  id: string;
  kind: NodeKind;
  ghost: HTMLElement;
  offsetX: number;
  offsetY: number;
}

/** A mousedown that hasn't yet moved past the drag threshold — a plain
 *  click (mousedown+mouseup with no meaningful movement) never promotes to
 *  a real drag session, so it doesn't churn the DOM with a body-level ghost. */
interface PendingDrag {
  node: Node;
  row: HTMLElement;
  startX: number;
  startY: number;
}

/** Minimum pointer travel (px) before a mousedown becomes a drag session. */
const DRAG_THRESHOLD_PX = 4;

export class ColumnGroupsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private tree!: HTMLElement;
  private styleSection!: HTMLElement;
  /** Live colour-picker controls in the current Style band — destroyed on
   *  panel teardown so no portaled popover outlives the panel. Reset (not
   *  destroyed) on each `renderStyle()` rebuild so an in-flight popover the
   *  user is dragging is never yanked mid-interaction. */
  private stylePickers: ColorPickerControl[] = [];
  /** Which border edge the box-model editor is currently editing. VIEW-STATE
   *  only (default `'all'`); survives `mutate()`/`render()`. */
  private selectedEdge: BorderEdge = 'all';
  private applyBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private api!: Pick<CGridApi, 'getColumnGroupDefs' | 'updateGridOptions' | 'popOutToolPanel'>;
  private nodes: Node[] = [];
  /** Canonical JSON of the last-applied projected tree — comparing against
   *  `project(nodes)` (also projected) makes seed→dirty reliably false even
   *  though raw defs and projected defs differ by key order / dropped
   *  undefineds. */
  private baseline = '';
  private selectedGroupId: string | null = null;
  /** VIEW-STATE only (not part of the model): ids of groups the user has
   *  collapsed. Must survive `mutate()`/`render()` so an edit elsewhere in
   *  the tree doesn't silently re-expand every group. Reset on `seed()`
   *  since the tree is re-seeded from defs at that point. */
  private collapsed = new Set<string>();
  private drag: DragState | null = null;
  private pending: PendingDrag | null = null;
  private readonly onDragMove = (e: MouseEvent) => this.handleDragMove(e);
  private readonly onDragEnd = (e: MouseEvent) => this.handleDragEnd(e);
  private readonly onPendingMove = (e: MouseEvent) => this.handlePendingMove(e);
  private readonly onPendingUp = () => this.cancelPendingDrag();

  init(params: ToolPanelParams): void {
    this.api = params.api as unknown as typeof this.api;
    this.root = el('div', 'cg-colgroups-panel');
    this.root.appendChild(this.buildToolbar());   // "New group"
    this.tree = el('div', 'cg-colgroups-tree cg-scrollbar');
    this.root.appendChild(this.tree);
    this.styleSection = this.buildStyleSection();  // Task 4 fills this
    this.root.appendChild(this.styleSection);
    this.root.appendChild(this.buildFooter());     // Apply / Reset
    this.seed();
  }

  getGui(): HTMLElement { return this.root; }
  refresh(): void { this.seed(); }
  destroy(): void {
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragEnd);
    document.removeEventListener('mousemove', this.onPendingMove);
    document.removeEventListener('mouseup', this.onPendingUp);
    this.drag?.ghost.remove();
    this.drag = null;
    this.pending = null;
    this.stylePickers.forEach((p) => p.destroy());
    this.stylePickers = [];
    this.root.remove();
  }

  private seed(): void {
    const defs = this.api.getColumnGroupDefs();
    this.nodes = flatten(cloneDefsTree(defs));
    this.baseline = JSON.stringify(project(this.nodes)); // canonical, not raw defs
    this.selectedGroupId = null;
    this.collapsed = new Set();
    this.render();
  }

  private mutate(fn: (n: Node[]) => Node[]): void { this.nodes = fn(this.nodes); this.render(); }

  /** Toggle selection: selecting the already-selected group deselects it
   *  (hides the Style band). Selection is panel VIEW-STATE, not part of
   *  the editable model. */
  private selectGroup(id: string): void {
    this.selectedGroupId = this.selectedGroupId === id ? null : id;
    this.render();
  }

  private get dirty(): boolean {
    return JSON.stringify(project(this.nodes)) !== this.baseline;
  }

  private onApply(): void {
    const res = validate(this.nodes);
    if (!res.ok) { this.flagGroup(res.groupId, res.message); return; }
    const defs = project(this.nodes);
    this.api.updateGridOptions({ columnDefs: defs });
    this.baseline = JSON.stringify(defs);
    this.render();
  }

  private render(): void {
    this.tree.replaceChildren();
    if (this.nodes.length === 0) {
      const empty = el('div', 'cg-colgroups-empty');
      empty.textContent = 'No column groups yet. Create one to organize columns.';
      this.tree.appendChild(empty);
      this.applyBtn.disabled = !this.dirty;
      this.renderStyle();
      return;
    }
    // Render top-level (parentId null) then recurse by parentId, ordered by order.
    // `hiddenByAncestor` propagates down: a node is hidden if ANY ancestor is
    // collapsed, but each group's OWN collapsed flag only governs whether ITS
    // children are hidden — a collapsed subgroup nested inside a collapsed
    // ancestor stays independently collapsed once the ancestor re-expands.
    const renderLevel = (parentId: string | null, depth: number, hiddenByAncestor: boolean) => {
      const sibs = this.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order);
      // Depth-0 eyebrows keep ungrouped columns and groups from blurring into
      // one flat list. Top-level rows can interleave (a column dragged out
      // of a group can land between two groups), so an eyebrow is emitted
      // before each CONTIGUOUS RUN of a kind — not just once in first-seen
      // order — so e.g. `[group, column, group]` renders
      // `Groups → group1 → Ungrouped → column → Groups → group2` and never
      // mislabels the second group under a stale "Ungrouped" eyebrow.
      let prevKind: NodeKind | null = null;
      sibs.forEach((n) => {
        if (depth === 0 && n.kind !== prevKind) {
          this.tree.appendChild(eyebrow(n.kind === 'column' ? 'Ungrouped' : 'Groups'));
          prevKind = n.kind;
        }
        this.tree.appendChild(this.rowFor(n, depth, hiddenByAncestor));
        const childHidden = hiddenByAncestor || (n.kind === 'group' && this.collapsed.has(n.id));
        renderLevel(n.id, depth + 1, childHidden);
      });
    };
    renderLevel(null, 0, false);
    this.applyBtn.disabled = !this.dirty;
    this.renderStyle();
  }

  private rowFor(n: Node, depth: number, hidden: boolean): HTMLElement {
    const row = el('div', 'cg-colgroups-row');
    row.setAttribute('data-cg-node', n.id);
    row.setAttribute('data-kind', n.kind);
    row.style.paddingInlineStart = `calc(12px + ${depth} * 16px)`;
    if (hidden) row.style.display = 'none';

    // Nesting spine — one hairline guide per ancestor depth level.
    for (let d = 0; d < depth; d += 1) {
      const guide = el('span', 'cg-colgroups-guide');
      guide.style.left = `${8 + d * 16}px`;
      row.appendChild(guide);
    }

    if (n.kind === 'group') {
      row.appendChild(this.groupControls(n as GroupNode));
      if (this.selectedGroupId === n.id) row.setAttribute('data-selected', '');
      // Mouse convenience: clicking anywhere on the row's non-interactive
      // surface also selects it. The REAL keyboard-reachable affordance is
      // the `data-cg-select` button built in `groupControls()` below.
      row.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button') || target.closest('input')) return;
        this.selectGroup(n.id);
      });
    } else {
      row.appendChild(this.columnControls(n as ColumnNode));
    }
    this.wireDrag(row, n);
    return row;
  }

  // ── Toolbar / footer ──────────────────────────────────────────────

  private buildToolbar(): HTMLElement {
    const bar = el('div', 'cg-colgroups-toolbar');
    const add = el('button', 'cg-btn') as HTMLButtonElement;
    add.type = 'button';
    add.textContent = 'New group';
    add.setAttribute('data-cg-add-group', '');
    add.onclick = () => this.mutate((ns) => createGroup(ns, null, 'New Group'));
    bar.appendChild(add);

    // Pop out to a floating panel — right-aligned (CSS pushes it there
    // via margin-left: auto). No-op when the host api predates
    // `popOutToolPanel` (older api surface).
    const popout = el('button', 'cg-colgroups-popout') as HTMLButtonElement;
    popout.type = 'button';
    popout.setAttribute('aria-label', 'Pop out into a floating window');
    popout.title = 'Pop out into a floating window';
    popout.appendChild(iconPopOut());
    const popoutLabel = el('span', 'cg-colgroups-popout-label');
    popoutLabel.textContent = 'Pop out';
    popout.appendChild(popoutLabel);
    popout.onclick = () => this.api.popOutToolPanel?.('columnGroups');
    bar.appendChild(popout);

    return bar;
  }

  private buildFooter(): HTMLElement {
    const footer = el('div', 'cg-colgroups-footer');
    this.applyBtn = el('button', 'cg-btn cg-btn-primary') as HTMLButtonElement;
    this.applyBtn.type = 'button';
    this.applyBtn.textContent = 'Apply'; this.applyBtn.setAttribute('data-cg-apply', '');
    this.applyBtn.disabled = true; this.applyBtn.onclick = () => this.onApply();
    this.resetBtn = el('button', 'cg-btn') as HTMLButtonElement;
    this.resetBtn.type = 'button';
    this.resetBtn.textContent = 'Reset'; this.resetBtn.setAttribute('data-cg-reset', '');
    this.resetBtn.onclick = () => this.seed();
    footer.append(this.resetBtn, this.applyBtn);
    return footer;
  }

  /** Container for the per-group Style band, keyed off
   *  `this.selectedGroupId`. Always present (stable hook); empty and
   *  collapsed to nothing (`.cg-colgroups-style:empty`) when no group is
   *  selected. */
  private buildStyleSection(): HTMLElement {
    const section = el('div', 'cg-colgroups-style');
    section.setAttribute('data-cg-style', '');
    return section;
  }

  /** Rebuilds the Style band for `this.selectedGroupId` from the CURRENT
   *  `this.nodes` — called at the end of every `render()` so it re-syncs
   *  after any mutation (including its own field edits, which route
   *  through `this.mutate(...)` like every other panel edit — Apply-only
   *  discipline: nothing here writes to the grid). */
  private renderStyle(): void {
    // Destroy every live picker before dropping the reference — each one
    // owns a document/window listener set (+ a body-portaled popover), so
    // resetting the array without destroying first would orphan them.
    this.stylePickers.forEach((p) => p.destroy());
    this.stylePickers = [];
    this.styleSection.replaceChildren();
    this.styleSection.removeAttribute('data-for');
    if (!this.selectedGroupId) return;
    const g = this.nodes.find((n) => n.id === this.selectedGroupId && n.kind === 'group') as
      | GroupNode
      | undefined;
    if (!g) { this.selectedGroupId = null; return; }
    this.styleSection.setAttribute('data-for', g.id);

    const title = el('div', 'cg-colgroups-style-title');
    title.textContent = `Style — ${g.headerName}`;
    this.styleSection.appendChild(title);

    const patch = (
      p: Partial<Pick<GroupNode, 'headerStyle' | 'headerClass' | 'openByDefault' | 'marryChildren'>>,
    ) => this.mutate((ns) => setGroupStyle(ns, g.id, p));
    // Merges against the group's CURRENT headerStyle (read from `ns` at
    // write-time), not the `g` snapshot closed over when the Style band was
    // built — a colour field may have already live-committed a change via
    // `commitStyleLive` (Fix 3) without rebuilding this closure, and merging
    // off a stale `g.headerStyle` here would silently clobber it.
    const patchStyle = (facet: Partial<NonNullable<GroupNode['headerStyle']>>) =>
      this.mutate((ns) => {
        const cur = ns.find((x) => x.id === g.id) as GroupNode | undefined;
        return setGroupStyle(ns, g.id, { headerStyle: { ...cur?.headerStyle, ...facet } });
      });

    this.styleSection.appendChild(this.buildFillTextCluster(g, patchStyle));
    this.styleSection.appendChild(this.buildBorderCluster(g, patch));
    this.styleSection.appendChild(this.buildBehaviorCluster(g, patch));

    // "Children visibility" — mirrors the inline `columnGroupShow` control
    // (see `buildGroupShowControl`) for every column nested (directly or
    // transitively) under the selected group, so a user styling a group can
    // also author its columns' expand/collapse visibility from one place.
    const children = this.descendantColumns(g.id);
    if (children.length > 0) {
      const cluster = el('div', 'cg-colgroups-cluster');
      cluster.appendChild(eyebrow('Children visibility', 'cg-colgroups-cluster-eyebrow'));
      const list = el('div', 'cg-colgroups-childshow-list');
      children.forEach((c) => {
        const row = el('div', 'cg-colgroups-childshow-row');
        const label = document.createElement('label');
        label.className = 'cg-colgroups-childshow-label';
        label.textContent = c.headerName;
        row.appendChild(label);
        row.appendChild(this.buildGroupShowControl(c.colId, c.columnGroupShow, 'child'));
        list.appendChild(row);
      });
      cluster.appendChild(list);
      this.styleSection.appendChild(cluster);
    }
  }

  /** Colour-picker commit path (Fix 3) — writes to the model WITHOUT
   *  rebuilding the Style-band DOM. `ColorPickerControl` emits `onChange` on
   *  every `pointermove` while the user drags inside its body-portaled
   *  popover; the ordinary `mutate() -> render() -> renderStyle()` path
   *  calls `styleSection.replaceChildren()`, which would tear the open
   *  popover (and its swatch) out from under an in-flight drag. This path
   *  sets the model, keeps the Apply button's dirty state in sync, and
   *  refreshes only the cheap border-preview inline styles — nothing else
   *  in the Style band is touched, so an open popover survives.
   *  Apply-only discipline still holds: this writes ONLY to `this.nodes`,
   *  never the grid (see `onApply`). */
  private commitStyleLive(fn: (n: Node[]) => Node[]): void {
    this.nodes = fn(this.nodes);
    this.applyBtn.disabled = !this.dirty;
    this.refreshBorderPreview();
  }

  /** Repaints the border-preview cell's inline styles (bg/fg/per-side
   *  border) for the currently selected group from `this.nodes` — the one
   *  piece of Style-band DOM a live colour commit needs to keep current,
   *  without rebuilding anything else. No-op if the border cluster isn't
   *  mounted (e.g. no group selected). */
  private refreshBorderPreview(): void {
    if (!this.selectedGroupId) return;
    const g = this.nodes.find((n) => n.id === this.selectedGroupId && n.kind === 'group') as
      | GroupNode
      | undefined;
    if (!g) return;
    const preview = this.styleSection.querySelector('.cg-colgroups-border-preview') as HTMLElement | null;
    if (!preview) return;
    preview.style.background = g.headerStyle?.bg ?? '';
    preview.style.color = g.headerStyle?.fg ?? '';
    const border = g.headerStyle?.border;
    preview.style.borderTop = borderSideToCss(effectiveBorderSide(border, 'top'));
    preview.style.borderRight = borderSideToCss(effectiveBorderSide(border, 'right'));
    preview.style.borderBottom = borderSideToCss(effectiveBorderSide(border, 'bottom'));
    preview.style.borderLeft = borderSideToCss(effectiveBorderSide(border, 'left'));
  }

  // ── Style band clusters ────────────────────────────────────────────

  /** FILL & TEXT cluster: bg/fg swatches, a B/I/U segment, size + alignment. */
  private buildFillTextCluster(
    g: GroupNode,
    patchStyle: (facet: Partial<NonNullable<GroupNode['headerStyle']>>) => void,
  ): HTMLElement {
    const cluster = el('div', 'cg-colgroups-cluster');
    cluster.appendChild(eyebrow('Fill & text', 'cg-colgroups-cluster-eyebrow'));

    // Colour edits commit through `commitStyleLive` (Fix 3): the picker
    // emits `onChange` on every pointermove of a drag, and the ordinary
    // `mutate() -> render() -> renderStyle()` path would tear the portaled
    // popover out from under the user mid-drag. Reads the CURRENT node from
    // `ns` (not the closed-over `g`) so back-to-back live commits compose
    // instead of clobbering each other off a stale snapshot.
    const patchStyleLive = (facet: Partial<NonNullable<GroupNode['headerStyle']>>) =>
      this.commitStyleLive((ns) => {
        const cur = ns.find((x) => x.id === g.id) as GroupNode | undefined;
        return setGroupStyle(ns, g.id, { headerStyle: { ...cur?.headerStyle, ...facet } });
      });

    // Row 1 — Background + Text colour swatches, side by side.
    const colorRow = el('div', 'cg-colgroups-field-row');
    colorRow.appendChild(this.colorField('bg', 'Fill', g.headerStyle?.bg,
      (rgba) => patchStyleLive({ bg: rgba }), 'Background colour'));
    colorRow.appendChild(this.colorField('fg', 'Text', g.headerStyle?.fg,
      (rgba) => patchStyleLive({ fg: rgba }), 'Text colour'));
    cluster.appendChild(colorRow);

    // Row 2 — B / I / U segment + alignment icon segment.
    const styleRow = el('div', 'cg-colgroups-field-row');

    const biu = el('div', 'cg-colgroups-seg');
    biu.setAttribute('role', 'group');
    biu.setAttribute('aria-label', 'Text style');
    biu.appendChild(this.toggleSegBtn('fontWeight', 'B', 'Bold', 'cg-colgroups-seg-bold',
      g.headerStyle?.fontWeight === 'bold',
      (on) => patchStyle({ fontWeight: on ? 'bold' : undefined })));
    biu.appendChild(this.toggleSegBtn('fontStyle', 'I', 'Italic', 'cg-colgroups-seg-italic',
      g.headerStyle?.fontStyle === 'italic',
      (on) => patchStyle({ fontStyle: on ? 'italic' : undefined })));
    biu.appendChild(this.toggleSegBtn('textDecoration', 'U', 'Underline', 'cg-colgroups-seg-underline',
      g.headerStyle?.textDecoration === 'underline',
      (on) => patchStyle({ textDecoration: on ? 'underline' : undefined })));
    styleRow.appendChild(biu);

    const align = el('div', 'cg-colgroups-seg');
    align.setAttribute('data-cg-field', 'halign');
    align.setAttribute('role', 'group');
    align.setAttribute('aria-label', 'Alignment');
    const cur = g.headerStyle?.halign ?? 'left';
    ([
      ['left', 'Align left', ALIGN_LEFT_SVG],
      ['center', 'Align center', ALIGN_CENTER_SVG],
      ['right', 'Align right', ALIGN_RIGHT_SVG],
    ] as const).forEach(([value, label, svg]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cg-colgroups-seg-btn cg-colgroups-seg-icon';
      b.setAttribute('data-align', value);
      b.setAttribute('aria-label', label);
      b.title = label;
      b.setAttribute('aria-pressed', String(cur === value));
      b.innerHTML = svg;
      b.addEventListener('click', () => patchStyle({ halign: value }));
      align.appendChild(b);
    });
    styleRow.appendChild(align);
    cluster.appendChild(styleRow);

    // Row 3 — Font size.
    cluster.appendChild(this.numberField(
      'fontSize', 'Size', g.headerStyle?.fontSize, 'Font size', 8, 32, 'auto',
      (n) => (n && Number.isFinite(n) ? n : undefined),
      (n) => patchStyle({ fontSize: n }),
    ));

    return cluster;
  }

  /** BORDER cluster — the signature box-model editor: a live preview cell
   *  with four clickable edge strips + an `All` toggle, and width/style/
   *  colour controls that read & write the currently selected edge. */
  private buildBorderCluster(
    g: GroupNode,
    patch: (p: Partial<Pick<GroupNode, 'headerStyle'>>) => void,
  ): HTMLElement {
    const cluster = el('div', 'cg-colgroups-cluster');
    cluster.appendChild(eyebrow('Border', 'cg-colgroups-cluster-eyebrow'));

    const editor = el('div', 'cg-colgroups-border');
    editor.setAttribute('data-cg-border', '');
    const border = g.headerStyle?.border;

    const stage = el('div', 'cg-colgroups-border-stage');
    const preview = el('div', 'cg-colgroups-border-preview');
    if (g.headerStyle?.bg) preview.style.background = g.headerStyle.bg;
    if (g.headerStyle?.fg) preview.style.color = g.headerStyle.fg;
    preview.style.borderTop = borderSideToCss(effectiveBorderSide(border, 'top'));
    preview.style.borderRight = borderSideToCss(effectiveBorderSide(border, 'right'));
    preview.style.borderBottom = borderSideToCss(effectiveBorderSide(border, 'bottom'));
    preview.style.borderLeft = borderSideToCss(effectiveBorderSide(border, 'left'));
    const previewLabel = el('span', 'cg-colgroups-border-preview-label');
    previewLabel.textContent = g.headerName || 'Header';
    preview.appendChild(previewLabel);
    stage.appendChild(preview);

    (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cg-colgroups-edge cg-colgroups-edge-${edge}`;
      b.setAttribute('data-cg-border-edge', edge);
      b.setAttribute('aria-label', `${cap(edge)} border`);
      b.setAttribute('aria-pressed', String(this.selectedEdge === edge));
      b.addEventListener('click', () => { this.selectedEdge = edge; this.render(); });
      stage.appendChild(b);
    });
    editor.appendChild(stage);

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'cg-colgroups-seg-btn cg-colgroups-edge-all';
    allBtn.setAttribute('data-cg-border-edge', 'all');
    allBtn.textContent = 'All sides';
    allBtn.setAttribute('aria-label', 'All borders');
    allBtn.setAttribute('aria-pressed', String(this.selectedEdge === 'all'));
    allBtn.addEventListener('click', () => { this.selectedEdge = 'all'; this.render(); });
    editor.appendChild(allBtn);

    // Caption — makes the box-model editor legible: names the side the
    // Width / Style / Colour controls below currently write to.
    const caption = el('div', 'cg-colgroups-border-caption');
    caption.textContent = this.selectedEdge === 'all'
      ? 'Editing all sides'
      : `Editing ${this.selectedEdge} border`;
    editor.appendChild(caption);

    // Width / style / colour — read & write the SELECTED edge.
    const edge = this.selectedEdge;
    const side = border?.[edge];
    // Reads the CURRENT border off `ns` at write-time rather than the
    // closed-over `border`/`g` snapshot — a colour edit may already have
    // live-committed a change via `commitStyleLive` without rebuilding this
    // closure (Fix 3), and merging off stale state here would clobber it.
    const writeSide = (facet: 'width' | 'style', value: number | string | undefined) => {
      this.mutate((ns) => {
        const cur = ns.find((x) => x.id === g.id) as GroupNode | undefined;
        const curBorder = cur?.headerStyle?.border;
        const nextSide = { ...curBorder?.[edge], [facet]: value };
        const nextBorder = pruneBorder({ ...curBorder, [edge]: nextSide });
        return setGroupStyle(ns, g.id, { headerStyle: { ...cur?.headerStyle, border: nextBorder } });
      });
    };
    // Border colour, specifically, commits through `commitStyleLive` (Fix 3)
    // instead of `writeSide`/`patch` — same no-rebuild-mid-drag reasoning as
    // the Fill/Text swatches above. Reads the CURRENT border off `ns` so
    // consecutive live commits (a hue/alpha drag) compose correctly.
    const writeSideColorLive = (value: string | undefined) => {
      this.commitStyleLive((ns) => {
        const cur = ns.find((x) => x.id === g.id) as GroupNode | undefined;
        const curBorder = cur?.headerStyle?.border;
        const nextSide = { ...curBorder?.[edge], color: value };
        const nextBorder = pruneBorder({ ...curBorder, [edge]: nextSide });
        return setGroupStyle(ns, g.id, { headerStyle: { ...cur?.headerStyle, border: nextBorder } });
      });
    };

    const fields = el('div', 'cg-colgroups-border-fields');

    fields.appendChild(this.numberField(
      'borderWidth', 'Width', side?.width, `${cap(edge)} border width`, 0, 8, '0',
      (n) => (Number.isFinite(n) && n > 0 ? n : undefined),
      (n) => writeSide('width', n),
    ));

    const styleWrap = el('div', 'cg-colgroups-field');
    styleWrap.setAttribute('data-cg-field', 'borderStyle');
    const styleLabel = labelEl('cg-colgroups-field-label');
    styleLabel.textContent = 'Style';
    const styleSel = document.createElement('select');
    styleSel.className = 'cg-settings-input cg-settings-select';
    styleSel.setAttribute('aria-label', `${cap(edge)} border style`);
    (['solid', 'dashed', 'dotted', 'double'] as const).forEach((v) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = cap(v);
      styleSel.appendChild(o);
    });
    styleSel.value = side?.style ?? 'solid';
    styleSel.addEventListener('change', () => writeSide('style', styleSel.value as BorderStyle));
    const styleId = uid(); styleSel.id = styleId; styleLabel.htmlFor = styleId;
    styleWrap.append(styleLabel, styleSel);
    fields.appendChild(styleWrap);

    fields.appendChild(this.colorField('borderColor', 'Colour', side?.color,
      writeSideColorLive, `${cap(edge)} border colour`));

    editor.appendChild(fields);
    cluster.appendChild(editor);
    return cluster;
  }

  /** BEHAVIOR cluster: marryChildren + openByDefault switches. */
  private buildBehaviorCluster(
    g: GroupNode,
    patch: (p: Partial<Pick<GroupNode, 'openByDefault' | 'marryChildren'>>) => void,
  ): HTMLElement {
    const cluster = el('div', 'cg-colgroups-cluster');
    cluster.appendChild(eyebrow('Behavior', 'cg-colgroups-cluster-eyebrow'));
    cluster.appendChild(this.switchRow('marryChildren', 'Keep columns together',
      g.marryChildren === true, (on) => patch({ marryChildren: on })));
    cluster.appendChild(this.switchRow('openByDefault', 'Expanded by default',
      g.openByDefault === true, (on) => patch({ openByDefault: on })));
    return cluster;
  }

  // ── Style band control builders ────────────────────────────────────

  /** A labelled colour swatch wrapped in `data-cg-field="{key}"`, backed by
   *  the shared `ColorPickerControl` (the E2E depends on `.cg-colorpicker-swatch`).
   *  `swatchAriaLabel`, when given, overrides the control's generic default
   *  ("Choose colour") so the Fill/Text/Border swatches co-present in this
   *  band read distinctly to a screen reader (Fix 4). */
  private colorField(
    key: string,
    label: string,
    value: string | undefined,
    onChange: (rgba: string) => void,
    swatchAriaLabel?: string,
  ): HTMLElement {
    const wrap = el('div', 'cg-colgroups-field cg-colgroups-field-color');
    wrap.setAttribute('data-cg-field', key);
    const lbl = el('span', 'cg-colgroups-field-label');
    lbl.textContent = label;
    const picker = new ColorPickerControl(value ?? '', onChange);
    this.stylePickers.push(picker);
    if (swatchAriaLabel) {
      picker.el.querySelector('.cg-colorpicker-swatch')?.setAttribute('aria-label', swatchAriaLabel);
    }
    wrap.append(lbl, picker.el);
    return wrap;
  }

  /** A labelled `<input type="number">` wrapped in `data-cg-field="{key}"`
   *  (Fix 5) — shared by the Fill & text cluster's Size field and the
   *  Border cluster's edge-scoped Width field, which were near-identical
   *  hand-rolled blocks. `normalize` maps the raw parsed number to the
   *  facet's valid domain (or `undefined` to clear it, e.g. Size allows any
   *  finite non-zero value while Width additionally requires `n > 0`);
   *  `onCommit` receives that normalized value and decides how to write it
   *  (a plain `patchStyle`, or the border cluster's edge-scoped `writeSide`). */
  private numberField(
    key: string,
    label: string,
    value: number | undefined,
    ariaLabel: string,
    min: number,
    max: number,
    placeholder: string,
    normalize: (n: number) => number | undefined,
    onCommit: (n: number | undefined) => void,
  ): HTMLElement {
    const wrap = el('div', 'cg-colgroups-field');
    wrap.setAttribute('data-cg-field', key);
    const lbl = labelEl('cg-colgroups-field-label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'cg-settings-input cg-settings-input-number';
    input.min = String(min); input.max = String(max);
    input.setAttribute('aria-label', ariaLabel);
    input.value = typeof value === 'number' ? String(value) : '';
    input.placeholder = placeholder;
    input.addEventListener('change', () => {
      const raw = input.value === '' ? undefined : Number(input.value);
      onCommit(raw === undefined ? undefined : normalize(raw));
    });
    const id = uid(); input.id = id; lbl.htmlFor = id;
    wrap.append(lbl, input);
    return wrap;
  }

  /** A single toggle in the B/I/U segment: a button carrying `data-cg-field`
   *  directly, `aria-pressed`, styled per the letter. */
  private toggleSegBtn(
    key: string,
    glyph: string,
    label: string,
    extraClass: string,
    active: boolean,
    onToggle: (on: boolean) => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cg-colgroups-seg-btn ${extraClass}`;
    b.setAttribute('data-cg-field', key);
    b.textContent = glyph;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(active));
    b.addEventListener('click', () => onToggle(b.getAttribute('aria-pressed') !== 'true'));
    return b;
  }

  /** A label-left / pill-switch-right row wrapped in `data-cg-field="{key}"`.
   *  The switch reuses the `.cg-settings-toggle` idiom (aria-pressed pill). */
  private switchRow(
    key: string,
    label: string,
    active: boolean,
    onToggle: (on: boolean) => void,
  ): HTMLElement {
    const row = el('div', 'cg-colgroups-switch-row');
    row.setAttribute('data-cg-field', key);
    const lbl = labelEl('cg-colgroups-switch-label');
    lbl.textContent = label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cg-settings-toggle';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(active));
    const knob = el('span', 'cg-settings-toggle-knob');
    btn.appendChild(knob);
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(next));
      onToggle(next);
    });
    const btnId = uid(); btn.id = btnId; lbl.htmlFor = btnId;
    row.append(lbl, btn);
    return row;
  }

  /** All column (leaf) descendants of group `groupId`, direct + nested,
   *  depth-first in sibling order — used to populate the Style band's
   *  "Children visibility" list. */
  private descendantColumns(groupId: string): ColumnNode[] {
    const out: ColumnNode[] = [];
    const walk = (parentId: string) => {
      this.nodes
        .filter((n) => n.parentId === parentId)
        .sort((a, b) => a.order - b.order)
        .forEach((n) => {
          if (n.kind === 'column') out.push(n);
          else walk(n.id);
        });
    };
    walk(groupId);
    return out;
  }

  // ── Row builders ───────────────────────────────────────────────────

  private groupControls(n: GroupNode): HTMLElement {
    const wrap = el('div', 'cg-colgroups-row-main');

    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'cg-colgroups-chevron';
    chevron.setAttribute('aria-expanded', String(!this.collapsed.has(n.id)));
    chevron.setAttribute('aria-label', 'Toggle group');
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      // Collapse/expand is panel VIEW-STATE (not model state) so it must
      // survive `render()` on every mutation — see `this.collapsed`.
      if (this.collapsed.has(n.id)) this.collapsed.delete(n.id);
      else this.collapsed.add(n.id);
      this.render();
    });
    wrap.appendChild(chevron);

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'cg-colgroups-name cg-colgroups-name-group';
    name.value = n.headerName;
    name.setAttribute('aria-label', 'Group name');
    name.addEventListener('change', () => this.mutate((ns) => renameGroup(ns, n.id, name.value)));
    wrap.appendChild(name);

    const errorEl = el('span', 'cg-colgroups-error');
    errorEl.setAttribute('data-cg-error', n.id);
    wrap.appendChild(errorEl);

    const actions = el('div', 'cg-colgroups-row-actions');

    // Keyboard-reachable selection affordance: a real <button> (not a
    // click-only row) so choosing a group to style works via Tab + Enter/
    // Space, with a visible focus ring (`.cg-colgroups-action:focus-visible`).
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'cg-colgroups-action';
    selectBtn.appendChild(iconGear());
    selectBtn.title = 'Edit group style';
    selectBtn.setAttribute('aria-label', 'Edit group style');
    selectBtn.setAttribute('data-cg-select', '');
    selectBtn.setAttribute('aria-pressed', String(this.selectedGroupId === n.id));
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectGroup(n.id);
    });
    actions.appendChild(selectBtn);

    const addSub = document.createElement('button');
    addSub.type = 'button';
    addSub.className = 'cg-colgroups-action';
    addSub.appendChild(iconPlus());
    addSub.title = 'Add subgroup';
    addSub.setAttribute('aria-label', 'Add subgroup');
    addSub.addEventListener('click', (e) => {
      e.stopPropagation();
      this.mutate((ns) => createGroup(ns, n.id, 'New Group'));
    });
    actions.appendChild(addSub);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cg-colgroups-action';
    del.appendChild(iconClose());
    del.title = 'Delete group';
    del.setAttribute('aria-label', 'Delete group');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.selectedGroupId === n.id) this.selectedGroupId = null;
      this.collapsed.delete(n.id);
      this.mutate((ns) => deleteGroup(ns, n.id));
    });
    actions.appendChild(del);

    wrap.appendChild(actions);
    return wrap;
  }

  private columnControls(n: ColumnNode): HTMLElement {
    const wrap = el('div', 'cg-colgroups-row-main');

    const handle = el('span', 'cg-colgroups-handle');
    handle.setAttribute('aria-hidden', 'true');
    handle.appendChild(iconGrip());
    wrap.appendChild(handle);

    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'cg-colgroups-checkbox-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cg-colgroups-checkbox';
    checkbox.checked = n.hide !== true;
    checkbox.setAttribute('aria-label', `Show ${n.headerName}`);
    checkbox.addEventListener('change', () => {
      this.mutate((ns) => setHidden(ns, n.colId, !checkbox.checked));
    });
    checkboxLabel.appendChild(checkbox);
    wrap.appendChild(checkboxLabel);

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'cg-colgroups-name';
    name.value = n.headerName;
    name.setAttribute('aria-label', 'Column name');
    name.addEventListener('change', () => this.mutate((ns) => setColumnHeaderName(ns, n.colId, name.value)));
    wrap.appendChild(name);

    // Expand/collapse visibility (`columnGroupShow`) only makes sense for a
    // column that lives INSIDE a group — an ungrouped (top-level) column has
    // no group to open/close relative to, so no control is rendered for it.
    if (n.parentId !== null) {
      wrap.appendChild(this.buildVisibilityControl(n.colId, n.columnGroupShow));
    }

    return wrap;
  }

  /** Inline column-group visibility affordance (row-level). Reveals the full
   *  3-state picker only on row hover (see `.cg-colgroups-visibility` CSS); when
   *  the row is at rest a single muted caret marks a CONDITIONAL column (open /
   *  closed) so it reads at a glance, while an always-visible column shows
   *  nothing — keeping the common case clutter-free. */
  private buildVisibilityControl(
    colId: string,
    value: 'open' | 'closed' | null | undefined,
  ): HTMLElement {
    const vis = el('div', 'cg-colgroups-visibility');
    const state = value ?? '';
    // Rest-state marker — only for conditional columns.
    if (state === 'open' || state === 'closed') {
      const marker = el('span', 'cg-colgroups-vis-current');
      marker.setAttribute('aria-hidden', 'true');
      marker.appendChild(iconGroupShow(state));
      marker.title = state === 'open'
        ? 'Visible only when the group is expanded'
        : 'Visible only when the group is collapsed';
      vis.appendChild(marker);
    }
    // Hover-revealed picker.
    const picker = this.buildGroupShowControl(colId, value, 'inline');
    picker.classList.add('cg-colgroups-vis-picker');
    vis.appendChild(picker);
    return vis;
  }

  /** Shared control builder for BOTH `columnGroupShow` UI surfaces — the
   *  inline per-row control (`variant: 'inline'`, tagged `data-cg-groupshow`)
   *  and the Style band's "Children visibility" mirror (`variant: 'child'`,
   *  tagged `data-cg-child-show="<colId>"`). Both funnel through this one
   *  helper so the two surfaces can never diverge: same options, same
   *  `setColumnGroupShow` write, and — because every write triggers
   *  `mutate()` -> `render()` -> `renderStyle()` — each surface always
   *  reflects the other's latest edit. */
  private buildGroupShowControl(
    colId: string,
    value: 'open' | 'closed' | null | undefined,
    variant: 'inline' | 'child',
  ): HTMLElement {
    const seg = el('div', 'cg-colgroups-seg cg-colgroups-groupshow');
    if (variant === 'inline') seg.setAttribute('data-cg-groupshow', '');
    else seg.setAttribute('data-cg-child-show', colId);
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Column group visibility');
    const cur = value ?? '';
    ([
      { v: '', kind: 'always', title: 'Always visible' },
      { v: 'open', kind: 'open', title: 'Show when open' },
      { v: 'closed', kind: 'closed', title: 'Show when collapsed' },
    ] as const).forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cg-colgroups-seg-btn cg-colgroups-seg-icon';
      b.appendChild(iconGroupShow(opt.kind));
      b.title = opt.title;
      b.setAttribute('aria-label', opt.title);
      b.setAttribute('data-value', opt.v);
      b.setAttribute('aria-pressed', String(cur === opt.v));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const v = opt.v === '' ? null : (opt.v as 'open' | 'closed');
        this.mutate((ns) => setColumnGroupShow(ns, colId, v));
      });
      seg.appendChild(b);
    });
    return seg;
  }

  private flagGroup(groupId: string, message: string): void {
    const errorEl = this.tree.querySelector(`[data-cg-error="${cssEscape(groupId)}"]`);
    if (errorEl) errorEl.textContent = message;
  }

  // ── Drag & drop ────────────────────────────────────────────────────

  private wireDrag(row: HTMLElement, n: Node): void {
    const handleEl = n.kind === 'column'
      ? row.querySelector('.cg-colgroups-handle')
      : row; // groups are draggable by their row (excluding interactive controls)
    if (!handleEl) return;
    handleEl.addEventListener('mousedown', (evt) => {
      const e = evt as MouseEvent;
      const target = e.target as HTMLElement;
      if (n.kind === 'group' && (target.closest('button') || target.closest('input'))) return;
      // Don't start a drag session (body-level ghost etc.) on a plain
      // mousedown — only promote to a real drag once the pointer has moved
      // past DRAG_THRESHOLD_PX, so a simple click-to-select stays cheap.
      this.pending = { node: n, row, startX: e.clientX, startY: e.clientY };
      document.addEventListener('mousemove', this.onPendingMove);
      document.addEventListener('mouseup', this.onPendingUp);
    });
  }

  private handlePendingMove(e: MouseEvent): void {
    const p = this.pending;
    if (!p) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
    document.removeEventListener('mousemove', this.onPendingMove);
    document.removeEventListener('mouseup', this.onPendingUp);
    this.pending = null;
    e.preventDefault();
    this.beginDrag(e, p.node, p.row);
  }

  private cancelPendingDrag(): void {
    document.removeEventListener('mousemove', this.onPendingMove);
    document.removeEventListener('mouseup', this.onPendingUp);
    this.pending = null;
  }

  private beginDrag(e: MouseEvent, n: Node, row: HTMLElement): void {
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true) as HTMLElement;
    ghost.classList.add('cg-colgroups-row-ghost');
    ghost.style.position = 'fixed';
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.pointerEvents = 'none';
    document.body.appendChild(ghost);

    this.drag = {
      id: n.id,
      kind: n.kind,
      ghost,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    row.classList.add('cg-colgroups-row-source');
    document.addEventListener('mousemove', this.onDragMove);
    document.addEventListener('mouseup', this.onDragEnd);
  }

  private handleDragMove(e: MouseEvent): void {
    if (!this.drag) return;
    this.drag.ghost.style.left = `${e.clientX - this.drag.offsetX}px`;
    this.drag.ghost.style.top = `${e.clientY - this.drag.offsetY}px`;

    // Clear previous drop-target markers.
    this.tree.querySelectorAll('[data-drop]').forEach((r) => r.removeAttribute('data-drop'));

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const targetRow = under?.closest('[data-cg-node]') as HTMLElement | null;
    if (!targetRow || targetRow.getAttribute('data-cg-node') === this.drag.id) return;
    const targetId = targetRow.getAttribute('data-cg-node')!;
    const targetNode = this.nodes.find((x) => x.id === targetId);
    if (!targetNode) return;
    const targetParentId = targetNode.kind === 'group' ? targetNode.id : targetNode.parentId;
    const accept = canDrop(this.nodes, this.drag.id, targetParentId);
    targetRow.setAttribute('data-drop', accept ? 'accept' : 'reject');
  }

  private handleDragEnd(e: MouseEvent): void {
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragEnd);
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    drag.ghost.remove();
    this.tree.querySelectorAll('[data-drop]').forEach((r) => r.removeAttribute('data-drop'));
    this.tree.querySelectorAll('.cg-colgroups-row-source').forEach((r) => r.classList.remove('cg-colgroups-row-source'));

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const targetRow = under?.closest('[data-cg-node]') as HTMLElement | null;
    if (!targetRow) return;
    const targetId = targetRow.getAttribute('data-cg-node')!;
    if (targetId === drag.id) return;
    const targetNode = this.nodes.find((x) => x.id === targetId);
    if (!targetNode) return;
    const onGroupHeader = targetNode.kind === 'group';
    const resolved = resolveDrop(this.nodes, drag.id, targetId, onGroupHeader);
    if (!resolved || !canDrop(this.nodes, drag.id, resolved.parentId)) return;
    this.mutate((ns) => moveNode(ns, drag.id, resolved.parentId, resolved.order));
  }
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }

function labelEl(cls: string): HTMLLabelElement { const e = document.createElement('label'); e.className = cls; return e; }

/** A cluster/section eyebrow (11px, 600, uppercase, tracked, muted). */
function eyebrow(text: string, cls = 'cg-colgroups-eyebrow'): HTMLElement {
  const e = el('div', cls);
  e.textContent = text;
  return e;
}

let controlSeq = 0;
const uid = (): string => `cg-colgroups-ctl-${++controlSeq}`;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

// Alignment glyphs for the halign icon segment — currentColor-driven so both
// themes get correct contrast for free. Rows encode left/center/right ragging.
const ALIGN_LEFT_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h7M2.5 12h9"/></g></svg>';
const ALIGN_CENTER_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M4.5 8h7M3.5 12h9"/></g></svg>';
const ALIGN_RIGHT_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M6.5 8h7M4.5 12h9"/></g></svg>';
