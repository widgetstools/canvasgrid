export interface A11yState {
  visibleRowCount: number;
  columnCount: number;
  focusedRowIndex: number | null;
  focusedColId: string | null;
  focusedRowData: { colId: string; valueFormatted: string }[];
  /** Expanded state of the focused row when it is a group row:
   *  `true` / `false` set `aria-expanded` on the row; `null` removes the
   *  attribute (the focused row is a leaf / data row). AG Grid parity —
   *  every group row exposes `aria-expanded` to assistive tech. */
  groupExpanded: boolean | null;
  /** Cycle 24 / Task 3 — `aria-label` for the grid root. Screen
   *  readers read this as the grid's name. Omitted when the app
   *  doesn't supply one (no `aria-label` attribute set). */
  ariaLabel?: string;
  /** Cycle 24 / Task 3 — `aria-busy` for the grid root. `true` when
   *  the grid is loading (SSRM cache miss, async rebuild, etc.).
   *  Defaults to `false`. */
  ariaBusy?: boolean;
}

const HIDDEN_STYLE =
  'position:absolute; left:0; top:0; clip:rect(0 0 0 0); width:1px; height:1px; overflow:hidden;';

export class A11yOverlay {
  private grid: HTMLDivElement;
  private row: HTMLDivElement;
  /** Cycle 24 / Task 4 — shared `role="status"` aria-live region for
   *  screen-reader announcements. Lives in the same hidden overlay so
   *  it inherits the off-screen positioning. Only mounted once per
   *  grid — `announce(text)` updates `textContent` and the OS reads
   *  it. */
  private liveRegion: HTMLDivElement;
  /** Cycle 24 / Task 4 — debounce handle for the live region. Multiple
   *  announce() calls within 250ms collapse into the last one so a
   *  multi-change cascade (e.g. setState restoring 5 keys at once)
   *  produces ONE announcement, not five. */
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingAnnouncement: string | null = null;

  constructor(private container: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'vg-a11y-root';
    root.style.cssText = HIDDEN_STYLE;
    const grid = document.createElement('div');
    grid.setAttribute('role', 'grid');
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    grid.appendChild(row);
    root.appendChild(grid);
    // Cycle 24 / Task 4 — live region as a sibling of the grid so
    // screen readers don't confuse the announcement with grid
    // structure. `polite` is the default; apps that need to
    // interrupt the screen reader can override at the OS level.
    const live = document.createElement('div');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(live);
    container.appendChild(root);
    this.grid = grid;
    this.row = row;
    this.liveRegion = live;
  }

  update(state: A11yState): void {
    this.grid.setAttribute('aria-rowcount', String(state.visibleRowCount));
    this.grid.setAttribute('aria-colcount', String(state.columnCount));
    // Cycle 24 / Task 3 — aria-label is optional. Removing when unset
    // matches AG Grid behaviour: screen readers fall back to "grid"
    // when no name is supplied.
    if (state.ariaLabel !== undefined && state.ariaLabel !== '') {
      this.grid.setAttribute('aria-label', state.ariaLabel);
    } else {
      this.grid.removeAttribute('aria-label');
    }
    // Cycle 24 / Task 3 — aria-busy. Always present so assistive
    // tech reading it knows the grid's load state explicitly
    // (defaulting to "false" rather than omitted is the canonical
    // recommendation for live regions).
    this.grid.setAttribute('aria-busy', state.ariaBusy ? 'true' : 'false');
    if (state.focusedRowIndex !== null) {
      this.row.setAttribute('aria-rowindex', String(state.focusedRowIndex + 1));
    }
    // Group rows expose aria-expanded; leaf rows must not carry the
    // attribute at all (AG Grid parity — screen readers announce
    // "collapsed"/"expanded" only on rows that are actually toggleable).
    if (state.groupExpanded === null) {
      this.row.removeAttribute('aria-expanded');
    } else {
      this.row.setAttribute('aria-expanded', state.groupExpanded ? 'true' : 'false');
    }
    // Clear + rebuild focused row's cells
    while (this.row.firstChild) this.row.removeChild(this.row.firstChild);
    // Cycle 24 / Task 3 — an empty `role="row"` violates the ARIA
    // required-children rule (axe-core reports it as a critical
    // violation). Strip the role when there are no cells to host;
    // re-apply it whenever cell data arrives.
    if (state.focusedRowData.length === 0) {
      this.row.removeAttribute('role');
    } else {
      this.row.setAttribute('role', 'row');
    }
    state.focusedRowData.forEach((cell, i) => {
      const c = document.createElement('div');
      c.setAttribute('role', 'gridcell');
      c.setAttribute('aria-colindex', String(i + 1));
      c.setAttribute('aria-label', `${cell.colId}: ${cell.valueFormatted}`);
      c.tabIndex = -1;
      this.row.appendChild(c);
    });
  }

  /** Cycle 24 / Task 4 — queue a screen-reader announcement. Debounced
   *  250ms so a cascade of state changes (e.g. setState restoring 5
   *  keys at once) produces ONE announcement, not a firehose. The
   *  most recent message wins; intermediate messages are dropped. */
  announce(message: string): void {
    this.pendingAnnouncement = message;
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => {
      this.announceTimer = null;
      if (this.pendingAnnouncement !== null) {
        this.liveRegion.textContent = this.pendingAnnouncement;
        this.pendingAnnouncement = null;
      }
    }, 250);
  }

  /** Cycle 24 / Task 4 — synchronous announce for cases where the
   *  caller wants the live region to update RIGHT NOW (test
   *  introspection, explicit `flush` after state restore). Bypasses
   *  the debounce. */
  announceNow(message: string): void {
    if (this.announceTimer !== null) {
      clearTimeout(this.announceTimer);
      this.announceTimer = null;
    }
    this.pendingAnnouncement = null;
    this.liveRegion.textContent = message;
  }

  destroy(): void {
    if (this.announceTimer !== null) {
      clearTimeout(this.announceTimer);
      this.announceTimer = null;
    }
    const root = this.grid.parentElement;
    if (root && root.parentElement) root.parentElement.removeChild(root);
  }
}
