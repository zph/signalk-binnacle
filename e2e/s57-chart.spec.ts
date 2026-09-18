import { expect, type Page, test } from '@playwright/test';
import { expectInsideViewport, stubVesselsSelf } from './helpers';
import { installMapLibreWorkerProof } from './maplibre-worker-proof';

test.use({ serviceWorkers: 'block' });

const CHART_ID = 'fixture-noaa-s57';
const FACET_CHART_ID = 'fixture-west-coast-s57';
const TILE_PATH = new RegExp(
  `/signalk/v1/api/resources/charts/${CHART_ID}/\\d+/\\d+/\\d+(?:\\?.*)?$`,
);
const FACET_TILE_PATH = new RegExp(
  `/signalk/v1/api/resources/charts/${FACET_CHART_ID}/\\d+/\\d+/\\d+(?:\\?.*)?$`,
);

async function openLayersAndCharts(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open supermenu' }).click();
  const supermenu = page.getByRole('menu', { name: 'Supermenu' });
  await supermenu.getByRole('menuitem', { name: 'Chart', exact: true }).click();
  await supermenu.getByRole('menuitem', { name: 'Layers and charts', exact: true }).click();
  const closeSupermenu = page.getByRole('button', { name: 'Close supermenu' });
  if ((await closeSupermenu.count()) > 0) {
    await closeSupermenu.evaluate((button: HTMLButtonElement) => button.click());
  }
}

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

test('renders a Signal K S-57 chart from legacy NOAA chartLayers metadata', async ({
  page,
  browserName,
}) => {
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
        [FACET_CHART_ID]: {
          identifier: FACET_CHART_ID,
          name: 'Fixture West Coast ENC',
          description: 'Synthetic S-57 chart with independently configurable feature groups',
          type: 'S-57',
          format: 'pbf',
          chartLayers: [
            'DEPARE',
            'DEPCNT',
            'SOUNDG',
            'LNDARE',
            'WEDKLP',
            'SBDARE',
            'MORFAC',
            'CBLOHD',
            'M_QUAL',
            'M_COVR',
            'FSHFAC',
          ],
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 16,
          tilemapUrl: `/signalk/v1/api/resources/charts/${FACET_CHART_ID}/{z}/{x}/{y}`,
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
  await page.route(FACET_TILE_PATH, async (route) => {
    await tileGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/x-protobuf',
      body: Buffer.from(encDepthAreaTile()),
    });
  });
  await page.route(/\/plugins\/signalk-bathymetry\/cells\/lookup/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        bounds: [-123, 37, -122, 38.5],
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-123, 37],
              [-122, 37],
              [-122, 38.5],
              [-123, 38.5],
              [-123, 37],
            ],
          ],
        },
      }),
    }),
  );
  await page.route(/\/plugins\/signalk-bathymetry\/soundings/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        soundings: [
          {
            id: 1,
            observedAt: '2026-08-27T12:00:00.000Z',
            position: { latitude: 37.8, longitude: -122.4 },
            rawDepthM: 4.4,
            depthReference: 'belowKeel',
            surfaceToKeelM: 1.5,
            belowSurfaceDepthM: 5.9,
            datumDepthM: 4,
            datum: 'MLLW',
            tideHeightM: 0.4,
            tideStationName: 'Fixture station',
            verticalSigmaM: 0.35,
            sampleCount: 12,
            qcState: 'accepted',
            qcReasons: [],
            depthSource: 'environment.depth.belowKeel',
            passId: 'pass-1',
            aggregationKind: 'stationary_window',
          },
        ],
      }),
    }),
  );

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
    await expect(cellDetails).toContainText('Conservative depth below chart datum');
    await expect(cellDetails).toContainText('4.0 m');
    await expect(cellDetails).toContainText('Moderate evidence (72%)');
    await expect(cellDetails).toContainText('Observations');
    await expect(cellDetails).toContainText('Quality limits: Single Pass, Sparse Neighbors.');
    await cellDetails
      .getByRole('button', { name: 'Raw data table' })
      .evaluate((button: HTMLButtonElement) => button.click());
    const rawDialog = page.getByRole('dialog', { name: 'Raw bathymetry data' });
    await expect(rawDialog).toBeVisible();
    await expect(rawDialog).toContainText('1 source record');
    await expect(rawDialog).toContainText('12 source samples');
    await expect(rawDialog.getByRole('cell', { name: '4.0 m' })).toBeVisible();
    await expect(rawDialog).toContainText('Datum depth = sensor reading + waterline offset');
    await expect(rawDialog.getByRole('columnheader', { name: 'Below surface' })).toBeVisible();
    await expect(rawDialog.getByRole('columnheader', { name: 'Sensor reading' })).toBeVisible();
    await expect(rawDialog.getByRole('columnheader', { name: 'Tide level' })).toBeVisible();
    await expect(rawDialog.getByRole('columnheader', { name: 'Datum correction' })).toBeVisible();
    await expect(rawDialog).toContainText('+0.4 m');
    await expect(rawDialog).toContainText('−0.4 m');
    await expect(rawDialog).toContainText('above MLLW · Fixture station');
    await expect(rawDialog).toContainText('below keel');
    await expect(rawDialog).toContainText('MLLW');
    await expect(rawDialog).toContainText('environment.depth.belowKeel');
    await rawDialog.getByRole('button', { name: 'Done' }).click();
    await expect(rawDialog).toBeHidden();
    await cellDetails.getByRole('button', { name: 'Close cell details' }).click();
    await expect(cellDetails).toBeHidden();

    await openLayersAndCharts(page);
    const row = page.locator(`#layers-panel [data-layer-row="chart-${FACET_CHART_ID}"]`);
    await expect(row).toBeVisible();
    const chartToggle = row.getByRole('button', { name: 'Fixture West Coast ENC', exact: true });
    await expect(chartToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(row.getByText('7/9', { exact: true })).toBeVisible();
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Adjust Fixture NOAA ENC opacity' })).toHaveCount(
      0,
    );
    const facetCaret = row.getByRole('button', {
      name: 'Show Fixture West Coast ENC child layers',
    });
    await expect(facetCaret).toBeVisible();
    await facetCaret.click();
    const inlineFacets = row.getByRole('group', { name: 'Fixture West Coast ENC child layers' });
    await expect(inlineFacets).toBeVisible();
    for (const title of [
      'Kelp and weed',
      'Seabed composition',
      'Moorings and berths',
      'Overhead hazards',
      'Survey quality',
      'ENC coverage',
    ]) {
      await expect(inlineFacets.getByRole('button', { name: title, exact: true })).toBeVisible();
    }
    await inlineFacets.getByText('Present in chart, not yet rendered (1)', { exact: true }).click();
    await expect(inlineFacets.getByText('FSHFAC', { exact: true })).toBeVisible();
    const initialViewport = page.viewportSize();
    const viewports =
      browserName === 'chromium'
        ? [
            { width: 390, height: 844 },
            { width: 844, height: 390 },
            { width: 834, height: 1194 },
            { width: 1194, height: 834 },
          ]
        : [];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const kelp = inlineFacets.getByRole('button', { name: 'Kelp and weed', exact: true });
      await kelp.scrollIntoViewIfNeeded();
      await expectInsideViewport(kelp, page);
      await kelp.click();
      await expect(kelp).toHaveAttribute('aria-pressed', 'false');
      await kelp.click();
      await expect(kelp).toHaveAttribute('aria-pressed', 'true');
    }
    if (initialViewport && viewports.length > 0) await page.setViewportSize(initialViewport);
    const kelpControl = inlineFacets.getByRole('button', { name: 'Kelp and weed', exact: true });
    await kelpControl.scrollIntoViewIfNeeded();
    await expectInsideViewport(kelpControl, page);
    const depthFacet = inlineFacets.getByRole('button', { name: 'Depth areas', exact: true });
    const soundingsFacet = inlineFacets.getByRole('button', {
      name: 'Soundings and contours',
      exact: true,
    });
    await expect(depthFacet).toBeVisible();
    await expect(
      inlineFacets.getByRole('button', { name: 'Adjust Depth areas opacity' }),
    ).toBeVisible();
    await depthFacet.click();
    await expect(depthFacet).toHaveAttribute('aria-pressed', 'false');
    await expect(row.getByText('6/9', { exact: true })).toBeVisible();

    await chartToggle.click();
    await expect(chartToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(row.getByText('6/9', { exact: true })).toBeVisible();
    await chartToggle.click();
    await expect(chartToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(depthFacet).toHaveAttribute('aria-pressed', 'false');
    await expect(soundingsFacet).toHaveAttribute('aria-pressed', 'true');

    // Restore the fixture's initial state before exercising the remaining chart controls.
    await depthFacet.click();
    await expect(row.getByText('7/9', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Open Fixture West Coast ENC chart details' }).click();
    await expect(page.getByRole('slider', { name: 'Opacity' })).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Fixture West Coast ENC chart layers' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Back to layers' }).click();
    const bathymetryRow = page.locator(`#layers-panel [data-layer-row="chart-${CHART_ID}"]`);
    await bathymetryRow
      .getByRole('button', { name: 'Open Fixture NOAA ENC chart details' })
      .click();
    await expect(page.getByText('Depth colors', { exact: true })).toBeVisible();
    const noaaColors = page.getByRole('button', { name: 'NOAA chart', exact: true });
    await expect(noaaColors).toHaveAttribute('aria-pressed', 'true');
    const safetyColors = page.getByRole('button', { name: 'Safety', exact: true });
    await expect(safetyColors).toHaveAttribute('aria-pressed', 'false');
    await safetyColors.click();
    await expect(safetyColors).toHaveAttribute('aria-pressed', 'true');
    await expect(noaaColors).toHaveAttribute('aria-pressed', 'false');
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

    await page
      .getByRole('button', { name: 'Close OpenFreeMap base opacity' })
      .evaluate((button: HTMLButtonElement) => button.click());
    await page.getByRole('button', { name: 'Close layers and charts' }).click();
    // Keyboard zoom remains available after removing the chart's top-right zoom buttons. Let each
    // animation finish so rapid steps do not collapse into one partial zoom.
    await canvas.focus();
    for (let step = 0; step < 7; step += 1) {
      await page.keyboard.press('+');
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
    await openLayersAndCharts(page);
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
