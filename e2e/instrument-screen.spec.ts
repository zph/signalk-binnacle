import { expect, type Page, test } from '@playwright/test';
import { expectInsideViewport, stubVesselsSelf } from './helpers';

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

async function dismissOrientation(page: Page): Promise<void> {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible()) await gotIt.click();
}

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

test('the radial menu opens the direct instrument editor', async ({ page }) => {
  await page.goto('/');
  await dismissOrientation(page);

  const helmControl = page.getByRole('button', { name: 'Open supermenu', exact: true });
  await expect(helmControl).toBeVisible();
  await expectInsideViewport(helmControl, page);
  await helmControl.click();
  await page.getByRole('menuitem', { name: 'Vessel' }).click();
  await page.getByRole('menuitem', { name: 'Edit instruments' }).click();
  const done = page.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeVisible();
  await expectInsideViewport(done, page);
});

test('the helm instruments control advances from Show to Edit and opens a bounded picker', async ({
  page,
}) => {
  await page.goto('/');
  await dismissOrientation(page);

  const instruments = page.getByRole('button', { name: 'Show instruments', exact: true });
  await expect(instruments).toBeVisible();
  await expectInsideViewport(instruments, page);
  await instruments.click();
  await page.getByRole('button', { name: 'Edit instruments', exact: true }).click();

  const layer = page.locator('.instrument-screen-layer');
  await expect(layer.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await layer.getByRole('button', { name: 'Add instrument', exact: true }).click();

  const picker = page.getByRole('menu', { name: 'Add instrument to chart' });
  await expect(picker).toBeVisible();
  await expectInsideViewport(picker, page);
  await expect(picker.locator('.add-menu-scroll')).toHaveCSS('overflow-y', 'auto');
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

test('iPad rotation keeps an edge-mounted instrument inside the chart and restores it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto('/');
  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="sog"]`);
  const [source, target] = await Promise.all([frame.boundingBox(), layer.boundingBox()]);
  if (!source || !target) throw new Error('Instrument or chart target missing.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 2, target.y + target.height - 2, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.setViewportSize({ width: 834, height: 1194 });
  await expectInsideViewport(frame, page);
  const [portraitFrame, portraitLayer] = await Promise.all([
    frame.boundingBox(),
    layer.boundingBox(),
  ]);
  if (!portraitFrame || !portraitLayer) throw new Error('Instrument or chart target missing.');
  expect(portraitFrame.x + portraitFrame.width).toBeCloseTo(
    portraitLayer.x + portraitLayer.width,
    0,
  );
  expect(portraitFrame.y + portraitFrame.height).toBeCloseTo(
    portraitLayer.y + portraitLayer.height,
    0,
  );

  await page.setViewportSize({ width: 1194, height: 834 });
  await expectInsideViewport(frame, page);
});

test('touch drag from the instrument body keeps the edit toolbar reachable', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'ipad-chromium-touch',
    "This scenario uses CDP's genuine touch input on the iPad-sized Chromium project.",
  );
  await page.goto('/');
  await runScreenEditCommand(page);

  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="sog"]`);
  const layer = page.locator('.instrument-screen-layer');
  const [source, destination] = await Promise.all([frame.boundingBox(), layer.boundingBox()]);
  if (!source || !destination) throw new Error('Instrument or chart target missing.');
  const session = await page.context().newCDPSession(page);
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const end = {
    x: destination.x + destination.width * 0.7,
    y: destination.y + destination.height * 0.45,
  };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
  await expect(frame).toHaveClass(/floating-frame--dragging/);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(frame).not.toHaveClass(/floating-frame--dragging/);
  await expectInsideViewport(page.getByRole('button', { name: 'Done', exact: true }), page);
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
