/**
 * Cycle 13 / Task 1 — StatusBarHost.
 *
 * Owns the DOM panel that mounts on the bottom (or top) edge of the grid
 * and houses status panels in three zones (left / center / right). The
 * host renders one root with three child zone containers:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  ⟨ left zone ──── ⟩    ⟨ center zone ⟩    ⟨ ──── right ⟩    │
 *   └────────────────────────────────────────────────────────────┘
 *      .cg-status-bar
 *        .cg-status-bar-zone.cg-status-bar-zone--left
 *        .cg-status-bar-zone.cg-status-bar-zone--center
 *        .cg-status-bar-zone.cg-status-bar-zone--right
 *
 * The host knows nothing about the canvas. It reports its current
 * reserved-edge height to the grid via `ctx.setReservedSpace(side,
 * height)`; the grid inset-shifts the scroller + canvas in response and
 * calls `cgridCanvas.resize()` so the body region re-fits. Reserved
 * height = bar height when visible, 0 when hidden (`hiddenByDefault` or
 * post-`setVisible(false)`).
 *
 * Panel routing: each `StatusPanelDef.align` (default `'right'`) sorts
 * its panel into one zone; multiple panels in the same zone stack in
 * the order they appear in `statusPanels`. Unknown panel keys are a
 * silent no-op so a typo on one panel doesn't break the others —
 * matches the side-bar host's tolerance.
 *
 * Mounting is intentionally tolerant under happy-dom (the vitest env):
 * `getBoundingClientRect()` returns zeros so callers that ask the host
 * for its reserved height fall back to the configured height constant.
 *
 * See `docs/superpowers/plans/notes/cycle-13-statusbar-design.md` for
 * the design rationale behind the height / padding / zone layout.
 */
import type { StatusPanelRegistry } from './registry';
import type {
  IStatusPanelComp,
  StatusBarDef,
  StatusBarPosition,
  StatusPanelAlign,
  StatusPanelDef,
} from './types';

/** Default bar height in CSS px. Mirrors `--cg-status-bar-height: 28px`
 *  in tokens.css and the design plan in cycle-13-statusbar-design.md.
 *  Used as the reservation height when `getBoundingClientRect()` returns
 *  0 (happy-dom under unit tests, pre-layout calls during mount). */
const BAR_HEIGHT = 28;

/** Per-status-panel slot — the resolved def + the live instance + the
 *  zone the instance is mounted into. */
interface PanelSlot {
  def: StatusPanelDef;
  align: StatusPanelAlign;
  instance: IStatusPanelComp | null;
}

/** Context handed to StatusBarHost by CGrid (or a test harness). Keeps
 *  the host framework-agnostic: it can resolve panel ctors + thread
 *  geometry changes back without importing CGrid directly. */
export interface StatusBarGridContext {
  /** Registry that resolves panel-key strings to constructors. */
  registry: StatusPanelRegistry;
  /** Forwarded verbatim to each IStatusPanelComp.init via `params.api`. */
  api: unknown;
  /** Called whenever the status bar geometry changes (mount, setVisible,
   *  setPosition, destroy). `height === 0` means the bar is fully hidden
   *  — the grid should release the reservation on `side`. The host
   *  guarantees exactly one call per state change. */
  setReservedSpace(side: StatusBarPosition, height: number): void;
}

export class StatusBarHost {
  private readonly root: HTMLElement;
  /** `.cg-status-bar` appended to the grid root. */
  private readonly bar: HTMLDivElement;
  /** Three zone containers keyed by alignment. */
  private readonly zones: Record<StatusPanelAlign, HTMLDivElement>;
  private readonly ctx: StatusBarGridContext;

  private def: StatusBarDef & { position: StatusBarPosition };
  /** Resolved StatusPanelDef entries, keyed by `def.key`. Order is
   *  declaration order — the panel-mount loop iterates this map's
   *  insertion order so per-zone stacking matches `statusPanels`. */
  private slots: Map<string, PanelSlot> = new Map();
  private visible: boolean;
  private destroyed = false;

  constructor(root: HTMLElement, ctx: StatusBarGridContext, def: StatusBarDef) {
    this.root = root;
    this.ctx = ctx;
    this.def = { ...def, position: def.position ?? 'bottom' };
    this.visible = !this.def.hiddenByDefault;

    this.bar = document.createElement('div');
    this.bar.className = 'cg-status-bar';
    this.bar.dataset.position = this.def.position;

    this.zones = {
      left: this.buildZone('left'),
      center: this.buildZone('center'),
      right: this.buildZone('right'),
    };
    this.bar.appendChild(this.zones.left);
    this.bar.appendChild(this.zones.center);
    this.bar.appendChild(this.zones.right);

    if (!this.visible) this.bar.style.display = 'none';
    this.root.appendChild(this.bar);

    // Mount every panel def — built-ins use the canonical default
    // alignment (`'right'`) but apps can override per panel. Unknown
    // component keys leave the slot present with `instance: null` so a
    // later `register()` + re-mount can fill in without re-resolving
    // the whole def list. (For Task 1 the slot is set up; Tasks 2/3
    // register the real ctors against the same keys at construction.)
    for (const pd of this.def.statusPanels) {
      this.mountPanel(pd);
    }

    this.reserveSpace();
  }

  /** The resolved `StatusBarDef` (position defaulted). Exposed so an
   *  `api.getStatusBar()` (or app-side debug code) can return the live
   *  shape. */
  getStatusBarDef(): StatusBarDef {
    return this.def;
  }

  /** The live status-panel instance for `key`, or `null` when not
   *  mounted (either the key was never in `statusPanels`, or its
   *  component was unknown at mount). Surface for `api.getStatusPanel(key)`
   *  (Task 4). */
  getInstance(key: string): IStatusPanelComp | null {
    return this.slots.get(key)?.instance ?? null;
  }

  /** Whether the status bar is visible (i.e. NOT in `display: none`). */
  isVisible(): boolean {
    return this.visible;
  }

  /** Current reserved height in CSS px (bar height when visible, 0 when
   *  hidden). Matches the value passed to `ctx.setReservedSpace`.
   *
   *  Prefers the actual rendered footprint of `this.bar` (via
   *  `getBoundingClientRect`) so the reservation reflects the live
   *  measured height. Falls back to the configured `BAR_HEIGHT` constant
   *  when `getBoundingClientRect` returns 0 (jsdom / happy-dom, or
   *  pre-layout calls during mount). */
  getReservedHeight(): number {
    if (!this.visible) return 0;
    const measured = Math.ceil(this.bar.getBoundingClientRect().height);
    return measured > 0 ? measured : BAR_HEIGHT;
  }

  /** Toggle whole-status-bar visibility. Mirrors `SideBarHost.setVisible`
   *  — `display: none` when hidden, drops the canvas reservation in the
   *  same call so the body region reflows. */
  setVisible(show: boolean): void {
    if (this.destroyed) return;
    if (this.visible === show) return;
    this.visible = show;
    this.bar.style.display = show ? '' : 'none';
    this.reserveSpace();
  }

  /** Switch the status bar to the opposite edge. Re-emits the reservation
   *  on the new edge after releasing the old one in a single
   *  synchronous resize. */
  setPosition(pos: StatusBarPosition): void {
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

  /** Fan out a refresh() to every live panel instance. Tolerant: a
   *  panel that throws inside `refresh()` does NOT prevent siblings
   *  from refreshing. Task 5 wraps this in an rAF-batched dispatcher
   *  so selection / filter bursts collapse to one call per frame; for
   *  Task 1 the synchronous version is the test surface. */
  refresh(): void {
    if (this.destroyed) return;
    for (const slot of this.slots.values()) {
      if (!slot.instance) continue;
      try { slot.instance.refresh(); } catch (e) { console.error(e); }
    }
  }

  /** Replace the panel set with a new def. Destroys every previously-
   *  mounted instance, swaps `statusPanels` + `position`, re-mounts. The
   *  reservation is re-emitted at the end so a position flip in the same
   *  call lands cleanly. */
  setStatusBarDef(def: StatusBarDef): void {
    if (this.destroyed) return;
    // Tear down existing panels.
    for (const slot of this.slots.values()) {
      if (slot.instance) {
        try { slot.instance.destroy(); } catch (e) { console.error(e); }
        slot.instance = null;
      }
    }
    this.slots.clear();
    // Clear each zone's DOM children.
    for (const zone of [this.zones.left, this.zones.center, this.zones.right]) {
      zone.replaceChildren();
    }
    // Apply the new def. Position change is treated as a normal
    // setPosition() to release the old edge before reserving on the new.
    const oldPos = this.def.position;
    const newPos = def.position ?? this.def.position;
    this.def = { ...def, position: newPos };
    this.bar.dataset.position = newPos;
    if (oldPos !== newPos) this.ctx.setReservedSpace(oldPos, 0);
    for (const pd of this.def.statusPanels) {
      this.mountPanel(pd);
    }
    this.reserveSpace();
  }

  /** Tear down: destroys every mounted instance, removes the DOM,
   *  releases the canvas inset. Safe to call multiple times. */
  destroy(): void {
    if (this.destroyed) return;
    for (const slot of this.slots.values()) {
      if (slot.instance) {
        try { slot.instance.destroy(); } catch (e) { console.error(e); }
        slot.instance = null;
      }
    }
    this.slots.clear();
    this.destroyed = true;
    this.ctx.setReservedSpace(this.def.position, 0);
    this.bar.parentElement?.removeChild(this.bar);
  }

  // ---- internals ----------------------------------------------------

  private buildZone(align: StatusPanelAlign): HTMLDivElement {
    const zone = document.createElement('div');
    zone.className = `cg-status-bar-zone cg-status-bar-zone--${align}`;
    zone.dataset.zone = align;
    return zone;
  }

  /** Resolve + instantiate one panel def and mount it into the matching
   *  zone. Unknown component keys leave `slot.instance: null` so the def
   *  is still visible to `getInstance(key)` (returns `null`) and so
   *  Tasks 2/3 can fill in by registering ctors later. */
  private mountPanel(def: StatusPanelDef): void {
    const align: StatusPanelAlign = def.align ?? 'right';
    const slot: PanelSlot = { def, align, instance: null };
    this.slots.set(def.key, slot);
    const instance = this.ctx.registry.instantiate(def.statusPanel, {
      api: this.ctx.api,
      statusPanelParams: def.statusPanelParams,
    });
    if (!instance) return; // unknown component string — silent no-op
    slot.instance = instance;
    this.zones[align].appendChild(instance.getGui());
  }

  private reserveSpace(): void {
    this.ctx.setReservedSpace(this.def.position, this.getReservedHeight());
  }
}

/** Resolve `CGridOptions.statusBar` (which accepts loose shapes —
 *  `boolean | StatusBarDef`) into a canonical `StatusBarDef`, or `null`
 *  when the option is off. Mirrors `normalizeSideBarOption`'s acceptance
 *  shape so apps that flip both surfaces feel consistent. */
export function normalizeStatusBarOption(
  opt: boolean | StatusBarDef | undefined,
): StatusBarDef | null {
  if (opt == null || opt === false) return null;
  if (opt === true) return { statusPanels: [] };
  return opt;
}
