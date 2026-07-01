// Cycle 19 / Task 7 — shared primitives for the columns tool panel sub-panels.
//
// Owns:
//   • Placeholder / default-agg constants + drag threshold.
//   • The `DropZoneSpec` contract every zone panel exposes so the
//     visibility panel's row-drag orchestrator can route into any zone
//     with the same accept/reject + commit logic.
//   • Shared DOM builders (`buildDropZoneSection`, `buildEmpty`,
//     `buildPill`) so the 3 zone panels + the visibility panel render
//     identical pill / empty chrome.
//   • Shared drag ghost + insertion-line helpers.

import { iconSvg } from '../../../renderer/icons';

/** Verbatim from the Cycle 15 / Task 6 row group panel. ONE drop-zone
 *  empty-state string across the grid. */
export const ROW_GROUPS_PLACEHOLDER = 'Drag here to set row groups';
export const VALUES_PLACEHOLDER = 'Drag here to aggregate';
export const PIVOT_PLACEHOLDER = 'Drag here to set column labels';

/** Default aggregation when a column gets dropped on the Values zone
 *  and its colDef declares no `aggFunc`. Mirrors AG-Grid's default. */
export const DEFAULT_VALUE_AGG_FUNC = 'sum';

/** Threshold (CSS px) the pointer must move from the down-event before
 *  a press is treated as a drag. Matches Cycle 6's column-drag
 *  threshold + Cycle 15.5 / Task 1's pill-reorder threshold; one drag
 *  budget across the grid. */
export const DRAG_THRESHOLD_PX = 4;

/** A drop-zone hosts pills of one logical kind (row-group / pivot /
 *  value). The shared shape lets the visibility panel's row-drag route
 *  through ANY of the three with the same hit-test + accept/reject +
 *  commit logic. */
export interface DropZoneSpec {
  /** The dashed-outline container that doubles as the drop target. */
  dropZone: HTMLElement;
  /** True when `colId` is eligible to land in this zone (i.e. the
   *  column's resolved colDef carries the right `enableX` flag AND the
   *  column isn't already assigned to this zone). */
  accepts(colId: string): boolean;
  /** Commit the drop — add `colId` to this zone's underlying list. */
  commit(colId: string): void;
}

/** Zone identifier suffixed onto CSS class names (`cg-columns-panel-${zone}-…`).
 *  `rgz` = Row Groups, `plz` = Column Labels (pivot), `valz` = Values. */
export type ZoneKind = 'rgz' | 'plz' | 'valz';

/** Result of `buildDropZoneSection` — the section wrapper plus the two
 *  inner handles the caller caches for refresh + hit-testing. */
export interface DropZoneSectionHandles {
  section: HTMLElement;
  dropZone: HTMLElement;
  content: HTMLElement;
}

/** Shared drop-zone section scaffold — header (icon + label) + zone
 *  container + content. */
export function buildDropZoneSection(opts: {
  kind: 'groups' | 'pivots' | 'values';
  iconName: Parameters<typeof iconSvg>[0];
  headerText: string;
  ariaLabel: string;
  zoneClass: string;
  contentClass: string;
}): DropZoneSectionHandles {
  const section = document.createElement('div');
  section.className = 'cg-columns-panel-section';
  section.dataset.kind = opts.kind;

  const header = document.createElement('div');
  header.className = `cg-columns-panel-section-header cg-columns-panel-section-header--${opts.kind}`;
  const iconWrap = document.createElement('span');
  iconWrap.className = 'cg-columns-panel-section-header-icon';
  iconWrap.appendChild(iconSvg(opts.iconName, 13));
  header.appendChild(iconWrap);
  header.appendChild(document.createTextNode(opts.headerText));

  const dropZone = document.createElement('div');
  dropZone.className = `cg-columns-panel-drop-zone ${opts.zoneClass}`;
  dropZone.setAttribute('role', 'list');
  dropZone.setAttribute('aria-label', opts.ariaLabel);

  const content = document.createElement('div');
  content.className = opts.contentClass;
  dropZone.appendChild(content);

  section.appendChild(header);
  section.appendChild(dropZone);
  return { section, dropZone, content };
}

/** Empty-state element for a zone. */
export function buildEmpty(zone: ZoneKind, placeholder: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = `cg-columns-panel-${zone}-empty`;
  empty.textContent = placeholder;
  return empty;
}

/** Options for `buildPill`. */
export interface BuildPillOptions {
  zone: ZoneKind;
  colId: string;
  label: string;
  removeAriaLabel: string;
  onRemove: () => void;
  /** Called on mousedown once the drag threshold is crossed. The pill
   *  panel owns the drag lifecycle from there. */
  onMouseDown: (e: MouseEvent) => void;
}

/** Build one pill: drag-handle + label + ✕ remove. `zone` is the CSS
 *  prefix that scopes the pill's classes so per-zone selectors in tests
 *  (e.g. `.cg-columns-panel-plz-pill`) still uniquely identify the
 *  right pill kind. */
export function buildPill(opts: BuildPillOptions): HTMLElement {
  const pill = document.createElement('div');
  pill.className = `cg-columns-panel-${opts.zone}-pill cg-columns-panel-pill`;
  pill.setAttribute('role', 'listitem');
  pill.dataset.colId = opts.colId;

  const handle = document.createElement('span');
  handle.className = `cg-columns-panel-${opts.zone}-pill-handle cg-columns-panel-pill-handle`;
  handle.setAttribute('aria-hidden', 'true');
  pill.appendChild(handle);

  const label = document.createElement('span');
  label.className = `cg-columns-panel-${opts.zone}-pill-label cg-columns-panel-pill-label`;
  label.textContent = opts.label;
  pill.appendChild(label);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = `cg-columns-panel-${opts.zone}-pill-remove cg-columns-panel-pill-remove`;
  remove.setAttribute('aria-label', opts.removeAriaLabel);
  remove.textContent = '✕';
  remove.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onRemove();
  });
  pill.appendChild(remove);

  pill.addEventListener('mousedown', (e) => {
    if (e.target instanceof Element && e.target.closest(`.cg-columns-panel-${opts.zone}-pill-remove`)) {
      return;
    }
    opts.onMouseDown(e);
  });

  return pill;
}

/** Read a zone's bounding rect — used for hit-testing during a drag.
 *  Returns `null` when the zone is undefined OR has zero size (hidden
 *  section). */
export function getZoneRect(zone: HTMLElement | undefined): DOMRect | null {
  if (!zone) return null;
  const rect = zone.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

/** True when `(clientX, clientY)` falls inside `rect`. */
export function isPointInRect(rect: DOMRect | null, clientX: number, clientY: number): boolean {
  if (!rect) return false;
  return clientX >= rect.left && clientX <= rect.right
    && clientY >= rect.top  && clientY <= rect.bottom;
}

/** Paint / clear the drop-target outline on a zone. */
export function setZoneDropState(zone: HTMLElement | null, state: 'accept' | 'reject' | null): void {
  if (!zone) return;
  if (state === null) delete zone.dataset.drop;
  else zone.dataset.drop = state;
}

/** Floating ghost element that follows the cursor during a drag. The
 *  same shape is used by both the row-drag (inside `VisibilityPanel`)
 *  and the pill-drag (inside each zone panel). */
export interface DragGhost {
  mount(clientX: number, clientY: number): void;
  position(clientX: number, clientY: number): void;
  remove(): void;
}

/** Create a drag-ghost that appends into the closest theme host
 *  ancestor of `rootHost` so the theme's CSS variables land. Falls
 *  back to `document.body` when no theme host is found. */
export function makeDragGhost(rootHost: HTMLElement, label: string): DragGhost {
  let ghost: HTMLDivElement | null = null;
  return {
    mount(clientX, clientY) {
      if (typeof document === 'undefined') return;
      const el = document.createElement('div');
      el.className = 'cg-col-drag-ghost';
      const icon = document.createElement('span');
      icon.className = 'cg-col-drag-ghost-icon';
      icon.setAttribute('aria-hidden', 'true');
      const lbl = document.createElement('span');
      lbl.className = 'cg-col-drag-ghost-label';
      lbl.textContent = label;
      el.appendChild(icon);
      el.appendChild(lbl);
      ghost = el;
      el.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY - 14)}px)`;
      const themeHost = rootHost.closest<HTMLElement>('[class*="cg-theme"]') ?? document.body;
      themeHost.appendChild(el);
      requestAnimationFrame(() => el.classList.add('cg-col-drag-ghost--visible'));
    },
    position(clientX, clientY) {
      if (!ghost) return;
      ghost.style.transform = `translate(${Math.round(clientX)}px,${Math.round(clientY - 14)}px)`;
    },
    remove() {
      ghost?.remove();
      ghost = null;
    },
  };
}
