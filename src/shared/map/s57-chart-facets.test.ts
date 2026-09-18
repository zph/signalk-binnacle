import type { LayerSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import {
  S57_FACET_DEFINITIONS,
  s57FacetLayerGroups,
  s57UnsupportedLayers,
} from './s57-chart-facets';
import { S57_SUPPORTED_SOURCE_LAYERS } from './s57-chart-style';

function layer(id: string, sourceLayer: string): LayerSpecification {
  return {
    id,
    type: 'line',
    source: 'enc',
    'source-layer': sourceLayer,
  };
}

describe('s57FacetLayerGroups', () => {
  it('groups every rendered style layer and returns facets in definition order', () => {
    const groups = s57FacetLayerGroups([
      layer('wreck-symbol', 'wrecks'),
      layer('buoy-symbol', 'BOYLAT'),
      layer('depth-safe', 'DEPARE'),
      layer('sounding-safe', 'SOUNDG'),
      layer('depth-shallow', 'DEPARE'),
      layer('contour-safety', 'DEPCNT'),
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        key: 'depth-areas',
        layerIds: ['depth-safe', 'depth-shallow'],
      }),
      expect.objectContaining({
        key: 'soundings-contours',
        layerIds: ['sounding-safe', 'contour-safety'],
      }),
      expect.objectContaining({ key: 'navigation-aids', layerIds: ['buoy-symbol'] }),
      expect.objectContaining({ key: 'hazards', layerIds: ['wreck-symbol'] }),
    ]);
  });

  it('omits definitions with no rendered layers and ignores unclassified layers', () => {
    const groups = s57FacetLayerGroups([
      layer('depth', 'DEPARE'),
      layer('unknown', 'FUTURE_OBJECT'),
      { id: 'background', type: 'background' },
    ]);

    expect(groups).toEqual([
      {
        key: 'depth-areas',
        title: 'Depth areas',
        description: 'Depth bands, shallow and drying areas, and dredged areas.',
        layerIds: ['depth'],
      },
    ]);
  });

  it('defines unique keys and assigns each source layer to only one facet', () => {
    const keys = S57_FACET_DEFINITIONS.map((facet) => facet.key);
    const sourceLayers = S57_FACET_DEFINITIONS.flatMap((facet) => facet.sourceLayers);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(sourceLayers).size).toBe(sourceLayers.length);
    expect(new Set(sourceLayers)).toEqual(new Set(S57_SUPPORTED_SOURCE_LAYERS));
    for (const facet of S57_FACET_DEFINITIONS) {
      expect(facet.title).not.toBe('');
      expect(facet.description).not.toBe('');
      expect(facet.sourceLayers.length).toBeGreaterThan(0);
    }
  });
});

it('reports only unsupported source classes, not dataset records or known layers', () => {
  expect(
    s57UnsupportedLayers(['WEDKLP', 'M_COVR', 'DSID', 'Generic', 'FSHFAC', 'FSHFAC', 'TOPMAR']),
  ).toEqual(['FSHFAC', 'TOPMAR']);
  expect(s57UnsupportedLayers([])).toEqual([]);
});
