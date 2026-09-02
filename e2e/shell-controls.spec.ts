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

test('left edge owns the menu while the lower toolbar owns profile, theme, and app information', async ({
  page,
}) => {
  await page.goto('/');

  const toolbar = page.locator('.status-strip');
  await expect(toolbar.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect(toolbar.getByTitle(/switch profile/i)).toBeVisible();
  await expect(toolbar.getByRole('button', { name: /theme/i })).toBeVisible();
  await toolbar.getByRole('button', { name: 'About Binnacle Custom' }).click();
  await expect(page.getByRole('group', { name: 'Binnacle information' })).toContainText(
    'Binnacle Custom',
  );
  await expect(page.getByRole('group', { name: 'Binnacle information' })).toContainText('Version');
});

test('the attached left tab expands and collapses the app-menu dock', async ({ page }) => {
  await page.goto('/');

  const chart = page.locator('.chart-host');
  const menuButton = page.getByRole('button', { name: 'Menu', exact: true });
  const initialChart = await chart.boundingBox();
  const collapsedTab = await menuButton.boundingBox();
  expect(initialChart).not.toBeNull();
  expect(collapsedTab).not.toBeNull();
  expect(collapsedTab?.x).toBeLessThan(2);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

  await menuButton.click();
  await expect(page.locator('#app-menu-launcher')).toBeVisible();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect
    .poll(async () => {
      const expandedMenu = await page.locator('#app-menu-launcher').boundingBox();
      const expandedTab = await menuButton.boundingBox();
      return Math.abs((expandedMenu?.x ?? 0) + (expandedMenu?.width ?? 0) - (expandedTab?.x ?? 0));
    })
    .toBeLessThan(2);
  const expandedChart = await chart.boundingBox();
  expect(expandedChart?.x).toBeGreaterThan(initialChart?.x ?? 0);
  expect(expandedChart?.width).toBeLessThan(initialChart?.width ?? 0);

  await menuButton.click();
  await expect(page.locator('#app-menu-launcher')).toHaveCount(0);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
});

test('an edge swipe retraces menu navigation to the chart', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Anchor watch', exact: true })
    .click();
  await expect(page.getByRole('complementary', { name: 'Anchor watch' })).toBeVisible();

  const swipeBack = async () => {
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: 0,
          clientY: 160,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'touch',
        }),
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: 84,
          clientY: 160,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'touch',
        }),
      );
    });
  };

  await swipeBack();
  await expect(page.locator('#app-menu-launcher')).toBeVisible();
  await swipeBack();
  await expect(page.locator('#app-menu-launcher')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Anchor watch' })).toHaveCount(0);
});

test('bottom Menu quick actions request browser fullscreen', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = async function () {
      this.dataset.fullscreenRequested = 'true';
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Open quick actions' }).click();
  await page.getByRole('menuitem', { name: 'Maximize Binnacle' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-fullscreen-requested', 'true');
});

test('chart quick actions can lock the entire interface', async ({ page }) => {
  await page.goto('/');

  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  await canvas.click({ button: 'right', position: { x: 200, y: 200 } });
  await page.getByRole('menuitem', { name: 'Lock controls' }).click();

  const lockLayer = page.getByRole('dialog', { name: 'Binnacle controls locked' });
  await expect(lockLayer).toBeVisible();
});

test('chart quick actions replace the rectangular context menu with location actions', async ({
  page,
}) => {
  await page.goto('/');

  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  await canvas.click({ button: 'right', position: { x: 200, y: 200 } });
  await expect(page.getByRole('menuitem', { name: 'Go to here' })).toBeVisible();
  await expect(page.locator('.chart-context-menu')).toHaveCount(0);
});
