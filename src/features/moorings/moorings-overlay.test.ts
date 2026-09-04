import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AisTargets } from '$entities/ais';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { fetchMoorings } from './moorings-client';
import { createMooringsOverlay } from './moorings-overlay';

vi.mock('./moorings-client', () => ({
  fetchMoorings: vi.fn(),
}));

const fetchMooringsMock = vi.mocked(fetchMoorings);

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('moorings viewport loading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    fetchMooringsMock.mockReset();
    fetchMooringsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses shared AIS targets without requesting a competing destination viewport', async () => {
    const view = { longitude: -71.32, latitude: 41.49 };
    const map = {
      ...createFakeMap(),
      getZoom: () => 13,
      getBounds: () => ({
        getWest: () => view.longitude - 0.01,
        getSouth: () => view.latitude - 0.01,
        getEast: () => view.longitude + 0.01,
        getNorth: () => view.latitude + 0.01,
      }),
    };
    const ctx = fakeOverlayContext(map);
    const overlay = createMooringsOverlay(
      'http://pi',
      () => undefined,
      {
        list: () => [
          {
            id: 'aisstream:111111111',
            name: 'Target 111111111',
            position: { longitude: view.longitude, latitude: view.latitude },
            lastReportAtMs: Date.now(),
          },
        ],
      } as unknown as AisTargets,
      {
        destinationAisAvailable: () => true,
        selectedId: () => undefined,
      },
    );
    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();
    expect(fetchMooringsMock).toHaveBeenCalledTimes(1);
    expect(map.getSource('binnacle-moorings-destination-ais-source')).toBeUndefined();
    expect(map.getLayer('binnacle-moorings-destination-ais')).toBeUndefined();
    expect(map.getLayer('binnacle-moorings-destination-ais-labels')).toBeUndefined();
  });

  it('backs off after a failed request and retries immediately for a changed viewport', async () => {
    const view = { longitude: -71.32, latitude: 41.49 };
    const map = {
      ...createFakeMap(),
      getZoom: () => 13,
      getBounds: () => ({
        getWest: () => view.longitude - 0.01,
        getSouth: () => view.latitude - 0.01,
        getEast: () => view.longitude + 0.01,
        getNorth: () => view.latitude + 0.01,
      }),
    };
    const ctx = fakeOverlayContext(map);
    const overlay = createMooringsOverlay(
      'http://pi',
      () => undefined,
      { list: () => [] } as unknown as AisTargets,
      { destinationAisAvailable: () => true, selectedId: () => undefined },
    );
    fetchMooringsMock.mockResolvedValue(undefined);
    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();
    expect(fetchMooringsMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(19_999);
    overlay.sync(ctx);
    expect(fetchMooringsMock).toHaveBeenCalledTimes(1);

    view.longitude = -70.32;
    overlay.sync(ctx);
    await settle();
    expect(fetchMooringsMock).toHaveBeenCalledTimes(2);
  });
});
