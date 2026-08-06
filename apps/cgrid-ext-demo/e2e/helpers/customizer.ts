import { expect, type Page, type Locator } from '@playwright/test';

/** Hermetic boot — fixed 200-row paint harness, clean storage. */
export async function bootCustomizer(page: Page): Promise<void> {
  await page.goto('/?paintHarness');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as unknown as { __ext?: { grid?: unknown } }).__ext?.grid, null, {
    timeout: 30_000,
  });
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
  await expect(page.locator('.cgext-grid canvas')).toBeVisible();
}

export async function openCustomizer(page: Page, moduleId?: string): Promise<void> {
  if (moduleId) {
    await page.evaluate((id) => {
      (window as unknown as { __ext: { openSettings: (m?: string) => void } }).__ext.openSettings(id);
    }, moduleId);
  } else {
    await page.locator('[data-item-id="overflow"] button').click();
  }
  await expect(page.locator('.cgext-sheet.is-open, .cgext-sheet:not([hidden])')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.cgext-sheet-body')).toBeVisible();
}

export async function closeViaDone(page: Page): Promise<void> {
  await page.locator('[data-testid="cgext-sheet-done"]').click();
  await expect(page.locator('.cgext-sheet')).toBeHidden({ timeout: 5_000 });
}

export async function switchTab(page: Page, title: string): Promise<void> {
  const tab = page.locator('.cgext-sheet-nav-item', { hasText: title });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.locator('.cgext-sheet-title')).toHaveText(title);
}

export function sheet(page: Page): Locator {
  return page.locator('.cgext-sheet');
}

export function cockpit(page: Page): Locator {
  return page.locator('.cgext-sheet .ckp');
}

/** Type into the focused CodeMirror contenteditable.
 *  Do NOT press Escape (shell closes the sheet) and do NOT blur the editor —
 *  ExpressionEditor calls onCommit on blur, which auto-Saves the card. */
export async function typeInCm(page: Page, text: string): Promise<void> {
  const content = page.locator('.ckp .cm-content').first();
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.type(text, { delay: 15 });
}

/** Click cockpit Save; force avoids rare grid chrome hit-test interception. */
export async function saveCard(page: Page): Promise<void> {
  const btn = page.locator('.ckp-actbtn', { hasText: 'Save' });
  await expect(btn).toBeEnabled({ timeout: 8_000 });
  await btn.click({ force: true });
  await expect(btn).toBeDisabled({ timeout: 8_000 });
}

/** Click cockpit Reset. */
export async function resetCard(page: Page): Promise<void> {
  const btn = page.locator('.ckp-actbtn', { hasText: 'Reset' });
  await expect(btn).toBeEnabled();
  await btn.click({ force: true });
}

/** Drag helper for column-groups panel (4px threshold). */
export async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sBox = await source.boundingBox();
  const tBox = await target.boundingBox();
  if (!sBox || !tBox) throw new Error('dragOnto: missing bounding box');
  const sx = sBox.x + sBox.width / 2;
  const sy = sBox.y + sBox.height / 2;
  const tx = tBox.x + tBox.width / 2;
  const ty = tBox.y + tBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 20, sy + 20, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 10 });
  await page.mouse.up();
}

export async function gridOption<T = unknown>(page: Page, key: string): Promise<T> {
  return page.evaluate((k) => {
    return (window as unknown as { __ext: { grid: { getGridOption: (x: string) => unknown } } })
      .__ext.grid.getGridOption(k) as T;
  }, key);
}
