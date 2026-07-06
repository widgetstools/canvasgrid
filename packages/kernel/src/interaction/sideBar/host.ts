/**
 * Cycle 11 / Task 2 — SideBarHost.
 *
 * Owns the DOM panel that mounts on the right (or left) edge of the
 * grid. The host renders three regions inside its root:
 *
 *   ┌──────────────────────────────────┬─┐
 *   │                                  │T│
 *   │      .cg-side-bar-panel          │a│  ← .cg-side-bar-tabs
 *   │  (mounts the active panel's      │b│    (vertical strip; one
 *   │   getGui() output)               │s│     button per ToolPanelDef)
 *   │                                  │ │
 *   └─[ .cg-side-bar-resize ]──────────┴─┘
 *                ^
 *                inner-edge drag handle (col-resize cursor)
 *
 * Only one tool panel is open at a time. Clicking a tab toggles its
 * panel; clicking a different tab while one is open closes the old one
 * and opens the new one. The host destroys the previous instance on
 * close so panels don't leak listeners.
 *
 * The host knows nothing about the canvas. It reports its current
 * reserved-edge width to the grid via `ctx.setReservedSpace(side,
 * width)`; the grid is responsible for inset-shifting the scroller +
 * canvas + editor overlay and calling `cgridCanvas.resize()` so the
 * canvas region updates. `reservedWidth` = `tabsWidth` when no panel is
 * open + `tabsWidth + panelWidth` when a panel is open.
 *
 * String shortcuts in `SideBarDef.toolPanels` (`'columns'` /
 * `'filters'`) expand into the canonical `ToolPanelDef` shape so the
 * default `sideBar: { toolPanels: ['columns', 'filters'] }` works out
 * of the box.
 *
 * Mounting is intentionally tolerant under happy-dom (the vitest env):
 * `getBoundingClientRect()` returns zeros so the resize-handle drag
 * math falls back to a synthetic 280px panel + delta math.
 */
import { ToolPanelRegistry } from '../toolPanels/registry';
import type { SideBarDef, ToolPanel, ToolPanelDef } from '../toolPanels/types';
import { iconSvg } from '../../renderer/icons';
import type { IconName } from '../../renderer/icons';

/** Width of the vertical tab strip in CSS px. Mirrors
 *  `.cg-side-bar-tabs { width: 32px }` in tokens.css. Used only as a
 *  fallback in `getReservedWidth` when `getBoundingClientRect()`
 *  returns 0 (jsdom). */
const TABS_WIDTH = 36;

/** Width of the `.cg-side-bar` border-left in CSS px. Same fallback
 *  use as `TABS_WIDTH` — the live path measures the bar directly. */
const BAR_BORDER_WIDTH = 1;

/** Width of the resize handle in CSS px. Mirrors
 *  `.cg-side-bar-resize { width: 3px }`. Fallback use only. */
const HANDLE_WIDTH = 3;

/** Default panel width when neither `width` nor `defaultWidth` is set
 *  on the ToolPanelDef. Mirrors ag-grid's default. */
const DEFAULT_PANEL_WIDTH = 280;

/** Default minWidth / maxWidth when not specified per panel. Keeps the
 *  drag handle from collapsing the panel to zero or stretching it past
 *  the host width. */
const DEFAULT_MIN_WIDTH = 100;
const DEFAULT_MAX_WIDTH = 800;

/** Maps the built-in iconKey values on ToolPanelDef to icon registry names. */
const BUILT_IN_ICON_MAP: Record<string, IconName> = {
  columns:  'layout-grid',
  filter:   'list-filter',
  settings: 'sliders-horizontal',
};

/** Per-tool-panel slot — the resolved def + (when mounted) the live
 *  instance + its DOM tab button. */
interface PanelSlot {
  def: ToolPanelDef;
  tab: HTMLButtonElement;
  instance: ToolPanel | null;
}

/** Cycle 11 / Task 7 — source tag carried on `toolPanelVisibleChanged`.
 *  Mirrors ag-grid's `ToolPanelVisibleChangedEvent.source`:
 *  - `'api'` — programmatic `openToolPanel` / `closeToolPanel` /
 *    direct host calls without an explicit source.
 *  - `'sideBarButtonClicked'` — the user clicked a tab button.
 *  - `'sideBarInitializing'` — the mount-time auto-open driven by
 *    `SideBarDef.defaultToolPanel`. Fires exactly once per host
 *    construction (or zero times when no `defaultToolPanel` is set or
 *    `hiddenByDefault: true`). */
export type ToolPanelVisibleSource = 'api' | 'sideBarButtonClicked' | 'sideBarInitializing';

/** Cycle 11 / Task 7 — source tag carried on `sideBarVisibleChanged`.
 *  Only `'api'` and `'sideBarButtonClicked'` are valid; there is no
 *  initialisation event for the bar itself (the mount happens
 *  synchronously inside the constructor and apps that want to react to
 *  it use `gridReady` + `isSideBarVisible()`). */
export type SideBarVisibleSource = 'api' | 'sideBarButtonClicked';

/** Cycle 11 / Task 7 — emit payloads the host hands off to its grid
 *  context. CGrid pipes these straight through `this.events.emit` so
 *  apps subscribe via `grid.on('toolPanelVisibleChanged', ...)` /
 *  `grid.on('sideBarVisibleChanged', ...)` like any other event. */
export type SideBarHostEmittedEvent =
  | {
      type: 'toolPanelVisibleChanged';
      /** ID of the panel whose visibility changed. Never `null` in
       *  practice today, but typed `| null` to mirror the catalog. */
      key: string | null;
      visible: boolean;
      source: ToolPanelVisibleSource;
    }
  | {
      type: 'sideBarVisibleChanged';
      visible: boolean;
      source: SideBarVisibleSource;
    };

/** Context handed to SideBarHost by CGrid (or a test harness). Keeps
 *  the host framework-agnostic: it can resolve panel ctors + thread
 *  geometry changes back without importing CGrid directly. */
export interface SideBarGridContext {
  /** Registry that resolves panel-id strings to constructors. */
  registry: ToolPanelRegistry;
  /** Forwarded verbatim to each ToolPanel.init via `params.api`. */
  api: unknown;
  /** Called whenever the side bar geometry changes (mount, open, close,
   *  setVisible, setPosition, resize-handle drag). `width === 0` means
   *  the side bar is fully hidden — the grid should release the
   *  reservation. */
  setReservedSpace(side: 'left' | 'right', width: number): void;
  /** Cycle 11 / Task 7 — optional emit hook the host calls on every
   *  panel-visibility or side-bar-visibility change. CGrid forwards into
   *  its typed event emitter; tests can pin a recording stub here to
   *  assert payloads in isolation. Absent → the host runs without
   *  emitting (e.g. for unit-test setups that don't care about events). */
  emit?(event: SideBarHostEmittedEvent): void;
  /** Pop-out-to-floating-panel — called when the user clicks a tab
   *  whose panel is currently DETACHED (see `detachActivePanel`)
   *  instead of the normal open/close toggle. CGrid wires this to
   *  `dockToolPanel(id)` so clicking the tab re-docks the floating
   *  panel. Absent → clicking a detached tab is a no-op. */
  onReattachRequest?(id: string): void;
}

export class SideBarHost {
  private readonly root: HTMLElement;
  /** The host element (`.cg-side-bar`) appended to the grid root. */
  private readonly bar: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly panelEl: HTMLDivElement;
  private readonly handleEl: HTMLDivElement;
  private readonly ctx: SideBarGridContext;

  /** Resolved (string-shortcuts-expanded) side bar def. */
  private def: Required<Pick<SideBarDef, 'toolPanels' | 'position'>> & SideBarDef;
  /** Resolved ToolPanelDef entries (after expanding `'columns'` /
   *  `'filters'` shortcuts). Indexed by `id`. */
  private slots: Map<string, PanelSlot> = new Map();
  private openedId: string | null = null;
  /** Id of the panel currently popped out to a floating panel (its GUI
   *  was handed off via `detachActivePanel`, its live instance still
   *  lives in `slots.get(id).instance`). `null` when nothing is
   *  detached. Mutually exclusive with `openedId`. */
  private detachedId: string | null = null;
  /** Current panel content width (excludes tab strip). Set per-open
   *  from the panel's `ToolPanelDef.width`; mutated by the resize
   *  handle. */
  private panelWidth = DEFAULT_PANEL_WIDTH;
  private visible: boolean;
  private destroyed = false;

  /** Active resize-handle drag state. `null` when no drag is in progress. */
  private dragState: {
    startClientX: number;
    startPanelWidth: number;
    minWidth: number;
    maxWidth: number;
  } | null = null;
  private readonly onWindowMouseMove = (e: MouseEvent) => this.handleDragMove(e);
  private readonly onWindowMouseUp = (e: MouseEvent) => this.handleDragEnd(e);

  constructor(root: HTMLElement, ctx: SideBarGridContext, def: SideBarDef) {
    this.root = root;
    this.ctx = ctx;
    this.def = resolveSideBarDef(def);
    this.visible = !this.def.hiddenByDefault;

    this.bar = document.createElement('div');
    this.bar.className = 'cg-side-bar';
    this.bar.dataset.position = this.def.position;

    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'cg-side-bar-tabs';
    if (this.def.hideButtons) this.tabsEl.style.display = 'none';

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'cg-side-bar-panel';
    this.panelEl.style.display = 'none';
    this.panelEl.style.width = `${this.panelWidth}px`;

    this.handleEl = document.createElement('div');
    this.handleEl.className = 'cg-side-bar-resize';
    this.handleEl.addEventListener('mousedown', (e) => this.handleDragStart(e));
    // The resize handle is inert when no panel is open (see handleDragStart)
    // and would otherwise eat 3 px of visual space next to the tab strip,
    // pushing the sidebar past the scroller's reserved gutter.
    this.handleEl.style.display = 'none';

    // Order of children inside .cg-side-bar:
    //   tabs | panel | handle
    // With flex-direction:row-reverse (right sidebar): first child is
    // rightmost → tabs end up on the right edge, handle on the left
    // (adjacent to the panel). With flex-direction:row (left sidebar):
    // first child is leftmost → tabs on the left edge, handle on the
    // right.
    this.bar.appendChild(this.tabsEl);
    this.bar.appendChild(this.panelEl);
    this.bar.appendChild(this.handleEl);

    // Build one tab per resolved ToolPanelDef.
    for (const def of this.def.toolPanels) {
      const tdef = def as ToolPanelDef;
      const tab = this.buildTabButton(tdef);
      this.tabsEl.appendChild(tab);
      this.slots.set(tdef.id, { def: tdef, tab, instance: null });
    }

    if (!this.visible) this.bar.style.display = 'none';

    this.root.appendChild(this.bar);

    // Open the default panel — but only when the side bar is visible.
    if (this.visible && this.def.defaultToolPanel) {
      // Cycle 11 / Task 7 — the mount-time auto-open is tagged
      // 'sideBarInitializing' so apps can distinguish "the bar booted
      // up with a panel already open" from a later API or click open.
      this.openPanel(this.def.defaultToolPanel, 'sideBarInitializing');
    } else {
      // Initial reservation: tabs-only when visible, zero when hidden.
      this.reserveSpace();
    }
  }

  /** The resolved (string-shortcuts-expanded) side bar def. Exposed so
   *  `api.getSideBar()` (Task 6) can return the live shape. */
  /** The tab label for `id` (e.g. `'Column Groups'`), from the resolved slot
   *  def; falls back to the id. Used for the floating-panel title. */
  getPanelLabel(id: string): string {
    return this.slots.get(id)?.def.labelDefault ?? id;
  }

  getSideBarDef(): SideBarDef {
    return this.def;
  }

  /** The id of the currently open panel, or `null` when none. */
  getOpenedToolPanelId(): string | null {
    return this.openedId;
  }

  /** The live ToolPanel instance for `id`, or `null` when not mounted. */
  getInstance(id: string): ToolPanel | null {
    return this.slots.get(id)?.instance ?? null;
  }

  /** Whether the side bar is visible (i.e. NOT in `display: none`). */
  isVisible(): boolean {
    return this.visible;
  }

  /** Current panel content width in CSS px (zero when no panel is open). */
  getPanelWidth(): number {
    return this.openedId !== null ? this.panelWidth : 0;
  }

  /** Total reserved width in CSS px (tabs + panel-when-open).
   *  Matches the value passed to `ctx.setReservedSpace`.
   *
   *  Prefers the actual rendered footprint of `this.bar` (via
   *  `getBoundingClientRect`) so the reservation includes the sidebar's
   *  1 px border-left and (when a panel is open) the 3 px resize handle.
   *  Summing constants alone leaves ~4 px of canvas under the sidebar's
   *  z-index:2 overlay, hiding the rightmost edge of the vertical
   *  scrollbar — the regression flagged on 2026-06-26.
   *
   *  Falls back to constant-summed math when `getBoundingClientRect`
   *  returns 0 (jsdom under unit tests, pre-layout calls during mount). */
  getReservedWidth(): number {
    if (!this.visible) return 0;
    if (this.def.hideButtons && this.openedId === null) return 0;
    const measured = Math.ceil(this.bar.getBoundingClientRect().width);
    if (measured > 0) return measured;
    // Fallback: tabs (28) + sidebar border-left (1) + when-panel-open
    // (resize handle 3 + panelWidth).
    let w = this.def.hideButtons ? 0 : TABS_WIDTH;
    if (w > 0) w += BAR_BORDER_WIDTH;
    if (this.openedId !== null) w += HANDLE_WIDTH + this.panelWidth;
    return w;
  }

  /** Open `id`. No-op when the id is unknown. Closes any previously-open
   *  panel first (one-at-a-time). The optional `source` defaults to
   *  `'api'`; the internal close that fires before the new panel mounts
   *  carries the same source so `toolPanelVisibleChanged` emits travel
   *  as a paired close/open with one consistent origin tag. */
  openPanel(id: string, source: ToolPanelVisibleSource = 'api'): void {
    if (this.destroyed) return;
    const slot = this.slots.get(id);
    if (!slot) return;
    // The panel is currently popped out to a floating panel — an
    // open request (API or tab click) re-docks it instead of
    // instantiating a second live instance over the detached one.
    if (this.detachedId === id) {
      this.ctx.onReattachRequest?.(id);
      return;
    }
    if (this.openedId === id) return;
    // When switching from one panel to another, the close fires under
    // the SAME source as the open — a tab click that switches panels
    // produces two 'sideBarButtonClicked' events, an API switch produces
    // two 'api' events, etc.
    if (this.openedId !== null) this.closePanel(source);

    const instance = this.ctx.registry.instantiate(slot.def.toolPanel, {
      api: this.ctx.api,
      toolPanelParams: slot.def.toolPanelParams,
    });
    if (!instance) return; // unknown component string — silent no-op

    slot.instance = instance;
    this.panelEl.appendChild(instance.getGui());
    this.panelWidth = slot.def.width ?? DEFAULT_PANEL_WIDTH;
    this.panelEl.style.width = `${this.panelWidth}px`;
    this.panelEl.style.display = '';
    this.handleEl.style.display = '';
    slot.tab.setAttribute('aria-pressed', 'true');
    this.openedId = id;
    this.reserveSpace();
    this.ctx.emit?.({
      type: 'toolPanelVisibleChanged',
      key: id,
      visible: true,
      source,
    });
  }

  /** Close any open panel. Destroys the live instance + clears the DOM.
   *  The optional `source` defaults to `'api'`; pass
   *  `'sideBarButtonClicked'` from a tab handler that's toggling its
   *  panel off. */
  closePanel(source: ToolPanelVisibleSource = 'api'): void {
    if (this.destroyed) return;
    if (this.openedId === null) return;
    const closedKey = this.openedId;
    const slot = this.slots.get(this.openedId);
    if (slot) {
      if (slot.instance) {
        try { slot.instance.destroy(); } catch (e) { console.error(e); }
        slot.instance = null;
      }
      slot.tab.setAttribute('aria-pressed', 'false');
    }
    this.panelEl.replaceChildren();
    this.panelEl.style.display = 'none';
    this.handleEl.style.display = 'none';
    this.openedId = null;
    this.reserveSpace();
    this.ctx.emit?.({
      type: 'toolPanelVisibleChanged',
      key: closedKey,
      visible: false,
      source,
    });
  }

  /** Pop-out support — detach the currently OPEN panel's GUI out of the
   *  sidebar WITHOUT destroying its live instance. Collapses the panel
   *  area exactly like `closePanel` (hides `panelEl` + `handleEl`, clears
   *  `panelEl`'s children, un-presses the tab) but the instance stays
   *  alive in `slots.get(id).instance` so its state/listeners survive —
   *  the caller (CGrid) reparents the returned `gui` into a floating
   *  frame. No-op (`null`) when no panel is currently open. */
  detachActivePanel(): { id: string; gui: HTMLElement } | null {
    if (this.destroyed) return null;
    if (this.openedId === null) return null;
    const id = this.openedId;
    const slot = this.slots.get(id);
    if (!slot || !slot.instance) return null;
    const gui = slot.instance.getGui();
    this.panelEl.replaceChildren();
    this.panelEl.style.display = 'none';
    this.handleEl.style.display = 'none';
    slot.tab.setAttribute('aria-pressed', 'false');
    slot.tab.dataset.cgDetached = 'true';
    this.openedId = null;
    this.detachedId = id;
    this.reserveSpace();
    this.ctx.emit?.({
      type: 'toolPanelVisibleChanged',
      key: id,
      visible: false,
      source: 'api',
    });
    return { id, gui };
  }

  /** Pop-out support — re-mount the detached panel's GUI back into the
   *  sidebar panel area and restore the open visuals (mirrors
   *  `openPanel`'s DOM effects, but reuses the SAME live instance rather
   *  than instantiating a new one). No-op (`false`) when nothing is
   *  currently detached. */
  reattachPanel(): boolean {
    if (this.destroyed) return false;
    if (this.detachedId === null) return false;
    const id = this.detachedId;
    const slot = this.slots.get(id);
    if (!slot || !slot.instance) {
      this.detachedId = null;
      return false;
    }
    this.panelEl.appendChild(slot.instance.getGui());
    this.panelWidth = slot.def.width ?? DEFAULT_PANEL_WIDTH;
    this.panelEl.style.width = `${this.panelWidth}px`;
    this.panelEl.style.display = '';
    this.handleEl.style.display = '';
    slot.tab.setAttribute('aria-pressed', 'true');
    delete slot.tab.dataset.cgDetached;
    this.openedId = id;
    this.detachedId = null;
    this.reserveSpace();
    this.ctx.emit?.({
      type: 'toolPanelVisibleChanged',
      key: id,
      visible: true,
      source: 'api',
    });
    return true;
  }

  /** Pop-out support — destroy the DETACHED panel's live instance (the
   *  one whose `gui` was handed off via `detachActivePanel` and is
   *  hosted in a floating panel elsewhere). Used when the floating
   *  panel is CLOSED (dismissed, not docked) so the instance doesn't
   *  leak. No-op when nothing is currently detached. */
  destroyDetached(): void {
    if (this.detachedId === null) return;
    const id = this.detachedId;
    const slot = this.slots.get(id);
    if (slot) {
      if (slot.instance) {
        try { slot.instance.destroy(); } catch (e) { console.error(e); }
        slot.instance = null;
      }
      delete slot.tab.dataset.cgDetached;
    }
    this.detachedId = null;
  }

  /** The id of the panel currently popped out to a floating panel, or
   *  `null` when nothing is detached. */
  getDetachedId(): string | null {
    return this.detachedId;
  }

  /** Toggle whole-side-bar visibility (`display: none` when hidden). The
   *  optional `source` defaults to `'api'`. Hiding the bar leaves the
   *  open panel intact in host state — no `toolPanelVisibleChanged`
   *  fires; only `sideBarVisibleChanged` does. */
  setVisible(show: boolean, source: SideBarVisibleSource = 'api'): void {
    if (this.destroyed) return;
    if (this.visible === show) return;
    this.visible = show;
    this.bar.style.display = show ? '' : 'none';
    this.reserveSpace();
    this.ctx.emit?.({
      type: 'sideBarVisibleChanged',
      visible: show,
      source,
    });
  }

  /** Shift the side bar's top edge down by `top` CSS px so it clears
   *  the row group panel (or any other element stacked above it in the
   *  grid root). Called from cgrid's `applyVerticalInsets` whenever the
   *  row group panel height changes. */
  setTopOffset(top: number): void {
    if (this.destroyed) return;
    this.bar.style.top = top > 0 ? `${top}px` : '';
  }

  /** Cycle 21i Phase 2 — lift the side bar's bottom edge by `bottom`
   *  CSS px so it clears a bottom status bar. Without this the bar's
   *  `bottom: 0` CSS puts panel footers (the Column Groups Apply/Reset
   *  row) UNDER the status strip, making them unclickable. Called from
   *  cgrid's `applyVerticalInsets` alongside `setTopOffset`. */
  setBottomOffset(bottom: number): void {
    if (this.destroyed) return;
    this.bar.style.bottom = bottom > 0 ? `${bottom}px` : '';
  }

  /** Switch the side bar to the opposite edge. Re-mounts the DOM as a
   *  whole so CSS rules anchored on `[data-position]` apply, and tells
   *  the host grid to release the old edge reservation + take the new
   *  one. */
  setPosition(pos: 'left' | 'right'): void {
    if (this.destroyed) return;
    if (this.def.position === pos) return;
    const oldSide = this.def.position;
    // Release the old edge.
    this.ctx.setReservedSpace(oldSide, 0);
    this.def = { ...this.def, position: pos };
    this.bar.dataset.position = pos;
    // Reserve on the new edge.
    this.reserveSpace();
  }

  /** Tear down: destroys any mounted instance, removes the DOM, drops
   *  window listeners. Safe to call multiple times. */
  destroy(): void {
    if (this.destroyed) return;
    // Tear down any mounted panel BEFORE flipping the `destroyed` flag,
    // since `closePanel` short-circuits when destroyed.
    if (this.openedId !== null) this.closePanel();
    // Same for a DETACHED panel's instance (popped out to a floating
    // panel elsewhere) — don't leak it.
    if (this.detachedId !== null) this.destroyDetached();
    this.destroyed = true;
    window.removeEventListener('mousemove', this.onWindowMouseMove);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
    this.ctx.setReservedSpace(this.def.position, 0);
    this.bar.parentElement?.removeChild(this.bar);
  }

  // ---- internals ----------------------------------------------------

  private buildTabButton(def: ToolPanelDef): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cg-side-bar-tab';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', def.labelDefault);
    btn.dataset.id = def.id;

    // SVG icon + rotated text label stacked vertically on the slim tab strip.
    const iconWrap = document.createElement('span');
    iconWrap.className = 'cg-side-bar-tab-icon';
    const iconKey = def.iconKey ? (BUILT_IN_ICON_MAP[def.iconKey] ?? null) : null;
    if (iconKey) iconWrap.appendChild(iconSvg(iconKey, 14));
    const label = document.createElement('span');
    label.className = 'cg-side-bar-tab-label';
    label.textContent = def.labelDefault;
    btn.appendChild(iconWrap);
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      // Pop-out support — clicking the tab of a DETACHED panel (popped
      // out to a floating panel) asks the grid to re-dock it instead of
      // the normal open/close toggle below.
      if (this.detachedId === def.id) {
        this.ctx.onReattachRequest?.(def.id);
        return;
      }
      // Cycle 11 / Task 7 — tab clicks emit toolPanelVisibleChanged
      // with source='sideBarButtonClicked'. Switching tabs produces a
      // close + open pair, both tagged with the same source.
      if (this.openedId === def.id) this.closePanel('sideBarButtonClicked');
      else this.openPanel(def.id, 'sideBarButtonClicked');
    });
    return btn;
  }

  private reserveSpace(): void {
    this.ctx.setReservedSpace(this.def.position, this.getReservedWidth());
  }

  private handleDragStart(e: MouseEvent): void {
    if (this.destroyed) return;
    if (this.openedId === null) return; // No panel open — handle is inert
    e.preventDefault();
    const slot = this.slots.get(this.openedId);
    const minWidth = slot?.def.minWidth ?? DEFAULT_MIN_WIDTH;
    const maxWidth = slot?.def.maxWidth ?? DEFAULT_MAX_WIDTH;
    this.dragState = {
      startClientX: e.clientX,
      startPanelWidth: this.panelWidth,
      minWidth,
      maxWidth,
    };
    window.addEventListener('mousemove', this.onWindowMouseMove);
    window.addEventListener('mouseup', this.onWindowMouseUp);
  }

  private handleDragMove(e: MouseEvent): void {
    const drag = this.dragState;
    if (!drag) return;
    // Right-positioned: dragging LEFT (negative dx) widens the panel,
    // since the side bar's inner edge moves leftward into the canvas
    // region. Left-positioned: dragging RIGHT (positive dx) widens.
    const sign = this.def.position === 'right' ? -1 : 1;
    const dx = (e.clientX - drag.startClientX) * sign;
    let next = drag.startPanelWidth + dx;
    if (next < drag.minWidth) next = drag.minWidth;
    if (next > drag.maxWidth) next = drag.maxWidth;
    this.panelWidth = next;
    this.panelEl.style.width = `${next}px`;
    this.reserveSpace();
  }

  private handleDragEnd(_e: MouseEvent): void {
    if (this.dragState === null) return;
    this.dragState = null;
    window.removeEventListener('mousemove', this.onWindowMouseMove);
    window.removeEventListener('mouseup', this.onWindowMouseUp);
  }
}

/** Expand string shortcuts inside `SideBarDef.toolPanels`. Apps can pass
 *  `'columns'` / `'filters'` shorthands for the built-ins; the host
 *  materialises them into the canonical `ToolPanelDef` shape so the
 *  rest of the pipeline only sees objects.
 *
 *  Also fills in a default `position` (`'right'`) so callers don't have
 *  to repeat it. Mirrors ag-grid's resolution behaviour. */
export function resolveSideBarDef(def: SideBarDef): Required<Pick<SideBarDef, 'toolPanels' | 'position'>> & SideBarDef {
  const toolPanels: ToolPanelDef[] = def.toolPanels.map((entry) => {
    if (typeof entry !== 'string') return entry;
    return expandToolPanelShortcut(entry);
  });
  return {
    ...def,
    toolPanels,
    position: def.position ?? 'right',
  };
}

/** Convert one of the built-in shortcut strings (`'columns'` /
 *  `'filters'`) into a full `ToolPanelDef`. Throws on unknown strings
 *  so a typo surfaces loudly rather than silently dropping a tab. */
function expandToolPanelShortcut(name: string): ToolPanelDef {
  switch (name) {
    case 'columns':
      return {
        id: 'agColumnsToolPanel',
        labelDefault: 'Columns',
        labelKey: 'columns',
        iconKey: 'columns',
        toolPanel: 'agColumnsToolPanel',
      };
    case 'filters':
      return {
        id: 'agFiltersToolPanel',
        labelDefault: 'Filters',
        labelKey: 'filters',
        iconKey: 'filter',
        toolPanel: 'agFiltersToolPanel',
      };
    case 'gridOptions':
      // Cycle 21i / Phase 1 — native Grid Options settings tab.
      return {
        id: 'agGridOptionsToolPanel',
        labelDefault: 'Options',
        labelKey: 'gridOptions',
        iconKey: 'settings',
        toolPanel: 'agGridOptionsToolPanel',
      };
    case 'columnGroups':
      // Cycle 21i — native Column Groups editor tab (after Options).
      return {
        id: 'agColumnGroupsToolPanel',
        labelDefault: 'Column Groups',
        labelKey: 'columnGroups',
        iconKey: 'group',
        toolPanel: 'agColumnGroupsToolPanel',
      };
    default:
      throw new Error(`[cgrid] unknown SideBarDef.toolPanels shortcut: '${name}' (expected 'columns', 'filters', 'gridOptions' or 'columnGroups')`);
  }
}

/** Resolve `CGridOptions.sideBar` (which accepts loose shapes —
 *  `boolean | string | string[] | SideBarDef`) into a canonical
 *  `SideBarDef`, or `null` when the option is off. Mirrors ag-grid's
 *  acceptance shape. */
export function normalizeSideBarOption(
  opt: boolean | string | string[] | SideBarDef | undefined,
): SideBarDef | null {
  if (opt == null || opt === false) return null;
  if (opt === true) return { toolPanels: ['columns', 'filters'] };
  if (typeof opt === 'string') return { toolPanels: [opt] };
  if (Array.isArray(opt)) return { toolPanels: opt };
  return opt;
}
