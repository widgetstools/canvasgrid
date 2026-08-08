// Cycle 19 / Task 7 — Values zone sub-panel.
//
// Third view over PivotState's ordered `valueColumns` list. Cycle 18 /
// Task 5 activated the drag/drop (was inert stub in Cycle 15.5). Pill
// label reads `aggFunc(headerName)` — e.g. `sum(Gold)` — mirroring
// the agg-decorated column-header convention.

import type { VelocityGridApi } from '../../../types';
import {
  DEFAULT_VALUE_AGG_FUNC,
  VALUES_PLACEHOLDER,
  buildDropZoneSection,
  buildEmpty,
  buildPill,
  getZoneRect,
  type DropZoneSpec,
} from './shared';
import { beginPillDrag } from './pillDrag';

interface ValuePill {
  el: HTMLElement;
  colId: string;
  aggFunc: string;
}

export interface ValuesZonePanelDeps {
  api: VelocityGridApi;
  resolveLabel(colId: string): string;
  rootHost: HTMLElement;
  isColumnValueable(colId: string): boolean;
}

/** Resolve the default aggregation func for a column when it's dropped
 *  on the Values zone. Prefers the colDef's declared `aggFunc`, falls
 *  back to `'sum'`. The api method is optional on the mock surface;
 *  tests stub it via `getColumnDefaultAggFunc`. */
export function resolveDefaultAggFunc(api: VelocityGridApi, colId: string): string {
  const apiAny = api as unknown as { getColumnDefaultAggFunc?: (colId: string) => string | undefined };
  const declared = apiAny.getColumnDefaultAggFunc?.(colId);
  return (typeof declared === 'string' && declared.length > 0) ? declared : DEFAULT_VALUE_AGG_FUNC;
}

export class ValuesZonePanel {
  private readonly deps: ValuesZonePanelDeps;
  private readonly section: HTMLElement;
  private readonly dropZone: HTMLElement;
  private readonly content: HTMLElement;
  private pills: ValuePill[] = [];
  private readonly unsubs: Array<() => void> = [];

  constructor(deps: ValuesZonePanelDeps) {
    this.deps = deps;
    const handles = buildDropZoneSection({
      kind: 'values',
      iconName: 'sigma',
      headerText: 'Values',
      ariaLabel: 'Aggregate value columns',
      zoneClass: 'vg-columns-panel-valz',
      contentClass: 'vg-columns-panel-valz-content',
    });
    this.section = handles.section;
    this.dropZone = handles.dropZone;
    this.content = handles.content;
    this.dropZone.setAttribute('data-vg-pill-role', 'value');
    this.refresh();
    this.unsubs.push(
      this.deps.api.addEventListener('pivotStateChanged', () => this.refresh()),
    );
  }

  getGui(): HTMLElement { return this.section; }
  getDropZoneEl(): HTMLElement { return this.dropZone; }

  getDropZoneSpec(): DropZoneSpec {
    return {
      dropZone: this.dropZone,
      accepts: (id) => this.deps.isColumnValueable(id)
        && !(this.deps.api.getValueColumns?.() ?? []).some((v) => v.colId === id),
      commit: (id) => {
        this.deps.api.addValueColumn?.(id, resolveDefaultAggFunc(this.deps.api, id));
      },
    };
  }

  refresh(): void {
    const valueCols = this.deps.api.getValueColumns?.() ?? [];
    this.pills = [];
    this.content.replaceChildren();
    if (valueCols.length === 0) {
      this.content.appendChild(buildEmpty('valz', VALUES_PLACEHOLDER));
      return;
    }
    for (const v of valueCols) {
      const label = `${v.aggFunc}(${this.deps.resolveLabel(v.colId)})`;
      const pillEl = buildPill({
        zone: 'valz',
        colId: v.colId,
        label,
        removeAriaLabel: `Remove ${label} from values`,
        onRemove: () => { this.deps.api.removeValueColumn?.(v.colId); },
        onMouseDown: (e) => beginPillDrag({
          e, pillEl, zone: 'valz', colId: v.colId, label,
          rootHost: this.deps.rootHost,
          api: this.deps.api,
          onDragOut: () => { this.deps.api.removeValueColumn?.(v.colId); },
          onReorder: (toIndex) => {
            const ordered = (this.deps.api.getValueColumns?.() ?? []).map((vc) => vc.colId);
            const fromIndex = ordered.indexOf(v.colId);
            if (fromIndex < 0) return;
            this.deps.api.moveValueColumn?.(fromIndex, toIndex);
          },
          getZoneRect: () => getZoneRect(this.dropZone),
          getZoneContent: () => this.content,
        }),
      });
      this.content.appendChild(pillEl);
      this.pills.push({ el: pillEl, colId: v.colId, aggFunc: v.aggFunc });
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
