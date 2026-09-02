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
  await expect(helm.getByRole('button', { name: 'Home' })).toBeVisible();

  const menu = helm.getByRole('button', { name: 'Open supermenu' });
  await menu.click();
  const supermenu = page.getByRole('menu', { name: 'Supermenu' });
  await expect(supermenu).toBeVisible();
  await expect(supermenu.getByRole('menuitem', { name: 'Navigate' })).toBeVisible();
  await expect(supermenu.getByRole('menuitem', { name: 'Chart' })).toBeVisible();
  await expect(supermenu.getByRole('menuitem', { name: 'Safety' })).toBeVisible();
  await supermenu.getByRole('menuitem', { name: 'Navigate' }).click();
  const back = supermenu.getByRole('menuitem', { name: 'Back to menu categories' });
  await expect(back).toBeVisible();
  await expect(back).toHaveClass(/action-dial-wedge--back/);
  await expect(supermenu.getByRole('menuitem', { name: /Center on boat/ })).toBeVisible();
  await supermenu.getByRole('menuitem', { name: 'Back to menu categories' }).click();
  await expect(supermenu.getByRole('menuitem', { name: 'Weather' })).toBeVisible();
  await helm.getByRole('button', { name: 'Close supermenu' }).click();
  await expect(supermenu).toHaveCount(0);
});

test('the Chart supermenu section shows and hides the instrument dock', async ({ page }) => {
  await page.goto('/');
  const helm = page.getByRole('group', { name: 'Helm actions' });
  const supermenu = page.getByRole('menu', { name: 'Supermenu' });

  await helm.getByRole('button', { name: 'Open supermenu' }).click();
  await supermenu.getByRole('menuitem', { name: 'Chart' }).click();
  await supermenu.getByRole('menuitem', { name: 'Show instruments' }).click();
  await expect(page.getByRole('complementary', { name: 'Instruments' })).toBeVisible();

  await helm.getByRole('button', { name: 'Open supermenu' }).click();
  await supermenu.getByRole('menuitem', { name: 'Vessel' }).click();
  await supermenu.getByRole('menuitem', { name: 'Hide instruments' }).click();
  await expect(page.getByRole('complementary', { name: 'Instruments' })).not.toBeVisible();
});

test('Home returns from an open panel to the chart', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Anchor watch', exact: true })
    .click();
  await expect(page.getByRole('complementary', { name: 'Anchor watch' })).toBeVisible();

  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('complementary', { name: 'Anchor watch' })).toHaveCount(0);
  await expect(page.locator('#app-menu-launcher')).toHaveCount(0);
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
