import { expect, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 834, height: 1194 },
  { width: 390, height: 844 },
]) {
  test(`place source link clears helm controls at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await stubVesselsSelf(page);
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('binnacle-custom:help-orientation', 'true');
      localStorage.setItem(
        'binnacle-custom:map-view',
        JSON.stringify({ lat: 42.6, lon: -83.5, zoom: 12 }),
      );
    });
    const sourceUrl = 'https://activecaptain.garmin.com/en-US/pois/10496';
    await page.route(/\/signalk\/v2\/api\/resources\/notes/, async (route) => {
      const url = new URL(route.request().url());
      const bbox = JSON.parse(url.searchParams.get('bbox') ?? '[-83.51,42.59,-83.49,42.61]');
      const note = {
        name: 'Source Test Marina',
        position: { longitude: (bbox[0] + bbox[2]) / 2, latitude: (bbox[1] + bbox[3]) / 2 },
        url: sourceUrl,
        description: 'Marina details. '.repeat(500),
        properties: {
          skIcon: 'marina',
          source: 'activecaptain',
          attribution: 'Garmin ActiveCaptain',
        },
      };
      await route.fulfill({
        json: url.pathname.endsWith('/source-test') ? note : { 'source-test': note },
      });
    });
    await page.context().route(sourceUrl, (route) => route.fulfill({ body: 'Source opened' }));
    await page.goto('/');
    await page.keyboard.press('Control+K');
    const search = page.getByRole('searchbox', { name: 'Search commands', exact: true });
    await search.fill('Find places');
    await search.press('Enter');
    await page.getByRole('button', { name: /Marina Source Test Marina/ }).click();
    const source = page.getByRole('link', { name: /View source/ });
    await expect(source).toHaveAttribute('href', sourceUrl);
    const [linkBox, helmBox] = await Promise.all([
      source.boundingBox(),
      page.getByRole('group', { name: 'Helm actions' }).boundingBox(),
    ]);
    if (!linkBox || !helmBox) throw new Error('Source link or helm controls did not lay out.');
    expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(helmBox.y);
    const popup = page.waitForEvent('popup');
    await source.click();
    const opened = await popup;
    await expect(opened).toHaveURL(sourceUrl);
    await opened.close();
  });
}
