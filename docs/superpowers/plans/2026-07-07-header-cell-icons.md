# Header & Cell Icon Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Headers get parity with data cells for icons/emojis (6-position decorators, content slots, prefix/suffix `headerIcon`), and the ext Formatting ribbon gains an "Icons" section — categorized 8-per-row icon/emoji tile picker, color picker, and an 8-position placement slot selector.

**Architecture:** Reuse the existing cell machinery wholesale: `headerCell` calls the same `renderContentSlot` / `paintCellDecorators` the data painters use; `headerIcon` mirrors `cellIcon`'s slot-claim + padding-shift in `byRows.ts`; the ribbon writes through the existing `editColumn` own-template channel (`cellIcon`/`headerIcon` become templatable keys; decorators already ride `cellStyle`/`headerStyle`).

**Tech Stack:** TypeScript, canvas 2D (Path2D + fillText), vitest, Playwright, Vite. Monorepo workspaces: `@cgrid/kernel`, `@cgrid/format`, `@cgrid/calc`, `@cgrid/ext`, demo app `apps/cgrid-ext-demo`.

**Spec:** `docs/superpowers/specs/2026-07-07-header-cell-icons-design.md`

## Global Constraints

- Branch: `cgridext/header-cell-icons` (already created off `cgridext/foundation`). Never commit to `main`.
- Sort-chevron collisions with trailing icons / tr/mr decorators are the **author's responsibility** — no auto-avoid, no chevron suppression.
- `headerIcon` is **leaf-header only**. No group-level `headerIcon`.
- `editColumn` accepts **static `IconRef` objects only** for `cellIcon`/`headerIcon` (JSON-serializable); function forms stay colDef-authoring-only.
- An `IconRef` must have exactly one of `name` / `emoji`; anything else paints nothing (silent, same as an unregistered icon name today).
- `color` on an `IconRef` is ignored for emoji.
- Every UI element must look sleek/professional — the Task 6 implementer MUST read the `frontend-design` skill before writing picker DOM/CSS.
- The tile grid is exactly **8 tiles per row**, grouped under category headings, with a search box.
- E2E runs against `apps/cgrid-ext-demo` (port 5188) — the Formatting ribbon exists ONLY there (not in cgrid-customizer-demo). Kill any automation browser when verification finishes.
- Run commands from the repo root `/Users/develop/wfh/canvasgrid` unless stated otherwise.

---

### Task 1: Emoji `IconRef` + emoji rendering for cell prefix/suffix icons

**Files:**
- Modify: `packages/format/src/types.ts:83-87` (IconRef)
- Modify: `packages/kernel/src/renderer/painters/byRows.ts:38-63` (PendingCellIcon + drawCellIcon), `byRows.ts:828-863` (resolution block)
- Test: `packages/kernel/tests/byRowsCellIcon.test.ts` (extend)

**Interfaces:**
- Consumes: existing `resolveIcon` from `packages/kernel/src/icons/registry.ts` (returns `Path2D | null`).
- Produces: `IconRef = { name?: string; emoji?: string; color?: string; position?: 'leading' | 'trailing' }` — Tasks 3, 4, 6 rely on this exact shape. `PendingCellIcon` gains `path: Path2D | null; emoji?: string` — Task 3 reuses it for headers.

- [ ] **Step 1: Write the failing test**

Append to `packages/kernel/tests/byRowsCellIcon.test.ts` (reuse the file's existing `fakeGc` / `makeVs` / theme / subgrid helpers and its existing colDef-building pattern — copy how the current tests construct a data column with `cellIcon` and call `paintCellsByRows`):

```ts
it('renders an emoji IconRef via fillText in the leading slot and shifts text', () => {
  const gc = fakeGc();
  const defs = makeDefs({
    cellIcon: () => ({ emoji: '🔥', position: 'leading' as const }),
  });
  paint(gc, defs); // same harness call the existing cellIcon tests use
  // Emoji drawn: some fillText call received the emoji glyph.
  const emojiCall = (gc.fillText as any).mock.calls.find((c: unknown[]) => c[0] === '🔥');
  expect(emojiCall).toBeTruthy();
  // No Path2D stroke for the icon (emoji path).
  // Text shifted: the cell's value text x is greater than the no-icon baseline.
});

it('ignores an IconRef with neither name nor emoji', () => {
  const gc = fakeGc();
  const defs = makeDefs({ cellIcon: () => ({ position: 'leading' as const }) as any });
  expect(() => paint(gc, defs)).not.toThrow();
  const emojiCall = (gc.fillText as any).mock.calls.find((c: unknown[]) => c[0] === '🔥');
  expect(emojiCall).toBeFalsy();
});
```

Adapt helper names to what the file actually uses (it has inline setup, not `makeDefs`/`paint` — mirror the existing test bodies exactly, changing only the `cellIcon` return value and assertions).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @cgrid/kernel run test -- tests/byRowsCellIcon.test.ts`
Expected: FAIL — the new emoji test finds no `fillText('🔥', …)` call (current code requires `iconRef.name`).

- [ ] **Step 3: Update `IconRef` in `packages/format/src/types.ts`**

Replace lines 83-87:

```ts
export interface IconRef {
  /** Registered icon name (icon-set registry / Lucide). Exactly one of name|emoji. */
  name?: string;
  /** Unicode emoji glyph, drawn via fillText. Exactly one of name|emoji. */
  emoji?: string;
  /** Tint for Path2D icons. Ignored for emoji. */
  color?: string;
  position?: 'leading' | 'trailing';
}
```

- [ ] **Step 4: Emoji branch in `byRows.ts`**

Update `PendingCellIcon` (line ~38):

```ts
interface PendingCellIcon {
  path: Path2D | null;   // null → emoji glyph
  emoji?: string;
  x: number;
  y: number;
  size: number;
  tint: string;
}
```

Update `drawCellIcon` (line ~52):

```ts
function drawCellIcon(gc: CachedContext2D, icon: PendingCellIcon): void {
  gc.cache.save();
  if (icon.path === null) {
    // Emoji glyph — native text, color/tint not applicable.
    gc.cache.font = `${icon.size}px sans-serif`;
    gc.cache.textAlign = 'center';
    gc.cache.textBaseline = 'middle';
    gc.fillText(icon.emoji!, icon.x + icon.size / 2, icon.y + icon.size / 2);
    gc.cache.restore();
    return;
  }
  gc.translate(icon.x, icon.y);
  const scale = icon.size / 24; // Lucide viewBox is 24×24
  gc.scale(scale, scale);
  gc.cache.strokeStyle = icon.tint;
  gc.cache.lineWidth = 2 / scale;
  gc.cache.lineCap = 'round';
  gc.cache.lineJoin = 'round';
  gc.stroke(icon.path);
  gc.cache.restore();
}
```

Update the resolution block (currently `if (iconRef && iconRef.name) { const path = resolveIconPath(iconRef.name); if (path) { … } }` at ~line 840). Replace with:

```ts
        if (iconRef && (iconRef.name || (iconRef as { emoji?: string }).emoji)
            && !(iconRef.name && (iconRef as { emoji?: string }).emoji)) {
          const emoji = (iconRef as { emoji?: string }).emoji;
          const path = iconRef.name ? resolveIconPath(iconRef.name) : null;
          if (path || emoji) {
            const iconSize = Math.floor(row.height * 0.55);
            const position = iconRef.position ?? 'leading';
            pendingIcon = {
              path,
              emoji,
              x: position === 'leading'
                ? col.left + CELL_ICON_EDGE_PAD
                : col.left + col.width - CELL_ICON_EDGE_PAD - iconSize,
              y: row.top + (row.height - iconSize) / 2,
              size: iconSize,
              tint: iconRef.color ?? config.fg,
            };
            const pad = { ...(config.padding ?? {}) };
            if (position === 'leading') {
              pad.left = (pad.left ?? CELL_ICON_EDGE_PAD) + iconSize + CELL_ICON_GUTTER;
            } else {
              pad.right = (pad.right ?? CELL_ICON_EDGE_PAD) + iconSize + CELL_ICON_GUTTER;
            }
            config.padding = pad;
          }
        }
```

(The `ruleIconRef` local's inline type at ~line 808 stays `{ name: string; … }` — rules always carry a name; it's assignable to the widened check.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace @cgrid/kernel run test -- tests/byRowsCellIcon.test.ts`
Expected: PASS (all pre-existing cellIcon tests + 2 new).

- [ ] **Step 6: Typecheck both packages**

Run: `npm --workspace @cgrid/format run typecheck && npm --workspace @cgrid/kernel run typecheck`
Expected: clean. (`IconRef.name` becoming optional may surface consumers assuming `string` — the composite renderer's `resolveIcon` in `packages/kernel/src/renderer/cellRenderers/composite.ts` reads `FragIcon` which has its own type; if any consumer errors, guard with `if (ref.name)` at the use site, preserving behavior.)

- [ ] **Step 7: Commit**

```bash
git add packages/format/src/types.ts packages/kernel/src/renderer/painters/byRows.ts packages/kernel/tests/byRowsCellIcon.test.ts
git commit -m "feat(format,kernel): IconRef emoji variant — cellIcon prefix/suffix accepts emoji glyphs"
```

---

### Task 2: `headerCell` consumes `content` + `decorators`

**Files:**
- Modify: `packages/kernel/src/renderer/cellRenderers/registry.ts:596-790` (headerCell.paint)
- Test: Create `packages/kernel/tests/headerCellContentDecorators.test.ts`

**Interfaces:**
- Consumes: module-private `renderContentSlot(gc, p, content, cy, padLeft, padRight)` (registry.ts:387) and imported `paintCellDecorators(gc, bounds, decorators)` — both already exist; headerCell lives in the same module.
- Produces: headers render `headerStyle.content` (replacing the caption) and `headerStyle.decorators` (overlay, painted last). No signature changes.

- [ ] **Step 1: Write the failing test**

Create `packages/kernel/tests/headerCellContentDecorators.test.ts`. Paint `headerCell` directly with a hand-built config (no full byRows pass needed — mirror how existing registry-level tests build a `CellPaintConfig`; if none exists, build the minimal literal below):

```ts
// Header parity — headerCell renders content slots + decorators
// (Cycle 27 machinery, previously data-cell-only).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { headerCell } from '../src/renderer/cellRenderers/registry';
import { registerIcon } from '../src/renderer/icons';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

function fakeGc(): any {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    measureText: () => ({ width: 40 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(t, k) { return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx;
}

function headerConfig(overrides: Record<string, unknown> = {}): any {
  return {
    value: 'Price', valueFormatted: 'Price',
    bounds: { x: 0, y: 0, w: 120, h: 32 },
    fg: '#111', bg: '#eee', font: '12px Inter', halign: 'left',
    borderColor: '#ccc', prefillColor: '#eee',
    isFocused: false, isSelected: false, isHovered: false, isHeader: true,
    ...overrides,
  };
}

describe('headerCell content slot', () => {
  it('renders content text INSTEAD of the caption', () => {
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({ content: { kind: 'text', value: 'OVERRIDE' } }));
    const texts = gc.fillText.mock.calls.map((c: unknown[]) => c[0]);
    expect(texts).toContain('OVERRIDE');
    expect(texts).not.toContain('Price');
  });

  it('renders an emoji content slot', () => {
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({ content: { kind: 'emoji', value: '📈' } }));
    const texts = gc.fillText.mock.calls.map((c: unknown[]) => c[0]);
    expect(texts).toContain('📈');
    expect(texts).not.toContain('Price');
  });

  it('header checkbox wins over content (early return)', () => {
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({
      headerCheckboxState: 'none',
      content: { kind: 'text', value: 'OVERRIDE' },
    }));
    const texts = gc.fillText.mock.calls.map((c: unknown[]) => c[0]);
    expect(texts).not.toContain('OVERRIDE');
  });
});

describe('headerCell decorators', () => {
  it('paints an emoji decorator at each of the 6 positions', () => {
    for (const position of ['tl', 'tr', 'bl', 'br', 'ml', 'mr'] as const) {
      const gc = fakeGc();
      headerCell.paint(gc, headerConfig({
        decorators: [{ position, kind: 'emoji', value: '⚠️' }],
      }));
      const texts = gc.fillText.mock.calls.map((c: unknown[]) => c[0]);
      expect(texts, position).toContain('⚠️');
      expect(texts, position).toContain('Price'); // caption still paints — overlay, not replacement
    }
  });

  it('paints a dot decorator via arc+fill', () => {
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({
      decorators: [{ position: 'tr', kind: 'dot', color: '#f00' }],
    }));
    expect(gc.arc).toHaveBeenCalled();
    expect(gc.fill).toHaveBeenCalled();
  });

  it('paints a registered-icon decorator AND the sort chevron (both draw; no auto-avoid)', () => {
    registerIcon('test-star', 'M12 2l3 7h7l-5 5 2 7-7-4-7 4 2-7-5-5h7z');
    const gc = fakeGc();
    headerCell.paint(gc, headerConfig({
      sortDirection: 'asc',
      decorators: [{ position: 'mr', kind: 'icon', icon: 'test-star', color: '#0af' }],
    }));
    // chevron stroke + decorator icon stroke both happened
    expect(gc.stroke.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @cgrid/kernel run test -- tests/headerCellContentDecorators.test.ts`
Expected: FAIL — content still renders `Price`, decorators never paint.

- [ ] **Step 3: Implement in `headerCell.paint`**

In `packages/kernel/src/renderer/cellRenderers/registry.ts`, inside `headerCell.paint`:

**(a)** Immediately after the header-checkbox branch's closing `}` (the branch ending `return;` at ~line 650), wrap the ENTIRE caption-painting region — from `const textX = …` through the end of the plain-caption `else` block (the one ending with `if (p.pivotGroupExpand === undefined) paintTextDecoration(gc, p, textX, cy);`) — in an else of a new content check. Because that region declares `const textX`/`const caption` used by the later chevron block, structure it as:

```ts
    const textX = p.bounds.x + HEADER_PADDING;
    // … (existing caption/ellipsize const declarations stay where they are) …

    if (p.content) {
      // Cycle 28 — header content slot. Replaces the caption exactly as a
      // cell content slot replaces valueFormatted. Sort chevrons / group
      // caret / borders below still paint.
      const padLeft = p.padding?.left ?? HEADER_PADDING;
      const padRight = p.padding?.right ?? HEADER_PADDING;
      renderContentSlot(gc, p, p.content, cy, padLeft, padRight);
    } else if (p.wrapHeader) {
      // … existing wrap branch unchanged …
    } else if (p.pivotGroupExpand === undefined && p.halign === 'right') {
      // … existing right-align branch unchanged …
    } else if (p.pivotGroupExpand === undefined && p.halign === 'center') {
      // … existing center branch unchanged …
    } else {
      // … existing plain-caption branch unchanged …
    }
```

i.e. the only edit is inserting the `if (p.content) { … } else` in front of the existing `if (p.wrapHeader)` chain. The `caption` const above it stays (the group-caret block after the chain still measures it; with a content slot on a group-caret header the caret positions after the *unrendered* caption's width — acceptable, group headers are out of scope for authored content).

**(b)** At the END of `headerCell.paint`, after the existing border overlay line `if (p.border) paintCellBorders(gc, p.bounds, p.border);`, add:

```ts
    // Cycle 28 — decorator overlay, same painter as data cells. Painted
    // LAST (over chevrons if the author puts one at tr/mr — their call).
    if (p.decorators && p.decorators.length > 0) {
      paintCellDecorators(gc, p.bounds, p.decorators);
    }
```

Note the header-checkbox branch still `return`s early — decorators intentionally skip checkbox headers (its early return predates this feature; the select-all column has no caption to decorate).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace @cgrid/kernel run test -- tests/headerCellContentDecorators.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full kernel suite (headers are hot-path — check nothing regressed)**

Run: `npm --workspace @cgrid/kernel run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/renderer/cellRenderers/registry.ts packages/kernel/tests/headerCellContentDecorators.test.ts
git commit -m "feat(kernel): headers render headerStyle content slots + 6-position decorators"
```

---

### Task 3: `headerIcon` colDef prop + static `cellIcon` objects + header slot painting

**Files:**
- Modify: `packages/kernel/src/types/column.ts:132` (cellIcon type + new headerIcon)
- Modify: `packages/kernel/src/core/propertyChain.ts:44` (ResolvedColDef), `:1118` (compileFormatSlots static fallback), `:1212` (resolveColDef normalization)
- Modify: `packages/kernel/src/renderer/painters/byRows.ts` (header icon block, after the data-cell cellIcon block)
- Modify: `packages/kernel/src/renderer/cellRenderers/registry.ts` (headerCell honors `p.padding`)
- Test: Create `packages/kernel/tests/byRowsHeaderIcon.test.ts`

**Interfaces:**
- Consumes: `IconRef` (Task 1 shape), `PendingCellIcon`/`drawCellIcon` (Task 1), `CELL_ICON_EDGE_PAD`/`CELL_ICON_GUTTER` consts in byRows.
- Produces:
  - `CColDef.cellIcon?: string | IconRef | ((params: CValueFormatterParams<TRow, TValue>) => IconRef | null)` — static forms newly legal.
  - `CColDef.headerIcon?: IconRef | ((params: { colId: string }) => IconRef | null)`.
  - `ResolvedColDef.headerIcon?: (params: { colId: string }) => IconRef | null` (always a fn after resolve; static forms wrapped). `ResolvedColDef.cellIcon` unchanged (always fn). Task 4's kernel patch and Task 6's UI rely on the static-object authoring forms.

- [ ] **Step 1: Write the failing test**

Create `packages/kernel/tests/byRowsHeaderIcon.test.ts` — copy the ENTIRE harness (fakeGc, theme, makeVs, subgrid literals, registry setup) from `packages/kernel/tests/byRowsCellIcon.test.ts`, but with a **header** subgrid row (`type: 'header', isHeader: true, isData: false, …` — copy the header-subgrid literal from any existing header-painting test, e.g. grep `isHeader: true` under `packages/kernel/tests/`). Then:

```ts
it('headerIcon (static IconRef) draws a Path2D icon in the leading slot and shifts the caption right', () => {
  // colDef: { colId: 'a', headerName: 'Price', headerIcon: { name: 'star' } }
  // (register 'star' in the icon-set registry in beforeEach, as byRowsCellIcon.test.ts does)
  // paint a header row through paintCellsByRows
  // expect: gc.stroke called (icon path) AND the fillText('Price', x, …) x arg
  //         is >= CELL_ICON_EDGE_PAD + iconSize + CELL_ICON_GUTTER (caption shifted)
});

it('headerIcon trailing: icon draws at the right edge, caption x unchanged', () => {
  // headerIcon: { name: 'star', position: 'trailing' }
  // expect stroke called; fillText('Price', …) x equals the no-icon baseline (HEADER_PADDING)
});

it('headerIcon emoji draws via fillText', () => {
  // headerIcon: { emoji: '🚀' }
  // expect a fillText call with '🚀'
});

it('headerIcon function form receives { colId } and its result is honored', () => {
  // headerIcon: (p) => p.colId === 'a' ? { name: 'star' } : null
});

it('data rows never draw headerIcon; header rows never draw cellIcon', () => {
  // one def with BOTH cellIcon and headerIcon; paint a header row and a data row;
  // count stroke calls per pass — exactly one icon each.
});
```

Fill these in as real tests using the copied harness (the byRowsCellIcon tests show the exact `paintCellsByRows` invocation shape — `PainterCtx` literal with viewport/theme/columnDefs/cellRenderers/cellData/selection/sortModel etc.).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @cgrid/kernel run test -- tests/byRowsHeaderIcon.test.ts`
Expected: FAIL — no icon strokes on header rows; TypeScript may already reject `headerIcon` (also a failure — fine).

- [ ] **Step 3: Type + resolve changes**

**(a)** `packages/kernel/src/types/column.ts` — replace line 132 and add headerIcon below it:

```ts
  /** Icon slot; a static name/IconRef, or a fn (populated by format at
   *  ColDef-resolve when {icon:name} is present in the format string).
   *  Static forms render unconditionally on every data cell. */
  cellIcon?: string | IconRef | ((params: CValueFormatterParams<TRow, TValue>) => IconRef | null);

  /** Cycle 28 — leaf-header prefix/suffix icon. Claims a leading/trailing
   *  slot in the header cell; the caption shifts away. Trailing icons do
   *  NOT move the sort chevron (collisions are the author's concern).
   *  Static IconRef or per-column fn. Leaf headers only. */
  headerIcon?: IconRef | ((params: { colId: string }) => IconRef | null);
```

**(b)** `packages/kernel/src/core/propertyChain.ts` line 44 area (ResolvedColDef) — add below the existing `cellIcon` field:

```ts
  headerIcon?: (params: { colId: string }) => import('@cgrid/format').IconRef | null;
```

**(c)** compileFormatSlots (line ~1118): the format-derived `cellIcon` fn currently discards any static cellIcon whenever a format string compiles. Make the static form the fallback:

```ts
      cellIcon: (() => {
        const staticRef: import('@cgrid/format').IconRef | null =
          typeof merged.cellIcon === 'string' ? { name: merged.cellIcon }
          : (merged.cellIcon !== undefined && typeof merged.cellIcon === 'object') ? merged.cellIcon
          : null;
        return (p: CValueFormatterParams<TRow, unknown>) =>
          (evalFormatProgram(program, p).icon as import('@cgrid/format').IconRef | null) ?? staticRef;
      })(),
```

**(d)** resolveColDef return object (line ~1212) — normalize static forms to fns. Replace the `cellIcon:` line and add `headerIcon:`:

```ts
    cellIcon: normalizeCellIcon<TRow>(compiledMerged.cellIcon),
    headerIcon: normalizeHeaderIcon(merged.headerIcon),
```

and add near resolveColDef (module scope):

```ts
/** Cycle 28 — static string/IconRef cellIcon forms wrap to constant fns so
 *  byRows keeps a single call shape. */
function normalizeCellIcon<TRow>(
  v: CColDef<TRow>['cellIcon'],
): ResolvedColDef<TRow>['cellIcon'] {
  if (v === undefined) return undefined;
  if (typeof v === 'function') return v as ResolvedColDef<TRow>['cellIcon'];
  const ref = typeof v === 'string' ? { name: v } : v;
  return () => ref;
}

function normalizeHeaderIcon(
  v: import('@cgrid/format').IconRef | ((params: { colId: string }) => import('@cgrid/format').IconRef | null) | undefined,
): ((params: { colId: string }) => import('@cgrid/format').IconRef | null) | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'function') return v;
  return () => v;
}
```

- [ ] **Step 4: Header slot painting in `byRows.ts`**

Directly after the existing data-cell cellIcon block (the one ending `config.padding = pad; } } }` — after Task 1's edit), add the header twin:

```ts
      // Cycle 28 — leaf-header prefix/suffix icon (headerIcon). Same slot
      // mechanics as the data-cell block above: icon claims an edge slot,
      // caption shifts via config.padding (headerCell reads padding.left/
      // right with HEADER_PADDING defaults). Skips checkbox headers (no
      // caption to decorate). Trailing icons don't move the sort chevron.
      if (
        row.subgrid.isHeader
        && def.headerIcon !== undefined
        && config.headerCheckboxState === undefined
      ) {
        let iconRef: import('@cgrid/format').IconRef | null = null;
        try {
          iconRef = def.headerIcon({ colId: col.colId });
        } catch {
          iconRef = null;
        }
        if (iconRef && (iconRef.name || iconRef.emoji) && !(iconRef.name && iconRef.emoji)) {
          const path = iconRef.name ? resolveIconPath(iconRef.name) : null;
          if (path || iconRef.emoji) {
            const boundsH = row.bottom - cellTop;
            const iconSize = Math.floor(Math.min(row.height, boundsH) * 0.55);
            const position = iconRef.position ?? 'leading';
            pendingIcon = {
              path,
              emoji: iconRef.emoji,
              x: position === 'leading'
                ? col.left + CELL_ICON_EDGE_PAD
                : col.left + col.width - CELL_ICON_EDGE_PAD - iconSize,
              y: cellTop + (boundsH - iconSize) / 2,
              size: iconSize,
              tint: iconRef.color ?? config.fg,
            };
            const pad = { ...(config.padding ?? {}) };
            if (position === 'leading') {
              pad.left = (pad.left ?? CELL_ICON_EDGE_PAD) + iconSize + CELL_ICON_GUTTER;
            } else {
              pad.right = (pad.right ?? CELL_ICON_EDGE_PAD) + iconSize + CELL_ICON_GUTTER;
            }
            config.padding = pad;
          }
        }
      }
```

(`pendingIcon` and the post-paint `if (pendingIcon) drawCellIcon(gc, pendingIcon);` already exist from the data path — this block reuses both. `cellTop` is declared above in the loop.)

- [ ] **Step 5: `headerCell` honors `p.padding`**

In `packages/kernel/src/renderer/cellRenderers/registry.ts`, `headerCell.paint`:

- Change `const textX = p.bounds.x + HEADER_PADDING;` →
  `const textX = p.bounds.x + (p.padding?.left ?? HEADER_PADDING);`
- In the right-align branch, change the reserve to also respect a trailing pad:
  ```ts
      const reserve = Math.max(
        (p.sortDirection || p.unSortIcon) ? SORT_ICON_PAD + SORT_ICON_SIZE + 2 : HEADER_PADDING,
        p.padding?.right ?? 0,
      );
  ```
- In the wrap branch, the existing `maxW` derives from `textX` (already shifted) — additionally subtract the trailing pad:
  ```ts
      const maxW = Math.max(8, p.bounds.x + p.bounds.w - Math.max(trailingReserve, p.padding?.right ?? 0) - textX);
  ```

- [ ] **Step 6: Run tests**

Run: `npm --workspace @cgrid/kernel run test -- tests/byRowsHeaderIcon.test.ts && npm --workspace @cgrid/kernel run test`
Expected: new file PASS; full suite PASS (existing header tests unaffected — no `padding` set means identical geometry).

- [ ] **Step 7: Typecheck + commit**

```bash
npm --workspace @cgrid/kernel run typecheck
git add packages/kernel/src/types/column.ts packages/kernel/src/core/propertyChain.ts packages/kernel/src/renderer/painters/byRows.ts packages/kernel/src/renderer/cellRenderers/registry.ts packages/kernel/tests/byRowsHeaderIcon.test.ts
git commit -m "feat(kernel): headerIcon leaf-header prefix/suffix icons + static cellIcon IconRef forms"
```

---

### Task 4: calc channel — `cellIcon`/`headerIcon` through `editColumn` + templates

**Files:**
- Modify: `packages/calc/src/types.ts:55-66` (ColumnOverride)
- Modify: `packages/calc/src/templates.ts:17-31` (mergeLayer)
- Modify: `packages/calc/src/calcEngine.ts:80-82` (ColumnEditPatch), `:334-390` (editColumn)
- Modify: `packages/calc/src/overrides.ts` (overrideToKernelPatch)
- Test: `packages/calc/tests/autoTemplateOnEdit.test.ts` (extend — it's the editColumn suite)

**Interfaces:**
- Consumes: nothing new from kernel (calc stays structurally typed — no `@cgrid/format` type import needed).
- Produces: `ColumnOverride.cellIcon` / `.headerIcon` of type `IconOverride = { name?: string; emoji?: string; color?: string; position?: 'leading' | 'trailing' }`; `ColumnEditPatch` accepts them, with **`null` meaning "remove"**. `overrideToKernelPatch` emits `patch.cellIcon` / `patch.headerIcon` (plain objects) that land on the kernel `CColDef` static forms from Task 3. Task 6 calls `grid.editColumn(colId, { cellIcon: {...} | null })`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/calc/tests/autoTemplateOnEdit.test.ts` (mirror the file's existing engine + `now` conventions):

```ts
it('editColumn cellIcon/headerIcon land in the own template and the kernel patch', () => {
  const engine = new CalcEngine();
  const res = engine.editColumn('price', {
    cellIcon: { name: 'flame', color: '#f60', position: 'leading' },
    headerIcon: { emoji: '🔥', position: 'trailing' },
  }, { now: 1000 });
  expect(res.ok).toBe(true);
  const own = engine.getTemplates().find((t) => t.id === '__cgridOwn:price')!;
  expect(own.overrides.cellIcon).toEqual({ name: 'flame', color: '#f60', position: 'leading' });
  expect(own.overrides.headerIcon).toEqual({ emoji: '🔥', position: 'trailing' });
  const patch = engine.resolvedPatchFor('price', 'number')!;
  expect(patch.cellIcon).toEqual({ name: 'flame', color: '#f60', position: 'leading' });
  expect(patch.headerIcon).toEqual({ emoji: '🔥', position: 'trailing' });
});

it('editColumn cellIcon: null removes the stored icon', () => {
  const engine = new CalcEngine();
  engine.editColumn('price', { cellIcon: { name: 'flame' } }, { now: 1000 });
  engine.editColumn('price', { cellIcon: null }, { now: 1001 });
  const own = engine.getTemplates().find((t) => t.id === '__cgridOwn:price')!;
  expect(own.overrides.cellIcon).toBeUndefined();
  const patch = engine.resolvedPatchFor('price', 'number');
  expect(patch?.cellIcon).toBeUndefined();
});

it('a later template layer with cellIcon wins wholesale (no per-key merge)', () => {
  const engine = new CalcEngine();
  engine.saveTemplate({ id: 'shared', name: 'shared', overrides: { cellIcon: { name: 'star', color: '#00f' } }, now: 1 });
  engine.applyTemplate('shared', ['price']);
  engine.editColumn('price', { cellIcon: { name: 'flame' } }, { now: 2 });
  // own template folds highest → flame, and NOT { name:'flame', color:'#00f' }
  expect(engine.resolvedPatchFor('price', 'number')!.cellIcon).toEqual({ name: 'flame' });
});
```

(Adjust import/engine-construction lines to match the file's existing tests exactly. If `getTemplates()` isn't the engine method name in that file, use whatever accessor its existing assertions use.)

- [ ] **Step 2: Run to verify failure**

Run: `npm --workspace @cgrid/calc run test -- tests/autoTemplateOnEdit.test.ts`
Expected: FAIL (TS: `cellIcon` not in ColumnEditPatch).

- [ ] **Step 3: Implement**

**(a)** `packages/calc/src/types.ts` — above `ColumnOverride` add, then extend it:

```ts
/** Static icon reference for cellIcon/headerIcon overrides — structural
 *  twin of @cgrid/format's IconRef (calc holds data, never draws). */
export interface IconOverride {
  name?: string;
  emoji?: string;
  color?: string;
  position?: 'leading' | 'trailing';
}
```

In `ColumnOverride`, after `headerStyle`:

```ts
  cellIcon?: IconOverride;      // static prefix/suffix icon on data cells
  headerIcon?: IconOverride;    // static prefix/suffix icon on the leaf header
```

Export `IconOverride` from `packages/calc/src/index.ts` alongside the other types.

**(b)** `packages/calc/src/templates.ts` — in `mergeLayer`, after the headerStyle block:

```ts
  // cellIcon/headerIcon: last-writer-wins WHOLESALE (an icon is one value,
  // not a style bag — later layers replace, never merge per-key).
  if (layer.cellIcon !== undefined) into.cellIcon = { ...layer.cellIcon };
  if (layer.headerIcon !== undefined) into.headerIcon = { ...layer.headerIcon };
```

**(c)** `packages/calc/src/calcEngine.ts` — extend the patch type (line ~80):

```ts
export type ColumnEditPatch = Partial<
  Pick<ColumnOverride, 'format' | 'cellRenderer' | 'editable' | 'hide' | 'width' | 'cellStyle' | 'headerStyle'>
> & {
  /** Static icon refs. `null` REMOVES the stored icon (a slot-clear from
   *  the toolbar); undefined leaves it untouched. */
  cellIcon?: IconOverride | null;
  headerIcon?: IconOverride | null;
};
```

(`IconOverride` is already imported via the `./types` type-import block — add it there.)

In `editColumn`, after the headerStyle merge block:

```ts
    // cellIcon / headerIcon — wholesale set, or `null` → remove (slot clear).
    if (patch.cellIcon !== undefined) {
      if (patch.cellIcon === null) delete overrides.cellIcon;
      else overrides.cellIcon = structuredClone(patch.cellIcon);
    }
    if (patch.headerIcon !== undefined) {
      if (patch.headerIcon === null) delete overrides.headerIcon;
      else overrides.headerIcon = structuredClone(patch.headerIcon);
    }
```

**(d)** `packages/calc/src/overrides.ts` — in `overrideToKernelPatch`, after the headerStyle line:

```ts
  if (merged.cellIcon !== undefined) patch.cellIcon = { ...merged.cellIcon };
  if (merged.headerIcon !== undefined) patch.headerIcon = { ...merged.headerIcon };
```

(Kernel target keys verified: `CColDef.cellIcon` static form + `CColDef.headerIcon` — added in Task 3.)

- [ ] **Step 4: Run tests**

Run: `npm --workspace @cgrid/calc run test`
Expected: PASS (3 new + all existing; `saveTemplate`'s structuredClone already handles the new keys).

- [ ] **Step 5: Typecheck + commit**

```bash
npm --workspace @cgrid/calc run typecheck
git add packages/calc/src/types.ts packages/calc/src/templates.ts packages/calc/src/calcEngine.ts packages/calc/src/overrides.ts packages/calc/src/index.ts packages/calc/tests/autoTemplateOnEdit.test.ts
git commit -m "feat(calc): cellIcon/headerIcon ride editColumn own-templates (null = remove)"
```

---

### Task 5: icon + emoji catalogs for the picker (`@cgrid/ext`)

**Files:**
- Create: `packages/ext/src/toolbar/buildIconCatalog.ts` (generator script)
- Create: `packages/ext/src/toolbar/iconCatalog.generated.ts` (generated, committed)
- Create: `packages/ext/src/toolbar/emojiCatalog.ts` (curated, hand-written)
- Modify: `packages/ext/package.json` (add script)
- Test: Create `packages/ext/tests/iconCatalog.test.ts`

**Interfaces:**
- Consumes: `lucideBundle` via the existing subpath export `@cgrid/kernel/icons/lucide.generated` (`Readonly<Record<string, string>>` name → SVG path data).
- Produces:
  - `iconCatalog.generated.ts`: `export const lucideCategories: ReadonlyArray<{ readonly category: string; readonly icons: readonly string[] }>` — names only; tiles get path data from `lucideBundle[name]` at render time.
  - `emojiCatalog.ts`: `export const emojiCategories: ReadonlyArray<{ readonly category: string; readonly emojis: readonly string[] }>`.
  Task 6's picker consumes both.

- [ ] **Step 1: Write the failing test**

Create `packages/ext/tests/iconCatalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lucideBundle } from '@cgrid/kernel/icons/lucide.generated';
import { lucideCategories } from '../src/toolbar/iconCatalog.generated';
import { emojiCategories } from '../src/toolbar/emojiCatalog';

describe('icon catalog', () => {
  it('covers every lucide icon exactly once', () => {
    const all = lucideCategories.flatMap((c) => [...c.icons]);
    expect(all.length).toBe(Object.keys(lucideBundle).length);
    expect(new Set(all).size).toBe(all.length);
    for (const name of all) expect(lucideBundle[name]).toBeTypeOf('string');
  });
  it('has categorized more than half the set (Other is a fallback, not the norm)', () => {
    const other = lucideCategories.find((c) => c.category === 'Other');
    const total = lucideCategories.reduce((n, c) => n + c.icons.length, 0);
    expect((other?.icons.length ?? 0) / total).toBeLessThan(0.5);
  });
  it('Other sorts last; icons sorted within each category', () => {
    expect(lucideCategories[lucideCategories.length - 1]!.category).toBe('Other');
    for (const c of lucideCategories) {
      expect([...c.icons]).toEqual([...c.icons].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe('emoji catalog', () => {
  it('has 8 categories with unique non-empty emojis', () => {
    expect(emojiCategories.length).toBe(8);
    const all = emojiCategories.flatMap((c) => [...c.emojis]);
    expect(all.length).toBeGreaterThanOrEqual(150);
    expect(new Set(all).size).toBe(all.length);
    for (const e of all) expect(e.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --workspace @cgrid/ext run test -- tests/iconCatalog.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write the generator**

Create `packages/ext/src/toolbar/buildIconCatalog.ts`:

```ts
// Build script: categorize the kernel's Lucide bundle into picker sections.
// Emits iconCatalog.generated.ts (committed). Regenerate via
// `npm --workspace @cgrid/ext run prebuild-icon-catalog` after bumping
// lucide-static + regenerating the kernel bundle.
//
// Categorization is name-based (ordered first-match rules). The spec allows
// tags.json-derived categories; name rules give equivalent grouping without
// coupling to lucide-static's tag file layout.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lucideBundle } from '@cgrid/kernel/icons/lucide.generated';

const RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['Arrows & Direction', /arrow|chevron|move-|^move$|corner-|undo|redo|refresh|rotate|repeat|iteration|forward|reply|expand|shrink|maximize|minimize|navigation|compass|milestone|signpost/],
  ['Charts & Data', /chart|graph|trending|activity|gauge|database|table|kanban|sigma|binary|variable|function|percent|diff/],
  ['Files & Documents', /file|folder|archive|clipboard|notebook|book|newspaper|scroll|sticky|paperclip|bookmark|tag|stamp|printer|save/],
  ['Communication', /mail|message|phone|send|inbox|megaphone|bell|voicemail|rss|share|at-sign|contact|speech|languages|quote/],
  ['Media & AV', /play|pause|music|video|camera|image|film|mic|volume|headphone|radio|tv|disc|cast|aperture|clapperboard|gallery|youtube|podcast|audio/],
  ['People', /^user|users|person|baby|accessibility|venus|mars|handshake|footprints/],
  ['Finance & Commerce', /dollar|euro|pound|yen|bitcoin|coins?|credit-card|wallet|banknote|receipt|shopping|store|package|gift|piggy|landmark|scale|briefcase|chart-candlestick/],
  ['Time & Calendar', /clock|calendar|timer|alarm|hourglass|watch|history/],
  ['Weather & Nature', /sun|moon|cloud|rain|snow|wind|thermometer|umbrella|zap|flower|leaf|tree|sprout|mountain|wave|droplet|flame|rainbow|tornado|haze|eclipse|earth|globe|bug|fish|bird|cat|dog|rabbit|turtle|squirrel|worm|shell|paw/],
  ['Devices & Tech', /laptop|computer|monitor|smartphone|tablet|keyboard|mouse|server|cpu|hard-drive|usb|battery|wifi|bluetooth|plug|router|satellite|scan|qr-code|terminal|code|git-|github|gitlab|chrome|cable|antenna|memory|microchip|network|cloud-(?:upload|download)/],
  ['Transport & Places', /car|bus|truck|train|plane|ship|bike|rocket|fuel|traffic|sailboat|ambulance|tractor|anchor|map|home|house|building|hotel|hospital|school|factory|warehouse|church|castle|tent|luggage|caravan/],
  ['Security & Alerts', /lock|unlock|key|shield|fingerprint|eye|siren|alert|ban|skull|bomb|radiation|biohazard|badge-(?:check|alert|x)|octagon|life-buoy/],
  ['Editing & Tools', /pen|pencil|edit|eraser|scissor|crop|brush|paint|palette|ruler|wrench|hammer|drill|axe|pipette|highlighter|type|bold|italic|underline|strikethrough|align|^list|indent|text|heading|pilcrow|spell|wand|magnet|slider|toggle|filter|settings|tool/],
  ['Shapes & Symbols', /circle|square|triangle|diamond|hexagon|pentagon|octagon$|star|heart|check|^x$|^plus|^minus|slash|asterisk|hash|infinity|equal|divide|dot|shapes|spade|club|award|crown|gem|sparkle|badge$|flag/],
];

const buckets = new Map<string, string[]>(RULES.map(([c]) => [c, []]));
buckets.set('Other', []);
for (const name of Object.keys(lucideBundle)) {
  const rule = RULES.find(([, re]) => re.test(name));
  buckets.get(rule ? rule[0] : 'Other')!.push(name);
}
const categories = [...buckets.entries()]
  .filter(([, icons]) => icons.length > 0)
  .map(([category, icons]) => ({ category, icons: icons.sort((a, b) => a.localeCompare(b)) }));

const __dirname = dirname(fileURLToPath(import.meta.url));
writeFileSync(
  join(__dirname, 'iconCatalog.generated.ts'),
  `// AUTO-GENERATED — do not edit. Regenerate via \`npm --workspace @cgrid/ext run prebuild-icon-catalog\`.
// Categorizes @cgrid/kernel's Lucide bundle for the ribbon icon picker.
export const lucideCategories: ReadonlyArray<{ readonly category: string; readonly icons: readonly string[] }> = ${JSON.stringify(categories, null, 2)} as const;
`,
);
console.log(`[build-icon-catalog] ${categories.length} categories, ${categories.reduce((n, c) => n + c.icons.length, 0)} icons`);
```

Add to `packages/ext/package.json` scripts:

```json
"prebuild-icon-catalog": "tsx src/toolbar/buildIconCatalog.ts",
```

(If `tsx` isn't in ext devDependencies, add `"tsx": "^4.19.0"` — kernel already uses it, version-match kernel's.)

- [ ] **Step 4: Generate**

Run: `npm --workspace @cgrid/ext run prebuild-icon-catalog`
Expected: writes `iconCatalog.generated.ts`, logs ~15 categories / 1506 icons. If the 'Other' bucket exceeds 50%, extend `RULES` keywords until the Step 1 test's ratio holds.

- [ ] **Step 5: Write the emoji catalog**

Create `packages/ext/src/toolbar/emojiCatalog.ts`:

```ts
// Curated emoji set for the ribbon icon picker — 8 categories, common
// finance/status/UI glyphs first. Hand-maintained (no build step; the
// full Unicode set would drown the picker).

export const emojiCategories: ReadonlyArray<{ readonly category: string; readonly emojis: readonly string[] }> = [
  { category: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🙂', '😉', '😊', '😍', '🤩', '😎', '🤔', '😐', '😬', '🙄', '😴', '🤯', '😱', '😢', '😡', '🥳', '🤗', '🫡'] },
  { category: 'Gestures & People', emojis: ['👍', '👎', '👌', '✌️', '🤞', '👏', '🙌', '🤝', '💪', '🫵', '👉', '👈', '👆', '👇', '✋', '🖐️', '👋', '🤙', '🙏', '💁', '🙋', '🤷', '🏃', '🧍'] },
  { category: 'Arrows', emojis: ['⬆️', '⬇️', '⬅️', '➡️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↩️', '↪️', '⤴️', '⤵️', '🔼', '🔽', '⏫', '⏬', '🔄', '🔁', '🔀', '◀️', '▶️', '⏸️'] },
  { category: 'Symbols & Status', emojis: ['✅', '❌', '⚠️', '❗', '❓', '💯', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⭐', '🌟', '✨', '🚫'] },
  { category: 'Finance', emojis: ['💰', '💵', '💴', '💶', '💷', '💸', '💳', '🪙', '🏦', '📈', '📉', '📊', '🧾', '💹', '🤑', '🏧', '💲', '🛒', '🛍️', '📦', '🏷️', '⚖️', '🗃️', '💼'] },
  { category: 'Objects & Tech', emojis: ['💻', '🖥️', '⌨️', '🖱️', '📱', '☎️', '🖨️', '💾', '📡', '🔋', '🔌', '💡', '🔦', '🔧', '🔨', '⚙️', '🧲', '🔒', '🔓', '🔑', '📌', '📎', '✂️', '🗑️'] },
  { category: 'Time & Weather', emojis: ['⏰', '⏱️', '⏳', '⌛', '🕐', '📅', '🗓️', '☀️', '🌤️', '⛅', '🌧️', '⛈️', '🌩️', '❄️', '🌪️', '🌈', '🌙', '🌡️', '💧', '🔥', '⚡', '🌊', '🌍', '🪐'] },
  { category: 'Nature & Food', emojis: ['🌱', '🌿', '🍀', '🌲', '🌴', '🌸', '🌻', '🍎', '🍊', '🍋', '🍇', '🍓', '🥑', '🍕', '🍔', '☕', '🍺', '🐝', '🦋', '🐟', '🐢', '🦅', '🐘', '🦁'] },
];
```

- [ ] **Step 6: Run tests**

Run: `npm --workspace @cgrid/ext run test -- tests/iconCatalog.test.ts`
Expected: PASS. (If the subpath import fails in vitest, add the alias the ext vitest config already uses for `@cgrid/kernel` — check `packages/ext/vitest.config.ts` / `vite.config.ts` `resolve.alias` and mirror the kernel entry with `@cgrid/kernel/icons/lucide.generated` → `packages/kernel/src/icons/lucide.generated.ts`.)

- [ ] **Step 7: Commit**

```bash
git add packages/ext/src/toolbar/buildIconCatalog.ts packages/ext/src/toolbar/iconCatalog.generated.ts packages/ext/src/toolbar/emojiCatalog.ts packages/ext/package.json packages/ext/tests/iconCatalog.test.ts
git commit -m "feat(ext): categorized Lucide + emoji catalogs for the ribbon icon picker"
```

---

### Task 6: "Icons" ribbon section — tile picker, color, placement slot selector

**Files:**
- Create: `packages/ext/src/toolbar/iconPicker.ts`
- Modify: `packages/ext/src/toolbar/ribbon.ts` (new section in row 3, FormattingRefs, wiring, CSS)
- Test: Create `packages/ext/tests/iconPicker.test.ts`

**Interfaces:**
- Consumes: `lucideCategories` / `emojiCategories` (Task 5), `lucideBundle` (kernel subpath), `grid.editColumn(colId, { cellIcon | headerIcon | cellStyle | headerStyle })` (Task 4 shapes; `null` clears prefix/suffix), `grid.getTemplates()`.
- Produces: `createIconPicker(opts)` returning `{ button, panel, setPreview(sel), destroy() }`; ribbon section with stable E2E hooks `data-ip="open" | "search" | "place" | "color" | "clear"` and tiles `.cgext-ip-tile[data-icon="<name>"]` / `[data-emoji="<glyph>"]`. Placement menu items `[data-place="prefix|suffix|tl|tr|bl|br|ml|mr"]`.

- [ ] **Step 0: Read the frontend-design skill FIRST (hard gate — user's UI quality bar)**

If executing in the main session: invoke the `frontend-design:frontend-design` skill. If executing as a subagent: read `/Users/develop/.claude/plugins/cache/claude-plugins-official/frontend-design/*/skills/frontend-design/SKILL.md` (glob for it) before writing any DOM/CSS. Apply its guidance to the panel: deliberate spacing scale, hover/focus/active states on every tile, a real empty state for a no-match search, no default-looking dropdowns.

- [ ] **Step 1: Write the failing test**

Create `packages/ext/tests/iconPicker.test.ts` (ext tests run in jsdom — mirror the environment setup of `packages/ext/tests/element.test.ts` if it declares one):

```ts
import { describe, it, expect, vi } from 'vitest';
import { createIconPicker } from '../src/toolbar/iconPicker';

describe('createIconPicker', () => {
  it('renders category sections with 8-column tile grids and fires onSelect', () => {
    const onSelect = vi.fn();
    const p = createIconPicker({ onSelect });
    document.body.append(p.button, p.panel);
    p.button.click(); // open
    expect(p.panel.hidden).toBe(false);
    const grids = p.panel.querySelectorAll('.cgext-ip-grid');
    expect(grids.length).toBeGreaterThan(8); // lucide cats + 8 emoji cats
    const tile = p.panel.querySelector('.cgext-ip-tile[data-icon="flame"]') as HTMLButtonElement;
    expect(tile.querySelector('svg')).toBeTruthy();
    tile.click();
    expect(onSelect).toHaveBeenCalledWith({ name: 'flame' });
    expect(p.panel.hidden).toBe(true); // selecting closes
    p.destroy();
  });

  it('search filters tiles across both sources; emoji tiles fire {emoji}', () => {
    const onSelect = vi.fn();
    const p = createIconPicker({ onSelect });
    document.body.append(p.button, p.panel);
    p.button.click();
    const search = p.panel.querySelector('[data-ip="search"]') as HTMLInputElement;
    search.value = 'flame';
    search.dispatchEvent(new Event('input'));
    expect(p.panel.querySelector('.cgext-ip-tile[data-icon="flame"]')).toBeTruthy();
    expect(p.panel.querySelector('.cgext-ip-tile[data-icon="anchor"]')).toBeFalsy();
    search.value = ''; search.dispatchEvent(new Event('input'));
    (p.panel.querySelector('.cgext-ip-tile[data-emoji="🔥"]') as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenLastCalledWith({ emoji: '🔥' });
    p.destroy();
  });

  it('setPreview reflects the current slot into the button', () => {
    const p = createIconPicker({ onSelect: () => {} });
    p.setPreview({ emoji: '🚀' });
    expect(p.button.textContent).toContain('🚀');
    p.setPreview({ name: 'flame' });
    expect(p.button.querySelector('svg')).toBeTruthy();
    p.setPreview(null);
    expect(p.button.querySelector('svg') ?? p.button.textContent?.trim()).toBeTruthy(); // placeholder glyph
    p.destroy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --workspace @cgrid/ext run test -- tests/iconPicker.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `iconPicker.ts`**

Create `packages/ext/src/toolbar/iconPicker.ts`:

```ts
// Icon/emoji tile picker for the Formatting ribbon's Icons section.
// One button + one anchored dropdown panel: search on top, then category
// sections (Lucide vector icons first, then emojis), each an 8-per-row
// tile grid. Tiles are lazily built on first open (1500+ nodes).
//
// Selection contract: fires onSelect({name}) for a Lucide tile or
// onSelect({emoji}) for an emoji tile, then closes. The caller owns all
// apply semantics (placement slots, editColumn) — this module is pure UI.

import { lucideBundle } from '@cgrid/kernel/icons/lucide.generated';
import { lucideCategories } from './iconCatalog.generated';
import { emojiCategories } from './emojiCatalog';

export interface IconSelection { name?: string; emoji?: string }

export interface IconPickerHandle {
  button: HTMLButtonElement;
  panel: HTMLDivElement;
  setPreview(sel: IconSelection | null): void;
  destroy(): void;
}

const PLACEHOLDER_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8z"/></svg>';

function tileSvg(d: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

export function createIconPicker(opts: { onSelect: (sel: IconSelection) => void }): IconPickerHandle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cgext-rb-btn cgext-ip-open';
  button.title = 'Pick icon or emoji';
  button.setAttribute('aria-label', 'Pick icon or emoji');
  button.dataset.ip = 'open';
  button.innerHTML = PLACEHOLDER_SVG;

  const panel = document.createElement('div');
  panel.className = 'cgext-ip-panel';
  panel.hidden = true;

  let built = false;
  const build = (): void => {
    built = true;
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search icons & emojis…';
    search.className = 'cgext-rb-input cgext-ip-search';
    search.dataset.ip = 'search';
    const scroller = document.createElement('div');
    scroller.className = 'cgext-ip-scroll';
    const empty = document.createElement('div');
    empty.className = 'cgext-ip-empty';
    empty.textContent = 'No icons match';
    empty.hidden = true;

    interface Section { root: HTMLElement; tiles: Array<{ el: HTMLButtonElement; key: string }> }
    const sections: Section[] = [];

    const addSection = (
      title: string,
      entries: ReadonlyArray<{ key: string; sel: IconSelection; html?: string; text?: string }>,
    ): void => {
      const root = document.createElement('div');
      root.className = 'cgext-ip-section';
      const label = document.createElement('div');
      label.className = 'cgext-ip-cat';
      label.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'cgext-ip-grid';
      const tiles: Section['tiles'] = [];
      for (const e of entries) {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = 'cgext-ip-tile';
        t.title = e.key;
        if (e.sel.name) t.dataset.icon = e.sel.name;
        if (e.sel.emoji) t.dataset.emoji = e.sel.emoji;
        if (e.html) t.innerHTML = e.html; else t.textContent = e.text!;
        t.addEventListener('click', () => { opts.onSelect(e.sel); close(); });
        grid.append(t);
        tiles.push({ el: t, key: e.key.toLowerCase() });
      }
      root.append(label, grid);
      scroller.append(root);
      sections.push({ root, tiles });
    };

    for (const cat of lucideCategories) {
      addSection(cat.category, cat.icons.map((name) => ({
        key: name, sel: { name }, html: tileSvg(lucideBundle[name]!),
      })));
    }
    for (const cat of emojiCategories) {
      addSection(`Emoji · ${cat.category}`, cat.emojis.map((emoji) => ({
        key: emoji, sel: { emoji }, text: emoji,
      })));
    }

    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let any = false;
      for (const s of sections) {
        let visible = 0;
        for (const t of s.tiles) {
          const hit = q === '' || t.key.includes(q) || (t.el.dataset.emoji?.includes(q) ?? false);
          t.el.hidden = !hit;
          if (hit) visible++;
        }
        s.root.hidden = visible === 0;
        if (visible > 0) any = true;
      }
      empty.hidden = any;
    });

    panel.append(search, scroller, empty);
  };

  const onDocClick = (e: MouseEvent): void => {
    if (panel.hidden) return;
    const t = e.target as Node;
    if (!panel.contains(t) && !button.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };

  const open = (): void => {
    if (!built) build();
    const r = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 348))}px`;
    panel.style.top = `${r.bottom + 6}px`;
    panel.hidden = false;
    (panel.querySelector('[data-ip="search"]') as HTMLInputElement | null)?.focus();
  };
  const close = (): void => { panel.hidden = true; };
  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onKey);

  const setPreview = (sel: IconSelection | null): void => {
    if (sel?.emoji) { button.textContent = sel.emoji; return; }
    if (sel?.name && lucideBundle[sel.name]) { button.innerHTML = tileSvg(lucideBundle[sel.name]!); return; }
    button.innerHTML = PLACEHOLDER_SVG;
  };

  return {
    button, panel, setPreview,
    destroy() {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      panel.remove();
    },
  };
}
```

- [ ] **Step 4: Run picker tests**

Run: `npm --workspace @cgrid/ext run test -- tests/iconPicker.test.ts`
Expected: PASS.

- [ ] **Step 5: Ribbon section + wiring**

In `packages/ext/src/toolbar/ribbon.ts`:

**(a)** Build the section in `ribbonItem`'s render, in row 3 before `spacer` (icons are styling — they live on the Paint row):

```ts
      // Icons — tile picker · color · placement slot selector · clear
      const picker = createIconPicker({ onSelect: (sel) => iconApply(sel) });
      let iconApply: (sel: { name?: string; emoji?: string }) => void = () => {};
      const iconColorBtn = iconBtn(I.paintText, 'Icon color');
      const iconColorInput = document.createElement('input');
      iconColorInput.type = 'color'; iconColorInput.className = 'cgext-rb-colorinput'; iconColorInput.value = '#4f9cf9';
      const iconPlacePill = pill('Prefix'); iconPlacePill.dataset.ip = 'place';
      const iconClear = iconBtn(I.eraser, 'Clear icon at this placement'); iconClear.dataset.ip = 'clear';
      document.body.append(picker.panel);
      row3.append(sep(), section('Icons', group(picker.button, iconColorBtn, iconColorInput, iconPlacePill, iconClear)));
```

(`iconApply` is a `let` closed over by the picker callback and assigned inside `wireFormattingToolbar` via the refs — see (c). Also move the `row3.append(paint, spacer, pop);` line so it reads `row3.append(paint, /* icons appended above */ spacer, pop);` — final order: Paint · Icons · spacer · popout.)

**(b)** Extend `FormattingRefs`:

```ts
  iconPicker: IconPickerHandle;
  setIconApply: (fn: (sel: { name?: string; emoji?: string }) => void) => void;
  iconColorBtn: HTMLButtonElement; iconColorInput: HTMLInputElement;
  iconPlacePill: HTMLButtonElement; iconClear: HTMLButtonElement;
```

Pass them from render (`setIconApply: (fn) => { iconApply = fn; }`), import `createIconPicker, type IconPickerHandle, type IconSelection` at top, and call `r.iconPicker.destroy()` in the returned instance's `destroy()`.

**(c)** In `wireFormattingToolbar`, after the target-toggle block, add the slot-selector model:

```ts
  // ── Icons section — placement is a SLOT SELECTOR: the picker/color/clear
  // always edit "the icon at `placement` for `target`". Changing placement
  // switches which slot is shown; it never moves an icon.
  type Placement = 'prefix' | 'suffix' | 'tl' | 'tr' | 'bl' | 'br' | 'ml' | 'mr';
  const PLACEMENTS: Array<[Placement, string]> = [
    ['prefix', 'Prefix'], ['suffix', 'Suffix'],
    ['tl', 'Top-left'], ['tr', 'Top-right'], ['bl', 'Bottom-left'], ['br', 'Bottom-right'],
    ['ml', 'Middle-left'], ['mr', 'Middle-right'],
  ];
  let placement: Placement = 'prefix';

  type IconOverride = { name?: string; emoji?: string; color?: string; position?: 'leading' | 'trailing' };
  type Decorator = { position: string; kind: string; icon?: string; value?: string; color?: string };

  const ownOverrides = (colId: string): Record<string, unknown> =>
    (grid.getTemplates().find((t) => t.id === `__cgridOwn:${colId}`)?.overrides ?? {}) as Record<string, unknown>;

  /** The first target column's icon at the selected slot (for reflection). */
  const currentIconSlot = (): { name?: string; emoji?: string; color?: string } | null => {
    const cols = targetCols();
    if (!cols.length) return null;
    const own = ownOverrides(cols[0]!);
    if (placement === 'prefix' || placement === 'suffix') {
      const ref = own[target === 'header' ? 'headerIcon' : 'cellIcon'] as IconOverride | undefined;
      if (!ref) return null;
      const want = placement === 'prefix' ? 'leading' : 'trailing';
      return (ref.position ?? 'leading') === want ? ref : null;
    }
    const style = own[target === 'header' ? 'headerStyle' : 'cellStyle'] as { decorators?: Decorator[] } | undefined;
    const d = style?.decorators?.find((x) => x.position === placement);
    if (!d) return null;
    if (d.kind === 'icon') return { name: d.icon, color: d.color };
    if (d.kind === 'emoji') return { emoji: d.value };
    return null;
  };

  /** Write `sel` (or clear on null) into the selected slot on every target column. */
  const applyIconSlot = (sel: { name?: string; emoji?: string } | null): void => {
    const cols = targetCols();
    if (!cols.length) return;
    const color = sel?.name ? r.iconColorInput.value : undefined; // color is SVG-only
    for (const colId of cols) {
      try {
        if (placement === 'prefix' || placement === 'suffix') {
          const key = target === 'header' ? 'headerIcon' : 'cellIcon';
          const value = sel === null
            ? null
            : { ...sel, ...(color ? { color } : {}), position: placement === 'prefix' ? 'leading' : 'trailing' };
          grid.editColumn(colId, { [key]: value });
        } else {
          const styleKey = target === 'header' ? 'headerStyle' : 'cellStyle';
          const existing = ((ownOverrides(colId)[styleKey] as { decorators?: Decorator[] } | undefined)?.decorators ?? []);
          const kept = existing.filter((d) => d.position !== placement);
          const next = sel === null ? kept : [...kept,
            sel.name
              ? { position: placement, kind: 'icon', icon: sel.name, ...(color ? { color } : {}) }
              : { position: placement, kind: 'emoji', value: sel.emoji! }];
          grid.editColumn(colId, { [styleKey]: { decorators: next } });
        }
      } catch { /* unknown column */ }
    }
    ctx.profiles.markDirty();
    refresh();
  };
  r.setIconApply(applyIconSlot);

  // Placement menu on the pill (simple anchored list, click-away via one-shot listener)
  const placeMenu = document.createElement('div');
  placeMenu.className = 'cgext-ip-placemenu'; placeMenu.hidden = true;
  for (const [value, label] of PLACEMENTS) {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'cgext-ip-placeitem';
    item.dataset.place = value; item.textContent = label;
    item.addEventListener('click', () => {
      placement = value;
      r.iconPlacePill.querySelector('span')!.textContent = label;
      placeMenu.hidden = true;
      refresh();
    });
    placeMenu.append(item);
  }
  document.body.append(placeMenu);
  disposers.push(() => placeMenu.remove());
  r.iconPlacePill.addEventListener('click', () => {
    if (!placeMenu.hidden) { placeMenu.hidden = true; return; }
    const rect = r.iconPlacePill.getBoundingClientRect();
    placeMenu.style.left = `${rect.left}px`; placeMenu.style.top = `${rect.bottom + 6}px`;
    placeMenu.hidden = false;
    const away = (e: MouseEvent): void => {
      if (!placeMenu.contains(e.target as Node) && e.target !== r.iconPlacePill) {
        placeMenu.hidden = true;
        document.removeEventListener('mousedown', away);
      }
    };
    document.addEventListener('mousedown', away);
  });

  r.iconColorBtn.addEventListener('click', () => r.iconColorInput.click());
  r.iconColorInput.addEventListener('change', () => {
    const cur = currentIconSlot();
    if (cur?.name) applyIconSlot({ name: cur.name }); // re-apply with new color
  });
  r.iconClear.addEventListener('click', () => applyIconSlot(null));
```

**(d)** Extend `refresh()` — add before its closing brace:

```ts
    const slot = none ? null : currentIconSlot();
    r.iconPicker.setPreview(slot);
    const emojiSel = slot !== null && slot.emoji !== undefined;
    r.iconColorBtn.disabled = none || emojiSel; // color is SVG-only
    r.iconClear.disabled = none || slot === null;
    (r.iconPicker.button as HTMLButtonElement).disabled = none;
    r.iconPlacePill.disabled = none;
    if (slot?.color) r.iconColorInput.value = slot.color;
```

(also add `r.iconPlacePill` to the existing disabled-loop OR rely on the explicit line above — pick one, don't do both).

**(e)** Append to `RIBBON_CSS`:

```css
.cgext-ip-open { font-size: 14px; }
.cgext-ip-panel {
  position: fixed; z-index: 1000; width: 340px; max-height: 420px;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--cg-popup-bg, #161b26); border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.45); padding: 10px;
}
.cgext-ip-search { width: 100%; box-sizing: border-box; margin-bottom: 8px; }
.cgext-ip-scroll { overflow-y: auto; flex: 1 1 auto; }
.cgext-ip-cat {
  font-size: 10px; font-weight: 650; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--cg-muted-fg-color, #7f8ba0); margin: 10px 2px 5px;
  position: sticky; top: 0; background: var(--cg-popup-bg, #161b26); padding: 2px 0;
}
.cgext-ip-section:first-child .cgext-ip-cat { margin-top: 0; }
.cgext-ip-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
.cgext-ip-tile {
  appearance: none; border: none; border-radius: 6px; background: transparent;
  width: 100%; aspect-ratio: 1; display: inline-flex; align-items: center; justify-content: center;
  color: var(--cg-muted-fg-color, #9aa4b6); font-size: 15px; cursor: pointer;
  transition: background 90ms ease, color 90ms ease, transform 90ms ease;
}
.cgext-ip-tile:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.08)); color: var(--cg-fg-color, #e5e9f0); transform: scale(1.12); }
.cgext-ip-tile:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: -2px; }
.cgext-ip-empty { padding: 24px 0; text-align: center; font-size: 12px; color: var(--cg-muted-fg-color, #7f8ba0); }
.cgext-ip-placemenu {
  position: fixed; z-index: 1000; min-width: 140px; padding: 4px;
  background: var(--cg-popup-bg, #161b26); border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  display: flex; flex-direction: column;
}
.cgext-ip-placeitem {
  appearance: none; border: none; background: transparent; border-radius: 5px;
  padding: 6px 10px; text-align: left; font: inherit; font-size: 12px;
  color: var(--cg-fg-color, #d6dce8); cursor: pointer;
}
.cgext-ip-placeitem:hover { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 18%, transparent); }
```

- [ ] **Step 6: Run all ext tests + typecheck**

Run: `npm --workspace @cgrid/ext run test && npm --workspace @cgrid/ext run typecheck`
Expected: PASS (existing ribbon tests unaffected — new controls are additive).

- [ ] **Step 7: Commit**

```bash
git add packages/ext/src/toolbar/iconPicker.ts packages/ext/src/toolbar/ribbon.ts packages/ext/tests/iconPicker.test.ts
git commit -m "feat(ext): Icons ribbon section — categorized tile picker, icon color, 8-slot placement selector"
```

---

### Task 7: E2E verification + full-suite gate

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/iconRibbon.spec.ts`
- Test: full monorepo suite

**Interfaces:**
- Consumes: `data-ip` hooks + tile selectors from Task 6; `window.__ext.grid` exposed by `apps/cgrid-ext-demo/src/main.ts`; Playwright config at `apps/cgrid-ext-demo/playwright.config.ts` (baseURL `http://localhost:5188`, auto webServer).
- Produces: the feature's hard "done" gate.

- [ ] **Step 1: Write the E2E spec**

Create `apps/cgrid-ext-demo/e2e/iconRibbon.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Icons ribbon section — drives the picker end-to-end and asserts through
// the kernel's public template surface (canvas rendering is covered by
// kernel unit tests; e2e verifies the toolbar → editColumn → template
// pipeline plus visual smoke via screenshot).
test('icons section: prefix icon, corner decorator, header emoji, clear', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cgext-grid canvas')).toBeVisible();

  // Focus a data cell so the toolbar resolves target columns.
  await page.locator('.cgext-grid canvas').first().click({ position: { x: 120, y: 90 } });
  await expect(page.locator('.cgext-rb-pill').first()).not.toHaveText(/Select a cell/);

  const ownTemplate = () => page.evaluate(() =>
    (window as any).__ext.grid.getTemplates().find((t: any) => t.id.startsWith('__cgridOwn:'))?.overrides);

  // 1. Prefix (default placement) — pick the flame icon.
  await page.locator('[data-ip="open"]').click();
  await expect(page.locator('.cgext-ip-panel')).toBeVisible();
  await page.locator('[data-ip="search"]').fill('flame');
  await page.locator('.cgext-ip-tile[data-icon="flame"]').click();
  let ov = await ownTemplate();
  expect(ov.cellIcon).toMatchObject({ name: 'flame', position: 'leading' });

  // 2. Top-right decorator — emoji.
  await page.locator('[data-ip="place"]').click();
  await page.locator('[data-place="tr"]').click();
  await page.locator('[data-ip="open"]').click();
  await page.locator('.cgext-ip-tile[data-emoji="⚠️"]').click();
  ov = await ownTemplate();
  expect(ov.cellStyle.decorators).toEqual([{ position: 'tr', kind: 'emoji', value: '⚠️' }]);

  // 3. Header target + suffix emoji → headerIcon.
  await page.locator('button[title="Style headers"]').click();
  await page.locator('[data-ip="place"]').click();
  await page.locator('[data-place="suffix"]').click();
  await page.locator('[data-ip="open"]').click();
  await page.locator('.cgext-ip-tile[data-emoji="🔥"]').click();
  ov = await ownTemplate();
  expect(ov.headerIcon).toMatchObject({ emoji: '🔥', position: 'trailing' });

  // 4. Clear removes exactly the selected slot.
  await page.locator('[data-ip="clear"]').click();
  ov = await ownTemplate();
  expect(ov.headerIcon).toBeUndefined();
  expect(ov.cellIcon).toMatchObject({ name: 'flame' }); // untouched

  // Visual smoke — grid canvas with icons applied.
  await page.screenshot({ path: 'e2e-results/icon-ribbon.png', fullPage: false });
});
```

- [ ] **Step 2: Run E2E**

Run: `npm --workspace cgrid-ext-demo run test:e2e -- e2e/iconRibbon.spec.ts`
(Workspace name: check `apps/cgrid-ext-demo/package.json` `"name"` and substitute.) Playwright starts the dev server itself.
Expected: PASS. Debug selector/coordinate issues against the live app; the canvas click position must land on a data cell (row 2-3, first column — adjust y if the ribbon changes header offset). Inspect the screenshot: prefix flame icon on the column's cells + ⚠️ at cell top-right corners must be visible.

**After the run, kill any leftover automation browser processes** (`pkill -f "chromium.*playwright" || true`) — hard rule.

- [ ] **Step 3: Full monorepo gate**

Run: `npx turbo run test typecheck 2>/dev/null || npm test --workspaces --if-present`
(Use whichever the repo root `package.json` defines — check its `scripts`.)
Expected: all packages green.

- [ ] **Step 4: Update the SDD progress file + commit**

```bash
git add apps/cgrid-ext-demo/e2e/iconRibbon.spec.ts
git commit -m "test(e2e): icons ribbon — picker, placements, header target, clear"
```

- [ ] **Step 5: Final review gate**

Per the user's batch-review rule: ONE closeout review over the whole task batch (not per-task). Invoke the `superpowers:requesting-code-review` skill across `cgridext/foundation..HEAD`, apply one fix wave, then stop for the user.

---

## Self-Review (completed)

- **Spec coverage:** §1 header content/decorators → Task 2; §2.1 emoji IconRef → Task 1; §2.2 headerIcon + padding + wrap → Task 3; §3 calc channel + null-removal → Task 4; §4.1 picker/color/placement UI + catalogs → Tasks 5–6; §4.2 apply mapping + slot-selector model → Task 6 Step 5(c); §5 testing → per-task tests + Task 7 E2E. Out-of-scope items have no tasks (correct).
- **Deviation from spec (deliberate):** categories derive from icon NAMES (ordered regex rules), not `tags.json` — same UX outcome, no coupling to lucide-static internals; noted in the generator header.
- **Type consistency:** `IconRef`/`IconOverride`/`IconSelection` are structurally aligned `{ name?, emoji?, color?, position? }` subsets; `createIconPicker`/`IconPickerHandle`/`applyIconSlot`/`currentIconSlot` names match across Tasks 5–7; `data-ip`/`data-place`/`data-icon`/`data-emoji` hooks match between Task 6 UI and Task 7 E2E.
