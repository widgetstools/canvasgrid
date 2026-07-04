/**
 * Cycle 21i Phase 2 / T1 — ToolbarHost.
 *
 * Mounts a horizontal DOM strip at the VERY top of the grid — above the
 * top status bar, pivot panel, row group panel, and column headers. The
 * toolbar is an intrinsic part of every cgrid instance: it mounts by
 * default and apps opt OUT via `toolbar: false`. It is plain DOM chrome
 * contained in the grid root — NOT a canvas element and NOT part of the
 * column/subgrid infrastructure.
 *
 * The host mirrors `RowGroupPanelHost` / `StatusBarHost` in shape: a
 * thin context object reports the reserved top inset back to the grid
 * (`setReservedSpace('top', height)`) so the scroller + editor overlay +
 * canvas + sibling strips all shift down in lock-step, and fans typed
 * events (`toolbarSave` / `toolbarDateChanged`) into the grid's event
 * bus without importing `CGrid` directly.
 *
 * Layout: [ start zone — app content ] ←flex→ [ end zone — intrinsic ]
 * The end zone ships two intrinsic controls pinned to the right edge:
 * a business-date picker (native `input[type=date]`, defaults to today)
 * and a save icon button. Apps subscribe via `onSave` / `onDateChange`
 * (or the typed grid events) and populate the start zone through
 * `addButton` / `addIconButton` / `addDivider` / `addSpacer` /
 * `addContent`.
 *
 * Design: docs/superpowers/specs/2026-07-04-cycle-21i-phase2-design.md §T1.
 */

import type { CGridEvent } from '../../types/event';
import { lucideBundle } from '../../icons/lucide.generated';

/** Fallback strip height in CSS px when the DOM cannot be measured
 *  (jsdom) and no `toolbarHeight` option is set. Mirrors the
 *  `.cg-toolbar { --cg-toolbar-height }` default in `tokens.css`. */
const DEFAULT_HEIGHT = 40;

/** Context handed to ToolbarHost by CGrid (or a test harness). Keeps
 *  the host framework-agnostic — it reports its reserved inset and
 *  emits typed events without importing CGrid. */
export interface ToolbarGridContext {
  /** Called on mount / unmount / height or visibility change.
   *  `height === 0` means the strip is hidden — the grid releases the
   *  reservation. */
  setReservedSpace(side: 'top', height: number): void;
  /** Fan toolbar lifecycle events into the grid's typed emitter. */
  emit(event: CGridEvent): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build an inline SVG icon from a Lucide d-string (same source set as
 *  the canvas Path2D icons — one icon vocabulary across the grid). */
function lucideSvg(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'cg-toolbar-ic');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', lucideBundle[name] ?? '');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

/** Today as `YYYY-MM-DD` in local time (the `input[type=date]` value
 *  format). */
function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export class ToolbarHost {
  private readonly root: HTMLElement;
  private readonly ctx: ToolbarGridContext;
  /** The host element (`.cg-toolbar`) appended to the grid root. */
  private readonly bar: HTMLDivElement;
  private readonly startZone: HTMLDivElement;
  private readonly endZone: HTMLDivElement;
  private readonly dateInput: HTMLInputElement;
  private readonly saveButton: HTMLButtonElement;

  /** Explicit height from `CGridOptions.toolbarHeight`; `null` defers
   *  to the CSS token (`--cg-toolbar-height`, 40px). */
  private explicitHeight: number | null;
  private visible = true;
  private destroyed = false;

  private readonly saveHandlers: Array<() => void> = [];
  private readonly dateHandlers: Array<(isoDate: string) => void> = [];

  constructor(
    root: HTMLElement,
    ctx: ToolbarGridContext,
    opts?: { height?: number },
  ) {
    this.root = root;
    this.ctx = ctx;
    this.explicitHeight = opts?.height ?? null;

    this.bar = document.createElement('div');
    this.bar.className = 'cg-toolbar';
    if (this.explicitHeight !== null) {
      this.bar.style.height = `${this.explicitHeight}px`;
    }

    // Start zone — app-added controls flow left-to-right.
    this.startZone = document.createElement('div');
    this.startZone.className = 'cg-toolbar-start';
    this.bar.appendChild(this.startZone);

    // End zone — intrinsic controls pinned to the right edge.
    this.endZone = document.createElement('div');
    this.endZone.className = 'cg-toolbar-end';
    this.bar.appendChild(this.endZone);

    // Intrinsic business-date picker. The native calendar popup follows
    // the theme root's `color-scheme`, so it renders dark under
    // `cg-theme-quartz-dark` with no extra plumbing.
    this.dateInput = document.createElement('input');
    this.dateInput.type = 'date';
    this.dateInput.className = 'cg-toolbar-date';
    this.dateInput.title = 'Business date';
    this.dateInput.setAttribute('aria-label', 'Business date');
    this.dateInput.value = todayIso();
    this.dateInput.addEventListener('change', () => {
      const date = this.dateInput.value;
      for (const handler of this.dateHandlers) handler(date);
      this.ctx.emit({ type: 'toolbarDateChanged', date });
    });
    this.endZone.appendChild(this.dateInput);

    // Intrinsic save icon button.
    this.saveButton = document.createElement('button');
    this.saveButton.type = 'button';
    this.saveButton.className = 'cg-toolbar-icon-button cg-toolbar-save';
    this.saveButton.title = 'Save';
    this.saveButton.setAttribute('aria-label', 'Save');
    this.saveButton.appendChild(lucideSvg('save'));
    this.saveButton.addEventListener('click', () => {
      for (const handler of this.saveHandlers) handler();
      this.ctx.emit({ type: 'toolbarSave', date: this.dateInput.value });
    });
    this.endZone.appendChild(this.saveButton);

    this.root.appendChild(this.bar);
    // Construction-time reservation uses the configured height directly —
    // measuring here (getBoundingClientRect) would force a synchronous
    // layout mid-CGrid-construction, once per grid, interleaved with the
    // status bar / panel mounts that follow. Post-construction changes
    // (updateHeight / setVisible / CSS token overrides picked up on the
    // next reservation) go through the measuring path.
    this.ctx.setReservedSpace('top', this.explicitHeight ?? DEFAULT_HEIGHT);
  }

  /** Resolved strip height in CSS px when visible; `0` when hidden.
   *  Measures the DOM (so a CSS override of `--cg-toolbar-height` is
   *  honored) and falls back to the explicit option / 40px default in
   *  non-layout environments (jsdom). */
  getReservedHeight(): number {
    if (!this.isVisible()) return 0;
    const measured = Math.ceil(this.bar.getBoundingClientRect().height);
    if (measured > 0) return measured;
    return this.explicitHeight ?? DEFAULT_HEIGHT;
  }

  isVisible(): boolean {
    return !this.destroyed && this.visible;
  }

  /** Show or hide the strip. Hiding releases the top inset so the grid
   *  body reclaims the space. */
  setVisible(visible: boolean): void {
    if (this.destroyed || this.visible === visible) return;
    this.visible = visible;
    this.bar.style.display = visible ? '' : 'none';
    this.reportReservation();
  }

  /** Update the strip height (runtime `toolbarHeight` flips route
   *  here). `undefined` reverts to the CSS token default. */
  updateHeight(height: number | undefined): void {
    if (this.destroyed) return;
    this.explicitHeight = height ?? null;
    this.bar.style.height = height !== undefined ? `${height}px` : '';
    this.reportReservation();
  }

  // ── Intrinsic-control subscriptions ────────────────────────────────

  /** Subscribe to the intrinsic save button. Multiple handlers allowed;
   *  the typed `toolbarSave` grid event fires alongside. */
  onSave(handler: () => void): void {
    this.saveHandlers.push(handler);
  }

  /** Subscribe to the intrinsic date picker. Handler receives the ISO
   *  `YYYY-MM-DD` value; the typed `toolbarDateChanged` grid event
   *  fires alongside. */
  onDateChange(handler: (isoDate: string) => void): void {
    this.dateHandlers.push(handler);
  }

  /** Current value of the intrinsic date picker (`YYYY-MM-DD`). */
  getDate(): string {
    return this.dateInput.value;
  }

  /** Set the intrinsic date picker value (`YYYY-MM-DD`). Does NOT fire
   *  `onDateChange` — programmatic writes are the caller's own news. */
  setDate(isoDate: string): void {
    this.dateInput.value = isoDate;
  }

  // ── Start-zone builders (app content) ──────────────────────────────

  /** Add a text button to the start zone. */
  addButton(
    label: string,
    onClick: () => void,
    options?: { title?: string; className?: string },
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'cg-toolbar-button';
    if (options?.className) button.classList.add(options.className);
    if (options?.title) button.title = options.title;
    button.addEventListener('click', onClick);
    this.startZone.appendChild(button);
    return button;
  }

  /** Add an icon button to the start zone. `icon` is a Lucide icon
   *  name (same set as the canvas icons) or a ready-made SVG element. */
  addIconButton(
    icon: string | SVGSVGElement,
    onClick: () => void,
    options?: { title?: string; className?: string },
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cg-toolbar-icon-button';
    if (options?.className) button.classList.add(options.className);
    if (options?.title) {
      button.title = options.title;
      button.setAttribute('aria-label', options.title);
    }
    button.appendChild(typeof icon === 'string' ? lucideSvg(icon) : icon);
    button.addEventListener('click', onClick);
    this.startZone.appendChild(button);
    return button;
  }

  /** Add a vertical divider line to the start zone. */
  addDivider(): HTMLDivElement {
    const divider = document.createElement('div');
    divider.className = 'cg-toolbar-divider';
    this.startZone.appendChild(divider);
    return divider;
  }

  /** Add a flexible spacer to the start zone (pushes later start-zone
   *  items toward the intrinsic controls). */
  addSpacer(): HTMLDivElement {
    const spacer = document.createElement('div');
    spacer.className = 'cg-toolbar-spacer';
    this.startZone.appendChild(spacer);
    return spacer;
  }

  /** Add custom HTML content to the start zone. */
  addContent(html: string): HTMLDivElement {
    const content = document.createElement('div');
    content.className = 'cg-toolbar-content';
    content.innerHTML = html;
    this.startZone.appendChild(content);
    return content;
  }

  /** Clear app-added start-zone content. Intrinsic end-zone controls
   *  are not affected. */
  clear(): void {
    this.startZone.replaceChildren();
  }

  /** The strip element — exposed for tests + advanced positioning. */
  getElement(): HTMLDivElement {
    return this.bar;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Release the inset first (canvas-destroy-safe on the grid side,
    // same contract as the side / status bars), then drop the DOM.
    this.ctx.setReservedSpace('top', 0);
    this.bar.remove();
    this.saveHandlers.length = 0;
    this.dateHandlers.length = 0;
  }

  private reportReservation(): void {
    this.ctx.setReservedSpace('top', this.getReservedHeight());
  }
}
