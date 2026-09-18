import type { LayerSpecification } from 'maplibre-gl';

export const S57_FACET_DEFINITIONS = [
  {
    key: 'depth-areas',
    title: 'Depth areas',
    description: 'Depth bands, shallow and drying areas, and dredged areas.',
    sourceLayers: ['DEPARE', 'DRGARE'],
  },
  {
    key: 'soundings-contours',
    title: 'Soundings and contours',
    description: 'Spot depths, depth contours, and the emphasized safety contour.',
    sourceLayers: ['SOUNDG', 'DEPCNT'],
  },
  {
    key: 'navigation-aids',
    title: 'Navigation aids',
    description: 'Navigation marks, daymarks, landmarks, and lights.',
    sourceLayers: [
      'BOYLAT',
      'BCNLAT',
      'BOYCAR',
      'BOYISD',
      'BOYSAW',
      'BOYSPP',
      'BCNCAR',
      'BCNISD',
      'BCNSAW',
      'BCNSPP',
      'DAYMAR',
      'LNDMRK',
      'LIGHTS',
    ],
  },
  {
    key: 'hazards',
    title: 'Hazards',
    description: 'Wrecks, rocks, obstructions, and foul ground.',
    sourceLayers: ['WRECKS', 'UWTROC', 'OBSTRN', 'FOULGND'],
  },
  {
    key: 'regulated-routes',
    title: 'Routes and regulated areas',
    description:
      'Anchorages, canals, fairways, traffic routes, caution areas, restricted waters, and unsurveyed areas.',
    sourceLayers: [
      'ACHARE',
      'RESARE',
      'MIPARE',
      'CTNARE',
      'FAIRWY',
      'CANALS',
      'NAVLNE',
      'TSSLPT',
      'TSSBND',
      'TSEZNE',
      'UNSARE',
    ],
  },
  {
    key: 'shoreline',
    title: 'Shoreline and structures',
    description: 'ENC coastline and shoreline construction outlines. Land remains transparent.',
    sourceLayers: ['LNDARE', 'COALNE', 'SLCONS'],
  },
  {
    key: 'infrastructure',
    title: 'Cables, pipelines, and bridges',
    description: 'Charted submarine cables, pipelines, and bridge crossings.',
    sourceLayers: ['CBLSUB', 'PIPSOL', 'BRIDGE'],
  },
  {
    key: 'kelp',
    title: 'Kelp and weed',
    description: 'Charted kelp and weed.',
    sourceLayers: ['WEDKLP'],
  },
  {
    key: 'seabed',
    title: 'Seabed composition',
    description: 'Bottom materials, not an assessment of anchor holding.',
    sourceLayers: ['SBDARE'],
  },
  {
    key: 'moorings',
    title: 'Moorings and berths',
    description: 'Moorings, anchor berths, and berths.',
    sourceLayers: ['MORFAC', 'ACHBRT', 'BERTHS'],
  },
  {
    key: 'overhead',
    title: 'Overhead hazards',
    description: 'Cables and pipelines. Charted clearances are not tide-adjusted.',
    sourceLayers: ['CBLOHD', 'PIPOHD'],
  },
  {
    key: 'survey-quality',
    title: 'Survey quality',
    description: 'Survey confidence and reliability, not live depths.',
    sourceLayers: ['M_QUAL', 'M_SREL'],
  },
  {
    key: 'coverage',
    title: 'ENC coverage',
    description: 'ENC coverage boundaries.',
    sourceLayers: ['M_COVR'],
  },
] as const;

type S57FacetKey = (typeof S57_FACET_DEFINITIONS)[number]['key'];

const FACET_BY_SOURCE_LAYER = new Map<string, S57FacetKey>(
  S57_FACET_DEFINITIONS.flatMap((facet) =>
    facet.sourceLayers.map((sourceLayer) => [sourceLayer, facet.key] as const),
  ),
);

export interface S57FacetLayerGroup {
  key: S57FacetKey;
  title: string;
  description: string;
  layerIds: string[];
}

// Group the actual draw layers, not provider metadata, so a facet appears only when it controls at
// least one rendered layer. Several style layers can share one S-57 source-layer and all stay under
// the same semantic control.
export function s57FacetLayerGroups(layers: readonly LayerSpecification[]): S57FacetLayerGroup[] {
  const idsByFacet = new Map<S57FacetKey, string[]>();
  for (const layer of layers) {
    const sourceLayer = 'source-layer' in layer ? layer['source-layer'] : undefined;
    if (typeof sourceLayer !== 'string') continue;
    const key = FACET_BY_SOURCE_LAYER.get(sourceLayer.toUpperCase());
    if (!key) continue;
    const ids = idsByFacet.get(key);
    if (ids) ids.push(layer.id);
    else idsByFacet.set(key, [layer.id]);
  }

  return S57_FACET_DEFINITIONS.flatMap((facet) => {
    const layerIds = idsByFacet.get(facet.key);
    return layerIds
      ? [{ key: facet.key, title: facet.title, description: facet.description, layerIds }]
      : [];
  });
}

// These records describe the dataset rather than drawable chart objects.
const NON_DRAWING_LAYERS = new Set(['DSID', 'C_AGGR', 'C_ASSO', 'Generic']);

export function s57UnsupportedLayers(sourceLayers: readonly string[]): string[] {
  return [...new Set(sourceLayers)]
    .filter((sourceLayer) => !NON_DRAWING_LAYERS.has(sourceLayer))
    .filter((sourceLayer) => !FACET_BY_SOURCE_LAYER.has(sourceLayer.toUpperCase()))
    .sort();
}
