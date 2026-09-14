import { expect, test } from '@playwright/test';
import { expectInsideViewport, stubVesselsSelf } from './helpers';

for (const width of [390, 820, 1440]) {
  test(`instrument layouts switch, save, and reload at ${width}px`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await stubVesselsSelf(page);
    await page.goto('/');
    async function command(label: string) {
      await page.keyboard.press('Control+k');
      const palette = page.getByRole('dialog', { name: 'Command palette' });
      await palette.getByRole('searchbox', { name: 'Search commands' }).fill(label);
      await palette.getByRole('option', { name: label }).click();
    }
    await command('Layout: Marina entry');
    const selector = page.getByRole('group', { name: 'Instrument layout selector', exact: true });
    await expect(selector).toContainText('Marina entry');
    await expectInsideViewport(selector, page);
    const header = page.locator('.instrument-profile-header');
    const firstInstrument = page.locator('.floating-frame').first();
    const headerBox = await header.boundingBox();
    const instrumentBox = await firstInstrument.boundingBox();
    if (!headerBox || !instrumentBox) throw new Error('Instrument header is missing');
    expect(Math.abs(headerBox.y - instrumentBox.y)).toBeLessThan(2);
    await page.mouse.move(width - 1, 1);
    await expect(selector).toHaveCSS('opacity', '0');
    if (width === 1440 && browserName === 'chromium') {
      await page.screenshot({ path: test.info().outputPath('profiles-idle.png') });
    }
    const canHover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
    if (canHover) await firstInstrument.hover();
    else await selector.getByRole('button', { name: 'Next instrument layout' }).focus();
    await expect(selector).toHaveCSS('opacity', '1');
    await expect
      .poll(() =>
        selector.getByRole('button', { name: 'Next instrument layout' }).evaluate((button) => {
          const box = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
      )
      .toBe(true);
    if (width === 1440 && browserName === 'chromium') {
      await page.screenshot({ path: test.info().outputPath('profiles-hover.png') });
    }
    await expect(page.locator('.floating-frame[data-instrument-id="depth"]')).toBeVisible();
    if (browserName === 'chromium') {
      const touch = await page.context().newCDPSession(page);
      const depthBox = await page
        .locator('.floating-frame[data-instrument-id="depth"]')
        .boundingBox();
      if (!depthBox) throw new Error('Depth instrument is missing');
      const x = Math.min(depthBox.x + depthBox.width - 10, width - 40);
      const y = depthBox.y + depthBox.height / 2;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - 30, y }],
      });
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - 85, y }],
      });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(selector).toContainText('Leisure sailing');
      await expect(page.locator('.floating-frame--expanded')).toHaveCount(0);
      await selector.getByRole('button', { name: 'Previous instrument layout' }).click();
      await expect(selector).toContainText('Marina entry');
    }
    await selector.getByRole('button', { name: 'Next instrument layout' }).click();
    await expect(selector).toContainText('Leisure sailing');
    await page.keyboard.press('Meta+ArrowRight');
    await expect(selector).toContainText('Sailing performance');
    await command('Edit screen instruments');
    await expect(selector.getByRole('button', { name: 'Next instrument layout' })).toBeDisabled();
    await page.keyboard.press('Meta+ArrowRight');
    await expect(selector).toContainText('Sailing performance');
    await page
      .locator('.instrument-screen-layer')
      .getByRole('button', { name: 'Done', exact: true })
      .click();
    await expect(
      page.locator('.floating-frame[data-instrument-id="polar-performance"]'),
    ).toBeVisible();
    await selector.getByRole('button', { name: 'Sailing performance' }).click();
    const menu = page.getByRole('dialog', { name: 'Instrument layouts', exact: true });
    await expectInsideViewport(menu, page);
    await page.screenshot({ path: test.info().outputPath('layout-selector.png') });
    await menu.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await page.getByRole('textbox').fill('Offshore');
    await page.keyboard.press('Meta+ArrowLeft');
    await expect(selector).toContainText('Sailing performance');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(selector).toContainText('Offshore');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(selector).toContainText('Offshore');
    if (canHover) await page.locator('.floating-frame').first().hover();
    else await selector.getByRole('button', { name: 'Previous instrument layout' }).focus();
    await selector.getByRole('button', { name: 'Previous instrument layout' }).click();
    await expect(selector).toContainText('Sailing performance');
  });
}
