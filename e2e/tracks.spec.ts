import { expect, type Page, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openMenuItem, stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

const TRIP_POSITIONS = [
  { latitude: 37.792, longitude: -122.447 },
  { latitude: 37.796, longitude: -122.438 },
  { latitude: 37.801, longitude: -122.429 },
  { latitude: 37.806, longitude: -122.418 },
  { latitude: 37.811, longitude: -122.407 },
  { latitude: 37.815, longitude: -122.396 },
  { latitude: 37.818, longitude: -122.385 },
  { latitude: 37.819, longitude: -122.374 },
  { latitude: 37.817, longitude: -122.363 },
] as const;

function projectMapPoint(
  point: { latitude: number; longitude: number },
  center: { latitude: number; longitude: number },
  zoom: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const worldSize = 512 * 2 ** zoom;
  const worldPoint = (position: { latitude: number; longitude: number }) => {
    const latitudeRadians = (position.latitude * Math.PI) / 180;
    return {
      x: ((position.longitude + 180) / 360) * worldSize,
      y:
        ((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) *
        worldSize,
    };
  };
  const projectedPoint = worldPoint(point);
  const projectedCenter = worldPoint(center);
  return {
    x: viewport.width / 2 + projectedPoint.x - projectedCenter.x,
    y: viewport.height / 2 + projectedPoint.y - projectedCenter.y,
  };
}

async function stubTripHistory(page: Page): Promise<void> {
  await page.route(/\/signalk\/v2\/api\/history\/_providers$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ 'signalk-to-influxdb2': { isDefault: true } }),
    }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/values/, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const from = params.get('from') ?? new Date().toISOString();
    const to = params.get('to') ?? new Date().toISOString();
    const start = new Date(from);
    start.setHours(8, 12, 0, 0);
    const requested = (params.get('paths') ?? '').split(',').filter(Boolean);
    const columns = requested.map((requestPath) => ({ path: requestPath, method: 'average' }));
    const valueFor = (path: string, index: number): unknown => {
      if (path === 'navigation.position') return TRIP_POSITIONS[index];
      if (path === 'navigation.speedOverGround') return 3.2 + index * 0.08;
      if (path === 'environment.wind.speedOverGround') return 6.1 + index * 0.12;
      if (path === 'environment.wind.speedTrue') return 5.9 + index * 0.1;
      if (path === 'environment.wind.speedApparent') return 7.2 + index * 0.13;
      if (path === 'environment.wind.directionTrue') return 0.72 + index * 0.025;
      if (path === 'environment.wind.angleApparent') return -0.56 + index * 0.015;
      if (path === 'navigation.headingTrue') return 1.28 + index * 0.01;
      return null;
    };
    const data = TRIP_POSITIONS.map((_, index) => [
      new Date(start.getTime() + index * 60_000).toISOString(),
      ...columns.map((column) => valueFor(column.path, index)),
    ]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ range: { from, to }, values: columns, data }),
    });
  });
}

test('tracks loads saved resources without a live stream and fits a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
    localStorage.setItem('binnacle-custom:tutorial-offer', 'true');
    localStorage.setItem(
      'binnacle-custom:map-view',
      JSON.stringify({ lat: 42.6, lon: -83.5, zoom: 12 }),
    );
  });
  await stubVesselsSelf(page);
  await page.route(/\/signalk\/v2\/api\/resources\/tracks$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        saved: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-83.5, 42.6],
              [-83.49, 42.61],
            ],
          },
          properties: { name: 'Morning passage', distance: 1852, timespan: 3600 },
        },
      }),
    });
  });

  await page.goto('/');
  await openMenuItem(page, 'Tracks');

  const panel = page.getByRole('complementary', { name: 'Tracks' });
  await expect(panel.getByText('Morning passage')).toBeVisible();
  await expect(panel.getByText('1.00')).toBeVisible();
  await expect(panel.getByText('1h 00m')).toBeVisible();
  await panel.getByRole('button', { name: 'Delete track' }).click();
  await expect(panel.getByText('Delete this track?')).toBeVisible();
  await expectNoHorizontalOverflow(panel);
});

test('daily trip history shows wind and travel summaries for the selected day', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
    localStorage.setItem('binnacle-custom:tutorial-offer', 'true');
    localStorage.setItem(
      'binnacle-custom:map-view',
      JSON.stringify({ lat: 37.806, lon: -122.405, zoom: 12 }),
    );
    localStorage.setItem(
      'binnacle-custom:track-settings',
      JSON.stringify({
        intervalSeconds: 10,
        minMeters: 10,
        colorMode: 'speed',
        tripLogEnabled: true,
      }),
    );
  });
  await stubVesselsSelf(page);
  await stubTripHistory(page);
  await page.route(/\/signalk\/v2\/api\/resources\/tracks\/_providers$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(/\/signalk\/v2\/api\/resources\/tracks$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.goto('/');
  await openMenuItem(page, 'Tracks');

  const panel = page.getByRole('complementary', { name: 'Tracks' });
  await expect(panel.getByText('1 travel portion and 0 stops.')).toBeVisible();
  await expect(panel.getByText('Average true wind')).toBeVisible();
  await expect(panel.getByText('Average wind direction')).toBeVisible();
  await expect(panel.getByText('Average apparent angle')).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: 'Show on chart' })).toBeChecked();
  await expectNoHorizontalOverflow(panel);

  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Map canvas has no bounds');
  const segmentMidpoint = {
    latitude: (TRIP_POSITIONS[4].latitude + TRIP_POSITIONS[5].latitude) / 2,
    longitude: (TRIP_POSITIONS[4].longitude + TRIP_POSITIONS[5].longitude) / 2,
  };
  const clickPosition = projectMapPoint(
    segmentMidpoint,
    { latitude: 37.806, longitude: -122.405 },
    12,
    canvasBox,
  );
  await expect(async () => {
    await canvas.click({ position: clickPosition });
    await expect(page.getByLabel('Trip history minute')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });

  const minuteDetails = page.getByLabel('Trip history minute');
  await expect(minuteDetails).toContainText('08:16');
  await expect(minuteDetails).toContainText('SOG');
  await expect(minuteDetails).toContainText('TWS');
  await expect(minuteDetails).toContainText('Wind');
});
