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

async function expectFloatingInstrumentContentContained(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator(FLOATING_FRAME).evaluateAll((frames) => {
        const selectors = [
          '.tile',
          '.rose-layout',
          '.rose-face',
          '.radar-stage',
          '.compass',
          '.heel',
          '.attitude-readout',
        ].join(',');
        return frames.flatMap((frame) => {
          const frameBox = frame.getBoundingClientRect();
          return [...frame.querySelectorAll<HTMLElement>(selectors)].flatMap((content) => {
            const box = content.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return [];
            const contained =
              box.left >= frameBox.left - 0.5 &&
              box.top >= frameBox.top - 0.5 &&
              box.right <= frameBox.right + 0.5 &&
              box.bottom <= frameBox.bottom + 0.5;
            return contained
              ? []
              : [
                  `${frame.getAttribute('data-instrument-id') ?? 'unknown'} ${content.className}: ` +
                    `${Math.round(box.width)}x${Math.round(box.height)} inside ` +
                    `${Math.round(frameBox.width)}x${Math.round(frameBox.height)}`,
                ];
          });
        });
      }),
    )
    .toEqual([]);
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

  const actions = layer.getByRole('toolbar', { name: 'Instrument editing actions' });
  const [actionsBox, layerBox] = await Promise.all([actions.boundingBox(), layer.boundingBox()]);
  if (!actionsBox || !layerBox) throw new Error('Instrument editing actions did not lay out.');
  expect(actionsBox.x + actionsBox.width / 2).toBeCloseTo(layerBox.x + layerBox.width / 2, 0);
  expect(actionsBox.y + actionsBox.height / 2).toBeCloseTo(layerBox.y + layerBox.height / 2, 0);

  // An empty chart starts with the two useful visual instruments. The ordinary dock defaults do
  // not spill into the chart layout.
  const windRose = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
  const aisRadar = page.locator(`${FLOATING_FRAME}[data-instrument-id="ais-radar"]`);
  await expect(windRose).toBeVisible();
  await expect(aisRadar).toBeVisible();
  await expect(page.locator(`${FLOATING_FRAME}[data-instrument-id="sog"]`)).toHaveCount(0);

  await done.click();
  await expect(layer.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(windRose).toBeVisible();
  await expect(windRose).not.toHaveAttribute('inert', '');

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

test('desktop instrument settings open as a side dock instead of covering the chart', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('Wind rose settings');
  await palette.getByRole('option', { name: 'Wind rose settings' }).click();

  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await expect(dock.getByRole('slider', { name: 'Resize instruments dock' })).toBeVisible();
  await expect(dock).toHaveCSS('position', 'relative');
  const [dockBox, viewportWidth] = await Promise.all([
    dock.boundingBox(),
    page.evaluate(() => document.documentElement.clientWidth),
  ]);
  if (!dockBox) throw new Error('Instrument dock did not lay out.');
  expect(dockBox.width).toBeLessThan(viewportWidth / 2);
  expect(dockBox.x + dockBox.width).toBeCloseTo(viewportWidth, 0);
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

test('screen edit help explains the controls and keeps wind rose settings available', async ({
  page,
}) => {
  await page.goto('/');
  await runScreenEditCommand(page);

  await page.getByRole('button', { name: 'Instrument editing help' }).click();
  const help = page.getByRole('group', { name: 'Instrument editing help' });
  await expect(help).toContainText('Drag an instrument to move it.');
  await expect(help.getByRole('button', { name: 'Wind rose settings' })).toBeVisible();
  await expectInsideViewport(help, page);
});

test('iPad helm keeps double-size MOB and chart controls on one unobscured row', async ({
  page,
}) => {
  await page.goto('/');
  await dismissOrientation(page);

  const helm = page.getByRole('group', { name: 'Helm actions' });
  const mob = helm.getByRole('button', { name: 'Mark man overboard here' });
  const controls = helm.getByRole('button');
  const boxes = await controls.evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  const mobBox = await mob.boundingBox();
  const lockBox = await helm.getByRole('button', { name: 'Lock Binnacle' }).boundingBox();
  if (!mobBox || !lockBox || boxes.length < 2)
    throw new Error('The iPad helm controls did not lay out.');

  expect(lockBox.width).toBeCloseTo(88, 0);
  expect(mobBox.width).toBeCloseTo(88, 0);
  for (const box of boxes) expect(box.y).toBeCloseTo(mobBox.y, 0);
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index - 1].x + boxes[index - 1].width).toBeLessThanOrEqual(boxes[index].x);
  }
});

test('screen edit mode drags an instrument from its face on the chart', async ({ page }) => {
  await page.goto('/');
  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
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

  await expect(frame).toHaveAttribute('data-instrument-id', 'wind-rose');
  const frameBox = await frame.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(frameBox?.x).toBeLessThan(destination.x + destination.width * 0.6);
  await expect(frame).not.toHaveClass(/floating-frame--dragging/);
});

test('screen edit mode lightly snaps movement to its visible grid', async ({ page }) => {
  await page.goto('/');
  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
  const [source, target] = await Promise.all([frame.boundingBox(), layer.boundingBox()]);
  if (!source || !target) throw new Error('Instrument or chart target missing.');
  expect(await layer.evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe(
    'none',
  );

  const desired = { x: 0.243, y: 0.357 };
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    target.x + (desired.x + source.width / target.width / 2) * target.width,
    target.y + (desired.y + source.height / target.height / 2) * target.height,
    { steps: 12 },
  );
  await page.mouse.up();

  const placed = await frame.boundingBox();
  if (!placed) throw new Error('Instrument disappeared after grid placement.');
  expect((placed.x - target.x) / target.width).toBeCloseTo(0.24, 2);
  expect((placed.y - target.y) / target.height).toBeCloseTo(0.36, 2);

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await layer.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe('none');
});

test('iPad rotation keeps an edge-mounted instrument inside the chart and restores it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto('/');
  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
  const [source, target] = await Promise.all([frame.boundingBox(), layer.boundingBox()]);
  if (!source || !target) throw new Error('Instrument or chart target missing.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 2, target.y + target.height - 2, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const [landscapeFrame, landscapeLayer] = await Promise.all([
    frame.boundingBox(),
    layer.boundingBox(),
  ]);
  if (!landscapeFrame || !landscapeLayer) throw new Error('Instrument or chart target missing.');
  const landscapeAspect = landscapeFrame.width / landscapeFrame.height;
  const landscapeCoverage =
    (landscapeFrame.width * landscapeFrame.height) / (landscapeLayer.width * landscapeLayer.height);

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
  expect(portraitFrame.width / portraitFrame.height).toBeCloseTo(landscapeAspect, 1);
  expect(
    (portraitFrame.width * portraitFrame.height) / (portraitLayer.width * portraitLayer.height),
  ).toBeCloseTo(landscapeCoverage, 2);

  await page.setViewportSize({ width: 1194, height: 834 });
  await expectInsideViewport(frame, page);
});

test('phone rotation retains an instrument physical shape and chart coverage', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const [landscapeFrame, landscapeLayer] = await Promise.all([
    frame.boundingBox(),
    layer.boundingBox(),
  ]);
  if (!landscapeFrame || !landscapeLayer) throw new Error('Instrument or chart target missing.');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectInsideViewport(frame, page);
  const [portraitFrame, portraitLayer] = await Promise.all([
    frame.boundingBox(),
    layer.boundingBox(),
  ]);
  if (!portraitFrame || !portraitLayer) throw new Error('Instrument or chart target missing.');

  expect(portraitFrame.width / portraitFrame.height).toBeCloseTo(
    landscapeFrame.width / landscapeFrame.height,
    1,
  );
  expect(
    (portraitFrame.width * portraitFrame.height) / (portraitLayer.width * portraitLayer.height),
  ).toBeCloseTo(
    (landscapeFrame.width * landscapeFrame.height) / (landscapeLayer.width * landscapeLayer.height),
    2,
  );
});

test('iPad portrait-to-landscape rotation redraws a top and bottom instrument without clipping', async ({
  page,
}) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');
  await runScreenEditCommand(page);

  const layer = page.locator('.instrument-screen-layer');
  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
  const [source, target] = await Promise.all([frame.boundingBox(), layer.boundingBox()]);
  if (!source || !target) throw new Error('Instrument or chart target missing.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 2, target.y + 2, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.setViewportSize({ width: 1194, height: 834 });
  await expectInsideViewport(frame, page);
  const [landscapeFrame, landscapeLayer] = await Promise.all([
    frame.boundingBox(),
    layer.boundingBox(),
  ]);
  if (!landscapeFrame || !landscapeLayer) throw new Error('Instrument or chart target missing.');
  expect(landscapeFrame.y).toBeGreaterThanOrEqual(landscapeLayer.y);
  expect(landscapeFrame.y + landscapeFrame.height).toBeLessThanOrEqual(
    landscapeLayer.y + landscapeLayer.height,
  );
});

test('desktop window resizing keeps dense instrument content inside every floating frame', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await runScreenEditCommand(page);

  const windRose = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
  const aisRadar = page.locator(`${FLOATING_FRAME}[data-instrument-id="ais-radar"]`);
  await expect(windRose).toBeVisible();
  await expect(aisRadar).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1000, height: 700 },
    { width: 1600, height: 600 },
    { width: 1200, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await expectFloatingInstrumentContentContained(page);
  }
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

  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
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

  const frame = page.locator(`${FLOATING_FRAME}[data-instrument-id="wind-rose"]`);
  const aisRadar = page.locator(`${FLOATING_FRAME}[data-instrument-id="ais-radar"]`);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-instrument-id', 'wind-rose');
  await expect(frame).not.toHaveAttribute('inert', '');
  await expect(aisRadar).toBeVisible();

  await runScreenEditCommand(page);
  await frame.getByRole('button', { name: 'Remove Wind rose from chart' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(frame).toHaveCount(0);
  // Re-entering edit mode preserves the remaining layout and does not seed the removed starter.
  await runScreenEditCommand(page);
  await expect(frame).toHaveCount(0);
  await expect(aisRadar).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.instrument-screen-slot')).toHaveCount(1);
});
