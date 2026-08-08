// Cycle 19 / Task 7 — Column Labels (pivot) zone sub-panel.
//
// Third view over PivotState's ordered `pivotColumns` list (alongside
// the pivot panel and the header context menu items). Cycle 18 / Task 5
// added this SECTION. Visibility is gated by pivotMode — the section
// exists in the DOM (so refs / refresh stay valid) but its `display` is
// toggled when pivotMode flips.

import type { VelocityGridApi } from '../../../types';
import {
  PIVOT_PLACEHOLDER,
  buildDropZoneSection,
  buildEmpty,
  buildPill,
  getZoneRect,
  type DropZoneSpec,
} from './shared';
import { beginPillDrag } from './pillDrag';

interface PivotPill {
  el: HTMLElement;
  colId: string;
}

export interface PivotColumnsZonePanelDeps {
  api: VelocityGridApi;
  resolveLabel(colId: string): string;
  rootHost: HTMLElement;
  isColumnPivotable(colId: string): boolean;
}

export class PivotColumnsZonePanel {
  private readonly deps: PivotColumnsZonePanelDeps;
  private readonly section: HTMLElement;
  private readonly dropZone: HTMLElement;
  private readonly content: HTMLElement;
  private pills: PivotPill[] = [];
  private readonly unsubs: Array<() => void> = [];

  constructor(deps: PivotColumnsZonePanelDeps) {
    this.deps = deps;
    const handles = buildDropZoneSection({
      kind: 'pivots',
      iconName: 'columns-3',
      headerText: 'Column Labels',
      ariaLabel: 'Pivot column labels',
      zoneClass: 'vg-columns-panel-plz',
      contentClass: 'vg-columns-panel-plz-content',
    });
    this.section = handles.section;
    this.dropZone = handles.dropZone;
    this.content = handles.content;
    this.dropZone.setAttribute('data-vg-pill-role', 'pivot');
    this.refresh();
    this.syncVisibility();
    // Column Labels ALWAYS subscribes — the zone IS a mirror by design.
    this.unsubs.push(
      this.deps.api.addEventListener('pivotStateChanged', () => {
        this.refresh();
        this.syncVisibility();
      }),
    );
  }

  getGui(): HTMLElement { return this.section; }
  getDropZoneEl(): HTMLElement { return this.dropZone; }

  getDropZoneSpec(): DropZoneSpec {
    return {
      dropZone: this.dropZone,
      accepts: (id) => this.deps.isColumnPivotable(id)
        && !(this.deps.api.getPivotColumns?.() ?? []).includes(id),
      commit: (id) => { this.deps.api.addPivotColumn?.(id); },
    };
  }

  refresh(): void {
    const cols = this.deps.api.getPivotColumns?.() ?? [];
    this.pills = [];
    this.content.replaceChildren();
    if (cols.length === 0) {
      this.content.appendChild(buildEmpty('plz', PIVOT_PLACEHOLDER));
      return;
    }
    for (const colId of cols) {
      const label = this.deps.resolveLabel(colId);
      const pillEl = buildPill({
        zone: 'plz',
        colId,
        label,
        removeAriaLabel: `Remove ${label} from column labels`,
        onRemove: () => { this.deps.api.removePivotColumn?.(colId); },
        onMouseDown: (e) => beginPillDrag({
          e, pillEl, zone: 'plz', colId, label,
          rootHost: this.deps.rootHost,
          api: this.deps.api,
          onDragOut: () => { this.deps.api.removePivotColumn?.(colId); },
          onReorder: (toIndex) => {
            const ordered = this.deps.api.getPivotColumns?.() ?? [];
            const fromIndex = ordered.indexOf(colId);
            if (fromIndex < 0) return;
            this.deps.api.movePivotColumn?.(fromIndex, toIndex);
          },
          getZoneRect: () => getZoneRect(this.dropZone),
          getZoneContent: () => this.content,
        }),
      });
      this.content.appendChild(pillEl);
      this.pills.push({ el: pillEl, colId });
    }
  }

  /** Column Labels only makes sense in pivot mode — hide the entire
   *  section when pivot mode is off so the tool panel doesn't show an
   *  empty drop zone for a feature the user isn't using. */
  private syncVisibility(): void {
    const pivotOn = this.deps.api.isPivotMode?.() === true;
    this.section.style.display = pivotOn ? '' : 'none';
  }

  destroy(): void {
    for (const off of this.unsubs) {
      try { off(); } catch { /* noop */ }
    }
    this.unsubs.length = 0;
    this.pills = [];
  }
}
