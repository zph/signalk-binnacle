import { expect, test } from '@playwright/test';
import { expectInsideViewport, expectNoHorizontalOverflow } from './helpers';

test.use({ serviceWorkers: 'block' });

test('bottom weather button cycles forecast and tide states without hiding currents', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  // Ocean currents is an independent default-on overlay. Confirm the fresh-install default before
  // proving the weather display cycle never hides it.
  await page.getByRole('button', { name: 'Open supermenu' }).click();
  const supermenu = page.getByRole('menu', { name: 'Supermenu' });
  await supermenu.getByRole('menuitem', { name: 'Chart', exact: true }).click();
  await supermenu.getByRole('menuitem', { name: 'Layers and charts', exact: true }).click();
  const layers = page.locator('#layers-panel');
  await layers
    .getByLabel('Layers and Overlays view')
    .getByRole('button', { name: 'Overlays' })
    .click();
  const oceanConditions = layers.getByRole('button', { name: 'Ocean conditions' });
  const openOceanConditions = async (): Promise<void> => {
    if ((await oceanConditions.getAttribute('aria-expanded')) !== 'true') {
      await oceanConditions.focus();
      await oceanConditions.press('Enter');
    }
  };
  await openOceanConditions();
  const currents = layers
    .locator('[data-layer-row="weather-current"]')
    .getByRole('button', { name: 'Ocean currents', exact: true });
  await expect(currents).toHaveAttribute('aria-pressed', 'true');
  await layers.getByRole('button', { name: 'Close layers and charts' }).click();

  const helm = page.getByRole('group', { name: 'Helm actions' });
  const button = helm.getByRole('button', {
    name: /Weather, wind, tides, currents, and more:/,
  });
  const forecasts = page.getByRole('complementary', { name: /forecast overlay/ });
  const nextWeather = async (name: string): Promise<void> => {
    await button.click();
    await expect(button).toHaveAccessibleName(
      `Weather, wind, tides, currents, and more: ${name}. Activate for next overlay.`,
    );
    await expectInsideViewport(helm, page);
    await expectNoHorizontalOverflow(helm);
  };
  const expectForecast = async (name: string): Promise<void> => {
    const forecast = page.getByRole('complementary', { name: `${name} forecast overlay` });
    await expect(forecast).toBeVisible();
    await expect(forecasts).toHaveCount(1);
    await expectInsideViewport(forecast, page);
    await expectNoHorizontalOverflow(forecast);
  };

  await expect(button).toHaveAccessibleName(
    'Weather, wind, tides, currents, and more: off. Activate for next overlay.',
  );
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(forecasts).toHaveCount(0);

  await nextWeather('conditions');
  await expectForecast('Conditions');
  const conditions = page.getByRole('complementary', { name: 'Conditions forecast overlay' });
  await expect(conditions.getByRole('group', { name: 'Combined conditions' })).toContainText(
    'hazard caution context',
  );
  await expect(conditions).toContainText('no icon is not a safety statement');

  await nextWeather('wind and gusts');
  await expectForecast('Wind and gusts');
  const wind = page.getByRole('complementary', { name: 'Wind and gusts forecast overlay' });
  await expect(wind).toContainText('color shows sustained wind');
  await expect(wind).toContainText('barbs show direction');
  await expect(wind).toContainText('labels show gust speed in');

  await nextWeather('tide and current stations');
  await expect(forecasts).toHaveCount(0);

  await nextWeather('ocean currents');
  await expectForecast('Ocean currents');

  await nextWeather('temperature');
  await expectForecast('Temperature');

  await nextWeather('UV index');
  await expectForecast('UV index');

  await nextWeather('off');
  await expect(forecasts).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Open supermenu' }).click();
  await supermenu.getByRole('menuitem', { name: 'Chart', exact: true }).click();
  await supermenu.getByRole('menuitem', { name: 'Layers and charts', exact: true }).click();
  await layers
    .getByLabel('Layers and Overlays view')
    .getByRole('button', { name: 'Overlays' })
    .click();
  await openOceanConditions();
  await expect(currents).toHaveAttribute('aria-pressed', 'true');
});
