# 19 — Toolbar Date Settings

> Specialized panel: 4 sections (as-of-date AppData, data provider, event callbacks, row exclusion expression). Sidebar nav with scroll tracking. Dual-staging architecture (module draft + 2 host-staged slots).

Engine module: toolbar-date-settings (specialized module; not in the standard 15)

## Purpose

Configure trading-app-specific behavior: enable as-of-date AppData writes, select live vs historical data providers, bind grid-event callbacks (e.g., onDateChange → handler), and define a row-exclusion expression to hide rows based on column values.

## Invocation

Settings Sheet → Options → Custom Settings.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│ Custom Settings              [Reset]  [Save]             │
├──────────────────────────────────────────────────────────┤
│ 01 TOOLBAR DATE                                          │
│ 02 DATA PROVIDER  ← clickable sidebar nav               │
│ 03 CALLBACKS                                             │
│ 04 ROW FILTER                                            │
├──────────────────────────────────────────────────────────┤
│ 01 TOOLBAR DATE PICKER                                  │
│   ENABLED         [toggle]                              │
│   PROVIDER        [select: positions]    (if enabled)   │
│   KEY             [select: asOfDate]     (if enabled)   │
│                                                         │
│ 02 DATA PROVIDER                                        │
│   <ProviderGridHostSection>                            │
│     LIVE PROVIDER       [select]                       │
│     HISTORICAL PROVIDER [select]                       │
│     MODE                [select: live / historical]    │
│     AS-OF DATE          [date picker]                  │
│                                                         │
│ 03 EVENT CALLBACKS                                      │
│   <GridEventBindingsSection>                           │
│     onDateChanged       [select: none / Handler-A]     │
│     onFilterChange      [select: none / Handler-B]     │
│                                                         │
│ 04 ROW EXCLUSION                                        │
│   "Exclude rows when:"                                  │
│   <ExpressionEditor multiline + autocomplete>          │
│   ✓ Valid — hides rows where this is true.            │
│   Examples: [active==false] [ccy=="INR"] [Clear]      │
└──────────────────────────────────────────────────────────┘
```

## Component tree

- **ToolbarDateSettingsPanel** (memo, no props)
  - ObjectTitleRow ("Custom Settings" + Save/Reset)
  - Flex body:
    - Sidebar nav (176px) — SectionNavItem × 4
    - Main content (scrollable, IntersectionObserver target)
      - Section 01 — TOOLBAR DATE PICKER (module draft fields)
      - Section 02 — DATA PROVIDER → **ProviderGridHostSection** (host-staged)
      - Section 03 — EVENT CALLBACKS → **GridEventBindingsSection** (host-staged)
      - Section 04 — ROW EXCLUSION (module draft + live validation)

## Props

None.

## Internal state — three tiers

```ts
{
  // Tier 1: Module draft (sections 01 + 04)
  moduleDraft: {
    historicalDateAppDataEnabled: boolean;
    historicalDateAppDataProvider: string;
    historicalDateAppDataKey: string;
    rowExclusionExpression: string;
  }

  // Tier 2: Provider staging (section 02)
  providerStaged: Staged<{
    liveProviderId: string | null;
    historicalProviderId: string | null;
    mode: 'live' | 'historical';
    asOfDate: Date | null;
  }>

  // Tier 3: Bindings staging (section 03)
  bindingsStaged: Staged<{ [eventId: string]: handlerId }>

  activeSection: '01' | '02' | '03' | '04';
}
```

## Interaction flows

**Sidebar click → scroll:**
```
click SectionNavItem → scrollToSection(index) → smooth-scroll +
  setActiveSection(index)
```

**Passive scroll tracking:**
```
IntersectionObserver fires as sections scroll → first intersecting section → setActiveSection
```

**Section 01 (module draft):**
```
toggle ENABLED → update('historicalDateAppDataEnabled', v)
select PROVIDER → update('historicalDateAppDataProvider', value) + clear KEY (cascade)
select KEY → update('historicalDateAppDataKey', value)
```

**Section 02 (provider staging — NOT auto-committed):**
```
user edits a field → providerStaged.set(patch) → staged value updates (held until Save)
```

**Section 03 (bindings staging):**
```
user binds an event → bindingsStaged.set({ [eventId]: handlerId })
```

**Section 04 (module draft + live validation):**
```
type in expression editor → update('rowExclusionExpression', expr) →
  auto-trim on blur/Enter → live validation: exprEngine.validate(expr) →
  show ✓ / ✗ feedback inline → click example button → populates editor → click clear → empties
```

**Save (commits all three tiers):**
```
[Save] → saveDate() commits module draft (sections 01/04) →
  providerHost?.available → commit provider staged via onLiveChange, onHistoricalChange,
    onModeChange, onAsOfDateChange →
  bindingsHost?.available → commit bindings staged via host.setBindings()
```

## Engine wiring

- **Module slice (sections 01 + 04)**: `ToolbarDateSettingsState` (moduleId, itemId='settings')
- **Provider host (section 02)**: `useProviderGridHost()` — grid-level host, NOT engine state
- **Bindings host (section 03)**: `useGridEventBindingsHost()` — grid-level host, NOT engine state

## Shared primitives used

- ObjectTitleRow, SettingsRow, SectionNavItem (local), SectionAnchor (local)
- BoolControl, Select / NativeOptionsSelect, IconInput
- ExpressionEditor (with live validation feedback)
- ProviderGridHostSection (sub-component)
- GridEventBindingsSection (sub-component)
- ChromeButton (sidebar nav)

## Design decisions worth copying

1. **Dual-staging architecture.** Module draft (sections 01 + 04) commits on Save like normal. Provider and Bindings sections use `useStaged()` — also waits for Save, but targets grid-level hosts instead of engine module state. **Lets users edit grid-host config without auto-committing**, deferring to explicit Save.

2. **`useStaged()` hook.** Mirrors `useModuleDraft` semantics but for grid-level host state. Tracks dirty via `jsonEqual()` serialization. Re-seeds only when clean + upstream changes.

3. **Live expression validation.** ExpressionEditor uses the same `ExpressionEngine` that runs the filter at runtime. "Valid" here = "will work" — authoritative, not approximate.

4. **Example expression buttons.** Four pre-filled examples (`active==false`, currency filter, negative amount, list membership). Click to populate the editor. Saves users from staring at a blank textarea.

5. **Conditional section visibility.** Section 01 shows PROVIDER + KEY only when ENABLED. Reduces visual clutter for disabled features.

6. **IntersectionObserver scroll tracking.** Same pattern as [Grid Options](08-grid-options.md). Reuse the implementation.

## cgrid translation

This panel is starui-specific (financial app concerns: as-of-date, provider hosts, OpenFin bindings). For velocity-grid:

1. **Skip the provider + bindings sections** unless cgrid has equivalent host integration concepts (it doesn't, currently).
2. **Keep the row-exclusion section.** This is a powerful general-purpose feature — user-authored expression that filters rows. cgrid's worker filter pipeline can accept this as a global filter expression.
3. **Sidebar nav + IntersectionObserver** — reusable from [Grid Options](08-grid-options.md).

**Simplified cgrid version**: a "Row Filter" panel with just section 04 (the expression-based row filter). Sections 01–03 are host-specific and don't belong in the cgrid library — they'd live in the host app that consumes cgrid.

Build a stripped-down `<cgrid-row-filter-panel>` in Phase 2, after Grid Options is working (reuses its sidebar pattern).
