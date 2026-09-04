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
    fetchMooringsMock.mockResolvedValue({ moorings: [] });
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

  it('does not compare new-view moorings with AIS targets retained from another viewport', async () => {
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
    fetchMooringsMock.mockResolvedValue({
      moorings: [
        {
          id: 'test:new-view',
          name: 'New-view mooring',
          position: { longitude: view.longitude, latitude: view.latitude },
          scaleBand: 'harbour',
          assessment: { status: 'unknown', score: 0, evidence: [] },
        },
      ],
    });
    let targets = [
      {
        id: 'aisstream:111111111',
        name: 'Retained old-view target',
        position: { longitude: 20, latitude: -30 },
        lastReportAtMs: Date.now(),
      },
    ];
    const received: MooringPoint[][] = [];
    const overlay = createMooringsOverlay(
      'http://pi',
      () => undefined,
      { list: () => targets } as unknown as AisTargets,
      {
        destinationAisAvailable: () => true,
        selectedId: () => undefined,
        onMoorings: (moorings) => received.push(moorings),
      },
    );
    const ctx = fakeOverlayContext(map);

    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();

    expect(received.at(-1)?.[0]?.assessment.evidence).toEqual([
      'No current AIS targets were observed in this chart area',
    ]);

    vi.setSystemTime(11_000);
    targets = [
      ...targets,
      {
        id: 'aisstream:222222222',
        name: 'Current-view target',
        position: { longitude: view.longitude + 0.0001, latitude: view.latitude },
        lastReportAtMs: Date.now(),
      },
    ];
    overlay.sync(ctx);

    expect(received.at(-1)?.[0]?.assessment.distanceMeters).toBeLessThan(20);
    expect(received.at(-1)?.[0]?.assessment.evidence[0]).toMatch(
      /^AIS target \d+ m from the charted position:/,
    );
  });

  it('loads moorings at the wider zoom ten view', async () => {
    const map = {
      ...createFakeMap(),
      getZoom: () => 10,
      getBounds: () => ({
        getWest: () => -123.2,
        getSouth: () => 48.5,
        getEast: () => -123.1,
        getNorth: () => 48.6,
      }),
    };
    const ctx = fakeOverlayContext(map);
    const overlay = createMooringsOverlay(
      'http://pi',
      () => undefined,
      { list: () => [] } as unknown as AisTargets,
      { destinationAisAvailable: () => true, selectedId: () => undefined },
    );

    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();

    expect(fetchMooringsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps fetched positions available after zooming out and back in', async () => {
    let zoom = 13;
    const map = {
      ...createFakeMap(),
      getZoom: () => zoom,
      getBounds: () => ({
        getWest: () => -123.2,
        getSouth: () => 48.5,
        getEast: () => -123.1,
        getNorth: () => 48.6,
      }),
    };
    const received: MooringPoint[][] = [];
    fetchMooringsMock.mockResolvedValue({
      moorings: [
        {
          id: 'test:42',
          name: 'Retained mooring',
          position: { longitude: -123.15, latitude: 48.55 },
          scaleBand: 'harbour',
          assessment: { status: 'unknown', score: 0, evidence: [] },
        },
      ],
    });
    const ctx = fakeOverlayContext(map);
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

    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();
    expect(received.at(-1)?.[0]?.name).toBe('Retained mooring');

    zoom = 8;
    overlay.sync(ctx);
    expect(received.at(-1)).toEqual([]);

    zoom = 13;
    overlay.sync(ctx);
    expect(received.at(-1)?.[0]?.name).toBe('Retained mooring');
    expect(fetchMooringsMock).toHaveBeenCalledTimes(1);
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
