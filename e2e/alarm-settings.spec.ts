import { expect, test } from '@playwright/test';
import { openMenuItem, stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

test('collision alarm thresholds survive a hard reload through plugin storage', async ({
  page,
}) => {
  let stored = {
    dangerCpaMeters: 463,
    dangerTcpaSeconds: 480,
    warningCpaMeters: 1_852,
    warningTcpaSeconds: 1_200,
  };
  let writes = 0;
  await stubVesselsSelf(page);
  await page.route(/\/plugins\/binnacle-custom\/api\/settings\/collision$/, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { thresholds: typeof stored };
      stored = body.thresholds;
      writes += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ thresholds: stored }),
    });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });

  await page.goto('/');
  await openMenuItem(page, 'Alarms');
  await page.getByRole('button', { name: 'Adjust collision alarm sensitivity' }).click();
  const warningTime = page.getByRole('spinbutton', { name: 'Warning time to closest pass' });
  await expect(warningTime).toHaveValue('20');
  await warningTime.fill('33');
  await warningTime.press('Tab');
  await expect.poll(() => writes).toBe(1);

  await page.evaluate(() => localStorage.removeItem('binnacle-custom:lookout-thresholds'));
  await page.reload();
  await openMenuItem(page, 'Alarms');
  await page.getByRole('button', { name: 'Adjust collision alarm sensitivity' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Warning time to closest pass' })).toHaveValue(
    '33',
  );
});

test('alarm location survives cleared browser storage through plugin storage', async ({ page }) => {
  let storedLocation: 'top' | 'center' | 'bottom' = 'bottom';
  let writes = 0;
  await stubVesselsSelf(page);
  await page.route(/\/plugins\/binnacle-custom\/api\/settings\/alarm-location$/, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { location: typeof storedLocation };
      storedLocation = body.location;
      writes += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ location: storedLocation }),
    });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });

  await page.goto('/');
  await openMenuItem(page, 'Alarms');
  const location = page.getByRole('group', { name: 'Alarm location' });
  await expect(location.getByRole('button', { name: 'Bottom' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await location.getByRole('button', { name: 'Center' }).click();
  await expect(page.locator('.safety-rail')).toHaveAttribute('data-location', 'center');
  await expect.poll(() => writes).toBe(1);

  await page.reload();
  await openMenuItem(page, 'Alarms');
  await expect(
    page.getByRole('group', { name: 'Alarm location' }).getByRole('button', { name: 'Center' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.safety-rail')).toHaveAttribute('data-location', 'center');
});
