import { expect, test } from '@playwright/test';

import { stubVesselsSelf } from './helpers';

const MAP_VIEW_KEY = 'binnacle-custom:map-view';
const MAP_QUALITY_KEY = 'binnacle-custom:map-rendering-quality';
const INITIAL_VIEW = { lat: 38.0666, lon: -122.2132, zoom: 12 };
const SEGMENTS = 12;
const STEPS_PER_SEGMENT = 25;
const STEP_DELAY_MS = 40;

test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 720 } });

for (const quality of ['balanced', 'native'] as const) {
  test(`${quality} rendering follows a sustained pointer drag through every segment`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ initialView, mapViewKey, mapQualityKey, qualityValue }) => {
        localStorage.clear();
        localStorage.setItem('binnacle-custom:help-orientation', 'true');
        localStorage.setItem(mapViewKey, JSON.stringify(initialView));
        localStorage.setItem(mapQualityKey, JSON.stringify(qualityValue));
      },
      {
        initialView: INITIAL_VIEW,
        mapViewKey: MAP_VIEW_KEY,
        mapQualityKey: MAP_QUALITY_KEY,
        qualityValue: quality,
      },
    );
    await stubVesselsSelf(page);
    await page.goto('/');

    const canvas = page.locator('canvas.maplibregl-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('map canvas did not lay out');

    const dimensions = await canvas.evaluate((element) => ({
      cssWidth: element.getBoundingClientRect().width,
      bufferWidth: (element as HTMLCanvasElement).width,
    }));
    const expectedRatio = quality === 'balanced' ? 1.5 : 2;
    expect(dimensions.bufferWidth / dimensions.cssWidth).toBeCloseTo(expectedRatio, 1);

    await page.waitForTimeout(1_000);
    await canvas.evaluate((element) => {
      const mapCanvas = element as HTMLCanvasElement;
      const samples: Array<{ height: number; width: number }> = [];
      new MutationObserver(() =>
        samples.push({ height: mapCanvas.height, width: mapCanvas.width }),
      ).observe(element, { attributeFilter: ['height', 'width'], attributes: true });
      (
        window as typeof window & {
          __mapCanvasResizes?: typeof samples;
        }
      ).__mapCanvasResizes = samples;
    });
    let previousFrame = await canvas.screenshot();
    let x = box.x + box.width * 0.25;
    const y = box.y + box.height * 0.55;
    let heldResizes: Array<{ height: number; width: number }> = [];

    await page.mouse.move(x, y);
    await page.mouse.down();
    try {
      await page.evaluate(() => {
        const samples = (
          window as typeof window & {
            __mapCanvasResizes?: Array<{ height: number; width: number }>;
          }
        ).__mapCanvasResizes;
        if (samples) samples.length = 0;
      });
      for (let segment = 0; segment < SEGMENTS; segment += 1) {
        for (let step = 0; step < STEPS_PER_SEGMENT; step += 1) {
          x += 2;
          await page.mouse.move(x, y);
          await page.waitForTimeout(STEP_DELAY_MS);
        }
        const frame = await canvas.screenshot();
        expect(frame.equals(previousFrame), `map stopped during drag segment ${segment + 1}`).toBe(
          false,
        );
        previousFrame = frame;
      }
      heldResizes = await page.evaluate(
        () =>
          (
            window as typeof window & {
              __mapCanvasResizes?: Array<{ height: number; width: number }>;
            }
          ).__mapCanvasResizes ?? [],
      );
    } finally {
      await page.mouse.up();
    }
    expect(heldResizes).toEqual([]);

    await expect
      .poll(async () => {
        const raw = await page.evaluate((key) => localStorage.getItem(key), MAP_VIEW_KEY);
        if (!raw) return 0;
        const view = JSON.parse(raw) as { lon?: unknown };
        return typeof view.lon === 'number' ? Math.abs(view.lon - INITIAL_VIEW.lon) : 0;
      })
      .toBeGreaterThan(0.08);

    const restingDimensions = await canvas.evaluate((element) => ({
      cssWidth: element.getBoundingClientRect().width,
      bufferWidth: (element as HTMLCanvasElement).width,
    }));
    expect(restingDimensions.bufferWidth / restingDimensions.cssWidth).toBeCloseTo(
      expectedRatio,
      1,
    );
  });
}
