import { test, expect, type Page } from '@playwright/test';
import { bootCustomizer } from './helpers/customizer';

/**
 * Markets parity — formatting ribbon (bold / align / clear / enable-on-select).
 * Checklist: stern-bak/apps/e2e/v2-formatting-toolbar.spec.ts
 * Format presets already covered by formatPicker.spec.ts / iconRibbon.spec.ts.
 */

test.beforeEach(async ({ page }) => {
  await bootCustomizer(page);
});

async function selectColumn(page: Page, colId: string): Promise<void> {
  await page.evaluate((c) => {
    const g = (window as unknown as {
      __ext: {
        grid: {
          clearCellRanges: () => void;
          addCellRange: (r: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
        };
      };
    }).__ext.grid;
    g.clearCellRanges();
    g.addCellRange({ rowStart: 0, rowEnd: 0, colIds: [c] });
  }, colId);
}

async function ownCellStyle(page: Page, colId: string): Promise<Record<string, unknown> | undefined> {
  return page.evaluate((c) => {
    const g = (window as unknown as {
      __ext: {
        grid: {
          getTemplates: () => Array<{ id: string; overrides?: { cellStyle?: Record<string, unknown> } }>;
        };
      };
    }).__ext.grid;
    const own = g.getTemplates().find((t) => t.id === `__cgridOwn:${c}`);
    return own?.overrides?.cellStyle;
  }, colId);
}

function boldBtn(page: Page) {
  return page.locator('.vgext-ribbon button[title="Bold"]');
}

function alignRightBtn(page: Page) {
  return page.locator('.vgext-ribbon button[title="Align right"]');
}

test.describe('Formatting toolbar (Markets parity)', () => {
  test('toolbar enables once a cell is selected', async ({ page }) => {
    // Markets: v2-formatting-toolbar — toolbar moves into enabled state once selected
    await expect(boldBtn(page)).toBeDisabled();
    await selectColumn(page, 'pnl');
    await expect(boldBtn(page)).toBeEnabled({ timeout: 5_000 });
  });

  test('Bold writes fontWeight bold on own template', async ({ page }) => {
    // Markets: v2-formatting-toolbar — Bold writes typography.bold
    await selectColumn(page, 'pnl');
    await expect(boldBtn(page)).toBeEnabled();
    await boldBtn(page).click();
    await expect.poll(async () => (await ownCellStyle(page, 'pnl'))?.fontWeight).toBe('bold');
  });

  test('Italic and Underline write fontStyle / textDecoration', async ({ page }) => {
    // Markets: v2-formatting-toolbar — Italic / Underline
    await selectColumn(page, 'ticker');
    const italic = page.locator('.vgext-ribbon button[title="Italic"]');
    const underline = page.locator('.vgext-ribbon button[title="Underline"]');
    await expect(italic).toBeEnabled();
    await italic.click();
    await expect.poll(async () => (await ownCellStyle(page, 'ticker'))?.fontStyle).toBe('italic');
    await underline.click();
    await expect.poll(async () => (await ownCellStyle(page, 'ticker'))?.textDecoration).toBe('underline');
  });

  test('Align right writes halign; column clear resets styles', async ({ page }) => {
    // Markets: v2-formatting-toolbar — Right align + Clear styles
    await selectColumn(page, 'currency');
    await expect(alignRightBtn(page)).toBeEnabled();
    await alignRightBtn(page).click();
    await expect.poll(async () => (await ownCellStyle(page, 'currency'))?.halign).toBe('right');

    await boldBtn(page).click();
    await expect.poll(async () => (await ownCellStyle(page, 'currency'))?.fontWeight).toBe('bold');

    const clearBtn = page.locator('.vgext-ribbon button[data-fmt="clear"]');
    await expect(clearBtn).toBeEnabled();
    await clearBtn.click();
    await expect.poll(async () => {
      const style = await ownCellStyle(page, 'currency');
      return style == null || Object.keys(style).length === 0
        || (style.fontWeight !== 'bold' && style.halign !== 'right');
    }).toBe(true);
  });

  test('narrow viewport shows format overflow control when groups overflow', async ({ page }) => {
    // Markets: formatting overflow / canvasgrid ribbonOverflow
    await selectColumn(page, 'pnl');
    await page.setViewportSize({ width: 720, height: 800 });
    await page.waitForTimeout(200);
    const overflow = page.locator('.vgext-ribbon button[data-tb="format-overflow"]');
    // Overflow button appears when groups don't fit; if not overflowed at 720, shrink further.
    if (!(await overflow.isVisible().catch(() => false))) {
      await page.setViewportSize({ width: 480, height: 800 });
      await page.waitForTimeout(200);
    }
    await expect(overflow).toBeVisible({ timeout: 5_000 });
    await overflow.click();
    await expect(page.locator('.vgext-menu.vgext-rb-overflow-panel')).toBeVisible();
  });
});
