import { expect, type Page, test } from '@playwright/test';
import { expectNoHorizontalOverflow, stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

async function openAlarms(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open alarms', exact: true }).click();
}

test('collision alarm policy survives a hard reload through the active profile', async ({
  page,
}) => {
  await stubVesselsSelf(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('collision-policy-test-initialized')) {
      localStorage.clear();
      sessionStorage.setItem('collision-policy-test-initialized', 'true');
    }
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });

  await page.goto('/');
  await openAlarms(page);
  const policy = page.getByRole('group', { name: 'Collision alarm policy' });
  await expect(policy.getByRole('button', { name: 'Coastal' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await policy.getByRole('button', { name: 'Offshore' }).click();
  await page.getByRole('button', { name: 'Adjust collision alarm sensitivity' }).click();
  const warningTime = page.getByRole('spinbutton', { name: 'Warning time to closest pass' });
  await expect(warningTime).toHaveValue('30');
  await warningTime.fill('33');
  await warningTime.press('Tab');
  await expect(
    page.getByRole('complementary', { name: 'Alarms' }).getByText(/Custom:/),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const device = JSON.parse(
          localStorage.getItem('binnacle-custom:profile-device') ?? '{}',
        ) as { activeId?: string };
        const library = JSON.parse(localStorage.getItem('binnacle-custom:profiles') ?? '{}') as {
          profiles?: Array<{
            id: string;
            settings: { thresholds?: { warningTcpaSeconds?: number } };
          }>;
        };
        return library.profiles?.find(({ id }) => id === device.activeId)?.settings.thresholds
          ?.warningTcpaSeconds;
      }),
    )
    .toBe(1_980);

  await page.getByRole('button', { name: 'Close alarms panel' }).click();
  await page.getByRole('button', { name: 'Profile Coastal day, switch profile' }).click();
  await page.getByRole('menuitem', { name: 'Night passage' }).click();
  await openAlarms(page);
  await page.getByRole('button', { name: 'Adjust collision alarm sensitivity' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Warning time to closest pass' })).toHaveValue(
    '20',
  );
  await page.getByRole('button', { name: 'Close alarms panel' }).click();
  await page.getByRole('button', { name: 'Profile Night passage, switch profile' }).click();
  await page.getByRole('menuitem', { name: 'Coastal day' }).click();
  await openAlarms(page);
  await page.getByRole('button', { name: 'Adjust collision alarm sensitivity' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Warning time to closest pass' })).toHaveValue(
    '33',
  );
  await page.getByRole('button', { name: 'Close alarms panel' }).click();

  await page.reload();
  await openAlarms(page);
  await page.getByRole('button', { name: 'Adjust collision alarm sensitivity' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Warning time to closest pass' })).toHaveValue(
    '33',
  );
  await page.getByRole('spinbutton', { name: 'Warning time to closest pass' }).fill('0');
  await page.getByRole('spinbutton', { name: 'Warning time to closest pass' }).press('Tab');
  await expect(
    page.locator('.group').filter({ hasText: 'Warning' }).getByText('Disabled'),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page.getByRole('complementary', { name: 'Alarms' }));
});

test('alarm location survives cleared browser storage through plugin storage', async ({ page }) => {
  let storedLocation: 'top' | 'center' | 'bottom' = 'bottom';
  let writes = 0;
  await stubVesselsSelf(page);
  await page.route(/\/plugins\/binnacle-custom\/api\/settings\/alarm-location$/, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { location: typeof storedLocation };
      storedLocation = body.location;
      writes += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ location: storedLocation }),
    });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });

  await page.goto('/');
  await openAlarms(page);
  const location = page.getByRole('group', { name: 'Alarm location' });
  await expect(location.getByRole('button', { name: 'Bottom' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await location.getByRole('button', { name: 'Center' }).click();
  await expect(page.locator('.safety-rail')).toHaveAttribute('data-location', 'center');
  await expect.poll(() => writes).toBe(1);

  await page.reload();
  await openAlarms(page);
  await expect(
    page.getByRole('group', { name: 'Alarm location' }).getByRole('button', { name: 'Center' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.safety-rail')).toHaveAttribute('data-location', 'center');
});

test('whole-display alarm silence survives reload and remains easy to clear', async ({ page }) => {
  await stubVesselsSelf(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('alarm-silence-test-initialized')) {
      localStorage.clear();
      sessionStorage.setItem('alarm-silence-test-initialized', 'true');
    }
    localStorage.setItem('binnacle-custom:help-orientation', 'true');
  });

  await page.goto('/');
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('alarm settings');
  await palette.getByRole('option', { name: /Alarms/ }).click();
  const panel = page.getByRole('complementary', { name: 'Alarms' });
  const durations = panel.getByRole('group', { name: 'Silence all alarms for' });
  for (const label of ['1 hour', '6 hours', '12 hours', '24 hours']) {
    await expect(
      durations.getByRole('button', { name: `Silence all alarms for ${label}` }),
    ).toBeVisible();
  }
  await durations.getByRole('button', { name: 'Silence all alarms for 6 hours' }).click();
  await expect(panel).toContainText('Sound returns in');
  await expect(page.getByRole('complementary', { name: 'Alarm sound muted' })).toBeVisible();

  await page.reload();
  const reminder = page.getByRole('complementary', { name: 'Alarm sound muted' });
  await expect(reminder).toContainText('Visual alarms stay active on this display.');
  await reminder.getByRole('button', { name: 'Turn sound on' }).click();
  await expect(reminder).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('binnacle-custom:alarm-silenced-until')))
    .toBe('0');
});
