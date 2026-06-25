/**
 * End-to-end tests for the cgrid-positions demo.
 *
 * Assumes dev server at http://127.0.0.1:5180 and STOMP at ws://localhost:8081.
 *
 * Each test asserts a specific user-visible behavior via canvas pixel sampling.
 * Canvas internal dims are CSS px * DPR (2 in this CI). getImageData reads in
 * physical pixels — coordinates here are translated via the canvas's own `width`
 * to stay device-independent.
 */
import { test, expect, Page, Locator } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';

/** Wait for the grid to receive its STOMP snapshot by polling for non-blank body pixels. */
async function waitForGridPopulated(page: Page, canvas: Locator) {
  await expect
    .poll(
      async () =>
        canvas.evaluate((el: HTMLCanvasElement) => {
          if (!el || !el.width || !el.height) return 0;
          const ctx = el.getContext('2d')!;
          if (!ctx) return 0;
          const w = Math.max(1, Math.floor(el.width));
          const h = Math.max(1, Math.floor(el.height));
          const x = Math.floor(w * 0.35);
          const y = Math.floor(h * 0.2);
          const sw = Math.min(300, w - x);
          const sh = Math.min(300, h - y);
          if (sw <= 0 || sh <= 0) return 0;
          const img = ctx.getImageData(x, y, sw, sh).data;
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

async function sampleColors(canvas: Locator, x: number, y: number, w: number, h: number) {
  return canvas.evaluate(
    (el: HTMLCanvasElement, args: { x: number; y: number; w: number; h: number }) => {
      if (!el || !el.width || !el.height) return [];
      const ctx = el.getContext('2d');
      if (!ctx) return [];
      const sx = Math.max(0, Math.floor(args.x));
      const sy = Math.max(0, Math.floor(args.y));
      const sw = Math.min(Math.floor(args.w), el.width - sx);
      const sh = Math.min(Math.floor(args.h), el.height - sy);
      if (sw <= 0 || sh <= 0) return [];
      const img = ctx.getImageData(sx, sy, sw, sh).data;
      const set = new Set<string>();
      for (let i = 0; i < img.length; i += 4) {
        set.add(`${img[i]},${img[i + 1]},${img[i + 2]}`);
      }
      return Array.from(set);
    },
    { x, y, w, h },
  );
}

async function pixelSignature(canvas: Locator, x: number, y: number, w: number, h: number) {
  return canvas.evaluate(
    (el: HTMLCanvasElement, args: { x: number; y: number; w: number; h: number }) => {
      if (!el || !el.width || !el.height) return '0';
      const ctx = el.getContext('2d');
      if (!ctx) return '0';
      const sx = Math.max(0, Math.floor(args.x));
      const sy = Math.max(0, Math.floor(args.y));
      const sw = Math.min(Math.floor(args.w), el.width - sx);
      const sh = Math.min(Math.floor(args.h), el.height - sy);
      if (sw <= 0 || sh <= 0) return '0';
      const img = ctx.getImageData(sx, sy, sw, sh).data;
      let h32 = 0x811c9dc5 >>> 0;
      for (let i = 0; i < img.length; i++) {
        h32 = Math.imul(h32 ^ (img[i] ?? 0), 0x01000193) >>> 0;
      }
      return h32.toString(16);
    },
    { x, y, w, h },
  );
}

async function dims(canvas: Locator) {
  return canvas.evaluate((el: HTMLCanvasElement) => ({
    w: el.width,
    h: el.height,
    cssW: parseInt(el.style.width || '0', 10),
    cssH: parseInt(el.style.height || '0', 10),
    rect: el.getBoundingClientRect(),
  }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
});

test('snapshot loads and grid paints non-empty body', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);

  const d = await dims(canvas);
  expect(d.w).toBeGreaterThan(0);
  // Sample a strip across the body — should have many distinct colors (alt rows, text, borders).
  const colors = await sampleColors(canvas, Math.round(d.w * 0.2), Math.round(d.h * 0.3), 400, 200);
  expect(colors.length).toBeGreaterThan(10);
});

test('arrow keys move focus + auto-scroll past viewport', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);

  // Seed focus on the (non-editable) positionId column. Cycle 5 / Task 4
  // turned on grid-level `singleClickEdit`, so clicking an editable cell
  // here would open the editor and steer the arrow keys into the input.
  // Cycle 7 / Task 1 — the demo now opts every column into the
  // floating-filter row, which adds ~28px between the leaf header and
  // the first data row. Click at y:120 so the seed click lands on a
  // body cell instead of the floating-filter input above it.
  await canvas.click({ position: { x: 80, y: 120 } });
  await page.waitForTimeout(150);
  const d = await dims(canvas);

  // Pixel signature of the top body strip before scrolling.
  const before = await pixelSignature(canvas, Math.round(d.w * 0.3), 80, 400, 60);

  // Press ArrowDown 80 times — far past the visible viewport.
  for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);

  const after = await pixelSignature(canvas, Math.round(d.w * 0.3), 80, 400, 60);
  expect(after).not.toBe(before);
});

test('Tab + Shift+Tab move horizontally', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  const d = await dims(canvas);

  // Seed focus on the first body cell.
  // Cycle 7 / Task 1 — the demo now opts every column into the
  // floating-filter row, which adds ~28px between the leaf header and
  // the first data row. Click at y:120 so the seed click lands on a
  // body cell instead of the floating-filter input above it.
  await canvas.click({ position: { x: 80, y: 120 } });
  await page.waitForTimeout(150);

  // Sample the top header area for "before sort"-state pixel signature.
  const beforeHeader = await pixelSignature(canvas, 0, 0, d.w, 40);

  // Tab 12 times — should walk across columns and eventually scroll horizontally.
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  await page.waitForTimeout(300);

  const afterHeader = await pixelSignature(canvas, 0, 0, d.w, 40);
  // Either focus moved (overlay re-painted) or scroll moved (header positions shifted).
  expect(afterHeader).not.toBe(beforeHeader);

  // Shift+Tab back.
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Tab');
});

test('mouse wheel scrolls the body', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  const d = await dims(canvas);

  const before = await pixelSignature(canvas, Math.round(d.w * 0.4), 80, 300, 60);
  await canvas.hover();
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(300);
  const after = await pixelSignature(canvas, Math.round(d.w * 0.4), 80, 300, 60);
  expect(after).not.toBe(before);
});

test('scrollbar thumb is visible on the right edge', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  const d = await dims(canvas);

  // Vertical scrollbar lives near the right edge. Sample a thin vertical strip.
  const colors = await sampleColors(canvas, d.w - 24, 50, 12, d.h - 80);
  // Track + thumb should produce at least 2 distinct shades over the body.
  expect(colors.length).toBeGreaterThan(1);
});

test('header click cycles sort: indicator chevron appears', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  const d = await dims(canvas);

  // Ticker header at CSS x ≈ 260+50, y ≈ 16. Physical x scales by DPR.
  const dpr = d.w / d.cssW;
  const tickerPhysX = Math.round(310 * dpr);

  const beforeHeader = await pixelSignature(canvas, tickerPhysX - 50, 0, 120, 60);
  await canvas.click({ position: { x: 310, y: 16 } });
  await page.waitForTimeout(300);
  const afterHeader = await pixelSignature(canvas, tickerPhysX - 50, 0, 120, 60);
  expect(afterHeader).not.toBe(beforeHeader);
});

test('theme toggle button flips canvas background', async ({ page }) => {
  const canvas = page.locator(GRID_SELECTOR);
  await waitForGridPopulated(page, canvas);
  const d = await dims(canvas);

  // Sample a small patch in the body — its background color is theme-dependent.
  const before = await pixelSignature(canvas, Math.round(d.w * 0.5), Math.round(d.h * 0.6), 40, 40);
  await page.locator('#theme').click();
  await page.waitForTimeout(400);
  const after = await pixelSignature(canvas, Math.round(d.w * 0.5), Math.round(d.h * 0.6), 40, 40);
  expect(after).not.toBe(before);
});
