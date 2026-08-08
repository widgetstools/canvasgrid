# Cycle 24 — Accessibility + keyboard — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 24
**FM coverage:** Area 20 — ~19 of 19 rows
**Depends on:** Cycle 23 (state events feed a11y announcements)

---

## Mental model: canvas can't be accessible without an a11y overlay

The grid paints to canvas. Canvas has no semantic structure — screen
readers see ONE element ("a canvas"). cgrid solves this with the
existing `A11yOverlay` (Cycle 3): a tightly-bounded DOM tree that
mirrors the visible viewport's semantic structure (grid → row →
cell) WITHOUT any visual chrome — `position: absolute; clip: rect(0,0,0,0)`.

Cycle 24 doesn't add a new overlay; it COMPLETES the existing one,
making sure every ag-grid ARIA / keyboard contract is satisfied.

```
Canvas (visual):              A11yOverlay (semantic):
┌─────────────────┐           <div role="grid"
│   header band   │             aria-rowcount=10000
│  ─────────────  │             aria-colcount=12>
│   data rows     │             <div role="row" aria-rowindex=23>
│                 │               <div role="gridcell"
│                 │                    aria-colindex=2>EMEA</div>
│                 │             </div>
└─────────────────┘           </div>
```

---

## Task 1 — Keyboard matrix completion

**Goal:** Every key combination ag-grid documents is wired.

**The matrix:**

| Key | Action |
|---|---|
| Arrow keys | Move focused cell |
| Tab | Next cell (wraps to next row at line end) |
| Shift+Tab | Previous cell |
| Home / End | First / last cell in row |
| Ctrl+Home / Ctrl+End | First / last cell in grid |
| PageUp / PageDown | Scroll one viewport up / down |
| Ctrl+Up / Ctrl+Down | First / last row in column |
| Enter | Edit (or commit + move down in edit mode) |
| F2 | Edit |
| ESC | Cancel edit |
| Space | Toggle row selection (row-select mode) |
| Shift+Space | Toggle row range from anchor |
| Ctrl+A | Select all rows |
| Ctrl+Space | Select column |
| Shift+arrow | Extend range |
| Ctrl+Shift+arrow | Extend range to data boundary |
| Ctrl+C/V/X | Copy / paste / cut (Cycle 10 — REUSE) |
| Alt+Down | Open filter / context menu where relevant |
| Type printable char | Start edit with that char (Cycle 5 — REUSE) |
| ArrowRight on group row | Expand group (Cycle 15 — REUSE) |
| ArrowLeft on group row | Collapse group |
| Enter / Space on group row | Toggle expand |

**File:** `interaction/features/keyPaging.ts` (extended),
`interaction/features/cellSelection.ts` (extended).

---

## Task 2 — `suppressKeyboardEvent` per column

**Goal:** Apps opt cells out of grid's key handling for specific
columns (e.g., a custom cell editor that wants Tab inside it).

```typescript
interface CColDef<TRow> {
  suppressKeyboardEvent?: (params: {
    event: KeyboardEvent;
    editing: boolean;
    node: RowNode<TRow>;
    column: Column<TRow>;
  }) => boolean;
}
```

When the callback returns `true`, grid skips its own handler for
that key — app handles it.

**File:** `interaction/featureChain.ts` (extended).

---

## Task 3 — A11y overlay completeness

**Goal:** Every ag-grid ARIA attribute is on the right element.

**Attributes (per element):**

| Element | Attributes |
|---|---|
| Grid root | `role="grid"`, `aria-rowcount`, `aria-colcount`, `aria-label`, `aria-busy` (during SSRM load) |
| Header row | `role="row"`, `aria-rowindex="1"` |
| Header cell | `role="columnheader"`, `aria-colindex`, `aria-sort` (`'ascending' \| 'descending' \| 'none'`), `aria-haspopup="menu"` if filter present, `aria-expanded` for column groups |
| Body row | `role="row"`, `aria-rowindex`, `aria-selected`, `aria-expanded` (group/tree), `aria-level` (depth) |
| Body cell | `role="gridcell"`, `aria-colindex`, `aria-selected` (range membership) |
| Editor | `role="textbox" / "spinbutton" / "combobox"` etc. |

**File:** `interaction/a11yOverlay.ts` (extended).

---

## Task 4 — Screen-reader announcements

**Goal:** State changes announce via an `aria-live` region.

**Hooked into Cycle 23's `stateUpdated`:** the a11y overlay subscribes
to state changes and emits human-readable text into a
`role="status"` live region:

| Trigger | Announcement |
|---|---|
| Sort change | "Sorted by Price ascending" |
| Filter change | "Filtered: 47 rows of 10,000" |
| Row selection | "1 row selected" / "12 rows selected" |
| Edit start | "Editing Price column, row 23" |
| Edit commit | "Price set to 42.5" |
| Edit cancel | "Edit cancelled" |
| Group expand | "Expanded EMEA, 47 child rows" |
| Group collapse | "Collapsed EMEA" |
| Page change (pagination) | "Page 3 of 50" |

Debounced 250 ms — prevents firehose during multi-changes.

---

## Task 5 — High-contrast theme

**Goal:** A `vg-theme-high-contrast` class with WCAG AAA contrast
ratios (≥ 7:1 for body text), thicker focus rings, no
semi-transparent fills.

**Token deltas vs. quartz:**

| Token | Quartz | High-contrast |
|---|---|---|
| `--vg-fg` | `#1a1f24` | `#000000` |
| `--vg-bg` | `#ffffff` | `#ffffff` |
| `--vg-grid-line-color` | `#eceff2` | `#000000` |
| `--vg-focus-ring-color` | `#2563eb` | `#0000ff` |
| `--vg-focus-ring-width` | `2px` | `3px` |
| `--vg-selection-bg` | `rgba(37,99,235,0.18)` | `#ffff00` |
| `--vg-selection-fg` | `inherit` | `#000000` |
| `--vg-range-selection-border-color` | `#2563eb` | `#000000` |

A dark-variant `vg-theme-high-contrast-dark` mirrors the same
contrast minimums against a `#000000` background.

---

## Task 6 — Focus management

**Goal:** Focus trapping when the grid is the focus owner; explicit
exit via `tabToNextHeader` / `tabToPreviousHeader` callbacks.

**Behaviour:**

- Default: focus stays inside the grid; Tab cycles cells.
- `VelocityGridOptions.tabToNextHeader: (params) => boolean | HeaderPosition`
  — at the LAST tabbable cell, when Tab is pressed, callback decides
  whether to wrap (return `true`), exit grid (return `false`), or
  move to a specific header (return `HeaderPosition`).
- Same for `tabToPreviousHeader` at the FIRST tabbable cell.

**File:** `interaction/features/keyPaging.ts` (extended).

---

## Task 7 — Reduced motion

**Goal:** `prefers-reduced-motion` disables:

- Row insertion / removal animations (Cycle 5).
- Cell flash overlay (`--vg-flash-from-color` → `transparent`).
- Scroll smoothing.
- Sparkline tooltip fade-in.

**CSS-only:**

```css
@media (prefers-reduced-motion: reduce) {
  .vg-host {
    --vg-flash-from-color: transparent;
    --vg-anim-duration: 0ms;
  }
}
```

Plus a guard at the flash painter: `if (flashFromColor === 'transparent') return`.

---

## Task 8 — axe-core CI gate

**Goal:** Automated a11y check in the E2E suite. Zero violations
required to merge.

**Implementation:** Add `@axe-core/playwright` to dev deps; add a
spec at `apps/cgrid-positions/e2e/a11y.spec.ts` that runs axe over
the demo page in default + grouped + edit states.

**File:** `apps/cgrid-positions/e2e/a11y.spec.ts` (new).

---

## Performance gates

- A11y overlay updates batched per frame (one DOM mutation pass
  per rAF).
- Keyboard handler ≤ 1 ms per key event.
- Live-region announcements debounced 250 ms.
- High-contrast theme paint cost ≤ default theme (no extra paint
  passes).

---

## Exit criteria recap

- FM Area 20 = 100 % ✅.
- axe-core E2E reports ZERO violations.
- Keyboard-only navigation demo: every Cycle 4–22 feature
  reachable without mouse.
- Screen-reader manual test (NVDA + VoiceOver) confirms
  announcements fire for sort / filter / selection / edit.
- `prefers-reduced-motion` users see no animations.
