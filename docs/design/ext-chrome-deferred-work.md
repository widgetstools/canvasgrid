# Ext chrome — deferred structural work

**Status:** open, not scheduled
**Date:** 2026-08-27
**Context:** the UX/UI review of the VelocityGrid ext chrome (CSRM + SSRM)

The review produced seven changes. Five shipped: the token layer
(`packages/ext/src/ui/chromeTokens.ts`), the single control height, the button
ladder, the colour-role separation, and the SSRM feed-state surface. Those were
all value-level or additive — no DOM restructuring, no behaviour removed.

Two did not ship, because both change behaviour and the brief was explicitly
"ensure no existing functionality, feature and behavior is lost". They are
written up here so the decision can be taken deliberately rather than
rediscovered.

Read them in this order: **item 2 is smaller than it looks and gates nothing**;
**item 1 is larger than it looks and should not start until its product
question is answered.**

---

## Where the chrome stands today

Measured live at 1680×1000 in `apps/velocitygrid-ext-demo`, both toolbars
visible, after the shipped wave:

| Band | Height | Owner |
|---|---|---|
| Title bar (`.vgext-titlebar`) | 45px | ext / `shell.ts` |
| Editing strip (`.vgext-edit-strip[data-toolbar="editing"]`) | 37px | ext / `ribbon.ts` |
| Formatting strip (`.vgext-edit-strip[data-toolbar="formatting"]`) | 37px | ext / `ribbon.ts` |
| Row-group panel (`.vg-row-group-panel`) | 32px | **kernel** |
| Column header | 40px | kernel |
| Floating filter row | 28px | kernel |
| **Total above the first data row** | **220px** | |
| Status bar | 29px | kernel |

Down from 248px + 29px before the token pass, entirely through the control
ladder. The remaining 72px of the original 100px target lives in item 1.

---

## Item 1 — collapse the two toolbar strips into one context strip

### What

Replace the two always-on 37px strips with **one 36px context strip** whose
content is chosen by what the user has selected:

- nothing selected → row-group drop target on the left, quiet affordances
  (`Format ▾`, `Edit ▾`) on the right
- cells selected → the formatting controls
- edit mode → the editing controls

Net: 220px → 148px above the first data row, and the row-group panel folds into
the same band instead of owning its own 32px.

### Why it is deferred

Three real behaviour changes, not one:

1. **Controls stop being permanently visible.** Today a user can see the
   formatting bar with no selection (dim, but present). Under the proposal it
   is not on screen until it can act. That is the point of the change, and it
   is also the thing a trader may object to — muscle memory targets a fixed
   pixel.
2. **The row-group panel is kernel-owned.** Folding it into an ext strip means
   either the ext reimplements the drop target (duplicating drag/drop and
   pivot behaviour) or the kernel grows an option to render it inline. Neither
   is a small change, and the second one crosses a package boundary.
3. **Toolbar visibility is not persisted.** `RibbonExtensionsOpts.editHidden` /
   `formatHidden` set the initial state only; the runtime toggle
   (`toggle-ribbon`) is per-mount. A context strip that swaps content needs a
   persisted notion of "what the user last chose to see", which does not exist
   yet.

### Current architecture

`packages/ext/src/toolbar/ribbon.ts`:

- Two `.vgext-edit-strip` elements built in the same render pass — `editStrip`
  (`data-toolbar="editing"`) and `formatting` (`data-toolbar="formatting"`).
- Each has its own close ✕ (`.vgext-es-close`, `data-tb="close-format"` and the
  editing equivalent) and its own overflow ⋯ (`data-tb="edit-overflow"` /
  `"format-overflow"`).
- Overflow is `wireRibbonOverflow({ track, items, button, maxRows: 1 })` — it
  measures `scrollWidth` and spills whole sections into a ⋯ menu by per-item
  `priority`. Two independent instances, one per strip.
- Visibility toggling is the `toggle-ribbon` ext event, handled in `ribbon.ts`;
  the menu entries live in `titleBar.ts` `settingsItem()` → `toggleEntry()`,
  which paints its checkmark by reading `[data-toolbar="…"].hidden` straight
  off the DOM.
- The formatting strip already carries `.vgext-es-hint`, which says
  *"Select cells to format"* when there is no selection. That hint is the seam
  the context strip grows out of — it already knows the selection state.

### Implementation sketch

Phase A — **make one strip able to host both payloads.** Extract the two
`formatBody` / `editBody` section arrays into named groups behind a small
registry keyed by mode. No visual change: still two strips, still both visible.

Phase B — **drive the mode from the selection.** `wireFormattingToolbar`'s sync
already computes `none` (no selection) and `target` ('cell' | 'header'). Lift
that into a `mode` signal the strip subscribes to. Still no visual change:
both strips render, one is marked active.

Phase C — **collapse to one strip.** One `wireRibbonOverflow` instance instead
of two. One ✕. One ⋯. `toggle-ribbon` keeps working but now toggles the whole
strip rather than a section, so the More menu entries change meaning —
decide whether they become one "Context strip" entry or stay two and switch
mode instead of visibility.

Phase D — **fold in the row-group panel.** Needs the kernel decision above.
Ship A–C without it if the answer is "not now"; the strip is still one band,
the row-group panel just stays as its own 32px.

### Blast radius

- `packages/ext/src/toolbar/ribbon.ts` — the bulk of it.
- `packages/ext/src/toolbar/ribbonOverflow.ts` — one instance, two payloads.
- `packages/ext/src/toolbar/titleBar.ts` — More menu entry semantics.
- `packages/ext/src/toolbar/formatMiniBar.ts` — also emits
  `toggle-ribbon`/`section: 'format'`; must follow whatever that event becomes.
- Tests: `ribbonOverflow.test.ts`, `ribbonTemplates.test.ts`,
  `ribbonFormatPicker.test.ts`, `ribbonColumnGroup.test.ts` couple to
  `data-toolbar` / `data-tb` hooks. Keep the attribute names through A–C so
  they survive; expect churn in C.

### Decide before starting

- Do the formatting controls disappear when nothing is selected, or dim in
  place as they do now? (This is the whole change. Everything else is
  mechanical.)
- Does the row-group panel move into the strip — i.e. does the kernel grow an
  inline-render option?
- Should the last-used strip mode persist into the profile?

### Acceptance

1. One band between the title bar and the column header, 36px, in both CSRM
   and SSRM.
2. Every control reachable today is still reachable — via the strip, the ⋯
   menu, or the Customize drawer. Enumerate them and check the list.
3. First data row at 148px (or 180px if the row-group panel stays out).
4. `toggle-ribbon` still hides the chrome for hosts that pass
   `editHidden`/`formatHidden`.

---

## Item 2 — collapse the three commit paths into one

### What

One dirty buffer per drawer session, committed once, from one place.

### Why it is deferred

It removes per-pane Save, which is a real affordance nine modules render today.
That is a product decision, not a refactor.

### What is actually there now

There are **three ways a change gets persisted**, and the middle one is
invisible:

1. **The module's own Save button.** Nine modules render one and commit
   immediately: `alerts.ts`, `bulkUpdate.ts`, `calculatedColumns.ts`,
   `columnSettings.ts`, `conditionalStyling.ts`, `dataChangeHistory.ts`,
   `plusMinus.ts`, `shortcuts.ts`, `smartEdit.ts`. Five build it with
   `actionButtonEnhanced('Save', 'save')`, four with a hand-rolled
   `saveBtn.innerHTML`.

2. **Navigating between modules — silent.** `shell.ts` `detachSheet({ commit:
   true })` runs the outgoing module's `commit()` on every tab switch. So
   editing Column Settings, clicking over to Styling, then pressing Esc has
   already persisted the Column Settings edit, without the user pressing Save
   and without anything saying so. Esc/X on the *live* module correctly drops
   its draft (`detachSheet({ commit: false })`) — the inconsistency is between
   the module you are looking at and the ones you have visited.

3. **The drawer footer.** `commitAndClose()` runs `this.live?.commit?.()` then
   `ctx.profiles.save()`, then `session.clear()`.

Every module implements the same one-liner:

```ts
commit() { if (isDirty()) save(); }
```

**The dirty buffer already exists, and is used as a counter.**
`DrawerSession` (`packages/ext/src/profiles/drawerSession.ts`) is a working
`Map<moduleId, patch>` with `stage`/`unstage`/`isDirty`/`pendingCount`/
`clear`/`onChange`. Its own class comment states the intended design:

> One dirty buffer for a Customize-drawer session. Modules `stage` instead of
> owning their own commit; the footer reads `isDirty` / `pendingCount`.

That is not what happens. `stage()` has exactly one caller —
`shell.ts:352`, inside the `delegateProfiles` override of `markDirty()` — and
it is called as `stage(id)` with **no patch**, so the map's value defaults to
`true`. Nothing ever reads a patch back out, and `unstage()` has no callers at
all. The buffer is a set of dirty module ids feeding the footer's count;
modules still write through to storage themselves.

That is why this is smaller than it looks: the buffer, the change notifications
and the footer counter are all built and working. What is missing is that
modules put their *patch* in it and that one place drains it.

### Implementation sketch

1. **Put the patch in the buffer.** Change each module's `save()` to
   `ctx.session.stage(moduleId, patch)` — the same call the shell already
   makes, but carrying the change instead of a bare flag — instead of writing
   through to storage. Nine mechanical edits against an identical shape.
2. **Flush on commit, not on navigation.** `commitAndClose()` walks every
   staged module id and applies its patch. `detachSheet({ commit: true })`
   stops committing — the draft stays staged instead, which is what makes
   tab-switching non-destructive.
3. **Retire the per-pane buttons.** Delete the nine Save/Reset pairs; the
   footer's `Discard` / `Done` become the only commit surface. Keep
   `actionButtonEnhanced` / `resetButtonEnhanced` exported — other panes use
   them for non-save actions.
4. **Make the footer a live status line.** It already renders
   `N unsaved changes` with an accent dot (shipped). Extend it to name *which*
   panels are pending, so a user can find them: the rail dot in the review's
   Panel board.
5. **Delete the footer hint sentence.** Once there is one save model, the
   explanatory `Esc · close` line stops earning its place.

### Blast radius

- Nine module files, one shape each.
- `packages/ext/src/shell/shell.ts` — `detachSheet`, `commitAndClose`,
  `discardAndClose`, footer, and the `markDirty` delegation at :352.
- `packages/ext/src/profiles/drawerSession.ts` — unchanged as a class; its
  patch value stops being a placeholder. `configSession.ts` stays the
  persistence layer underneath and does not move.
- Tests: `drawerSession.test.ts`, `configSession.test.ts`,
  `editingSettings.test.ts`, `dataChangeHistory.test.ts`, `alerts.test.ts`
  assert Done-commits-through-the-handle semantics. Four of those tests were
  failing when this review started and have since been fixed (see below), so
  they are now live coverage of exactly the behaviour item 2 changes — expect
  them to need updating, and read them first.
- Ext suite baseline as of this document: **741 passed / 0 failed**.

### Decide before starting

- Does per-pane Save go away entirely, or stay as a "commit just this pane"
  shortcut alongside the session commit? (Keeping both is the status quo with
  extra steps; the review's position is that it should go.)
- Should navigating away from a dirty pane warn, or silently keep the draft
  staged? (Staged-and-silent is the proposal.)
- What happens to a staged pane when the drawer is closed with Esc — dropped,
  or kept for the next open?

### Acceptance

1. Exactly one Save affordance is visible at any time in the drawer.
2. Editing a pane, navigating away, and pressing Esc persists **nothing**.
3. Editing three panes and pressing Done persists **all three**.
4. The footer names the pending panes and the rail marks them.
5. `stage()` is called with a real patch, and `unstage()` has callers —
   i.e. `DrawerSession` is a buffer, not a counter.

---

## Sequencing

| | Item 2 (save model) | Item 1 (chrome) |
|---|---|---|
| Gated on | a product decision only | a product decision **and** a kernel decision |
| Size | ~9 mechanical edits + shell | a rewrite of `ribbon.ts` |
| Risk | medium — commit semantics | high — layout, overflow, tests |
| Independent? | yes | yes |

They do not depend on each other and can be taken in either order. Item 2 is
the better first move: it is bounded, the infrastructure already exists, and
it removes a silent-persistence behaviour that is arguably a bug today.

Neither is blocked by anything in the shipped wave — the token layer, control
ladder and button ladder are all invariant under both.
