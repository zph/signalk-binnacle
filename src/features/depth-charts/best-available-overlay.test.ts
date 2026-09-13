import { describe, expect, it } from 'vitest';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import {
  BEST_AVAILABLE_BATHYMETRY_ID,
  createBestAvailableBathymetryOverlay,
} from './best-available-overlay';
import { STREAMING_CHART_SOURCES } from './streaming-sources';

const PROVIDER_IDS = ['depth-gebco', 'depth-emodnet', 'depth-bluetopo'] as const;

describe('best available bathymetry overlay', () => {
  it('stacks the regional depth products over the global fallback as one hidden layer', () => {
    const overlay = createBestAvailableBathymetryOverlay(STREAMING_CHART_SOURCES);

    expect(overlay).toMatchObject({
      id: BEST_AVAILABLE_BATHYMETRY_ID,
      title: 'Best available bathymetry',
      band: 'bathymetry',
      region: 'Global',
      supportsOpacity: true,
      defaultVisible: false,
    });
    expect(overlay.layerIds).toEqual(
      PROVIDER_IDS.map((id) => `streaming-${BEST_AVAILABLE_BATHYMETRY_ID}-${id}-layer`),
    );
  });

  it('retains each catalog source URL, zoom range, and bounds for normal caching', async () => {
    const map = createFakeMap();
    const overlay = createBestAvailableBathymetryOverlay(STREAMING_CHART_SOURCES);
    await overlay.add(fakeOverlayContext(map));

    for (const id of PROVIDER_IDS) {
      const original = STREAMING_CHART_SOURCES.find((source) => source.id === id);
      const declared = map.declaredSources.get(`streaming-${BEST_AVAILABLE_BATHYMETRY_ID}-${id}`);
      expect(original).toBeDefined();
      const expected = {
        tiles: original?.tiles,
        tileSize: original?.tileSize,
        minzoom: original?.minzoom,
        maxzoom: original?.maxzoom,
        ...(original?.bounds ? { bounds: original.bounds } : {}),
      };
      expect(declared).toMatchObject(expected);
    }
  });

  it('controls and removes all three provider layers together', async () => {
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    const overlay = createBestAvailableBathymetryOverlay(STREAMING_CHART_SOURCES);
    await overlay.add(ctx);

    overlay.setVisible(ctx, false);
    overlay.setOpacity?.(ctx, 0.6);

    for (const layerId of overlay.layerIds) {
      expect(map.setLayoutProperty).toHaveBeenCalledWith(layerId, 'visibility', 'none');
      expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, 'raster-opacity', 0.6);
    }

    overlay.remove(ctx);
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('fails visibly if a required catalog-backed provider disappears', () => {
    expect(() =>
      createBestAvailableBathymetryOverlay(
        STREAMING_CHART_SOURCES.filter((source) => source.id !== 'depth-emodnet'),
      ),
    ).toThrow('Missing best-available bathymetry source depth-emodnet');
  });
});
