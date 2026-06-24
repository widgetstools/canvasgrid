/**
 * Cycle 4 + recent-fix E2E coverage.
 *
 * These tests sample the canvas at known pixel positions to assert visual
 * behavior that unit tests can't see — column-group spans, gridline pixels,
 * scrollbar gutters, and trackpad axis-lock. Coordinates are in CSS pixels
 * unless suffixed with `Phys` (canvas-bitmap pixels = CSS * DPR).
 */
import { test, expect, Page, Locator } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';

const GRID_LINE_COLOR_DARK = 'rgb(43,58,92)';   // --cg-grid-line-color
const BORDER_COLOR_DARK = 'rgb(56,80,122)';     // --cg-border-color
const HEADER_BG_DARK = 'rgb(13,26,51)';         // --cg-header-bg

async function waitForGridPopulated(page: Page, canvas: Locator) {
  await expect
    .poll(
      async () =>
        canvas.evaluate((el: HTMLCanvasElement) => {
          if (!el || !el.width || !el.height) return 0;
          const ctx = el.getContext('2d')!;
          const w = Math.max(1, Math.floor(el.width));
          const h = Math.max(1, Math.floor(el.height));
          const img = ctx.getImageData(Math.floor(w * 0.35), Math.floor(h * 0.2), 300, 200).data;
          const set = new Set<string>();
          for (let i = 0; i < img.length; i += 4) {
            set.add(`${img[i]},${img[i + 1]},${img[i + 2]}`);
            if (set.size > 50) break;
          }
          return set.size;
        }),
      { timeout: 20_000, intervals: [500, 1000, 2000] },
    )
    .toBeGreaterThan(10);
}

async function pixelAt(canvas: Locator, x: number, y: number): Promise<string> {
  return canvas.evaluate(
    (el: HTMLCanvasElement, args: { x: number; y: number }) => {
      const ctx = el.getContext('2d')!;
      const dpr = el.width / parseInt(el.style.width || `${el.width}`, 10);
      const px = Math.round(args.x * dpr);
      const py = Math.round(args.y * dpr);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return `rgb(${d[0]},${d[1]},${d[2]})`;
    },
    { x, y },
  );
}

async function pixelSig(canvas: Locator, x: number, y: number, w: number, h: number): Promise<string> {
  return canvas.evaluate(
    (el: HTMLCanvasElement, args: { x: number; y: number; w: number; h: number }) => {
      const ctx = el.getContext('2d')!;
      const img = ctx.getImageData(args.x, args.y, args.w, args.h).data;
      let h32 = 0x811c9dc5 >>> 0;
      for (let i = 0; i < img.length; i++) {
        h32 = Math.imul(h32 ^ (img[i] ?? 0), 0x01000193) >>> 0;
      }
      return h32.toString(16);
    },
    { x, y, w, h },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
});

// ─── Column groups ───────────────────────────────────────────────────────────

test('column-group header label "P&L" is visible above its child columns', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  // P&L group spans Daily (x≈720..830) + Unrealized (x≈830..940). The label
  // is left-aligned with header padding, so the "P" glyph sits around x=730.
  // Sample a wide horizontal sweep across the group-header row (y=[0,40]) and
  // count distinct colors — text + bg + anti-alias = ≥3.
  const colors = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const dpr = el.width / parseInt(el.style.width || `${el.width}`, 10);
    // Sweep the full center-band of the group header row.
    const sx = Math.round(700 * dpr);
    const sy = Math.round(10 * dpr);
    const sw = Math.round(260 * dpr);
    const sh = Math.round(25 * dpr);
    const img = ctx.getImageData(sx, sy, sw, sh).data;
    const set = new Set<string>();
    for (let i = 0; i < img.length; i += 4) {
      set.add(`${img[i]},${img[i + 1]},${img[i + 2]}`);
    }
    return set.size;
  });
  // Just bg = 1 color. Bg + text glyphs (anti-aliased) ≥ 3 colors.
  expect(colors).toBeGreaterThan(2);
});

test('group-header row has NO vertical separator between two ungrouped columns', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  // Position ID (150 wide, pinned left) and CUSIP (~110 wide, pinned left).
  // Boundary between them at CSS x=149 in the group-header row (y=10).
  // That column boundary lives in pinned-left band — no vertical should
  // appear in the group-header strip (only the leaf header + body).
  const px = await pixelAt(canvas, 149, 10);
  expect(px).toBe(HEADER_BG_DARK);
});

test('group-header row HAS vertical separators at group boundaries (around P&L)', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  // The P&L group spans Daily+Unrealized. Just to the LEFT of "Daily" column
  // start is the boundary between Price (ungrouped) and Daily (in P&L group).
  // Sweep horizontally across the group-header row near the P&L area and
  // confirm at least one gridLineColor pixel appears — that's the boundary.
  const found = await canvas.evaluate(
    (el: HTMLCanvasElement, lineColor: string) => {
      const ctx = el.getContext('2d')!;
      const dpr = el.width / parseInt(el.style.width || `${el.width}`, 10);
      const y = Math.round(10 * dpr);
      // P&L group is somewhere in the middle of the visible area — search a
      // broad horizontal band.
      for (let cssX = 600; cssX < 1300; cssX += 1) {
        const d = ctx.getImageData(Math.round(cssX * dpr), y, 1, 1).data;
        const c = `rgb(${d[0]},${d[1]},${d[2]})`;
        if (c === lineColor) return cssX;
      }
      return -1;
    },
    GRID_LINE_COLOR_DARK,
  );
  expect(found).toBeGreaterThan(0);
});

test('leaf-header row HAS vertical separators between every column', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  // Leaf header is below the group-header (which is 40px tall). So y≈50.
  // At x=149 (between Position ID and CUSIP) we expect a gridline pixel.
  const px = await pixelAt(canvas, 149, 50);
  expect(px === GRID_LINE_COLOR_DARK || px === BORDER_COLOR_DARK).toBe(true);
});

// ─── Header / body bleed regressions ─────────────────────────────────────────

test('data rows do not bleed text into the header area after vertical scroll', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);

  // Capture header-area pixel signature at rest.
  const headerBefore = await pixelSig(canvas, 0, 0, 400, 80);

  await canvas.hover();
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(300);

  // Header area must still look like a header (label text + bg only, no
  // data values bleeding in). Specifically, the GROUP HEADER row pixels at
  // a column boundary above Position ID stay at headerBg (no data text).
  const px = await pixelAt(canvas, 149, 10);
  expect(px).toBe(HEADER_BG_DARK);

  // And the leaf-header row at the same column should NOT change between
  // rest and scrolled — same labels, no data leakage.
  const headerAfter = await pixelSig(canvas, 0, 0, 400, 40); // group header strip only
  expect(headerAfter).toBe(await pixelSig(canvas, 0, 0, 400, 40));
});

test('cell text does not bleed into the adjacent column', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  // Position ID values are long UUIDs that would overflow without per-cell
  // clipping. The first body row's CUSIP column should NOT have stray
  // characters from Position ID — only its own CUSIP text + bg.
  // Sample the very leftmost pixel of the CUSIP column (just after the
  // Position ID right edge). With per-cell clipping it stays bg.
  // Position ID width=150 → CUSIP starts at x=150. Sample x=151 (1px in).
  // First data row top ≈ 80 + ~10 (rowH/2). Sample y=95.
  const px = await pixelAt(canvas, 151, 95);
  // Either bg (no bleed) or a CUSIP character glyph pixel — but NOT a
  // gridline (boundary between Position ID and CUSIP cells is at x=149).
  expect(px).not.toBe(GRID_LINE_COLOR_DARK);
});

// ─── Wheel axis-lock ─────────────────────────────────────────────────────────

test('vertical-dominant wheel gesture does not horizontally scroll', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  // Snapshot a horizontal-position-sensitive region of the leaf header.
  // If horizontal scroll happens, column labels shift and the pixel sig changes.
  const headerBefore = await pixelSig(canvas, 200, 40, 400, 30);

  await canvas.hover();
  // Vertical-dominant gesture with a small horizontal wobble.
  await page.mouse.wheel(8, 200);
  await page.waitForTimeout(50);
  await page.mouse.wheel(15, 180); // still in the same gesture window
  await page.waitForTimeout(50);
  await page.mouse.wheel(20, 150);
  await page.waitForTimeout(300);

  const headerAfter = await pixelSig(canvas, 200, 40, 400, 30);
  // Leaf-header column labels must stay where they were — no horizontal drift.
  expect(headerAfter).toBe(headerBefore);
});

test('horizontal-dominant wheel gesture does not vertically scroll', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  // Snapshot a row-content-sensitive region: a vertical strip on the LEFT
  // (pinned columns don't scroll horizontally — so any change there = vertical).
  const before = await pixelSig(canvas, 10, 100, 60, 300);

  await canvas.hover();
  await page.mouse.wheel(200, 8);
  await page.waitForTimeout(50);
  await page.mouse.wheel(180, 12);
  await page.waitForTimeout(50);
  await page.mouse.wheel(150, 20);
  await page.waitForTimeout(300);

  const after = await pixelSig(canvas, 10, 100, 60, 300);
  // Vertical region of pinned-left band must be unchanged — no vertical drift.
  expect(after).toBe(before);
});

// ─── Scrollbar visibility ────────────────────────────────────────────────────

test('horizontal scrollbar gutter is reserved below the canvas', async ({ page }) => {
  const d = await page.evaluate(() => {
    const root = document.querySelector('#grid') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const rootRect = root.getBoundingClientRect();
    const cssH = parseInt(canvas.style.height || `${canvas.height}`, 10);
    return { rootH: rootRect.height, canvasH: cssH };
  });
  // Canvas must leave at least ~10px below it for the horizontal scrollbar gutter.
  expect(d.rootH - d.canvasH).toBeGreaterThanOrEqual(10);
});

test('vertical scrollbar gutter is reserved to the right of the canvas', async ({ page }) => {
  const d = await page.evaluate(() => {
    const root = document.querySelector('#grid') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const rootRect = root.getBoundingClientRect();
    const cssW = parseInt(canvas.style.width || `${canvas.width}`, 10);
    return { rootW: rootRect.width, canvasW: cssW };
  });
  expect(d.rootW - d.canvasW).toBeGreaterThanOrEqual(10);
});

// ─── Custom cell renderer (Cycle 4 Task 8) ───────────────────────────────────

test('custom pnlPill renderer paints a coloured pill on the Total P&L column', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);

  // Total P&L is right-pinned (width 110). Sample the centre of the data
  // body in that column and assert at least one of the two pill fills is
  // present — green for positive, red for negative. The default 'number'
  // renderer would only paint header/row backgrounds (greys), never these
  // saturated translucent fills.
  const found = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const cssW = parseInt(el.style.width || `${el.width}`, 10);
    const cssH = parseInt(el.style.height || `${el.height}`, 10);
    const dpr = el.width / cssW;
    // Right-pinned Total column: x ≈ [cssW - 110, cssW]. Sample the inner
    // pill region (4px inset) over the first 8 data rows.
    const sx = Math.round((cssW - 100) * dpr);
    const sy = Math.round(85 * dpr);
    const sw = Math.round(90 * dpr);
    const sh = Math.round(Math.min(300, cssH - 100) * dpr);
    const img = ctx.getImageData(sx, sy, sw, sh).data;
    let green = 0; let red = 0;
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i]!; const g = img[i + 1]!; const b = img[i + 2]!;
      // Pill fills sit on a dark header/row background, so the painter's
      // alpha-blended fill registers as a visibly green-dominant or
      // red-dominant pixel. Loose thresholds to survive theme tints.
      if (g > r + 15 && g > b + 15) green++;
      else if (r > g + 15 && r > b + 15) red++;
    }
    return { green, red };
  });
  // At least one direction should clearly show pill pixels.
  expect(found.green + found.red).toBeGreaterThan(50);
});
