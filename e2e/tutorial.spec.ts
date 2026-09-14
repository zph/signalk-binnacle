import { expect, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('tutorial-test-ready') === null) {
      localStorage.clear();
      sessionStorage.setItem('tutorial-test-ready', 'true');
    }
  });
  await stubVesselsSelf(page);
});

test('offers a device-aware tutorial and returns from a real control to the next step', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const offer = page.getByText('New here?').locator('..');
  await offer.getByRole('button', { name: 'Start tutorial' }).click();

  const help = page.getByRole('complementary', { name: 'Help and helm setup' });
  await expect(help).toBeVisible();
  await expect(help).toContainText('Tap Menu at the bottom');
  await expect(help).toContainText('Know where controls live');
  await help.getByRole('button', { name: 'Next' }).click();
  await help.getByRole('button', { name: 'Try Layers and charts' }).click();

  const layers = page.getByRole('complementary', { name: 'Layers and charts' });
  await expect(layers).toBeVisible();
  await layers.getByRole('button', { name: 'Back' }).click();
  await expect(help).toContainText('Center, follow, and orient');
});

test('skips the first-device offer but keeps walkthroughs restartable from Help', async ({
  page,
}) => {
  await page.goto('/');
  const offer = page.getByText('New here?').locator('..');
  await offer.getByRole('button', { name: 'Skip' }).click();
  await expect(offer).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('New here?')).toHaveCount(0);
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('help');
  await palette.getByRole('option', { name: /Help/ }).click();

  const help = page.getByRole('complementary', { name: 'Help and helm setup' });
  await expect(help).toContainText('Guided walkthroughs');
  await expect(help.getByRole('button', { name: 'Start recommended tour' })).toBeVisible();
});
