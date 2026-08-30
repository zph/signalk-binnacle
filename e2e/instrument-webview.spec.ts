import { expect, test } from '@playwright/test';
import { chooseInstrumentPaneAction, stubVesselsSelf } from './helpers';

const APP_TITLE = 'Fixture app';
const APP_MARKER = 'Fixture app loaded';

test.beforeEach(async ({ page }) => {
  await stubVesselsSelf(page);
  await page.addInitScript(() => localStorage.clear());
});

async function stubLauncher(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/signalk-app-launcher/api/apps', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        apps: [{ name: 'fixture-app', title: APP_TITLE, url: '/fixture-app/' }],
      }),
    }),
  );
  await page.route('**/signalk-app-launcher/api/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pinned: [], links: [] }),
    }),
  );
}

test('a launcher app becomes a web view instrument tile, expandable full screen', async ({
  page,
}) => {
  await stubLauncher(page);
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
  await palette.getByRole('option', { name: /Customize instruments/ }).click();

  const customize = page.locator('.customize-list');
  await expect(customize).toBeVisible();

  // Enable the web view tile's row in the Apps category.
  await page.getByRole('checkbox', { name: APP_TITLE }).check();

  // Exit customize mode through the pane actions menu, then the dock grid shows the framed app.
  const pane = page.locator('aside.instruments');
  await chooseInstrumentPaneAction(page, pane, 'Customize instruments');
  const frame = page.locator('iframe[title="Fixture app"]');
  await expect(frame).toBeVisible();
  await expect(frame.contentFrame().getByText(APP_MARKER)).toBeVisible();

  await pane.getByRole('button', { name: 'Expand instrument' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fixture app full-screen instrument' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('iframe[title="Fixture app"]')).toBeVisible();
  await dialog.getByRole('button', { name: 'Collapse instrument' }).click();
  await expect(dialog).toHaveCount(0);
});

test('explains an absent App Launcher in Customize', async ({ page }) => {
  await page.route('**/signalk-app-launcher/api/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/');
  await page.keyboard.press('Control+K');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('customize instruments');
  await palette.getByRole('option', { name: /Customize instruments/ }).click();

  await expect(
    page.getByText(
      'Web view instruments need the App Launcher plugin on the server. Other instruments remain available.',
    ),
  ).toBeVisible();
});
