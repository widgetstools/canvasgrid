/**
 * Cycle 6 / Task 6 — `columnTypes` templates.
 *
 * The demo declares one shared bundle:
 *   columnTypes: { money: { cellDataType: 'number', valueFormatter: (currency) } }
 * and applies `type: 'money'` to both `notionalAmount` and `marketValue`.
 *
 * This spec asserts the merge mechanism actually fired at resolve time
 * by reaching into the live grid's `columnDefsMap` (the resolved leaf
 * lookup) and proving:
 *   - both money-typed columns have the bundle's numeric cellDataType
 *   - both columns received the SAME `valueFormatter` reference (proving
 *     the bundle is what merged in — a per-column formatter would have
 *     a different identity)
 *   - the bundle is invocable and produces a currency-formatted string.
 *
 * `columnDefsMap` is TypeScript-private but exists at runtime — the
 * page.evaluate context bypasses TS visibility, which is exactly how
 * E2E parity checks normally read engine internals.
 */
import { test, expect } from '@playwright/test';

type FormatterFn = (params: { data: unknown; value: unknown; colId: string }) => string;

interface ResolvedColDefRuntime {
  cellDataType: 'text' | 'number';
  valueFormatter?: FormatterFn;
}

interface GridRuntime {
  columnDefsMap: Map<string, ResolvedColDefRuntime>;
}

const CURRENCY_RE = /^\$[\d,]+\.\d{2}$/;

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

test.describe('Cycle 6 / Task 6 — columnTypes templates', () => {
  test('both money-typed columns share the bundle formatter and cellDataType', async ({ page }) => {
    await gridReady(page);

    const result = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridRuntime }).__cgrid;
      const notional = grid.columnDefsMap.get('notionalAmount');
      const market = grid.columnDefsMap.get('marketValue');
      if (!notional || !market) {
        return { ok: false as const, reason: 'missing-column' };
      }
      const sharedFormatter = notional.valueFormatter === market.valueFormatter;
      const sample = notional.valueFormatter
        ? notional.valueFormatter({ data: {}, value: 1234567.89, colId: 'notionalAmount' })
        : null;
      return {
        ok: true as const,
        notionalDataType: notional.cellDataType,
        marketDataType: market.cellDataType,
        bothHaveFormatter: typeof notional.valueFormatter === 'function'
                        && typeof market.valueFormatter === 'function',
        sharedFormatter,
        sample,
      };
    });

    if (!result.ok) throw new Error(`Setup failure: ${result.reason}`);

    // The bundle declared `cellDataType: 'number'`; both money columns
    // must reflect that after the resolve-time merge.
    expect(result.notionalDataType).toBe('number');
    expect(result.marketDataType).toBe('number');

    // Sharing a single function reference proves the bundle's formatter
    // is what merged in (per-column formatters would have different
    // identities).
    expect(result.bothHaveFormatter).toBe(true);
    expect(result.sharedFormatter).toBe(true);

    // The shared `Intl.NumberFormat({ style: 'currency' })` formatter
    // emits "$1,234,567.89" for a numeric input.
    expect(result.sample).not.toBeNull();
    expect(result.sample!).toMatch(CURRENCY_RE);
  });
});
