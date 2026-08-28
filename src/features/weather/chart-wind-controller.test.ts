import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChartWindController } from './chart-wind-controller.svelte';

const bbox = { west: -123, south: 37, east: -122, north: 38 };

function setup(visible = true) {
  let shown = visible;
  let source: 'automatic' | 'dwd' = 'automatic';
  const load = vi.fn().mockResolvedValue(undefined);
  const controller = createChartWindController({
    store: {} as never,
    loader: { load } as never,
    getBounds: () => bbox,
    getSource: () => source,
    isVisible: () => shown,
  });
  return {
    controller,
    load,
    setSource(next: 'automatic' | 'dwd') {
      source = next;
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
  it('debounces viewport loads and requests only a five-day atmospheric field', () => {
    const { controller, load } = setup();
    controller.schedule();
    controller.schedule();
    vi.advanceTimersByTime(400);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(
      expect.anything(),
      bbox,
      { maxCells: 200, forecastDays: 5, source: 'automatic' },
      { waves: false, radar: false },
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
      bbox,
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
      bbox,
      expect.anything(),
      expect.anything(),
      true,
    );
  });
});
