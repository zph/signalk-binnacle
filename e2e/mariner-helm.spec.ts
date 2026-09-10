import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  chooseInstrumentPaneAction,
  FIXTURE_SERVER,
  openMenuItem,
  stubVesselsSelf,
} from './helpers';
import { inspectInstrument } from './instrument-helpers';

// The mariner helm scenarios: emergency reachability, alarm pileups, and staleness honesty under
// phone-sized, landscape, large-text, and safe-area conditions. This project runs against the
// Signal K stream fixture (scripts/signalk-fixture-server.mjs), which serves the built app and a
// real /signalk/v1/stream WebSocket, because the app's stream opens inside the Comlink worker
// where Playwright's routeWebSocket cannot reach. REST endpoints stay page.route stubs here,
// matching the rest of the suite.
//
// Radar-health and route-edit scenarios extend this spec in their own cases.

test.use({ serviceWorkers: 'block' });

// A deterministic wall-clock stamp for every fixture delta; freshness derives from receipt time.
const FIXED_TIMESTAMP = '2026-08-10T12:00:00.000Z';
const TARGET_CONTEXT = 'vessels.urn:mrn:imo:mmsi:366123456';

type DeltaValue = { path: string; value: unknown; state?: unknown };

async function fixturePost(page: Page, action: string, body?: unknown): Promise<void> {
  const response = await page.request.post(`${FIXTURE_SERVER}/__fixture__/${action}`, {
    data: body ?? {},
  });
  expect(response.ok()).toBe(true);
}

async function sendDelta(
  page: Page,
  values: DeltaValue[],
  context?: string,
  sourceRef?: string,
): Promise<void> {
  await fixturePost(page, 'delta', {
    ...(context === undefined ? {} : { context }),
    updates: [
      {
        ...(sourceRef === undefined ? {} : { $source: sourceRef }),
        timestamp: FIXED_TIMESTAMP,
        values,
      },
    ],
  });
}

// The exact wire shape signalk-server's meta.timeout enforcement emits per timed-out path:
// $source with no source object, value null, and the out-of-band state container carrying the
// last good value.
function staleValue(path: string, lastValue: unknown): DeltaValue {
  return {
    path,
    value: null,
    state: { timedOut: true, lastValue: { timestamp: FIXED_TIMESTAMP, value: lastValue } },
  };
}

const OWN_FIX: DeltaValue[] = [
  { path: 'navigation.position', value: { latitude: 27.7, longitude: -82.7 } },
  { path: 'navigation.speedOverGround', value: 3 },
  { path: 'navigation.courseOverGroundTrue', value: 0 },
  { path: 'navigation.headingTrue', value: 0 },
];

const OWN_WIND: DeltaValue[] = [
  ...OWN_FIX,
  { path: 'navigation.headingTrue', value: Math.PI / 2 },
  { path: 'environment.wind.angleApparent', value: -Math.PI / 6 },
  { path: 'environment.wind.angleTrueWater', value: Math.PI / 4 },
];

const MOB_ALARM: DeltaValue = {
  path: 'notifications.mob',
  value: {
    state: 'emergency',
    method: ['visual', 'sound'],
    message: 'Man overboard',
    position: { latitude: 27.701, longitude: -82.701 },
  },
};

const ANCHOR_DRAG: DeltaValue[] = [
  { path: 'navigation.anchor.position', value: { latitude: 27.7003, longitude: -82.7 } },
  { path: 'navigation.anchor.maxRadius', value: 30 },
  {
    path: 'notifications.navigation.anchor',
    value: { state: 'emergency', method: ['visual', 'sound'], message: 'Anchor dragging' },
  },
];

const GENERIC_ALARM: DeltaValue = {
  path: 'notifications.engine.overTemperature',
  value: { state: 'alarm', method: ['visual', 'sound'], message: 'Engine over temperature' },
};

// A target 500 meters north running straight at the own vessel: CPA near zero, TCPA near 80
// seconds, inside the escalation floors, so the collision strip grades danger.
const CLOSING_TARGET: DeltaValue[] = [
  { path: 'navigation.position', value: { latitude: 27.7045, longitude: -82.7 } },
  { path: 'navigation.courseOverGroundTrue', value: Math.PI },
  { path: 'navigation.speedOverGround', value: 3 },
  { path: 'name', value: 'Fixture Target' },
];

async function stubRestApis(page: Page): Promise<void> {
  await stubVesselsSelf(page);
  // The weather panel's external providers: failed fetches leave the panel in its error state,
  // which is all the layout scenarios need.
  await page.route(
    /^https?:\/\/(?:[^/]+\.)?(?:open-meteo\.com|rainviewer\.com)(?:[/:?#]|$)/,
    (route) => route.fulfill({ status: 500 }),
  );
}

async function openApp(page: Page): Promise<void> {
  await fixturePost(page, 'reset');
  await stubRestApis(page);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  // Read the fixture's transport state rather than depending on whichever responsive shell surface
  // currently presents connectivity. The browser contract this helper needs is the worker socket
  // being ready to receive the next scripted delta.
  await expect
    .poll(async () => {
      const state = await page.request.get(`${FIXTURE_SERVER}/__fixture__/state`);
      const body = (await state.json()) as { connections: number };
      return body.connections;
    })
    .toBeGreaterThan(0);
}

async function raiseMob(page: Page): Promise<Locator> {
  await sendDelta(page, [...OWN_FIX, MOB_ALARM]);
  const strip = page.getByRole('complementary', { name: 'Man overboard' });
  await expect(strip).toBeVisible();
  return strip;
}

async function openForecast(page: Page): Promise<void> {
  await openMenuItem(page, 'Forecast');
}

async function openSoakMenuItem(page: Page, itemName: string): Promise<void> {
  const launcher = page.locator('#app-menu-launcher');
  if (!(await launcher.isVisible())) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
  }
  const item = launcher.getByRole('button', { name: itemName });
  await expect(item).toBeVisible();
  if (itemName === 'Alarms') {
    // Incoming notification mirrors can replace this row as its count changes. Dispatch the
    // click as soon as the current row resolves instead of waiting for Playwright's stability
    // interval across that intentional replacement.
    await item.evaluate((button: HTMLButtonElement) => button.click());
    return;
  }
  await expect(item).toBeEnabled({ timeout: 15_000 });
  await item.click({ timeout: 15_000 });
}

async function clearSoakAlerts(page: Page): Promise<void> {
  await sendDelta(page, [
    ...OWN_FIX,
    { path: 'environment.depth.belowKeel', value: 12 },
    { path: 'notifications.mob', value: null },
    { path: 'notifications.navigation.anchor', value: null },
    { path: 'notifications.engine.overTemperature', value: null },
  ]);
  await sendDelta(
    page,
    [
      { path: 'navigation.position', value: { latitude: 27.7045, longitude: -82.7 } },
      { path: 'navigation.courseOverGroundTrue', value: 0 },
      { path: 'navigation.speedOverGround', value: 3 },
      { path: 'name', value: 'Fixture Target' },
    ],
    TARGET_CONTEXT,
  );
}

async function exerciseHelmSurfaces(page: Page, cycle: number): Promise<void> {
  await sendDelta(page, [
    ...OWN_FIX,
    { path: 'environment.depth.belowKeel', value: cycle % 2 === 0 ? 1 : 0.4 },
    { path: 'environment.wind.speedApparent', value: 4 + (cycle % 5) },
    { path: 'environment.wind.angleApparent', value: (cycle % 6) * 0.35 },
    { path: 'environment.wind.speedTrue', value: 5 + (cycle % 4) },
    { path: 'environment.wind.angleTrueWater', value: ((cycle + 2) % 6) * 0.4 },
    ...ANCHOR_DRAG,
    GENERIC_ALARM,
    ...(cycle % 3 === 0 ? [MOB_ALARM] : []),
  ]);
  await sendDelta(page, CLOSING_TARGET, TARGET_CONTEXT);

  await openSoakMenuItem(page, 'Instrument dock');
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: /^Speed,.*Expand instrument$/ }).click();
  const expanded = page.getByRole('dialog', { name: 'Speed full-screen instrument' });
  await expect(expanded).toBeVisible();
  await expanded.getByRole('button', { name: /^Speed,.*Collapse instrument$/ }).click();
  await chooseInstrumentPaneAction(page, dock, 'Close instruments');

  await openSoakMenuItem(page, 'Layers and charts');
  const layers = page.getByRole('complementary', { name: 'Layers and charts' });
  await layers.getByRole('button', { name: 'Overlays', exact: true }).click();
  await layers.getByRole('button', { name: 'Charts', exact: true }).click();
  await layers.getByRole('button', { name: 'Close layers and charts' }).click();

  await openSoakMenuItem(page, 'Nearby vessels (AIS)');
  const ais = page.getByRole('complementary', { name: 'Nearby vessels (AIS)' });
  await expect(ais).toContainText('Fixture Target');
  await ais.getByRole('button', { name: 'Close nearby vessels' }).click();

  await openSoakMenuItem(page, 'Alarms');
  const alarms = page.getByRole('complementary', { name: 'Alarms' });
  await expect(alarms).toBeVisible();
  await alarms.getByRole('button', { name: 'Close alarms panel' }).click();

  await openSoakMenuItem(page, 'Forecast');
  const weather = page.getByRole('region', { name: 'Weather' });
  await expect(weather).toBeVisible();
  await weather.getByRole('button', { name: 'Close weather' }).click();

  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas did not lay out during the helm soak');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 12, { steps: 3 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: /^Switch theme/ }).click();

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await clearSoakAlerts(page);
}

// Full visibility for an emergency control: inside the viewport, not cropped by any
// overflow-clipping ancestor, and hit-testable at its center. A bounding-box check alone misses
// the overflow: hidden crop, because a clipped element still reports a box.
async function expectActionReachable(action: Locator): Promise<void> {
  await expect(action).toBeVisible();
  const failure = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const round = (box: DOMRect) =>
      `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)}`;
    if (
      rect.left < 0 ||
      rect.top < 0 ||
      rect.right > viewportWidth ||
      rect.bottom > viewportHeight
    ) {
      return `outside viewport ${viewportWidth}x${viewportHeight}: ${round(rect)}`;
    }
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const overflow = style.overflow + style.overflowX + style.overflowY;
      if (!/(hidden|auto|scroll|clip)/.test(overflow)) continue;
      const box = node.getBoundingClientRect();
      if (
        rect.top < box.top - 0.5 ||
        rect.bottom > box.bottom + 0.5 ||
        rect.left < box.left - 0.5 ||
        rect.right > box.right + 0.5
      ) {
        return `clipped by ${node.className || node.tagName}: ${round(rect)} vs ${round(box)}`;
      }
    }
    const centerHit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    if (!centerHit || !(element.contains(centerHit) || centerHit.contains(element))) {
      return `center hit-test resolves to ${centerHit?.tagName ?? 'nothing'}`;
    }
    return null;
  });
  expect(failure).toBeNull();
}

async function expectMobActionsReachable(strip: Locator): Promise<void> {
  await expectActionReachable(strip.getByRole('button', { name: 'Steer to MOB' }));
  await expectActionReachable(strip.getByRole('button', { name: 'Acknowledge' }));
  await expectActionReachable(strip.getByRole('button', { name: 'Cancel' }));
}

test('stream fixture feeds the worker: subscriptions arrive and deltas render', async ({
  page,
}) => {
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  await expect(page.locator('.status-strip')).toContainText('5.8');
  const state = await page.request.get(`${FIXTURE_SERVER}/__fixture__/state`);
  const body = (await state.json()) as { received: Array<{ subscribe?: unknown }> };
  expect(body.received.some((message) => Array.isArray(message.subscribe))).toBe(true);
});

test('the vessel wind rose stays on the boat and becomes bow-up with a heading-up chart', async ({
  page,
}) => {
  await openApp(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'binnacle-custom:layers',
      JSON.stringify({ 'own-vessel-wind-rose': { visible: true, opacity: 1 } }),
    ),
  );
  await page.reload();
  await sendDelta(page, OWN_WIND);

  const rose = page.locator('.vessel-wind-rose-marker');
  await expect(rose).toBeVisible();
  await expect(rose).toHaveAttribute('data-boat-bearing', '90.00');
  await expect(rose).toHaveAttribute('data-apparent-bearing', '60.00');
  await expect(rose).toHaveAttribute('data-true-bearing', '135.00');
  await expect(rose.locator('.vessel-wind-rose-twa')).toHaveText('TWA S45°');
  await expect(rose.locator('.vessel-wind-rose-twa-side')).toHaveAttribute('font-size', '33');
  await expect(rose.locator('.vessel-wind-rose-twa-digits')).toHaveAttribute('dx', '5.5');

  // Follow centers the geographic marker; two orientation taps select heading-up. The chart then
  // rotates under the instrument, leaving its boat bow at screen-up and both wind arrows at their
  // familiar bow-relative angles.
  const menuButton = page.getByRole('button', { name: /^(?:Menu|Open supermenu)$/ });
  await menuButton.click();
  await page.getByRole('menuitem', { name: 'Navigate', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Follow boat', exact: true }).click();
  await menuButton.click();
  await page.getByRole('menuitem', { name: 'Navigate', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Orientation', exact: true }).click();
  await menuButton.click();
  await page.getByRole('menuitem', { name: 'Navigate', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Orientation', exact: true }).click();

  await expect.poll(() => rose.getAttribute('data-map-bearing').then(Number)).toBeCloseTo(90, 0);
  await expect.poll(() => rose.getAttribute('data-boat-bearing').then(Number)).toBeCloseTo(0, 0);
  await expect(rose).toHaveAttribute('data-apparent-bearing', '330.00');
  await expect(rose).toHaveAttribute('data-true-bearing', '45.00');

  const [roseBox, canvasBox] = await Promise.all([
    rose.boundingBox(),
    page.locator('.maplibregl-canvas').boundingBox(),
  ]);
  expect(roseBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  if (!roseBox || !canvasBox) return;
  const roseOffsetFromCenter = Math.hypot(
    roseBox.x + roseBox.width / 2 - (canvasBox.x + canvasBox.width / 2),
    roseBox.y + roseBox.height / 2 - (canvasBox.y + canvasBox.height / 2),
  );
  // Follow mode's look-ahead is expressed in map coordinates, so its on-screen direction rotates
  // with the map. The wind rose must remain on that same 140 px vessel anchor in every orientation.
  expect(roseOffsetFromCenter).toBeGreaterThan(136);
  expect(roseOffsetFromCenter).toBeLessThan(144);
});

test('fixed alarm button grades active notifications and always opens the alarm nest', async ({
  page,
}) => {
  await fixturePost(page, 'reset');
  await stubRestApis(page);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  const button = page.locator('.alarm-button');
  const center = page.getByRole('button', { name: 'Center on vessel' });
  await expect(button).toBeVisible();
  await expect
    .poll(async () => {
      const state = await page.request.get(`${FIXTURE_SERVER}/__fixture__/state`);
      const body = (await state.json()) as { connections: number };
      return body.connections;
    })
    .toBeGreaterThan(0);
  await expect(button).toHaveAttribute('aria-label', 'Open alarms');
  await expect
    .poll(async () => {
      const [alarmBox, centerBox] = await Promise.all([button.boundingBox(), center.boundingBox()]);
      return alarmBox !== null && centerBox !== null && alarmBox.x > centerBox.x;
    })
    .toBe(true);

  await sendDelta(page, [
    {
      path: 'notifications.environment.wind',
      value: { state: 'alert', method: ['visual'], message: 'High wind' },
    },
  ]);
  await expect(button).toHaveClass(/alarm-button--alert/);
  await expect
    .poll(() => button.evaluate((element) => getComputedStyle(element).animationName))
    .toContain('alarm-button-pulse');

  await sendDelta(page, [GENERIC_ALARM]);
  await expect(button).toHaveClass(/alarm-button--alarm/);
  await button.click();
  const panel = page.getByRole('complementary', { name: 'Alarms' });
  await expect(panel).toBeVisible();
  await button.click();
  await expect(panel).toBeVisible();
});

test('accelerated helm soak keeps rendering, heap, and mounted UI work bounded', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    const metrics = {
      animationFramesRequested: 0,
      animationFrameCallbacks: 0,
      longTaskCount: 0,
      longTaskMs: 0,
      longestTaskMs: 0,
    };
    Object.assign(window, { __binnacleSoakMetrics: metrics });
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      metrics.animationFramesRequested += 1;
      return requestFrame((time) => {
        metrics.animationFrameCallbacks += 1;
        callback(time);
      });
    };
    try {
      const observer = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          metrics.longTaskCount += 1;
          metrics.longTaskMs += entry.duration;
          metrics.longestTaskMs = Math.max(metrics.longestTaskMs, entry.duration);
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // Chromium normally supports long tasks. The remaining deterministic budgets still apply.
    }
  });
  await openApp(page);

  // Warm every lazy surface once before taking the baseline. The measured cycles then exercise
  // steady-state mounting and teardown rather than counting intentional first-load module caches.
  await exerciseHelmSurfaces(page, 0);
  const session = await page.context().newCDPSession(page);
  await session.send('HeapProfiler.collectGarbage');
  const baseline = await page.evaluate(() => {
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    const metrics = (
      window as unknown as Window & {
        __binnacleSoakMetrics: {
          animationFramesRequested: number;
          animationFrameCallbacks: number;
          longTaskCount: number;
          longTaskMs: number;
          longestTaskMs: number;
        };
      }
    ).__binnacleSoakMetrics;
    metrics.animationFramesRequested = 0;
    metrics.animationFrameCallbacks = 0;
    metrics.longTaskCount = 0;
    metrics.longTaskMs = 0;
    metrics.longestTaskMs = 0;
    return {
      elements: document.querySelectorAll('*').length,
      heap: memory.memory?.usedJSHeapSize,
    };
  });

  // Six measured cycles cover both depth bands, every wind permutation used by the fixture,
  // repeated alarm mounting, and two MOB transitions while staying inside the local gate's
  // one-minute process budget.
  for (let cycle = 1; cycle <= 6; cycle += 1) await exerciseHelmSurfaces(page, cycle);
  await session.send('HeapProfiler.collectGarbage');
  const measured = await page.evaluate(() => {
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return {
      elements: document.querySelectorAll('*').length,
      heap: memory.memory?.usedJSHeapSize,
      metrics: (
        window as unknown as Window & {
          __binnacleSoakMetrics: {
            animationFramesRequested: number;
            animationFrameCallbacks: number;
            longTaskCount: number;
            longTaskMs: number;
            longestTaskMs: number;
          };
        }
      ).__binnacleSoakMetrics,
    };
  });

  expect(measured.elements).toBeLessThanOrEqual(baseline.elements + 30);
  if (baseline.heap !== undefined && measured.heap !== undefined) {
    expect(measured.heap - baseline.heap).toBeLessThan(24 * 1024 * 1024);
  }
  expect(measured.metrics.longestTaskMs).toBeLessThan(750);
  expect(measured.metrics.longTaskMs).toBeLessThan(8_000);

  // Once every panel and alert is closed, a static chart must settle instead of running a
  // display-rate animation loop. AIS projection and store ticks may request a handful of frames.
  const idleStart = measured.metrics.animationFrameCallbacks;
  await page.waitForTimeout(2_000);
  const idleFrames = await page.evaluate(
    (start) =>
      (
        window as unknown as Window & {
          __binnacleSoakMetrics: { animationFrameCallbacks: number };
        }
      ).__binnacleSoakMetrics.animationFrameCallbacks - start,
    idleStart,
  );
  // MapLibre can finish a short deferred repaint burst after the last panel closes. Sixty frames
  // over two seconds still rejects a sustained display-rate loop while allowing that bounded work.
  expect(idleFrames).toBeLessThan(60);
});

test('expanded numeric instruments prioritize the live value at helm distance', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  await openMenuItem(page, 'Instrument dock');
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  const speedTile = dock.getByRole('button', { name: /Speed.*Expand instrument/ });
  const tileValue = speedTile.locator('.num');
  await expect
    .poll(async () =>
      Number.parseFloat(await tileValue.evaluate((node) => getComputedStyle(node).fontSize)),
    )
    .toBeGreaterThan(40);
  await speedTile.click();

  const expanded = page.getByRole('dialog', { name: 'Speed full-screen instrument' });
  const value = expanded.locator('.num');
  await expect(value).toHaveText('5.8');
  await expect
    .poll(async () =>
      Number.parseFloat(await value.evaluate((node) => getComputedStyle(node).fontSize)),
    )
    .toBeGreaterThan(480);
  await expect.poll(async () => (await value.boundingBox())?.width ?? 0).toBeGreaterThan(700);
  await expect
    .poll(async () => await value.evaluate((node) => getComputedStyle(node).fontWeight))
    .toBe('900');
});

test('P0: MOB actions stay reachable with Forecast open at 320x568', async ({ page }) => {
  // SAF-01: the emergency rail must never be displaced by the Forecast panel; it stacks above it
  // at the viewport bottom instead.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  const strip = await raiseMob(page);
  await openForecast(page);
  await expect(strip).toBeVisible();
  await expectMobActionsReachable(strip);
});

test('P0: four hazard families stay reachable through the emergency rail at 320x568', async ({
  page,
}) => {
  // SAF-01: the rail shows the most urgent condition in full, and every other active hazard as a
  // 44-pixel chip that promotes it on tap, so a pileup can never clip a response action.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  await sendDelta(page, CLOSING_TARGET, TARGET_CONTEXT);
  await sendDelta(page, [...ANCHOR_DRAG, MOB_ALARM, GENERIC_ALARM]);

  // MOB outranks everything: its full strip and response actions are on screen.
  const mob = page.getByRole('complementary', { name: 'Man overboard' });
  await expect(mob).toBeVisible();
  await expectMobActionsReachable(mob);

  // Same refresh as below, and for the same reason: the MOB assertions above take longer than the
  // 10-second position-freshness window on a loaded machine, and a stale fix correctly stands the
  // collision assessment down. Without this the chip can vanish between its visibility check and
  // its measurement, which reads as a layout failure rather than the staleness it really is.
  await sendDelta(page, OWN_FIX);
  await sendDelta(page, CLOSING_TARGET, TARGET_CONTEXT);

  // Every other hazard family is visibly represented by a reachable 44-pixel chip.
  const collisionChip = page.getByRole('button', { name: /^Collision danger.*show details$/ });
  const anchorChip = page.getByRole('button', { name: /^Anchor alarm.*show details$/ });
  const alarmsChip = page.getByRole('button', { name: /^Alarms.*show details$/ });
  for (const chip of [collisionChip, anchorChip, alarmsChip]) {
    await expectActionReachable(chip);
    const box = await chip.boundingBox();
    if (!box) throw new Error('chip did not lay out');
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  // A live helm keeps receiving fixes; refresh the geometry so the 10-second freshness windows
  // cannot stand the collision assessment down mid-test, which is correct product behavior.
  await sendDelta(page, OWN_FIX);
  await sendDelta(page, CLOSING_TARGET, TARGET_CONTEXT);

  // Tapping a chip promotes its condition: the collision response actions become reachable, and
  // MOB demotes to a chip without leaving the rail.
  await collisionChip.click();
  const collision = page.getByRole('complementary', { name: 'Collision danger' });
  await expect(collision).toBeVisible();
  await expectActionReachable(collision.getByRole('button', { name: 'Mute' }));
  await expectActionReachable(collision.getByRole('button', { name: 'Acknowledge' }));
  await expectActionReachable(page.getByRole('button', { name: /^Man overboard.*show details$/ }));
});

test('MOB actions stay reachable in landscape 568x320', async ({ page }) => {
  // Held behavior: a lone MOB strip fits the 60dvh cap even at 320 pixels tall. Task 1.1 must not
  // regress it.
  await page.setViewportSize({ width: 568, height: 320 });
  await openApp(page);
  const strip = await raiseMob(page);
  await expectMobActionsReachable(strip);
});

test('numeric drawer tiles fill their faces above bottom-pinned labels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/\/signalk\/v1\/api\/vessels\/self\/electrical\/batteries$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        277: {
          capacity: { stateOfCharge: { value: 1 } },
        },
      }),
    }),
  );
  await openApp(page);
  await sendDelta(page, [
    { path: 'environment.depth.belowKeel', value: 0.46 },
    { path: 'electrical.batteries.277.capacity.stateOfCharge', value: 1 },
  ]);
  await openMenuItem(page, 'Instrument dock');

  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await chooseInstrumentPaneAction(page, dock, 'Customize instruments');
  await dock.getByRole('checkbox', { name: 'State of charge · 277 battery', exact: true }).check();
  await chooseInstrumentPaneAction(page, dock, 'Finish customizing');
  const numericTiles = [
    dock.getByRole('button', { name: /^State of charge · 277 battery, 100 %/ }),
    dock.getByRole('button', { name: /^Depth \(Keel\), 0\.5 m/ }),
  ];
  for (const tile of numericTiles) {
    await expect(tile).toBeVisible();
    const geometry = await tile.evaluate((element) => {
      const tileBox = element.getBoundingClientRect();
      const number = element.querySelector('.num');
      const footer = element.querySelector('.tile-footer');
      if (!number || !footer) throw new Error('Numeric tile layout is incomplete.');
      const numberBox = number.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      return {
        tileWidth: tileBox.width,
        fontSize: Number.parseFloat(getComputedStyle(number).fontSize),
        inlineGap: Math.min(numberBox.x - tileBox.x, tileBox.right - numberBox.right),
        footerGap: tileBox.bottom - footerBox.bottom,
      };
    });
    expect(geometry.footerGap).toBeGreaterThanOrEqual(3);
    expect(geometry.footerGap).toBeLessThanOrEqual(8);
    expect(geometry.fontSize).toBeGreaterThanOrEqual(geometry.tileWidth * 0.43);
    expect(geometry.inlineGap).toBeGreaterThanOrEqual(7);
    expect(geometry.inlineGap).toBeLessThanOrEqual(20);
  }
});

test('vertical TWS and TWA instruments plot rolling live history responsively', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.route(/\/signalk\/v2\/api\/history\/_providers$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ 'signalk-questdb': { isDefault: true } }),
    }),
  );
  await page.route(/\/signalk\/v2\/api\/history\/values/, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('resolution') !== '5') {
      await route.fulfill({ status: 500, body: 'history unavailable' });
      return;
    }
    const requests = (params.get('paths') ?? '')
      .split(',')
      .filter(Boolean)
      .map((request) => {
        const separator = request.lastIndexOf(':');
        return {
          path: separator >= 0 ? request.slice(0, separator) : request,
          method: separator >= 0 ? request.slice(separator + 1) : '',
        };
      });
    const now = Date.now();
    const valueFor = (path: string, method: string, older: boolean): number | null => {
      if (path === 'environment.wind.speedTrue') {
        if (method === 'max') return older ? 4 : 4.4;
        return older ? 3.2 : 3.8;
      }
      if (path === 'environment.wind.angleTrueWater') return older ? -0.9 : -0.75;
      return null;
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        range: {
          from: new Date(now - 600_000).toISOString(),
          to: new Date(now).toISOString(),
        },
        values: requests,
        data: [
          [
            new Date(now - 10_000).toISOString(),
            ...requests.map(({ path, method }) => valueFor(path, method, true)),
          ],
          [
            new Date(now - 5_000).toISOString(),
            ...requests.map(({ path, method }) => valueFor(path, method, false)),
          ],
        ],
      }),
    });
  });
  await openApp(page);
  await sendDelta(page, [
    ...OWN_FIX,
    { path: 'environment.wind.speedTrue', value: 4.2 },
    { path: 'environment.wind.angleTrueWater', value: -0.7 },
  ]);
  await page.getByRole('button', { name: 'Show instruments' }).click();
  await page.getByRole('button', { name: 'Edit instruments' }).click();

  const editor = page.getByRole('group', { name: 'Instrument screen layout editing' });
  await expect(editor).toBeVisible();
  for (const name of ['True wind speed history', 'True wind angle history']) {
    await editor.getByRole('button', { name: 'Add instrument' }).click();
    await page
      .getByRole('menu', { name: 'Add instrument to chart' })
      .getByRole('menuitem', { name, exact: true })
      .click();
  }

  const speedFrame = page.locator('.floating-frame[data-instrument-id="tws-history"]');
  const angleFrame = page.locator('.floating-frame[data-instrument-id="twa-history"]');
  const speed = speedFrame.getByRole('button', { name: /^True wind speed history,/ });
  const angle = angleFrame.getByRole('button', { name: /^True wind angle history,/ });
  await expect(speed).toBeVisible();
  await expect(angle).toBeVisible();
  await expect(speed.locator('.history-scale')).toHaveText(/6\.2\s+7\.4\s+8\.6/);
  await expect(angle.locator('.history-scale')).toHaveText(/P 52\s+P 46\s+P 40/);
  await expect(speed.locator('.history-delta')).toHaveText(/2\.3 Δ/);
  await expect(angle.locator('.history-delta')).toHaveText(/1[01]° Δ/);
  await expect(speed.locator('.history-footer')).toHaveText('TWS');
  await expect(angle.locator('.history-footer')).toHaveText('TWA');
  await expect(speed.locator('.squiggle--maximum')).toBeVisible();
  await expect(angle.locator('.time-axis')).toHaveText(/Now\s+-5m\s+-10m/);
  for (const tile of [speed, angle]) {
    const placement = await tile.locator('.history-delta').evaluate((delta) => {
      const tileBox = delta.parentElement?.getBoundingClientRect();
      const deltaBox = delta.getBoundingClientRect();
      const current = delta.parentElement?.querySelector('.history-readout .num');
      return {
        position: getComputedStyle(delta).position,
        rightGap: tileBox ? tileBox.right - deltaBox.right : Number.POSITIVE_INFINITY,
        topGap: tileBox ? deltaBox.top - tileBox.top : Number.POSITIVE_INFINITY,
        fontSize: Number.parseFloat(getComputedStyle(delta).fontSize),
        currentFontSize: current ? Number.parseFloat(getComputedStyle(current).fontSize) : 0,
      };
    });
    expect(placement.position).toBe('absolute');
    expect(placement.rightGap).toBeGreaterThanOrEqual(0);
    expect(placement.rightGap).toBeLessThanOrEqual(12);
    expect(placement.topGap).toBeGreaterThanOrEqual(0);
    expect(placement.topGap).toBeLessThanOrEqual(12);
    expect(placement.fontSize).toBeLessThan(placement.currentFontSize);
  }
  await expect
    .poll(async () => angle.locator('.squiggle').first().getAttribute('d'))
    .toContain('L');

  await page.waitForTimeout(5_100);
  await sendDelta(page, [
    { path: 'environment.wind.speedTrue', value: 6.1 },
    { path: 'environment.wind.angleTrueWater', value: 0.5 },
  ]);
  await expect
    .poll(async () => speed.locator('.squiggle').first().getAttribute('d'))
    .toContain('L');
  await expect
    .poll(async () => angle.locator('.squiggle').first().getAttribute('d'))
    .toContain('L');

  for (const frame of [speedFrame, angleFrame]) {
    const box = await frame.boundingBox();
    expect(box?.height).toBeGreaterThan(box?.width ?? 0);
  }
  const [speedBox, angleBox] = await Promise.all([
    speedFrame.boundingBox(),
    angleFrame.boundingBox(),
  ]);
  expect(Math.abs((speedBox?.x ?? 0) - (angleBox?.x ?? 0))).toBeGreaterThan(10);

  await editor.getByRole('button', { name: 'Done' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const frame of [speedFrame, angleFrame]) {
    await expect(frame).toBeInViewport();
    const box = await frame.boundingBox();
    expect(box?.width).toBeGreaterThan(90);
    expect(box?.height).toBeGreaterThan(box?.width ?? 0);
  }

  await angle.click();
  await expect(angleFrame).toHaveClass(/floating-frame--expanded/);
  await expect(angleFrame.locator('.history-trace')).toBeInViewport();
});

test('the alarm panel can move a centered alert on a short landscape display', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await openApp(page);
  await sendDelta(page, [GENERIC_ALARM]);
  await page.getByRole('button', { name: 'Open Alarms', exact: true }).click();

  const location = page.getByRole('group', { name: 'Alarm location' });
  await location.getByRole('button', { name: 'Center' }).click();
  await expect(page.locator('.safety-rail')).toHaveAttribute('data-location', 'center');
  await location.getByRole('button', { name: 'Bottom' }).click();
  await expect(page.locator('.safety-rail')).toHaveAttribute('data-location', 'bottom');
});

test('MOB actions stay reachable at 200-percent text', async ({ page }) => {
  // ACCESS-01 gate case, held behavior: rem-based layout doubles with the root font size, so this
  // simulates browser large-text faithfully, and a lone MOB strip stays reachable. Task 1.1 must
  // not regress it.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = '200%';
    });
  });
  await openApp(page);
  const strip = await raiseMob(page);
  await expectMobActionsReachable(strip);
});

test('full-screen Instruments keeps MOB initiation and response reachable', async ({ page }) => {
  // SAF-02: the full-screen dock carries an in-dialog MOB trigger, and an alarm-grade safety
  // event closes the modal outright so the emergency rail returns to the focus and reader path.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  await openMenuItem(page, 'Instrument dock');
  const dialog = page.getByRole('dialog', { name: 'Instruments' });
  await expect(dialog).toBeVisible();

  // The MOB trigger lives inside the modal focus scope, at full touch size.
  const trigger = dialog.getByRole('button', { name: 'Mark man overboard here' });
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  if (!triggerBox) throw new Error('MOB trigger did not lay out');
  expect(triggerBox.height).toBeGreaterThanOrEqual(44);

  // A raised MOB closes the modal, and the rail's response actions become reachable.
  await sendDelta(page, [MOB_ALARM]);
  const strip = page.getByRole('complementary', { name: 'Man overboard' });
  await expect(strip).toBeVisible();
  await expect(dialog).toBeHidden();
  await expectMobActionsReachable(strip);
});

test('safe-area insets keep the safety strips clear of system chrome', async ({ page }) => {
  // Held behavior: the status strip absorbs the bottom safe-area inset, which keeps the chart
  // host and its safety strips above system chrome. Task 1.1 must keep the emergency rail clear
  // too. Skips when this Chromium cannot override safe-area insets.
  await page.setViewportSize({ width: 320, height: 568 });
  // Shipped in recent Chromium for DevTools device emulation; not yet in Playwright's typings.
  const session = (await page.context().newCDPSession(page)) as unknown as {
    send(method: string, params?: object): Promise<unknown>;
  };
  let overrideWorks = false;
  try {
    await session.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, left: 0, right: 0, bottom: 48 },
    });
    overrideWorks = true;
  } catch {
    overrideWorks = false;
  }
  test.skip(!overrideWorks, 'this Chromium does not support Emulation.setSafeAreaInsetsOverride');

  await openApp(page);
  const probe = await page.evaluate(() => {
    const element = document.createElement('div');
    element.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    document.body.append(element);
    const inset = getComputedStyle(element).paddingBottom;
    element.remove();
    return inset;
  });
  test.skip(probe === '0px', 'safe-area override did not reach env()');

  const strip = await raiseMob(page);
  const box = await strip.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('MOB strip did not lay out');
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 48);
});

test('stale GPS stops presenting coordinates as a current position', async ({ page }) => {
  // DATA-01: a retained fix relabels as "Last fix" with its age. The staleness window runs in
  // real time because the worker stamps delta receipt with its own clock, which a page-side fake
  // clock cannot reach.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  // The cluster, not a label-filtered readout: the label itself is what the fix changes.
  const cluster = page.locator('.center-cluster');
  await expect(cluster).toContainText('Vessel');
  await expect(cluster).toContainText('27.7000');

  // No further fixes: the vessel staleness window (10 seconds) elapses in real time.
  await expect(cluster).toContainText(/Last fix/, { timeout: 20_000 });
  await expect(cluster).toContainText(/ago/);
  await expect(cluster).not.toContainText('Vessel');
});

test('a server staleness declaration relabels the fix and names the quiet source', async ({
  page,
}) => {
  // Server-declared staleness is push-based, so unlike the client-window cases above nothing here
  // waits out a timeout: the declaration lands and the surfaces react at once.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await sendDelta(page, OWN_FIX);
  const cluster = page.locator('.center-cluster');
  await expect(cluster).toContainText('Vessel');

  await sendDelta(
    page,
    [
      staleValue('navigation.position', { latitude: 27.7, longitude: -82.7 }),
      staleValue('navigation.speedOverGround', 3),
    ],
    undefined,
    'gps0.GP',
  );
  // The strip relabels immediately: the retained fix presents as Last fix with an age, never as a
  // current position.
  await expect(cluster).toContainText(/Last fix/, { timeout: 5_000 });
  await expect(cluster).not.toContainText('Vessel');

  // The instrument detail names the declaration and the source that went quiet, not "Unknown".
  await openMenuItem(page, 'Instrument dock');
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  await inspectInstrument(dock.getByRole('button', { name: /^Speed,.*Expand instrument$/ }));
  await expect(dock).toContainText('The Signal K server reports this sensor stopped updating.');
  await expect(dock).toContainText('No update from gps0.GP.');
});

test('stale wind angle is not presented as live beside fresh speed', async ({ page }) => {
  // DATA-02: the wind angle grades on its own epoch, so a retained angle beside fresh speed reads
  // "angle stale" and drops the needle. Real waits for the same reason as the stale-GPS case.
  await page.setViewportSize({ width: 1024, height: 768 });
  await openApp(page);
  await sendDelta(page, [
    ...OWN_FIX,
    { path: 'environment.wind.speedApparent', value: 6 },
    { path: 'environment.wind.angleApparent', value: 0.8 },
  ]);
  await openMenuItem(page, 'Instrument dock');
  const dock = page.getByRole('complementary', { name: 'Instruments' });
  const tile = dock.getByRole('button', { name: /wind/i }).first();
  await expect(tile).toBeVisible();

  // Fresh speed keeps arriving while the angle stops, until the angle cell passes its window.
  for (let tick = 0; tick < 7; tick += 1) {
    await page.waitForTimeout(2_000);
    await sendDelta(page, [{ path: 'environment.wind.speedApparent', value: 6 + tick * 0.1 }]);
  }
  await expect(tile).toHaveAttribute('aria-label', /angle (stale|unavailable)/i);
});

test('route editing stays visible with its exit actions when its panel is replaced', async ({
  page,
}) => {
  // NAV-01: the persistent route-edit strip keeps the mode, count, and exit actions visible even
  // after another panel replaces the Routes panel, so editing can never continue invisibly.
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await openMenuItem(page, 'Routes');
  await page.getByRole('button', { name: 'New route' }).click();
  const strip = page.getByRole('complementary', { name: 'Route editing' });
  await expect(strip).toBeVisible();

  await openMenuItem(page, 'Waypoints');
  await expect(strip).toBeVisible();
  await expectActionReachable(strip.getByRole('button', { name: 'Open editor' }));
  const cancel = strip.getByRole('button', { name: 'Cancel' });
  await expectActionReachable(cancel);

  // The armed cancel ends the edit and the mode strip leaves with it.
  await cancel.click();
  await strip.getByRole('button', { name: 'Confirm cancel?' }).click();
  await expect(strip).toBeHidden();
});

test('the first-run orientation is offered once, opens Help, and never nags again', async ({
  page,
}) => {
  // HELP-01: a compact banner (never a forced panel) invites the safety orientation after the
  // shell is usable; the Help panel carries the advisory boundary, the chart distinction, and the
  // glossary; dismissal persists on the device.
  await page.setViewportSize({ width: 360, height: 800 });
  await openApp(page);
  const banner = page.getByText('First time with Binnacle?');
  await expect(banner).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Open Help' }).click();
  const help = page.getByRole('complementary', { name: 'Help and helm setup' });
  await expect(help).toBeVisible();
  await expect(help.getByText('advisory chartplotter', { exact: false })).toBeVisible();
  await expect(help.getByText('not a navigation chart', { exact: false })).toBeVisible();
  await expect(help.getByText('Closest point of approach', { exact: false }).first()).toBeVisible();

  await help.getByRole('button', { name: 'Got it, do not show this again' }).click();
  await help.getByRole('button', { name: 'Close help' }).click();
  await expect(banner).toBeHidden();

  // Dismissal persists on the device across a reload.
  await page.reload();
  await expect(page.locator('.status-strip .conn')).toHaveAttribute('title', /Connected/, {
    timeout: 20_000,
  });
  await expect(page.getByText('First time with Binnacle?')).toBeHidden();
});

test('emergency layout passes axe and the MOB actions are keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  const strip = await raiseMob(page);

  const steer = strip.getByRole('button', { name: 'Steer to MOB' });
  let reached = false;
  for (let presses = 0; presses < 60; presses += 1) {
    await page.keyboard.press('Tab');
    if (await steer.evaluate((element) => element === document.activeElement)) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
});

test('orientation falls back to north on a stale reference and survives a manual pan', async ({
  page,
}) => {
  await openApp(page);
  await sendDelta(page, OWN_FIX);

  // The orientation tile cycles north to course to heading; the menu closes on each select.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: /Orientation North up/ }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: /Orientation Course up/ }).click();

  const chip = page.locator('.status-strip .orientation-chip');
  await sendDelta(page, OWN_FIX);
  await expect(chip).toContainText('Heading up (true)');

  // The reference stops arriving: the vessel staleness window elapses and the chart states its
  // immediate fallback to north rather than holding a dead rotation.
  await expect(chip).toContainText('North up (true heading stale)', { timeout: 20_000 });

  // A manual pan releases Follow elsewhere but must not corrupt the orientation state.
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas did not lay out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(chip).toContainText('North up (true heading stale)');

  // One tap returns to north-up, and the chip retires with the mode.
  await chip.getByRole('button', { name: 'N up' }).click();
  await expect(chip).toHaveCount(0);
});

test('watch handoff keeps an offline snapshot on the device and says so', async ({ page }) => {
  await openApp(page);
  await sendDelta(page, OWN_FIX);

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Watch handoff' }).click();
  const panel = page.getByRole('complementary', { name: 'Watch handoff' });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText('It is never a statement that it is safe to take watch.'),
  ).toBeVisible();

  // The fixture server has no applicationData store, so the snapshot stays on this device.
  await panel
    .getByPlaceholder('Sea state, traffic, engine, anything to watch')
    .fill('Wind building.');
  await panel.getByRole('button', { name: 'Take handoff snapshot' }).click();
  await expect(panel.getByText('Wind building.')).toBeVisible();
  await expect(panel.getByText('On this device only')).toBeVisible();
  await expect(panel.getByText('GPS fix', { exact: true })).toBeVisible();
});
