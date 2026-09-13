import { describe, expect, it } from 'vitest';
import { STREAMING_CHART_SOURCES } from '$features/depth-charts';
import { buildBathymetryOverlays } from './build-bathymetry-overlays';

describe('buildBathymetryOverlays', () => {
  it('registers Seascape DEM before, and Seascape vector after, every STREAMING_CHART_SOURCES id', () => {
    const ids = buildBathymetryOverlays({ companionBase: null }).map((overlay) => overlay.id);
    const streamingIds = new Set(STREAMING_CHART_SOURCES.map((source) => source.id));

    const demIndex = {
      depthShading: ids.indexOf('seascape-depth-shading'),
      hillshade: ids.indexOf('seascape-hillshade'),
    };
    const vectorIndex = {
      drying: ids.indexOf('seascape-drying'),
      contours: ids.indexOf('seascape-contours'),
    };
    const streamingIndexes = ids
      .map((id, index) => ({ id, index }))
      .filter(({ id }) => streamingIds.has(id))
      .map(({ index }) => index);

    expect(demIndex.depthShading).toBeGreaterThanOrEqual(0);
    expect(demIndex.hillshade).toBeGreaterThanOrEqual(0);
    expect(vectorIndex.drying).toBeGreaterThanOrEqual(0);
    expect(vectorIndex.contours).toBeGreaterThanOrEqual(0);
    expect(streamingIndexes.length).toBe(STREAMING_CHART_SOURCES.length);

    const lastDemIndex = Math.max(demIndex.depthShading, demIndex.hillshade);
    const firstStreamingIndex = Math.min(...streamingIndexes);
    const lastStreamingIndex = Math.max(...streamingIndexes);
    const firstVectorIndex = Math.min(vectorIndex.drying, vectorIndex.contours);

    expect(lastDemIndex).toBeLessThan(firstStreamingIndex);
    expect(lastStreamingIndex).toBeLessThan(firstVectorIndex);
  });

  it('places best available above the global sources and below regional sources and charts', () => {
    const ids = buildBathymetryOverlays({ companionBase: null }).map((overlay) => overlay.id);
    const best = ids.indexOf('depth-best-available');

    expect(best).toBeGreaterThan(ids.indexOf('depth-gebco-measured'));
    expect(best).toBeLessThan(ids.indexOf('depth-emodnet'));
    expect(best).toBeLessThan(ids.indexOf('depth-bluetopo'));
    expect(best).toBeLessThan(ids.indexOf('depth-noaa-enc'));
  });

  it('keeps best-available provider requests on the companion cache paths', async () => {
    const base = 'http://pi.local/plugins/signalk-chart-locker';
    const overlay = buildBathymetryOverlays({ companionBase: base }).find(
      (candidate) => candidate.id === 'depth-best-available',
    );
    const map = {
      sources: new Map<string, { tiles?: string[] }>(),
      layers: new Map<string, object>(),
      getSource(id: string) {
        return this.sources.get(id);
      },
      addSource(id: string, source: { tiles?: string[] }) {
        this.sources.set(id, source);
      },
      getLayer(id: string) {
        return this.layers.get(id);
      },
      addLayer(layer: { id: string }) {
        this.layers.set(layer.id, layer);
      },
      setLayoutProperty() {},
      setPaintProperty() {},
    };

    expect(overlay).toBeDefined();
    await overlay?.add({ map: map as never, beforeIdFor: () => undefined });
    for (const id of ['depth-gebco', 'depth-emodnet', 'depth-bluetopo']) {
      expect(map.sources.get(`streaming-depth-best-available-${id}`)?.tiles).toEqual([
        `${base}/tile/${id}/{z}/{x}/{y}`,
      ]);
    }
  });
});
