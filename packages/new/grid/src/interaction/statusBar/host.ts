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
 *      .vg-status-bar
 *        .vg-status-bar-zone.vg-status-bar-zone--left
 *        .vg-status-bar-zone.vg-status-bar-zone--center
 *        .vg-status-bar-zone.vg-status-bar-zone--right
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

/** Default bar height in CSS px. Mirrors `--vg-status-bar-height: 28px`
 *  in tokens.css and the design plan in cycle-13-statusbar-design.md.
 *  Used as the reservation height when `getBoundingClientRect()` returns
 *  0 (happy-dom under unit tests, pre-layout calls during mount). */
const BAR_HEIGHT = 28;

/** Per-status-panel slot — the resolved def + the live instance + the
 *  zone the instance is mounted into. `originalRefresh` is the panel's
 *  un-wrapped `refresh` bound to the instance; captured before
 *  `mountPanel` swaps `instance.refresh` with the rAF-batching shim
 *  (Cycle 13 / Task 5) so synchronous fan-outs (`host.refresh()`,
 *  flushes from `flushPending()`) keep their direct semantics while
 *  panel-side `this.refresh()` calls from event handlers collapse to
 *  one per frame. `null` when the slot is empty (unknown component
 *  string at mount time). */
interface PanelSlot {
  def: StatusPanelDef;
  align: StatusPanelAlign;
  instance: IStatusPanelComp | null;
  originalRefresh: (() => void) | null;
}

/** Context handed to StatusBarHost by VelocityGrid (or a test harness). Keeps
 *  the host framework-agnostic: it can resolve panel ctors + thread
 *  geometry changes back without importing VelocityGrid directly. */
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
  /** `.vg-status-bar` appended to the grid root. */
  private readonly bar: HTMLDivElement;
  /** Three zone containers keyed by alignment. */
  private readonly zones: Record<StatusPanelAlign, HTMLDivElement>;
  private readonly ctx: StatusBarGridContext;

  private def: StatusBarDef & { position: StatusBarPosition };
  /** Cycle 21i Phase 2 — top inset (toolbar height) applied while the
   *  bar is top-positioned; cleared when bottom-positioned. */
  private topOffset = 0;
  /** Resolved StatusPanelDef entries, keyed by `def.key`. Order is
   *  declaration order — the panel-mount loop iterates this map's
   *  insertion order so per-zone stacking matches `statusPanels`. */
  private slots: Map<string, PanelSlot> = new Map();
  private visible: boolean;
  private destroyed = false;

  /** Cycle 13 / Task 5 — rAF-batched refresh dispatcher state.
   *  `pendingSlots` is the set of slots whose `originalRefresh` will
   *  run on the next animation-frame flush; `rafHandle` is the
   *  outstanding `requestAnimationFrame` handle (or `null` when no
   *  flush is queued). The dispatcher exists so a burst of grid
   *  events (selection / filter / rowData changes) collapses to one
   *  panel refresh per frame instead of N synchronous refreshes per
   *  burst. Status updates write only DOM text + the `hidden` flag —
   *  they MUST NOT call `cgridCanvas.requestRepaint`, so the canvas
   *  paint loop is untouched regardless of event volume. */
  private pendingSlots: Set<PanelSlot> = new Set();
  private rafHandle: number | null = null;

  constructor(root: HTMLElement, ctx: StatusBarGridContext, def: StatusBarDef) {
    this.root = root;
    this.ctx = ctx;
    this.def = { ...def, position: def.position ?? 'bottom' };
    this.visible = !this.def.hiddenByDefault;

    this.bar = document.createElement('div');
    this.bar.className = 'vg-status-bar';
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

  /** Cycle 21i Phase 2 — shift a TOP-positioned bar down by `top` CSS
   *  px so it clears the intrinsic toolbar strip above it. Host-owned
   *  (mirrors SideBarHost.setTopOffset) so cgrid never reaches into the
   *  bar's DOM via string selectors — and, critically, the inline top
   *  is CLEARED whenever the bar is bottom-positioned: a stale inline
   *  `top` on an absolutely-positioned fixed-height box would override
   *  the CSS `bottom: 0` after a top→bottom flip. Re-applied on every
   *  position change. */
  setTopOffset(top: number): void {
    if (this.destroyed) return;
    this.topOffset = top;
    this.applyTopOffset();
  }

  private applyTopOffset(): void {
    this.bar.style.top = this.def.position === 'top' && this.topOffset > 0
      ? `${this.topOffset}px`
      : '';
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
    this.applyTopOffset();
    // Reserve on the new edge.
    this.reserveSpace();
  }

  /** Fan out a refresh() to every live panel instance. Tolerant: a
   *  panel that throws inside `refresh()` does NOT prevent siblings
   *  from refreshing.
   *
   *  Cycle 13 / Task 5 — the per-instance `refresh` is swapped at
   *  mount time with an rAF scheduler so panel-side calls collapse to
   *  one per frame. `host.refresh()` is the synchronous fan-out path
   *  callers reach for when they want every panel refreshed *now*
   *  (e.g. an integration test asserting on rendered text without
   *  waiting on a frame), so it bypasses the shim by invoking each
   *  slot's captured `originalRefresh` directly. */
  refresh(): void {
    if (this.destroyed) return;
    for (const slot of this.slots.values()) {
      if (!slot.instance || !slot.originalRefresh) continue;
      try { slot.originalRefresh(); } catch (e) { console.error(e); }
    }
  }

  /** Replace the panel set with a new def. Destroys every previously-
   *  mounted instance, swaps `statusPanels` + `position`, re-mounts. The
   *  reservation is re-emitted at the end so a position flip in the same
   *  call lands cleanly. */
  setStatusBarDef(def: StatusBarDef): void {
    if (this.destroyed) return;
    // Cancel any pending refresh — the slots they target are about to
    // be destroyed. Without this, a queued rAF flush could call
    // `originalRefresh()` against a torn-down panel.
    this.cancelPendingRefresh();
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
    this.applyTopOffset();
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
    this.cancelPendingRefresh();
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
    zone.className = `vg-status-bar-zone vg-status-bar-zone--${align}`;
    zone.dataset.zone = align;
    return zone;
  }

  /** Resolve + instantiate one panel def and mount it into the matching
   *  zone. Unknown component keys leave `slot.instance: null` so the def
   *  is still visible to `getInstance(key)` (returns `null`) and so
   *  Tasks 2/3 can fill in by registering ctors later.
   *
   *  Cycle 13 / Task 5 — after `init()` returns we swap the instance's
   *  `refresh` with the rAF scheduler. The original is captured first
   *  so `host.refresh()` and the rAF flush still drive the real work
   *  synchronously. `init()` itself runs through the registry BEFORE
   *  the swap, so any synchronous `this.refresh()` inside `init()`
   *  (built-in count + agg panels both do this to paint initial state)
   *  bypasses batching and renders immediately. */
  private mountPanel(def: StatusPanelDef): void {
    const align: StatusPanelAlign = def.align ?? 'right';
    const slot: PanelSlot = { def, align, instance: null, originalRefresh: null };
    this.slots.set(def.key, slot);
    const instance = this.ctx.registry.instantiate(def.statusPanel, {
      api: this.ctx.api,
      statusPanelParams: def.statusPanelParams,
    });
    if (!instance) return; // unknown component string — silent no-op
    slot.instance = instance;
    slot.originalRefresh = instance.refresh.bind(instance);
    instance.refresh = () => this.scheduleRefresh(slot);
    this.zones[align].appendChild(instance.getGui());
  }

  /** Cycle 13 / Task 5 — enqueue `slot` for the next rAF flush.
   *  Idempotent for already-pending slots (one entry per slot per
   *  frame). Schedules the rAF callback exactly once per frame; the
   *  same callback drains the whole pending set. When the host has
   *  been destroyed the call is a no-op. When `requestAnimationFrame`
   *  is missing (some Node-only test envs), we flush synchronously —
   *  matches the cell-flash loop's fallback in `velocityGrid.ts`. */
  private scheduleRefresh(slot: PanelSlot): void {
    if (this.destroyed) return;
    if (!slot.instance || !slot.originalRefresh) return;
    this.pendingSlots.add(slot);
    if (this.rafHandle !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.flushPending();
      return;
    }
    this.rafHandle = requestAnimationFrame(() => this.flushPending());
  }

  /** Cycle 13 / Task 5 — drain the pending set. Each slot's
   *  `originalRefresh` runs inside its own try/catch so a thrower
   *  panel does NOT block its neighbours' refresh. Safe to call
   *  manually from `cancelPendingRefresh` (the rAF handle is
   *  reset first so a re-entrant `scheduleRefresh` during the flush
   *  queues a fresh frame instead of being lost). */
  private flushPending(): void {
    this.rafHandle = null;
    if (this.destroyed) {
      this.pendingSlots.clear();
      return;
    }
    const slots = Array.from(this.pendingSlots);
    this.pendingSlots.clear();
    for (const slot of slots) {
      if (!slot.instance || !slot.originalRefresh) continue;
      try { slot.originalRefresh(); } catch (e) { console.error(e); }
    }
  }

  /** Cycle 13 / Task 5 — drop any queued flush. Called from
   *  `setStatusBarDef` (slots about to be torn down) and `destroy`. */
  private cancelPendingRefresh(): void {
    if (this.rafHandle !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafHandle);
      }
      this.rafHandle = null;
    }
    this.pendingSlots.clear();
  }

  private reserveSpace(): void {
    this.ctx.setReservedSpace(this.def.position, this.getReservedHeight());
  }
}

/** Cycle 21i Phase 2 — the intrinsic default status bar every grid
 *  shows unless the app opts out (`statusBar: false`) or supplies its
 *  own def. Canonical financial-blotter reading: row counts on the
 *  left, selection + range aggregates on the right. Returned fresh per
 *  call so hosts can't share/mutate one def object. */
export function defaultStatusBarDef(): StatusBarDef {
  return {
    statusPanels: [
      { key: 'agTotalAndFilteredRowCountComponent', statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
      { key: 'agSelectedRowCountComponent', statusPanel: 'agSelectedRowCountComponent', align: 'right' },
      { key: 'agAggregationComponent', statusPanel: 'agAggregationComponent', align: 'right' },
    ],
    position: 'bottom',
  };
}

/** Resolve `VelocityGridOptions.statusBar` (which accepts loose shapes —
 *  `boolean | StatusBarDef`) into a canonical `StatusBarDef`, or `null`
 *  when the option is off. Mirrors `normalizeSideBarOption`'s acceptance
 *  shape so apps that flip both surfaces feel consistent.
 *
 *  Cycle 21i Phase 2 — the status bar is intrinsic: `undefined` (and
 *  the `true` shorthand) resolve to `defaultStatusBarDef()` so every
 *  grid ships the bar by default; `false` is the explicit opt-out. */
export function normalizeStatusBarOption(
  opt: boolean | StatusBarDef | undefined,
): StatusBarDef | null {
  if (opt === false) return null;
  if (opt == null || opt === true) return defaultStatusBarDef();
  return opt;
}
