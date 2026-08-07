/**
 * Cycle 21i — Column Groups tool panel (built-in `agColumnGroupsToolPanel`,
 * sidebar shortcut `'columnGroups'`). Authors the columnDefs group tree via
 * the normalized flat model; writes to the grid only on Apply.
 *
 * Layout: master–detail body (groups list | selected-group editor) →
 * Apply/Reset footer. Left rail lists groups only (select / rename /
 * delete); column visibility and drag into/out of groups live on the
 * Columns side panel. The right pane edits the selected group's name,
 * direct column membership (chips), and style.
 */
import type { ToolPanel, ToolPanelParams } from './types';
import {
  flatten, project, createGroup, deleteGroup, moveNode,
  renameGroup, validate, canDrop,
  setGroupStyle, setColumnGroupShow,
  type Node, type GroupNode, type ColumnNode,
} from '../columnGroups/model';
import type { CGridApi } from '../../types';
import { ColorPickerControl, parseColor } from '../settingsForm/colorPicker';
import type { BorderSpec, BorderStyle } from '../../types/cell';
import { cloneDefsTree } from '../../core/columnTree';

/** One editable side of the box-model border editor, or the `all` fallback. */
type BorderEdge = 'all' | 'top' | 'right' | 'bottom' | 'left';

type ShowValue = 'open' | 'closed' | null;

const SHOW_ORDER: readonly ShowValue[] = [null, 'open', 'closed'];

function nextShow(v: ShowValue | undefined): ShowValue {
  const cur = v === undefined ? null : v;
  const i = SHOW_ORDER.indexOf(cur);
  return SHOW_ORDER[(i < 0 ? 0 : i + 1) % SHOW_ORDER.length]!;
}

function showKind(v: ShowValue | undefined): 'always' | 'open' | 'closed' {
  if (v === 'open') return 'open';
  if (v === 'closed') return 'closed';
  return 'always';
}

function showLabel(kind: 'always' | 'open' | 'closed'): string {
  if (kind === 'always') return 'Always visible';
  if (kind === 'open') return 'Show when open';
  return 'Show when collapsed';
}

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
function iconGroupShow(kind: 'always' | 'open' | 'closed'): SVGSVGElement {
  if (kind === 'always') {
    return icon(
      svgEl('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', ...strokeAttrs }),
      svgEl('circle', { cx: '12', cy: '12', r: '3', ...strokeAttrs }),
    );
  }
  if (kind === 'open') {
    return icon(svgEl('path', { d: 'M15 18l-6-6 6-6', ...strokeAttrs }));
  }
  return icon(svgEl('path', { d: 'M9 6l6 6-6 6', ...strokeAttrs }));
}
function iconPlus(): SVGSVGElement { return icon(svgEl('path', { d: 'M12 5v14M5 12h14', ...strokeAttrs })); }
function iconClose(): SVGSVGElement { return icon(svgEl('path', { d: 'M18 6 6 18M6 6l12 12', ...strokeAttrs })); }
function iconChevronUp(): SVGSVGElement { return icon(svgEl('path', { d: 'M18 15l-6-6-6 6', ...strokeAttrs })); }
function iconChevronDown(): SVGSVGElement { return icon(svgEl('path', { d: 'M6 9l6 6 6-6', ...strokeAttrs })); }

/** Optional factory (from `@cgrid/ext`) that mounts Font / Alignment /
 *  Borders chrome into the style band — keeps kernel free of an ext dep. */
export type MountGroupStyleChrome = (
  host: HTMLElement,
  adapter: {
    getStyle: () => Record<string, unknown>;
    applyStyle: (patch: Record<string, unknown>) => void;
  },
) => () => void;

export class ColumnGroupsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private list!: HTMLElement;
  private listBody!: HTMLElement;
  private listCount!: HTMLElement;
  private editor!: HTMLElement;
  /** Live colour-picker controls in the current Style band — destroyed on
   *  panel teardown so no portaled popover outlives the panel. Reset (not
   *  destroyed) on each editor rebuild so an in-flight popover the
   *  user is dragging is never yanked mid-interaction. */
  private stylePickers: ColorPickerControl[] = [];
  /** Disposer for the optional Formatting-ribbon style chrome. */
  private styleChromeDispose: (() => void) | null = null;
  /** Which border edge the box-model editor is currently editing. VIEW-STATE
   *  only (default `'all'`); survives `mutate()`/`render()`. */
  private selectedEdge: BorderEdge = 'all';
  private applyBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private api!: Pick<CGridApi, 'getColumnGroupDefs' | 'updateGridOptions'>;
  private nodes: Node[] = [];
  /** Canonical JSON of the last-applied projected tree — comparing against
   *  `project(nodes)` (also projected) makes seed→dirty reliably false even
   *  though raw defs and projected defs differ by key order / dropped
   *  undefineds. */
  private baseline = '';
  /** Selected group id (editor target). VIEW-STATE only. */
  private selectedId: string | null = null;
  /** When provided (ext settings sheet), use ribbon Font/Alignment/Borders. */
  private mountStyleChrome: MountGroupStyleChrome | null = null;

  init(params: ToolPanelParams): void {
    this.api = params.api as unknown as typeof this.api;
    const factory = params.toolPanelParams?.mountStyleChrome;
    this.mountStyleChrome = typeof factory === 'function'
      ? (factory as MountGroupStyleChrome)
      : null;
    this.root = el('div', 'cg-colgroups-panel');
    const body = el('div', 'cg-colgroups-body');
    body.append(this.buildListPane(), this.buildEditorPane());
    this.root.appendChild(body);
    this.root.appendChild(this.buildFooter());
    this.seed();
  }

  getGui(): HTMLElement { return this.root; }
  refresh(): void { this.seed(); }
  destroy(): void {
    this.disposeStyleChrome();
    this.stylePickers.forEach((p) => p.destroy());
    this.stylePickers = [];
    this.root.remove();
  }

  private disposeStyleChrome(): void {
    if (!this.styleChromeDispose) return;
    try { this.styleChromeDispose(); } catch { /* */ }
    this.styleChromeDispose = null;
  }

  private seed(): void {
    const defs = this.api.getColumnGroupDefs();
    this.nodes = flatten(cloneDefsTree(defs));
    this.baseline = JSON.stringify(project(this.nodes));
    const firstGroup = this.nodes
      .filter((n): n is GroupNode => n.kind === 'group')
      .sort((a, b) => {
        if (a.parentId === null && b.parentId !== null) return -1;
        if (a.parentId !== null && b.parentId === null) return 1;
        return a.order - b.order;
      })[0];
    this.selectedId = firstGroup?.id ?? null;
    this.render();
  }

  private mutate(fn: (n: Node[]) => Node[]): void { this.nodes = fn(this.nodes); this.render(); }

  /** Select a group without toggle-off (StarUI keeps selection on re-click). */
  private selectGroup(id: string): void {
    this.selectedId = id;
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

  private addGroup(): void {
    const before = new Set(this.nodes.filter((n) => n.kind === 'group').map((n) => n.id));
    this.nodes = createGroup(this.nodes, null, 'New Group');
    const created = this.nodes.find((n) => n.kind === 'group' && !before.has(n.id));
    this.selectedId = created?.id ?? null;
    this.render();
  }

  private removeColumnFromGroup(colId: string): void {
    this.mutate((ns) => {
      const col = ns.find((n) => n.kind === 'column' && n.colId === colId);
      if (!col) return ns;
      // Authoring remove always allowed — marryChildren only guards runtime drag.
      const top = ns.filter((n) => n.parentId === null).length;
      return moveNode(ns, col.id, null, top, { bypassMarryChildren: true });
    });
  }

  private addColumnToGroup(groupId: string, colId: string): void {
    this.addColumnsToGroup(groupId, [colId]);
  }

  /** Move several unassigned columns into `groupId` in one draft mutation. */
  private addColumnsToGroup(groupId: string, colIds: readonly string[]): void {
    if (colIds.length === 0) return;
    this.mutate((ns) => {
      let next = ns;
      for (const colId of colIds) {
        const col = next.find((n) => n.kind === 'column' && n.colId === colId);
        if (!col) continue;
        if (!canDrop(next, col.id, groupId, { bypassMarryChildren: true })) continue;
        const kids = next.filter((n) => n.parentId === groupId).length;
        next = moveNode(next, col.id, groupId, kids, { bypassMarryChildren: true });
      }
      return next;
    });
  }

  private moveGroupAmongSiblings(groupId: string, dir: -1 | 1): void {
    this.mutate((ns) => {
      const g = ns.find((n) => n.id === groupId && n.kind === 'group');
      if (!g) return ns;
      const allSibs = ns
        .filter((n) => n.parentId === g.parentId)
        .sort((a, b) => a.order - b.order);
      const groupSibs = allSibs.filter((n) => n.kind === 'group');
      const i = groupSibs.findIndex((s) => s.id === groupId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= groupSibs.length) return ns;
      const targetIdx = allSibs.findIndex((s) => s.id === groupSibs[j]!.id);
      if (targetIdx < 0) return ns;
      // moveNode order = PRE-move sibling index to land BEFORE.
      const order = dir < 0 ? targetIdx : targetIdx + 1;
      return moveNode(ns, groupId, g.parentId, order);
    });
  }

  private render(): void {
    this.renderList();
    this.renderEditor();
    this.applyBtn.disabled = !this.dirty;
  }

  // ── List pane ──────────────────────────────────────────────────────

  private buildListPane(): HTMLElement {
    this.list = el('div', 'cg-colgroups-list');
    const head = el('div', 'cg-colgroups-list-header');
    const title = el('span', 'cg-colgroups-list-title');
    title.textContent = 'Groups';
    this.listCount = el('span', 'cg-colgroups-list-count');
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'cg-colgroups-action';
    add.appendChild(iconPlus());
    add.title = 'Add group';
    add.setAttribute('aria-label', 'Add group');
    add.setAttribute('data-cg-add-group', '');
    add.onclick = () => this.addGroup();
    head.append(title, this.listCount, add);
    this.listBody = el('div', 'cg-colgroups-list-body cg-scrollbar');
    this.list.append(head, this.listBody);
    return this.list;
  }

  private buildEditorPane(): HTMLElement {
    this.editor = el('div', 'cg-colgroups-editor cg-scrollbar');
    return this.editor;
  }

  private renderList(): void {
    this.listBody.replaceChildren();
    const groups = this.nodes.filter((n): n is GroupNode => n.kind === 'group');
    this.listCount.textContent = String(groups.length);

    if (groups.length === 0) {
      const empty = el('div', 'cg-colgroups-empty');
      empty.textContent = 'No groups yet. Click + to create one.';
      this.listBody.appendChild(empty);
      return;
    }

    const renderLevel = (parentId: string | null, depth: number) => {
      const sibs = groups
        .filter((n) => n.parentId === parentId)
        .sort((a, b) => a.order - b.order);
      for (const g of sibs) {
        this.listBody.appendChild(this.listRow(g, depth));
        renderLevel(g.id, depth + 1);
      }
    };
    renderLevel(null, 0);
  }

  private listRow(g: GroupNode, depth: number): HTMLElement {
    const row = el('div', 'cg-colgroups-row');
    row.setAttribute('data-cg-node', g.id);
    row.setAttribute('data-kind', 'group');
    row.style.paddingInlineStart = `calc(10px + ${depth} * 14px)`;
    if (this.selectedId === g.id) row.setAttribute('data-selected', '');
    if (g.hide) row.setAttribute('data-hidden', '');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'cg-colgroups-list-item';
    selectBtn.setAttribute('data-cg-select', '');
    selectBtn.setAttribute('aria-pressed', String(this.selectedId === g.id));
    selectBtn.setAttribute('aria-label', `Select group ${g.headerName || g.id}`);
    const name = el('span', 'cg-colgroups-list-name');
    name.textContent = g.headerName || g.id;
    selectBtn.appendChild(name);
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectGroup(g.id);
    });

    const errorEl = el('span', 'cg-colgroups-error');
    errorEl.setAttribute('data-cg-error', g.id);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cg-colgroups-action';
    del.appendChild(iconClose());
    del.title = 'Delete group';
    del.setAttribute('aria-label', 'Delete group');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.selectedId === g.id) {
        const parent = g.parentId;
        this.selectedId = parent
          ?? this.nodes.find((n) => n.kind === 'group' && n.id !== g.id)?.id
          ?? null;
      }
      this.mutate((ns) => deleteGroup(ns, g.id));
    });

    row.append(selectBtn, errorEl, del);
    row.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      this.selectGroup(g.id);
    });
    return row;
  }

  private buildFooter(): HTMLElement {
    const footer = el('div', 'cg-colgroups-footer');
    this.applyBtn = el('button', 'cg-btn cg-btn-primary') as HTMLButtonElement;
    this.applyBtn.type = 'button';
    this.applyBtn.textContent = 'Save'; this.applyBtn.setAttribute('data-cg-apply', '');
    this.applyBtn.disabled = true; this.applyBtn.onclick = () => this.onApply();
    this.resetBtn = el('button', 'cg-btn') as HTMLButtonElement;
    this.resetBtn.type = 'button';
    this.resetBtn.textContent = 'Reset'; this.resetBtn.setAttribute('data-cg-reset', '');
    this.resetBtn.onclick = () => this.seed();
    footer.append(this.resetBtn, this.applyBtn);
    return footer;
  }

  // ── Editor pane ────────────────────────────────────────────────────

  private renderEditor(): void {
    this.disposeStyleChrome();
    this.stylePickers.forEach((p) => p.destroy());
    this.stylePickers = [];
    this.editor.replaceChildren();

    if (!this.selectedId) {
      const empty = el('div', 'cg-colgroups-editor-empty');
      empty.textContent = 'Select a group to edit its columns and style.';
      this.editor.appendChild(empty);
      return;
    }

    const node = this.nodes.find((n) => n.id === this.selectedId && n.kind === 'group') as
      | GroupNode
      | undefined;
    if (!node) {
      this.selectedId = null;
      const empty = el('div', 'cg-colgroups-editor-empty');
      empty.textContent = 'Select a group to edit its columns and style.';
      this.editor.appendChild(empty);
      return;
    }

    this.renderGroupEditor(node);
  }

  private renderGroupEditor(g: GroupNode): void {
    const title = el('div', 'cg-colgroups-editor-title');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'cg-settings-input cg-colgroups-rename';
    nameInput.value = g.headerName;
    nameInput.setAttribute('aria-label', 'Group name');
    nameInput.addEventListener('change', () => {
      this.mutate((ns) => renameGroup(ns, g.id, nameInput.value));
    });
    title.appendChild(nameInput);
    this.editor.appendChild(title);

    const actions = el('div', 'cg-colgroups-editor-actions');
    const hint = el('span', 'cg-colgroups-nest-hint');
    hint.textContent = 'Use the Columns side panel to show/hide columns and drag columns or groups into or out of a group.';
    actions.appendChild(hint);

    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'cg-colgroups-action';
    moveUp.appendChild(iconChevronUp());
    moveUp.title = 'Move up';
    moveUp.setAttribute('aria-label', 'Move group up');
    moveUp.setAttribute('data-cg-move-up', '');
    moveUp.onclick = () => this.moveGroupAmongSiblings(g.id, -1);

    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'cg-colgroups-action';
    moveDown.appendChild(iconChevronDown());
    moveDown.title = 'Move down';
    moveDown.setAttribute('aria-label', 'Move group down');
    moveDown.setAttribute('data-cg-move-down', '');
    moveDown.onclick = () => this.moveGroupAmongSiblings(g.id, 1);

    const groupSibs = this.nodes
      .filter((n) => n.kind === 'group' && n.parentId === g.parentId)
      .sort((a, b) => a.order - b.order);
    const idx = groupSibs.findIndex((s) => s.id === g.id);
    moveUp.disabled = idx <= 0;
    moveDown.disabled = idx < 0 || idx >= groupSibs.length - 1;
    actions.append(moveUp, moveDown);
    this.editor.appendChild(actions);

    this.editor.appendChild(this.buildColumnsBand(g));

    const section = el('div', 'cg-colgroups-style');
    section.setAttribute('data-cg-style', '');
    section.setAttribute('data-for', g.id);
    this.editor.appendChild(section);

    const patch = (
      p: Partial<Pick<GroupNode, 'headerStyle' | 'headerClass' | 'openByDefault' | 'marryChildren'>>,
    ) => this.mutate((ns) => setGroupStyle(ns, g.id, p));
    const patchStyle = (facet: Partial<NonNullable<GroupNode['headerStyle']>>) =>
      this.mutate((ns) => {
        const cur = ns.find((x) => x.id === g.id) as GroupNode | undefined;
        return setGroupStyle(ns, g.id, { headerStyle: { ...cur?.headerStyle, ...facet } });
      });

    if (this.mountStyleChrome) {
      // Formatting-ribbon Font / Alignment / Borders — same chrome as the
      // toolbar. Writes merge into headerStyle without a full editor rebuild
      // so toggles stay responsive; Apply still projects the draft tree.
      const groupId = g.id;
      this.styleChromeDispose = this.mountStyleChrome(section, {
        getStyle: () => {
          const cur = this.nodes.find((x) => x.id === groupId && x.kind === 'group') as
            | GroupNode
            | undefined;
          return { ...(cur?.headerStyle ?? {}) };
        },
        applyStyle: (facet) => {
          this.commitStyleLive((ns) => {
            const cur = ns.find((x) => x.id === groupId) as GroupNode | undefined;
            const next = { ...cur?.headerStyle, ...facet } as NonNullable<GroupNode['headerStyle']>;
            for (const key of Object.keys(next) as Array<keyof typeof next>) {
              if (next[key] === undefined) delete next[key];
            }
            return setGroupStyle(ns, groupId, {
              headerStyle: Object.keys(next).length > 0 ? next : undefined,
            });
          });
        },
      });
    } else {
      section.appendChild(this.buildFillTextCluster(g, patchStyle));
      section.appendChild(this.buildBorderCluster(g, patch));
    }
    section.appendChild(this.buildBehaviorCluster(g, patch));
  }

  private buildColumnsBand(g: GroupNode): HTMLElement {
    const cluster = el('div', 'cg-colgroups-cluster cg-colgroups-columns');
    cluster.appendChild(eyebrow('Columns', 'cg-colgroups-cluster-eyebrow'));

    const chips = el('div', 'cg-colgroups-chips');
    const cols = this.nodes
      .filter((n): n is ColumnNode => n.kind === 'column' && n.parentId === g.id)
      .sort((a, b) => a.order - b.order);
    for (const col of cols) {
      chips.appendChild(this.columnChip(col));
    }
    if (cols.length === 0) {
      const none = el('div', 'cg-colgroups-chips-empty');
      none.textContent = 'No columns in this group.';
      chips.appendChild(none);
    }
    cluster.appendChild(chips);

    const unassigned = this.nodes
      .filter((n): n is ColumnNode => n.kind === 'column' && n.parentId === null)
      .sort((a, b) => a.headerName.localeCompare(b.headerName))
      .filter((col) => canDrop(this.nodes, col.id, g.id));
    cluster.appendChild(this.buildAddColumnPicker(g.id, unassigned));
    return cluster;
  }

  /**
   * Themed multi-select column picker (not a native `<select>`). Checkboxes
   * let the user add several unassigned columns in one step; OS select
   * popups ignore dark/light tokens on Windows/Chromium.
   */
  private buildAddColumnPicker(groupId: string, unassigned: ColumnNode[]): HTMLElement {
    const wrap = el('div', 'cg-colgroups-add-col');
    wrap.setAttribute('data-cg-add-col', '');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cg-colgroups-add-col-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Add columns to group');
    trigger.textContent = '+ Columns…';
    trigger.disabled = unassigned.length === 0;

    const panel = el('div', 'cg-colgroups-add-col-panel');
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-multiselectable', 'true');
    panel.setAttribute('aria-label', 'Unassigned columns');
    panel.hidden = true;

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'cg-colgroups-add-col-search';
    search.placeholder = 'Search columns…';
    search.setAttribute('aria-label', 'Search columns');
    search.autocomplete = 'off';

    const toolbar = el('div', 'cg-colgroups-add-col-toolbar');
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'cg-colgroups-add-col-select-all';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.className = 'cg-checkbox cg-colgroups-checkbox';
    selectAll.setAttribute('data-cg-add-col-select-all', '');
    selectAll.setAttribute('aria-label', 'Select all visible columns');
    const selectAllText = el('span', 'cg-colgroups-add-col-select-all-text');
    selectAllText.textContent = 'Select all';
    selectAllLabel.append(selectAll, selectAllText);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'cg-btn cg-btn-primary cg-colgroups-add-col-commit';
    addBtn.setAttribute('data-cg-add-col-commit', '');
    addBtn.textContent = 'Add selected';
    addBtn.disabled = true;
    toolbar.append(selectAllLabel, addBtn);

    const list = el('div', 'cg-colgroups-add-col-list cg-scrollbar');
    const picked = new Set<string>();
    let visibleIds: string[] = [];

    const syncChrome = () => {
      const n = picked.size;
      addBtn.disabled = n === 0;
      addBtn.textContent = n === 0 ? 'Add selected' : `Add selected (${n})`;
      const visiblePicked = visibleIds.filter((id) => picked.has(id)).length;
      selectAll.checked = visibleIds.length > 0 && visiblePicked === visibleIds.length;
      selectAll.indeterminate = visiblePicked > 0 && visiblePicked < visibleIds.length;
      selectAll.disabled = visibleIds.length === 0;
    };

    const paintOptions = (query: string) => {
      const q = query.trim().toLowerCase();
      const filtered = q
        ? unassigned.filter((c) =>
          c.headerName.toLowerCase().includes(q) || c.colId.toLowerCase().includes(q))
        : unassigned;
      visibleIds = filtered.map((c) => c.colId);
      list.replaceChildren();
      if (filtered.length === 0) {
        const empty = el('div', 'cg-colgroups-add-col-empty');
        empty.textContent = unassigned.length === 0 ? 'No unassigned columns.' : 'No matches.';
        list.appendChild(empty);
        syncChrome();
        return;
      }
      for (const col of filtered) {
        const row = document.createElement('label');
        row.className = 'cg-colgroups-add-col-option';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(picked.has(col.colId)));
        row.setAttribute('data-cg-add-col-id', col.colId);

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'cg-checkbox cg-colgroups-checkbox';
        cb.checked = picked.has(col.colId);
        cb.setAttribute('aria-label', `Select ${col.headerName}`);
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          if (cb.checked) picked.add(col.colId);
          else picked.delete(col.colId);
          row.setAttribute('aria-selected', String(cb.checked));
          syncChrome();
        });
        cb.addEventListener('click', (e) => e.stopPropagation());

        const name = el('span', 'cg-colgroups-add-col-option-name');
        name.textContent = col.headerName;
        name.title = col.colId !== col.headerName ? col.colId : col.headerName;
        row.append(cb, name);
        list.appendChild(row);
      }
      syncChrome();
    };

    let onDoc: ((e: PointerEvent) => void) | null = null;
    const close = () => {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      search.value = '';
      picked.clear();
      if (onDoc) {
        document.removeEventListener('pointerdown', onDoc, true);
        onDoc = null;
      }
    };
    const open = () => {
      if (!panel.hidden) { close(); return; }
      picked.clear();
      paintOptions('');
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      onDoc = (e) => {
        if (!wrap.contains(e.target as HTMLElement | null)) close();
      };
      document.addEventListener('pointerdown', onDoc, true);
      requestAnimationFrame(() => search.focus());
    };

    selectAll.addEventListener('change', (e) => {
      e.stopPropagation();
      if (selectAll.checked) visibleIds.forEach((id) => picked.add(id));
      else visibleIds.forEach((id) => picked.delete(id));
      list.querySelectorAll<HTMLInputElement>('.cg-colgroups-add-col-option input[type="checkbox"]')
        .forEach((cb) => {
          const row = cb.closest('[data-cg-add-col-id]');
          const id = row?.getAttribute('data-cg-add-col-id');
          if (!id) return;
          cb.checked = picked.has(id);
          row?.setAttribute('aria-selected', String(cb.checked));
        });
      syncChrome();
    });

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ids = [...picked];
      close();
      this.addColumnsToGroup(groupId, ids);
    });

    search.addEventListener('input', () => paintOptions(search.value));
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        trigger.focus();
      }
    });
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      open();
    });

    panel.append(search, toolbar, list);
    wrap.append(trigger, panel);
    return wrap;
  }

  private columnChip(col: ColumnNode): HTMLElement {
    const chip = el('div', 'cg-colgroups-chip');
    chip.setAttribute('data-cg-chip', col.colId);

    const name = el('span', 'cg-colgroups-chip-name');
    name.textContent = col.headerName;
    chip.appendChild(name);

    const kind = showKind(col.columnGroupShow);
    const showBtn = document.createElement('button');
    showBtn.type = 'button';
    showBtn.className = 'cg-colgroups-chip-show';
    showBtn.setAttribute('data-cg-groupshow', '');
    showBtn.setAttribute('data-value', kind === 'always' ? '' : kind);
    showBtn.setAttribute('aria-pressed', 'true');
    showBtn.setAttribute('aria-label', showLabel(kind));
    showBtn.title = showLabel(kind);
    showBtn.appendChild(iconGroupShow(kind));
    showBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = nextShow(col.columnGroupShow ?? null);
      this.mutate((ns) => setColumnGroupShow(ns, col.colId, next));
    });
    chip.appendChild(showBtn);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cg-colgroups-chip-remove';
    remove.appendChild(iconClose());
    remove.title = 'Remove from group';
    remove.setAttribute('aria-label', `Remove ${col.headerName} from group`);
    remove.setAttribute('data-cg-remove-col', '');
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeColumnFromGroup(col.colId);
    });
    chip.appendChild(remove);
    return chip;
  }

  /** Colour-picker commit path — writes to the model WITHOUT rebuilding the
   *  Style-band DOM so an in-flight popover survives. */
  private commitStyleLive(fn: (n: Node[]) => Node[]): void {
    this.nodes = fn(this.nodes);
    this.applyBtn.disabled = !this.dirty;
    this.refreshBorderPreview();
  }

  private refreshBorderPreview(): void {
    if (!this.selectedId) return;
    const g = this.nodes.find((n) => n.id === this.selectedId && n.kind === 'group') as
      | GroupNode
      | undefined;
    if (!g) return;
    const preview = this.editor.querySelector('.cg-colgroups-border-preview') as HTMLElement | null;
    if (!preview) return;
    const border = g.headerStyle?.border;
    preview.style.borderTop = borderSideToCss(effectiveBorderSide(border, 'top'));
    preview.style.borderRight = borderSideToCss(effectiveBorderSide(border, 'right'));
    preview.style.borderBottom = borderSideToCss(effectiveBorderSide(border, 'bottom'));
    preview.style.borderLeft = borderSideToCss(effectiveBorderSide(border, 'left'));
  }

  // ── Style band clusters ────────────────────────────────────────────

  private buildFillTextCluster(
    g: GroupNode,
    patchStyle: (facet: Partial<NonNullable<GroupNode['headerStyle']>>) => void,
  ): HTMLElement {
    const cluster = el('div', 'cg-colgroups-cluster');
    cluster.appendChild(eyebrow('Fill & text', 'cg-colgroups-cluster-eyebrow'));

    const patchStyleLive = (facet: Partial<NonNullable<GroupNode['headerStyle']>>) =>
      this.commitStyleLive((ns) => {
        const cur = ns.find((x) => x.id === g.id) as GroupNode | undefined;
        return setGroupStyle(ns, g.id, { headerStyle: { ...cur?.headerStyle, ...facet } });
      });

    const colorRow = el('div', 'cg-colgroups-field-row');
    colorRow.appendChild(this.colorField('bg', 'Fill', g.headerStyle?.bg,
      (rgba) => patchStyleLive({ bg: rgba }), 'Background colour'));
    colorRow.appendChild(this.colorField('fg', 'Text', g.headerStyle?.fg,
      (rgba) => patchStyleLive({ fg: rgba }), 'Text colour'));
    cluster.appendChild(colorRow);

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

    const sizeWrap = el('div', 'cg-colgroups-field cg-colgroups-size');
    sizeWrap.setAttribute('data-cg-field', 'fontSize');
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.className = 'cg-settings-input cg-settings-input-number';
    sizeInput.min = '8'; sizeInput.max = '32';
    sizeInput.setAttribute('aria-label', 'Font size');
    sizeInput.placeholder = 'auto';
    sizeInput.value = typeof g.headerStyle?.fontSize === 'number' ? String(g.headerStyle.fontSize) : '';
    sizeInput.addEventListener('change', () => {
      const raw = sizeInput.value === '' ? undefined : Number(sizeInput.value);
      patchStyle({ fontSize: raw !== undefined && Number.isFinite(raw) ? raw : undefined });
    });
    sizeWrap.appendChild(sizeInput);
    styleRow.appendChild(sizeWrap);
    cluster.appendChild(styleRow);

    return cluster;
  }

  private buildBorderCluster(
    g: GroupNode,
    patch: (p: Partial<Pick<GroupNode, 'headerStyle'>>) => void,
  ): HTMLElement {
    void patch;
    const cluster = el('div', 'cg-colgroups-cluster');
    cluster.appendChild(eyebrow('Border', 'cg-colgroups-cluster-eyebrow'));

    const editor = el('div', 'cg-colgroups-border');
    editor.setAttribute('data-cg-border', '');
    const border = g.headerStyle?.border;

    const head = el('div', 'cg-colgroups-border-head');

    const preview = el('div', 'cg-colgroups-border-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.style.borderTop = borderSideToCss(effectiveBorderSide(border, 'top'));
    preview.style.borderRight = borderSideToCss(effectiveBorderSide(border, 'right'));
    preview.style.borderBottom = borderSideToCss(effectiveBorderSide(border, 'bottom'));
    preview.style.borderLeft = borderSideToCss(effectiveBorderSide(border, 'left'));
    head.appendChild(preview);

    const sideWrap = el('div', 'cg-colgroups-field cg-colgroups-border-side');
    const sideLabel = labelEl('cg-colgroups-field-label');
    sideLabel.textContent = 'Side';
    const sideSel = document.createElement('select');
    sideSel.className = 'cg-settings-input cg-settings-select';
    sideSel.setAttribute('data-cg-border-side', '');
    sideSel.setAttribute('aria-label', 'Border side');
    ([
      ['all', 'All'], ['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left'],
    ] as const).forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      sideSel.appendChild(o);
    });
    sideSel.value = this.selectedEdge;
    sideSel.addEventListener('change', () => {
      this.selectedEdge = sideSel.value as BorderEdge;
      this.render();
    });
    const sideId = uid(); sideSel.id = sideId; sideLabel.htmlFor = sideId;
    sideWrap.append(sideLabel, sideSel);
    head.appendChild(sideWrap);
    editor.appendChild(head);

    const edge = this.selectedEdge;
    const side = border?.[edge];
    const writeSide = (facet: 'width' | 'style', value: number | string | undefined) => {
      this.mutate((ns) => {
        const cur = ns.find((x) => x.id === g.id) as GroupNode | undefined;
        const curBorder = cur?.headerStyle?.border;
        const nextSide = { ...curBorder?.[edge], [facet]: value };
        const nextBorder = pruneBorder({ ...curBorder, [edge]: nextSide });
        return setGroupStyle(ns, g.id, { headerStyle: { ...cur?.headerStyle, border: nextBorder } });
      });
    };
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

    const pill = el('div', 'cg-colgroups-colorfield');
    const valueEl = el('span', 'cg-colgroups-colorfield-value');
    const setLabel = (hex: string): void => {
      if (hex) {
        valueEl.textContent = hex;
        valueEl.classList.remove('cg-colgroups-colorfield-empty');
      } else {
        valueEl.textContent = 'Default';
        valueEl.classList.add('cg-colgroups-colorfield-empty');
      }
    };
    setLabel(toHexLabel(value));

    const picker = new ColorPickerControl(value ?? '', (rgba) => {
      setLabel(toHexLabel(rgba));
      onChange(rgba);
    });
    this.stylePickers.push(picker);
    if (swatchAriaLabel) {
      picker.el.querySelector('.cg-colorpicker-swatch')?.setAttribute('aria-label', swatchAriaLabel);
    }
    pill.append(picker.el, valueEl);
    wrap.append(lbl, pill);
    return wrap;
  }

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

  private flagGroup(groupId: string, message: string): void {
    const errorEl = this.listBody.querySelector(`[data-cg-error="${cssEscape(groupId)}"]`);
    if (errorEl) errorEl.textContent = message;
  }
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }

function labelEl(cls: string): HTMLLabelElement { const e = document.createElement('label'); e.className = cls; return e; }

function eyebrow(text: string, cls = 'cg-colgroups-eyebrow'): HTMLElement {
  const e = el('div', cls);
  e.textContent = text;
  return e;
}

let controlSeq = 0;
const uid = (): string => `cg-colgroups-ctl-${++controlSeq}`;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function toHexLabel(value: string | undefined): string {
  if (!value) return '';
  const c = parseColor(value);
  if (!c) return '';
  const h = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

const ALIGN_LEFT_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h7M2.5 12h9"/></g></svg>';
const ALIGN_CENTER_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M4.5 8h7M3.5 12h9"/></g></svg>';
const ALIGN_RIGHT_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M6.5 8h7M4.5 12h9"/></g></svg>';
