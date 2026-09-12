import { expect, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
});

test('Display exposes only automatic theme and daytime bright-sun controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open supermenu' }).click();
  const supermenu = page.getByRole('menu', { name: 'Supermenu' });
  await supermenu.getByRole('menuitem', { name: 'System' }).click();
  await supermenu.getByRole('menuitem', { name: 'Display' }).click();

  const panel = page.getByRole('complementary', { name: 'Display' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Automatic theme' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Bright sun chart' })).toBeVisible();
  await expect(panel.getByText('Screen dim')).toHaveCount(0);
  await expect(panel.getByText('Text size')).toHaveCount(0);

  const auto = panel.getByRole('group', { name: 'Automatic theme' });
  const sun = panel.getByRole('group', { name: 'Bright sun chart' });
  await auto.getByRole('button', { name: 'On' }).click();
  await sun.getByRole('button', { name: 'On' }).click();

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('binnacle-custom:display-auto-theme')))
    .toBe('true');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('binnacle-custom:display-sun-mode')))
    .toBe('true');
});
