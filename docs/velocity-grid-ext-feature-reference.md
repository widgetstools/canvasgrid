# VelocityGrid Extension — Feature Reference

**Package:** `@wellsfargo-starui/velocity-grid-ext` (`packages/ext`)  
**Scope:** Every discrete UI control on the title bar, editing/formatting toolbars, Customize drawer chrome, and each Customize tab.  
**Source of truth:** `packages/ext/src/` (toolbars/modules) and kernel panels mounted by Options / Column Groups.  
**Related:**  
- Grid engine (CSRM/SSRM/expressions/calc/…) — [velocity-grid-feature-reference.md](./velocity-grid-feature-reference.md)  
- Architecture & implementation — [velocity-grid-architecture.md](./velocity-grid-architecture.md)  
- DataProvider editor popout — [data-provider-editor-feature-reference.md](./data-provider-editor-feature-reference.md)

Strings below are quoted from source. Dynamic values shown as `{…}`. Icon-only controls list **aria-label / title**.

---

## 0. Shell layout (context)

```
┌ .vgext-root ──────────────────────────────────────────────────────────────┐
│ ┌ .vgext-titlebar ── title bar (§1) ────────────────────────────────────┐ │
│ ┌ .vgext-ribbon ── editing strip (§2) + formatting strip (§3) ──────────┐ │
│ ┌ .vgext-grid ─────────────────────────────┐  ┌ Customize drawer (§4–5) ┐ │
│ │ VelocityGrid canvas                       │  │ eyebrow · nav · module │ │
│ └──────────────────────────────────────────┘  └─────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

| Extension kind | Slot |
|----------------|------|
| `toolbar-item` | Title bar / ribbon |
| `settings-module` | Customize drawer body |

Markets-shaped demos compose `titleBarExtensions` + `ribbonExtensions({ edit })` + optional data-provider modules on top of the default settings bundle.

---

## 1. Title bar — every control

**API:** `titleBarExtensions(opts?)` · **Files:** `toolbar/titleBar.ts`, `savedFiltersToolbar.ts`, `layoutsMenu.ts`, `alertsChrome.ts`  
**Host:** `.vgext-titlebar`

### 1.1 Brand + filter-pill collapse

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 1 | Brand name | label | `VelocityGrid` (or `opts.name`) | Product/grid name |
| 2 | Filter-pill collapse | icon button | `Hide filter pills` / `Show filter pills` / `Filter pills unavailable` | Toggle saved-filter strip |

### 1.2 Saved filters strip

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 3 | Scroll left | icon button | `Scroll filters left` | Scroll pill strip |
| 4 | Scroll right | icon button | `Scroll filters right` | Scroll pill strip |
| 5 | Filter pill | toggle button | face = `{label}`; title `Apply "{label}"` / `Deactivate "{label}"` | Apply/deactivate filter |
| 6 | Count badge | badge | `{n}` or `–` | Matching row count |
| 7 | Rename | icon button | `Rename` | Open rename dialog |
| 8 | Delete | icon button | `Delete` | Remove pill |
| 9 | Edit JSON | icon button | `Edit filter JSON` | Open JSON editor |
| 10 | Deactivate all | icon button | `Deactivate all filter pills` | Clear active pills |
| 11 | Save as pill | icon button | `Save current filters as a pill` (disabled title: `Apply a new column filter first, then save it as a pill`) | Capture live filter |

**Rename popover**

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 12 | Dialog | dialog | aria `Rename filter` | Rename UI |
| 13 | Title | label | `Rename filter` | Heading |
| 14 | Name input | text | aria `Filter name` | Edit pill name |
| 15 | Cancel | button | `Cancel` | Dismiss |
| 16 | Save | button | `Save` | Commit rename |

**JSON popover**

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 17 | Dialog | dialog | aria `Edit filter JSON` | JSON UI |
| 18 | Title | label | `{pill.label}` | Heading |
| 19 | JSON textarea | textarea | (filter JSON) | Edit filter model |
| 20 | Cancel | button | `Cancel` | Dismiss |
| 21 | Save | button | `Save` | Commit JSON |

### 1.3 Search

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 22 | Search expand | icon button | `Search grid` | Expand field |
| 23 | Search input | search | placeholder `Search grid…` | Sets `quickFilterText` |

### 1.4 Alerts badge

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 24 | Alerts | icon button | `Alerts` | Open history popover |
| 25 | Unread count | badge | `{n}` or `99+` | Unread count |
| 26 | Popover | dialog | aria `Alert history` | History panel |
| 27 | Head title | label | `Alerts` | Heading |
| 28 | Mark read | button | `Mark read` | Clear unread |
| 29 | Clear | button | `Clear` | Clear history |
| 30 | Settings | button | `Settings` | Open Customize → Alerts |
| 31 | Empty state | text | `No alerts this session.` | Empty history |
| 32 | Alert row | list item | `{message}` + `{ruleName} · {rowId}` | History entry |
| 33 | Toast | toast | severity + `{message}` | Transient notification |

### 1.5 Layouts menu

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 34 | Layouts trigger | pill button | face = active name (default `Default`); title `Layout: {name}` | Open menu |
| 35 | Head | label | `LAYOUTS` | Menu header |
| 36 | Count | badge | `{n}` | Layout count |
| 37 | Layout row | menuitem | `{layout.name}` | Load/select layout |
| 38 | Rename | icon button | title `Rename`; aria `Rename layout '{name}'` | Inline rename |
| 39 | Duplicate | icon button | title `Duplicate`; aria `Duplicate layout '{name}'` | Duplicate |
| 40 | Export one | icon button | title `Export`; aria `Export layout '{name}'` | Export one layout |
| 41 | Delete | icon button | title `Delete`; aria `Delete layout '{name}'` | Delete (non-default) |
| 42 | Lock badge | icon | title `Built-in layout` | Default locked |
| 43 | Rename input | text | (current name) | Commit on Enter |
| 44 | Error strip | text | `{error}` | Import/op errors |
| 45 | New name | text | placeholder/aria `New layout name` | Name for save-new |
| 46 | + Save | button | `+ Save` | Save new layout |
| 47 | Export footer | button | `Export`; title `Export full grid config (view + all layouts)` | Download full config |
| 48 | Import footer | button | `Import`; title `Import full config, layouts bundle, or a single layout` | File import |
| 49 | File input | file | accept `.json` | Hidden picker |

### 1.6 Layout save disk

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 50 | Save layout | icon button | `Config up to date` / `Save layout '{name}' + grid config` | Persist dirty layout+config |

### 1.7 Date picker

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 51 | Date trigger | button | face `{YYYY-MM-DD}` or `—`; aria `Selected date {iso}`; title `As-of date {iso}` | Open calendar |
| 52 | Date dialog | dialog | aria `Choose date` | Calendar |
| 53 | Prev month | icon button | `Previous month` | Navigate |
| 54 | Month title | label | `{Month} {year}` | Current month |
| 55 | Next month | icon button | `Next month` | Navigate |
| 56 | DOW labels | labels | `Su` `Mo` `Tu` `We` `Th` `Fr` `Sa` | Weekday headers |
| 57 | Day cells | buttons | text `{day}`; aria `{iso}` | Select date |
| 58 | Today | button | `Today` | Jump to today |

### 1.8 Overflow (ellipsis) + More (sliders)

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 59 | Settings (ellipsis) | icon button | `Settings` | Open Customize → Options |
| 60 | More (sliders) | icon button | `More` | Open More menu |

**More menu**

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 61 | Section | label | `View` | Section header |
| 62 | Columns… | menu item | `Columns…` | Open columns tool panel |
| 63 | Auto format | menu item | `Auto format` | Run auto-format |
| 64 | Section | label | `Configure` | Section header |
| 65 | Column format… | menu item | `Column format…` | Open Column Settings |
| 66 | Smart edit… | menu item | `Smart edit…` | Open Smart Edit |
| 67 | Conditional styling… | menu item | `Conditional styling…` | Open Styling Rules |
| 68 | Grid options… | menu item | `Grid options…` | Open Options |
| 69 | Section | label | `Toolbars` | Section header |
| 70 | Editing toolbar | menu toggle | `Editing toolbar` | Show/hide editing strip |
| 71 | Formatting toolbar | menu toggle | `Formatting toolbar` | Show/hide formatting strip |
| 72 | Section | label | `Appearance` | Section header |
| 73 | Dark theme | menu toggle | `Dark theme` | Toggle light/dark |

### 1.9 Profiles menu (exported; **not** mounted by `titleBarExtensions`)

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 74 | Profile save | icon button | `Profile up to date` / `Save profile '{id}' (unsaved changes)` | Save active profile |
| 75 | Profiles trigger | pill | title `Profile: {name}` | Open profiles menu |
| 76 | Profile row | button | `{profile.name}` | Switch profile |
| 77 | Rename | icon button | `Rename` | Rename via prompt |
| 78 | Delete | icon button | `Delete` | Confirm delete |
| 79 | Save as… | button | `Save as…` | New profile name prompt |
| 80 | Error | text | `{error}` | Profile op error |

---

## 2. Editing toolbar — every control

**API:** `ribbonExtensions({ edit })` · **File:** `toolbar/ribbon.ts`  
**Host:** `.vgext-edit-strip` (`data-toolbar="editing"`)  
**Requires:** `wireEditIntoKernel(grid)`.

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 1 | History | segment label | `History` | Section |
| 2 | Undo | icon button | `Undo` | Journal undo |
| 3 | Redo | icon button | `Redo` | Journal redo |
| 4 | History count | stat | `0 entries` / `{n} entry` / `{n} entries` | Journal size |
| 5 | Smart edit | segment label | `Smart edit` | Section |
| 6 | Operand | text | placeholder `1` (default `1`) | Smart-edit operand |
| 7 | Multiply | icon button | `Multiply` | × op |
| 8 | Divide | icon button | `Divide` | ÷ op |
| 9 | Add | icon button | `Add` | + op |
| 10 | Subtract | icon button | `Subtract` | − op |
| 11 | Set… | pill button | `Set…` | Set-value op |
| 12 | Smart count | stat | `0 cells` / `{n} cell(s)` | Target cell count |
| 13 | Bulk | segment label | `Bulk` | Section |
| 14 | Bulk value | text | placeholder `New value` | Bulk value |
| 15 | Apply bulk | icon button | `Apply` | Apply bulk update |
| 16 | Bulk count | stat | `0 selected` / `{n} selected` | Selection count |
| 17 | More editing tools | icon button | `More editing tools` (overflow face `More tools` / `More tools ({n})`) | Spill overflow |
| 18 | Hide editing toolbar | icon button | `Hide editing toolbar` | Hide strip |

---

## 3. Formatting toolbar — every control

**Host:** `.vgext-format-strip` (`data-toolbar="formatting"`) · **File:** `toolbar/ribbon.ts`

### 3.1 Strip (always / when visible)

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 1 | Selection chip | pill | face `—` / `{col}` / `{n}` / `All·{n}`; titles `Select a cell` / `{name}` / `{n} columns selected` / `All columns ({n})` | Selection readout |
| 2 | Target toggle | icon toggle | aria `Styling target: Cells — click to switch to Header` / inverse | Cells ↔ Header |
| 3 | Scope toggle | icon toggle | aria `Scope: selected column(s) — click to apply to all columns` / inverse | Selected ↔ All |
| 4 | Font | segment label | `Font` | Section |
| 5 | Bold | toggle | `Bold` | Font weight |
| 6 | Italic | toggle | `Italic` | Font style |
| 7 | Underline | toggle | `Underline` | Text decoration |
| 8 | Strikethrough | toggle | `Strikethrough` | Text decoration |
| 9 | Font size value | label | `{n}px` (e.g. `12px`) | Current size |
| 10 | Larger font | icon button | `Larger font` | +1px |
| 11 | Smaller font | icon button | `Smaller font` | −1px |
| 12 | Text color | swatch | `Text color` | FG colour |
| 13 | Fill color | swatch | `Fill color` | BG colour |
| 14 | AB | toggle | face `AB`; titles for header case switch / uppercase / restore | Header caption case |
| 15 | Currency format | icon button | `Currency format` | `$` preset |
| 16 | Percent format | icon button | `Percent format` | `%` preset |
| 17 | Thousands format | icon button | `Thousands format` | `#` thousands |
| 18 | Fewer decimals | icon button | `Fewer decimals` | −1 decimal |
| 19 | More decimals | icon button | `More decimals` | +1 decimal |
| 20 | Custom format caret | icon button | `Custom format` / `Custom format…` / `Format: {label}` | Open format picker |
| 21 | Align | segment label | `Align` | Section |
| 22 | Align left | toggle | `Align left` | Left |
| 23 | Align center | toggle | `Align center` | Center |
| 24 | Align right | toggle | `Align right` | Right |
| 25 | Borders | dropdown | label `Borders`; title `Border styling` | Borders flyout |
| 26 | Icons | dropdown | label `Icons`; title `Icons and placement` | Icons flyout |
| 27 | Column | dropdown | label `Column`; title `Column settings` | Column panel |
| 28 | Templates | segment label | `Templates` | Section |
| 29 | Column templates | icon button | `Column templates` (+ longer apply/save/rename/delete title) | Open templates |
| 30 | Templates pill | pill | aria `Templates`; face = active template name | Open templates |
| 31 | Undo formatting | icon button | `Undo formatting` | Format history undo |
| 32 | Redo formatting | icon button | `Redo formatting` | Format history redo |
| 33 | Clear column | danger icon | `Clear column customization` (+ long title) | Clear selected cols |
| 34 | Clear all | danger icon | `Clear all customization in this layout` (+ long title) | Clear layout |
| 35 | More formatting tools | icon button | `More formatting tools` | Overflow |
| 36 | Hide formatting toolbar | icon button | `Hide formatting toolbar` | Hide strip |

**Parked off-strip (wired, not shown on strip):** aggregation pill `Σ None`, `Floating filter`, floating-filter type (`Auto`/`Text`/`Num`/`Date`/`Set`), `Groupable`, `Show aggregation in header` — available via Column flyout (§3.4).

### 3.2 Borders flyout

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 37 | All borders | toggle | `All borders` | Side slot |
| 38 | Top border | toggle | `Top border` | Side slot |
| 39 | Bottom border | toggle | `Bottom border` | Side slot |
| 40 | Left border | toggle | `Left border` | Side slot |
| 41 | Right border | toggle | `Right border` | Side slot |
| 42 | Border preview | chip | title `Current borders` | Live preview |
| 43 | Border color | swatch | `Border color` | Border colour |
| 44 | Style pill | pill | `Solid` / `Dashed` / `Dotted` | Line style |
| 45 | Width pill | pill | `1 px` … `4 px` | Width |
| 46 | Clear side | icon button | `Remove the border at this side` | Clear side/all |
| 47 | Style menu items | menu | `Solid` `Dashed` `Dotted` | Pick style |
| 48 | Width menu items | menu | `1 px` `2 px` `3 px` `4 px` | Pick width |

### 3.3 Icons flyout + picker

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 49 | Pick… | dropdown | face `Pick…` / `Add icon` / `Icon`; title/aria `Pick icon or emoji` | Open icon panel |
| 50 | Placement pill | pill | `Prefix` (default) | Placement menu |
| 51 | Icon color | swatch | `Icon color` | SVG tint |
| 52 | Clear icon | icon button | `Clear icon at this placement` | Clear slot |

**Placement menu**

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 53 | Headings | labels | `Inline` · `Positional` | Groups |
| 54 | Items | menuitemradio | `Prefix` `Suffix` `Top-left` `Top-right` `Bottom-left` `Bottom-right` `Middle-left` `Middle-right` | Select/move slot |

**Icon picker panel** (`aria-label` `Icons and emojis`)

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 55 | Search | search | placeholder `Search icons & emojis…`; aria `Search icons and emojis` | Filter tiles |
| 56 | Lucide category headers | labels | `Arrows & Direction`, `Charts & Data`, `Files & Documents`, `Communication`, `Media & AV`, `People`, `Finance & Commerce`, `Time & Calendar`, `Weather & Nature`, `Devices & Tech`, `Transport & Places`, `Security & Alerts`, `Editing & Tools`, `Shapes & Symbols`, `Other` | Sections |
| 57 | Emoji category headers | labels | `Smileys`, `Gestures & People`, `Arrows`, `Symbols & Status`, `Finance`, `Objects & Tech`, `Time & Weather`, `Nature & Food` | Sections |
| 58 | Icon/emoji tiles | buttons | aria/title = icon name or emoji label | Select glyph |
| 59 | Empty | text | `No icons match` / `Nothing matches "{q}"` | No results |

### 3.4 Column panel flyout

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 60 | Empty | text | `Select a cell or column first.` | No target |
| 61 | FILTER | caps | `FILTER` | Section |
| 62 | Floating filter | switch | `Floating filter` | Toggle FF |
| 63 | Filter type | segment | `Auto` `Text` `Num` `Date` `Set` | Filter type |
| 64 | GROUPING | caps | `GROUPING` | Section |
| 65 | Groupable | switch | `Groupable` | Row group |
| 66 | Pivotable | switch | `Pivotable` | Pivot |
| 67 | AGGREGATION | caps | `AGGREGATION` | Section |
| 68 | Function | select | `None` + agg funcs; `(mixed)` | Agg func |
| 69 | Show in header | switch | `Show in header` | Agg in header |
| 70 | BEHAVIOR | caps | `BEHAVIOR` | Section |
| 71 | Sortable | switch | `Sortable` | Behavior |
| 72 | Resizable | switch | `Resizable` | Behavior |
| 73 | Editable | switch | `Editable` | Behavior |
| 74 | Hidden | switch | `Hidden` | Behavior |
| 75 | Pinned | segment | `Left` `–` `Right` | Pin |

### 3.5 Format picker (from caret)

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 76 | Empty | text | `Select a cell or column first.` | No target |
| 77 | Applied | caps | `Applied` | Current header |
| 78 | Current chip | chip | `—` or preview; title `No format applied` / format code | Current format |
| 79 | Clear format | icon button | `Clear format` | Clear applied |
| 80 | Search | search | `Search formats…` | Filter presets |
| 81 | Category tabs | tabs | `Number` `Currency` `Percent` `Negatives & P&L` `Conditional` `Date & time` `Tick` `Text` `Boolean` + `Custom` | Category nav |
| 82 | Preset rows | buttons | label + code + preview (e.g. `Integer`, `2 decimals`, `USD`, …) | Apply preset |
| 83 | Search empty | text | `No formats match "{q}". Try the Custom tab.` | No matches |
| 84 | Custom format | caps | `Custom format` | Custom tab |
| 85 | Currency | caps | `Currency` | Quick symbols header |
| 86 | Symbol buttons | buttons | `$` `€` `£` `¥` `₹` `CHF` | Insert currency |
| 87 | Custom input | text | aria `Custom format`; placeholder `#,##0.00` or `yyyy-mm-dd` | Draft format |
| 88 | Apply | icon button | `Apply format` | Apply custom |
| 89 | Clear (custom) | icon button | `Clear format` | Clear |
| 90 | Ref section labels | labels | `Numbers & decimals`, `Currency`, `Percent & basis points`, `Negatives in parens / red`, `Dates & times`, `Conditional (directional)`, `Fixed-income tick (via preset dropdown)`, `Scientific & custom text` | Example groups |
| 91 | Ref rows | buttons | e.g. `Integer w/ thousands`, `2 decimals`, … | Apply/copy example |

### 3.6 Templates flyout

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 92 | Empty | text | `Select a cell or column first.` / `No saved templates yet.` | Empty |
| 93 | Template row | button | `{template.name}` | Apply template |
| 94 | Rename | icon button | `Rename` | Rename mode |
| 95 | Update from selection | icon button | `Update from selection` | Overwrite template |
| 96 | Delete | icon button | `Delete` | Pending delete |
| 97 | Confirm delete | icon button | `Confirm delete` | Confirm |
| 98 | Cancel delete | icon button | `Cancel delete` | Cancel |
| 99 | Rename input | text | aria `Rename template` | Rename |
| 100 | Save name | text | placeholder `Save current as…`; aria `New template name` | New template name |
| 101 | Save as new | icon button | `Save as new template` | Create template |
| 102 | Hint | text | `Will save: {fields}` / `Nothing to capture — style or format a column first.` | Capture hint |

---

## 4. Customize drawer chrome — every control

**File:** `shell/shell.ts` · **Aria:** `Customize grid`  
**Open:** `open-settings` / `ext.openSettings(moduleId)` / title-bar Settings / More menu  
**Close:** ×, **Done**, **Discard**, Esc

| # | Control | Type | Exact string | Purpose |
|---|---------|------|--------------|---------|
| 1 | Drawer | dialog | aria `Customize grid` | Settings sheet |
| 2 | Eyebrow | label | `Customize · {Layout\|Data\|Format\|Editing\|Workspace}` or `Customize` | Category context |
| 3 | Title | heading | `{module.title}` | Active module title |
| 4 | Close | icon button | `Close settings` | Close drawer |
| 5 | Category nav | menubar | aria `Settings categories` | Category menus |
| 6 | Category triggers | menuitems | `Layout` `Data` `Format` `Editing` `Workspace` | Open category menu (empty categories omitted) |
| 7 | Nav menu items | menuitems | module titles (§5) | Switch module (may prompt discard if dirty) |
| 8 | Footer hint | text | `Save cards in each tab · Title-bar Save* persists the profile · Esc closes` | Guidance |
| 9 | Discard | button | `Discard`; title `Revert unsaved profile changes and close` | Discard+close |
| 10 | Done | button | `Done` | Close |

**Category → typical modules**

| Category | Label | Modules |
|----------|-------|---------|
| `layout` | Layout | Options, Column Groups, Column Settings |
| `data` | Data | Data provider (opt-in), Calculated Columns, Expressions (opt-in) |
| `format` | Format | Styling Rules, Alerts |
| `editing` | Editing | Smart Edit, Bulk Update, Plus/Minus, Shortcuts, Edit History |
| `workspace` | Workspace | Reserved / future |

**Persistence grammar:** local draft → **Reset** / **Save** on card → title-bar Save\* / layout disk persists profile. Data-provider tab uses **Apply** (bind), not Save-to-grid.

---

## 5. Customize tabs — every control

### 5.1 Options (`grid-options`) — Layout

**Ext mount:** `modules/gridOptions.ts`  
**UI body:** kernel `GridOptionsToolPanel` — schema from `packages/kernel/src/core/optionSchema.ts`  
**Section title in form:** `Grid Options`  
**Apply model:** each control commits live via `setGridOption` / theme params (no Save card on this tab).  
**Modified baseline:** “changed from what the app had when the panel opened”, not factory defaults.

#### Chrome (above all bands)

| # | UI label | Type | Exact string | Behavior |
|---|----------|------|--------------|----------|
| 1 | Search | search | placeholder `Search settings…`; aria `Search settings` | Filters fields by label across all bands |
| 2 | Modified | toggle button | face `Modified` or `Modified · {n}`; title `Show only settings changed from their defaults`; `aria-pressed` | Shows only fields that differ from the open-time baseline |

---

#### Band `Appearance` (`appearance`)

| # | UI label | Type | Grid option / key | Default | Select values / range | Hint (UI) | What it does |
|---|----------|------|-------------------|---------|----------------------|-----------|--------------|
| 3 | Density | select | `density` | `normal` | `Compact`→`compact`, `Normal`→`normal`, `Comfortable`→`comfortable` | — | Row/header density preset; drives theme-resolved row/header heights until overridden |
| 4 | Row height | number | `rowHeight` | theme/density resolved | min 16 · max 80 · step 1 | `px · follows density until changed` | Explicit row pixel height |
| 5 | Header height | number | `headerHeight` | theme/density resolved | min 20 · max 80 · step 1 | `px · follows density until changed` | Explicit header pixel height |
| 6 | Animate rows | switch | `animateRows` | off | — | — | Animate row add/remove/reorder |
| 7 | Row hover highlight | switch | `suppressRowHoverHighlight` *(inverted)* | on (highlight) | — | `On = highlight the row under the pointer` | UI On = highlight; writes `suppressRowHoverHighlight: false` |
| 8 | Status bar | switch | `statusBar` | on | — | `Bottom strip with row counts + aggregates` | Off writes `false`; On writes `undefined` (restore default) |
| 9 | Floating filters | switch | `floatingFilter` | on | — | `Filter input row under the header` | Same on/off write pattern as status bar |
| 10 | Layout | select | `domLayout` | `normal` | `Normal`→`normal`, `Print`→`print` | — | Normal scrolling vs print (auto-height) layout |
| 11 | Side panel | switch | *(host)* `isSideBarVisible` / `setSideBarVisible` | live host state | — | `Show the side bar (Columns / Filters / Options tabs)` | **Only when side bar API present.** Not a stored grid-option key |

---

#### Band `Selection` (`selection`)

| # | UI label | Type | Grid option | Default | Select values | Hint | What it does |
|---|----------|------|-------------|---------|---------------|------|--------------|
| 12 | Row selection | select | `rowSelection` | `none` | `Off`→`none`, `Single row`→`single`, `Multiple rows`→`multiple` | — | Row selection mode |
| 13 | Ignore row clicks | switch | `suppressRowClickSelection` | off | — | `Select via checkboxes only` | Clicks on row body do not select |
| 14 | Multi-select on click | switch | `rowMultiSelectWithClick` | off | — | `No Ctrl/Cmd needed` | Click toggles multi-selection without modifier |
| 15 | Group selects children | switch | `groupSelectsChildren` | off | — | — | Selecting a group selects descendant leaves |

---

#### Band `Change flash` (`changeFlash`)

| # | UI label | Type | Grid option | Default | Range | Hint | What it does |
|---|----------|------|-------------|---------|-------|------|--------------|
| 16 | Flash on change | switch | `enableCellChangeFlash` | off | — | — | Flash cells when values change |
| 17 | Flash duration | number | `cellFlashDuration` | 500 | 0–5000 · step 50 | `ms` | How long the flash colour stays |
| 18 | Fade duration | number | `cellFadeDuration` | 1000 | 0–10000 · step 50 | `ms` | Fade-out after flash |

---

#### Band `Editing` (`editing`)

| # | UI label | Type | Grid option(s) | Default | Select values | Hint | What it does |
|---|----------|------|----------------|---------|---------------|------|--------------|
| 19 | Edit trigger | select | `singleClickEdit` + `enableExcelEditing` | `double` | `Double click`→`double`, `Single click`→`single`, `Excel-style`→`excel` | `How a cell enters edit mode` | Composite: Excel sets `enableExcelEditing=true` and clears single-click; Single sets `singleClickEdit=true`; Double clears both |
| 20 | Disable click editing | switch | `suppressClickEdit` | off | — | `Edit only via F2 / Enter` | Blocks mouse-click entry into edit |

---

#### Band `Clipboard & fill` (`clipboardFill`)

| # | UI label | Type | Grid option | Default | Select values | Hint | What it does |
|---|----------|------|-------------|---------|---------------|------|--------------|
| 21 | Copy delimiter | select | `clipboardDelimiter` | `\t` | `Tab (TSV)`→`\t`, `Comma (CSV)`→`,`, `Semicolon`→`;`, `Pipe`→`\|` | — | Delimiter for clipboard copy |
| 22 | Disable clipboard API | switch | `suppressClipboardApi` | off | — | — | Do not use browser Clipboard API |
| 23 | Block paste | switch | `suppressClipboardPaste` | off | — | — | Ignore paste into grid |
| 24 | Disable context menu | switch | `suppressContextMenu` | off | — | — | No right-click context menu |
| 25 | Fill handle | switch | `enableFillHandle` | off | — | — | Excel-like drag fill handle |
| 26 | Fill direction | select | `fillHandleDirection` | `y` | `Vertical`→`y`, `Horizontal`→`x`, `Both`→`xy` | — | Allowed fill-drag axes |

---

#### Band `Grouping` (`grouping`)

| # | UI label | Type | Grid option | Default | Select values | Hint | What it does |
|---|----------|------|-------------|---------|---------------|------|--------------|
| 27 | Group panel | select | `rowGroupPanelShow` | `never` | `Hidden`→`never`, `When grouping`→`onlyWhenGrouping`, `Always`→`always` | — | Visibility of the row-group drop panel |
| 28 | No sort from panel | switch | `rowGroupPanelSuppressSort` | off | — | `Panel chips stop cycling sort` | Group panel chips do not cycle sort |
| 29 | Hide group counts | switch | `suppressCount` | off | — | — | Hide `(n)` counts on group rows |
| 30 | Hide agg in header | switch | `suppressAggFuncInHeader` | off | — | `P&L, not sum(P&L)` | Header shows field name without agg func prefix |

---

#### Band `Pivot` (`pivot`)

| # | UI label | Type | Grid option | Default | Select values / range | Hint | What it does |
|---|----------|------|-------------|---------|----------------------|------|--------------|
| 31 | Pivot panel | select | `pivotPanelShow` | `never` | `Hidden`→`never`, `When pivoting`→`onlyWhenPivoting`, `Always`→`always` | — | Pivot drop-panel visibility |
| 32 | Row totals | select | `pivotRowTotals` | `off` | `Off`→`off`→`null`, `Before`→`before`, `After`→`after` | — | Pivot row totals placement |
| 33 | Column group totals | select | `pivotColumnGroupTotals` | `off` | `Off` / `Before` / `After` (same mapping) | — | Totals under column groups |
| 34 | Expand to depth | number | `pivotDefaultExpanded` | 0 | 0–10 · step 1 | — | Initial expand depth of pivot tree |
| 35 | Grand totals | switch | `pivotGrandTotals` | off | — | `Excel-style pinned totals` | Show grand totals |
| 36 | Strict column order | switch | `enableStrictPivotColumnOrder` | off | — | `Re-sort keys every update` | Reorder generated pivot cols on every update |
| 37 | Max generated columns | number | `pivotMaxGeneratedColumns` | 5000 | min 0 · step 100 | — | Cap on generated pivot columns |

---

#### Band `Quick filter` (`quickFilter`)

| # | UI label | Type | Grid option | Default | Hint | What it does |
|---|----------|------|-------------|---------|------|--------------|
| 38 | Search hidden columns | switch | `includeHiddenColumnsInQuickFilter` | off | — | Quick filter (title-bar search) also matches hidden columns |

---

#### Band `Advanced` (`advanced`)

| # | UI label | Type | Grid option | Default | Range | Hint | What it does |
|---|----------|------|-------------|---------|-------|------|--------------|
| 39 | Row buffer | number | `rowBuffer` | (empty = auto) | 0–100 · step 1 | `Overscan rows (empty = auto)` | Extra rows rendered beyond viewport |
| 40 | Async txn wait | number | `asyncTransactionWaitMillis` | (kernel ~50) | 0–5000 · step 10 | `Debounce ms (default 50)` | Debounce before flushing async row transactions |
| 41 | Conflate async txns | switch | `asyncTransactionConflate` | on | — | `Last-write-wins per row in the batch` | Collapse multiple updates to same row in a batch |
| 42 | Update throttle | number | `asyncTransactionThrottleMillis` | 200 | 100–1000 · step 50 | `Min ms between updates (default 200 = 5/s)` | Rate-cap continuous streams (panel cannot set `0` = off) |
| 43 | No column virtualisation | switch | `suppressColumnVirtualisation` | off | — | — | Render all columns (no horizontal virt) |
| 44 | No row virtualisation | switch | `suppressRowVirtualisation` | off | — | — | Render all rows (no vertical virt) |

---

#### Band `Default column` (`defaultColDef`)

Fans out properties of the single `defaultColDef` object. Field keys in the form are `defaultColDef.{prop}`.

| # | UI label | Type | `defaultColDef` prop | Hint | What it does |
|---|----------|------|----------------------|------|--------------|
| 45 | Resizable | checkbox | `resizable` | — | New columns resizable by default |
| 46 | Sortable | checkbox | `sortable` | — | Sortable by default |
| 47 | Editable | checkbox | `editable` | — | Editable by default |
| 48 | Lock position | checkbox | `suppressMovable` | — | Columns cannot be reordered by drag |
| 49 | Wrap text | checkbox | `wrapText` | — | Wrap cell text |
| 50 | Wrap header text | checkbox | `wrapHeaderText` | `Multi-line column headers` | Wrap header captions |
| 51 | Auto header height | checkbox | `autoHeaderHeight` | `Header row fits wrapped text` | Header height grows for wraps |
| 52 | Groupable | checkbox | `enableRowGroup` | `Drag into row groups` | Eligible for row grouping |
| 53 | Pivotable | checkbox | `enablePivot` | `Drag into column labels` | Eligible for pivot |
| 54 | Aggregatable | checkbox | `enableValue` | `Drag into values` | Eligible as value/agg column |
| 55 | Width | number | `width` | min 20 · max 1000 | Default column width |
| 56 | Min width | number | `minWidth` | min 10 · max 500 | Default min width |
| 57 | Max width | number | `maxWidth` | min 20 · max 2000 | Default max width |
| 58 | Flex | number | `flex` | min 0 · max 10 | Default flex grow |

---

#### Band `Colours` (`colors`) — only when theme colour API present

Native colour pickers writing theme tokens via `setThemeParams` / `setThemeColor`.

| # | UI label | Type | Theme token | Hint | What it does |
|---|----------|------|-------------|------|--------------|
| 59 | Row hover | color | `--vg-row-hover-bg` | `Hovered row background` | Row hover fill |
| 60 | Row selection | color | `--vg-row-selected-bg` | `Selected row background` | Selected row fill |
| 61 | Cell range fill | color | `--vg-range-fill-color` | `Range selection interior` | Range selection fill |
| 62 | Cell range border | color | `--vg-range-border-color` | — | Range selection border |
| 63 | Cell flash | color | `--vg-flash-from-color` | `Change-flash colour` | Change-flash start colour |

---

#### Runtime options deliberately **not** on this tab

These are mutable at the API but excluded from the Options UI (`GRID_OPTIONS_SCHEMA_EXCLUDED`):

| Option key | Why excluded |
|------------|--------------|
| `theme` | App/host chrome owns theme class toggle |
| `context` | Opaque app object |
| `loading` / `loadingMessage` | Transient busy UI |
| `debug` | Developer flag |
| `rowData` / `pinnedTopRowData` / `pinnedBottomRowData` | Data inputs |
| `quickFilterText` | Title-bar search owns this |
| `cacheQuickFilter` | Invisible token-cache toggle |
| `fillOperation` / `getContextMenuItems` / `processCellForClipboard` / `processCellFromClipboard` | Callbacks |
| `aggFuncs` | Function registry |
| `cellSelection` | Object option; no dedicated control yet |
| `defaultColDef` | Covered by Default column band fan-out |
| `enableExcelEditing` | Covered by Edit trigger → Excel-style |
| `paintCache` / `paintCacheOverscan` / `rasterCache` / `rasterCacheBudgetMB` | Perf escape hatches, not customizer-facing |

---


### 5.2 Column Groups (`column-groups`) — Layout

**Ext mount:** `modules/columnGroups.ts` · **UI body:** kernel `ColumnGroupsToolPanel` + Ext `mountFormatterStyleChrome`  
**Save** → `updateGridOptions({ columnDefs })` after validate. **Reset** → re-seed from live defs. Style/behavior edits are draft until Save.

#### Rail / chrome

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Groups` | label | — | — | — | — | Rail title |
| 2 | (count) | badge | — | `0` | — | — | Group count |
| 3 | `Add group` | icon button | creates group | name `New Group` | — | title/aria `Add group` | Adds root group to draft |
| 4 | `No groups yet. Click + to create one.` | empty text | — | — | — | — | Empty rail |
| 5 | `{headerName\|id}` | select button | `selectedId` | first group | — | aria `Select group {name}` | Select for editor |
| 6 | `Delete group` | icon button | `deleteGroup` | — | — | title/aria `Delete group` | Removes group from draft |
| 7 | `Reset` | button | — | disabled when clean | — | — | Discard draft → re-seed |
| 8 | `Save` | button | `columnDefs` | disabled when clean | — | data-vg-apply | Project tree to grid |
| 9 | `Select a group to edit its columns and style.` | empty text | — | — | — | — | No selection |

#### Selected group

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 10 | (untitled) | text | `headerName` | current name | — | aria `Group name` | Rename group (draft) |
| 11 | `Use the Columns side panel to show/hide columns and drag columns or groups into or out of a group.` | hint | — | — | — | — | Guidance |
| 12 | `Move up` | icon button | sibling order | — | — | title `Move up`; aria `Move group up` | Reorder among siblings |
| 13 | `Move down` | icon button | sibling order | — | — | title `Move down`; aria `Move group down` | Reorder among siblings |
| 14 | `Columns` | eyebrow | — | — | — | — | Membership section |
| 15 | `No columns in this group.` | empty text | — | — | — | — | Empty membership |
| 16 | chip `{headerName}` | chip | column in group | — | — | — | Shows member |
| 17 | show-mode cycle | icon button | `columnGroupShow` | `null` → Always | cycle: `null` / `open` / `closed` | title/aria: `Always visible` / `Show when open` / `Show when collapsed` | Visibility vs expand |
| 18 | `Remove from group` | icon button | move to unassigned | — | — | aria `Remove {name} from group` | Remove column |
| 19 | `+ Columns…` | button | — | disabled if none | — | aria `Add columns to group` | Open multi-picker |
| 20 | `Search columns…` | search | filter query | `''` | — | placeholder/aria `Search columns` | Filter unassigned |
| 21 | `Select all` | checkbox | — | — | — | aria `Select all visible columns` | Multi-select visible |
| 22 | `Add selected` / `Add selected ({n})` | button | — | disabled if 0 | — | — | Add picked cols to group |
| 23 | `No unassigned columns.` / `No matches.` | empty text | — | — | — | — | Picker empty |
| 24 | style chrome | see §6 | `headerStyle` facets | — | — | — | Live draft into `headerStyle` |
| 25 | `Behavior` | eyebrow | — | — | — | — | Always shown (Ext path) |
| 26 | `Keep columns together` | switch | `marryChildren` | `false` unless set | boolean | aria = label | Draft `marryChildren` |
| 27 | `Expanded by default` | switch | `openByDefault` | `false` unless set | boolean | aria = label | Draft `openByDefault` |

Kernel-only Fill & text / Border clusters appear only when Ext style chrome is **not** mounted — see kernel `columnGroupsPanel.ts` (`Fill`, `Text`, `B`/`I`/`U`, align, font size, `Side`/`Width`/`Style`/`Colour`).

---

### 5.3 Column Settings (`column-settings`) — Layout

**File:** `modules/columnSettings.ts`  
**Save** → `applyDraft`: `editColumn` flags, agg APIs, caption overrides, `setColumnsPinned`. Marks profile dirty. Defaults = live column state.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Columns` | caps | — | — | — | — | Rail head |
| 2 | `Filter columns…` | search | `filterQuery` | `''` | — | placeholder; aria `Filter columns` | Filter rail |
| 3 | `No columns.` / `No matches.` | empty | — | — | — | — | Empty rail |
| 4 | `{label}` | rail row | select col | first col | — | dirty `•` title `Unsaved changes` | Select |
| 5 | `Select a column to edit its settings` | empty | — | — | — | — | No selection |
| 6 | (head caption) | text | `headerName` | live header | — | placeholder `Caption`; aria `Column caption` | Draft caption |
| 7 | `Reset` | button | — | — | — | — | Discard draft |
| 8 | `Save` | button | — | — | — | — | Commit to grid |
| 9 | chip `Col id` | chip | `colId` | — | — | — | Summary |
| 10 | chip `Dirty` | chip | — | `—` / `YES` | — | — | Dirty flag |
| 11 | chip `Pinned` | chip | `pinned` | `OFF` or LEFT/RIGHT | — | — | Summary |
| 12 | chip `Hidden` | chip | `hide` | YES/NO | — | — | Summary |
| 13 | band `01` `Header` | band | — | — | — | — | Section |
| 14 | `Col id` | readonly text | `colId` | — | — | aria `Column id`; hint `Read-only · column identifier` | Id |
| 15 | `Caption` | text | `headerName` | — | — | placeholder `Display name in the column header`; hint `Header label shown on the grid` | Caption |
| 16 | band `02` `Filter` | band | — | — | — | — | Section |
| 17 | `Floating filter` | switch | `floatingFilter` | from col | bool | — | Save → `editColumn({ floatingFilter })` |
| 18 | `Filter type` | select | `filter` | `'auto'` if null/true | `auto`→`Auto`, `text`→`Text`, `number`→`Number`, `date`→`Date`, `set`→`Set` | — | Save → filter or `null` if auto |
| 19 | band `03` `Grouping` | band | — | — | — | — | Section |
| 20 | `Groupable` | switch | `enableRowGroup` | from col | bool | — | Save → flag |
| 21 | `Pivotable` | switch | `enablePivot` | from col | bool | — | Save → flag |
| 22 | band `04` `Aggregation` | band | — | — | — | — | Section |
| 23 | `Function` | select | `aggFunc` | `'none'` or live | `none`→`None`; `sum`/`avg`/`min`/`max`/`count`/`first`/`last` (+ custom) | — | Save → add/set/remove value column |
| 24 | `Show in header` | switch | `showAggInHeader` → `suppressAggFuncInHeader` inverted | from col | bool | hint when none: `Requires an aggregation function` | Save → `suppressAggFuncInHeader: !show` |
| 25 | band `05` `Behavior` | band | — | — | — | — | Section |
| 26 | `Sortable` | switch | `sortable` | from col | bool | — | Save |
| 27 | `Resizable` | switch | `resizable` | from col | bool | — | Save |
| 28 | `Editable` | switch | `editable` | from col | bool | — | Save |
| 29 | `Pinned` | select | `pinned` | `''` if unpinned | `''`→`None`, `left`→`Left`, `right`→`Right` | — | Save → `setColumnsPinned` |
| 30 | `Hidden` | switch | `hide` | from col | bool | hint `Hide the column on the grid` | Save |

Confirm on navigate: `Discard unsaved column changes?`

---

### 5.4 Data provider (`data-provider`) — Data *(opt-in)*

**File:** `modules/dataProvider.ts` · No Reset/Save — **Apply** commits.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Active provider` | section title | — | — | — | — | Section |
| 2 | `Provider` | label | — | — | for=`vgext-dp-active` | — | Field label |
| 3 | (select) | select | active `providerId` | current / `''` | `— None —` value `''`; options `{name} ({providerType})` | — | Choose catalog entry |
| 4 | `Apply` | primary button | `setActiveProvider(id,{force:true})` | — | — | Hub: `Apply attaches the selected catalog provider…` | Bind provider; persist selection |
| 5 | `Edit…` | button | — | — | — | title `Open the shared data-provider editor popout` | Popout for selected/active |
| 6 | `Manage…` | button | — | — | — | title `Open the catalog editor (all providers)` | Popout catalog (`providerId=null`) |
| 7 | `Refresh` | button | — | — | — | — | Rebuild select from catalog |

Post-Apply hints: `Cleared active provider · selection saved for next load.` · `Applied "{id}" · {status} · {n} rows · selection saved for next load.` · `Pop-up blocked — allow pop-ups for this origin, then try Edit / Manage again.`

Full authoring UI: [data-provider-editor-feature-reference.md](./data-provider-editor-feature-reference.md).

---

### 5.5 Perspective Data provider (`perspective-data-provider`) — Data *(opt-in)*

Same controls as §5.4 (`Apply` / `Edit…` / `Manage…` / `Refresh`). Hint: `Apply attaches a View on the shared DataProvider book (SSRM)…` · post-Apply: `Applied "{id}" · Perspective SSRM bound · selection saved for next load.`

---

### 5.6 Calculated Columns (`calculated-columns`) — Data

**File:** `modules/calculatedColumns.ts`  
**Save** → CSRM: `compileCalc` + `registerCalculatedColumn`; SSRM/Perspective: validate + `setExpressions` + columnDef. New defaults: `headerName: 'New Column'`, `expression: ''`, `cellDataType: 'number'`, generated `colId`.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Columns` | caps + count | — | — | — | — | Rail |
| 2 | `+` | add button | — | — | — | title `Add calculated column` | New draft |
| 3 | `Delete` | icon button | — | — | — | title `Delete` | Remove immediately (marks dirty) |
| 4 | `Select a calculated column, or add one with +` | empty | — | — | — | — | Empty pane |
| 5 | (title) | text | `headerName` | `New Column` | — | placeholder `Header name` | Caption draft |
| 6 | `Reset` / `Save` | buttons | — | — | — | ⌘↵ in editor also saves | Discard / persist |
| 7 | chips `Column id` / `Refs` / `Formatter` / `Width` | chips | — | Refs `n COLS`; Formatter SET/—; Width nPX/AUTO | — | — | Summary |
| 8 | `Column id` | text mono | `colId` | generated | — | CSRM: `Unique — must not collide with data fields`; PSP: `Perspective expression alias — must not collide with table fields` | Alias id |
| 9 | band `01` `Expression` | band | — | — | — | — | Section |
| 10 | (expression editor) | editor | `expression` | `''` | — | CSRM placeholder `[price] * [quantity]`; PSP `// MyCalc\n"pnl" + "dailyPnl"` | Formula |
| 11 | band `02` `Value formatter` | band | — | — | — | — | Section |
| 12 | `Format` / preview | format picker | `format` | unset; title `No format` | format picker | — | Draft format string |
| 13 | band `03` `Placement` | band | — | — | — | — | Section |
| 14 | `Data type` | select | `cellDataType` | `number` | labels UPPER: `NUMBER` `CURRENCY` `PERCENT` `DATE` `DATETIME` `STRING` `BOOLEAN` | — | Type |
| 15 | `Width` | number | `initialWidth` | unset | — | placeholder `auto`; suffix `PX` | Width |
| 16 | `Pinned` | pills | `initialPinned` | `''` None | `''`→`None`, `left`→`Left`, `right`→`Right` | — | Pin |
| 17 | `Position` | number | `position` | index | — | hint `Insertion order among calculated columns` | Order |

Confirm: `Discard unsaved column changes?`

---

### 5.7 Expressions (`expression-lab`) — Data *(opt-in)*

**File:** `modules/expressionLab.ts` · No Save/Reset. Change → `profiles.markDirty()` only.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Expression` | band | — | — | — | — | Section |
| 2 | `Formula` | field + editor | editor `value` | `''` | — | hint `Uses @wellsfargo-starui/velocity-grid-expression — e.g. [pnl] > 0` | Lab formula; marks profile dirty |

---

### 5.8 Styling Rules (`conditional-styling`) — Format

**File:** `modules/conditionalStyling.ts` · title **Styling Rules**  
**Save** → `addRule` / `updateRule`. New defaults: `name: 'new_rule'`, `enabled: true`, `scope: {kind:'row'}`, `condition: 'true'`, `style: {base:{}}`.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Rules` | caps + count | — | — | — | — | Rail |
| 2 | `+` | add | — | — | — | title `Add rule` | New draft |
| 3 | `Clone` | icon | — | copy disabled, `name_copy` | — | title `Clone` | Clone as new draft |
| 4 | `Delete` | icon | — | — | — | title `Delete` | `deleteRule` immediately |
| 5 | `Select a rule, or add one with +` | empty | — | — | — | — | Empty |
| 6 | (name title) | text | `name` | `new_rule` | — | — | Rule name |
| 7 | `Reset` / `Save` | buttons | — | — | — | — | Discard / persist |
| 8 | chips Status/Scope/Priority/Applied | chips | — | ACTIVE\|OFF; CELL\|ROW; priority; Applied `n ROWS`\|— | — | — | Summary |
| 9 | `Status` | switch | `enabled` | `true` | bool | — | Draft enable |
| 10 | `Scope` | select | `scope.kind` | `row` | `cell`→`CELL`, `row`→`ROW` | — | Row vs cell; cell resets `columnIds:[]` |
| 11 | `Priority` | number | `priority` | rules.length | — | — | Order |
| 12 | band `01` `Expression` | band | — | — | — | — | Section |
| 13 | (editor) | editor | `condition` | `'true'` | — | placeholder `[price] > 110`; hint `Type [ for columns · ⌘↵ to save · [col.old] / [col.new]…` | Predicate |
| 14 | band `02` `Target columns` | band | cell only | — | — | — | Targets |
| 15 | col chips + `×` | chips | `scope.columnIds` | `[]` | — | warn `No columns · rule won’t apply` | Remove target |
| 16 | `ADD COLUMN…` | select | push to `columnIds` | `''` | `''`→`ADD COLUMN…`; then colIds | — | Add target |
| 17 | band `03` `Style` | band | `style.base` | `{}` | style chrome (§6; Alignment+size hidden in CSS) | hint about Bold/italic/colours/borders | Maps fg→`color`, bg→`backgroundColor` |
| 18 | band `07` `Flash on match` | band | `flash` | when on: `{enabled,target:'cell',mode:'fade',color:'#f0b90b',durationMs:700}` | — | — | Flash |
| 19 | `Flash` | switch | `flash.enabled` | false until set | bool | — | Enable flash |
| 20 | `Target` | pills | `flash.target` | `cell` | `cell`→`Cell`, `row`→`Row` | — | Flash target |
| 21 | `Mode` | pills | `flash.mode` | `fade` | `fade`/`pulse`/`glow` → Fade/Pulse/Glow | — | Animation |
| 22 | `Colour` | color | `flash.color` | `#f0b90b` | picker + clear `—` | — | Flash colour |
| 23 | `Duration` | number | `flash.durationMs` | `700` | suffix `MS` | — | Duration |
| 24 | `Style window` | number | `activeDurationMs` | unset | placeholder `persistent`; suffix `MS` | hint `Optional — match styling auto-reverts…` | Timed style |
| 25 | band `08` `Indicator` | band | `indicator` | unset | — | empty `Pick an icon below to add a match badge.` | Badge |
| 26 | icon tiles | icon grid | `indicator.iconName` | color `#ef4444`, target `cell`, position `after` | groups Direction/Alert/Status/Lifecycle/Favorite/Classification | tile title = icon name | Set indicator |
| 27 | `Clear` | button | — | — | — | — | Clear indicator |
| 28 | `Target` | pills | `indicator.target` | `cell` | `cell`→`Cells`, `row-start`→`Row start`, `row-end`→`Row end` | — | Badge target |
| 29 | `Position` | pills | `indicator.position` | `after` | `before`→`Before`, `after`→`After` | — | Before/after text |
| 30 | indicator colour | color | `indicator.color` | `#ef4444` | — | — | Icon colour |
| 31 | band `09` `Value formatter` | band | `valueFormatter` | unset | Format picker | title `No formatter` | Match-time format |

Confirm: `Discard unsaved rule changes?`

---

### 5.9 Alerts (`alerts`) — Format

**File:** `modules/alerts.ts`  
**Global settings** patch live via `setAlertsSettings` (no Save). **Rule Save** → `addAlertRule` / `updateAlertRule`. New rule: `name: 'New alert'`, `enabled: true`, `severity: 'warning'`, `message: '{rule} fired on {rowId}'`, `channels: ['toast','badge']`.

#### Global settings accordion

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Global settings` | accordion | — | closed | — | — | Expand globals |
| 2 | `Alerts enabled` | switch | `enabled` | `true` | bool | — | Live master kill |
| 3 | `Frequency` | pills | `evaluationMode` | `realtime` | `realtime`→`Realtime`, `throttled`→`Throttled`, `paused`→`Paused` | — | Live mode |
| 4 | `Default debounce` | number | `defaultDebounceMs` | `1000` | ≥0; suffix `ms` | — | Live |
| 5 | `Max / second` | number | `maxNotificationsPerSecond` | `10` | ≥1 | — | Live |
| 6 | `History limit` | number | `historyLimit` | `200` | ≥1 | — | Live |
| 7 | `Channels` | caps | — | — | — | — | Channel group |
| 8 | `toast` / `badge` / `openfin` | switches | `enabledChannels.*` | all `true` | bool | openfin: `OpenFin not available` when unavailable | Live channel gates |

#### Rule editor

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 9 | `Alert rules` | caps + count | — | — | — | — | Rail |
| 10 | `+` | add | — | — | — | title `Add alert` | New draft |
| 11 | `No alerts yet.` | empty | — | — | — | — | Empty rail |
| 12 | `Delete` | icon | — | — | — | title `Delete` | Immediate delete |
| 13 | `Select an alert, or add one with +` | empty | — | — | — | — | Empty pane |
| 14 | (title) | text | `name` | `New alert` | — | placeholder `Alert name` | Name |
| 15 | `Reset` / `Save` | buttons | — | — | — | — | Discard / persist rule |
| 16 | chips Severity/Trigger/Enabled | chips | — | — | — | — | Summary |
| 17 | band `01` `Rule` · `Enabled` | switch | `enabled` | `true` | bool | — | Draft enable |
| 18 | band `02` `Severity` | pills | `severity` | `warning` | `info` `success` `warning` `critical` | — | Severity |
| 19 | band `03` `Trigger` | pills | `trigger.kind` | `dataChange` | `dataChange`→`Expression`, `relativeChange`→`Δ Delta`, `rowChange`→`Row` | — | Replace trigger with defaults |
| 20 | (expr editor) | editor | `trigger.expression` | `''` | — | placeholder `[pnl] > 0` | dataChange only |
| 21 | `Column` | select | `trigger.columnIds[0]` | `''` any | `''`→`(any column)` + cols | — | Optional column scope |
| 22 | `Column` | select | `trigger.colId` | `''` | header labels / ids | — | relativeChange |
| 23 | `Mode` | pills | `trigger.mode` | `PERCENT_CHANGE` | `PERCENT_CHANGE`→`%`, `ABSOLUTE_CHANGE`→`Abs`, `ANY_CHANGE`→`Any` | — | Delta mode |
| 24 | `Threshold` | number | `trigger.threshold` | `5` | suffix `%` if percent | — | When not ANY |
| 25 | `Direction` | pills | `trigger.direction` | `both` | `both`/`up`/`down` → Both/Up/Down | — | Direction |
| 26 | `Event` | pills | `trigger.mode` | `ROW_ADDED` | `ROW_ADDED`→`Row added`, `ROW_REMOVED`→`Row removed` | — | rowChange |
| 27 | band `04` `Message` · `Template` | text | `message` | `{rule} fired on {rowId}` | — | placeholder same; hint `Placeholders: {rule} {rowId} {column} {value} {prev}` | Message |
| 28 | band `05` `Channels` · `toast`/`badge`/`openfin` | switches | `channels[]` | toast+badge | membership | openfin disable title as above | Per-rule channels |
| 29 | band `06` `Debounce` · `Debounce ms` | number | `debounceMs` | `0` → undefined | suffix `ms` | hint `0 = use global default` | Per-rule debounce |

Confirm: `Discard unsaved alert changes?`

---

### 5.10 Smart Edit (`smart-edit`) — Editing

**File:** `modules/smartEdit.ts` · Defaults from `DEFAULT_EDIT_SETTINGS.smartEdit`.  
**Save** → `updateSettings({ smartEdit })` + sync `history.recordSources.smartEdit`.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Smart Edit requires wireEditIntoKernel(grid).` | empty | — | — | — | — | Ungated |
| 2 | `Smart Edit` | title | — | — | — | — | Card |
| 3 | `Reset` / `Save` | buttons | — | — | — | — | Discard / commit |
| 4 | band `01` `Global` · `Enabled` | switch | `enabled` | `true` | bool | — | Feature on |
| 5 | `Increment step` | number | `incrementStep` | `1` | — | — | Default step |
| 6 | `K/M/B shortcuts` | switch | `magnitudeShortcutsEnabled` | `true` | bool | `Parse K/M/B suffixes in numeric cell editors` | Magnitude parse |
| 7 | band `02` `Operations` · `Toolbar ops` | multi pills | `enabledOps` | all five | `×`→`multiply`, `÷`→`divide`, `+`→`add`, `−`→`subtract`, `Set`→`set`; ≥1 kept | — | Which toolbar ops |
| 8 | band `03` `Safety` · `Confirm above N` | number | `confirmThreshold` | `0` | ≥0 | `0 = never` | Confirm if ≥N cells |
| 9 | `Single column` | switch | `enforceSingleColumn` | `true` | bool | — | One-col ops |
| 10 | `Preview before` | switch | `previewBeforeApply` | `true` | bool | — | Preview |
| 11 | `Record history` | switch | `recordHistory` | `true` | bool | `Logs operations to the undo/redo journal` | History sync |

---

### 5.11 Bulk Update (`bulk-update`) — Editing

**File:** `modules/bulkUpdate.ts` · Defaults `DEFAULT_EDIT_SETTINGS.bulkUpdate`.  
**Save** → `bulkUpdate` + `history.recordSources.bulkUpdate`.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Bulk Update requires wireEditIntoKernel(grid).` | empty | — | — | — | — | Ungated |
| 2 | `Bulk Update` | title | — | — | — | — | Card |
| 3 | `Reset` / `Save` | buttons | — | — | — | — | Discard / commit |
| 4 | band `01` `Global` · `Enabled` | switch | `enabled` | `true` | bool | — | Feature |
| 5 | `Confirm threshold` | number | `confirmThreshold` | `0` | ≥0 | `0 = never` | Confirm ≥N |
| 6 | `Single column` | switch | `enforceSingleColumn` | `true` | bool | — | One col |
| 7 | `Record history` | switch | `recordHistory` | `true` | bool | `Logs operations to the undo/redo journal` | History sync |
| 8 | band `02` `Dropdown` · `Distinct values` | switch | `showDistinctValues` | `true` | bool | — | Distinct picker |
| 9 | `Max dropdown` | number | `maxDropdownValues` | `20` | ≥1 | — | Cap |

---

### 5.12 Plus / Minus (`plus-minus`) — Editing

**File:** `modules/plusMinus.ts` · Settings defaults `{ enabled: true, recordHistory: true }`. New nudge: `name: 'New nudge'`, `enabled: true`, `scope.columnIds: []`, `incrementStep: 1`.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Nudges` | caps + count | — | — | — | — | Rail |
| 2 | `+` | add | — | — | — | title `Add nudge` | New draft |
| 3 | `Delete` | icon | — | — | — | title `Delete` | Immediate remove |
| 4 | `Plus / Minus requires wireEditIntoKernel(grid).` | empty | — | — | — | — | Ungated |
| 5 | `Select a nudge, or add one with +` | empty | — | — | — | — | No nudge |
| 6 | `Reset` / `Save` | buttons | — | — | — | — | Discard / commit settings+nudge |
| 7 | band `00` `Global` · `Enabled` | switch | `plusMinus.enabled` | `true` | bool | `When enabled, +/- keys use these nudges` | Master |
| 8 | `Record history` | switch | `recordHistory` | `true` | bool | — | + recordSources sync |
| 9 | band `01` `Nudge` · `Name` | text | `name` | `New nudge` | — | — | Label |
| 10 | `Enabled` | switch | `enabled` | `true` | bool | — | Per-nudge |
| 11 | `Columns` | text | `scope.columnIds` | `[]` | comma ids | placeholder `colIds, comma-separated (empty = all numeric)` | Scope |
| 12 | `Increment` | number | `incrementStep` | `1` | — | — | + step |
| 13 | `Decrement` | number | `decrementStep` | undefined | — | `Optional — defaults to increment` | − step |
| 14 | band `02` `Expression gate` | editor | `expression` | unset | — | placeholder `optional row gate — empty = always`; hint `Falsy / throw skips the nudge for that row` | Row gate |

Confirm: `Discard unsaved nudge changes?`

---

### 5.13 Shortcuts (`shortcuts`) — Editing

**File:** `modules/shortcuts.ts` · Settings defaults `{ enabled: true, recordHistory: true }`. New shortcut: `name: 'New shortcut'`, `enabled: true`, `shortcutKey: 'q'`, `operation: 'add'`, `shortcutValue: 1`.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Shortcuts` | caps + count | — | — | — | — | Rail |
| 2 | `+` | add | — | — | — | title `Add shortcut` | New draft |
| 3 | `Delete` | icon | — | — | — | title `Delete` | Immediate remove |
| 4 | `Shortcuts requires wireEditIntoKernel(grid).` | empty | — | — | — | — | Ungated |
| 5 | `Select a shortcut, or add one with +` | empty | — | — | — | — | No item |
| 6 | `Reset` / `Save` | buttons | — | — | — | — | Discard / commit |
| 7 | band `00` `Global` · `Enabled` | switch | `shortcuts.enabled` | `true` | bool | `Focus a numeric cell and press a letter key` | Master |
| 8 | `Record history` | switch | `recordHistory` | `true` | bool | — | + recordSources |
| 9 | band `01` `Shortcut` · `Name` | text | `name` | `New shortcut` | — | — | Label |
| 10 | `Enabled` | switch | `enabled` | `true` | bool | — | Per-item |
| 11 | `Key` | text maxlen 1 | `shortcutKey` | `q` | a–z only | placeholder `a-z` | Binding (normalized lowercase) |
| 12 | `Operation` | pills | `operation` | `add` | `×`/`÷`/`+`/`−` → multiply/divide/add/subtract | — | Op |
| 13 | `Value` | number | `shortcutValue` | `1` | — | — | Operand |
| 14 | `Columns` | text | `scope.columnIds` | `[]` | — | placeholder `colIds, comma-separated (empty = all)` | Scope |

Confirm: `Discard unsaved shortcut changes?`

---

### 5.14 Edit History (`data-change-history`) — Editing

**File:** `modules/dataChangeHistory.ts` · title **Edit History** · Defaults `DEFAULT_EDIT_SETTINGS.history`.  
**Save** → `updateSettings({ history })`. **Suspended** applies immediately.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Edit History requires wireEditIntoKernel(grid).` | empty | — | — | — | — | Ungated |
| 2 | `Edit History` | title | — | — | — | — | Card |
| 3 | chip `Stack` | chip | journal length | `0` | — | — | Live stack size |
| 4 | `Reset` / `Save` | buttons | — | — | — | — | Discard / commit (Suspended already live) |
| 5 | band `01` `Global` · `Enabled` | switch | `enabled` | `true` | bool | — | History master |
| 6 | `Suspended` | switch | `suspended` | `false` | bool | `Pauses recording immediately — does not wait for Save` | Live pause |
| 7 | `Max Entries` | number | `maxEntries` | `50` | ≥5 | — | Cap |
| 8 | `Unify Undo` | switch | `unifyUndo` | `true` | bool | `Edit journal owns undo; disable native cell undo when available` | Unify |
| 9 | band `02` `Record Sources` · `Smart Edit` | switch | `recordSources.smartEdit` | `true` | bool | — | Source gate |
| 10 | `Bulk Update` | switch | `recordSources.bulkUpdate` | `true` | bool | — | Source gate |
| 11 | `Plus / Minus` | switch | `recordSources.plusMinus` | `true` | bool | — | Source gate |
| 12 | `Shortcuts` | switch | `recordSources.shortcuts` | `true` | bool | — | Source gate |
| 13 | `Cell Editor` | switch | `recordSources.cellEditor` | `true` | bool | — | Source gate |
| 14 | `Stream Updates` | switch | `recordSources.stream` | `false` | bool | `Live ticker writes — off by default` | Source gate |
| 15 | band `03` `Monitor` | band | — | — | — | empty `No edits recorded this session.` / `Edit engine is not wired.` | Live journal |
| 16 | entry text | display | — | — | — | — | `{Source} · {time} · {label} ({n} cells)` |
| 17 | `Undo` | button | — | disabled if not in undo stack | — | title `Undo this entry and everything since` | `journal.undoEntry` |

---

## 6. Shared style chrome

**File:** `toolbar/styleChrome.ts` · `mountFormatterStyleChrome`  
Used in **Column Groups** and **Styling Rules → Style**. Live draft via `applyStyle(patch)` — host Save persists. In Styling Rules, CSS hides font-size stepper and Alignment.

| # | UI label | Type | Setting / key | Default | Options / range | Hint | What it does |
|---|----------|------|---------------|---------|-----------------|------|--------------|
| 1 | `Font` | group label | — | — | — | — | Section |
| 2 | `Bold` | toggle | `fontWeight` | off unless bold/700 | on↔`bold` | title/aria `Bold` | Toggle bold |
| 3 | `Italic` | toggle | `fontStyle` | off unless italic | on↔`italic` | title/aria `Italic` | Toggle italic |
| 4 | `Underline` | toggle | `textDecoration` | off unless underline | on↔`underline` | title/aria `Underline` | Toggle underline |
| 5 | `Strikethrough` | toggle | `textDecoration` | off unless line-through | on↔`line-through` | title/aria `Strikethrough` | Toggle strike |
| 6 | `{n}px` | stepper | `fontSize` | display `12` if unset | 8–32 via Larger/Smaller | titles `Larger font` / `Smaller font` | ±1px (hidden in Styling Rules) |
| 7 | `Text color` | color | `fg` | `#e5e9f0` | picker | title/aria `Text color` | Text colour |
| 8 | `Fill color` | color | `bg` | `#12333a` | picker | title/aria `Fill color` | Fill colour |
| 9 | `Alignment` | group | — | — | — | — | Hidden in Styling Rules |
| 10 | `Align left` / `center` / `right` | toggles | `halign` | `'left'` | `left`\|`center`\|`right` | title/aria each | Horizontal align |
| 11 | `Borders` | group | — | — | — | — | Section |
| 12 | `All borders` / Top/Bottom/Left/Right | side toggles | view `borderSide` | `'all'` | `all`\|`top`\|`bottom`\|`left`\|`right` | title/aria as listed | Select edge |
| 13 | (preview) | preview | — | — | — | title `Current borders` | Visual only |
| 14 | `Border color` | color | `border[side].color` | `#e5e9f0` | picker | title/aria `Border color` | Border colour |
| 15 | `Solid` (pill) | pill menu | `border[side].style` | `'solid'` | Solid/Dashed/Dotted → solid/dashed/dotted | — | Border style |
| 16 | `1 px` (pill) | pill menu | `border[side].width` | `1` | `1 px`…`4 px` | — | Border width |
| 17 | `Remove the border at this side` | icon | `border` | — | `all` clears whole; else one side | title/aria as label | Eraser |

---

## 7. Related surfaces (not Customize tabs)

| Surface | File | Role |
|---------|------|------|
| Format mini-bar | `formatMiniBar.ts` | Compact format actions |
| Format context menu | `formatContextMenu.ts` | Right-click format items |
| Auto format | `autoFormat/` | Field-name → format catalog |
| Color swatch | `colorSwatch.ts` | Shared picker |
| Icon picker | `iconPicker.ts` | Icons / emoji |
| Expression editor | `ui/expressionEditor.ts` | Shared formula editor |
| DataProvider editor popout | `@wellsfargo-starui/velocity-grid-data` | [Full control inventory](./data-provider-editor-feature-reference.md) |

---

## 8. Composition checklist

| Feature | Default bundle | Markets-shaped demo |
|---------|----------------|---------------------|
| Settings / Save text buttons | Yes | Usually removed |
| Customize modules (layout/format/editing) | Yes | Yes |
| Title bar | No — add `titleBarExtensions` | Yes |
| Format + Edit ribbons | No — add `ribbonExtensions` | Yes |
| Data provider / Perspective DP | No — opt-in | Sample-dependent |
| Expression lab | No — opt-in | Optional |

---

## 9. Source map

| Area | Path |
|------|------|
| Ext class | `packages/ext/src/velocityGridExt.ts` |
| Shell / drawer | `packages/ext/src/shell/shell.ts` |
| Default modules | `packages/ext/src/defaultBundle.ts` |
| Title bar | `packages/ext/src/toolbar/titleBar.ts` |
| Ribbons | `packages/ext/src/toolbar/ribbon.ts` |
| Cockpit UI | `packages/ext/src/ui/cockpit.ts` |
| Settings modules | `packages/ext/src/modules/*.ts` |
| Grid Options schema | `packages/kernel/src/core/optionSchema.ts` |
| Column Groups panel | `packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts` |
| Public exports | `packages/ext/src/index.ts` |

---

*Document generated from the `main` branch implementation of `@wellsfargo-starui/velocity-grid-ext`. If UI strings or bands drift, prefer the module source over this file.*
