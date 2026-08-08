# Formatter toolbar — responsive wrap + overflow

## Goal
Make the formatting (and editing) ribbon use space better, wrap with its container, and keep every control available via a priority overflow menu when width is tight.

## Behavior
1. **Density** — tighter group padding/gaps; control hit targets stay 24×24.
2. **Group wrap** — labelled groups stay intact and wrap to additional rows (`flex-wrap`).
3. **Max rows before overflow** — formatting band: 2 rows; editing strip: 1 row.
4. **Overflow priority (formatting, first out)** — Templates → Clear → Column → Icons. Always in-strip: Target, Font, Alignment, Borders, Format.
5. **Overflow priority (editing)** — Bulk → Smart edit. History stays visible.
6. **Overflow UI** — `⋯` before the strip close button; panel hosts the moved groups (same DOM nodes / wiring). Hidden when empty.

## Non-goals
- No feature removal or regrouping of controls inside a group.
- No horizontal scrollbar on the ribbon.
