import { expect, test } from '@playwright/test';
import { openMenuItem } from './helpers';

test('the full-screen wind rose keeps every readout and the complete compass visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');

  const instruments = page.getByRole('dialog', { name: 'Instruments' });
  await instruments.getByRole('button', { name: 'Customize instruments' }).click();
  await instruments.getByRole('checkbox', { name: 'Wind rose', exact: true }).check();
  await instruments.getByRole('button', { name: 'Done', exact: true }).click();
  await instruments.getByRole('button', { name: /^Wind rose\./ }).click();

  const focused = page.getByRole('dialog', { name: 'Wind rose full-screen instrument' });
  const layout = focused.locator('.rose-layout');
  await expect(layout).toBeVisible();
  await expect(focused.getByText('AWA', { exact: true })).toHaveCount(0);
  await expect(focused.getByText('TWA', { exact: true })).toHaveCount(0);
  await expect(focused.getByText('Wind rose', { exact: true })).toHaveCount(0);

  const bounds = await layout.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(568);
  await expect(focused.locator('svg.rose')).toBeVisible();
});
