import { test, expect } from '@playwright/test';
import {
  bootLiveStomp,
  requireBroker,
  probe,
  expectHealthyPaint,
  ensureIndex,
  scrollBody,
  cellValue,
  visibleCell,
  waitSettled,
} from './helpers';

/**
 * Live STOMP broker → StompPerspectiveProvider SSRM.
 * Skips when :8082 is down unless REQUIRE_STOMP=1.
 */
test.describe('StompPerspectiveProvider live STOMP @live-stomp', () => {
  test.beforeEach(async ({}, testInfo) => {
    await requireBroker(testInfo);
  });

  test('feed=stomp binds broker snapshot into Perspective SSRM', async ({ page }) => {
    const n = await bootLiveStomp(page);
    expect(n).toBeGreaterThan(100);

    const info = await page.evaluate(() => {
      const s = (window as any).__simple;
      const t = s.provider.book.getTelemetry();
      return {
        feed: s.feed,
        cell: s.grid.getCellValue(0, 'positionId'),
        book: t.bookSize,
        phase: t.phase,
      };
    });
    expect(info.feed).toBe('stomp');
    expect(info.cell).toBeTruthy();
    expect(info.book).toBeGreaterThan(100);
    expectHealthyPaint(await probe(page), 'live stomp boot');
  });

  test('live scroll mid-book stays painted', async ({ page }) => {
    await bootLiveStomp(page);
    await ensureIndex(page, 800);
    expect(await visibleCell(page, 'positionId')).toBeTruthy();
    expectHealthyPaint(await probe(page), 'live mid');

    await scrollBody(page, { top: 30_000 });
    expectHealthyPaint(await probe(page), 'live deep');
  });

  test('live ExprTK calc column works on STOMP book', async ({ page }) => {
    await bootLiveStomp(page);
    const res = await page.evaluate(async () =>
      (window as any).__simple.addPerspectiveCalc({
        colId: 'totalPnl',
        expression: '"pnl" + "dailyPnl"',
        headerName: 'Total PnL',
      }),
    );
    expect(res.ok, res.error).toBe(true);

    await expect.poll(async () => {
      const v = await cellValue(page, 0, 'totalPnl');
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }, { timeout: 45_000 }).not.toBeNull();

    expectHealthyPaint(await probe(page), 'live ExprTK');
  });

  test('live soft refresh keeps cells', async ({ page }) => {
    await bootLiveStomp(page);
    await ensureIndex(page, 200);
    await page.evaluate(() => {
      (window as any).__simple.grid.refreshServerSide({ purge: false });
    });
    await page.waitForTimeout(500);
    await waitSettled(page);
    expect(await visibleCell(page, 'positionId')).toBeTruthy();
    expectHealthyPaint(await probe(page), 'live soft refresh');
  });
});
