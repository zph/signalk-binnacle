import { expect, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

for (const [device, width, height] of [
  ['desktop', 1440, 900],
  ['tablet', 820, 1180],
  ['phone', 390, 844],
] as const) {
  test(`retires a saved browser-only watch on ${device} without presenting it as armed`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await stubVesselsSelf(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        'binnacle-custom:anchor-watch',
        JSON.stringify({
          position: { latitude: 37.8, longitude: -122.4 },
          radiusMeters: 50,
          dragging: false,
        }),
      );
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open supermenu' }).click();
    const menu = page.getByRole('menu', { name: 'Supermenu' });
    await menu.getByRole('menuitem', { name: 'Vessel' }).click();
    await menu.getByRole('menuitem', { name: 'Anchor watch' }).click();
    const panel = page.getByRole('complementary', { name: 'Anchor watch' });
    await expect(panel).toContainText('A previous browser-only anchor watch has been stopped.');
    await expect(panel).toContainText('No anchor down.');
    await expect(panel).not.toContainText('Watching in this browser only.');
    await expect(
      panel.getByRole('link', { name: 'Edit watch boundary in Hoekens' }),
    ).toHaveAttribute('href', '/hoekens-anchor-alarm/');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('binnacle-custom:anchor-watch')))
      .toBe('null');
  });
}
