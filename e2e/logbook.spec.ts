import { expect, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
});

test('Logbook opens against the optional server plugin without creating an entry', async ({
  page,
}) => {
  let writes = 0;
  await page.route(/\/plugins\/signalk-logbook\/logs(?:\/\d{4}-\d{2}-\d{2})?$/, async (route) => {
    if (route.request().method() === 'POST') {
      writes += 1;
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open supermenu' }).click();
  const supermenu = page.getByRole('menu', { name: 'Supermenu' });
  await supermenu.getByRole('menuitem', { name: 'Navigate' }).click();
  await supermenu.getByRole('menuitem', { name: 'Logbook' }).click();

  const panel = page.getByRole('complementary', { name: 'Logbook' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'New entry' })).toBeVisible();
  await expect(panel.getByText('No entries in the last two days.')).toBeVisible();
  expect(writes).toBe(0);
});
