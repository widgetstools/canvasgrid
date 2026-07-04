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
  setGroupStyle,
  type Node, type GroupNode, type ColumnNode,
} from '../columnGroups/model';
import type { CGridApi } from '../../types';
import { SettingsForm } from '../settingsForm/form';
import type { SettingsField, SettingsSection } from '../../types/settingsSchema';

type NodeKind = Node['kind'];

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
  private styleForm: SettingsForm | null = null;
  private applyBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private api!: Pick<CGridApi, 'getColumnGroupDefs' | 'updateGridOptions'>;
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
    this.styleForm?.destroy();
    this.styleForm = null;
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
      this.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order)
        .forEach((n) => {
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
    this.styleForm?.destroy();
    this.styleForm = null;
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

    const section: SettingsSection = {
      id: 'cg-group-style',
      title: `Style — ${g.headerName}`,
      bands: [{
        id: 'header',
        title: 'Header',
        fields: [
          field('bg', 'Background', 'color',
            () => g.headerStyle?.bg,
            (v) => patch({ headerStyle: { ...g.headerStyle, bg: v as string } })),
          field('fg', 'Text colour', 'color',
            () => g.headerStyle?.fg,
            (v) => patch({ headerStyle: { ...g.headerStyle, fg: v as string } })),
          field('fontWeight', 'Bold', 'switch',
            () => g.headerStyle?.fontWeight === 'bold',
            (v) => patch({ headerStyle: { ...g.headerStyle, fontWeight: v ? 'bold' : undefined } }),
            false),
          field('marryChildren', 'Marry children', 'switch',
            () => g.marryChildren === true,
            (v) => patch({ marryChildren: v as boolean }),
            false),
          field('openByDefault', 'Open by default', 'switch',
            () => g.openByDefault === true,
            (v) => patch({ openByDefault: v as boolean }),
            false),
        ],
      }],
    };
    this.styleForm = new SettingsForm(section);
    // Tag every field row with `data-cg-field` (mirroring the underlying
    // `data-field-key` the settings-form renderer emits) so this panel's
    // own tests have a stable, namespaced selector.
    this.styleForm.root.querySelectorAll('[data-field-key]').forEach((n) =>
      n.setAttribute('data-cg-field', n.getAttribute('data-field-key')!));
    this.styleSection.appendChild(this.styleForm.root);
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
    selectBtn.textContent = '⚙';
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
    addSub.textContent = '+';
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
    del.textContent = '✕';
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
    handle.textContent = '⋮⋮';
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

    return wrap;
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

/**
 * `structuredClone` throws on function-valued fields — and `CColDef`
 * legitimately carries them (`valueFormatter`, `cellRenderer`,
 * `valueGetter`, `comparator`, …; see `getColumnGroupDefs()`, which just
 * returns the live `columnDefs`). This clones plain objects/arrays deeply
 * (so the panel's working model never shares a mutable array/object with
 * the live grid state) while passing functions and other non-plain-object
 * values through by reference — safe because every mutation path in
 * `columnGroups/model.ts` replaces objects wholesale (spread/patch) rather
 * than mutating `n.def` in place (see `project()`'s `{ ...n.def }`).
 */
function cloneDefsTree<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => cloneDefsTree(v)) as unknown as T;
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneDefsTree(v);
    return out as T;
  }
  return value; // functions, class instances, primitives — pass through unchanged
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** Build a `SettingsField` for the group Style band. `defaultValue` (when
 *  given) is what an "unset" value reads as — e.g. `false` for the boolean
 *  switches, so a group that has never had the flag touched doesn't render
 *  as already-modified. */
function field(
  key: string,
  label: string,
  type: SettingsField['type'],
  get: () => unknown,
  set: (value: unknown) => void,
  defaultValue?: unknown,
): SettingsField {
  return { key, label, type, get, set, defaultValue };
}
