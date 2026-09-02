import { expect, type Page, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function drag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  touch: boolean,
): Promise<void> {
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 4; step += 1) {
      const fraction = step / 4;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: start.x + (end.x - start.x) * fraction,
            y: start.y + (end.y - start.y) * fraction,
          },
        ],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    return;
  }
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}

test('helm actions clear bottom overlays and drag away into a full-width swipe target', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  const helm = page.getByRole('group', { name: 'Helm actions' });
  await helm.getByRole('button', { name: /Show wind layer|Weather forecast: off/ }).click();
  const forecast = page.getByRole('complementary', {
    name: /Wind forecast overlay|Wind and gusts forecast overlay/,
  });
  await expect(forecast).toBeVisible();

  const [helmBox, forecastBox] = await Promise.all([helm.boundingBox(), forecast.boundingBox()]);
  if (!helmBox || !forecastBox) throw new Error('Helm actions or wind forecast did not lay out.');
  expect(forecastBox.y + forecastBox.height).toBeLessThanOrEqual(helmBox.y);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('The viewport did not lay out.');
  const centerX = helmBox.x + helmBox.width / 2;
  const startY = helmBox.y + helmBox.height / 2;
  const touch = testInfo.project.name === 'ipad-chromium-touch';
  await drag(
    page,
    { x: centerX, y: startY },
    { x: centerX, y: Math.min(viewport.height - 1, startY + 24) },
    touch,
  );

  await expect(helm).toHaveCount(0);
  const reveal = page.getByRole('button', { name: 'Show helm controls' });
  await expect(reveal).toBeVisible();
  const revealBox = await reveal.boundingBox();
  if (!revealBox) throw new Error('The bottom-edge reveal target did not lay out.');
  expect(revealBox.width).toBe(viewport.width);
  const hiddenForecastBox = await forecast.boundingBox();
  if (!hiddenForecastBox) throw new Error('The wind forecast did not remain laid out.');
  expect(hiddenForecastBox.y + hiddenForecastBox.height).toBeLessThanOrEqual(revealBox.y);

  await drag(
    page,
    { x: revealBox.x + revealBox.width / 2, y: viewport.height - 2 },
    { x: revealBox.x + revealBox.width / 2, y: viewport.height - 42 },
    touch,
  );
  await expect(helm).toBeVisible();
});
