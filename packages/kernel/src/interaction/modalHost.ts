/**
 * Cycle 21i Phase 2 / T4 — ModalHost.
 *
 * The kernel's generic modal/dialog primitive: a backdrop + centered
 * dialog surface mounted on the grid root, themed entirely from
 * `tokens.css` vars. Purpose-scoped popup hosts existed (PopupHost =
 * cell-anchored editor positioning, FilterPopupHost = filter cards) but
 * nothing host-managed and modal — the Column Selector dialog (#18) and
 * the Settings Sheet chrome need one, and the recon flagged the gap.
 *
 * Behavior contract:
 *  - one modal at a time (opening while open replaces, closing the
 *    prior dialog with reason 'api')
 *  - focus trap: Tab/Shift+Tab cycle inside the dialog; focus enters
 *    the dialog on open and RESTORES to the previously-focused element
 *    on close
 *  - ESC + backdrop-click dismiss (both opt-out per open() call)
 *  - `prefers-reduced-motion` disables the entrance transition (CSS)
 *  - a11y: role="dialog", aria-modal, aria-label from `title`
 *
 * Content is caller-owned DOM — the host provides chrome (backdrop,
 * dialog card, optional title row + close button) and lifecycle only.
 */

export type ModalCloseReason = 'escape' | 'backdrop' | 'closeButton' | 'api' | 'destroy';

export interface ModalOpenOptions {
  /** Renders a header row with this title + a close (✕) button. No
   *  title → headerless dialog (content owns everything). */
  title?: string;
  /** Dialog width in CSS px. Default 480; CSS clamps to 90% of the
   *  grid width so small hosts never overflow. */
  width?: number;
  /** Default true — clicking the backdrop closes with reason 'backdrop'. */
  closeOnBackdrop?: boolean;
  /** Default true — ESC closes with reason 'escape'. */
  closeOnEscape?: boolean;
  /** Called exactly once when the modal closes, with the dismissal reason. */
  onClose?: (reason: ModalCloseReason) => void;
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Focusable descendants in DOCUMENT order. The explicit sort matters:
 *  happy-dom returns comma-list query matches in selector-list order,
 *  not document order, which would corrupt trap cycling under test. */
/** Page-level stack of OPEN hosts. Each host adds a document-capture
 *  keydown listener; without coordination, one Escape would close the
 *  modals of every grid on the page (stopPropagation cannot silence
 *  sibling listeners on the same node). Only the top of this stack —
 *  the most recently opened modal — handles keys. */
const openModalStack: ModalHost[] = [];

function focusablesIn(scope: Element): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
}

export class ModalHost {
  private readonly root: HTMLElement;
  private backdrop: HTMLDivElement | null = null;
  private dialog: HTMLDivElement | null = null;
  private onCloseCb: ((reason: ModalCloseReason) => void) | null = null;
  private closeOnEscape = true;
  private previousFocus: HTMLElement | null = null;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private destroyed = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.onKeyDown = (e) => this.handleKeyDown(e);
  }

  isOpen(): boolean {
    return this.dialog !== null;
  }

  /** The dialog card element while open (tests + advanced styling). */
  getDialogElement(): HTMLDivElement | null {
    return this.dialog;
  }

  /** Mount `content` in a centered dialog over a backdrop. An already-
   *  open modal is closed first (reason 'api'). */
  open(content: HTMLElement, options?: ModalOpenOptions): void {
    if (this.destroyed) return;
    if (this.dialog) this.close('api');

    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.onCloseCb = options?.onClose ?? null;
    this.closeOnEscape = options?.closeOnEscape !== false;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'cg-modal-backdrop';
    if (options?.closeOnBackdrop !== false) {
      this.backdrop.addEventListener('mousedown', (e) => {
        if (e.target === this.backdrop) this.close('backdrop');
      });
    }

    this.dialog = document.createElement('div');
    this.dialog.className = 'cg-modal';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.tabIndex = -1;
    if (options?.width !== undefined) this.dialog.style.width = `${options.width}px`;

    if (options?.title) {
      this.dialog.setAttribute('aria-label', options.title);
      const header = document.createElement('div');
      header.className = 'cg-modal-header';
      const title = document.createElement('div');
      title.className = 'cg-modal-title';
      title.textContent = options.title;
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'cg-modal-close';
      closeBtn.setAttribute('aria-label', 'Close dialog');
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => this.close('closeButton'));
      header.appendChild(title);
      header.appendChild(closeBtn);
      this.dialog.appendChild(header);
    }

    const body = document.createElement('div');
    body.className = 'cg-modal-body';
    body.appendChild(content);
    this.dialog.appendChild(body);

    this.backdrop.appendChild(this.dialog);
    this.root.appendChild(this.backdrop);
    openModalStack.push(this);
    // Trap at the document level (capture) so the trap holds even when
    // focus is on the dialog wrapper itself.
    document.addEventListener('keydown', this.onKeyDown, true);

    // Initial focus prefers the first CONTENT control — landing on the
    // header's ✕ button would make Enter-after-open dismiss the dialog.
    const first = focusablesIn(body)[0] ?? focusablesIn(this.dialog)[0];
    (first ?? this.dialog).focus();
  }

  close(reason: ModalCloseReason = 'api'): void {
    if (!this.dialog) return;
    const stackIndex = openModalStack.indexOf(this);
    if (stackIndex >= 0) openModalStack.splice(stackIndex, 1);
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.backdrop?.remove();
    this.backdrop = null;
    this.dialog = null;
    const cb = this.onCloseCb;
    this.onCloseCb = null;
    // Restore focus BEFORE the callback so onClose sees the final state.
    this.previousFocus?.focus?.();
    this.previousFocus = null;
    cb?.(reason);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.close('destroy');
    this.destroyed = true;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.dialog) return;
    // Only the topmost open modal on the page owns the keyboard.
    if (openModalStack[openModalStack.length - 1] !== this) return;
    if (e.key === 'Escape' && this.closeOnEscape) {
      e.stopPropagation();
      e.preventDefault();
      this.close('escape');
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = focusablesIn(this.dialog);
    if (focusables.length === 0) {
      // Nothing focusable inside — keep focus pinned on the dialog.
      e.preventDefault();
      this.dialog.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    // Cycle: Tab off the last wraps to the first; Shift+Tab off the
    // first wraps to the last; focus outside the dialog re-enters it.
    if (e.shiftKey && (active === first || !this.dialog.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !this.dialog.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
}
