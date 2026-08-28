import { expect, type Page, test } from '@playwright/test';
import {
  chooseInstrumentPaneAction,
  expectInsideViewport,
  openMenuItem,
  stubVesselsSelf,
} from './helpers';
import { installMapLibreWorkerProof } from './maplibre-worker-proof';

test.use({ serviceWorkers: 'block' });

interface JsonPatchOperation {
  op: 'test' | 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

function profileDocument() {
  const settings = {
    theme: 'day',
    layers: {},
    layerOrder: [],
    weatherLayers: {},
    thresholds: {
      dangerCpaMeters: 926,
      dangerTcpaSeconds: 600,
      warningCpaMeters: 1852,
      warningTcpaSeconds: 1200,
    },
    trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
    planningSpeedKn: 6,
    units: 'metric',
    pinnedActionIds: ['center', 'follow', 'layers', 'instruments'],
    instrumentTiles: ['sog', 'heading', 'depth'],
    anchorRadiusMeters: 50,
  };
  return {
    schemaVersion: 2,
    revision: 1,
    profiles: {
      helm: {
        id: 'helm',
        name: 'Test helm',
        settings,
        createdAt: 1,
        updatedAt: 1,
        nameUpdatedAt: 1,
        settingUpdatedAt: Object.fromEntries(Object.keys(settings).map((key) => [key, 1])),
      },
    },
    tombstones: {},
    defaultId: 'helm',
  };
}

function pointerSegments(path: string): string[] {
  return path
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function applyPatch(document: Record<string, unknown>, patch: JsonPatchOperation[]): void {
  for (const operation of patch) {
    const segments = pointerSegments(operation.path);
    let parent: Record<string, unknown> = document;
    for (const segment of segments.slice(0, -1)) {
      const child = parent[segment];
      if (typeof child !== 'object' || child === null || Array.isArray(child)) {
        throw new Error(`Invalid patch parent: ${operation.path}`);
      }
      parent = child as Record<string, unknown>;
    }
    const key = segments.at(-1);
    if (!key) throw new Error(`Invalid patch path: ${operation.path}`);
    if (operation.op === 'test') {
      expect(parent[key]).toEqual(operation.value);
    } else if (operation.op === 'remove') {
      delete parent[key];
    } else {
      parent[key] = structuredClone(operation.value);
    }
  }
}

async function installProfileServer(page: Page, document: Record<string, unknown>): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('binnacle-e2e-profile-initialized') !== 'true') {
      localStorage.clear();
      sessionStorage.setItem('binnacle-e2e-profile-initialized', 'true');
    }
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
    localStorage.setItem(
      'binnacle-custom:signalk-auth',
      JSON.stringify({ clientId: 'binnacle-e2e', token: 'profile-token' }),
    );
  });
  await stubVesselsSelf(page);
  await page.route(
    /\/signalk\/v1\/applicationData\/user\/binnacle-custom\/2\.0\.0$/,
    async (route) => {
      if (route.request().method() === 'POST') {
        applyPatch(document, route.request().postDataJSON() as JsonPatchOperation[]);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify('ApplicationData saved'),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(document),
      });
    },
  );
}

test('profile overflow actions stay inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const serverDocument = profileDocument() as Record<string, unknown>;
  await installProfileServer(page, serverDocument);
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: /^Profiles/ })
    .click();
  const panel = page.getByRole('complementary', { name: 'Profiles' });
  await panel.getByRole('button', { name: 'More actions for Test helm' }).click();

  const actions = page.getByRole('menu', { name: 'More actions for Test helm' });
  await expect(actions).toBeVisible();
  await expectInsideViewport(actions, page);
});

test('profiles restore instrument order in a different browser', async ({ browser, page }) => {
  const serverDocument = profileDocument() as Record<string, unknown>;
  await installProfileServer(page, serverDocument);
  await page.goto('/');

  await expect(
    page.getByRole('button', { name: 'Profile Test helm, switch profile' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open instrument dock' }).click();
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await chooseInstrumentPaneAction(page, dock, 'Customize instruments');
  const shownTitles = () =>
    page.$$eval('.tile-list li[data-tile-row] .title', (elements) =>
      elements.map((element) => element.textContent?.trim()),
    );
  await expect.poll(async () => (await shownTitles())[0]).toBe('Speed');

  const grip = dock.locator('.tile-list .handle').first();
  const box = await grip.boundingBox();
  if (!box) throw new Error('Instrument reorder grip did not lay out.');
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const point = (nextY: number) => [{ x, y: nextY, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(y) });
  for (const offset of [20, 60, 110]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(y + offset),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await shownTitles())[0]).not.toBe('Speed');

  const serverInstrumentOrder = () => {
    const profiles = serverDocument.profiles as Record<
      string,
      { settings: { instrumentTiles: string[] } }
    >;
    return profiles.helm.settings.instrumentTiles;
  };
  await expect.poll(serverInstrumentOrder).not.toEqual(['sog', 'heading', 'depth']);

  const secondContext = await browser.newContext({ serviceWorkers: 'block' });
  const secondPage = await secondContext.newPage();
  await installProfileServer(secondPage, serverDocument);
  await secondPage.goto('/');

  await secondPage.getByRole('button', { name: 'Menu', exact: true }).click();
  await secondPage
    .locator('#app-menu-launcher')
    .getByRole('button', { name: /^Profiles/ })
    .click();
  const profiles = secondPage.getByRole('complementary', { name: 'Profiles' });
  await expect(profiles.getByText('Profiles are synced with this Signal K account.')).toBeVisible();
  await expect(profiles.getByText('Active here')).toBeVisible();
  await profiles.getByRole('button', { name: 'Close profiles panel' }).click();

  await secondPage.getByRole('button', { name: 'Open instrument dock' }).click();
  const secondDock = secondPage.getByRole('complementary', { name: 'Instruments' });
  await chooseInstrumentPaneAction(secondPage, secondDock, 'Customize instruments');
  const restoredTitles = await secondPage.$$eval(
    '.tile-list li[data-tile-row] .title',
    (elements) => elements.map((element) => element.textContent?.trim()),
  );
  const titleById: Record<string, string> = {
    sog: 'Speed',
    heading: 'Heading',
    depth: 'Depth',
  };
  expect(restoredTitles).toEqual(serverInstrumentOrder().map((id) => titleById[id]));

  await secondContext.close();
});

test('a locally cached profile applies at boot without a startup error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
    localStorage.setItem(
      'binnacle-custom:profiles',
      JSON.stringify({
        schemaVersion: 2,
        defaultId: 'p1',
        profiles: [
          {
            id: 'p1',
            name: 'Helm day',
            createdAt: 1,
            updatedAt: 2,
            nameUpdatedAt: 2,
            settingUpdatedAt: {},
            settings: {
              theme: 'day',
              layers: {},
              layerOrder: [],
              weatherLayers: {},
              thresholds: {
                dangerCpaMeters: 926,
                dangerTcpaSeconds: 600,
                warningCpaMeters: 1852,
                warningTcpaSeconds: 1200,
              },
              trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
              planningSpeedKn: 6,
              units: 'metric',
              pinnedActionIds: ['center'],
              instrumentTiles: ['depth'],
              anchorRadiusMeters: 50,
            },
          },
        ],
      }),
    );
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'About Binnacle Custom' })).toBeVisible();
  // The local-cache initialize path runs during App setup; give the boot flush a beat before
  // asserting no startup exception surfaced.
  await page.waitForTimeout(500);
  expect(pageErrors.filter((message) => message.includes('before initialization'))).toEqual([]);
});

test('profiles restore chart state and order across restart and provider upgrade', async ({
  page,
}) => {
  const chartId = 'profile-fixture-enc';
  const chartLayerId = `chart-${chartId}`;
  const facetId = (key: string) => `${chartLayerId}:facet:${key}`;
  const harborSettings = {
    theme: 'day',
    layers: {
      basemap: { visible: true, opacity: 0.45 },
      ais: { visible: false, opacity: 0.6 },
      [chartLayerId]: { visible: true, opacity: 0.7, cellSizeScale: 0.75 },
      [facetId('depth-areas')]: { visible: true, opacity: 0.8 },
    },
    layerOrder: ['basemap', chartLayerId, 'ais'],
    weatherLayers: {},
    aisIconMode: 'generic',
    thresholds: {
      dangerCpaMeters: 926,
      dangerTcpaSeconds: 600,
      warningCpaMeters: 1852,
      warningTcpaSeconds: 1200,
    },
    trackSettings: { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' },
    planningSpeedMps: 3,
    units: 'metric',
    pinnedActionIds: ['center', 'follow', 'layers', 'instruments'],
    instrumentTiles: ['sog', 'heading', 'depth'],
    anchorRadiusMeters: 50,
  };
  const passageSettings = {
    ...harborSettings,
    layers: {
      ...harborSettings.layers,
      basemap: { visible: true, opacity: 0.9 },
      ais: { visible: true, opacity: 0.85 },
      [chartLayerId]: { visible: true, opacity: 0.95, cellSizeScale: 2 },
      [facetId('depth-areas')]: { visible: false, opacity: 0.5 },
    },
    layerOrder: ['basemap', 'ais', chartLayerId],
    aisIconMode: 'type-specific',
  };
  const profile = (id: string, name: string, settings: typeof harborSettings) => ({
    id,
    name,
    settings,
    createdAt: 1,
    updatedAt: 1,
    nameUpdatedAt: 1,
    settingUpdatedAt: Object.fromEntries(Object.keys(settings).map((key) => [key, 1])),
  });
  const serverDocument = {
    schemaVersion: 2,
    revision: 1,
    profiles: {
      harbor: profile('harbor', 'Harbor detail', harborSettings),
      passage: profile('passage', 'Passage', passageSettings),
    },
    tombstones: {},
    defaultId: 'harbor',
  } as Record<string, unknown>;

  await installProfileServer(page, serverDocument);
  const workerProof = await installMapLibreWorkerProof(page);
  let chartRevision = 1;
  await page.route(/\/signalk\/v2\/api\/resources\/charts\/?$/, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(/\/signalk\/v1\/api\/resources\/charts\/?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        [chartId]: {
          identifier: chartId,
          name: chartRevision === 1 ? 'Profile fixture ENC' : 'Profile fixture ENC upgraded',
          description: 'Synthetic chart used to verify profile restoration',
          type: 'S-57',
          featureInfo: 'bathymetry-cell',
          format: 'pbf',
          chartLayers: ['DEPARE', 'DEPCNT', 'SOUNDG', 'LNDARE'],
          bounds: [-180, -85, 180, 85],
          minzoom: 0,
          maxzoom: 16,
          tilemapUrl: `/signalk/v1/api/resources/charts/${chartId}/{z}/{x}/{y}`,
          cellSizeControl: {
            queryParameter: 'cellScale',
            minimum: 0.5,
            maximum: 4,
            step: 0.25,
            default: 1,
          },
        },
      }),
    }),
  );
  await page.route(
    new RegExp(`/signalk/v1/api/resources/charts/${chartId}/\\d+/\\d+/\\d+`),
    (route) => route.fulfill({ status: 204 }),
  );

  await page.goto('/');
  await workerProof.assertInitialNavigation();
  await expect(
    page.getByRole('button', { name: 'Profile Harbor detail, switch profile' }),
  ).toBeVisible();
  await openMenuItem(page, 'Layers and charts');

  const panel = page.getByRole('complementary', { name: 'Layers and charts' });
  const row = panel.locator(`[data-layer-row="${chartLayerId}"]`);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Show Profile fixture ENC child layers' }).click();
  const depthAreas = row.getByRole('button', { name: 'Depth areas', exact: true });
  await expect(depthAreas).toHaveAttribute('aria-pressed', 'true');

  await row.getByRole('button', { name: 'Adjust Depth areas opacity' }).click();
  await expect(page.getByRole('slider', { name: 'Depth areas opacity' })).toHaveAttribute(
    'aria-valuetext',
    '80%',
  );
  await page.getByRole('button', { name: 'Close Depth areas opacity' }).click();
  await row.getByRole('button', { name: 'Open Profile fixture ENC chart details' }).click();
  await expect(page.getByRole('slider', { name: 'Opacity' })).toHaveAttribute(
    'aria-valuetext',
    '70%',
  );
  await expect(page.getByRole('slider', { name: 'Cell size' })).toHaveAttribute(
    'aria-valuetext',
    '0.75 times the normal cell size',
  );
  await page.getByRole('button', { name: 'Back to layers' }).click();

  await page.getByRole('button', { name: 'Profile Harbor detail, switch profile' }).click();
  await page.getByRole('menuitem', { name: 'Passage', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Profile Passage, switch profile' })).toBeVisible();
  await row.getByRole('button', { name: 'Show Profile fixture ENC child layers' }).click();
  await expect(depthAreas).toHaveAttribute('aria-pressed', 'false');

  await row.getByRole('button', { name: 'Open Profile fixture ENC chart details' }).click();
  await expect(page.getByRole('slider', { name: 'Opacity' })).toHaveAttribute(
    'aria-valuetext',
    '95%',
  );
  await expect(page.getByRole('slider', { name: 'Cell size' })).toHaveAttribute(
    'aria-valuetext',
    '2 times the normal cell size',
  );
  await page.getByRole('button', { name: 'Back to layers' }).click();
  await panel.getByRole('button', { name: 'Overlays', exact: true }).click();
  const ais = panel.locator('[data-layer-row="ais"]');
  await expect(ais.getByRole('button', { name: 'AIS targets', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Change settings in the active profile, then prove the layer manager's complete snapshot reaches
  // the profile document without dropping asynchronously registered chart or facet entries.
  await ais.getByRole('button', { name: 'AIS targets', exact: true }).click();
  await panel.getByRole('button', { name: 'Charts', exact: true }).click();
  await row.getByRole('button', { name: 'Show Profile fixture ENC child layers' }).click();
  await depthAreas.click();
  await row.getByRole('button', { name: 'Adjust Depth areas opacity' }).click();
  await page.getByRole('slider', { name: 'Depth areas opacity' }).fill('0.65');
  await page.getByRole('button', { name: 'Close Depth areas opacity' }).click();
  await row.getByRole('button', { name: 'Open Profile fixture ENC chart details' }).click();
  await page.getByRole('slider', { name: 'Cell size' }).fill('3');
  await page.getByRole('button', { name: 'Back to layers' }).click();

  const savedPassageLayers = () => {
    const profiles = serverDocument.profiles as Record<
      string,
      {
        settings: {
          layers: Record<string, { visible: boolean; opacity: number; cellSizeScale?: number }>;
        };
      }
    >;
    return profiles.passage.settings.layers;
  };
  await expect
    .poll(() => savedPassageLayers()[facetId('depth-areas')])
    .toEqual({
      visible: true,
      opacity: 0.65,
    });
  await expect.poll(() => savedPassageLayers()[chartLayerId]?.cellSizeScale).toBe(3);
  await expect.poll(() => savedPassageLayers().ais?.visible).toBe(false);

  await page.getByRole('button', { name: 'Profile Passage, switch profile' }).click();
  await page.getByRole('menuitem', { name: 'Harbor detail', exact: true }).click();
  await page.getByRole('button', { name: 'Profile Harbor detail, switch profile' }).click();
  await page.getByRole('menuitem', { name: 'Passage', exact: true }).click();
  await row.getByRole('button', { name: 'Show Profile fixture ENC child layers' }).click();
  await expect(depthAreas).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'Adjust Depth areas opacity' }).click();
  await expect(page.getByRole('slider', { name: 'Depth areas opacity' })).toHaveAttribute(
    'aria-valuetext',
    '65%',
  );
  await page.getByRole('button', { name: 'Close Depth areas opacity' }).click();
  await row.getByRole('button', { name: 'Open Profile fixture ENC chart details' }).click();
  await expect(page.getByRole('slider', { name: 'Cell size' })).toHaveAttribute(
    'aria-valuetext',
    '3 times the normal cell size',
  );
  await page.getByRole('button', { name: 'Back to layers' }).click();
  await panel.getByRole('button', { name: 'Overlays', exact: true }).click();
  await expect(ais.getByRole('button', { name: 'AIS targets', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // Finish with a browser restart and a changed provider descriptor. Visibility and order are
  // keyed by the stable Signal K resource id, so an upgraded chart keeps the navigator's choices
  // even when its display metadata and tile generation change.
  await ais.getByRole('button', { name: 'AIS targets', exact: true }).click();
  await panel.getByRole('button', { name: 'Charts', exact: true }).click();
  const chartRowIds = () =>
    panel
      .locator('[data-layer-row]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-layer-row')));
  await expect
    .poll(async () => {
      const ids = await chartRowIds();
      return ids.indexOf(chartLayerId) < ids.indexOf('basemap');
    })
    .toBe(true);
  const chartMoveHandle = row.getByRole('button', {
    name: /Move Profile fixture ENC, position \d+ of \d+/,
  });
  for (let step = 0; step < 12; step += 1) await chartMoveHandle.press('ArrowDown');
  await expect
    .poll(async () => {
      const ids = await chartRowIds();
      return ids.indexOf('basemap') < ids.indexOf(chartLayerId);
    })
    .toBe(true);

  chartRevision = 2;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Profile Passage, switch profile' })).toBeVisible();
  await openMenuItem(page, 'Layers and charts');
  const restartedPanel = page.getByRole('complementary', { name: 'Layers and charts' });
  const restartedChart = restartedPanel.locator(`[data-layer-row="${chartLayerId}"]`);
  await expect(
    restartedChart.getByRole('button', { name: 'Profile fixture ENC upgraded', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const restartedIds = await restartedPanel
    .locator('[data-layer-row]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-layer-row')));
  expect(restartedIds.indexOf('basemap')).toBeLessThan(restartedIds.indexOf(chartLayerId));
  await restartedPanel.getByRole('button', { name: 'Overlays', exact: true }).click();
  await expect(
    restartedPanel
      .locator('[data-layer-row="ais"]')
      .getByRole('button', { name: 'AIS targets', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});
