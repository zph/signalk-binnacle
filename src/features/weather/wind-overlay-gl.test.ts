import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';

const windParticles = vi.hoisted(() => ({
  render: vi.fn(),
  blit: vi.fn(),
  setWind: vi.fn(),
}));

vi.mock('./wind-gl/wind-gl-support', () => ({
  supportsWindGl: () => true,
}));

vi.mock('./wind-gl/wind-particles', () => ({
  WindParticles: class {
    render(...args: unknown[]) {
      windParticles.render(...args);
    }
    blit(...args: unknown[]) {
      windParticles.blit(...args);
    }
    setTheme() {}
    setOpacity() {}
    setWind(field: unknown) {
      windParticles.setWind(field);
    }
    dispose() {}
  },
}));

import { createWindOverlay } from './wind-overlay';

function makeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: vi.fn(),
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
    }),
  } as unknown as HTMLCanvasElement;
}

function storeWithGrid(): WeatherStore {
  const store = new WeatherStore();
  store.setGrid({
    lats: [0, 1],
    lons: [0, 1],
    times: [1000],
    windU: [[-10, -10, -10, -10]],
    windV: [[0, 0, 0, 0]],
  });
  return store;
}

describe('wind overlay WebGL field', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('paces map composites at the particle step rate and cancels the wake-up when hidden', async () => {
    vi.useFakeTimers();
    const documentTarget = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', documentTarget);
    const overlay = createWindOverlay(storeWithGrid(), makeCanvas);
    const map = createFakeMap();
    const canvas = new EventTarget();
    Object.assign(map, {
      getCanvas: () => canvas,
      triggerRepaint: vi.fn(),
    });
    const addLayer = map.addLayer;
    let customLayer:
      | {
          id: string;
          onAdd?: (map: unknown, gl: unknown) => void;
          render?: (gl: unknown, args: unknown) => void;
        }
      | undefined;
    map.addLayer = ((layer: typeof customLayer & { id: string }) => {
      addLayer(layer);
      customLayer = layer;
      layer.onAdd?.(map, {});
    }) as typeof map.addLayer;
    const ctx = fakeOverlayContext(map);

    await overlay.add(ctx);
    overlay.setVisible(ctx, true);
    await vi.runOnlyPendingTimersAsync();
    vi.mocked(map.triggerRepaint).mockClear();
    customLayer?.render?.(
      { drawingBufferWidth: 1280, drawingBufferHeight: 720 },
      { defaultProjectionData: { mainMatrix: new Float64Array(16).fill(1) } },
    );

    await vi.advanceTimersByTimeAsync(39);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);

    vi.mocked(map.triggerRepaint).mockClear();
    customLayer?.render?.(
      { drawingBufferWidth: 1280, drawingBufferHeight: 720 },
      { defaultProjectionData: { mainMatrix: new Float64Array(16).fill(1) } },
    );
    Object.defineProperty(documentTarget, 'hidden', { configurable: true, value: true });
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    overlay.remove(ctx);
  });

  it('stays within the 25 fps composite budget during five accelerated minutes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    const overlay = createWindOverlay(storeWithGrid(), makeCanvas);
    const map = createFakeMap();
    const canvas = new EventTarget();
    const addLayer = map.addLayer;
    let customLayer:
      | {
          id: string;
          onAdd?: (map: unknown, gl: unknown) => void;
          render?: (gl: unknown, args: unknown) => void;
        }
      | undefined;
    const gl = { drawingBufferWidth: 1280, drawingBufferHeight: 720 };
    const args = { defaultProjectionData: { mainMatrix: new Float64Array(16).fill(1) } };
    Object.assign(map, {
      getCanvas: () => canvas,
      triggerRepaint: vi.fn(() => customLayer?.render?.(gl, args)),
    });
    map.addLayer = ((layer: typeof customLayer & { id: string }) => {
      addLayer(layer);
      customLayer = layer;
      layer.onAdd?.(map, {});
    }) as typeof map.addLayer;
    const ctx = fakeOverlayContext(map);

    await overlay.add(ctx);
    overlay.setVisible(ctx, true);
    vi.advanceTimersByTime(5 * 60 * 1000);

    // One immediate frame plus no more than 25 frames for each accelerated second.
    expect(map.triggerRepaint).toHaveBeenCalledTimes(7_501);
    expect(windParticles.render).toHaveBeenCalledTimes(7_501);
    overlay.remove(ctx);
  });

  it('suppresses hidden texture generation and pushes one texture when shown', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    const overlay = createWindOverlay(storeWithGrid(), makeCanvas);
    const map = createFakeMap();
    const canvas = new EventTarget();
    Object.assign(map, {
      getCanvas: () => canvas,
      triggerRepaint: vi.fn(),
    });
    const addLayer = map.addLayer;
    map.addLayer = ((layer: { id: string; onAdd?: (map: unknown, gl: unknown) => void }) => {
      addLayer(layer);
      layer.onAdd?.(map, {});
    }) as typeof map.addLayer;
    const ctx = fakeOverlayContext(map);

    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(windParticles.setWind).not.toHaveBeenCalled();

    overlay.setVisible(ctx, true);
    expect(windParticles.setWind).toHaveBeenCalledTimes(1);
    overlay.sync(ctx);
    expect(windParticles.setWind).toHaveBeenCalledTimes(1);
    overlay.remove(ctx);
  });

  it('passes the default projection matrix to the renderer without early conversion', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    const overlay = createWindOverlay(storeWithGrid(), makeCanvas);
    const map = createFakeMap();
    const canvas = new EventTarget();
    Object.assign(map, {
      getCanvas: () => canvas,
      triggerRepaint: vi.fn(),
    });
    const addLayer = map.addLayer;
    let customLayer:
      | {
          id: string;
          onAdd?: (map: unknown, gl: unknown) => void;
          render?: (gl: unknown, args: unknown) => void;
        }
      | undefined;
    map.addLayer = ((layer: typeof customLayer & { id: string }) => {
      addLayer(layer);
      customLayer = layer;
      layer.onAdd?.(map, {});
    }) as typeof map.addLayer;
    const ctx = fakeOverlayContext(map);

    await overlay.add(ctx);
    overlay.setVisible(ctx, true);

    const matrix = new Float64Array(Array.from({ length: 16 }, (_, index) => index + 0.123456789));
    customLayer?.render?.(
      { drawingBufferWidth: 1280, drawingBufferHeight: 720 },
      {
        defaultProjectionData: { mainMatrix: matrix },
        modelViewProjectionMatrix: new Float64Array(16).fill(99),
      },
    );

    expect(windParticles.render).toHaveBeenCalledWith(matrix, 1280, 720, true);
    overlay.remove(ctx);
  });
});
