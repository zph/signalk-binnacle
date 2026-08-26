import { expect, test } from '@playwright/test';
import { openMenuItem, stubVesselsSelf } from './helpers';
import { installMapLibreWorkerProof } from './maplibre-worker-proof';

test.use({ serviceWorkers: 'block' });

const CHART_ID = 'fixture-noaa-s57';
const TILE_PATH = new RegExp(`/signalk/v1/api/resources/charts/${CHART_ID}/\\d+/\\d+/\\d+$`);

function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return bytes;
}

function bytesField(field: number, value: Uint8Array): number[] {
  return [...varint((field << 3) | 2), ...varint(value.length), ...value];
}

function varintField(field: number, value: number): number[] {
  return [...varint(field << 3), ...varint(value)];
}

function stringField(field: number, value: string): number[] {
  return bytesField(field, new TextEncoder().encode(value));
}

function doubleField(field: number, value: number): number[] {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return [((field << 3) | 1) & 0xff, ...new Uint8Array(buffer)];
}

function join(...parts: ReadonlyArray<ReadonlyArray<number>>): Uint8Array {
  return Uint8Array.from(parts.flat());
}

function encDepthAreaTile(): Uint8Array {
  const values = [
    join(doubleField(3, 4)),
    join(stringField(1, 'signalk-bathymetry')),
    join(doubleField(3, 4)),
    join(doubleField(3, 0.72)),
    join(doubleField(3, 0.35)),
    join(doubleField(3, 3)),
    join(stringField(1, 'single_pass|sparse_neighbors')),
  ];
  const keys = [
    'DRVAL1',
    'BATHYMETRY_PROVIDER',
    'BATHY_DEPTH_M',
    'BATHY_CONFIDENCE',
    'BATHY_VERTICAL_SIGMA_M',
    'BATHY_OBSERVATION_COUNT',
    'BATHY_CONFIDENCE_REASONS',
  ];
  const geometry = join(
    varint(9),
    varint(0),
    varint(0),
    varint(26),
    varint(8190),
    varint(0),
    varint(0),
    varint(8190),
    varint(8189),
    varint(0),
    varint(15),
  );
  const feature = join(
    varintField(1, 1),
    bytesField(2, join(...keys.flatMap((_, index) => [varint(index), varint(index)]))),
    varintField(3, 3),
    bytesField(4, geometry),
  );
  const layer = join(
    stringField(1, 'DEPARE'),
    bytesField(2, feature),
    ...keys.map((key) => stringField(3, key)),
    ...values.map((value) => bytesField(4, value)),
    varintField(5, 4096),
    varintField(15, 2),
  );
  return join(bytesField(3, layer));
}

test('renders a Signal K S-57 chart from legacy NOAA chartLayers metadata', async ({ page }) => {
  const workerProof = await installMapLibreWorkerProof(page);
  const pageErrors: string[] = [];
  const tileRequests: string[] = [];
  let releaseTiles = (): void => {};
  const tileGate = new Promise<void>((resolve) => {
    releaseTiles = resolve;
  });

  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
    localStorage.setItem(
      'binnacle-custom:map-view',
      JSON.stringify({ lat: 37.8, lon: -122.4, zoom: 12 }),
    );
  });
  await stubVesselsSelf(page);
  await page.route(/\/signalk\/v2\/api\/resources\/charts\/?$/, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(/\/signalk\/v1\/api\/resources\/charts\/?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        [CHART_ID]: {
          identifier: CHART_ID,
          name: 'Fixture NOAA ENC',
          description: 'Synthetic California depth-area chart',
          type: 'S-57',
          featureInfo: 'bathymetry-cell',
          format: 'pbf',
          chartLayers: ['DEPARE', 'DEPCNT', 'SOUNDG', 'LNDARE'],
          // The synthetic tile is a world-sized fixture so the test does not depend on a persisted
          // camera restore. Real regional bounds and zoom propagation are covered by adapter tests.
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 16,
          tilemapUrl: `/signalk/v1/api/resources/charts/${CHART_ID}/{z}/{x}/{y}`,
        },
      }),
    }),
  );
  await page.route(TILE_PATH, async (route) => {
    tileRequests.push(new URL(route.request().url()).pathname);
    await tileGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/x-protobuf',
      body: Buffer.from(encDepthAreaTile()),
    });
  });

  try {
    await page.goto('/');
    await workerProof.assertInitialNavigation();
    await expect.poll(() => tileRequests.length).toBeGreaterThan(0);

    const canvas = page.locator('.maplibregl-canvas');
    const canvasBeforeTile = await canvas.screenshot();
    releaseTiles();
    await expect.poll(async () => !(await canvas.screenshot()).equals(canvasBeforeTile)).toBe(true);

    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Map canvas has no bounds');
    await canvas.click({ position: { x: canvasBox.width / 2, y: canvasBox.height / 2 } });
    const cellDetails = page.getByRole('dialog', { name: 'Local bathymetry cell details' });
    await expect(cellDetails).toBeVisible();
    await expect(cellDetails).toContainText('4.0 m');
    await expect(cellDetails).toContainText('Moderate evidence (72%)');
    await expect(cellDetails).toContainText('Observations');
    await expect(cellDetails).toContainText('Quality limits: Single Pass, Sparse Neighbors.');
    await cellDetails.getByRole('button', { name: 'Close cell details' }).click();
    await expect(cellDetails).toBeHidden();

    await openMenuItem(page, 'Layers and charts');
    const row = page.locator(`#layers-panel [data-layer-row="chart-${CHART_ID}"]`);
    await expect(row).toBeVisible();
    const chartToggle = row.getByRole('button', { name: 'Fixture NOAA ENC', exact: true });
    await expect(chartToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Adjust Fixture NOAA ENC opacity' })).toHaveCount(
      0,
    );
    const facetCaret = row.getByRole('button', {
      name: 'Show Fixture NOAA ENC child layers',
    });
    await expect(facetCaret).toBeVisible();
    await facetCaret.click();
    const inlineFacets = row.getByRole('group', { name: 'Fixture NOAA ENC child layers' });
    await expect(inlineFacets).toBeVisible();
    await expect(
      inlineFacets.getByRole('button', { name: 'Depth areas', exact: true }),
    ).toBeVisible();
    await expect(
      inlineFacets.getByRole('button', { name: 'Adjust Depth areas opacity' }),
    ).toBeVisible();
    await row.getByRole('button', { name: 'Open Fixture NOAA ENC chart details' }).click();
    await expect(page.getByRole('slider', { name: 'Opacity' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Fixture NOAA ENC chart layers' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to layers' }).click();
    const baseRow = page.locator('#layers-panel [data-layer-row="basemap"]');
    await expect(baseRow).toBeVisible();
    await expect(
      baseRow.getByRole('button', { name: 'OpenFreeMap base', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await baseRow.getByRole('button', { name: 'Adjust OpenFreeMap base opacity' }).click();
    const baseOpacity = page.getByRole('slider', { name: 'OpenFreeMap base opacity' });
    await baseOpacity.fill('0.5');
    await expect(baseOpacity).toHaveAttribute('aria-valuetext', '50%');

    await page.getByRole('button', { name: 'Close OpenFreeMap base opacity' }).click();
    await page.getByRole('button', { name: 'Close layers and charts' }).click();
    const zoomIn = page.locator('.maplibregl-ctrl-zoom-in');
    // MapLibre animates control-button zooms. Let each ease finish so rapid clicks do not collapse
    // into one partial step and leave the test below the declared native maxzoom.
    for (let step = 0; step < 7; step += 1) {
      await zoomIn.click();
      await page.waitForTimeout(350);
    }
    await expect
      .poll(() => tileRequests.some((path) => path.includes(`/${CHART_ID}/16/`)))
      .toBe(true);
    expect(Math.max(...tileRequests.map((path) => Number(path.split('/').at(-3))))).toBe(16);

    // At z19 the provider has no native tile, but the z16 vector tile must remain drawn. Turning
    // the chart off at that zoom therefore changes the compositor screenshot; the old layer cap at
    // z17 made this a no-op because the ENC had already vanished.
    const overzoomedWithChart = await canvas.screenshot();
    await openMenuItem(page, 'Layers and charts');
    await chartToggle.click();
    await expect(chartToggle).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => !(await canvas.screenshot()).equals(overzoomedWithChart))
      .toBe(true);
    expect(tileRequests.every((path) => TILE_PATH.test(path))).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    releaseTiles();
  }
});
