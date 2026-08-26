import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, stubVesselsSelf } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
});

test('the fixed bottom-toolbar Instruments control opens and closes the dock', async ({ page }) => {
  await page.goto('/');
  const toolbar = page.locator('.status-strip');
  const dock = page.getByRole('complementary', { name: 'Instruments' });

  const open = toolbar.getByRole('button', { name: 'Open instrument dock' });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute('aria-pressed', 'false');
  await open.click();

  await expect(dock).toBeVisible();
  const close = toolbar.getByRole('button', { name: 'Close instrument dock' });
  await expect(close).toHaveAttribute('aria-pressed', 'true');
  await close.click();

  await expect(dock).not.toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Open instrument dock' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('the fixed bottom-toolbar controls fit a 320-pixel phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');

  const toolbar = page.locator('.status-strip');
  await expectNoHorizontalOverflow(toolbar);
  await expect(toolbar.getByRole('button', { name: 'Open instrument dock' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Mark man overboard here' })).toBeVisible();
});
