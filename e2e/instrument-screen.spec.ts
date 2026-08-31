import { expect, type Page, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

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

  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  await expect(layer).toBeVisible();
  await expect(layer).toHaveAttribute('aria-label', 'Instrument screen layout editing');
  const done = layer.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeVisible();

  // Starting edit mode frees the selected set from the old drawer, so the chart immediately has
  // a real instrument to arrange rather than asking the operator to discover a second add flow.
  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="sog"]`);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-instrument-id', 'sog');

  await done.click();
  await expect(layer.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(frame).toBeVisible();
  await expect(frame).not.toHaveAttribute('inert', '');

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

test('screen edit mode drags an instrument from its face on the chart', async ({ page }) => {
  await page.goto('/');
  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="sog"]`);
  const [source, destination] = await Promise.all([frame.boundingBox(), layer.boundingBox()]);
  if (!source || !destination) throw new Error('Instrument or chart target missing.');

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    destination.x + destination.width * 0.45,
    destination.y + destination.height * 0.55,
    {
      steps: 12,
    },
  );
  await expect(frame).toHaveClass(/floating-frame--dragging/);
  await page.mouse.up();

  await expect(frame).toHaveAttribute('data-instrument-id', 'sog');
  const frameBox = await frame.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(frameBox?.x).toBeLessThan(destination.x + destination.width * 0.6);
  await expect(frame).not.toHaveClass(/floating-frame--dragging/);
});

test('the locked screen layout persists across a reload and can be removed again', async ({
  page,
}) => {
  await page.goto('/');
  await runScreenEditCommand(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.reload();

  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="sog"]`);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-instrument-id', 'sog');
  await expect(frame).not.toHaveAttribute('inert', '');

  await runScreenEditCommand(page);
  await frame.getByRole('button', { name: 'Remove Speed from chart' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(frame).toHaveCount(0);
  // The remaining selected instruments stay on the desktop; removal is per widget, not a global
  // clear-layout action.
  await expect(page.locator('.instrument-screen-slot')).toHaveCount(1);
});
