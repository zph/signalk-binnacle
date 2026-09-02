import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, stubVesselsSelf } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
});

test('the right-edge Instruments tab opens and closes the dock', async ({ page }) => {
  await page.goto('/');
  const dock = page.getByRole('complementary', { name: 'Instruments' });

  const open = page.getByRole('button', { name: 'Open instrument dock' });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();

  await expect(dock).toBeVisible();
  const close = page.getByRole('button', { name: 'Close instrument dock' });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  await close.click();

  await expect(dock).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open instrument dock' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('the helm Menu button toggles the supermenu and keeps lock and full-screen actions reachable', async ({
  page,
}) => {
  await page.goto('/');
  const helm = page.getByRole('group', { name: 'Helm actions' });
  await expect(helm.getByRole('button', { name: 'Lock Binnacle' })).toBeVisible();
  await expect(helm.getByRole('button', { name: 'Toggle full screen' })).toBeVisible();

  const menu = helm.getByRole('button', { name: 'Open supermenu' });
  await menu.click();
  await expect(page.getByRole('menu', { name: 'Supermenu' })).toBeVisible();
  await helm.getByRole('button', { name: 'Close supermenu' }).click();
  await expect(page.getByRole('menu', { name: 'Supermenu' })).toHaveCount(0);
});

test('the fixed bottom-toolbar controls fit a 320-pixel phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');

  const toolbar = page.locator('.status-strip');
  await expectNoHorizontalOverflow(toolbar);
  await expect(toolbar.getByRole('button', { name: 'Lock Binnacle' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Tracks' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Open instrument dock' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open instrument dock' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Mark man overboard here' })).toBeVisible();
});

test('status readouts stay below the action row and pin to opposite edges', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const toolbar = page.locator('.status-strip');
  const [toolbarBox, liveBox, vesselBox, actionsBox] = await Promise.all([
    toolbar.boundingBox(),
    toolbar.locator('.strip-start').boundingBox(),
    toolbar.locator('.center-cluster').boundingBox(),
    toolbar.locator('.strip-actions').boundingBox(),
  ]);
  if (!toolbarBox || !liveBox || !vesselBox || !actionsBox) {
    throw new Error('The status strip did not lay out.');
  }

  expect(liveBox.x).toBeLessThan(vesselBox.x);
  expect(liveBox.x + liveBox.width).toBeLessThanOrEqual(vesselBox.x);
  expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(Math.min(liveBox.y, vesselBox.y));
  expect(vesselBox.x + vesselBox.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width);
});

test('the interface lock stays reachable from full-screen Instruments', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Open instrument dock' }).click();
  const instruments = page.getByRole('dialog', { name: 'Instruments' });
  await expect(instruments).toBeVisible();
  await instruments.getByRole('button', { name: 'Lock Binnacle' }).click();

  const lockLayer = page.getByRole('dialog', { name: 'Binnacle controls locked' });
  await expect(lockLayer).toBeVisible();
  await lockLayer.getByRole('button', { name: 'Unlock Binnacle' }).click();
  await expect(lockLayer).toHaveCount(0);
  await expect(instruments).toBeVisible();
});
