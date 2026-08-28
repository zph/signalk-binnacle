import { expect, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubVesselsSelf(page);
  await page.addInitScript(() => localStorage.clear());
});

test('the map instrument opens from Command K with an independent interactive viewport', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Control+K');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('map instrument');
  await palette.getByRole('option', { name: /Map instrument/ }).click();

  const instrument = page.getByRole('dialog', { name: 'Map full-screen instrument' });
  await expect(instrument).toBeVisible();
  await expect(instrument.locator('.instrument-map canvas')).toBeVisible();
  await expect(instrument.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(instrument.getByRole('button', { name: 'Zoom out' })).toBeVisible();
  const quality = instrument.getByRole('button', { name: /Map quality: App default/ });
  await expect(quality).toBeVisible();
  await quality.click();
  const qualityMenu = page.getByRole('radiogroup', { name: 'Map quality' });
  await expect(qualityMenu.getByRole('radio', { name: /App default/ })).toBeChecked();
  await qualityMenu.getByRole('radio', { name: 'Crisp' }).click();
  await expect(instrument.getByRole('button', { name: 'Map quality: Crisp' })).toBeVisible();
  const ais = instrument.getByRole('button', { name: /AIS: App default/ });
  await expect(ais).toBeVisible();
  await ais.click();
  const aisMenu = page.getByRole('radiogroup', { name: 'AIS visibility' });
  await expect(aisMenu.getByRole('radio', { name: /App default/ })).toBeChecked();
  await aisMenu.getByRole('radio', { name: 'Off' }).click();
  await expect(instrument.getByRole('button', { name: 'AIS: Off' })).toBeVisible();
  await expect(instrument.getByRole('button', { name: 'Follow boat' })).toBeDisabled();
  await expect(instrument.getByRole('button', { name: 'Collapse instrument' })).toBeVisible();

  // The primary chart remains mounted behind the full-screen instrument, proving this is a second
  // MapLibre camera rather than a reskinned or relocated primary viewport.
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(2);
  await instrument.getByRole('button', { name: 'Zoom in' }).click();
  await instrument.getByRole('button', { name: 'Zoom out' }).click();
  await instrument.getByRole('button', { name: 'Collapse instrument' }).click();
  await expect(instrument).toHaveCount(0);
});
