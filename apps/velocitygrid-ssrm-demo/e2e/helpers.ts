import { expect, type Page } from '@playwright/test';

export type BodyPaintProbe = {
  width: number;
  height: number;
  blackRatio: number;
  maxBlackRun: number;
  uniqueApprox: number;
  signature: string;
  nonEmptyCells: number;
  chunkRowStart: number;
};

/** Seeded Perspective book — no broker. Dedicated worker avoids SharedWorker flake. */
export const SEED_URL =
  '/simple.html?feed=seed&worker=dedicated&rows=3000';

/** Live STOMP → Perspective book (stomp-view-server :8082). */
export const LIVE_STOMP_URL =
  '/simple.html?feed=stomp&worker=dedicated&rows=5000&wsUrl=ws://localhost:8082&clientId=TRADER001';

export async function bootSeed(page: Page, rows = 3_000): Promise<number> {
  // Low tick rate so paint settle / assertions aren't fought by the seed feed.
  await page.goto(
    `/simple.html?feed=seed&worker=dedicated&rows=${rows}&rate=2`,
  );
  await page.waitForFunction(() => !!(window as any).__simple?.grid, null, {
    timeout: 60_000,
  });
  const n = await page.evaluate(async (min) => {
    const s = (window as any).__simple;
    // Pause seed tick fan-out so paint settle / scroll assertions are stable.
    s.provider.book.setPauseFanout?.(true);
    return s.waitForRows(min, 90_000);
  }, Math.min(100, rows));
  await page.evaluate(() => (window as any).__simple.waitPaintSettled(3, 1500));
  return n;
}

export async function bootLiveStomp(page: Page): Promise<number> {
  await page.goto(LIVE_STOMP_URL);
  await page.waitForFunction(() => !!(window as any).__simple?.grid, null, {
    timeout: 60_000,
  });
  return page.evaluate(async () => (window as any).__simple.waitForRows(100, 90_000));
}

export async function brokerHealthy(port = 8082): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function requireBroker(
  testInfo: { skip: (cond?: boolean, desc?: string) => void },
): Promise<void> {
  const ok = await brokerHealthy(8082);
  if (!ok) {
    if (process.env.REQUIRE_STOMP === '1') {
      throw new Error('REQUIRE_STOMP=1 but :8082 health failed');
    }
    testInfo.skip(true, 'STOMP broker not running on :8082');
  }
}

export async function probe(page: Page): Promise<BodyPaintProbe> {
  return page.evaluate(() => (window as any).__simple.probeBodyPaint());
}

export function expectHealthyPaint(p: BodyPaintProbe, label: string): void {
  expect(p.width, `${label}: width`).toBeGreaterThan(100);
  expect(p.nonEmptyCells, `${label}: cells`).toBeGreaterThan(5);
  expect(p.blackRatio, `${label}: blackRatio=${p.blackRatio}`).toBeLessThan(0.4);
  expect(p.uniqueApprox, `${label}: uniqueApprox`).toBeGreaterThan(6);
}

export async function waitSettled(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__simple.waitPaintSettled(3, 1500));
}

export async function cellValue(page: Page, row: number, col: string): Promise<unknown> {
  return page.evaluate(
    ([r, c]) => (window as any).__simple.grid.getCellValue(r, c),
    [row, col] as [number, string],
  );
}

export async function visibleCell(page: Page, col: string, offset = 0): Promise<unknown> {
  return page.evaluate(
    ([c, off]) => {
      const s = (window as any).__simple;
      const win = s.getChunkWindow();
      if (!win || win.rowCount <= 0) return null;
      return s.grid.getCellValue(win.rowStart + Math.min(off, win.rowCount - 1), c);
    },
    [col, offset] as [string, number],
  );
}

export async function ensureIndex(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    (window as any).__simple.grid.ensureIndexVisible(i, 'middle');
  }, index);
  await page.waitForTimeout(200);
  await waitSettled(page);
}

export async function scrollBody(
  page: Page,
  opts: { top?: number; left?: number },
): Promise<void> {
  await page.evaluate((o) => {
    const scroller = (window as any).__simple.grid.getScroller();
    if (typeof o.top === 'number') scroller.scrollTop = o.top;
    if (typeof o.left === 'number') scroller.scrollLeft = o.left;
  }, opts);
  await page.waitForTimeout(150);
  await waitSettled(page);
}
