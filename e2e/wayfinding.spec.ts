import { expect, test } from '@playwright/test';
import { expectInsideViewport, expectNoHorizontalOverflow, stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

const routeResource = {
  passage: {
    name: 'Harbor passage',
    feature: {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-83.5, 42.6],
          [-83.4, 42.7],
        ],
      },
      properties: { coordinatesMeta: [{ name: 'Start' }, { name: 'Harbor' }] },
    },
  },
};

test('Sail Wayfinder calculates, cancels, and saves without starting navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  await page.route(/\/signalk\/v2\/api\/resources\/routes$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(routeResource),
    }),
  );
  await page.route(/\/plugins\/signalk-wayfinder\/api\/v1\/capabilities/, (route) => {
    const requestedDraftPath = new URL(route.request().url()).searchParams.get('draftPath');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        apiVersion: '1.3',
        ready: true,
        objectives: ['fastest', 'leastMotoring', 'allMotoring', 'bestWeather'],
        maximumAlternatives: 10,
        passageConstraints: ['daylightOnly', 'maxHoursPerDay'],
        navigationConstraints: ['minimumShoreDistanceNm', 'maximumOffshoreDistanceNm'],
        vesselDraft: {
          valueM: requestedDraftPath === 'design.customDraft' ? 2.1 : 1.8,
          path: requestedDraftPath ?? 'design.draft.current',
        },
        configuredDraftPath: requestedDraftPath ?? 'design.draft.current',
      }),
    });
  });
  let calculations = 0;
  await page.route(/\/plugins\/signalk-wayfinder\/calculate$/, async (route) => {
    calculations += 1;
    const request = route.request().postDataJSON();
    expect(request.start).toEqual({ lat: 42.6, lon: -83.5 });
    expect(request.end).toEqual({ lat: 42.7, lon: -83.4 });
    expect(request.useLandAvoidance).toBe(true);
    expect(request.useSafetyMargin).toBe(true);
    expect(request.options).toEqual({
      daylightOnly: true,
      maxHoursPerDay: 8,
      minimumShoreDistanceNm: 2,
      maximumOffshoreDistanceNm: 30,
      objective: 'bestWeather',
      alternativeCount: 5,
      motorSpeedKn: 0,
      motorBelowKn: 0,
      vesselDraftM: 2.1,
    });
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{}' });
  });
  let statusReads = 0;
  let allowComplete = false;
  await page.route(/\/plugins\/signalk-wayfinder\/status$/, (route) => {
    statusReads += 1;
    const done = allowComplete && statusReads > 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: done ? 'done' : 'calculating',
        progress: done ? 100 : 45,
        ...(done
          ? {
              alternatives: [
                {
                  index: 0,
                  complete: true,
                  durationHours: 16.2,
                  distanceNm: 72.4,
                  motorHours: 0,
                  averageWaveHeightM: 0.7,
                  maximumWaveHeightM: 1.2,
                  averageWindKn: 13.4,
                  maximumWindKn: 20.1,
                },
                {
                  index: 1,
                  complete: true,
                  durationHours: 17.8,
                  distanceNm: 75.1,
                  motorHours: 0,
                  averageWaveHeightM: 0.6,
                  maximumWaveHeightM: 1.1,
                  averageWindKn: 12.9,
                  maximumWindKn: 18.7,
                },
              ],
            }
          : {}),
      }),
    });
  });
  let cancellations = 0;
  await page.route(/\/plugins\/signalk-wayfinder\/cancel$/, (route) => {
    cancellations += 1;
    allowComplete = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"cancelled":true}',
    });
  });
  let saves = 0;
  await page.route(/\/plugins\/signalk-wayfinder\/save-route$/, (route) => {
    saves += 1;
    expect(route.request().postDataJSON()).toEqual({
      name: 'Harbor passage weather route',
      alternativeIndex: 1,
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"routeId":"routed"}',
    });
  });

  await page.goto('/');
  const helm = page.getByRole('group', { name: 'Helm actions' });
  const supermenu = page.getByRole('menu', { name: 'Supermenu' });
  await helm.getByRole('button', { name: 'Open supermenu' }).click();
  await supermenu.getByRole('menuitem', { name: 'Navigate' }).click();
  await supermenu.getByRole('menuitem', { name: 'Sail Wayfinder' }).click();

  const panel = page.getByRole('complementary', { name: 'Sail Wayfinder' });
  await expect(panel.getByRole('heading', { name: 'Sail Wayfinder' })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Route' })).toHaveValue('passage');
  await expectInsideViewport(panel, page);
  await expectNoHorizontalOverflow(panel);

  await panel.getByRole('combobox', { name: 'Routing objective' }).selectOption('bestWeather');
  const draftPath = panel.getByRole('textbox', { name: 'Signal K draft path' });
  await expect(draftPath).toHaveValue('design.draft.current');
  await draftPath.fill('design.customDraft');
  await panel.getByRole('button', { name: 'Read draft path' }).click();
  await expect(panel.getByText('Loaded from design.customDraft.')).toBeVisible();

  await panel.getByRole('checkbox', { name: 'Daylight-only sailing' }).check();
  const maxHours = panel.getByRole('spinbutton', { name: 'Maximum underway per day in h' });
  await maxHours.fill('8');
  await maxHours.blur();
  const minimumShore = panel.getByRole('spinbutton', {
    name: 'Minimum shoreline clearance in nm',
  });
  await minimumShore.fill('2');
  await minimumShore.blur();
  const maximumOffshore = panel.getByRole('spinbutton', {
    name: 'Maximum distance offshore in nm',
  });
  await maximumOffshore.fill('30');
  await maximumOffshore.blur();

  await panel.getByRole('button', { name: 'Calculate best-weather routes' }).click();
  await expect(panel.getByRole('button', { name: 'Cancel calculation' })).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel calculation' }).click();
  await expect.poll(() => cancellations).toBe(1);
  await expect(panel.getByRole('button', { name: 'Calculate best-weather routes' })).toBeVisible();

  statusReads = 0;
  await panel.getByRole('button', { name: 'Calculate best-weather routes' }).click();
  await expect(panel.getByRole('heading', { name: 'Ready to save' })).toBeVisible();
  await panel.getByRole('combobox', { name: 'Route alternative' }).selectOption('1');
  await expect(panel.getByText(/Average wind 12\.9 kn,\s*average waves 0\.6 m\./)).toBeVisible();
  await panel.getByRole('button', { name: 'Save advisory route' }).click();
  await expect.poll(() => saves).toBe(1);
  await expect(panel.getByText('Route saved. Navigation was not started.')).toBeVisible();
  expect(calculations).toBe(2);
  await expect(page.getByText(/Navigating to/)).toHaveCount(0);
});
