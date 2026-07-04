/**
 * Cycle 21i — Column Groups tool panel (built-in `agColumnGroupsToolPanel`,
 * sidebar shortcut `'columnGroups'`). Authors the columnDefs group tree via
 * the normalized flat model; writes to the grid only on Apply.
 *
 * Visual/UX contract mirrors `.cg-settings-panel` (see
 * `packages/kernel/src/theming/tokens.css` — `.cg-colgroups-*` rules sit
 * right after the `.cg-settings-*` block). The Style band for a selected
 * group (`buildStyleSection`) is a stub here — Task 4 fills it in.
 */
import type { ToolPanel, ToolPanelParams } from './types';
import {
  flatten, project, createGroup, deleteGroup, moveNode,
  setHidden, setColumnHeaderName, renameGroup, validate, canDrop,
  type Node, type GroupNode, type ColumnNode,
} from '../columnGroups/model';
import type { CGridApi } from '../../types';

type NodeKind = Node['kind'];

interface DragState {
  id: string;
  kind: NodeKind;
  ghost: HTMLElement;
  offsetX: number;
  offsetY: number;
}

export class ColumnGroupsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private tree!: HTMLElement;
  private styleSection!: HTMLElement;
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
  private drag: DragState | null = null;
  private readonly onDragMove = (e: MouseEvent) => this.handleDragMove(e);
  private readonly onDragEnd = (e: MouseEvent) => this.handleDragEnd(e);

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
    this.drag?.ghost.remove();
    this.drag = null;
    this.root.remove();
  }

  private seed(): void {
    const defs = this.api.getColumnGroupDefs();
    this.nodes = flatten(structuredClone(defs));
    this.baseline = JSON.stringify(project(this.nodes)); // canonical, not raw defs
    this.selectedGroupId = null;
    this.render();
  }

  private mutate(fn: (n: Node[]) => Node[]): void { this.nodes = fn(this.nodes); this.render(); }

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
      this.renderStyleSection();
      return;
    }
    // Render top-level (parentId null) then recurse by parentId, ordered by order.
    const renderLevel = (parentId: string | null, depth: number) => {
      this.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order)
        .forEach((n) => { this.tree.appendChild(this.rowFor(n, depth)); renderLevel(n.id, depth + 1); });
    };
    renderLevel(null, 0);
    this.applyBtn.disabled = !this.dirty;
    this.renderStyleSection();
  }

  private rowFor(n: Node, depth: number): HTMLElement {
    const row = el('div', 'cg-colgroups-row');
    row.setAttribute('data-cg-node', n.id);
    row.setAttribute('data-kind', n.kind);
    row.style.paddingInlineStart = `calc(12px + ${depth} * 16px)`;

    // Nesting spine — one hairline guide per ancestor depth level.
    for (let d = 0; d < depth; d += 1) {
      const guide = el('span', 'cg-colgroups-guide');
      guide.style.left = `${8 + d * 16}px`;
      row.appendChild(guide);
    }

    if (n.kind === 'group') {
      row.appendChild(this.groupControls(n as GroupNode));
      if (this.selectedGroupId === n.id) row.setAttribute('data-selected', '');
      row.tabIndex = -1;
      row.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button') || target.closest('input')) return;
        this.selectedGroupId = this.selectedGroupId === n.id ? null : n.id;
        this.render();
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

  /** Stub — Task 4 renders the per-group Style band here, keyed off
   *  `this.selectedGroupId`. The container always exists so the hook is
   *  stable for the next task. */
  private buildStyleSection(): HTMLElement {
    const section = el('div', 'cg-colgroups-style');
    section.setAttribute('data-cg-style', '');
    return section;
  }

  private renderStyleSection(): void {
    // Task 4 will populate `this.styleSection` from `this.selectedGroupId`.
    // For now, keep the stub container empty.
    this.styleSection.replaceChildren();
  }

  // ── Row builders ───────────────────────────────────────────────────

  private groupControls(n: GroupNode): HTMLElement {
    const wrap = el('div', 'cg-colgroups-row-main');

    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'cg-colgroups-chevron';
    chevron.setAttribute('aria-expanded', 'true');
    chevron.setAttribute('aria-label', 'Toggle group');
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = chevron.getAttribute('aria-expanded') === 'true';
      chevron.setAttribute('aria-expanded', String(!expanded));
      // Collapse/expand is a pure view concern (no model field yet) —
      // toggle visibility of descendant rows via a data attribute walk.
      this.toggleCollapse(n.id, expanded);
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

  private toggleCollapse(groupId: string, wasExpanded: boolean): void {
    // Walk descendants of groupId and toggle their row display.
    const collapse = wasExpanded; // becoming collapsed
    const descendantIds = new Set<string>();
    const collectChildren = (parentId: string) => {
      for (const child of this.nodes.filter((n) => n.parentId === parentId)) {
        descendantIds.add(child.id);
        collectChildren(child.id);
      }
    };
    collectChildren(groupId);
    for (const id of descendantIds) {
      const row = this.tree.querySelector(`[data-cg-node="${cssEscape(id)}"]`) as HTMLElement | null;
      if (row) row.style.display = collapse ? 'none' : '';
    }
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
      e.preventDefault();
      this.beginDrag(e, n, row);
    });
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
    const targetParentId = targetNode.kind === 'group' ? targetNode.id : targetNode.parentId;
    const siblings = this.nodes.filter((x) => x.parentId === targetParentId && x.id !== drag.id);
    const targetOrder = targetNode.kind === 'group'
      ? siblings.length // dropped ONTO a group header -> append at end of its children
      : Math.max(0, siblings.sort((a, b) => a.order - b.order).findIndex((s) => s.id === targetId));
    this.mutate((ns) => moveNode(ns, drag.id, targetParentId, targetOrder));
  }
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}
