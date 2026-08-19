import { test, expect, type Page } from '@playwright/test';

/**
 * Grid header column-group drag feature — Task 3 (demo E2E).
 *
 * T1/T2 (kernel) wired a press-and-drag on a column-GROUP header IN THE
 * GRID HEADER BAND (the canvas — not the "Column Groups" tool panel) to
 * reorder/re-nest the group via `moveColumnGroup` — see
 * `packages/kernel/src/interaction/features/columnDrag.ts` and
 * `packages/kernel/tests/columnGroupHeaderDrag.integration.test.ts` (the
 * kernel-level harness this spec mirrors, but through a REAL browser
 * instead of dispatched DOM events on a jsdom canvas).
 *
 * The grid renders to <canvas> — there is no per-cell DOM to click, so
 * coordinates are derived from the SAME public primitives the kernel
 * integration test uses internally, reached here through `window.__cgapi`:
 *   - `getHeaderBoundsAt(colId)` — leaf column x/width + leaf-row y/height,
 *     in the canvas's own coordinate space.
 *   - `getDefaultHeaderHeight()` — the height of ONE header row. Every
 *     group-header row (including the leaf row) uses this same height
 *     (`packages/kernel/src/velocityGrid.ts` `rebuildSubgridStack` /
 *     `effectiveLeafHeaderHeight`), so the TOP-MOST group row (depth 0)
 *     always spans canvas-local y in `[0, groupRowHeight)` regardless of
 *     how deep any group nests elsewhere in the header — the seeded
 *     "Trade" group nests a second level ("Valuation"), but a leaf's
 *     ancestor at depth 0 is always resolved by `HeaderGroupSubgrid`
 *     (see `packages/kernel/src/core/subgrid.ts`), so clicking within that
 *     first row's y-band over any of a top-level group's descendant
 *     leaves reliably hits `{ kind: 'headerGroup', groupId: <that group> }`
 *     via the production `HitTester`.
 * Canvas-local coordinates are converted to page coordinates by adding the
 * live `canvas.getBoundingClientRect()` origin (same idiom as
 * `overlayAlignment.spec.ts`).
 *
 * Seeded groups (`src/main.ts`): top-level `trade` (children: `valuation`
 * [nested: notionalAmount, marketValue], pnl, dailyPnl) and top-level
 * `risk` (children: dv01, pv01, yield, spread) — `risk` has no sub-groups.
 */

const STORAGE_KEY = 'velocity-grid:state:customizer-demo';

type AnyDef = Record<string, any>;

/** Depth-first search over a `getColumnGroupDefs()` tree — mirrors
 *  `columnGroups.spec.ts`'s `findNode`. */
function findNode(defs: AnyDef[], match: (d: AnyDef) => boolean): AnyDef | null {
  for (const d of defs) {
    if (match(d)) return d;
    if (Array.isArray(d.children)) {
      const found = findNode(d.children, match);
      if (found) return found;
    }
  }
  return null;
}

/** Top-level entry ids in declaration order — groups by `groupId`, leaves
 *  by `colId`/`field` — mirroring the kernel integration test's
 *  `topLevelIds` mapping. */
function topLevelIds(defs: AnyDef[]): string[] {
  return defs.map((d) => d.groupId ?? d.colId ?? d.field);
}

async function getColumnGroupDefs(page: Page): Promise<AnyDef[]> {
  return page.evaluate(() => (window as unknown as { __cgapi: any }).__cgapi.getColumnGroupDefs());
}

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

interface HeaderMeasurements {
  canvasLeft: number;
  canvasTop: number;
  /** Height of one header row — the top-level (depth 0) group-header row
   *  spans canvas-local y in `[0, groupRowHeight)`. */
  groupRowHeight: number;
  bounds: Record<string, { x: number; y: number; w: number; h: number } | null>;
}

/** Snapshot the canvas origin + per-leaf header bounds + row height in one
 *  round-trip, so every coordinate below is computed from a single
 *  consistent layout tick (no re-measuring between reads). */
async function measureHeader(page: Page, colIds: string[]): Promise<HeaderMeasurements> {
  return page.evaluate((ids) => {
    const api = (window as unknown as { __cgapi: any }).__cgapi;
    const canvas = document.querySelector('.vg-grid canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const bounds: Record<string, { x: number; y: number; w: number; h: number } | null> = {};
    for (const id of ids) bounds[id] = api.getHeaderBoundsAt(id);
    return {
      canvasLeft: rect.left,
      canvasTop: rect.top,
      groupRowHeight: api.getDefaultHeaderHeight(),
      bounds,
    };
  }, colIds);
}

/** Page-space X of `colId`'s horizontal center, from a prior `measureHeader`
 *  snapshot. Throws (with a clear message) if the column wasn't in the
 *  current viewport — mirrors the kernel test's `centerOf` guard. */
function centerX(m: HeaderMeasurements, colId: string): number {
  const b = m.bounds[colId];
  if (!b) throw new Error(`gridHeaderGroupDrag: "${colId}" not in viewport (getHeaderBoundsAt returned null)`);
  return m.canvasLeft + b.x + b.w / 2;
}

/** Page-space Y for the top-level (depth 0) group-header row's vertical
 *  midpoint — see the file-header comment for why this row's y-band is
 *  `[canvasTop, canvasTop + groupRowHeight)` regardless of nesting depth
 *  elsewhere in the header. */
function topGroupRowY(m: HeaderMeasurements): number {
  return m.canvasTop + m.groupRowHeight / 2;
}

/** Real press → drag (past the 4px threshold) → release gesture at a fixed
 *  Y, dispatched via `page.mouse` absolute page coordinates (there's no
 *  per-cell DOM on the canvas to target with a locator). Mirrors
 *  `columnGroups.spec.ts`'s `dragOnto` cadence (cross the threshold first,
 *  then glide to the target) and the kernel integration test's
 *  `dragHeader` helper. */
async function dragGroupHeader(page: Page, startX: number, y: number, endX: number): Promise<void> {
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 20, y, { steps: 5 });
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Start every test from a clean persisted-state slate.
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('real drag: dragging the top-level "Trade" group header past currentPrice/unrealizedPnl reorders it', async ({ page }) => {
  const before = await getColumnGroupDefs(page);
  const beforeOrder = topLevelIds(before);
  expect(beforeOrder.indexOf('trade')).toBeLessThan(beforeOrder.indexOf('currentPrice'));
  expect(beforeOrder.indexOf('currentPrice')).toBeLessThan(beforeOrder.indexOf('unrealizedPnl'));

  // `pnl` is a direct child of `trade` (not nested under `valuation`) — any
  // leaf under `trade` resolves to the `trade` group at the depth-0 row,
  // this one just keeps the drag start point unambiguous.
  const m = await measureHeader(page, ['pnl', 'currentPrice', 'unrealizedPnl']);
  const startX = centerX(m, 'pnl');
  const endX = (centerX(m, 'currentPrice') + centerX(m, 'unrealizedPnl')) / 2;
  const y = topGroupRowY(m);

  await dragGroupHeader(page, startX, y, endX);

  const after = await getColumnGroupDefs(page);
  const afterOrder = topLevelIds(after);
  // trade landed strictly between currentPrice and unrealizedPnl.
  expect(afterOrder.indexOf('currentPrice')).toBeLessThan(afterOrder.indexOf('trade'));
  expect(afterOrder.indexOf('trade')).toBeLessThan(afterOrder.indexOf('unrealizedPnl'));
  // risk (previously last) shifted left to fill trade's old slot; the
  // top-level set is otherwise unchanged.
  expect(afterOrder).toEqual([
    'positionId', 'ticker', 'cusip', 'desk', 'region', 'currency', 'trader',
    'currentPrice', 'trade', 'unrealizedPnl', 'risk',
  ]);
});

test('real drag: dragging the top-level "Risk" group header into "Trade" (between pnl/dailyPnl) re-nests it', async ({ page }) => {
  const before = await getColumnGroupDefs(page);
  expect(topLevelIds(before)).toContain('risk');
  const tradeBefore = findNode(before, (d) => d.groupId === 'trade');
  expect(tradeBefore).toBeTruthy();
  expect(tradeBefore!.children.some((c: AnyDef) => c.groupId === 'risk')).toBe(false);

  // dv01 is a leaf under `risk` (no sub-groups under risk, so any of its
  // leaves works as the drag-start point). Landing in the gap between
  // `pnl` and `dailyPnl` — both direct children of `trade` with no deeper
  // group between them — resolves their deepest common ancestor to
  // `trade`, so the drop nests `risk` inside `trade`, before `dailyPnl`.
  const m = await measureHeader(page, ['dv01', 'pnl', 'dailyPnl']);
  const startX = centerX(m, 'dv01');
  const endX = (centerX(m, 'pnl') + centerX(m, 'dailyPnl')) / 2;
  const y = topGroupRowY(m);

  await dragGroupHeader(page, startX, y, endX);

  const after = await getColumnGroupDefs(page);
  expect(topLevelIds(after)).not.toContain('risk'); // lifted out of the top level
  const tradeAfter = findNode(after, (d) => d.groupId === 'trade');
  expect(tradeAfter).toBeTruthy();
  const riskIdx = tradeAfter!.children.findIndex((c: AnyDef) => c.groupId === 'risk');
  const dailyPnlIdx = tradeAfter!.children.findIndex((c: AnyDef) => c.colId === 'dailyPnl');
  expect(riskIdx).toBeGreaterThan(-1);
  expect(riskIdx).toBeLessThan(dailyPnlIdx); // landed immediately before dailyPnl
  // risk keeps its own children — the re-nest didn't disturb its subtree.
  const riskAfter = tradeAfter!.children[riskIdx];
  expect(riskAfter.children?.some((c: AnyDef) => c.colId === 'dv01')).toBe(true);
});

// Real-drag coordinates depend on the current column-width layout (flex
// columns, sidebar state, viewport). As a second, geometry-independent
// proof that the wiring from the grid header down to `moveColumnGroup` is
// correct, this drives the API directly — the exact primitive
// `ColumnDrag`'s group-drag branch calls on mouseup (see
// `packages/kernel/src/interaction/features/columnDrag.ts`,
// `handleMouseUp`'s `dragKind === 'group'` branch).
test('API-driven: moveColumnGroup lifts the nested "Valuation" group out to the top level', async ({ page }) => {
  const before = await getColumnGroupDefs(page);
  expect(topLevelIds(before)).not.toContain('valuation');
  const tradeBefore = findNode(before, (d) => d.groupId === 'trade');
  expect(tradeBefore!.children.some((c: AnyDef) => c.groupId === 'valuation')).toBe(true);

  await page.evaluate(() => {
    (window as unknown as { __cgapi: any }).__cgapi.moveColumnGroup('valuation', null);
  });

  const after = await getColumnGroupDefs(page);
  expect(topLevelIds(after)).toContain('valuation');
  const tradeAfter = findNode(after, (d) => d.groupId === 'trade');
  expect(tradeAfter!.children.some((c: AnyDef) => c.groupId === 'valuation')).toBe(false);
  const valuationAfter = findNode(after, (d) => d.groupId === 'valuation');
  expect(valuationAfter!.children.some((c: AnyDef) => c.colId === 'notionalAmount')).toBe(true);
  expect(valuationAfter!.children.some((c: AnyDef) => c.colId === 'marketValue')).toBe(true);
});
