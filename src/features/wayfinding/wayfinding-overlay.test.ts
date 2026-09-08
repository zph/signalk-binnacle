import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { OverlayContext } from '$shared/map';
import { createFakeMap } from '$shared/testing';
import { createWayfindingOverlay, type WayfindingVisualizationSource } from './wayfinding-overlay';

function context() {
  const map = createFakeMap();
  return {
    map,
    ctx: { map: map as unknown as MapLibreMap, beforeIdFor: () => undefined } as OverlayContext,
  };
}

describe('Wayfinding chart overlay', () => {
  it('draws request endpoints and the live search frontier', async () => {
    const source: WayfindingVisualizationSource = {
      previewRoute: {
        id: 'request',
        name: 'Request',
        waypoints: [
          { position: { latitude: 38.1, longitude: -122.3 } },
          { position: { latitude: 38.4, longitude: -122 } },
        ],
      },
      status: {
        state: 'calculating',
        progress: 40,
        frontier: [
          { latitude: 38.2, longitude: -122.2 },
          { latitude: 38.25, longitude: -122.1 },
        ],
      },
      routes: [],
      frontiers: [
        [
          { latitude: 38.15, longitude: -122.25 },
          { latitude: 38.18, longitude: -122.22 },
        ],
      ],
      selectedAlternativeIndex: 0,
    };
    const { map, ctx } = context();
    const overlay = createWayfindingOverlay(source);
    await overlay.add(ctx);
    overlay.sync(ctx);

    const markers = map.sources.get('binnacle-wayfinder-markers')
      ?.data as GeoJSON.FeatureCollection;
    const frontier = map.sources.get('binnacle-wayfinder-frontier')
      ?.data as GeoJSON.FeatureCollection;
    expect(markers.features.map((feature) => feature.properties?.kind)).toEqual([
      'origin',
      'destination',
    ]);
    expect(frontier.features).toHaveLength(3);
  });

  it('draws every result path and marks every waypoint of the selected alternative', async () => {
    const source: WayfindingVisualizationSource = {
      previewRoute: undefined,
      status: { state: 'complete', progress: 100 },
      routes: [
        {
          index: 0,
          points: [
            { latitude: 38.1, longitude: -122.3 },
            { latitude: 38.2, longitude: -122.2 },
            { latitude: 38.4, longitude: -122 },
          ],
        },
        {
          index: 1,
          points: [
            { latitude: 38.1, longitude: -122.3 },
            { latitude: 38.3, longitude: -122.15 },
            { latitude: 38.4, longitude: -122 },
          ],
        },
      ],
      frontiers: [
        [
          { latitude: 38.15, longitude: -122.25 },
          { latitude: 38.18, longitude: -122.22 },
        ],
      ],
      selectedAlternativeIndex: 1,
    };
    const { map, ctx } = context();
    const overlay = createWayfindingOverlay(source);
    await overlay.add(ctx);
    overlay.sync(ctx);

    const paths = map.sources.get('binnacle-wayfinder-paths')?.data as GeoJSON.FeatureCollection;
    const markers = map.sources.get('binnacle-wayfinder-markers')
      ?.data as GeoJSON.FeatureCollection;
    const frontier = map.sources.get('binnacle-wayfinder-frontier')
      ?.data as GeoJSON.FeatureCollection;
    expect(paths.features).toHaveLength(2);
    expect(paths.features.map((feature) => feature.properties?.selected)).toEqual([false, true]);
    expect(markers.features).toHaveLength(3);
    expect(markers.features.map((feature) => feature.properties?.kind)).toEqual([
      'origin',
      'waypoint',
      'destination',
    ]);
    expect(frontier.features).toHaveLength(0);
  });
});
