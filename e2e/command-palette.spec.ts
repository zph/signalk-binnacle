import { expect, test } from '@playwright/test';
import { stubVesselsSelf } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubVesselsSelf(page);
  await page.addInitScript(() => localStorage.clear());
});

test('tablet taps outside Command K to close it while helm actions stay usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const helm = page.getByRole('group', { name: 'Helm actions' });
  await expect(palette).toBeVisible();

  await helm.getByRole('button', { name: 'Home' }).click();
  await expect(palette).toBeVisible();

  await page.mouse.click(830, 300);
  await expect(palette).toHaveCount(0);
});

test('Command K searches commands and chains into instrument layouts', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  const search = palette.getByRole('searchbox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await expect(palette.locator('.palette-shortcut')).toHaveText([
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
  ]);
  await expect(
    palette.getByRole('option').filter({ hasText: 'Open the instrument dock' }),
  ).toHaveAttribute('aria-keyshortcuts', /^[1-9]$/);
  await search.fill('center');
  await expect(palette.getByRole('option', { name: /Center on boat/ })).not.toHaveAttribute(
    'aria-keyshortcuts',
  );

  await search.fill('instruments');
  await search.press('1');
  const instrumentSearch = palette.getByRole('searchbox', {
    name: 'Search Instruments commands',
  });
  await expect(instrumentSearch).toBeFocused();
  await expect(palette.getByRole('option', { name: /Full screen/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await instrumentSearch.press('Control+n');
  await expect(palette.getByRole('option', { name: /Half screen/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await instrumentSearch.press('Control+p');
  await expect(palette.getByRole('option', { name: /Full screen/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await instrumentSearch.press('3');

  const dock = page.locator('.binnacle-shell > .instruments');
  await expect(dock).toBeVisible();
  await expect.poll(async () => (await dock.boundingBox())?.width).toBeCloseTo(320, 0);

  await page.keyboard.press('Control+K');
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('instruments');
  await palette.getByRole('searchbox', { name: 'Search commands' }).press('Enter');
  await palette.getByRole('option', { name: /Full screen/ }).click();
  await expect
    .poll(async () => {
      const [box, viewport] = await Promise.all([
        dock.boundingBox(),
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      ]);
      return box?.width === viewport.width && box?.height === viewport.height;
    })
    .toBe(true);
});

test('Go to searches OpenStreetMap and closes after selecting a place', async ({ page }) => {
  await page.route('https://photon.komoot.io/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        features: [
          {
            geometry: { type: 'Point', coordinates: [-122.2566, 38.1041] },
            properties: {
              name: 'Vallejo',
              state: 'California',
              country: 'United States',
            },
          },
        ],
      }),
    }),
  );
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('option', { name: /Go to/ }).click();
  await palette.getByRole('searchbox', { name: 'Search Go to commands' }).fill('Vallejo');
  const result = palette.getByRole('option', { name: /Vallejo.*California.*OpenStreetMap/ });
  await expect(result).toBeVisible();
  await result.click();
  await expect(palette).toHaveCount(0);
});

test('Go to explains the local fallback when online search is unavailable', async ({ page }) => {
  await page.route('https://photon.komoot.io/api/**', (route) => route.fulfill({ status: 503 }));
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('option', { name: /Go to/ }).click();
  await palette
    .getByRole('searchbox', { name: 'Search Go to commands' })
    .fill('No Such Harbor Anywhere');
  await expect(palette.getByRole('option', { name: /No local matches/ })).toContainText(
    'Online place search is unavailable',
  );
});

test('the man overboard command opens the guarded confirmation', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('man overboard');
  await palette.getByRole('option', { name: /Man overboard/ }).click();

  const confirm = page.getByRole('alertdialog', { name: 'Man overboard' });
  await expect(confirm).toBeVisible();
  const cancel = confirm.getByRole('button', { name: /Cancel/ });
  await expect(cancel).toBeFocused();
  await expect(confirm.getByRole('button', { name: 'Mark man overboard' })).toBeVisible();
  await cancel.click();
});

test('the Settings command opens the left app menu', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('settings');
  await palette.getByRole('option').filter({ hasText: 'Open the settings menu' }).click();

  await expect(palette).toHaveCount(0);
  await expect(page.locator('#app-menu-launcher')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('group', { name: 'Settings' })).toBeVisible();
});

test('adjustable surfaces are direct command palette results', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('searchbox', { name: 'Search commands' });
  const cases = [
    ['chart settings', /Layers and charts/],
    ['alarm settings', /Alarms/],
    ['track settings', /Tracks/],
    ['instrument settings', /^Instruments /],
    ['wind rose settings', /Wind rose settings/],
    ['tide station settings', /Tide station settings/],
    ['profile settings', /Profiles/],
  ] as const;

  for (const [query, optionName] of cases) {
    await search.fill(query);
    await expect(palette.getByRole('option', { name: optionName })).toBeVisible();
  }
});

test('Command K enables and disables the trip log', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+K');
  let palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('trip log');
  const command = palette
    .getByRole('option')
    .filter({ hasText: /trip log/i })
    .first();
  const startedEnabled = (await command.innerText()).includes('Disable trip log');
  await command.click();

  await page.keyboard.press('Control+K');
  palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('trip log');
  await expect(
    palette
      .getByRole('option')
      .filter({ hasText: startedEnabled ? 'Enable trip log' : 'Disable trip log' }),
  ).toBeVisible();
});

test('Command K cycles the chart weather forecast overlays', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('searchbox', { name: 'Search commands' });
  await search.fill('weather forecast overlay');
  await palette.getByRole('option', { name: /Cycle weather forecast overlay/ }).click();
  await expect(
    page.getByRole('complementary', { name: 'Wind and gusts forecast overlay' }),
  ).toBeVisible();

  for (const name of ['Temperature forecast overlay', 'UV index forecast overlay']) {
    await page.keyboard.press('Control+K');
    await search.fill('weather forecast overlay');
    await palette.getByRole('option', { name: /Cycle weather forecast overlay/ }).click();
    await expect(page.getByRole('complementary', { name })).toBeVisible();
  }

  await page.keyboard.press('Control+K');
  await search.fill('weather forecast overlay');
  await palette.getByRole('option', { name: /Cycle weather forecast overlay/ }).click();
  await expect(page.getByRole('complementary', { name: /forecast overlay/ })).toHaveCount(0);
});

test('Command K enters and exits browser full screen', async ({ page }) => {
  await page.addInitScript(() => {
    let fullScreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullScreenElement,
    });
    HTMLElement.prototype.requestFullscreen = async function () {
      fullScreenElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    document.exitFullscreen = async () => {
      fullScreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('searchbox', { name: 'Search commands' });
  await search.fill('full screen');
  await palette.getByRole('option', { name: /Enter full screen/ }).click();

  await page.keyboard.press('Control+K');
  await search.fill('full screen');
  await expect(palette.getByRole('option', { name: /Exit full screen/ })).toBeVisible();
  await palette.getByRole('option', { name: /Exit full screen/ }).click();

  await page.keyboard.press('Control+K');
  await search.fill('full screen');
  await expect(palette.getByRole('option', { name: /Enter full screen/ })).toBeVisible();
});

test('opens the tide instrument full screen from the command palette', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('tide instrument');
  await palette.getByRole('option', { name: /^Tide instrument Weather/ }).click();

  const tide = page.getByRole('dialog', { name: 'Tides full-screen instrument' });
  await expect(tide).toBeVisible();
  await tide.getByRole('button', { name: 'Tide station settings' }).click();
  await expect(tide).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Tide station settings' })).toBeVisible();
});

test('the interface lock command changes to unlock while Binnacle is locked', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('searchbox', { name: 'Search commands' });
  await search.fill('lock binnacle');
  await expect(palette.getByRole('option', { name: /Lock Binnacle/ })).toBeVisible();
  await expect(palette.getByText('Unlock Binnacle', { exact: true })).toHaveCount(0);
  await palette.getByRole('option', { name: /Lock Binnacle/ }).click();

  const lockLayer = page.getByRole('dialog', { name: 'Binnacle controls locked' });
  await expect(lockLayer).toBeVisible();

  await page.keyboard.press('Control+K');
  await expect(palette).toBeVisible();
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('lock binnacle');
  await expect(palette.getByRole('option', { name: /Unlock Binnacle/ })).toBeVisible();
  await expect(palette.getByText('Lock Binnacle', { exact: true })).toHaveCount(0);
  await palette.getByRole('option', { name: /Unlock Binnacle/ }).click();

  await expect(lockLayer).toHaveCount(0);
});
