// Transient chart visualization for a Wayfinder request, live search frontier, and ranked results.

import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { Route } from '$entities/route';
import type { LatLon } from '$shared/geo';
import {
  antimeridianLineGeometry,
  emptyFeatureCollection,
  ensureGeoJsonSources,
  featureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setPaintProp,
  setSourceData,
} from '$shared/map';
import type { WayfinderRouteGeometry, WayfinderStatus } from './wayfinder-client';

const PATH_SOURCE = 'binnacle-wayfinder-paths';
const FRONTIER_SOURCE = 'binnacle-wayfinder-frontier';
const MARKER_SOURCE = 'binnacle-wayfinder-markers';
const PATH_CASING_LAYER = 'binnacle-wayfinder-path-casing';
const PATH_ALTERNATIVE_LAYER = 'binnacle-wayfinder-path-alternative';
const PATH_LAYER = 'binnacle-wayfinder-path';
const FRONTIER_LINE_LAYER = 'binnacle-wayfinder-frontier-line';
const FRONTIER_POINT_LAYER = 'binnacle-wayfinder-frontier-point';
const MARKER_LAYER = 'binnacle-wayfinder-marker';
const MARKER_LABEL_LAYER = 'binnacle-wayfinder-marker-label';
const LAYERS = [
  PATH_CASING_LAYER,
  PATH_ALTERNATIVE_LAYER,
  PATH_LAYER,
  FRONTIER_LINE_LAYER,
  FRONTIER_POINT_LAYER,
  MARKER_LAYER,
  MARKER_LABEL_LAYER,
] as const;
const SOURCES = [PATH_SOURCE, FRONTIER_SOURCE, MARKER_SOURCE] as const;

export interface WayfindingVisualizationSource {
  readonly previewRoute: Route | undefined;
  readonly status: WayfinderStatus;
  readonly routes: readonly WayfinderRouteGeometry[];
  readonly frontiers: ReadonlyArray<readonly LatLon[]>;
  readonly selectedAlternativeIndex: number;
}

function lonLat(point: LatLon): [number, number] {
  return [point.longitude, point.latitude];
}

function pathFeatures(source: WayfindingVisualizationSource): GeoJSON.FeatureCollection {
  return featureCollection(
    source.routes
      .filter((route) => route.points.length >= 2)
      .map((route) => ({
        type: 'Feature' as const,
        geometry: antimeridianLineGeometry(route.points.map(lonLat)),
        properties: {
          index: route.index,
          selected: route.index === source.selectedAlternativeIndex,
        },
      })),
  );
}

function frontierFeatures(
  history: ReadonlyArray<readonly LatLon[]>,
  points: readonly LatLon[] | undefined,
): GeoJSON.FeatureCollection {
  if (!points?.length && history.length === 0) return emptyFeatureCollection();
  const features: GeoJSON.Feature[] = (points ?? []).map((point, index) => ({
    type: 'Feature',
    id: `frontier-${index}`,
    geometry: { type: 'Point', coordinates: lonLat(point) },
    properties: { index },
  }));
  for (const [index, frontier] of history.entries()) {
    if (frontier.length < 2) continue;
    features.unshift({
      type: 'Feature',
      id: `isochrone-${index}`,
      geometry: antimeridianLineGeometry(frontier.map(lonLat)),
      // A frontier leaves the active point set once the following search step
      // supersedes or prunes it. Keep that explored geometry visible as a
      // neutral dotted trace only while calculation is active.
      properties: { kind: 'rejected', age: history.length - index },
    });
  }
  return featureCollection(features);
}

function displayedPoints(source: WayfindingVisualizationSource): readonly LatLon[] {
  const result = source.routes.find((route) => route.index === source.selectedAlternativeIndex);
  if (result) return result.points;
  return source.previewRoute?.waypoints.map((waypoint) => waypoint.position) ?? [];
}

function markerFeatures(source: WayfindingVisualizationSource): GeoJSON.FeatureCollection {
  const points = displayedPoints(source);
  const last = points.length - 1;
  return featureCollection(
    points.map((point, index) => ({
      type: 'Feature' as const,
      id: `wayfinder-${index}`,
      geometry: { type: 'Point' as const, coordinates: lonLat(point) },
      properties: {
        kind: index === 0 ? 'origin' : index === last ? 'destination' : 'waypoint',
        label: index === 0 ? 'O' : index === last ? 'D' : '',
      },
    })),
  );
}

function visualizationSignature(source: WayfindingVisualizationSource): string {
  return JSON.stringify({
    state: source.status.state,
    progress: source.status.progress,
    frontier: source.status.frontier,
    frontiers: source.frontiers,
    selected: source.selectedAlternativeIndex,
    routes: source.routes,
    preview: source.previewRoute?.waypoints.map((waypoint) => waypoint.position),
  });
}

function selectedColor(paint: MapThemePaint): ExpressionSpecification {
  return ['case', ['get', 'selected'], paint.select, paint.note];
}

function alternativeColor(paint: MapThemePaint): ExpressionSpecification {
  return [
    'match',
    ['%', ['get', 'index'], 5],
    0,
    paint.note,
    1,
    paint.waypoint,
    2,
    paint.tide,
    3,
    paint.navPort,
    paint.navStarboard,
  ];
}

function alternativeDash(): ExpressionSpecification {
  return [
    'match',
    ['%', ['get', 'index'], 4],
    0,
    ['literal', [5, 2]],
    1,
    ['literal', [2, 2]],
    2,
    ['literal', [7, 2, 1, 2]],
    ['literal', [1, 2]],
  ];
}

function markerColor(paint: MapThemePaint): ExpressionSpecification {
  return [
    'match',
    ['get', 'kind'],
    'origin',
    paint.select,
    'destination',
    paint.routeHighlight,
    paint.waypoint,
  ];
}

function rejectedTraceColor(paint: MapThemePaint): string {
  if (paint.theme === 'night-red') return paint.boundary;
  return paint.theme === 'dusk' ? '#7d8790' : '#7f858a';
}

export interface WayfindingOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

export function createWayfindingOverlay(source: WayfindingVisualizationSource): WayfindingOverlay {
  let paint = mapThemePaint('day');
  let lastSignature = '';

  return {
    id: 'wayfinding-plan',
    title: 'Wayfinder plan',
    description: 'The active route search and its ranked passage alternatives.',
    band: 'routes',
    listed: false,
    supportsOpacity: false,
    layerIds: LAYERS,
    add(ctx) {
      lastSignature = '';
      ensureGeoJsonSources(ctx.map, SOURCES);
      const before = ctx.beforeIdFor('routes');
      const casing: LineLayerSpecification = {
        id: PATH_CASING_LAYER,
        type: 'line',
        source: PATH_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#10202b',
          'line-width': ['case', ['get', 'selected'], 7, 5],
          'line-opacity': ['case', ['get', 'selected'], 0.72, 0.35],
        },
      };
      const paths: LineLayerSpecification = {
        id: PATH_LAYER,
        type: 'line',
        source: PATH_SOURCE,
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': selectedColor(paint),
          'line-width': ['case', ['get', 'selected'], 4, 2],
          'line-opacity': ['case', ['get', 'selected'], 1, 0.7],
        },
      };
      const alternatives: LineLayerSpecification = {
        id: PATH_ALTERNATIVE_LAYER,
        type: 'line',
        source: PATH_SOURCE,
        filter: ['==', ['get', 'selected'], false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': alternativeColor(paint),
          'line-width': 2.5,
          'line-opacity': 0.78,
          'line-dasharray': alternativeDash(),
        },
      };
      const frontierLine: LineLayerSpecification = {
        id: FRONTIER_LINE_LAYER,
        type: 'line',
        source: FRONTIER_SOURCE,
        filter: ['==', '$type', 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'case',
            ['==', ['get', 'kind'], 'rejected'],
            rejectedTraceColor(paint),
            paint.select,
          ],
          'line-width': 2,
          'line-opacity': 0.58,
          'line-dasharray': [1, 2],
        },
      };
      const frontierPoints: CircleLayerSpecification = {
        id: FRONTIER_POINT_LAYER,
        type: 'circle',
        source: FRONTIER_SOURCE,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-color': paint.select,
          'circle-radius': 5,
          'circle-opacity': 0.65,
          'circle-stroke-color': paint.markerGlyph,
          'circle-stroke-width': 1,
        },
      };
      const markers: CircleLayerSpecification = {
        id: MARKER_LAYER,
        type: 'circle',
        source: MARKER_SOURCE,
        paint: {
          'circle-color': markerColor(paint),
          'circle-radius': ['match', ['get', 'kind'], 'waypoint', 4, 9],
          'circle-stroke-color': paint.markerGlyph,
          'circle-stroke-width': 2,
        },
      };
      const labels: SymbolLayerSpecification = {
        id: MARKER_LABEL_LAYER,
        type: 'symbol',
        source: MARKER_SOURCE,
        filter: ['!=', ['get', 'label'], ''],
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': paint.markerGlyph },
      };
      for (const layer of [
        casing,
        alternatives,
        paths,
        frontierLine,
        frontierPoints,
        markers,
        labels,
      ]) {
        if (!ctx.map.getLayer(layer.id)) ctx.map.addLayer(layer, before);
      }
    },
    sync(ctx) {
      const signature = visualizationSignature(source);
      if (signature !== lastSignature) {
        lastSignature = signature;
        setSourceData(ctx.map, PATH_SOURCE, pathFeatures(source));
        setSourceData(
          ctx.map,
          FRONTIER_SOURCE,
          frontierFeatures(
            source.status.state === 'calculating' ? source.frontiers : [],
            source.status.state === 'calculating' ? source.status.frontier : undefined,
          ),
        );
        setSourceData(ctx.map, MARKER_SOURCE, markerFeatures(source));
      }
      if (source.status.state === 'calculating') {
        const phase = (Date.now() % 1400) / 1400;
        setPaintProp(
          ctx.map,
          FRONTIER_POINT_LAYER,
          'circle-radius',
          4 + Math.sin(phase * Math.PI) * 5,
        );
        setPaintProp(
          ctx.map,
          FRONTIER_POINT_LAYER,
          'circle-opacity',
          0.35 + Math.sin(phase * Math.PI) * 0.5,
        );
      }
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, LAYERS, visible);
    },
    applyTheme(ctx, next) {
      paint = next;
      setPaintProp(ctx.map, PATH_LAYER, 'line-color', selectedColor(paint));
      setPaintProp(ctx.map, PATH_ALTERNATIVE_LAYER, 'line-color', alternativeColor(paint));
      setPaintProp(ctx.map, FRONTIER_LINE_LAYER, 'line-color', [
        'case',
        ['==', ['get', 'kind'], 'rejected'],
        rejectedTraceColor(paint),
        paint.select,
      ]);
      setPaintProp(ctx.map, FRONTIER_POINT_LAYER, 'circle-color', paint.select);
      setPaintProp(ctx.map, FRONTIER_POINT_LAYER, 'circle-stroke-color', paint.markerGlyph);
      setPaintProp(ctx.map, MARKER_LAYER, 'circle-color', markerColor(paint));
      setPaintProp(ctx.map, MARKER_LAYER, 'circle-stroke-color', paint.markerGlyph);
      setPaintProp(ctx.map, MARKER_LABEL_LAYER, 'text-color', paint.markerGlyph);
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, LAYERS, SOURCES);
    },
  };
}
