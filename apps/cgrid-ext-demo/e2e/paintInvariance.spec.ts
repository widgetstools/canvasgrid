import { test, expect, type Page } from '@playwright/test';

// Pixel-invariance harness for damage-region rendering (Cycle: partial
// repaints for ticks/flash/hover/selection/focus + scroll blit). Two pages
// boot the SAME deterministic 200-row dataset (`?paintHarness`, STOMP feed
// disconnected — see main.ts's `seedHarnessRows`/mulberry32(42)): one paints
// with damage regions on (default), the other with `suppressPartialRepaint:
// true` (`&suppressPartial`, forces every repaint to the full-surface path).
// A scripted sequence of grid mutations runs IDENTICALLY on both pages;
// after each step, once `getPaintStats().paints` has settled (stable across
// two consecutive RAFs), the live canvas is hashed
// (`window.__paintHarness.snapshot()`, FNV-1a over every 16th RGBA byte).
// The two hashes must match at every step — a mismatch means the partial
// (damage-clipped) repaint path left stale or wrongly-clipped pixels behind
// that the full-surface path doesn't, i.e. a REAL bug in the damage/paint
// pipeline. Per the task's binding rule, a mismatch is fixed in the kernel,
// never hidden by widening the hash stride, reordering, or dropping a step.
//
// `getImageData` on the live canvas can pin it off the GPU compositing path
// for the rest of the page's life, which is why this only ever runs under
// `?paintHarness` and never on the normal demo page.

const boot = async (page: Page, query: string) => {
  await page.goto(`/?${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
  await expect(page.locator('.cgext-grid canvas')).toBeVisible();
  // Wait for the harness hook + seeded rows to actually be live before the
  // scripted steps start touching them.
  await page.waitForFunction(() => {
    const h = (window as any).__paintHarness;
    const g = (window as any).__ext?.grid;
    return !!h && !!g && g.getTotalRowCount() === 200;
  });
  await waitSettled(page);
};

const waitSettled = (page: Page) => page.evaluate(() => (window as any).__paintHarness.waitSettled());
const snapshot = (page: Page) => page.evaluate(() => (window as any).__paintHarness.snapshot());
const paintStats = (page: Page) => page.evaluate(() => (window as any).__ext.grid.getPaintStats());

// `getCellBoundsAt`/canvas-relative → viewport coordinates, matching the
// pattern columnConfig.spec.ts uses for `getHeaderBoundsAt`.
const cellCenter = (page: Page, rowIndex: number, colId: string) =>
  page.evaluate(([ri, c]) => {
    const g = (window as any).__ext.grid;
    const b = g.getCellBoundsAt(ri as number, c as string);
    const canvas = document.querySelector('.cg-canvas') as HTMLElement;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
  }, [rowIndex, colId] as [number, string]);

// Rows read back from `window.__paintHarness.rows` and merged with the
// update fields — the worker's `RowStore.apply` REPLACES the row wholesale
// on an `update` transaction (kernel/src/cgrid.ts, `applyTransaction`
// doc comment), so a bare `{ positionId, pnl }` patch would blank every
// other column; the demo's own STOMP path merges client-side for the same
// reason (stomp.ts's `rowStore.set(id, merged)`).
//
// The two data-mutating steps below target `currentPrice`, not `pnl` (the
// brief's illustrative pseudocode), deliberately: `pnl`/`dv01`/etc. carry a
// static `aggFunc: 'sum'` in main.ts's colDef (real demo columns — this
// harness reuses them verbatim, not a bespoke test schema), so mutating
// them changes the grand-total footer's aggregate. Footer/group cells
// carry no rowId and aren't yet migrated to cell-level damage (see
// cgrid.ts's `groupFlashMap`/`groupFlashChanged` handling — explicitly
// documented as "full is the correct conservative damage while any
// group/footer fade is still live"), so every frame of THAT fade forces a
// full repaint on both pages equally. That's expected, pre-existing,
// intentional behavior, not a pixel-correctness bug (verified: hashes still
// matched step-for-step even on `pnl`) — but it would swamp the
// `partialPaints > fullPaints` ratio this spec also asserts, for reasons
// unrelated to what this task is actually gating. `currentPrice` has no
// aggFunc and sits inside the default unscrolled viewport (unlike e.g.
// `spread`, which is scrolled off-screen and — correctly — never enters the
// worker's flash mask for an off-screen column), so it exercises the real
// tick/flash partial-repaint path cleanly.
const STEPS: Array<{ name: string; run: (page: Page) => Promise<void> }> = [
  {
    name: 'tx-update-2rows',
    run: (page) => page.evaluate(() => {
      const g = (window as any).__ext.grid;
      const rows = (window as any).__paintHarness.rows;
      const r3 = rows.find((r: any) => r.positionId === 'HARNESS-0003');
      const r7 = rows.find((r: any) => r.positionId === 'HARNESS-0007');
      g.applyTransactionAsync({ update: [{ ...r3, currentPrice: 101.5 }, { ...r7, currentPrice: 98.25 }] });
    }),
  },
  {
    // `FlashCellsParams` uses `colIds`, not `columns`.
    name: 'flash-cells',
    run: (page) => page.evaluate(() => {
      (window as any).__ext.grid.flashCells({ rowIds: ['HARNESS-0003', 'HARNESS-0007'], colIds: ['currentPrice'] });
    }),
  },
  {
    name: 'hover-row',
    run: async (page) => {
      const pt = await cellCenter(page, 5, 'pnl');
      await page.mouse.move(pt.x, pt.y);
    },
  },
  {
    // `setFocusedCell(rowId: string, colId: string)` — not a row index.
    name: 'focus-cell',
    run: (page) => page.evaluate(() => {
      (window as any).__ext.grid.setFocusedCell('HARNESS-0003', 'pnl');
    }),
  },
  {
    name: 'select-range',
    run: (page) => page.evaluate(() => {
      (window as any).__ext.grid.addCellRange({ rowStart: 2, rowEnd: 6, colIds: ['pnl', 'dv01'] });
    }),
  },
  {
    // No public `setScrollTop` API exists; the real DOM scroller
    // (`CGrid.getScroller()`, `.cg-scroller`, `overflow:auto`) is the
    // established E2E scroll idiom (see cgrid-positions'
    // cycle12-rangeOverlayScrolled.spec.ts). Row height is read back
    // (rather than hardcoded) so this holds under any density setting.
    name: 'scroll-3rows',
    run: (page) => page.evaluate(() => {
      const g = (window as any).__ext.grid;
      const rh = g.getRowBoundsAt(1).y - g.getRowBoundsAt(0).y;
      g.getScroller().scrollTop = rh * 3;
    }),
  },
  {
    name: 'scroll-back',
    run: (page) => page.evaluate(() => {
      (window as any).__ext.grid.getScroller().scrollTop = 0;
    }),
  },
  {
    // Past `cellFlashDuration` (500ms) + `cellFadeDuration` (1000ms) so
    // both pages settle to no-flash pixels before hashing.
    name: 'flash-expire',
    run: (page) => new Promise<void>((r) => { page.waitForTimeout(1800).then(r); }),
  },
];

test('partial and suppressed repaint produce identical pixels at every scripted step @dpr-locked', async ({ page, context }) => {
  const page2 = await context.newPage();
  try {
    await boot(page, 'paintHarness');
    await boot(page2, 'paintHarness&suppressPartial');

    for (const step of STEPS) {
      await step.run(page);
      await waitSettled(page);
      const hashP = await snapshot(page);

      await step.run(page2);
      await waitSettled(page2);
      const hashF = await snapshot(page2);

      expect(hashP, `step "${step.name}": partial-repaint pixels diverged from suppressed (full-repaint) pixels`).toBe(hashF);
    }

    const stats = await paintStats(page);
    expect(stats.partialPaints, 'expected the partial page to have actually taken the partial-repaint path').toBeGreaterThan(stats.fullPaints);
  } finally {
    await page2.close();
  }
});

// ─── Closeout fix wave (I5) — three more arms, each locking one Critical
// finding the base `?paintHarness` boot structurally could not reach: no
// active sort (C2), no grouping/sticky ancestors (C4), flash always on
// (C3). Each arm runs the SAME dual-page hash-compare technique as the
// main test above (identical step script on both the partial page and the
// suppressed/full-repaint page), just against a different boot
// configuration or a different step sequence.

test('sort-then-tick reorder produces identical pixels (C2 regression lock)', async ({ page, context }) => {
  const page2 = await context.newPage();
  try {
    await boot(page, 'paintHarness');
    await boot(page2, 'paintHarness&suppressPartial');

    // Sort ascending by `currentPrice`, THEN tick two rows to the extremes
    // of that order — this is C2's exact counterexample: a tick that
    // changes a sorted-by value permutes the visible order while the
    // window's rowStart/rowCount stay put, so a naive "same window ⇒ trust
    // touchedRows-named positions only" guard leaves every DISPLACED row
    // showing its old neighbor's stale content.
    const sortThenTick = async (p: Page) => {
      await p.evaluate(() => {
        (window as any).__ext.grid.setSortModel([{ colId: 'currentPrice', direction: 'asc' }]);
      });
      await waitSettled(p);
      await p.evaluate(() => {
        const g = (window as any).__ext.grid;
        const rows = (window as any).__paintHarness.rows;
        const r3 = rows.find((r: any) => r.positionId === 'HARNESS-0003');
        const r7 = rows.find((r: any) => r.positionId === 'HARNESS-0007');
        // Extreme values guarantee a real reorder into/out of the visible
        // top of the ascending sort, not just an in-place value update.
        g.applyTransactionAsync({ update: [{ ...r3, currentPrice: 999 }, { ...r7, currentPrice: -999 }] });
      });
    };

    await sortThenTick(page);
    await waitSettled(page);
    const hashP = await snapshot(page);

    await sortThenTick(page2);
    await waitSettled(page2);
    const hashF = await snapshot(page2);

    expect(hashP, 'sort-then-tick reorder: partial-repaint pixels diverged from suppressed pixels').toBe(hashF);
  } finally {
    await page2.close();
  }
});

test('grouped + sticky-ancestor tick produces identical pixels (C4 regression lock)', async ({ page, context }) => {
  const page2 = await context.newPage();
  try {
    await boot(page, 'paintHarness&grouped');
    await boot(page2, 'paintHarness&grouped&suppressPartial');

    // Scroll a few rows into the first group's children so its header
    // (the group row itself) scrolls above the fetch window and pins as a
    // sticky ancestor — `desk` has 4 distinct values across 200 rows
    // (~50 rows/group), so 5 rows is comfortably inside the first group's
    // children under any hash distribution.
    const scrollIntoGroup = (p: Page) => p.evaluate(() => {
      const g = (window as any).__ext.grid;
      const rh = g.getRowBoundsAt(1).y - g.getRowBoundsAt(0).y;
      g.getScroller().scrollTop = rh * 5;
    });
    await scrollIntoGroup(page);
    await waitSettled(page);
    await scrollIntoGroup(page2);
    await waitSettled(page2);

    // Sanity: the scroll actually produced a sticky ancestor — otherwise
    // this test would silently degrade into a no-op regression lock.
    const stickyCount = await page.evaluate(() => (window as any).__ext.grid.stickyAncestors?.length ?? 0);
    expect(stickyCount, 'expected the scroll to pin at least one group ancestor').toBeGreaterThan(0);

    // `pnl` carries `aggFunc: 'sum'` — changing it moves a group's (and the
    // grand) total, exactly C4's scenario: a sticky ancestor's pinned
    // total is invisible to the regular chunk-row damage paths, so it can
    // go stale on the partial path while the live leaf rows repaint fine.
    const tickAggregatedColumn = (p: Page) => p.evaluate(() => {
      const g = (window as any).__ext.grid;
      const rows = (window as any).__paintHarness.rows;
      const r3 = rows.find((r: any) => r.positionId === 'HARNESS-0003');
      const r7 = rows.find((r: any) => r.positionId === 'HARNESS-0007');
      g.applyTransactionAsync({ update: [{ ...r3, pnl: r3.pnl + 12345 }, { ...r7, pnl: r7.pnl - 6789 }] });
    });

    await tickAggregatedColumn(page);
    await waitSettled(page);
    const hashP = await snapshot(page);

    await tickAggregatedColumn(page2);
    await waitSettled(page2);
    const hashF = await snapshot(page2);

    expect(hashP, 'grouped sticky-ancestor tick: partial-repaint pixels diverged from suppressed pixels').toBe(hashF);
  } finally {
    await page2.close();
  }
});

test('flash-disabled aggregate tick produces identical pixels (C3 regression lock)', async ({ page, context }) => {
  const page2 = await context.newPage();
  try {
    await boot(page, 'paintHarness&noFlash');
    await boot(page2, 'paintHarness&noFlash&suppressPartial');

    // Same aggregated-column tick as the grouped arm above, but ungrouped
    // and with `enableCellChangeFlash: false` — the real grid DEFAULT,
    // never exercised by the base harness (which always ran flash on).
    // With flash off, `groupFlashMap` never populates, so the ONLY thing
    // that used to route a changed grand-total into damage was gone.
    const tickAggregatedColumn = (p: Page) => p.evaluate(() => {
      const g = (window as any).__ext.grid;
      const rows = (window as any).__paintHarness.rows;
      const r3 = rows.find((r: any) => r.positionId === 'HARNESS-0003');
      const r7 = rows.find((r: any) => r.positionId === 'HARNESS-0007');
      g.applyTransactionAsync({ update: [{ ...r3, pnl: r3.pnl + 12345 }, { ...r7, pnl: r7.pnl - 6789 }] });
    });

    await tickAggregatedColumn(page);
    await waitSettled(page);
    const hashP = await snapshot(page);

    await tickAggregatedColumn(page2);
    await waitSettled(page2);
    const hashF = await snapshot(page2);

    expect(hashP, 'flash-disabled aggregate tick: partial-repaint pixels diverged from suppressed pixels').toBe(hashF);
  } finally {
    await page2.close();
  }
});

test('live ticking mostly takes the partial-repaint path with small damage regions (needs stomp-view-server)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();

  let connected = false;
  try {
    await expect
      .poll(() => page.evaluate(() => (window as any).__ext?.grid.getTotalRowCount() ?? 0), { timeout: 15_000 })
      .toBeGreaterThan(0);
    connected = true;
  } catch {
    connected = false;
  }
  test.skip(!connected, 'stomp-view-server not reachable on ws://localhost:8081');

  await page.evaluate(() => (window as any).__ext.grid.resetPaintStats());
  // M4 (closeout review) — sample `lastAreaPct` repeatedly across the 5s
  // window instead of reading it once at the end. A single sample can land
  // on a lucky small paint and mask a regression drifting toward the 60%
  // `DAMAGE_MAX_AREA_FRACTION` full-repaint cap; a max+median bound over
  // many samples can't be fooled that way.
  //
  // Two correctness details this loop has to account for that a naive
  // fixed-interval poll would get wrong:
  //  1. `getPaintStats()`/`resetPaintStats()` seed `lastAreaPct: 100` as
  //     the "nothing measured YET since reset" sentinel (cgrid.ts) — a
  //     sample taken before the first post-reset paint lands would
  //     misread the sentinel as an actual full repaint.
  //  2. The real STOMP feed ticks in BURSTS, not continuously — a
  //     fixed-250ms poll re-reads the SAME `lastAreaPct` many times while
  //     waiting for the next burst (observed: one value repeated 10+
  //     times in a row), which skews the median toward whatever batch
  //     size happened to be showing when polls landed rather than the
  //     actual distribution of PAINTS. Polling faster (50ms) and only
  //     recording a sample when `paints` has advanced since the last
  //     check turns this into one sample per real paint instead of one
  //     sample per wall-clock tick.
  // Only sample the size of PARTIAL paints — a full paint always reports
  // `lastAreaPct: 100` by construction (it isn't measuring "how large is
  // the damage", it's the degrade-to-full escape valve), and this real,
  // server-driven feed occasionally sends a batch wide enough to
  // legitimately hit one of the ledger's own caps (`WINDOW_DIFF_MAX_ROWS`,
  // `DAMAGE_MAX_RECTS`, `DAMAGE_PRE_MERGE_CAP`, `DAMAGE_MAX_AREA_FRACTION`)
  // — that's the cap philosophy working as designed, not a regression, and
  // is already covered by the `partialPaints > fullPaints * 3` ratio check
  // below. Mixing occasional legitimate 100s into a partial-size bound
  // would make the bound meaningless (either too loose to catch a real
  // regression, or flaky against this feed's uncontrolled batch sizes).
  const samples: number[] = [];
  let lastPartialPaints = 0;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(50);
    const cur = await page.evaluate(() => (window as any).__ext.grid.getPaintStats());
    if (cur.partialPaints > lastPartialPaints) {
      samples.push(cur.lastAreaPct);
      lastPartialPaints = cur.partialPaints;
    }
  }
  const stats = await paintStats(page);

  expect(samples.length, 'expected at least one partial paint during the 5s sampling window').toBeGreaterThan(0);
  expect(stats.partialPaints).toBeGreaterThan(stats.fullPaints * 3);
  // Spec §7 (amended, closeout fix wave) — the original "<5" bar assumed a
  // damage region sized to ONE touched row against a full-height
  // production canvas. At this demo's actual row height + this suite's
  // viewport (a fixed ~32px row against a ~500px canvas), a SINGLE touched
  // row already bleeds to ~7-8% of the canvas — geometrically unattainable
  // at any batch size, not a masked inefficiency.
  //
  // Bounds calibrated against repeated real runs against this environment's
  // stomp-view-server (not the deterministic `?paintHarness` feed the C1-C4
  // regression locks above use) — this feed's batch sizes are genuinely
  // bursty and outside kernel control, so per-paint samples legitimately
  // range higher than a single end-of-window snapshot ever revealed
  // (observed medians ~6-18, individual partial-paint outliers up to ~57%
  // — still correctly BELOW the 60% `DAMAGE_MAX_AREA_FRACTION` cap, which
  // is what actually matters: a partial paint can mathematically never
  // reach the cap by construction, so `max` here is a cheap tripwire that
  // the cap-enforcement code path itself hasn't regressed, while `median`
  // is the real "typical damage stays small" signal).
  const sorted = [...samples].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1]!;
  const median = sorted[Math.floor(sorted.length / 2)]!;
  expect(max, `per-partial-paint lastAreaPct samples: ${samples.join(', ')}`).toBeLessThan(65);
  expect(median, `per-partial-paint lastAreaPct samples: ${samples.join(', ')}`).toBeLessThan(25);
});
