import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('edge tabs independently expand and restore the chart shell', async ({ page }) => {
  await page.goto('/');

  const chart = page.locator('.chart-host');
  const initial = await chart.boundingBox();
  expect(initial).not.toBeNull();

  await page.getByRole('button', { name: 'Hide top bar' }).click();
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show top bar' })).toBeVisible();
  const withoutTop = await chart.boundingBox();
  expect(withoutTop?.y).toBeLessThan(initial?.y ?? Number.POSITIVE_INFINITY);

  await page.getByRole('button', { name: 'Hide bottom bar' }).click();
  await expect(page.locator('.status-strip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show bottom bar' })).toBeVisible();
  const withoutBars = await chart.boundingBox();
  expect(withoutBars?.height).toBeGreaterThan(withoutTop?.height ?? 0);

  await page.getByRole('button', { name: 'Show top bar' }).click();
  await page.getByRole('button', { name: 'Show bottom bar' }).click();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.status-strip')).toBeVisible();
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
