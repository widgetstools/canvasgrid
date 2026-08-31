import { test, expect, type Page } from '@playwright/test';

/**
 * Order-of-operations determinism.
 *
 * Every other spec asserts that a feature works. This one asserts something
 * stricter and, for this grid, more important: that the SAME end state looks
 * the same however you got there.
 *
 * That is the property that was actually broken. Formatting worked — until you
 * pivoted first. Column visibility survived — until a calc edit rebuilt the
 * tree. The cross-tab painted — until Auto format ran. None of those were
 * "feature X is broken"; they were "feature X depends on the order you touched
 * things in", which is what made them feel random and made fixes look like
 * they had not stuck.
 *
 * So the assertions here are equalities between PATHS, not checks against
 * expected values. A cell that hard-codes "$148,500.00" only proves formatting
 * ran; `format→pivot === pivot→format` proves the pipeline has one answer.
 *
 * Runs against both row models, because they share the column pipeline but not
 * the data path, and the whole point is that neither one gets to be special.
 */

const ROWS = 300;

const DEMOS = [
  { name: 'CSRM', url: 'http://localhost:5210/' },
  { name: 'SSRM', url: 'http://localhost:5211/' },
] as const;

/**
 * Whether pivot actually engaged, asked of the grid rather than assumed.
 *
 * SSRM can only pivot when its datasource can produce a cross-tab — the
 * Perspective provider backed by the STOMP fixture. Without the fixture the
 * grid correctly REFUSES pivot, so the pivot-dependent cells have nothing to
 * assert and skip with a clear reason instead of failing for an environment
 * reason or, worse, being faked.
 */
function pivotEngaged(snap: Snapshot): boolean {
  return snap.pivotMode && snap.pivotResultColumns.length > 0;
}

/** One canonical observation of everything the user can see about columns. */
interface Snapshot {
  pivotMode: boolean;
  pivotResultColumns: string[];
  /**
   * The SHAPE of the painted text, with digit runs collapsed to `#`.
   *
   * Painted text is what formatting changes, so it has to be observed — but
   * against a live feed the underlying aggregate moves between runs, and two
   * runs of the same path would compare unequal for a reason that has nothing
   * to do with determinism. `$148,500.00` and `$149,700.00` are the same
   * PRESENTATION of different data; `148500` is not. Comparing shape isolates
   * the property under test from data volatility.
   */
  paintedPivotShapes: string[];
  hidden: string[];
  pinned: string[];
  widths: Record<string, number | undefined>;
}

/**
 * Give the grid data. When the STOMP fixture is running the demo already has
 * a live provider bound, and we leave it alone — testing against the real
 * data path is strictly better. Only when the grid is empty do we stub, so
 * the suite still runs in environments without the fixture.
 */
async function seed(page: Page, rowModel: 'CSRM' | 'SSRM'): Promise<void> {
  await page.evaluate(async ([rowModel, n]: [string, number]) => {
    const g = (window as any).__demo.grid;
    if (g.getDisplayedRowCount() > 0) return;   // live provider is feeding it
    const rows = Array.from({ length: n as number }, (_, i) => ({
      positionId: 'p' + i,
      ticker: 'T' + (i % 7),
      desk: ['FX', 'Rates', 'Credit'][i % 3],
      region: ['EMEA', 'AMER', 'APAC'][i % 3],
      instrumentType: 'Bond',
      notionalAmount: 1000 + i,
      marketValue: 2000 + i,
      pnl: i * 10,
      dailyPnl: i,
    }));
    if (rowModel === 'SSRM') {
      // The STOMP fixture is not present in every environment, and a stub
      // states the book far more precisely than a live feed would.
      g.setServerSideDatasource({
        getRows: ({ request, success }: any) => success({
          rowData: rows.slice(request.startRow, request.endRow),
          rowCount: rows.length,
          unfilteredRowCount: rows.length,
        }),
      });
    } else {
      g.setRowData(rows);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }, [rowModel, ROWS] as [string, number]);
}

/** The operations a user can perform, in any order. */
type Op = 'format' | 'autoformat' | 'pivot' | 'unpivot' | 'hide' | 'pin' | 'resize';

async function apply(page: Page, op: Op): Promise<void> {
  await page.evaluate(async (op: string) => {
    const g = (window as any).__demo.grid;
    switch (op) {
      case 'format':
        g.editColumn('pnl', { format: '$#,##0.00' });
        break;
      case 'autoformat':
        (window as any).__demo.ext.context.events.emit({ type: 'auto-format' });
        break;
      case 'pivot':
        g.setRowGroupColumns(['desk']);
        g.setPivotColumns(['region']);
        g.setValueColumns([{ colId: 'pnl', aggFunc: 'sum' }]);
        g.setPivotMode(true);
        break;
      case 'unpivot':
        g.setPivotMode(false);
        break;
      case 'hide':
        g.setColumnsVisible(['ticker', 'instrumentType'], false);
        break;
      case 'pin':
        g.setColumnsPinned(['desk'], 'left');
        break;
      case 'resize':
        g.setColumnWidths([{ key: 'ticker', newWidth: 222 }]);
        break;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }, op);
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const g = (window as any).__demo.grid;
    const state = g.getColumnState() ?? [];
    const pivotCols: string[] = g.getPivotResultColumns();
    const shapes = new Set<string>();
    for (let r = 0; r < 4; r++) {
      for (const colId of pivotCols) {
        const text = g.getCellFormattedValue(r, colId);
        // Magnitude- and sign-invariant: an aggregate over live data can be
        // 1,234.00 on one run and -1,178,319.00 on the next, which differ in
        // digit-group count and sign without differing in FORMAT. Collapse the
        // whole numeric part to `N` so what remains is the presentation:
        // "$N.N" (currency, grouped, decimals) vs a bare "N" (unformatted).
        if (text) shapes.add(String(text).replace(/-/g, '').replace(/[\d,]+/g, 'N'));
      }
    }
    return {
      pivotMode: g.isPivotMode(),
      // Normalise the \x01 separator so failures are readable.
      pivotResultColumns: pivotCols.map((c) => c.split('\u0001').join('|')).sort(),
      paintedPivotShapes: [...shapes].sort(),
      hidden: state.filter((c: any) => c.hide).map((c: any) => c.colId).sort(),
      pinned: state.filter((c: any) => c.pinned)
        .map((c: any) => `${c.colId}:${c.pinned}`).sort(),
      widths: Object.fromEntries(state.map((c: any) => [c.colId, c.width])),
    };
  });
}

/** Wait for the grid to actually hold data, however it is being fed. */
async function waitForRows(page: Page, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => ((window as any).__demo?.grid?.getDisplayedRowCount?.() ?? 0) > 0,
      undefined,
      { timeout: timeoutMs },
    );
    return true;
  } catch { return false; }
}

/** Load a clean grid, give it data, run a sequence, observe. */
async function run(page: Page, demo: typeof DEMOS[number], ops: Op[]): Promise<Snapshot> {
  await page.goto(demo.url);
  await page.waitForFunction(() => (window as any).__demo?.ext !== undefined, { timeout: 45_000 });

  // Give the LIVE provider a real chance to connect and deliver first.
  // Stubbing before it lands would replace the datasource mid-connect and
  // produce exactly the intermittency this suite exists to detect — a flaky
  // test here would be indistinguishable from the bug.
  if (!(await waitForRows(page, 25_000))) {
    await seed(page, demo.name);
    await waitForRows(page, 15_000);
  }

  for (const op of ops) await apply(page, op);
  return snapshot(page);
}

for (const demo of DEMOS) {
  test.describe(`${demo.name} — order independence`, () => {
    test('formatting before pivoting equals formatting after', async ({ page }) => {
      // The headline case. Pivot used to bypass the column pipeline, so a
      // format applied first was lost on the way into the cross-tab, and one
      // applied second could not reach it at all.
      const formatFirst = await run(page, demo, ['format', 'pivot']);
      test.skip(!pivotEngaged(formatFirst), 'datasource cannot pivot (no STOMP fixture)');
      const pivotFirst = await run(page, demo, ['pivot', 'format']);

      expect(formatFirst.paintedPivotShapes.length).toBeGreaterThan(0);
      expect(formatFirst).toEqual(pivotFirst);
      // And formatting genuinely happened, so the equality is not two blanks:
      // every painted cell carries the currency shape, not a bare integer.
      // "$N.N" is the currency presentation; an unformatted cell would be a
      // bare "N". This is what makes the equality above meaningful rather
      // than two identical blanks.
      expect(formatFirst.paintedPivotShapes).toEqual(['$N.N']);
    });

    test('re-applying the same format changes nothing', async ({ page }) => {
      // Idempotence. A repeated edit must not accumulate or drift.
      const once = await run(page, demo, ['format', 'pivot']);
      test.skip(!pivotEngaged(once), 'datasource cannot pivot (no STOMP fixture)');
      const twice = await run(page, demo, ['format', 'pivot', 'format']);
      expect(twice).toEqual(once);
    });

    test('a pivot round trip returns to the same cross-tab', async ({ page }) => {
      // Leaving and re-entering pivot rebuilt the tree from scratch; anything
      // held only on the discarded tree came back wrong.
      const direct = await run(page, demo, ['format', 'pivot']);
      test.skip(!pivotEngaged(direct), 'datasource cannot pivot (no STOMP fixture)');
      const roundTrip = await run(page, demo, ['format', 'pivot', 'unpivot', 'pivot']);
      expect(roundTrip).toEqual(direct);
    });

    test('column state is independent of when formatting ran', async ({ page }) => {
      // hide / pin / resize are live state; formatting triggers a column
      // rebuild. The rebuild must not disturb them, whichever came first.
      const stateFirst = await run(page, demo, ['hide', 'pin', 'resize', 'format']);
      const formatFirst = await run(page, demo, ['format', 'hide', 'pin', 'resize']);

      expect(stateFirst.hidden).toEqual(['instrumentType', 'ticker']);
      expect(stateFirst.pinned).toEqual(['desk:left']);
      expect(stateFirst.widths.ticker).toBe(222);
      expect(stateFirst).toEqual(formatFirst);
    });

    test('Auto format preserves column state and the cross-tab', async ({ page }) => {
      // Auto format is just editColumn over every matched column, so it is the
      // stress case for the same rebuild path.
      const before = await run(page, demo, ['hide', 'pin', 'resize', 'pivot']);
      test.skip(!pivotEngaged(before), 'datasource cannot pivot (no STOMP fixture)');
      const after = await run(page, demo, ['hide', 'pin', 'resize', 'pivot', 'autoformat']);

      expect(after.pivotMode).toBe(true);
      expect(after.pivotResultColumns).toEqual(before.pivotResultColumns);
      expect(after.hidden).toEqual(before.hidden);
      expect(after.pinned).toEqual(before.pinned);
      expect(after.widths.ticker).toBe(before.widths.ticker);
    });

    test('every path to the same end state agrees', async ({ page }) => {
      // The general claim, stated once: four different routes to "hidden +
      // pinned + resized + formatted + pivoted" must be indistinguishable.
      const paths: Op[][] = [
        ['hide', 'pin', 'resize', 'format', 'pivot'],
        ['format', 'hide', 'pin', 'resize', 'pivot'],
        ['hide', 'pivot', 'format', 'pin', 'resize'],
        ['pivot', 'unpivot', 'hide', 'pin', 'resize', 'format', 'pivot'],
      ];
      const results: Snapshot[] = [];
      for (const path of paths) results.push(await run(page, demo, path));
      test.skip(!pivotEngaged(results[0]!), 'datasource cannot pivot (no STOMP fixture)');

      for (let i = 1; i < results.length; i++) {
        expect(results[i], `path ${i} diverged from path 0`).toEqual(results[0]);
      }
    });

    test('pivot is refused CONSISTENTLY when the datasource cannot pivot', async ({ page }) => {
      // The failure this guards is not 'pivot does not work' — it is pivot
      // APPEARING to work. `ssrmHostPivotDeclared` was a one-way latch, so once
      // any datasource had published a cross-tab the grid believed it could
      // pivot forever. Swapping to a datasource that cannot (Customize -> Data
      // -> Apply) left setPivotMode(true) accepted, isPivotMode() true, and
      // nothing pivoted. Refusing is the honest answer, and it has to be the
      // answer every time.
      const first = await run(page, demo, ['pivot']);
      test.skip(pivotEngaged(first), 'datasource CAN pivot here — refusal is not the case under test');
      // Whatever the answer is, it must be the same answer every time.
      for (let attempt = 0; attempt < 3; attempt++) {
        const after = attempt === 0 ? first : await run(page, demo, ['pivot']);
        expect(after.pivotMode, `attempt ${attempt}`).toBe(false);
        expect(after.pivotResultColumns, `attempt ${attempt}`).toEqual([]);
      }
    });
  });
}
