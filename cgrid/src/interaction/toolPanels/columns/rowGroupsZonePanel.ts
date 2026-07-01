// Cycle 19 / Task 7 — Row Groups zone sub-panel.
//
// Third view over the runtime `rowGroupColumns` list (alongside the
// row group panel from Cycle 15 / Task 6 + Cycle 15.5 / Task 1 and
// the header context menu items from Cycle 15.5 / Task 2). Cycle 15.5
// / Task 2 upgraded this SECTION from an inert stub to a LIVE drop
// zone.

import type { CGridApi } from '../../../types';
import {
  ROW_GROUPS_PLACEHOLDER,
  buildDropZoneSection,
  buildEmpty,
  buildPill,
  getZoneRect,
  type DropZoneSpec,
} from './shared';
import { beginPillDrag } from './pillDrag';

/** Per-pill DOM handle. The pill list is rebuilt wholesale on every
 *  `columnRowGroupChanged` (the list is small — typically ≤ 5 entries
 *  — and a wholesale rebuild dodges any in-place reorder bookkeeping). */
interface RowGroupPill {
  el: HTMLElement;
  colId: string;
}

/** Deps threaded into `RowGroupsZonePanel` at construction. */
export interface RowGroupsZonePanelDeps {
  api: CGridApi;
  /** Resolve a colId's rendered label (header name or colId fallback).
   *  Shared with the other sub-panels so pill labels match row labels. */
  resolveLabel(colId: string): string;
  /** The panel shell's root element — used to append the drag ghost
   *  into the closest theme host ancestor. */
  rootHost: HTMLElement;
  isColumnRowGroupable(colId: string): boolean;
}

export class RowGroupsZonePanel {
  private readonly deps: RowGroupsZonePanelDeps;
  private readonly section: HTMLElement;
  private readonly dropZone: HTMLElement;
  private readonly content: HTMLElement;
  private pills: RowGroupPill[] = [];
  private readonly unsubs: Array<() => void> = [];

  constructor(deps: RowGroupsZonePanelDeps) {
    this.deps = deps;
    const handles = buildDropZoneSection({
      kind: 'groups',
      iconName: 'menu',
      headerText: 'Row Groups',
      ariaLabel: 'Row group columns',
      zoneClass: 'cg-columns-panel-rgz',
      contentClass: 'cg-columns-panel-rgz-content',
    });
    this.section = handles.section;
    this.dropZone = handles.dropZone;
    this.content = handles.content;
    this.dropZone.setAttribute('data-cg-pill-role', 'rowGroup');
    this.refresh();
    // The Row Groups zone ALWAYS subscribes (independent of
    // `suppressSyncLayoutWithGrid` — the zone IS a mirror by design).
    this.unsubs.push(
      this.deps.api.addEventListener('columnRowGroupChanged', () => this.refresh()),
    );
  }

  getGui(): HTMLElement { return this.section; }
  getDropZoneEl(): HTMLElement { return this.dropZone; }

  /** Fresh `DropZoneSpec` — used by the visibility panel's row-drag
   *  orchestrator to route into this zone. */
  getDropZoneSpec(): DropZoneSpec {
    return {
      dropZone: this.dropZone,
      accepts: (id) => this.deps.isColumnRowGroupable(id)
        && !(this.deps.api.getRowGroupColumns?.() ?? []).includes(id),
      commit: (id) => { this.deps.api.addRowGroupColumn?.(id); },
    };
  }

  refresh(): void {
    const cols = this.deps.api.getRowGroupColumns?.() ?? [];
    this.pills = [];
    this.content.replaceChildren();
    if (cols.length === 0) {
      this.content.appendChild(buildEmpty('rgz', ROW_GROUPS_PLACEHOLDER));
      return;
    }
    for (const colId of cols) {
      const label = this.deps.resolveLabel(colId);
      const pillEl = buildPill({
        zone: 'rgz',
        colId,
        label,
        removeAriaLabel: `Remove ${label} from row groups`,
        onRemove: () => { this.deps.api.removeRowGroupColumn?.(colId); },
        onMouseDown: (e) => beginPillDrag({
          e, pillEl, zone: 'rgz', colId, label,
          rootHost: this.deps.rootHost,
          api: this.deps.api,
          onDragOut: () => { this.deps.api.removeRowGroupColumn?.(colId); },
          onReorder: (toIndex) => {
            const ordered = this.deps.api.getRowGroupColumns?.() ?? [];
            const fromIndex = ordered.indexOf(colId);
            if (fromIndex < 0) return;
            this.deps.api.moveRowGroupColumn?.(fromIndex, toIndex);
          },
          getZoneRect: () => getZoneRect(this.dropZone),
          getZoneContent: () => this.content,
        }),
      });
      this.content.appendChild(pillEl);
      this.pills.push({ el: pillEl, colId });
    }
  }

  destroy(): void {
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    this.pills = [];
  }
}
