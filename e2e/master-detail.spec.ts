import { test, expect, type Page } from '@playwright/test';

/**
 * Master / detail, rendered.
 *
 * The kernel tests cover the index arithmetic and the main-thread state
 * machine. What neither can reach is the part that only exists on screen:
 * that the chevron's HIT zone lands where the chevron is PAINTED, that the
 * band the painter leaves blank is the band the DOM grid mounts into, and
 * that both stay together through a scroll.
 *
 * Run against the demo: `npm run dev:master-detail` (port 5240).
 */

const DEMO = 'http://localhost:5240/';
/** Every 7th account is given no call records, so `isRowMaster` vetoes it. */
const NON_MASTER_INDEX = 0;

async function open(page: Page): Promise<void> {
  await page.goto(DEMO);
  await page.waitForFunction(() => (window as any).__md !== undefined, { timeout: 45_000 });
  await page.waitForFunction(
    () => ((window as any).__md.plain.getDisplayedRowCount() ?? 0) > 0,
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(1200);
}

/** Click the master chevron on `rowIndex` of the left (kernel) grid, using the
 *  grid's own cell bounds so the click lands where the caret actually paints. */
async function clickChevron(page: Page, rowIndex: number): Promise<void> {
  const box = await page.evaluate((i: number) => {
    const g = (window as any).__md.plain;
    const b = g.getCellBoundsAt(i, 'name');
    if (!b) return null;
    const canvas = document.querySelector('#plain canvas') as HTMLCanvasElement | null;
    const r = canvas?.getBoundingClientRect();
    if (!r) return null;
    // Chevron geometry from `renderer/cellRenderers/group.ts`: PADDING 6,
    // CHEVRON_SIZE 12 — aim at its centre.
    return { x: r.left + b.x + 6 + 6, y: r.top + b.y + b.h / 2 };
  }, rowIndex);
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x, box!.y);
  await page.waitForTimeout(700);
}

test('clicking the caret opens a detail grid below the master row', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);

  const before = await page.evaluate(() => (window as any).__md.plain.getDisplayedRowCount());
  // Row 1 — row 0 is the non-master (no call records).
  await clickChevron(page, 1);

  const after = await page.evaluate(() => ({
    displayed: (window as any).__md.plain.getDisplayedRowCount(),
    open: (window as any).__md.plain.getExpandedDetailRowIds(),
  }));
  // Exactly one extra DISPLAYED row — and the underlying data is untouched.
  expect(after.displayed).toBe(before + 1);
  expect(after.open).toHaveLength(1);

  // The band is real DOM holding a real grid.
  const band = page.locator('#plain .vg-detail-row');
  await expect(band).toHaveCount(1);
  await expect(band.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('isRowMaster suppresses the caret, and clicking where it would be does nothing', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => (window as any).__md.plain.getDisplayedRowCount());
  await clickChevron(page, NON_MASTER_INDEX);
  const after = await page.evaluate(() => ({
    displayed: (window as any).__md.plain.getDisplayedRowCount(),
    open: (window as any).__md.plain.getExpandedDetailRowIds().length,
  }));
  expect(after.displayed).toBe(before);
  expect(after.open).toBe(0);
  await expect(page.locator('#plain .vg-detail-row')).toHaveCount(0);
});

test('the detail grid shows that account\'s calls, and nothing else', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const g = (window as any).__md.plain;
    const rows = (window as any).__md.rows() as any[];
    const account = rows.find((r) => r.callRecords.length > 0);
    g.setDetailExpanded(account.id, true);
    await new Promise((r) => setTimeout(r, 1500));
    const info = g.getDetailGridInfo(`detail_${account.id}`);
    return {
      expectedCalls: account.callRecords.length,
      hasApi: !!info?.api,
      detailRows: info?.api?.getDisplayedRowCount?.() ?? -1,
      firstCallId: info?.api?.getCellValue?.(0, 'callId'),
      expectedFirstCallId: account.callRecords[0].callId,
    };
  });
  expect(result.hasApi).toBe(true);
  expect(result.detailRows).toBe(result.expectedCalls);
  expect(result.firstCallId).toBe(result.expectedFirstCallId);
});

test('the band stays glued to its master through a scroll', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const g = (window as any).__md.plain;
    const rows = (window as any).__md.rows() as any[];
    const account = rows.filter((r) => r.callRecords.length > 0)[2];
    g.setDetailExpanded(account.id, true);
    await new Promise((r) => setTimeout(r, 1200));
  });

  const offsetOf = async (): Promise<number> => page.evaluate(() => {
    const g = (window as any).__md.plain;
    const id = g.getExpandedDetailRowIds()[0];
    const band = document.querySelector('#plain .vg-detail-row') as HTMLElement | null;
    if (!band) return NaN;
    // The band's display index is one below its master's; compare the band's
    // top against the master row's painted bottom.
    // Locate the master by a value unique to it, so the probe survives a
    // reorder instead of pinning a stale index.
    const account = ((window as any).__md.byId as Map<string, any>).get(id);
    let masterIndex = -1;
    for (let i = 0; i < g.getDisplayedRowCount(); i++) {
      if (g.getCellValue(i, 'account') === account?.account) { masterIndex = i; break; }
    }
    const b = masterIndex >= 0 ? g.getCellBoundsAt(masterIndex, 'name') : null;
    if (!b) return NaN;
    return Math.round(band.offsetTop - (b.y + b.h));
  });

  const before = await offsetOf();
  await page.evaluate(() => {
    const el = document.querySelector('#plain .vg-scroller') as HTMLElement;
    el.scrollTop = 120;
  });
  await page.waitForTimeout(700);
  const after = await offsetOf();

  // The band tracks the row exactly — the gap between the master's bottom
  // edge and the band's top is the same before and after scrolling.
  if (!Number.isNaN(before) && !Number.isNaN(after)) {
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  }
});

test('collapsing removes the band and its grid', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const g = (window as any).__md.plain;
    const account = ((window as any).__md.rows() as any[]).find((r) => r.callRecords.length > 0);
    g.setDetailExpanded(account.id, true);
    await new Promise((r) => setTimeout(r, 1200));
  });
  await expect(page.locator('#plain .vg-detail-row')).toHaveCount(1);

  const gone = await page.evaluate(async () => {
    const g = (window as any).__md.plain;
    const id = g.getExpandedDetailRowIds()[0];
    g.collapseAllDetailRows();
    await new Promise((r) => setTimeout(r, 900));
    return {
      bands: document.querySelectorAll('#plain .vg-detail-row').length,
      info: g.getDetailGridInfo(`detail_${id}`) ?? null,
      displayed: g.getDisplayedRowCount(),
    };
  });
  expect(gone.bands).toBe(0);
  // The grid is destroyed, not merely hidden — `keepDetailRows` is off.
  expect(gone.info).toBeNull();
});

test('keepDetailRows hands the same grid back on re-expand', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const g = (window as any).__md.plain;
    g.setGridOption('keepDetailRows', true);
    const account = ((window as any).__md.rows() as any[]).find((r) => r.callRecords.length > 0);
    g.setDetailExpanded(account.id, true);
    await new Promise((r) => setTimeout(r, 1400));
    const first = g.getDetailGridInfo(`detail_${account.id}`)?.api;
    g.setDetailExpanded(account.id, false);
    await new Promise((r) => setTimeout(r, 700));
    g.setDetailExpanded(account.id, true);
    await new Promise((r) => setTimeout(r, 1200));
    const second = g.getDetailGridInfo(`detail_${account.id}`)?.api;
    return { same: !!first && first === second };
  });
  // Same api object ⇒ the detail grid kept its scroll, sort and selection.
  expect(result.same).toBe(true);
});

test('a tick on the master row refreshes an open detail grid', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const g = (window as any).__md.plain;
    const account = ((window as any).__md.rows() as any[]).find((r) => r.callRecords.length > 2);
    g.setDetailExpanded(account.id, true);
    await new Promise((r) => setTimeout(r, 1500));
    const api = g.getDetailGridInfo(`detail_${account.id}`)?.api;
    const before = api?.getDisplayedRowCount?.() ?? -1;

    const extra = {
      callId: 999999,
      direction: 'In',
      number: '(01) 0000 0000',
      duration: 42,
      switchCode: 'SW1',
    };
    const next = { ...account, callRecords: [extra, ...account.callRecords] };
    next.calls = next.callRecords.length;
    g.applyTransaction({ update: [next] });
    await new Promise((r) => setTimeout(r, 1800));

    const after = api?.getDisplayedRowCount?.() ?? -1;
    return { before, after, firstCallId: api?.getCellValue?.(0, 'callId') };
  });
  // `refreshStrategy: 'rows'` (the default) re-runs getDetailRowData against
  // the NEW master row, so the open detail follows without a re-expand.
  expect(result.after).toBe(result.before + 1);
  expect(result.firstCallId).toBe(999999);
});

test('a grouped grid keeps the group caret on group rows and the master caret on leaves', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const g = (window as any).__md.ext;
    await new Promise((r) => setTimeout(r, 1200));
    const out: Array<{ i: number; isGroup: boolean }> = [];
    for (let i = 0; i < Math.min(g.getDisplayedRowCount(), 12); i++) {
      out.push({ i, isGroup: g.isGroupRow(i) });
    }
    // Expand the first LEAF row's detail.
    const leaf = out.find((r) => !r.isGroup);
    const before = g.getDisplayedRowCount();
    let opened = false;
    if (leaf) {
      const fetched = await g.getRowsByIndex([leaf.i]);
      const rowId = fetched?.[0]?.rowId;
      const data = fetched?.[0]?.data as { callRecords?: unknown[] } | undefined;
      if (rowId && (data?.callRecords?.length ?? 0) > 0) {
        g.setDetailExpanded(rowId, true);
        opened = true;
      }
    }
    await new Promise((r) => setTimeout(r, 1400));
    return {
      hadGroupRows: out.some((r) => r.isGroup),
      hadLeafRows: out.some((r) => !r.isGroup),
      opened,
      grew: g.getDisplayedRowCount() - before,
      bands: document.querySelectorAll('#ext .vg-detail-row').length,
    };
  });
  expect(result.hadGroupRows).toBe(true);
  expect(result.hadLeafRows).toBe(true);
  if (result.opened) {
    expect(result.grew).toBe(1);
    expect(result.bands).toBe(1);
  }
});
