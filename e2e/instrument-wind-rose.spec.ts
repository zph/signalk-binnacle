import { expect, type Page, test } from '@playwright/test';
import { openMenuItem } from './helpers';

async function openFullScreenWindRose(page: Page): Promise<void> {
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');

  await page.getByRole('button', { name: 'Customize instruments' }).click();
  await page.getByRole('checkbox', { name: 'Wind rose', exact: true }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: /^Wind rose\./ }).click();
}

test('the compact full-screen wind rose keeps every readout and compass visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openFullScreenWindRose(page);

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

test('the wide full-screen wind rose uses its height and moves readouts into the corners', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFullScreenWindRose(page);

  const focused = page.getByRole('dialog', { name: 'Wind rose full-screen instrument' });
  const compass = focused.locator('svg.rose');
  const [focusedBox, compassBox, awsValueBox, twsValueBox, sogValueBox, depthValueBox] =
    await Promise.all([
      focused.boundingBox(),
      compass.boundingBox(),
      focused.locator('.rose-readout--aws .num').boundingBox(),
      focused.locator('.rose-readout--tws .num').boundingBox(),
      focused.locator('.rose-readout--sog .num').boundingBox(),
      focused.locator('.rose-readout--depth .num').boundingBox(),
    ]);

  expect(focusedBox).not.toBeNull();
  expect(compassBox).not.toBeNull();
  expect(awsValueBox).not.toBeNull();
  expect(twsValueBox).not.toBeNull();
  expect(sogValueBox).not.toBeNull();
  expect(depthValueBox).not.toBeNull();
  if (!focusedBox || !compassBox || !awsValueBox || !twsValueBox || !sogValueBox || !depthValueBox)
    return;

  expect(compassBox.height).toBeGreaterThan(focusedBox.height * 0.9);
  expect(
    Math.abs(compassBox.x + compassBox.width / 2 - (focusedBox.x + focusedBox.width / 2)),
  ).toBeLessThan(3);
  expect(awsValueBox.x + awsValueBox.width).toBeLessThan(compassBox.x);
  expect(twsValueBox.x).toBeGreaterThan(compassBox.x + compassBox.width);
  expect(sogValueBox.x + sogValueBox.width).toBeLessThan(compassBox.x);
  expect(depthValueBox.x).toBeGreaterThan(compassBox.x + compassBox.width);
  expect(awsValueBox.y).toBeLessThan(focusedBox.height / 4);
  expect(sogValueBox.y + sogValueBox.height).toBeGreaterThan(focusedBox.height * 0.75);

  const valueSize = await focused
    .locator('.rose-readout--aws .num')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(valueSize).toBeGreaterThanOrEqual(80);
});

test('a half-page docked wind rose switches to the spacious corner layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');
  await page.getByRole('button', { name: 'Customize instruments' }).click();
  await page.getByRole('checkbox', { name: 'Heading', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Depth', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Wind', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Wind rose', exact: true }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('slider', { name: 'Resize instruments dock' }).press('End');

  const tile = page.getByRole('button', { name: /^Wind rose\./ });
  const [tileBox, compassBox] = await Promise.all([
    tile.boundingBox(),
    tile.locator('svg.rose').boundingBox(),
  ]);
  expect(tileBox).not.toBeNull();
  expect(compassBox).not.toBeNull();
  if (!tileBox || !compassBox) return;
  expect(compassBox.height).toBeGreaterThan(tileBox.height * 0.9);
  expect(compassBox.width).toBeLessThan(tileBox.width * 0.85);
});
