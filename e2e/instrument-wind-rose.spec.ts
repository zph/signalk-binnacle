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

function expectTinyEdgeGap(gap: number): void {
  expect(gap).toBeGreaterThanOrEqual(3);
  expect(gap).toBeLessThanOrEqual(8);
}

function expectNearRailPosition(
  row: { y: number; height: number },
  tile: { y: number; height: number },
  fraction: number,
): void {
  const actualCenter = row.y + row.height / 2;
  const expectedCenter = tile.y + tile.height * fraction;
  expect(Math.abs(actualCenter - expectedCenter)).toBeLessThan(tile.height * 0.08);
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
  await expect(focused.locator('.heading-pill')).toBeVisible();

  const compassBackplateFill = await focused
    .locator('.card-backplate')
    .evaluate((element) => getComputedStyle(element).fill);
  expect(compassBackplateFill).toBe('none');

  const [tileBox, topRowBox, bottomRowBox, awsBox, twsBox, sogBox, depthBox] = await Promise.all([
    focused.locator('.tile--wind-rose').boundingBox(),
    focused.locator('.rose-readouts--top').boundingBox(),
    focused.locator('.rose-readouts--bottom').boundingBox(),
    focused.locator('.rose-readout--aws .num').boundingBox(),
    focused.locator('.rose-readout--tws .num').boundingBox(),
    focused.locator('.rose-readout--sog .num').boundingBox(),
    focused.locator('.rose-readout--depth .num').boundingBox(),
  ]);
  expect(tileBox).not.toBeNull();
  expect(topRowBox).not.toBeNull();
  expect(bottomRowBox).not.toBeNull();
  expect(awsBox).not.toBeNull();
  expect(twsBox).not.toBeNull();
  expect(sogBox).not.toBeNull();
  expect(depthBox).not.toBeNull();
  if (!tileBox || !topRowBox || !bottomRowBox || !awsBox || !twsBox || !sogBox || !depthBox) return;

  expectTinyEdgeGap(topRowBox.x - tileBox.x);
  expectTinyEdgeGap(tileBox.x + tileBox.width - (topRowBox.x + topRowBox.width));
  expectTinyEdgeGap(bottomRowBox.x - tileBox.x);
  expectNearRailPosition(topRowBox, tileBox, 0.25);
  expectNearRailPosition(bottomRowBox, tileBox, 0.75);
  expect(Math.abs(awsBox.x - topRowBox.x)).toBeLessThan(2);
  expect(Math.abs(twsBox.x + twsBox.width - (topRowBox.x + topRowBox.width))).toBeLessThan(2);
  expect(Math.abs(sogBox.x - bottomRowBox.x)).toBeLessThan(2);
  expect(
    Math.abs(depthBox.x + depthBox.width - (bottomRowBox.x + bottomRowBox.width)),
  ).toBeLessThan(2);

  const depthBackground = await focused
    .locator('.rose-readout--depth')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(depthBackground).toBe('rgba(0, 0, 0, 0)');
});

test('the wide full-screen wind rose uses its height and keeps readouts on side rails', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFullScreenWindRose(page);

  const focused = page.getByRole('dialog', { name: 'Wind rose full-screen instrument' });
  const compass = focused.locator('svg.rose');
  const [
    focusedBox,
    tileBox,
    compassBox,
    headingBox,
    topRowBox,
    bottomRowBox,
    awsValueBox,
    twsValueBox,
    sogValueBox,
    depthValueBox,
  ] = await Promise.all([
    focused.boundingBox(),
    focused.locator('.tile--wind-rose').boundingBox(),
    compass.boundingBox(),
    focused.locator('.heading-digits').boundingBox(),
    focused.locator('.rose-readouts--top').boundingBox(),
    focused.locator('.rose-readouts--bottom').boundingBox(),
    focused.locator('.rose-readout--aws .num').boundingBox(),
    focused.locator('.rose-readout--tws .num').boundingBox(),
    focused.locator('.rose-readout--sog .num').boundingBox(),
    focused.locator('.rose-readout--depth .num').boundingBox(),
  ]);

  expect(focusedBox).not.toBeNull();
  expect(tileBox).not.toBeNull();
  expect(compassBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(topRowBox).not.toBeNull();
  expect(bottomRowBox).not.toBeNull();
  expect(awsValueBox).not.toBeNull();
  expect(twsValueBox).not.toBeNull();
  expect(sogValueBox).not.toBeNull();
  expect(depthValueBox).not.toBeNull();
  if (
    !focusedBox ||
    !tileBox ||
    !compassBox ||
    !headingBox ||
    !topRowBox ||
    !bottomRowBox ||
    !awsValueBox ||
    !twsValueBox ||
    !sogValueBox ||
    !depthValueBox
  )
    return;

  expect(compassBox.height).toBeGreaterThan(focusedBox.height * 0.9);
  expect(
    Math.abs(compassBox.x + compassBox.width / 2 - (focusedBox.x + focusedBox.width / 2)),
  ).toBeLessThan(3);
  expect(
    Math.abs(headingBox.x + headingBox.width / 2 - (compassBox.x + compassBox.width / 2)),
  ).toBeLessThan(3);
  expect(
    Math.abs(headingBox.y + headingBox.height / 2 - (compassBox.y + compassBox.height / 2)),
  ).toBeLessThan(compassBox.height * 0.035);
  await expect(focused.getByText('HDG', { exact: true })).toHaveCount(0);
  expect(awsValueBox.x + awsValueBox.width).toBeLessThan(compassBox.x);
  expect(twsValueBox.x).toBeGreaterThan(compassBox.x + compassBox.width);
  expect(sogValueBox.x + sogValueBox.width).toBeLessThan(compassBox.x);
  expect(depthValueBox.x).toBeGreaterThan(compassBox.x + compassBox.width);
  expectTinyEdgeGap(topRowBox.x - tileBox.x);
  expectTinyEdgeGap(tileBox.x + tileBox.width - (topRowBox.x + topRowBox.width));
  expectNearRailPosition(topRowBox, tileBox, 0.25);
  expectNearRailPosition(bottomRowBox, tileBox, 0.75);

  const valueSize = await focused
    .locator('.rose-readout--aws .num')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(valueSize).toBeGreaterThanOrEqual(80);
});

test('a half-page docked wind rose switches to the spacious side-rail layout', async ({ page }) => {
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
  const [tileBox, compassBox, topRowBox, bottomRowBox] = await Promise.all([
    tile.boundingBox(),
    tile.locator('svg.rose').boundingBox(),
    tile.locator('.rose-readouts--top').boundingBox(),
    tile.locator('.rose-readouts--bottom').boundingBox(),
  ]);
  expect(tileBox).not.toBeNull();
  expect(compassBox).not.toBeNull();
  expect(topRowBox).not.toBeNull();
  expect(bottomRowBox).not.toBeNull();
  if (!tileBox || !compassBox || !topRowBox || !bottomRowBox) return;
  expect(compassBox.height).toBeGreaterThan(tileBox.height * 0.9);
  expect(compassBox.width).toBeLessThan(tileBox.width * 0.85);
  expectTinyEdgeGap(topRowBox.x - tileBox.x);
  expectTinyEdgeGap(tileBox.x + tileBox.width - (topRowBox.x + topRowBox.width));
  expectNearRailPosition(topRowBox, tileBox, 0.25);
  expectNearRailPosition(bottomRowBox, tileBox, 0.75);
});

test('a half-width short wind rose shrinks its side values around the compass', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 420 });
  await openFullScreenWindRose(page);

  const focused = page.getByRole('dialog', { name: 'Wind rose full-screen instrument' });
  const compass = focused.locator('svg.rose');
  const [
    tileBox,
    compassBox,
    headingBox,
    topRowBox,
    bottomRowBox,
    awsBox,
    twsBox,
    sogBox,
    depthBox,
  ] = await Promise.all([
    focused.locator('.tile--wind-rose').boundingBox(),
    compass.boundingBox(),
    focused.locator('.heading-digits').boundingBox(),
    focused.locator('.rose-readouts--top').boundingBox(),
    focused.locator('.rose-readouts--bottom').boundingBox(),
    focused.locator('.rose-readout--aws .num').boundingBox(),
    focused.locator('.rose-readout--tws .num').boundingBox(),
    focused.locator('.rose-readout--sog .num').boundingBox(),
    focused.locator('.rose-readout--depth .num').boundingBox(),
  ]);

  expect(tileBox).not.toBeNull();
  expect(compassBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(topRowBox).not.toBeNull();
  expect(bottomRowBox).not.toBeNull();
  expect(awsBox).not.toBeNull();
  expect(twsBox).not.toBeNull();
  expect(sogBox).not.toBeNull();
  expect(depthBox).not.toBeNull();
  if (
    !tileBox ||
    !compassBox ||
    !headingBox ||
    !topRowBox ||
    !bottomRowBox ||
    !awsBox ||
    !twsBox ||
    !sogBox ||
    !depthBox
  )
    return;

  expect(awsBox.x + awsBox.width).toBeLessThanOrEqual(compassBox.x);
  expect(sogBox.x + sogBox.width).toBeLessThanOrEqual(compassBox.x);
  expect(twsBox.x).toBeGreaterThanOrEqual(compassBox.x + compassBox.width);
  expect(depthBox.x).toBeGreaterThanOrEqual(compassBox.x + compassBox.width);
  expectTinyEdgeGap(topRowBox.x - tileBox.x);
  expectTinyEdgeGap(tileBox.x + tileBox.width - (topRowBox.x + topRowBox.width));
  expectNearRailPosition(topRowBox, tileBox, 0.25);
  expectNearRailPosition(bottomRowBox, tileBox, 0.75);
  expect(Math.abs(awsBox.x - topRowBox.x)).toBeLessThan(2);
  expect(Math.abs(twsBox.x + twsBox.width - (topRowBox.x + topRowBox.width))).toBeLessThan(2);
  expect(Math.abs(sogBox.x - bottomRowBox.x)).toBeLessThan(2);
  expect(
    Math.abs(depthBox.x + depthBox.width - (bottomRowBox.x + bottomRowBox.width)),
  ).toBeLessThan(2);
  expect(
    Math.abs(headingBox.x + headingBox.width / 2 - (compassBox.x + compassBox.width / 2)),
  ).toBeLessThan(3);
  expect(
    Math.abs(headingBox.y + headingBox.height / 2 - (compassBox.y + compassBox.height / 2)),
  ).toBeLessThan(compassBox.height * 0.035);

  const valueSize = await focused
    .locator('.rose-readout--aws .num')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(valueSize).toBeLessThan(64);

  const backdropFilter = await focused
    .locator('.heading-pill')
    .evaluate((element) => getComputedStyle(element).backdropFilter);
  expect(backdropFilter).toContain('blur');
});
