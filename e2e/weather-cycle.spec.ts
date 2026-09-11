import { expect, test } from '@playwright/test';
import { expectInsideViewport, expectNoHorizontalOverflow } from './helpers';

test.use({ serviceWorkers: 'block' });

test('bottom weather button cycles forecast and tide states without hiding currents', async ({
  page,
}) => {
  await page.goto('/');

  const helm = page.getByRole('group', { name: 'Helm actions' });
  const button = helm.getByRole('button', { name: /Weather and tides:/ });
  const forecasts = page.getByRole('complementary', { name: /forecast overlay/ });
  const nextWeather = async (name: string): Promise<void> => {
    await button.click();
    await expect(button).toHaveAccessibleName(
      `Weather and tides: ${name}. Activate for next overlay.`,
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

  await expect(button).toHaveAccessibleName('Weather and tides: off. Activate for next overlay.');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expectForecast('Ocean currents');

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
  await expectForecast('Ocean currents');

  await nextWeather('temperature');
  await expectForecast('Temperature');

  await nextWeather('UV index');
  await expectForecast('UV index');

  await nextWeather('off');
  await expectForecast('Ocean currents');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});
