import { expect, test } from '@playwright/test';
import { chooseInstrumentPaneAction, stubVesselsSelf } from './helpers';

const APP_TITLE = 'Fixture app';
const APP_MARKER = 'Fixture app loaded';

test.beforeEach(async ({ page }) => {
  await stubVesselsSelf(page);
  await page.addInitScript(() => localStorage.clear());
});

test('a configured web view becomes an iframe instrument tile, expandable full screen', async ({
  page,
}) => {
  await page.route('**/fixture-app/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><p id="fixture-app-marker">Fixture app loaded</p></body></html>',
    }),
  );
  await page.goto('/');
  await page.keyboard.press('Control+K');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('customize instruments');
  await palette.getByRole('option', { name: 'Customize instruments Instruments' }).click();

  const customize = page.locator('.customize-list');
  await expect(customize).toBeVisible();

  await page.getByRole('textbox', { name: 'Web view name' }).fill(APP_TITLE);
  await page.getByRole('textbox', { name: 'Web view URL' }).fill('/fixture-app/');
  await page.getByRole('button', { name: 'Add iframe' }).click();

  // Exit customize mode through the pane actions menu, then the dock grid shows the framed app.
  const pane = page.locator('aside.instruments');
  await chooseInstrumentPaneAction(page, pane, 'Finish customizing');
  const frame = page.locator('iframe[title="Fixture app"]');
  await expect(frame).toBeVisible();
  await expect(frame.contentFrame().getByText(APP_MARKER)).toBeVisible();

  const webviewTile = pane.getByRole('region', { name: `${APP_TITLE}, web view` });
  await webviewTile.getByRole('button', { name: 'Expand instrument' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fixture app full-screen instrument' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('iframe[title="Fixture app"]')).toBeVisible();
  await dialog.getByRole('button', { name: `Close ${APP_TITLE}` }).click();
  await expect(dialog).toHaveCount(0);
});

test('allows more than one Binnacle-owned web view', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+K');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('customize instruments');
  await palette.getByRole('option', { name: 'Customize instruments Instruments' }).click();

  await page.getByRole('textbox', { name: 'Web view name' }).fill('Second app');
  await page.getByRole('textbox', { name: 'Web view URL' }).fill('/fixture-app/');
  await page.getByRole('button', { name: 'Add iframe' }).click();
  await expect(page.getByLabel('Web view instruments').getByText('Second app')).toBeVisible();
});
