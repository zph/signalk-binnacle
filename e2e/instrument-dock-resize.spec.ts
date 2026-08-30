import { expect, test } from '@playwright/test';
import { openMenuItem, stubVesselsSelf } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubVesselsSelf(page);
  // Clear once before the first load only: an unconditional init script would also wipe the
  // persisted width on the reload step this spec uses to prove persistence.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('binnacle-e2e-cleared') === null) {
      sessionStorage.setItem('binnacle-e2e-cleared', '1');
      localStorage.clear();
    }
  });
});

test('the resize handle drags the dock across the full page and its keys cover the same range', async ({
  page,
}) => {
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');
  const pane = page.locator('#instrument-dock');
  await expect(pane).toBeVisible();

  const handle = page.locator('.dock-resize');
  await expect(handle).toBeVisible();

  const viewport = await page.evaluate(() => document.documentElement.clientWidth);
  await expect(handle).toHaveAttribute('aria-valuemax', String(viewport - 48));

  // Drag the handle far left: the dock widens past the old halfway clamp and nearly covers the page.
  const box = await handle.boundingBox();
  if (!box) throw new Error('Handle has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(10, box.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => pane.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(viewport / 2);

  // Drag back right to narrow the dock again. Grab below the menu-launcher pills, which overlap
  // the handle's left-edge position once the dock is nearly full page.
  const narrowBox = await handle.boundingBox();
  if (!narrowBox) throw new Error('Handle has no bounding box');
  await page.mouse.move(narrowBox.x + narrowBox.width / 2, narrowBox.y + 500);
  await page.mouse.down();
  await page.mouse.move(viewport - 60, narrowBox.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => pane.evaluate((element) => element.getBoundingClientRect().width))
    .toBeLessThan(viewport / 2);

  // The keyboard reaches the same range the pointer can.
  await handle.focus();
  await page.keyboard.press('End');
  const nearFull = await pane.evaluate((element) => element.getBoundingClientRect().width);
  expect(nearFull).toBeGreaterThanOrEqual(viewport - 49);

  await page.keyboard.press('Home');
  const min = await pane.evaluate((element) => element.getBoundingClientRect().width);
  expect(min).toBeLessThanOrEqual(321);

  // A reload restores the committed width from device storage.
  await page.keyboard.press('End');
  await page.waitForTimeout(100);
  const committed = await pane.evaluate((element) => element.getBoundingClientRect().width);
  await page.reload();
  await expect
    .poll(async () => {
      const restored = await pane.evaluate((element) => element.getBoundingClientRect().width);
      return restored - committed;
    })
    .toBeLessThan(2);
});
