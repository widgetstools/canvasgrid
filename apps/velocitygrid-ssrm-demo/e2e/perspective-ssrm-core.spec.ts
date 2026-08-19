import { test, expect } from '@playwright/test';
import {
  bootSeed,
  probe,
  expectHealthyPaint,
  ensureIndex,
  scrollBody,
  cellValue,
  visibleCell,
  waitSettled,
} from './helpers';

test.describe('StompPerspectiveProvider SSRM (seed feed)', () => {
  test('boots seed book through Perspective SSRM datasource', async ({ page }) => {
    const n = await bootSeed(page, 3_000);
    expect(n).toBe(3_000);
    expect(await cellValue(page, 0, 'positionId')).toBeTruthy();
    expect(await cellValue(page, 0, 'desk')).toBeTruthy();

    const tele = await page.evaluate(() => {
      const t = (window as any).__simple.provider.book.getTelemetry();
      return {
        feed: (window as any).__simple.feed,
        book: t.bookSize,
        served: t.rowsServedTotal,
        phase: t.phase,
      };
    });
    expect(tele.feed).toBe('seed');
    expect(tele.book).toBe(3_000);
    expect(tele.served).toBeGreaterThan(0);
    expect(tele.served).toBeLessThan(tele.book); // sparse windowing
    expectHealthyPaint(await probe(page), 'seed boot');
  });

  test('vertical scroll mid-book stays painted', async ({ page }) => {
    await bootSeed(page, 3_000);
    await ensureIndex(page, 1_200);
    expect(await visibleCell(page, 'positionId')).toBeTruthy();
    expectHealthyPaint(await probe(page), 'mid scroll');

    await scrollBody(page, { top: 40_000 });
    expectHealthyPaint(await probe(page), 'deep scroll');

    await scrollBody(page, { top: 0 });
    expect(await cellValue(page, 0, 'positionId')).toBeTruthy();
  });

  test('setSortModel re-fetches via Perspective and keeps paint healthy', async ({ page }) => {
    await bootSeed(page, 2_000);
    await page.evaluate(() => {
      (window as any).__simple.grid.setSortModel([
        { colId: 'pnl', direction: 'desc' },
      ]);
    });
    await page.waitForTimeout(400);
    await waitSettled(page);

    const model = await page.evaluate(() =>
      (window as any).__simple.grid.getSortModel(),
    );
    expect(model[0]?.colId).toBe('pnl');
    expect(await cellValue(page, 0, 'pnl')).not.toBeNull();
    expectHealthyPaint(await probe(page), 'after sort');
  });

  test('soft refresh keeps hydrated cells', async ({ page }) => {
    await bootSeed(page, 2_000);
    await ensureIndex(page, 400);
    const before = await visibleCell(page, 'positionId');
    await page.evaluate(() => {
      (window as any).__simple.grid.refreshServerSide({ purge: false });
    });
    await page.waitForTimeout(300);
    await waitSettled(page);
    expect(await visibleCell(page, 'positionId')).toBeTruthy();
    if (before) expect(String(await visibleCell(page, 'positionId')).length).toBeGreaterThan(0);
    expectHealthyPaint(await probe(page), 'soft refresh');
  });

  test('group-by desk pushes down to Perspective skeleton', async ({ page }) => {
    await bootSeed(page, 2_000);
    await page.evaluate(() => {
      (window as any).__simple.grid.setRowGroupColumns(['desk']);
    });
    await expect.poll(async () =>
      page.evaluate(() => (window as any).__simple.grid.getDisplayedRowCount()),
      { timeout: 30_000 },
    ).toBeLessThan(50);
    await page.waitForTimeout(400);
    const n = await page.evaluate(() =>
      (window as any).__simple.grid.getDisplayedRowCount(),
    );
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(50);
  });
});
