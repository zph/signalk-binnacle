import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AisTargets } from '$entities/ais';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import { fetchDestinationAis, fetchMoorings } from './moorings-client';
import { MOORINGS_AIS_SOURCE_ID } from './moorings-layers';
import { createMooringsOverlay } from './moorings-overlay';

vi.mock('./moorings-client', () => ({
  fetchDestinationAis: vi.fn(),
  fetchMoorings: vi.fn(),
}));

const fetchDestinationAisMock = vi.mocked(fetchDestinationAis);
const fetchMooringsMock = vi.mocked(fetchMoorings);

function destinationTarget(id: string, longitude: number, latitude: number) {
  return {
    id: `aisstream:${id}`,
    mmsi: id,
    name: `Target ${id}`,
    position: { longitude, latitude },
    lastReportAtMs: Date.now(),
    source: 'destination' as const,
    history: {
      firstSeenAtMs: Date.now(),
      sampleCount: 1,
      center: { longitude, latitude },
      maxRadiusMeters: 0,
    },
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('moorings destination AIS viewport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    fetchMooringsMock.mockReset();
    fetchMooringsMock.mockResolvedValue([]);
    fetchDestinationAisMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for a settled pan, requests its padded area, and renders returned targets', async () => {
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
      {
        destinationAisAvailable: () => true,
        selectedId: () => undefined,
      },
    );
    fetchDestinationAisMock
      .mockResolvedValueOnce({
        state: 'live',
        targets: [destinationTarget('111111111', view.longitude, view.latitude)],
      })
      .mockResolvedValueOnce({
        state: 'live',
        targets: [destinationTarget('222222222', -70.32, view.latitude)],
      });

    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(fetchDestinationAisMock).not.toHaveBeenCalled();

    vi.setSystemTime(11_500);
    overlay.sync(ctx);
    await settle();
    const firstRequest = fetchDestinationAisMock.mock.calls[0];
    expect(firstRequest?.slice(0, 2)).toEqual(['http://pi', undefined]);
    expect(firstRequest?.[2]).toEqual([
      expect.closeTo(-71.34),
      expect.closeTo(41.47),
      expect.closeTo(-71.3),
      expect.closeTo(41.51),
    ]);
    expect(sourceFeatures(map, MOORINGS_AIS_SOURCE_ID)).toMatchObject([
      {
        geometry: { coordinates: [-71.32, 41.49] },
        properties: { id: 'aisstream:111111111', label: 'Target 111111111' },
      },
    ]);

    view.longitude = -70.32;
    vi.setSystemTime(17_000);
    overlay.sync(ctx);
    expect(fetchDestinationAisMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(18_500);
    overlay.sync(ctx);
    await settle();
    const secondRequest = fetchDestinationAisMock.mock.calls[1];
    expect(secondRequest?.slice(0, 2)).toEqual(['http://pi', undefined]);
    expect(secondRequest?.[2]).toEqual([
      expect.closeTo(-70.34),
      expect.closeTo(41.47),
      expect.closeTo(-70.3),
      expect.closeTo(41.51),
    ]);
    expect(sourceFeatures(map, MOORINGS_AIS_SOURCE_ID)).toMatchObject([
      {
        geometry: { coordinates: [-70.32, 41.49] },
        properties: { id: 'aisstream:222222222', label: 'Target 222222222' },
      },
    ]);
  });
});
