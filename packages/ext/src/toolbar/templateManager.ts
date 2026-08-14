/**
 * Column-template manager — toolbar popover surface matching stern-bak's
 * TemplateManager / ModuleLibrary: list + apply, save-as, update (re-snapshot),
 * rename, and two-step delete. Plain DOM; styles injected once.
 *
 * Persistence rides `@wellsfargo-starui/velocity-grid-calc` via the kernel (`saveTemplate` /
 * `applyTemplate` / `renameTemplate` / `deleteTemplate` / `removeTemplate`).
 * Own-templates (`__cgridOwn:*`) are never listed — they are the per-column
 * edit fork, not the shared library.
 */
import { isOwnTemplateId, ownTemplateId, type ColumnTemplate } from '@wellsfargo-starui/velocity-grid-calc';
import { menu, svg } from './ui';

export interface TemplateManagerGrid {
  getTemplates(): ColumnTemplate[];
  getState(): { modules?: Record<string, { data?: unknown }> };
  saveTemplate(spec: { id: string; name: string; overrides: ColumnTemplate['overrides'] }): void;
  renameTemplate(templateId: string, name: string): void;
  deleteTemplate(templateId: string): void;
  applyTemplate(colId: string, templateId: string): void;
  removeTemplate(colId: string, templateId: string): void;
}

export interface TemplateManagerHost {
  targetCols(): string[];
  grid: TemplateManagerGrid;
  /** Default save-as name when the input is blank — e.g. `"Price Style"`. */
  defaultSaveName(): string;
  onApplied(): void;
  /** Called once before any mutating action (apply / save / update / …)
   *  so the ribbon can push a formatting undo entry. */
  beforeChange?(): void;
}

const I = {
  check: 'M20 6L9 17l-5-5',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.1-3.4L21 9M20.5 15A9 9 0 0 1 6.4 18.4L3 15',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
};

/** Host-authored library templates only (no own-template forks), A→Z. */
export function libraryTemplates(grid: TemplateManagerGrid): ColumnTemplate[] {
  return grid.getTemplates()
    .filter((t) => !isOwnTemplateId(t.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** First shared template id chained on `colId`, if any. */
export function activeLibraryTemplateId(grid: TemplateManagerGrid, colId: string): string | undefined {
  try {
    const data = grid.getState()?.modules?.columnOverrides?.data;
    if (!Array.isArray(data)) return undefined;
    const ov = data.find((o) => (o as { colId?: string }).colId === colId) as
      | { templateIds?: string[] }
      | undefined;
    return ov?.templateIds?.find((id) => !isOwnTemplateId(id));
  } catch {
    return undefined;
  }
}

/** Snapshot the column's own-template overrides for save / update. */
export function snapshotOwnOverrides(
  grid: TemplateManagerGrid,
  colId: string,
): ColumnTemplate['overrides'] | null {
  const own = grid.getTemplates().find((t) => t.id === ownTemplateId(colId));
  const overrides = own?.overrides;
  if (!overrides || Object.keys(overrides).length === 0) return null;
  return structuredClone(overrides);
}

/** Human-readable categories the next save/update would capture. */
export function capturableFieldLabels(overrides: ColumnTemplate['overrides'] | null): string[] {
  if (!overrides) return [];
  const labels: string[] = [];
  if (overrides.cellStyle && Object.keys(overrides.cellStyle).length) labels.push('Cell style');
  if (overrides.headerStyle && Object.keys(overrides.headerStyle).length) labels.push('Header style');
  if (overrides.format) labels.push('Formatter');
  if (overrides.cellIcon || overrides.headerIcon) labels.push('Icons');
  if (overrides.cellRenderer) labels.push('Renderer');
  if (
    typeof overrides.editable === 'boolean'
    || typeof overrides.sortable === 'boolean'
    || typeof overrides.resizable === 'boolean'
    || typeof overrides.hide === 'boolean'
  ) {
    labels.push('Behavior');
  }
  if (overrides.filter || typeof overrides.floatingFilter === 'boolean') labels.push('Filter');
  if (typeof overrides.enableRowGroup === 'boolean' || typeof overrides.enablePivot === 'boolean') {
    labels.push('Grouping');
  }
  return labels;
}

function mintTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function libraryIdsOnColumn(grid: TemplateManagerGrid, colId: string): string[] {
  try {
    const data = grid.getState()?.modules?.columnOverrides?.data;
    if (!Array.isArray(data)) return [];
    const ov = data.find((o) => (o as { colId?: string }).colId === colId) as
      | { templateIds?: string[] }
      | undefined;
    return (ov?.templateIds ?? []).filter((id) => !isOwnTemplateId(id));
  } catch {
    return [];
  }
}

/** Apply a library template the way stern does: drop the own fork + other
 *  library refs so the shared template is what paints. */
export function applyLibraryTemplate(
  grid: TemplateManagerGrid,
  colIds: string[],
  templateId: string,
): void {
  for (const colId of colIds) {
    const ownId = ownTemplateId(colId);
    try { grid.removeTemplate(colId, ownId); } catch { /* absent */ }
    try { grid.deleteTemplate(ownId); } catch { /* absent */ }
    for (const id of libraryIdsOnColumn(grid, colId)) {
      if (id !== templateId) {
        try { grid.removeTemplate(colId, id); } catch { /* absent */ }
      }
    }
    grid.applyTemplate(colId, templateId);
  }
}

/** Anchored popover for the Templates ribbon control — same seam as
 *  `formatPickerMenu` / `columnPanelMenu`. */
export function templateManagerMenu(
  anchor: HTMLElement,
  host: TemplateManagerHost,
): { toggle(): void; destroy(): void } {
  injectTemplateManagerStyles();
  return menu(anchor, (close) => buildTemplateManagerPanel(host, close), undefined, { align: 'left' });
}

export function buildTemplateManagerPanel(host: TemplateManagerHost, close: () => void): HTMLElement {
  injectTemplateManagerStyles();
  const root = document.createElement('div');
  root.className = 'vgext-tpl vgext-tpl-menu';
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  let saveName = '';
  let renamingId: string | null = null;
  let renameDraft = '';
  let pendingDeleteId: string | null = null;
  let saveFlash = false;

  const rerender = (): void => {
    root.replaceChildren();
    paint();
  };

  const paint = (): void => {
    const cols = host.targetCols();
    const disabled = cols.length === 0;
    const first = cols[0];
    const templates = libraryTemplates(host.grid);
    const activeId = first ? activeLibraryTemplateId(host.grid, first) : undefined;
    const capturable = first ? capturableFieldLabels(snapshotOwnOverrides(host.grid, first)) : [];

    if (templates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vgext-tpl-empty';
      empty.textContent = disabled
        ? 'Select a cell or column first.'
        : 'No saved templates yet.';
      root.append(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'vgext-tpl-list';
      for (const tpl of templates) {
        list.appendChild(rowEl(tpl, {
          active: tpl.id === activeId,
          disabled,
          renaming: renamingId === tpl.id,
          pendingDelete: pendingDeleteId === tpl.id,
        }));
      }
      root.append(list);
    }

    // Save-as row
    const saveRow = document.createElement('div');
    saveRow.className = 'vgext-tpl-save';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vgext-tpl-save-input' + (saveFlash ? ' is-flash' : '');
    input.placeholder = 'Save current as…';
    input.value = saveName;
    input.disabled = disabled;
    input.setAttribute('aria-label', 'New template name');
    input.addEventListener('input', () => { saveName = input.value; });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
      if (e.key === 'Escape') close();
    });
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'vgext-tpl-iconbtn';
    addBtn.title = 'Save as new template';
    addBtn.setAttribute('aria-label', 'Save as new template');
    addBtn.disabled = disabled;
    addBtn.innerHTML = svg(I.plus, 14);
    addBtn.addEventListener('click', doSave);
    saveRow.append(input, addBtn);
    root.append(saveRow);

    const hint = document.createElement('div');
    hint.className = 'vgext-tpl-hint';
    hint.textContent = capturable.length > 0
      ? `Will save: ${capturable.join(' · ')}`
      : disabled
        ? ''
        : 'Nothing to capture — style or format a column first.';
    if (hint.textContent) root.append(hint);
  };

  const doSave = (): void => {
    const cols = host.targetCols();
    if (!cols.length) return;
    const overrides = snapshotOwnOverrides(host.grid, cols[0]!);
    if (!overrides) return;
    const name = saveName.trim() || host.defaultSaveName();
    const id = mintTemplateId();
    host.beforeChange?.();
    try {
      host.grid.saveTemplate({ id, name, overrides });
    } catch {
      return;
    }
    applyLibraryTemplate(host.grid, cols, id);
    saveName = '';
    saveFlash = true;
    host.onApplied();
    rerender();
    window.setTimeout(() => { saveFlash = false; rerender(); }, 900);
  };

  const rowEl = (
    tpl: ColumnTemplate,
    state: { active: boolean; disabled: boolean; renaming: boolean; pendingDelete: boolean },
  ): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'vgext-tpl-row' + (state.active ? ' is-active' : '');
    row.dataset.templateId = tpl.id;
    row.setAttribute('role', 'button');
    row.tabIndex = state.renaming ? -1 : 0;

    const lead = document.createElement('span');
    lead.className = 'vgext-tpl-lead';
    lead.innerHTML = state.active
      ? svg(I.check, 12)
      : '<span class="vgext-tpl-dot"></span>';

    if (state.renaming) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'vgext-tpl-rename';
      input.value = renameDraft;
      input.setAttribute('aria-label', 'Rename template');
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('input', () => { renameDraft = input.value; });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
        if (e.key === 'Escape') { e.preventDefault(); renamingId = null; rerender(); }
      });
      input.addEventListener('blur', () => commitRename());
      row.append(lead, input);
      queueMicrotask(() => input.focus());
    } else {
      const name = document.createElement('span');
      name.className = 'vgext-tpl-name';
      name.textContent = tpl.name;
      row.append(lead, name);
    }

    const actions = document.createElement('span');
    actions.className = 'vgext-tpl-actions';

    const mk = (icon: string, title: string, onClick: () => void, danger = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vgext-tpl-iconbtn' + (danger ? ' is-danger' : '');
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = state.disabled;
      b.innerHTML = svg(icon, 13);
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      return b;
    };

    if (!state.renaming) {
      actions.append(
        mk(I.pencil, 'Rename', () => {
          renamingId = tpl.id;
          renameDraft = tpl.name;
          pendingDeleteId = null;
          rerender();
        }),
        mk(I.refresh, 'Update from selection', () => {
          const cols = host.targetCols();
          if (!cols.length) return;
          const overrides = snapshotOwnOverrides(host.grid, cols[0]!);
          if (!overrides) return;
          host.beforeChange?.();
          try {
            host.grid.saveTemplate({ id: tpl.id, name: tpl.name, overrides });
          } catch { return; }
          host.onApplied();
          rerender();
        }),
      );
      if (state.pendingDelete) {
        actions.append(
          mk(I.check, 'Confirm delete', () => {
            host.beforeChange?.();
            host.grid.deleteTemplate(tpl.id);
            pendingDeleteId = null;
            host.onApplied();
            rerender();
          }, true),
          mk(I.x, 'Cancel delete', () => { pendingDeleteId = null; rerender(); }),
        );
      } else {
        actions.append(mk(I.trash, 'Delete', () => {
          pendingDeleteId = tpl.id;
          rerender();
        }, true));
      }
    }
    row.append(actions);

    if (!state.renaming && !state.pendingDelete) {
      row.addEventListener('click', () => {
        if (state.disabled) return;
        host.beforeChange?.();
        applyLibraryTemplate(host.grid, host.targetCols(), tpl.id);
        host.onApplied();
        close();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          row.click();
        }
      });
    }
    return row;
  };

  const commitRename = (): void => {
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    const id = renamingId;
    renamingId = null;
    if (trimmed) {
      host.beforeChange?.();
      try { host.grid.renameTemplate(id, trimmed); host.onApplied(); }
      catch { /* duplicate / empty — leave name unchanged */ }
    }
    rerender();
  };

  paint();
  return root;
}

export function injectTemplateManagerStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('vgext-tpl-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'vgext-tpl-styles';
    document.head.appendChild(style);
  }
  style.textContent = TPL_CSS;
}

const TPL_CSS = `
.vgext-menu.vgext-tpl-menu { width: 300px; padding: 8px; }
.vgext-tpl { display: flex; flex-direction: column; gap: 8px; min-width: 260px; }
.vgext-tpl-empty {
  padding: 16px 10px; text-align: center; font-size: 12px;
  color: var(--vg-muted-fg-color, #9aa4b6);
}
.vgext-tpl-list {
  display: flex; flex-direction: column; gap: 1px;
  max-height: 220px; overflow-y: auto;
}
.vgext-tpl-row {
  position: relative;
  display: flex; align-items: center; gap: 6px;
  min-height: 30px; padding: 0 4px 0 10px;
  border-radius: var(--vg-radius, 2px);
  cursor: pointer; outline: none;
  color: var(--vg-fg-color, #e5e9f0);
}
.vgext-tpl-row:hover { background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 5%, transparent); }
.vgext-tpl-row.is-active {
  background: color-mix(in srgb, var(--vg-chrome-accent) 10%, transparent);
}
.vgext-tpl-row.is-active::before {
  content: ''; position: absolute; left: 2px; top: 6px; bottom: 6px; width: 2px;
  border-radius: 2px; background: var(--vg-chrome-accent);
}
.vgext-tpl-lead {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; flex: 0 0 auto; color: var(--vg-chrome-accent);
}
.vgext-tpl-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: color-mix(in srgb, var(--vg-muted-fg-color, #9aa4b6) 55%, transparent);
}
.vgext-tpl-name {
  flex: 1 1 auto; min-width: 0;
  font-size: 12.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vgext-tpl-rename {
  flex: 1 1 auto; min-width: 0; height: 24px; padding: 0 8px;
  border: 1px solid var(--vg-chrome-accent); border-radius: var(--vg-radius, 2px);
  background: transparent; color: var(--vg-fg-color, #e5e9f0);
  font: inherit; font-size: 12px; outline: none;
}
.vgext-tpl-actions {
  display: inline-flex; align-items: center; gap: 1px;
  opacity: 0; transition: opacity 120ms ease;
}
.vgext-tpl-row:hover .vgext-tpl-actions,
.vgext-tpl-row:focus-within .vgext-tpl-actions { opacity: 1; }
.vgext-tpl-iconbtn {
  appearance: none; width: 24px; height: 24px;
  border: none; border-radius: var(--vg-radius, 2px); background: transparent;
  color: var(--vg-muted-fg-color, #9aa4b6);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
}
.vgext-tpl-iconbtn:hover { background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 8%, transparent); color: var(--vg-fg-color, #e5e9f0); }
.vgext-tpl-iconbtn.is-danger:hover { color: var(--vg-neg-color, #e2606c); background: color-mix(in srgb, var(--vg-neg-color, #e2606c) 12%, transparent); }
.vgext-tpl-iconbtn:disabled { opacity: 0.4; cursor: default; }
.vgext-tpl-save {
  display: flex; align-items: center; gap: 6px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--vg-border-color, #2a3140) 85%, transparent);
}
.vgext-tpl-save-input {
  flex: 1 1 auto; min-width: 0; height: 28px; padding: 0 10px;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 2px);
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 3%, transparent);
  color: var(--vg-fg-color, #e5e9f0); font: inherit; font-size: 12px; outline: none;
}
.vgext-tpl-save-input:focus {
  border-color: color-mix(in srgb, var(--vg-chrome-accent) 65%, var(--vg-border-color, #2a3140));
}
.vgext-tpl-save-input.is-flash {
  border-color: var(--vg-chrome-accent);
  background: color-mix(in srgb, var(--vg-chrome-accent) 10%, transparent);
}
.vgext-tpl-hint {
  font-size: 10.5px; letter-spacing: 0.02em;
  color: var(--vg-muted-fg-color, #9aa4b6);
  padding: 0 2px 2px;
}
@media (prefers-reduced-motion: reduce) {
  .vgext-tpl-actions { transition: none; }
}
`;
