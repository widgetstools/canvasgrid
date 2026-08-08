# 00 — Foundations: Shared Primitives & Chrome

The library of components every editor leans on. Build these first — every per-editor doc references this one.

Organized in four buckets:
1. **Settings chrome / panel framework** — the 3-column shell + layout primitives
2. **Floating windows** — Poppable + PopoutPortal
3. **Shared editors** — ExpressionEditor, StyleEditor, FormatterPicker, ColorPicker, TemplateManager
4. **Utility buttons** — ChromeButton, GhostIconButton, HoverTooltip

---

## 1. Settings chrome / panel framework

### Cockpit (3-column master-detail shell)

The canonical layout used by every master-detail panel.

```
┌──────────┬─────────────────────┐
│  Items   │   Editor pane       │   desktop: split
│  List    │   (title, form)     │
├──────────┤─────────────────────┤
│ [item 1] │   rule name [✏]    │
│ [item 2] │   Condition: [A=1]  │
│ [item 3] │   Apply: [bold]    │
│          │   [Reset] [Save]    │
└──────────┴─────────────────────┘

Mobile: left rail slides over the right pane on item select.
```

**Props:**
- `left`: rail content (usually a CockpitList)
- `center` / `right`: editor pane content
- `onItemSelect(id)`: fires when user clicks/keys-into a list item

**Internal state:** none. Parent owns selected item ID.

**Responsive behavior:** desktop = split (rail ~280px, editor flex); mobile = stack with rail off-canvas.

**Notable patterns to copy:**
- Selecting a new item does NOT auto-save the previous draft. Caller owns commit timing.
- Identical layout across all panels reduces cognitive load.

### CockpitList + CockpitListItem (keyboard-navigable item rail)

The reusable item picker for master-detail panels.

```
┌──────────────────────────┐
│ Filter items… 🔍         │
│──────────────────────────│
│  Item One                │   keyboard-hovered (aria-selected, transient)
│ ✓Item Two ← green-left   │   editor-open (data-active, persistent)
│  Item Three [trash]      │   hover reveals action icons
│  Item Four (muted)       │   disabled item
└──────────────────────────┘
```

**Props:**
- Container: `query`, `onQueryChange`, `children` (list items)
- `CockpitListItem`: `{ value, active?, muted?, multiline?, children }`
  - `value`: stable ID (used by keyboard nav)
  - `active`: this item's editor is open (renders green left border)
  - `muted`: ghost-out disabled/archived
  - `multiline`: two-line rows (title + metadata)
- `CockpitListItemMeta`: `{ children }` — small muted metadata line in multiline mode

**Internal state:** keyboard-focused item via `aria-selected`. The currently-edited item is `data-active` (independent of keyboard focus).

**Lit/Web Awesome translation:**
- `<wa-input>` for the search field
- Custom element `<cgrid-cockpit-list>` with keyboard event delegation (ArrowUp/Down/Home/End/Enter)
- CSS distinguishes `[aria-selected="true"]` (transient hover) from `[data-active="true"]` (persistent edit-open)

**Notable patterns to copy:**
- Two distinct selection layers (keyboard hover vs editor-open). Don't conflate.
- Filter is local — never re-fetches. List of ~hundreds is fine without virtualization; only Column Settings needs windowing (60+ columns).

### SettingsRow (canonical label + control row)

Used **everywhere** for "label on left, control on right" rows.

```
Grid: 2 columns [160px, 1fr], items-center, gap-x-4

┌──────────────┬──────────────────────┐
│ LABEL        │ control              │  row 1, items-center
│              │ hint (if present)    │  row 2 (col 2 only)
└──────────────┴──────────────────────┘
```

**Props:**
- `label`: string (fixed-width left column, uppercase tracked)
- `control`: slot/ReactNode (right column)
- `hint?`: string (secondary text under control)
- `noDivider?`: omit bottom border on final row

**Notable patterns:**
- **Fixed label width** (160px). All rows in a band align controls to the same x-coordinate → clean vertical edge.
- Hints grow only by hint height, not control height.
- Grid layout means switches, inputs, and multi-line controls all align cleanly.

### Band (numbered section header)

```
01 RULE ─────────────────────────────────
   (rows go here)
```

**Props:** `index` (display number), `title`, optional `overrideCount` chip, optional `flushTop` for first band, `children`.

**Notable patterns:**
- Numbered sections so users can reference "Band 03" in support.
- Override count chip ("●3") appears when user has non-default values in this band.

### ObjectTitleRow

The header bar for master-detail editor panes.

```
┌──────────────────────────────────────────────────────┐
│ [icon] [title input field]  [↑][↓] [Reset] [Save]   │
└──────────────────────────────────────────────────────┘
```

**Props:** `icon?`, `title` (editable), `onTitleChange`, action buttons slot.

Used in: every master-detail editor pane, plus the top of flat panels.

### Other layout primitives

| Primitive | Purpose |
|---|---|
| **PairRow** | Two-column row for paired controls (e.g., margin left + right). |
| **SummaryChip** | Compact pill: `[icon] LABEL value` with tones (neutral / primary / info / warning / positive). For sticky header strips. |
| **TabStrip** | Horizontal sub-tabs with accent underline. For Rule/Preview switches inside editors. |
| **TitleInput** | Editable title field with `font-semibold` styling. Wraps a base input for identity rows. |
| **IconInput** | Text input with leading icon (e.g., search). |
| **DirtyDot** | Tiny 6px circle. Appended to labels/rows when there are unsaved changes. |
| **SubLabel** | Small secondary text under a primary label. For hints/constraints. |
| **PillToggleGroup** | Horizontal button group with pill-shaped buttons. For enum selects (alignment, direction, severity). |
| **BoolControl** | Toggle switch wrapper. Maps to `<wa-switch>`. |
| **NumberControl** | Numeric input with spinner + min/max validation. Maps to `<wa-input type="number">`. |
| **NativeOptionsSelect** | Wrapper around native `<select>` for simple enum picking (low-overhead vs. `<wa-select>`). |
| **SharpBtn** | Sharp-corner button, uppercase label. For panel-header action buttons (Save/Reset). |

---

## 2. Floating windows: Poppable + PopoutPortal

### Poppable (inline ↔ popped-out render-props primitive)

Lets the same component render either inline as a toolbar or as a popped-out OS window — without re-mounting the tree.

**Props:**
- `name`: stable window identifier (refocus existing window if open)
- `title`: OS window title
- `width`, `height`: initial size
- `alwaysOnTop?`: OpenFin only; browsers ignore
- `frame?`: include OS chrome (false = caller renders custom title bar)
- `expandedHeight?`: auto-grow height when popovers/menus inside open
- `onClose?`: fires on close
- `children: (props) => ReactNode` — render prop receiving `{ popped, PopoutButton, close }`

**Render-prop API:**
- `popped`: boolean (inline or popped-out?)
- `PopoutButton`: ready-made button to open the popout
- `close`: imperative close

**Notable patterns:**
- Same tree, two locations — no tree duplication, no state loss
- StrictMode-safe deferred close (~50ms) so a remount can cancel + reuse the window
- Cross-realm context sharing: the popout is a React portal in the main window's root, so it shares all context (theme, store, profile) instantly

**Lit translation:**
- A custom element `<cgrid-poppable>` with two slots: `inline` and `popout`
- Move DOM nodes between the two slot locations on toggle (no re-render — node identity preserved)
- Use `window.open()` + portal-like rendering into the popout's document via a stable `Element` reference

### PopoutPortal (OS window lifecycle)

Low-level primitive that creates the OS window and manages its document. Underpins Poppable.

**Internal:**
- Module-level `liveWindows` Map (keyed by name) prevents duplicate windows
- Pending close timers
- MutationObserver on popout document for `[data-radix-popper-content-wrapper]` (auto-grow when popovers open)

**Caveats:**
- Closing main window kills popout (React runs in main VM — same will apply to Lit running in main VM)
- Refreshing popout blanks it (no URL of its own)
- Popup blockers may block `window.open` unless fired from a direct user gesture (the popout button click)

**Lit translation:** mostly identical — Lit elements work the same way across browser windows since web components are platform-native.

---

## 3. Shared editor components

### ExpressionEditor (Monaco-backed DSL editor)

Multi-line editor for the customizer expression DSL (`[col] * 2`, `IF(...)`, etc.). Used in: Conditional Styling, Calculated Columns, Plus/Minus, Alerts, Toolbar Date Settings.

**Props:**
- `value`, `onChange(text)`, `onBlur?(text)`
- `placeholder?`
- `dataType?`: context for autocomplete
- `error?`: validation message displayed below
- `height?`: editor height (default ~200px)

**Behavior:**
- Lazy-loads Monaco (~2.5 MB minified) via dynamic import
- Falls back to plain `<input>` if chunk fails to load
- Syntax highlighting for the DSL
- Autocomplete provider populated with column names, available functions, constants
- Live validation against the engine's `ExpressionEngine.validate()`

**Lit translation:** Monaco works as-is in any DOM context. Wrap in a `<cgrid-expression-editor>` custom element that lazy-imports Monaco in `firstUpdated` and renders fallback `<wa-textarea>` initially. The validation hookup is identical regardless of framework.

### StyleEditor (typography + color + border + format)

The big one. Four sections (text, color, border, format) shown in four presentation variants (inline / popover / dialog / drawer). Used by: Column Settings (cell + header), Conditional Styling, Column Groups.

**Props:**
- `value`: `{ text?, color?, border?, format? }`
- `onChange(patch)`
- `sections?`: which sections to render (default all 4)
- `dataType?`: context for format section
- `variant?`: `'inline' | 'popover' | 'dialog' | 'drawer'`
- `trigger?`: required when variant !== 'inline'
- `open?`, `onOpenChange?`: controlled popover/dialog state
- `width?`: popover/dialog width

**Sections:**
- **Text**: font family, size, weight, line height, tracking, case
- **Color**: text color + background color (compact pickers)
- **Border**: per-side width, style (solid/dashed/dotted), color
- **Format**: value formatter (preset / Excel format / expression)

**Notable patterns:**
- Same JSX renders in 4 layouts via `variant` prop
- Section re-indexing: if caller passes `sections=['color', 'text']`, visible numbers stay continuous (01/02 not 02/01)
- Works in both light + dark themes via design-system tokens

### FormatterPicker (preset + custom Excel format selector)

Value formatter chooser. Two presentations: **compact** (toolbar popover) and **inline** (editor row).

**Props:**
- `dataType`: infers preset list + validation
- `value`: `ValueFormatterTemplate | undefined`
- `onChange(template)`
- `sampleValue?`: preview override
- `compact?`: toggle compact (popover) vs inline
- `layout?`: horizontal | vertical for inline
- `defaultCollapsed?`: start collapsed (inline only)

**Compact mode** (toolbar):
```
[chip: Currency 2dp ▼]  ← click → popover with preset grid + custom Excel input + preview
```

**Inline mode** (editor row):
```
▼ Format
   ○ Preset: [dropdown]
   ○ Custom: [Excel format string]
   Preview: 1,234.56
```

**Notable patterns:**
- Live preview updates on every keystroke
- Excel format validation per keystroke (`isValidExcelFormat()`); Apply disabled on invalid
- Same logic, two presentations — `CompactFormatterPicker` and `InlineFormatterPicker` reuse the same core

### ColorPicker / CompactColorField

HSV pad + hue strip + preset swatches + recent colors + hex input. Used by typography color, cell fill, border color, indicator color.

**Layout:**
```
┌─────────────────────────┐
│ SV pad (drag crosshair) │
│ Hue strip               │
│ 16 preset swatches      │
│ Recent: ⬛⬛⬛⬛⬛       │  ← localStorage, max 10
│ [🎨] [■] #hex [×]      │
└─────────────────────────┘
```

**Notable patterns:**
- Immediate commits — every interaction calls `onChange(hex)`; no Apply button
- HSV internal, hex external (better UX for color manipulation)
- Recent colors persisted to localStorage (max 10, oldest evicted)
- Pipette mode optional (browser EyeDropper API where available)

**Lit translation:** `<wa-color-picker>` covers the basics; wrap with our presets + recents logic.

### TemplateManager (saved formatting templates)

Two-variant component: **compact** (toolbar popover, ~320px) and **panel** (full-width section in FormatterPanel).

**Props:**
- `templates`: array of `{ id, name }`
- `activeTemplateId?`
- `saveName`, `saveConfirmed`, `onSaveNameChange`, `onSave` — controlled save input
- `onApply(id)`, `onDelete(id)`, `onUpdate?(id)`, `onRename?(id, name)`
- `capturableFields?`: what the snapshot will include (display hint)
- `variant?`: `'compact' | 'panel'`

**Layout (compact):**
```
[Bold]     [✏] [🔄] [🗑]
[Currency] ✓ [✏] [🔄] [🗑]   ← active
[…]

Save as: [name input] [+]
Will save: Styles · Formatter · Filter
```

**Notable patterns:**
- One implementation, two layouts via variant prop
- Two-step delete: trash icon mousedown-to-arm, then click-to-commit. Prevents accidental destruction.
- Save-as state externalized (caller controls input + confirmed flag) — keeps the component pure

---

## 4. Utility buttons

### ChromeButton

Wrapper around a base button that disables framework default styling so legacy CSS classes (`.ds-*`) can take over. Used by Poppable, FiltersToolbar, all legacy panels.

**Notable:** the reset constant is what matters — it tells the design-system styles "I'm in chrome, don't override me." For cgrid, define this once and reuse.

### GhostIconButton

Compact 22×22px (or 28×28px) icon button with optional hover-reveal visibility mode.

**Props:**
- `variant?`: `'default' | 'accent' | 'destructive'`
- `size?`: `'sm' | 'md'`
- `reveal?`: `'always' | 'on-row-hover'`
- `revealed?`: explicit visibility override (for keyboard focus)

**CSS pseudo-class system:** uses `[data-row-hover-target]:hover` so the parent row doesn't need to wrap the button — clients just add `data-row-hover-target=""` to the row element and the buttons fade in.

### HoverTooltip

Lightweight tooltip wrapper with `content` + `children` props (vs. separate Trigger/Content). For all icon-only buttons.

**Lit translation:** `<wa-tooltip>` is the direct equivalent. Hoist into a `<cgrid-hover-tooltip>` thin wrapper if you want a unified API.

---

## Cross-cutting helpers

### Draft + DirtyBus pattern

Every editor that mutates state needs three things:
1. A `draft` local-state buffer seeded from committed state
2. A `dirty` boolean (draft !== committed)
3. Save / Reset actions

In starui this is encapsulated as a `useModuleDraft(moduleId, itemId, selectItem, commitItem)` hook. For velocity-grid:

```ts
// Lit Reactive Controller
class ModuleDraftController<T> {
  draft: T;
  dirty = false;
  constructor(private host, private opts) { /* ... */ }
  setDraft(patch: Partial<T>) { /* merge, set dirty, requestUpdate */ }
  save() { /* commit via reducer, clear dirty */ }
  reset() { /* reseed from committed, clear dirty */ }
}
```

The `DirtyBus` is a pub/sub for the dirty-row LED on list panes — each row subscribes by ID, only its LED re-renders on dirty change.

### Progressive band mounting

For panels with many bands (Grid Options, Toolbar Date Settings):

```ts
// In firstUpdated:
const idleMount = (idx) => {
  this.mountedBands.add(idx);
  this.requestUpdate();
  if (idx < this.totalBands - 1) {
    requestIdleCallback(() => idleMount(idx + 1), { timeout: 200 });
  }
};
```

Combine with `content-visibility: auto` + `contain-intrinsic-size` on band wrappers so off-screen ones have a layout placeholder.

### IntersectionObserver scroll tracking

For panels with sidebar nav:

```ts
const observer = new IntersectionObserver(
  (entries) => {
    const first = entries.find(e => e.isIntersecting);
    if (first) this.activeNav = first.target.dataset.bandId;
  },
  { rootMargin: '-10% 0% -70% 0%' }
);
```

Watch each band's header element. Whichever is in the top 10–30% of the viewport becomes the active nav highlight.
