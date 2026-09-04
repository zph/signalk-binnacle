import { expect, test } from '@playwright/test';
import { expectInsideViewport, expectNoHorizontalOverflow, stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'iPad', width: 834, height: 1112 },
  { name: 'phone', width: 320, height: 568 },
] as const;

for (const viewport of viewports) {
  test(`viewport AIS runs independently and informs moorings on ${viewport.name}`, async ({
    page,
  }) => {
    const destinationCenters: number[] = [];
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('binnacle-custom:help-orientation', 'true');
      localStorage.setItem(
        'binnacle-custom:map-view',
        JSON.stringify({ lat: 41.49, lon: -71.32, zoom: 13 }),
      );
    });
    await stubVesselsSelf(page);
    await page.route(/\/signalk\/v2\/features\?enabled=1$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          apis: [],
          plugins: [{ id: 'signalk-aisstream', version: '0.9.1' }],
        }),
      }),
    );
    await page.route(/\/plugins\/binnacle-custom\/api\/moorings/, async (route) => {
      const url = new URL(route.request().url());
      const bbox = JSON.parse(url.searchParams.get('bbox') ?? '[-71.33,41.48,-71.31,41.5]') as [
        number,
        number,
        number,
        number,
      ];
      const longitude = (bbox[0] + bbox[2]) / 2;
      const latitude = (bbox[1] + bbox[3]) / 2;
      await route.fulfill({
        status: 200,
        contentType: 'application/geo+json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [longitude, latitude] },
              properties: {
                OBJECTID: 42,
                OBJNAM: 'Guest Mooring 42',
                CATMOR: 'Mooring buoy',
                INFORM: 'Harbor guest mooring',
                DSNM: 'US5RI11M',
              },
            },
          ],
        }),
      });
    });
    await page.route(/\/plugins\/signalk-aisstream\/api\/destination/, async (route) => {
      const url = new URL(route.request().url());
      const bbox = JSON.parse(url.searchParams.get('bbox') ?? '[-71.33,41.48,-71.31,41.5]') as [
        number,
        number,
        number,
        number,
      ];
      const longitude = (bbox[0] + bbox[2]) / 2;
      const latitude = (bbox[1] + bbox[3]) / 2;
      destinationCenters.push(longitude);
      const now = Date.now();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'live',
          targets: [
            {
              id: 'aisstream:123456789',
              mmsi: '123456789',
              name: 'Visitor',
              position: { latitude, longitude },
              sogMps: 0.1,
              navigationState: 'moored',
              lastReportAtMs: now,
              history: {
                firstSeenAtMs: now - 20 * 60_000,
                sampleCount: 12,
                medianSogMps: 0.1,
                center: { latitude, longitude },
                maxRadiusMeters: 10,
              },
            },
          ],
        }),
      });
    });

    await page.goto('/');
    await expect.poll(() => destinationCenters.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const canvas = page.locator('canvas.maplibregl-canvas');
    const targetPosition = await canvas.boundingBox();
    if (!targetPosition) throw new Error('map canvas did not lay out');
    await page.waitForTimeout(500);
    await page.mouse.click(
      targetPosition.x + targetPosition.width / 2,
      targetPosition.y + targetPosition.height / 2,
    );
    const aisPanel = page.getByRole('complementary', { name: 'Nearby vessels (AIS)' });
    await expect(aisPanel).toBeVisible();
    await expect(aisPanel.getByText('Visitor', { exact: true })).toBeVisible();
    await aisPanel.getByRole('button', { name: 'Close nearby vessels' }).click();

    const helm = page.getByRole('group', { name: 'Helm actions' });
    await helm.getByRole('button', { name: 'Open supermenu' }).click();
    const supermenu = page.getByRole('menu', { name: 'Supermenu' });
    await supermenu.getByRole('menuitem', { name: 'Navigate' }).click();
    await supermenu.getByRole('menuitem', { name: 'Moorings' }).click();
    const panel = page.getByRole('complementary', { name: 'Moorings' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Guest Mooring 42')).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText('Likely occupied', { exact: true })).toBeVisible();

    const search = panel.getByRole('searchbox', {
      name: 'Search moorings by name, category, vessel, or ENC cell',
    });
    await search.fill('Visitor');
    const row = panel.getByRole('button', { name: /Guest Mooring 42/ });
    await expect(row).toBeVisible();
    await row.click();
    const card = row.locator('..');
    await expect(card).toHaveAttribute('aria-current', 'true');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(card.getByRole('region', { name: 'Selected mooring details' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Locate' })).toBeVisible();
    await expectNoHorizontalOverflow(panel);
    await expectInsideViewport(panel, page);

    if (viewport.name === 'desktop') {
      await panel.getByRole('button', { name: 'Close moorings' }).click();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('map canvas did not lay out');
      const y = box.y + box.height * 0.45;
      await page.mouse.move(box.x + box.width * 0.85, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.15, y, { steps: 12 });
      await page.mouse.up();

      await expect
        .poll(() => new Set(destinationCenters.map((center) => center.toFixed(4))).size, {
          timeout: 15_000,
        })
        .toBeGreaterThan(1);
    }
  });
}
