import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AisTargets } from '$entities/ais';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { fetchMoorings } from './moorings-client';
import { createMooringsOverlay } from './moorings-overlay';
import type { MooringPoint } from './moorings-types';

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

  it('uses MORFAC objects from a loaded local vector chart before NOAA', async () => {
    const map = {
      ...createFakeMap(),
      getZoom: () => 13,
      getBounds: () => ({
        getWest: () => -123.2,
        getSouth: () => 48.5,
        getEast: () => -123.1,
        getNorth: () => 48.6,
      }),
      getStyle: () => ({
        layers: [],
        sources: {
          'chart-local-enc': { type: 'vector' },
          basemap: { type: 'vector' },
        },
      }),
      querySourceFeatures: vi.fn((sourceId: string) =>
        sourceId === 'chart-local-enc'
          ? [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-123.15, 48.55] },
                properties: {
                  RCID: 42,
                  CATMOR: 'mooring buoy',
                  OBJNAM: 'Local mooring',
                  DSNM: 'US5LOCAL.000',
                },
              },
            ]
          : [],
      ),
    };
    const received: MooringPoint[][] = [];
    const overlay = createMooringsOverlay(
      'http://pi',
      () => undefined,
      { list: () => [] } as unknown as AisTargets,
      {
        destinationAisAvailable: () => true,
        selectedId: () => undefined,
        onMoorings: (moorings) => received.push(moorings),
      },
    );

    await overlay.add(fakeOverlayContext(map));
    overlay.sync(fakeOverlayContext(map));

    expect(fetchMooringsMock).not.toHaveBeenCalled();
    expect(received.at(-1)).toEqual([
      expect.objectContaining({ name: 'Local mooring', scaleBand: 'harbour' }),
    ]);
    expect(map.querySourceFeatures).toHaveBeenCalledWith('chart-local-enc', {
      sourceLayer: 'MORFAC',
    });
    expect(map.querySourceFeatures).not.toHaveBeenCalledWith('basemap', expect.anything());
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
