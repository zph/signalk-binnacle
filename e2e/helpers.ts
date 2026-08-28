import { expect, type Locator, type Page } from '@playwright/test';

// Shared browser-test helpers. A spec's file-local helper is invisible to the other nine specs, so
// each one re-rolled the same stubs and the same menu walk inline; when a menu label or a route
// shape changes, one edit here beats twenty-five.

// The self-vessel document. Binnacle probes it on boot to learn its own context, and every spec
// needs it to answer something rather than hang on a real server that is not running.
export async function stubVesselsSelf(page: Page): Promise<void> {
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

// Open the app menu and activate one of its tiles. Scoped to the launcher, because a menu label
// usually also names a bar pill or a panel heading, and an unscoped match picks whichever the DOM
// happens to hold first.
export async function openMenuItem(page: Page, itemName: string): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: itemName, exact: true })
    .click();
}

// Pane chrome is intentionally absent so every vertical pixel is available to instruments. Open
// its actions from any point in the pane, matching a mariner's right-click interaction.
export async function chooseInstrumentPaneAction(
  page: Page,
  pane: Locator,
  actionName: string | RegExp,
): Promise<void> {
  const box = await pane.boundingBox();
  await pane.click({
    button: 'right',
    position: { x: Math.max(1, (box?.width ?? 24) - 12), y: 12 },
  });
  await page.getByRole('menuitem', { name: actionName }).click();
}

// The stream fixture's port and origins, in one place: playwright.config.ts starts the server
// with this port, the mariner project navigates the app origin, and the spec drives the control
// channel at the server root, so the three cannot desync.
const configuredFixturePort = Number(process.env.SIGNALK_FIXTURE_PORT ?? 4174);
if (
  !Number.isInteger(configuredFixturePort) ||
  configuredFixturePort < 1 ||
  configuredFixturePort > 65_535
) {
  throw new Error('SIGNALK_FIXTURE_PORT must be a valid TCP port.');
}
export const FIXTURE_PORT = configuredFixturePort;
export const FIXTURE_SERVER = `http://127.0.0.1:${FIXTURE_PORT}`;
export const FIXTURE_ORIGIN = `${FIXTURE_SERVER}/binnacle-custom/`;

// Assert an element does not scroll horizontally. The one-pixel tolerance absorbs subpixel
// rounding on fractional layouts, and the poll absorbs a layout that has not settled yet;
// seventeen inline copies of this check drifted on exactly those two points.
export async function expectNoHorizontalOverflow(surface: Locator): Promise<void> {
  await expect
    .poll(() => surface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
}

// Assert a floating surface lies inside the viewport it was measured in. Measures the live document
// rather than restating pixels, so a spec that sets its own viewport cannot leave a stale bound
// asserting against a size the page no longer has. clientWidth and clientHeight, not viewportSize:
// they exclude a scrollbar, which a surface pinned to the trailing edge sits inside of.
export async function expectInsideViewport(surface: Locator, page: Page): Promise<void> {
  await expect(surface).toBeVisible();
  await expect
    .poll(async () => {
      const [box, viewport] = await Promise.all([
        surface.boundingBox(),
        page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        })),
      ]);
      return (
        box !== null &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height
      );
    })
    .toBe(true);
}
