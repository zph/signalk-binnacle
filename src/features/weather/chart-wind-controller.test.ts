import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChartWindController, paddedWindBounds } from './chart-wind-controller.svelte';

const bbox = { west: -123, south: 37, east: -122, north: 38 };

function setup(visible = true, store: unknown = {}) {
  let shown = visible;
  let marine = false;
  let source: 'automatic' | 'dwd' = 'automatic';
  let bounds = bbox;
  const load = vi.fn().mockResolvedValue(undefined);
  const controller = createChartWindController({
    store: store as never,
    loader: { load } as never,
    getBounds: () => bounds,
    getSource: () => source,
    isVisible: () => shown,
    wantsMarine: () => marine,
  });
  return {
    controller,
    load,
    setSource(next: 'automatic' | 'dwd') {
      source = next;
    },
    setBounds(next: typeof bbox) {
      bounds = next;
    },
    setMarine(next: boolean) {
      marine = next;
    },
    setVisible(next: boolean) {
      shown = next;
      controller.visibilityChanged(next);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createChartWindController', () => {
  it('debounces viewport loads and requests a padded ten-day wind-only field', () => {
    const { controller, load } = setup();
    controller.schedule();
    controller.schedule();
    vi.advanceTimersByTime(400);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(
      expect.anything(),
      { west: -123.5, south: 36.5, east: -121.5, north: 38.5 },
      {
        maxCells: 120,
        forecastDays: 10,
        source: 'automatic',
        atmosphericFields: 'chart',
      },
      { waves: false, radar: false },
      false,
    );
  });

  it('requests the marine grid when the current overlay is active', () => {
    const { controller, load, setMarine } = setup();
    setMarine(true);
    controller.load();

    expect(load).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ forecastDays: 10 }),
      { waves: true, radar: false },
      false,
    );
  });

  it('loads after enabling and stops a queued load after disabling', () => {
    const { controller, load, setVisible } = setup(false);
    controller.schedule();
    vi.advanceTimersByTime(400);
    expect(load).not.toHaveBeenCalled();

    setVisible(true);
    setVisible(false);
    vi.advanceTimersByTime(400);
    expect(load).not.toHaveBeenCalled();
  });

  it('refetches the active overlay when its model source changes', () => {
    const { controller, load, setSource } = setup();
    setSource('dwd');
    controller.sourceChanged('dwd');
    vi.advanceTimersByTime(400);

    expect(load).toHaveBeenCalledWith(
      expect.anything(),
      { west: -123.5, south: 36.5, east: -121.5, north: 38.5 },
      expect.objectContaining({ source: 'dwd' }),
      expect.anything(),
      false,
    );
  });

  it('lets Retry bypass the loader cooldown', () => {
    const { controller, load } = setup();
    controller.load(true);
    expect(load).toHaveBeenCalledWith(
      expect.anything(),
      { west: -123.5, south: 36.5, east: -121.5, north: 38.5 },
      expect.anything(),
      expect.anything(),
      true,
    );
  });

  it('reuses padded forecast coverage until the visible viewport leaves it', () => {
    const store = {
      grid: {
        lons: [-123.5, -121.5],
        lats: [36.5, 38.5],
        fetchedAt: Date.now(),
        forecastSource: 'automatic',
      },
    };
    const { controller, load, setBounds } = setup(true, store);
    controller.schedule();
    vi.advanceTimersByTime(400);
    expect(load).not.toHaveBeenCalled();

    setBounds({ west: -120, south: 37, east: -119, north: 38 });
    controller.schedule();
    vi.advanceTimersByTime(400);
    expect(load).toHaveBeenCalledOnce();
  });
});

describe('paddedWindBounds', () => {
  it('prefetches one half-viewport on every side and clamps the poles', () => {
    expect(paddedWindBounds(bbox)).toEqual({
      west: -123.5,
      south: 36.5,
      east: -121.5,
      north: 38.5,
    });
    expect(paddedWindBounds({ west: 1, south: -89, east: 2, north: 90 })).toEqual({
      west: 0.5,
      south: -90,
      east: 2.5,
      north: 90,
    });
  });
});
