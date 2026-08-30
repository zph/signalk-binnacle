import { expect, type Page, test } from '@playwright/test';
import { openMenuItem, stubVesselsSelf } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubVesselsSelf(page);
  // Clear once before the first load only: an init script would also wipe the saved layout on the
  // reload step this spec uses to prove persistence.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('binnacle-e2e-cleared') === null) {
      sessionStorage.setItem('binnacle-e2e-cleared', '1');
      localStorage.clear();
    }
  });
});

const FLOATING_FRAME = '.instrument-screen-layer .floating-frame';

async function runScreenEditCommand(page: Page): Promise<void> {
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('Edit screen instruments');
  await palette.getByRole('option', { name: 'Edit screen instruments' }).click();
  await expect(palette).toHaveCount(0);
}

test('screen edit mode places an instrument on the chart and locks it with Done', async ({
  page,
}) => {
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');

  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  await expect(layer).toBeVisible();
  await expect(layer).toHaveAttribute('aria-label', 'Instrument screen layout editing');
  const done = layer.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeVisible();

  // MapLibre owns the chart's top-end corner for zoom. Screen-edit actions must reserve that
  // target, including when a narrow chart cell is left after opening the instrument dock.
  const [doneBox, zoomBox] = await Promise.all([
    done.boundingBox(),
    page.getByRole('button', { name: 'Zoom in', exact: true }).boundingBox(),
  ]);
  expect(doneBox).not.toBeNull();
  expect(zoomBox).not.toBeNull();
  expect((doneBox?.x ?? 0) + (doneBox?.width ?? 0)).toBeLessThanOrEqual(zoomBox?.x ?? 0);

  // On the initial run, the chart welcome banner must not cover the layout toolbar or its Done
  // action. The banner is conditional, so only compare boxes when this fresh-device prompt shows.
  const welcome = page.getByText(
    'First time with Binnacle? Read the short safety orientation, or set up charts.',
  );
  if (await welcome.isVisible()) {
    const welcomeBox = await welcome.boundingBox();
    const toolbarBox = await layer.locator('.screen-edit-chrome').boundingBox();
    expect(welcomeBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(toolbarBox?.y).toBeGreaterThanOrEqual((welcomeBox?.y ?? 0) + (welcomeBox?.height ?? 0));
  }

  await layer.getByRole('button', { name: 'Add instrument', exact: true }).click();
  const addMenu = page.getByRole('menu', { name: 'Add instrument to chart' });
  await addMenu.getByRole('menuitem', { name: 'Speed', exact: true }).click();

  const frame = page.locator(FLOATING_FRAME);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-instrument-id', 'sog');

  await done.click();
  await expect(layer.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('inert', '');

  // Locked mode hands gestures back to the chart: the layer root no longer intercepts, so a drag
  // beside the tile pans the chart (the persisted map view moves with it).
  const viewBefore = await page.evaluate(() => localStorage.getItem('binnacle-custom:map-view'));
  await page.mouse.move(100, 400);
  await page.mouse.down();
  await page.mouse.move(260, 430, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const stored = await page.evaluate(() => localStorage.getItem('binnacle-custom:map-view'));
      return stored !== null && stored !== viewBefore;
    })
    .toBe(true);
});

test('screen edit mode accepts a dock tile dropped on the chart', async ({ page }) => {
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');
  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  const dockTile = page.locator('[data-tile-row="sog"]');
  const [source, destination] = await Promise.all([dockTile.boundingBox(), layer.boundingBox()]);
  if (!source || !destination)
    throw new Error('Instrument drag source or chart drop target missing.');

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    destination.x + destination.width * 0.45,
    destination.y + destination.height * 0.55,
    {
      steps: 12,
    },
  );
  await expect(layer.locator('.floating-drop-preview')).toBeVisible();
  await page.mouse.up();

  const frame = page.locator(FLOATING_FRAME);
  await expect(frame).toHaveAttribute('data-instrument-id', 'sog');
  const frameBox = await frame.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(frameBox?.x).toBeLessThan(destination.x + destination.width * 0.6);
  await expect(layer.locator('.floating-drop-preview')).toHaveCount(0);
});

test('the locked screen layout persists across a reload and can be removed again', async ({
  page,
}) => {
  await page.goto('/');
  await openMenuItem(page, 'Instrument dock');
  await runScreenEditCommand(page);
  const layer = page.locator('.instrument-screen-layer');
  await layer.getByRole('button', { name: 'Add instrument', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Add instrument to chart' })
    .getByRole('menuitem', { name: 'Speed', exact: true })
    .click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.reload();

  const frame = page.locator(FLOATING_FRAME);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-instrument-id', 'sog');
  await expect(frame).toHaveAttribute('inert', '');

  await runScreenEditCommand(page);
  await frame.getByRole('button', { name: 'Remove Speed from chart' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(frame).toHaveCount(0);
  await expect(page.locator('.instrument-screen-slot')).toHaveCount(0);
});
