import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('the attached tab expands and restores the bottom toolbar', async ({ page }) => {
  await page.goto('/');

  const chart = page.locator('.chart-host');
  const initial = await chart.boundingBox();
  expect(initial).not.toBeNull();
  await expect(page.locator('.binnacle-shell > header')).toHaveCount(0);
  expect(initial?.y).toBe(0);

  const status = page.locator('.status-strip');
  const statusBox = await status.boundingBox();
  const tabBox = await page.getByRole('button', { name: 'Hide bottom bar' }).boundingBox();
  expect(statusBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  expect(Math.abs((tabBox?.y ?? 0) + (tabBox?.height ?? 0) - (statusBox?.y ?? 0))).toBeLessThan(2);

  await page.getByRole('button', { name: 'Hide bottom bar' }).click();
  await expect(page.locator('.status-strip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show bottom bar' })).toBeVisible();
  const withoutBottom = await chart.boundingBox();
  expect(withoutBottom?.height).toBeGreaterThan(initial?.height ?? 0);

  await page.getByRole('button', { name: 'Show bottom bar' }).click();
  await expect(page.locator('.status-strip')).toBeVisible();
});

test('lower toolbar owns menu, profile, theme, and app information', async ({ page }) => {
  await page.goto('/');

  const toolbar = page.locator('.status-strip');
  await expect(toolbar.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect(toolbar.getByTitle(/switch profile/i)).toBeVisible();
  await expect(toolbar.getByRole('button', { name: /theme/i })).toBeVisible();
  await toolbar.getByRole('button', { name: 'About Binnacle Custom' }).click();
  await expect(page.getByRole('group', { name: 'Binnacle information' })).toContainText(
    'Binnacle Custom',
  );
  await expect(page.getByRole('group', { name: 'Binnacle information' })).toContainText('Version');
});

test('chart context menu requests browser fullscreen for the chart surface', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = async function () {
      this.dataset.fullscreenRequested = 'true';
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
  await page.goto('/');

  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  await canvas.click({ button: 'right', position: { x: 200, y: 200 } });
  await page.getByRole('menuitem', { name: 'Full screen' }).click();

  await expect(page.locator('.chart-canvas')).toHaveAttribute('data-fullscreen-requested', 'true');
});
