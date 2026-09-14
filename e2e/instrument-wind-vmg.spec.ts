import { expect, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

for (const width of [390, 820, 1440]) {
  test(`Wind VMG is selectable without a course at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stubVesselsSelf(page);
    await page.goto('/');
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette
      .getByRole('searchbox', { name: 'Search commands' })
      .fill('Edit screen instruments');
    await palette.getByRole('option', { name: 'Edit screen instruments' }).click();
    const layer = page.locator('.instrument-screen-layer');
    await layer.getByRole('button', { name: 'Add instrument', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Add instrument to chart' })
      .getByRole('menuitem', { name: 'VMG (wind)', exact: true })
      .click();
    await layer.getByRole('button', { name: 'Add instrument', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Add instrument to chart' })
      .getByRole('menuitem', { name: 'Polar performance', exact: true })
      .click();
    await layer.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(layer.getByRole('button', { name: /^VMG \(wind\)/ })).toBeVisible();
    await expect(layer.getByRole('button', { name: /^Polar performance/ })).toBeVisible();
  });
}
