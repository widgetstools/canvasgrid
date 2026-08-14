# Handoff: canvasgrid chrome design system

## Overview

The canvasgrid chrome (settings drawer, cockpit editors, DataProvider editor, kernel
tool panels) is built from three UI kits that were written at different times against
three separate stylesheets and never reconciled. This handoff unifies them onto one
token layer, one row grammar, one button ladder and one chip, and retargets the whole
surface at the two Cursor themes already present in `tokens.css`.

This is a **refactor of existing files**, not a new feature. No new screens are added
and no functionality is removed. The bundled HTML files are design references showing
the target state; the work is applying the changes below to the real TypeScript.

## About the design files

`Grid UI Design Review.dc.html` and `Migration Plan.dc.html` are **design references
created in HTML** — prototypes showing the intended look, not production code to copy.
They are self-contained: open either directly in a browser (`support.js` must sit
beside them).

- **Design Review** — the eleven-item audit, the system spec, and before/after
  recreations of two screens.
- **Migration Plan** — the six implementation steps with diffs, this README's companion.

Do not port the HTML. Apply the values and structure to the existing `.ts` files.

## Fidelity

**High-fidelity.** Colors, type, spacing and geometry below are final and exact.
Recreate them precisely. Every value is either lifted verbatim from the repo
(`tokens.css`, `lucide.generated.ts`, `conditionalStyling.ts`) or specified here.

---

## Target themes

Both already exist in `packages/kernel/src/theming/tokens.css`. Do not add a third.

### `.vg-theme-cursor` (Cursor Default Light Modern)

| Token | Value | Role |
|---|---|---|
| `--vg-bg-color` | `#FFFFFF` | data plane |
| `--vg-header-bg` | `#F8F8F8` | chrome |
| `--vg-fg-color` | `#3B3B3B` | text |
| `--vg-border-color` | `#E5E5E5` | pane line |
| `--vg-chrome-accent` | `#2778C1` | accent |
| `--vg-input-bg` / `--vg-input-border` | `#FFFFFF` / `#CECECE` | inputs |
| `--vg-row-hover-bg` | `#F2F2F2` | hover |
| `--vg-row-selected-bg` | `#E8E8E8` | selection |

### `.vg-theme-cursor-dark` (Cursor Default Dark Modern)

| Token | Value | Role |
|---|---|---|
| `--vg-bg-color` | `#1F1F1F` | data plane |
| `--vg-header-bg` | `#181818` | chrome |
| `--vg-fg-color` | `#CCCCCC` | text |
| `--vg-border-color` | `#2B2B2B` | pane line |
| `--vg-chrome-accent` | `#81A1C1` | accent |
| `--vg-input-bg` / `--vg-input-border` | `#313131` / `#3C3C3C` | inputs |
| `--vg-row-hover-bg` | `#2A2D2E` | hover |
| `--vg-row-selected-bg` | `#37373D` | selection |

**Rule:** no kit declares its own accent. `--ckp-accent`, `--cgc-accent` and
`--vg-settings-accent` become aliases of `--vg-chrome-accent`, never independent values.

---

## Design tokens

### Type — three roles only

| Role | Spec | Used for |
|---|---|---|
| Body | `13px / 400 / 1.4` Inter | control text, help |
| Label | `12.5px / 500` Inter | row labels |
| Eyebrow | `11px / 600 / 0.1em` uppercase Inter | section heads |
| Numeric | `11.5px` JetBrains Mono | ids, counts, hex, measurements |

Replaces five different uppercase micro-label specs currently in use
(10px/650/0.14em, 11px/650/0.08em, 11px/600/0.08em, 10.5px/650/0.12em,
11px/650/0.06em).

**Help text is sentence case.** Never uppercase, never letterspaced.

### Metrics — 4px grid

| Token | Value |
|---|---|
| Control height | `28px` |
| Dense list row | `30px` |
| Section head | `26px` |
| Icon tile | `30px`, `4px` gap, `box-sizing: border-box` |
| Chip height | `20–22px` |
| Panel gutter | `12px` (side panel) / `16–18px` (sheet) |
| Radius | `2px` everywhere |

`--vg-radius` is `2px` in both Cursor themes. Update the kernel fallbacks that
currently read `var(--vg-radius, 6px)` (`.vg-columns-panel-row`) and
`var(--vg-radius, 3px)` (`.vg-filters-panel-row-editor`) to `2px`.

### State — one vocabulary everywhere

| State | Treatment |
|---|---|
| Hover | `--vg-row-hover-bg` |
| Selected | `color-mix(in srgb, var(--vg-chrome-accent) 14%, transparent)` + `2px` accent edge |
| Focus | `2px solid var(--vg-chrome-accent)` outline, `-2px` offset |
| Modified | `2px` accent tick in a dedicated `10–12px` left gutter (never overlapping text) |
| Disabled | `45%` opacity, no fill |

---

## Components

### 1. Settings row — the core primitive

Every settings screen is a list of these. One grammar, everywhere.

```
grid-template-columns: <label-col> 1fr;
padding: 9–10px 16px;
border-bottom: 1px solid <faint>;
box-shadow: inset 2px 0 0 <accent>;   /* only when modified */
```

- **Left column** — label (`12.5px/500`) with help (`11px/1.45`, muted) stacked
  *underneath the label*, `padding-left: 10px` to clear the modified tick.
- **Right column** — control, `min-height: 28px`, left-aligned so the control column
  forms one clean vertical edge.

Label column width: `210px` (cockpit), `260px` (DataProvider editor).

**Why help goes under the label:** long help currently sits under the control and
pushes the next control down, breaking the column edge. This is the single highest-value
structural change.

### 2. Button ladder — four rungs, no more

| Rung | Style | Use |
|---|---|---|
| Primary | `background: <accent>; color: <accent-fg>; border: 1px solid <accent>; font-weight: 600` | One per screen. The commit. |
| Secondary | `background: transparent; border: 1px solid <border2>; color: <fg>` | Real actions, no risk. |
| Quiet | `background: transparent; border: 1px solid transparent; color: <fg80>` | Dismiss and navigation only. |
| Destructive | `background: transparent; border: 1px solid <neg-ring>; color: <neg>` | Always confirms. |

All `height: 28px; padding: 0 13px; border-radius: 2px; font-size: 12px`.

Today `EXPORT JSON`, `IMPORT JSON` and `CLEAR ALL COLUMNS` render identically — same
size, weight, color, no border. One of them discards 131 column definitions. It becomes
Destructive.

### 3. Status chip — one shape, semantic color

Two-part chip: muted key on `<subtle>`, value on a tinted ground.
`height: 20–22px; border-radius: 2px; font-family: JetBrains Mono; font-size: 10–10.5px`.

| Color | Meaning |
|---|---|
| Green (`--vg-pos-color`) | healthy, running, applied |
| Amber (`--vg-warning`) | degraded, stale, needs attention |
| Red (`--vg-neg-color`) | failing, invalid |
| Neutral (`border2`) | plain metadata, no judgement |

Today four border colors encode nothing consistent — amber is a warning on `APPLIED`
and an identifier on `COLUMN ID`.

**A chip is read-only.** It must never appear above a control that sets the same value.
Styling Rules currently shows `STATUS ACTIVE` / `SCOPE ROW` / `PRIORITY 0` as chips,
then renders a Status toggle, a Scope select and a Priority input for the same three
values 40px below. Delete the duplicate controls; the chips become the display and the
controls move into the rule header once.

### 4. Segmented control — for every pick-one of 2–4

```
height: 28px; border: 1px solid <border>; border-radius: 2px; overflow: hidden;
/* selected */ background: <accent 14%>; box-shadow: inset 0 -2px 0 <accent>;
```

5+ options becomes a `<select>`. **Never a button that opens a menu** — that is what
`POSITION` does today while its siblings `TARGET` and `MODE` are segmented.

### 5. Boolean — checkbox only

The pill toggle retires. Use the kernel's canonical `.vg-checkbox`:
`16px`, `2px` radius, `1.5px` border, accent fill when checked, centered check
(`5×9px`, `0 2px 2px 0` border, `translate(-50%,-58%) rotate(45deg)`), centered
`8×2px` dash when indeterminate.

Currently pill toggles for Public / Throttle updates / Conflate updates / Flash /
Status, and checkboxes for Select all and field rows — same data type, two shapes.

### 6. Section head

```
height: 26px; padding: 0 16px; background: <subtle>;
border-bottom: 1px solid <border>;
chevron 10px + label 10.5px/600/0.1em uppercase
```

**No ordinal numbers.** Styling Rules currently runs `01 EXPRESSION` → `03 STYLE` →
`07 FLASH ON MATCH` → `08 INDICATOR` because sections are conditional, so four numbers
are always missing. Calculated Columns numbers `01`–`03` with no gaps, so the two
editors disagree with each other as well.

### 7. Icon tile

`30px × 30px`, `box-sizing: border-box`, `1px` border, `2px` radius, `4px` gap,
`14px` glyph. Selected = accent fill with `accent-fg` stroke.

Down from `44px`, which lets all six categories fit in the space one used to take.

### 8. Color field

Single component: `26px` swatch + mono hex + clear, inside a `28px` bordered box.
Opens a curated palette first, full picker behind a disclosure.

---

## Interactions & behavior

- **Navigation** — one model per surface. Today: plain uppercase text tabs
  (DataProvider editor), boxed dropdown triggers with chevrons (Customize drawer),
  and a left list rail (cockpit). Pick one per surface and mark the active item with a
  `2px` accent edge, not color alone.
- **Empty states** — one treatment. Today: icon + heading + body + inline control +
  button (Fields), one line of grey text (Styling Rules), nothing at all (Calculated
  Columns).
- **Save** — see step 6 below. This is the one behavioral change.
- **Transitions** — `120ms ease` on background/border/color. Respect
  `prefers-reduced-motion` as the existing shell already does.

---

## Implementation steps

Full diffs are in `Migration Plan.dc.html`. Summary:

### Step 1 — retarget the shared accent token (1 line, low risk)

`packages/kernel/src/ui/primitives.ts`, `VGUI_DEFAULT_TOKENS`:

```diff
- accent: 'var(--vg-accent-color, #4f9cf9)',
+ accent: 'var(--vg-chrome-accent, var(--vg-focus-ring-color))',
```

This is the root of the whole accent problem. Every generator falls back to this set.

### Step 2 — purge the `#4f9cf9` fallbacks (~40 sites, low risk)

`packages/ext/src/shell/shell.ts` (`SHELL_CSS`),
`packages/ext/src/ui/cockpit.ts`,
`packages/customizer/src/styles.ts`.

Mechanical replace of `var(--vg-accent-color, #4f9cf9)` → `var(--vg-chrome-accent)`.
Convert `--ckp-accent`, `--cgc-accent`, `--vg-settings-accent` from declarations to
aliases. Fix the kernel radius fallbacks in the same pass.

### Step 3 — widen `primitives.ts` (~1 day, low risk)

Add `vguiRowCss`, `vguiButtonCss`, `vguiChipCss`, `vguiTileCss` following the existing
signature convention exactly: caller supplies class names, generator supplies values.
Additive; nothing changes until consumed.

### Step 4 — change the cockpit builders, not the modules (~2 days, medium risk)

`packages/ext/src/ui/cockpit.ts`. `row()`, `band()`, `switchToggle()`, `pillGroup()`,
`chip()` and `iconTile()` are called by every settings module — editing them updates
Column Settings, Calculated Columns, Styling Rules, Bulk Update and Smart Edit at once.

- `row(label, control, help?)` — help under the label
- `switchToggle()` → `checkbox()` (keep a deprecated alias one cycle)
- `band(title)` — drop the `num` argument; compiler-guided sweep of call sites

### Step 5 — icon catalog and the odd control out (~2 hours, low risk)

`packages/ext/src/modules/conditionalStyling.ts`.

`ICON_GROUPS` names three icons that **do not exist** in the generated bundle:
`circle-dot`, `circle`, `target`. They are pure `<circle>` elements and
`build-lucide.ts` keeps only `<path>` data, so `lucideSvg()` returns `''` and the picker
paints three empty buttons. The same extraction degrades `circle-check`, `circle-x`,
`circle-alert` and `clock` to a bare tick, cross, dot and pair of hands.

**Preferred fix:** teach `packages/kernel/src/icons/build-lucide.ts` to emit
`<circle>` / `<line>` / `<rect>` geometry. That fixes the blank tiles and the four
degraded glyphs together.
**Cheap fix:** drop the three names from `ICON_GROUPS`.

Also in this file: `POSITION` becomes a `pillGroup()` like `TARGET` and `MODE`.

### Step 6 — collapse the three save models (~1 week, high risk)

`packages/ext/src/profiles/configSession.ts`, `packages/ext/src/shell/shell.ts`.

One dirty buffer per drawer session, committed once. Modules stage into the session
instead of committing on their own. The footer hint —
`'Save cards in each tab · Title-bar Save* persists the profile · Esc closes'` —
becomes a live status line.

**Decide this before Step 1 ships.** If it is not going to happen, keep per-pane Save
and keep the hint. A redesigned drawer that still needs a sentence to explain saving is
worse than the current one.

---

## Sequencing

| Wave | Contents | Gate |
|---|---|---|
| A | Steps 1 + 2 | None. Ship on its own. |
| B | Steps 3 + 4 | Needs A. Snapshot tests will churn. |
| C | Step 5 | Independent. Any time. |
| D | Step 6 | Product decision, taken before A ships. |

Steps 1–5 are structurally invariance-preserving: no DOM changes, no class renames.
The existing ext test suite (`columnPanel.test.ts`, `formatPicker.test.ts`,
`shell.test.ts`, `ribbon*.test.ts`) couples to class names, not values, and should
survive. Tests asserting `.ckp-switch` will identify the real `switchToggle` call sites
in step 4.

---

## Acceptance

1. Toggle between `.vg-theme-cursor` and `.vg-theme-cursor-dark`. Every accent in the
   drawer, cockpit and side panel changes. No blue remains that the theme cannot reach.
2. Grep for `#4f9cf9` across `packages/`. Zero hits.
3. Open Styling Rules. Section heads carry no numbers; `STATUS` / `SCOPE` / `PRIORITY`
   appear exactly once each; `POSITION` is segmented; no tile in the indicator picker
   is blank.
4. Open the DataProvider editor's Behaviour tab. Every help string is sentence case and
   sits under its label; the control column is one straight vertical edge; the footer is
   a single row.
5. Measure any button, input or chip in the chrome. `28px`.

## Assets

No new assets. All icon path data comes from
`packages/kernel/src/icons/lucide.generated.ts` (Lucide, MIT). Fonts are Inter and
JetBrains Mono, already the `--vg-font-family` / `--vg-cell-font-family` stacks.

## Files in this bundle

| File | What |
|---|---|
| `Grid UI Design Review.dc.html` | Audit, system spec, before/after recreations |
| `Migration Plan.dc.html` | The six steps with diffs, blast radius, risk |
| `support.js` | Runtime for the two HTML files — must sit beside them |

Source files referenced throughout:

- `packages/kernel/src/ui/primitives.ts`
- `packages/kernel/src/theming/tokens.css`
- `packages/kernel/src/icons/lucide.generated.ts`, `build-lucide.ts`
- `packages/ext/src/shell/shell.ts`
- `packages/ext/src/ui/cockpit.ts`
- `packages/ext/src/modules/conditionalStyling.ts`
- `packages/ext/src/profiles/configSession.ts`
- `packages/customizer/src/styles.ts`
