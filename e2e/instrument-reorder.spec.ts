import { expect, test } from '@playwright/test';
import { chooseInstrumentPaneAction, openMenuItem, stubVesselsSelf } from './helpers';

test('unlocked instrument tiles drag into the persisted Customize order', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');

  const dock = page.getByRole('complementary', { name: 'Instruments' });
  const tileOrder = () =>
    dock
      .locator('.tiles [data-tile-row]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-tile-row')));
  const before = await tileOrder();
  expect(before.slice(0, 2)).toEqual(['sog', 'heading']);

  await chooseInstrumentPaneAction(page, dock, 'Unlock instrument arrangement');
  const firstHandle = dock.getByRole('button', { name: /^Move Speed, position 1 of/ });
  const secondTile = dock.locator('[data-tile-row="heading"]');
  const [handleBox, targetBox] = await Promise.all([
    firstHandle.boundingBox(),
    secondTile.boundingBox(),
  ]);
  if (!handleBox || !targetBox) throw new Error('Instrument reorder controls did not lay out.');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width * 0.8, targetBox.y + targetBox.height / 2, {
    steps: 5,
  });
  await page.mouse.up();

  await expect.poll(async () => (await tileOrder()).slice(0, 2)).toEqual(['heading', 'sog']);
  await chooseInstrumentPaneAction(page, dock, 'Lock instrument arrangement');
  await chooseInstrumentPaneAction(page, dock, 'Customize instruments');
  const customizeOrder = await dock
    .locator('.tile-list [data-tile-row]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-tile-row')));
  expect(customizeOrder.slice(0, 2)).toEqual(['heading', 'sog']);

  await chooseInstrumentPaneAction(page, dock, 'Finish customizing');
  await page.reload();
  await expect(dock).toBeVisible();
  await expect.poll(async () => (await tileOrder()).slice(0, 2)).toEqual(['heading', 'sog']);
  await dock.click({ button: 'right', position: { x: 12, y: 12 } });
  await expect(page.getByRole('menuitem', { name: 'Unlock instrument arrangement' })).toBeVisible();
});

test('unlocked instrument tiles resize from their bottom-corner grip and restore the profile layout', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');

  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await chooseInstrumentPaneAction(page, dock, 'Unlock instrument arrangement');
  const grip = dock.getByRole('button', { name: 'Resize Speed in dock' });
  const gripBox = await grip.boundingBox();
  if (!gripBox) throw new Error('Instrument resize grip did not lay out.');

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width + 40, gripBox.y + gripBox.height / 2, {
    steps: 4,
  });
  await page.mouse.up();

  const speed = dock.locator('[data-tile-row="sog"]');
  await expect(speed).toHaveClass(/tile-shell--wide/);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('binnacle-custom:instrument-tile-layouts')),
    )
    .toContain('"sog":"wide"');
});
